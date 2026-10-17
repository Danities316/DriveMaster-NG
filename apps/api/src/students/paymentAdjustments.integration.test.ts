import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adjustmentSchema, adjustPayment, reviewPayment } from "./paymentAdjustments.js";
import { createPaymentRecord } from "./paymentRepository.js";
import { createStudentRecord, updateStudentRecord } from "./studentRepository.js";
import { pullChanges } from "../sync/syncRepository.js";
const url = process.env["SYNC_TEST_DATABASE_URL"];
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
    await createPaymentRecord(
      schoolId,
      studentId,
      { id: paymentId, amount: "100.00", method: "CASH", paymentDate: new Date().toISOString() },
      userId
    );
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
});
