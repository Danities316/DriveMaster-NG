import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOwnerVerification } from "./ownerVerification.js";
import { verificationStore } from "./verificationRepository.js";
import { registerOwner } from "./ownerRegistration.js";
const url = process.env["SYNC_TEST_DATABASE_URL"];
describe.skipIf(!url)("owner verification PostgreSQL transactions", () => {
  let client: PrismaClient, userId: string, schoolId: string;
  let now = new Date();
  const service = createOwnerVerification({
    store: verificationStore,
    secret: "integration-test-secret",
    send: async () => true,
    code: () => "123456",
    now: () => now
  });
  beforeAll(() => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use a local sync_test database.");
    client = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = client;
  });
  beforeEach(async () => {
    now = new Date();
    const created = await registerOwner({
      ownerName: "Test owner",
      phone: `test-${randomUUID()}`,
      password: "Password123",
      schoolName: "Verification test",
      schoolAddress: "Test"
    });
    userId = created.user.id;
    schoolId = created.school.id;
  });
  afterAll(async () => {
    await client?.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  it("starts the trial only at verification and activates only once under concurrent requests", async () => {
    expect(
      (await client.school.findUniqueOrThrow({ where: { id: schoolId } })).trialEndsAt
    ).toBeNull();
    await service.send(userId, `ip-${userId}`);
    const results = await Promise.allSettled([
      service.verify(userId, "123456", `ip-${userId}`),
      service.verify(userId, "123456", `ip-${userId}`)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phoneVerificationRequired).toBe(false);
    expect(user.phoneVerifiedAt).toEqual(now);
    expect(
      (await client.school.findUniqueOrThrow({ where: { id: schoolId } })).trialEndsAt
    ).toEqual(new Date(now.getTime() + 14 * 86400000));
    expect(await client.auditLog.count({ where: { userId, action: "VERIFY_OWNER_PHONE" } })).toBe(
      1
    );
  });
  it("commits failed attempts and rejects duplicate phone correction without changing the original phone", async () => {
    await service.send(userId, `ip-${userId}`);
    await expect(service.verify(userId, "999999", `ip-${userId}`)).rejects.toThrow("incorrect");
    expect(
      (await client.ownerPhoneVerification.findUniqueOrThrow({ where: { userId } })).attempts
    ).toBe(1);
    const original = await client.user.findUniqueOrThrow({ where: { id: userId } });
    const other = await client.user.create({
      data: { schoolId, name: "Other", role: "OWNER", phone: randomUUID(), passwordHash: "test" }
    });
    now = new Date(now.getTime() + 60000);
    await expect(service.send(userId, `ip-${userId}`, other.phone)).rejects.toThrow();
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).phone).toBe(
      original.phone
    );
  });
  it("serializes durable rate limits across concurrent requests", async () => {
    const key = `test-${randomUUID()}`;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => verificationStore.consume(key, 3, 60000, now))
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
  });
});
