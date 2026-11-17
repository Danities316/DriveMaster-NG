import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createSessionToken } from "../auth/token.js";
import { createPasswordRecovery } from "../auth/passwordRecovery.js";
const url = process.env["SYNC_TEST_DATABASE_URL"];
const secret = "batch-two-test-secret-not-for-production-32";
const phone = () => `+23480${String(randomInt(0, 100000000)).padStart(8, "0")}`;
describe.skipIf(!url)("Batch 2 access and SMS PostgreSQL", () => {
  let db: PrismaClient,
    schoolId: string,
    owner: { id: string; phone: string; name: string; schoolId: string; role: "OWNER" };
  const app = createApp({
    webOrigin: "http://localhost:5173",
    authSecret: secret,
    sessionMaxAgeSeconds: 3600,
    secureCookies: false
  });
  const cookie = (
    u: {
      id: string;
      schoolId: string;
      role: "OWNER" | "INSTRUCTOR" | "RECEPTIONIST";
      name: string;
      phone: string;
    },
    version = 0
  ) =>
    `dm_session=${createSessionToken({ sub: u.id, schoolId: u.schoolId, role: u.role, name: u.name, phone: u.phone, sessionVersion: version }, secret, 3600)}`;
  const headers = () => ({
    Cookie: cookie(owner),
    "X-Training-User": owner.id,
    "X-Training-School": schoolId
  });
  beforeAll(() => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use local sync_test only.");
    db = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = db;
  });
  beforeEach(async () => {
    schoolId = (
      await db.school.create({
        data: { name: "Batch two", phone: phone(), address: "Test", status: "ACTIVE" }
      })
    ).id;
    owner = (await db.user.create({
      data: {
        name: "Owner",
        phone: phone(),
        schoolId,
        role: "OWNER",
        passwordHash: "unused",
        phoneVerifiedAt: new Date()
      }
    })) as typeof owner;
  });
  afterAll(async () => {
    await db?.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  const staff = () =>
    db.user.create({
      data: {
        name: "Office",
        phone: phone(),
        schoolId,
        role: "RECEPTIONIST",
        passwordHash: "unused"
      }
    });
  it("creates receptionist access and lists safe owner-only account fields", async () => {
    const input = {
      role: "RECEPTIONIST",
      name: "New office",
      phone: phone(),
      password: "OfficePassword123"
    };
    await request(app).post("/api/training/accounts").set(headers()).send(input).expect(201);
    const created = await db.user.findFirstOrThrow({
      where: { schoolId, role: "RECEPTIONIST", name: input.name }
    });
    const createAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "training_account", entityId: created.id, action: "CREATE" }
    });
    expect(createAudit).toMatchObject({
      schoolId,
      userId: owner.id,
      action: "CREATE",
      entity: "training_account",
      entityId: created.id
    });
    expect(createAudit.metadata).toEqual({
      changedFields: ["name", "phone", "role", "studentId", "permitExpiryDate"]
    });
    const listed = await request(app).get("/api/training/accounts").set(headers()).expect(200);
    expect(listed.body.accounts).toHaveLength(1);
    expect(listed.body.accounts[0]).toMatchObject({
      name: input.name,
      role: "RECEPTIONIST",
      isActive: true,
      version: 0
    });
    expect(JSON.stringify(listed.body)).not.toContain("passwordHash");
    expect(JSON.stringify(await db.auditLog.findMany({ where: { schoolId } }))).not.toContain(
      input.password
    );
    await request(app)
      .post("/api/training/accounts")
      .set(headers())
      .send({ ...input, phone: phone(), role: "OWNER" })
      .expect(400);
  });
  it("saves an instructor permit expiry date at account creation and rejects invalid dates", async () => {
    const input = {
      role: "INSTRUCTOR",
      name: "New instructor",
      phone: phone(),
      password: "InstructorPassword123",
      permitExpiryDate: "2027-09-28"
    };
    await request(app).post("/api/training/accounts").set(headers()).send(input).expect(201);
    const account = await db.user.findFirstOrThrow({
      where: { schoolId, role: "INSTRUCTOR", phone: `+234${input.phone.slice(1)}` }
    });
    expect(account.permitExpiryDate).toBe(input.permitExpiryDate);
    await request(app)
      .post("/api/training/accounts")
      .set(headers())
      .send({ ...input, phone: phone(), permitExpiryDate: "2026-02-30" })
      .expect(400);
  });
  it("deactivates with an audit, revokes sessions/codes and keeps records; reactivation never revives old sessions", async () => {
    const user = await staff();
    const oldCookie = cookie(user as Parameters<typeof cookie>[0]);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(200);
    await db.passwordReset.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        phoneKey: randomUUID(),
        sessionVersion: 0,
        digest: "old-reset",
        delivered: true,
        expiresAt: new Date(Date.now() + 600000)
      }
    });
    const path = `/api/training/accounts/${user.id}/access`;
    await request(app)
      .post(path)
      .set(headers())
      .send({ isActive: false, expectedVersion: 0, reason: "Employee has left the school" })
      .expect(200);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    const changed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.isActive).toBe(false);
    expect(changed.sessionVersion).toBe(1);
    expect(
      (await db.passwordReset.findFirstOrThrow({ where: { userId: user.id } })).digest
    ).toBeNull();
    await request(app)
      .post(path)
      .set(headers())
      .send({ isActive: false, expectedVersion: 0, reason: "Employee has left the school" })
      .expect(409);
    const deactivationAudit = await db.auditLog.findFirstOrThrow({
      where: { schoolId, entityId: user.id, action: "DEACTIVATE" }
    });
    expect(deactivationAudit).toMatchObject({
      schoolId,
      userId: owner.id,
      action: "DEACTIVATE",
      entity: "STAFF_ACCOUNT",
      entityId: user.id,
      metadata: { changedFields: ["isActive", "sessionVersion"] }
    });
    await request(app)
      .post(path)
      .set(headers())
      .send({ isActive: true, expectedVersion: 1, reason: "Employee has returned" })
      .expect(200);
    expect(
      await db.auditLog.count({
        where: { schoolId, userId: owner.id, entityId: user.id, action: "REACTIVATE" }
      })
    ).toBe(1);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie(user as Parameters<typeof cookie>[0], 2))
      .expect(200);
    expect(await db.user.count({ where: { schoolId } })).toBe(2);
  });
  it("rejects staff management by receptionists and cross-school/owner targets", async () => {
    const user = await staff();
    const h = {
      Cookie: cookie(user as Parameters<typeof cookie>[0]),
      "X-Training-User": user.id,
      "X-Training-School": schoolId
    };
    await request(app).get("/api/training/accounts").set(h).expect(403);
    await request(app)
      .post(`/api/training/accounts/${user.id}/access`)
      .set(h)
      .send({ isActive: false, expectedVersion: 0, reason: "Must be rejected" })
      .expect(403);
    for (const id of [owner.id, randomUUID()])
      await request(app)
        .post(`/api/training/accounts/${id}/access`)
        .set(headers())
        .send({ isActive: false, expectedVersion: 0, reason: "Must be rejected" })
        .expect(404);
    await request(app)
      .post(`/api/training/accounts/${user.id}/access`)
      .set(headers())
      .send({ isActive: false, expectedVersion: 0 })
      .expect(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
  });
  it("does not charge unknown or disabled accounts, or duplicate reset delivery tasks", async () => {
    const consume = vi.fn().mockResolvedValue(undefined),
      send = vi.fn().mockResolvedValue(true);
    const recovery = createPasswordRecovery({ secret, consume, send, code: () => "654321" });
    await (await recovery.request(phone(), "test-ip")).deliver();
    const disabled = await staff();
    await db.user.update({ where: { id: disabled.id }, data: { isActive: false } });
    await (await recovery.request(disabled.phone, "test-ip")).deliver();
    expect(consume.mock.calls.filter((c) => c[0] === "sms-delivery-global")).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    const pending = await recovery.request(owner.phone, "test-ip");
    await Promise.all([pending.deliver(), pending.deliver()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls.filter((c) => c[0] === "sms-delivery-global")).toHaveLength(1);
  });
  it("invalidates a reset code when the delivery budget is unavailable", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const consume = vi.fn(async (key: string) => {
      if (key === "sms-delivery-global") throw new Error("Budget exhausted");
    });
    const recovery = createPasswordRecovery({ secret, consume, send, code: () => "654321" });
    const pending = await recovery.request(owner.phone, "test-ip");
    await pending.deliver();
    expect(send).not.toHaveBeenCalled();
    const row = await db.passwordReset.findUniqueOrThrow({ where: { id: pending.requestId } });
    expect(row.digest).toBeNull();
    expect(row.delivered).toBe(false);
  });
});
