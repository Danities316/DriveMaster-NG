import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SyncMutation } from "@drivemaster/shared";
import { processMutation, pullChanges } from "./syncRepository.js";

// Explicit opt-in only. Never fall back to the application's DATABASE_URL.
const url = process.env["SYNC_TEST_DATABASE_URL"];
describe.skipIf(!url)("sync PostgreSQL integration", () => {
  let client: PrismaClient;
  let schoolId: string;
  let userId: string;
  const input = () => ({
    id: randomUUID(),
    name: "Ada",
    phone: "08012345678",
    enrollmentDate: "2026-01-01",
    totalTuition: "100000.00"
  });
  const mutation = (
    payload: unknown,
    entity: SyncMutation["entity"] = "student",
    action: SyncMutation["action"] = "CREATE"
  ): SyncMutation => ({
    mutationId: randomUUID(),
    deviceId: randomUUID(),
    schoolId,
    entity,
    action,
    payload
  });
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !["localhost", "127.0.0.1"].includes(target.hostname) ||
      !target.pathname.endsWith("/sync_test")
    )
      throw new Error("Use a dedicated local database named sync_test.");
    client = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = client;
    await client.$connect();
  });
  beforeEach(async () => {
    schoolId = randomUUID();
    userId = randomUUID();
    await client.school.create({
      data: { id: schoolId, name: "Sync test school", phone: "08012345678", address: "Test only" }
    });
    await client.user.create({
      data: {
        id: userId,
        schoolId,
        name: "Owner",
        phone: randomUUID(),
        passwordHash: "test",
        role: "OWNER"
      }
    });
  });
  afterAll(async () => {
    if (client) await client.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  it("commits one record, receipt and audit for concurrent/repeated deliveries", async () => {
    const request = mutation(input());
    const responses = await Promise.all([
      processMutation(schoolId, userId, request),
      processMutation(schoolId, userId, request)
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual(["duplicate", "processed"]);
    expect(await client.student.count({ where: { schoolId } })).toBe(1);
    expect(await client.syncReceipt.count({ where: { schoolId } })).toBe(1);
    expect(await client.auditLog.count({ where: { schoolId } })).toBe(1);
    expect((await pullChanges(schoolId, "0", 100)).changes).toHaveLength(1);
    expect(
      (
        await processMutation(schoolId, userId, {
          ...request,
          payload: { ...(request.payload as object), name: "Different" }
        })
      ).status
    ).toBe("conflict");
  });
  it("enforces versions and logs writes made outside the sync endpoint", async () => {
    const data = input();
    await processMutation(schoolId, userId, mutation(data));
    await client.student.update({ where: { id: data.id }, data: { name: "Other device" } });
    const stale = {
      ...mutation({ id: data.id, name: "My edit" }, "student", "UPDATE"),
      expectedVersion: 0
    };
    const result = await processMutation(schoolId, userId, stale);
    expect(result.status).toBe("conflict");
    if (result.status === "conflict")
      expect(result.conflict.serverStudent).toMatchObject({ name: "Other device", version: 1 });
    expect(
      (
        await processMutation(schoolId, userId, {
          ...stale,
          mutationId: randomUUID(),
          expectedVersion: 1
        })
      ).status
    ).toBe("processed");
    expect(await client.student.findUnique({ where: { id: data.id } })).toMatchObject({
      version: 2,
      name: "My edit"
    });
    expect((await pullChanges(schoolId, "0", 100)).changes.map((change) => change.action)).toEqual([
      "CREATE",
      "UPDATE",
      "UPDATE"
    ]);
  });
  it("deduplicates payments including legacy retries and refuses payment updates", async () => {
    const data = input();
    await processMutation(schoolId, userId, mutation(data));
    const payment = {
      id: randomUUID(),
      studentId: data.id,
      amount: "25000",
      paymentDate: "2026-01-02",
      method: "CASH",
      currency: "NGN"
    };
    const request = mutation(payment, "payment");
    expect((await processMutation(schoolId, userId, request)).status).toBe("processed");
    expect((await processMutation(schoolId, userId, request)).status).toBe("duplicate");
    expect(
      (
        await processMutation(
          schoolId,
          userId,
          mutation({ ...payment, amount: "25000.00" }, "payment")
        )
      ).status
    ).toBe("processed");
    expect(
      (
        await processMutation(
          schoolId,
          userId,
          mutation({ ...payment, amount: "25001" }, "payment")
        )
      ).status
    ).toBe("conflict");
    expect(
      (await processMutation(schoolId, userId, mutation(payment, "payment", "UPDATE"))).status
    ).toBe("failed");
    expect(await client.payment.count({ where: { schoolId } })).toBe(1);
    expect(await client.auditLog.count({ where: { schoolId, entity: "payment" } })).toBe(1);
    const change = (await pullChanges(schoolId, "0", 100)).changes.find(
      (item) => item.entity === "payment"
    )!;
    expect(change.record).toMatchObject({ amount: "25000.00", currency: "NGN" });
    expect(Number.isNaN(Date.parse(change.record.createdAt))).toBe(false);
  });
  it("rolls back the record, trigger change and receipt if audit persistence fails", async () => {
    await expect(processMutation(schoolId, "missing-user", mutation(input()))).rejects.toThrow();
    expect(await client.student.count({ where: { schoolId } })).toBe(0);
    expect(await client.syncReceipt.count({ where: { schoolId } })).toBe(0);
    expect((await pullChanges(schoolId, "0", 100)).changes).toHaveLength(0);
  });
  it("keeps schools isolated and paginates from exclusive server cursors", async () => {
    const records = [input(), input(), input()];
    for (const data of records) await processMutation(schoolId, userId, mutation(data));
    const first = await pullChanges(schoolId, "0", 2);
    expect(first.hasMore).toBe(true);
    expect(first.changes).toHaveLength(2);
    const second = await pullChanges(schoolId, first.nextCursor, 2);
    expect(second.hasMore).toBe(false);
    expect(second.changes).toHaveLength(1);
    expect(
      new Set([...first.changes, ...second.changes].map((change) => change.record.id)).size
    ).toBe(3);
    const other = randomUUID();
    expect((await pullChanges(other, "0", 100)).changes).toHaveLength(0);
    expect((await processMutation(other, userId, mutation(input()))).status).toBe("failed");
    expect(
      (
        await processMutation(
          schoolId,
          userId,
          mutation(
            {
              id: randomUUID(),
              studentId: "foreign-student",
              amount: "1",
              paymentDate: "2026-01-01",
              method: "CASH"
            },
            "payment"
          )
        )
      ).status
    ).toBe("failed");
  });
  it("does not allow a later same-school cursor to commit ahead of an earlier writer", async () => {
    let unlock!: () => void;
    let inserted!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const written = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const first = client.$transaction(async (tx) => {
      const data = input();
      await tx.student.create({
        data: { ...data, schoolId, enrollmentDate: new Date(data.enrollmentDate) }
      });
      inserted();
      await gate;
    });
    await written;
    const second = processMutation(schoolId, userId, mutation(input()));
    expect((await pullChanges(schoolId, "0", 100)).changes).toHaveLength(0);
    unlock();
    await Promise.all([first, second]);
    const page = await pullChanges(schoolId, "0", 1);
    expect((await pullChanges(schoolId, page.nextCursor, 1)).changes).toHaveLength(1);
  });
});
