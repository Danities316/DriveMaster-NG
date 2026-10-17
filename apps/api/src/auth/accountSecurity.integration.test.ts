import { randomInt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrismaClient } from "../prisma.js";
import { createApp } from "../app.js";
import { createPasswordRecovery, changeAccountPassword } from "./passwordRecovery.js";
import { createOwnerVerification } from "./ownerVerification.js";
import { verificationStore } from "./verificationRepository.js";
import { hashPasswordAsync, verifyPasswordAsync } from "./password.js";
import { createSessionToken } from "./token.js";
import { createVerificationSession } from "./verificationSession.js";
import { SESSION_COOKIE_NAME } from "./constants.js";
import { createPlatformToken, platformCredentialStamp } from "../platform/platformToken.js";

const url = process.env["SYNC_TEST_DATABASE_URL"];
const secret = "phase-two-integration-test-secret-32-characters";
describe.skipIf(!url)("Phase 2 account security PostgreSQL", () => {
  let client: PrismaClient, userId: string, schoolId: string, phone: string, ip: string;
  let time: Date;
  const send = vi.fn().mockResolvedValue(true);
  const recovery = createPasswordRecovery({ secret, send, code: () => "654321", now: () => time });
  const app = createApp({
    webOrigin: "http://localhost:5173",
    authSecret: secret,
    sessionMaxAgeSeconds: 3600,
    secureCookies: false
  });
  const cookie = (version = 0) =>
    `${SESSION_COOKIE_NAME}=${createSessionToken({ sub: userId, schoolId, name: "Ada", phone, role: "OWNER", sessionVersion: version }, secret, 3600)}`;
  const start = async () => {
    const pending = await recovery.request(phone, ip);
    await pending.deliver();
    return pending.requestId;
  };
  beforeAll(() => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use a local sync_test database.");
    client = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = client;
  });
  beforeEach(async () => {
    time = new Date();
    phone = `+23480${String(randomInt(0, 100000000)).padStart(8, "0")}`;
    ip = randomUUID();
    send.mockResolvedValue(true);
    send.mockClear();
    const school = await client.school.create({
      data: { name: "Security school", phone, address: "Test", status: "ACTIVE" }
    });
    schoolId = school.id;
    const user = await client.user.create({
      data: {
        schoolId,
        name: "Ada",
        phone,
        role: "OWNER",
        passwordHash: await hashPasswordAsync("OriginalPassword123"),
        phoneVerifiedAt: time
      }
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client?.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  it("resets once, revokes old sessions and recovery codes, and preserves verification state", async () => {
    const oldCookie = cookie();
    const id = await start();
    expect((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(200);
    await recovery.confirm(id, "654321", "NewPassword123", ip);
    expect((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
    const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.sessionVersion).toBe(1);
    expect(await verifyPasswordAsync("NewPassword123", user.passwordHash)).toBe(true);
    expect(user.phoneVerifiedAt).toEqual(time);
    expect(user.phoneVerificationRequired).toBe(false);
    await expect(recovery.confirm(id, "654321", "AnotherPassword123", ip)).rejects.toThrow();
    expect(await client.auditLog.count({ where: { userId, action: "RESET_PASSWORD" } })).toBe(1);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie(1))).status).toBe(200);
  });
  it("commits incorrect attempt counts and enforces the five-attempt boundary", async () => {
    const id = await start();
    for (let n = 0; n < 5; n++)
      await expect(recovery.confirm(id, "999999", "NewPassword123", ip)).rejects.toThrow();
    expect((await client.passwordReset.findUniqueOrThrow({ where: { id } })).attempts).toBe(5);
    await expect(recovery.confirm(id, "654321", "NewPassword123", ip)).rejects.toThrow();
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(0);
  });
  it("rejects expired and provider-rejected codes without changing the password", async () => {
    const id = await start();
    time = new Date(time.getTime() + 600001);
    await expect(recovery.confirm(id, "654321", "NewPassword123", ip)).rejects.toThrow();
    send.mockResolvedValue(false);
    const replacement = await start();
    await expect(recovery.confirm(replacement, "654321", "NewPassword123", ip)).rejects.toThrow();
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(0);
  });
  it("allows only one concurrent reset completion", async () => {
    const id = await start();
    const results = await Promise.allSettled([
      recovery.confirm(id, "654321", "NewPassword123", ip),
      recovery.confirm(id, "654321", "OtherPassword123", ip)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(1);
  });
  it("requires signup verification after recovery and rejects the previous restricted cookie version", async () => {
    await client.user.update({
      where: { id: userId },
      data: { phoneVerificationRequired: true, phoneVerifiedAt: null }
    });
    await client.school.update({
      where: { id: schoolId },
      data: { status: "TRIAL", trialEndsAt: null }
    });
    const verification = createOwnerVerification({
      store: verificationStore,
      secret,
      send,
      code: () => "123456",
      now: () => time
    });
    await verification.send(userId, ip);
    const pendingCookie = `dm_owner_verification=${createVerificationSession(userId, secret, 0)}`;
    await recovery.confirm(await start(), "654321", "NewPassword123", ip);
    expect(
      (await request(app).get("/api/auth/owner-verification").set("Cookie", pendingCookie)).status
    ).toBe(401);
    const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phoneVerificationRequired).toBe(true);
    expect(user.phoneVerifiedAt).toBeNull();
    expect(
      (await client.school.findUniqueOrThrow({ where: { id: schoolId } })).trialEndsAt
    ).toBeNull();
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie(1))).status).toBe(202);
  });
  it("changes a password atomically and invalidates outstanding recovery challenges", async () => {
    const oldCookie = cookie();
    const id = await start();
    await expect(changeAccountPassword(userId, "wrong", "NewPassword123")).rejects.toThrow(
      "incorrect"
    );
    await changeAccountPassword(userId, "OriginalPassword123", "NewPassword123");
    expect((await request(app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
    await expect(recovery.confirm(id, "654321", "OtherPassword123", ip)).rejects.toThrow();
  });
  it("revokes just the logged-out cookie and revokes every cookie on sign out all", async () => {
    const first = cookie(),
      second = cookie();
    expect(first).not.toBe(second);
    expect((await request(app).post("/api/auth/logout").set("Cookie", first)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", first)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout-all").set("Cookie", second)).status).toBe(
      200
    );
    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(401);
  });
  it("revokes school access, public enrollment and old sessions across suspension and reactivation", async () => {
    const passwordHash = await hashPasswordAsync("AdminPassword123");
    const admin = await client.platformAdmin.create({
      data: { email: `${randomUUID()}@test.invalid`, name: "Admin", passwordHash }
    });
    const adminCookie = `dm_platform_session=${createPlatformToken({ sub: admin.id, name: admin.name, email: admin.email, credentialStamp: platformCredentialStamp(passwordHash, secret) }, secret, 3600)}`;
    const previous = cookie();
    const id = await start();
    expect(
      (
        await request(app)
          .patch(`/api/platform/schools/${schoolId}/status`)
          .set("Cookie", adminCookie)
          .send({ status: "SUSPENDED", reason: "Security test suspension" })
      ).status
    ).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", previous)).status).toBe(401);
    expect((await request(app).get(`/api/enroll/${schoolId}`)).status).toBe(404);
    await expect(recovery.confirm(id, "654321", "NewPassword123", ip)).rejects.toThrow();
    await request(app)
      .patch(`/api/platform/schools/${schoolId}/status`)
      .set("Cookie", adminCookie)
      .send({ status: "ACTIVE", reason: "Security test reactivation" });
    expect((await request(app).get("/api/auth/me").set("Cookie", previous)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie(1))).status).toBe(200);
  });
  it("does not send recovery SMS for unknown or suspended accounts and uses decoy references", async () => {
    const unknown = await recovery.request(
      `+23481${String(randomInt(0, 100000000)).padStart(8, "0")}`,
      randomUUID()
    );
    await unknown.deliver();
    expect(unknown.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(send).not.toHaveBeenCalled();
    await expect(
      recovery.confirm(unknown.requestId, "654321", "NewPassword123", ip)
    ).rejects.toThrow();
    await client.school.update({ where: { id: schoolId }, data: { status: "CLOSED" } });
    await start();
    expect(send).not.toHaveBeenCalled();
    expect(getPrismaClient()).toBe(client);
  });
  it("expires durable rate windows at the UTC boundary independent of the database timezone", async () => {
    const key = `utc-window-${randomUUID()}`;
    await verificationStore.consume(key, 1, 60000, time);
    await expect(
      verificationStore.consume(key, 1, 60000, new Date(time.getTime() + 59999))
    ).rejects.toThrow();
    await expect(
      verificationStore.consume(key, 1, 60000, new Date(time.getTime() + 60000))
    ).resolves.toBeUndefined();
  });
});
