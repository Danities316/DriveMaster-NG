import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { createSessionToken } from "../auth/token.js";
import { SESSION_COOKIE_NAME } from "../auth/constants.js";
import { adjustmentSchema, adjustPayment, reviewPayment } from "./paymentAdjustments.js";
import { createPaymentRecord } from "./paymentRepository.js";
import { createStudentRecord, updateStudentRecord } from "./studentRepository.js";
import { pullChanges } from "../sync/syncRepository.js";
const url = process.env["SYNC_TEST_DATABASE_URL"];
const authSecret = "audit-route-test-secret-at-least-32-characters";
describe.skipIf(!url)("Financial ledger PostgreSQL", () => {
  let db: PrismaClient, schoolId: string, userId: string, studentId: string, paymentId: string;
  const input = (action: "REFUND" | "REVERSE" | "CORRECT" | "UNDO_REFUND", revision = 0) => ({
    id: randomUUID(),
    action,
    revision,
    reason: "Owner reviewed the original receipt"
  });
  beforeAll(() => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use local sync_test only.");
    db = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = db;
  });
  beforeEach(async () => {
    schoolId = (
      await db.school.create({
        data: { name: "Ledger test", phone: randomUUID(), address: "Test", status: "ACTIVE" }
      })
    ).id;
    userId = (
      await db.user.create({
        data: {
          schoolId,
          name: "Owner",
          phone: randomUUID(),
          role: "OWNER",
          passwordHash: "unused"
        }
      })
    ).id;
    studentId = randomUUID();
    paymentId = randomUUID();
    await createStudentRecord(
      schoolId,
      {
        id: studentId,
        name: "Ada",
        phone: "08011111111",
        enrollmentDate: new Date().toISOString(),
        totalTuition: "150.00"
      },
      userId
    );
    const studentAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "STUDENT", entityId: studentId, action: "CREATE" }
    });
    expect(studentAudit).toMatchObject({ schoolId, userId, entityId: studentId });
    expect(studentAudit.metadata).toEqual({
      changedFields: ["name", "phone", "licenseNumber", "enrollmentDate", "totalTuition"]
    });
    await createPaymentRecord(
      schoolId,
      studentId,
      { id: paymentId, amount: "100.00", method: "CASH", paymentDate: new Date().toISOString() },
      userId
    );
    const paymentAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "PAYMENT", entityId: paymentId, action: "CREATE" }
    });
    expect(paymentAudit).toMatchObject({ schoolId, userId, entityId: paymentId });
    expect(paymentAudit.metadata).toEqual({
      entityIds: [studentId],
      changedFields: ["studentId", "amount", "paymentDate", "method", "currency", "reference"]
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  it("corrects atomically, preserves originals, audits and downloads both entries even with a one-row page", async () => {
    const before = await db.syncChange.findFirst({ where: { schoolId }, orderBy: { id: "desc" } });
    const body = {
      ...input("CORRECT"),
      amount: "80.00",
      studentId,
      method: "CASH" as const,
      paymentDate: new Date().toISOString()
    };
    const result = await adjustPayment(schoolId, userId, paymentId, body);
    expect(result.payments.find((p) => p.entryType === "REVERSAL")?.paymentDate).toBe(
      (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).paymentDate.toISOString()
    );
    expect(result.payments.map((p) => p.amount).sort()).toEqual(["-100.00", "80.00"]);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).amount.toFixed(2)
    ).toBe("100.00");
    expect(
      (
        await db.payment.aggregate({ where: { schoolId }, _sum: { amount: true } })
      )._sum.amount?.toFixed(2)
    ).toBe("80.00");
    expect((await pullChanges(schoolId, before!.id.toString(), 1)).changes).toHaveLength(2);
    expect(await adjustPayment(schoolId, userId, paymentId, body)).toEqual(result);
    const adjustmentAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "PAYMENT", entityId: paymentId, action: "CORRECT" }
    });
    expect(adjustmentAudit).toMatchObject({ schoolId, userId, entityId: paymentId });
    expect(adjustmentAudit.metadata).toMatchObject({
      entityIds: expect.arrayContaining([body.id]),
      changedFields: ["amount", "studentId", "method", "reference", "paymentDate"]
    });
    expect(JSON.stringify(adjustmentAudit.metadata)).not.toContain(
      "Owner reviewed the original receipt"
    );
    expect(JSON.stringify(adjustmentAudit.metadata)).not.toContain("80.00");
    await expect(
      adjustPayment(schoolId, userId, paymentId, { ...body, amount: "81.00" })
    ).rejects.toThrow("request id");
    expect(await db.auditLog.count({ where: { schoolId, entity: "PAYMENT" } })).toBe(2);
  });
  it("serializes competing refunds, rejects stale reviews and prevents over-refunding", async () => {
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        adjustPayment(schoolId, userId, paymentId, { ...input("REFUND"), amount: "60.00" })
      )
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await reviewPayment(schoolId, paymentId)).refundable).toBe("40.00");
    await expect(
      adjustPayment(schoolId, userId, paymentId, { ...input("REFUND", 1), amount: "40.01" })
    ).rejects.toThrow("exceeds");
    await expect(adjustPayment(schoolId, userId, paymentId, input("REVERSE", 1))).rejects.toThrow(
      "has refunds"
    );
  });
  it("undoes a mistaken refund once and permits a subsequent correction", async () => {
    const refund = await adjustPayment(schoolId, userId, paymentId, {
      ...input("REFUND"),
      amount: "25.00"
    });
    await adjustPayment(schoolId, userId, refund.payments[0]!.id, input("UNDO_REFUND", 1));
    expect((await reviewPayment(schoolId, paymentId)).refundable).toBe("100.00");
    await expect(
      adjustPayment(schoolId, userId, refund.payments[0]!.id, input("UNDO_REFUND", 2))
    ).rejects.toThrow("cannot be adjusted");
    await adjustPayment(schoolId, userId, paymentId, input("REVERSE", 2));
    expect(
      (
        await db.payment.aggregate({ where: { schoolId }, _sum: { amount: true } })
      )._sum.amount?.toFixed(2)
    ).toBe("0.00");
  });
  it("rejects cross-school access and receptionist adjustments", async () => {
    await expect(reviewPayment(randomUUID(), paymentId)).rejects.toThrow("not found");
    await db.user.update({ where: { id: userId }, data: { role: "RECEPTIONIST" } });
    await expect(adjustPayment(schoolId, userId, paymentId, input("REVERSE"))).rejects.toThrow(
      "active school owner"
    );
    expect(await db.paymentAdjustment.count({ where: { schoolId } })).toBe(0);
    expect(await db.auditLog.count({ where: { schoolId, action: "CORRECT" } })).toBe(0);
  });
  it("prevents edits/deletes, rolls back invalid corrections, and audits tuition changes", async () => {
    await expect(
      db.payment.update({ where: { id: paymentId }, data: { amount: "1.00" } })
    ).rejects.toThrow();
    await expect(db.payment.delete({ where: { id: paymentId } })).rejects.toThrow();
    await expect(
      adjustPayment(schoolId, userId, paymentId, {
        ...input("CORRECT"),
        amount: "80.00",
        studentId: randomUUID(),
        method: "CASH",
        paymentDate: new Date().toISOString()
      })
    ).rejects.toThrow("Student not found");
    expect(await db.paymentAdjustment.count({ where: { schoolId } })).toBe(0);
    await updateStudentRecord(studentId, { totalTuition: "180.00" }, schoolId, userId, 0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, action: "UPDATE", entity: "STUDENT" }
    });
    expect(audit.metadata).toMatchObject({
      before: { totalTuition: "150.00" },
      patch: { totalTuition: "180.00" }
    });
  });
  it("validates positive amounts and complete correction details", () => {
    expect(adjustmentSchema.safeParse({ ...input("REFUND"), amount: "-1.00" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...input("CORRECT"), amount: "1.00" }).success).toBe(false);
  });
  it("allows only one concurrent direct tuition update and audits only the winner", async () => {
    const outcomes = await Promise.allSettled(
      ["180.00", "190.00"].map((totalTuition) =>
        updateStudentRecord(studentId, { totalTuition }, schoolId, userId, 0)
      )
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    const stored = await db.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(stored.version).toBe(1);
    expect(["180.00", "190.00"]).toContain(stored.totalTuition.toFixed(2));
    expect(
      await db.auditLog.count({ where: { schoolId, entity: "STUDENT", action: "UPDATE" } })
    ).toBe(1);
    await expect(
      updateStudentRecord(studentId, { totalTuition: "200.00" }, schoolId, userId)
    ).rejects.toThrow("version");
  });
  it("audits only changed student field names and rejects cross-school audit attribution", async () => {
    await updateStudentRecord(studentId, { totalTuition: "180.00" }, schoolId, userId, 0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "STUDENT", entityId: studentId, action: "UPDATE" }
    });
    expect(audit).toMatchObject({ schoolId, userId, entityId: studentId });
    expect(audit.metadata).toEqual({ changedFields: ["totalTuition"] });
    const otherSchool = await db.school.create({
      data: { name: "Other", phone: randomUUID(), address: "Other", status: "ACTIVE" }
    });
    const otherUser = await db.user.create({
      data: {
        schoolId: otherSchool.id,
        name: "Other owner",
        phone: randomUUID(),
        role: "OWNER",
        passwordHash: "unused"
      }
    });
    await expect(
      createStudentRecord(
        schoolId,
        {
          id: randomUUID(),
          name: "Cross school",
          phone: "08011111111",
          enrollmentDate: new Date().toISOString(),
          totalTuition: "1.00"
        },
        otherUser.id
      )
    ).rejects.toThrow("active school staff");
    expect(await db.auditLog.findMany({ where: { schoolId } })).toHaveLength(3);
    expect(await db.auditLog.findMany({ where: { schoolId: otherSchool.id } })).toHaveLength(0);
  });
  it("rolls back business writes and audits when a payment write fails", async () => {
    const countBefore = await db.auditLog.count({ where: { schoolId } });
    await expect(
      createPaymentRecord(
        schoolId,
        randomUUID(),
        {
          id: randomUUID(),
          amount: "20.00",
          method: "CASH",
          paymentDate: new Date().toISOString()
        },
        userId
      )
    ).rejects.toThrow();
    expect(await db.auditLog.count({ where: { schoolId } })).toBe(countBefore);
    expect(await db.payment.count({ where: { schoolId } })).toBe(1);
  });
  it("does not create an audit row when a student update fails", async () => {
    const before = await db.auditLog.count({ where: { schoolId } });
    await expect(
      updateStudentRecord(randomUUID(), { totalTuition: "180.00" }, schoolId, userId, 0)
    ).rejects.toThrow();
    expect(await db.auditLog.count({ where: { schoolId } })).toBe(before);
  });
  it("audits student, payment and adjustment API writes and blocks cross-school access", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const app = createApp({
      webOrigin: "http://localhost",
      authSecret,
      sessionMaxAgeSeconds: 3600,
      secureCookies: false
    });
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(
      {
        sub: owner.id,
        schoolId,
        role: "OWNER",
        name: owner.name,
        phone: owner.phone
      },
      authSecret,
      3600
    )}`;
    const student = await request(app)
      .post("/api/students")
      .set("Cookie", cookie)
      .send({
        id: randomUUID(),
        name: "Route student",
        phone: "08022223333",
        enrollmentDate: new Date().toISOString(),
        totalTuition: "200.00"
      })
      .expect(201);
    const createdStudentId = student.body.student.id as string;
    const createAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "STUDENT", entityId: createdStudentId, action: "CREATE" }
    });
    expect(createAudit).toMatchObject({ schoolId, userId, entityId: createdStudentId });

    await request(app)
      .patch(`/api/students/${createdStudentId}`)
      .set("Cookie", cookie)
      .send({ name: "Updated route student", expectedVersion: 0 })
      .expect(200);
    const updateAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "STUDENT", entityId: createdStudentId, action: "UPDATE" }
    });
    expect(updateAudit).toMatchObject({ schoolId, userId, entityId: createdStudentId });
    expect(updateAudit.metadata).toEqual({ changedFields: ["name"] });

    const payment = await request(app)
      .post(`/api/students/${createdStudentId}/payments`)
      .set("Cookie", cookie)
      .send({
        id: randomUUID(),
        amount: "100.00",
        paymentDate: new Date().toISOString(),
        method: "CASH"
      })
      .expect(201);
    const createdPaymentId = payment.body.payment.id as string;
    const paymentAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "PAYMENT", entityId: createdPaymentId, action: "CREATE" }
    });
    expect(paymentAudit).toMatchObject({ schoolId, userId, entityId: createdPaymentId });

    const adjustmentId = randomUUID();
    await request(app)
      .post(`/api/students/${createdStudentId}/payments/${createdPaymentId}/adjustments`)
      .set("Cookie", cookie)
      .set("X-Adjustment-User", userId)
      .send({
        id: adjustmentId,
        revision: 0,
        action: "REFUND",
        reason: "Owner approved the refund",
        amount: "10.00"
      })
      .expect(201);
    const adjustmentAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "PAYMENT", entityId: createdPaymentId, action: "REFUND" }
    });
    expect(adjustmentAudit).toMatchObject({ schoolId, userId, entityId: createdPaymentId });
    expect(adjustmentAudit.metadata).toMatchObject({
      entityIds: expect.arrayContaining([adjustmentId]),
      changedFields: ["amount"]
    });
    expect(JSON.stringify(adjustmentAudit.metadata)).not.toContain("10.00");

    const otherSchool = await db.school.create({
      data: { name: "Other audit school", phone: randomUUID(), address: "Other", status: "ACTIVE" }
    });
    const otherStudent = await db.student.create({
      data: {
        id: randomUUID(),
        schoolId: otherSchool.id,
        name: "Other student",
        phone: "08033334444",
        totalTuition: "50.00",
        enrollmentDate: new Date()
      }
    });
    await request(app)
      .get(`/api/students/${otherStudent.id}/payments`)
      .set("Cookie", cookie)
      .expect(404);
    await request(app).get("/api/audit").set("Cookie", cookie).expect(404);
    expect(await db.auditLog.count({ where: { schoolId: otherSchool.id } })).toBe(0);
  });
});
