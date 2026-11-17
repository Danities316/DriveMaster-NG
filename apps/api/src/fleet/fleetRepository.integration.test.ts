import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import type { SyncMutation } from "@drivemaster/shared";
import { processMutation, pullChanges } from "../sync/syncRepository.js";
const url = process.env["SYNC_TEST_DATABASE_URL"];
describe.skipIf(!url)("fleet PostgreSQL workflow", () => {
  let client: PrismaClient, schoolId: string, userId: string, vehicleId: string;
  const request = (entity: SyncMutation["entity"], payload: unknown): SyncMutation => ({
    mutationId: randomUUID(),
    deviceId: randomUUID(),
    schoolId,
    entity,
    action: "CREATE",
    payload
  });
  const send = (entry: SyncMutation) => processMutation(schoolId, userId, entry);
  const reading = () => ({
    id: randomUUID(),
    vehicleId,
    date: "2026-01-02T10:00:00Z",
    odometer: 1000,
    driverName: "Ada",
    notes: null
  });
  const claim = () => ({
    ...reading(),
    litres: "20",
    cost: "19000",
    receiptReference: "RECEIPT-1",
    fullTank: true
  });
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use a local sync_test database.");
    client = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = client;
  });
  beforeEach(async () => {
    schoolId = randomUUID();
    userId = randomUUID();
    vehicleId = randomUUID();
    await client.school.create({
      data: { id: schoolId, name: "Fleet test", phone: "test", address: "Test" }
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
    expect(
      (
        await send(
          request("vehicle", { id: vehicleId, plateNumber: "ABC-123-XY", model: "Corolla" })
        )
      ).status
    ).toBe("processed");
  });
  afterAll(async () => {
    if (client) await client.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  it("commits fuel, receipt, audit and pull history once under concurrent delivery", async () => {
    const entry = request("fuel_log", claim());
    expect((await Promise.all([send(entry), send(entry)])).map((row) => row.status).sort()).toEqual(
      ["duplicate", "processed"]
    );
    expect(await client.fuelLog.count({ where: { schoolId } })).toBe(1);
    const audit = await client.auditLog.findFirstOrThrow({
      where: {
        schoolId,
        entity: "fuel_log",
        entityId: (entry.payload as { id: string }).id
      }
    });
    expect(audit).toMatchObject({
      schoolId,
      userId,
      action: "CREATE",
      entity: "fuel_log",
      entityId: (entry.payload as { id: string }).id
    });
    expect(audit.metadata).toMatchObject({
      changedFields: expect.arrayContaining(["vehicleId", "date", "odometer", "cost"])
    });
    const changes = await pullChanges(schoolId, "0", 100);
    expect(changes.changes).toHaveLength(2);
    expect(changes.changes[1]?.record).toMatchObject({
      cost: "19000.00",
      litres: "20.00",
      receiptReference: "RECEIPT-1",
      fullTank: true,
      recordedById: userId
    });
  });
  it("calculates authoritative discrepancy alerts and deduplicates delivery", async () => {
    expect(
      (
        await send(
          request("fuel_log", {
            ...claim(),
            date: "2026-01-01T10:00:00Z",
            odometer: 1000,
            cost: "1000.00",
            receiptReference: "PREVIOUS"
          })
        )
      ).status
    ).toBe("processed");
    expect(
      (
        await send(
          request("fuel_log", {
            ...claim(),
            date: "2026-01-03T10:00:00Z",
            odometer: 1100,
            receiptReference: "FUTURE"
          })
        )
      ).status
    ).toBe("processed");

    const entry = request("fuel_log", {
      ...claim(),
      date: "2026-01-02T10:00:00Z",
      odometer: 1009,
      cost: "5000.00",
      discrepancyAlert: false
    });
    expect((await Promise.all([send(entry), send(entry)])).map((row) => row.status).sort()).toEqual(
      ["duplicate", "processed"]
    );

    const stored = await client.fuelLog.findUnique({
      where: { id: (entry.payload as { id: string }).id }
    });
    expect(stored?.discrepancyAlert).toBe(true);
    expect(await client.fuelLog.count({ where: { schoolId, id: stored?.id } })).toBe(1);
    const change = (await pullChanges(schoolId, "0", 100)).changes.find(
      (row) => row.record.id === stored?.id
    );
    expect(change?.record.discrepancyAlert).toBe(true);
  });
  it("rejects duplicate plates, references and repeated readings with different IDs", async () => {
    expect(
      (
        await send(
          request("vehicle", { id: randomUUID(), plateNumber: "abc123xy", model: "Another" })
        )
      ).status
    ).toBe("conflict");
    expect((await send(request("fuel_log", claim()))).status).toBe("processed");
    expect(
      (
        await send(
          request("fuel_log", { ...claim(), date: "2026-01-03T10:00:00Z", odometer: 1050 })
        )
      ).status
    ).toBe("conflict");
    expect((await send(request("mileage_log", reading()))).status).toBe("processed");
    expect((await send(request("mileage_log", reading()))).status).toBe("conflict");
  });
  it("checks chronology across both record types and allows a valid backdated reading", async () => {
    await send(
      request("mileage_log", { ...reading(), date: "2026-01-01T10:00:00Z", odometer: 900 })
    );
    await send(request("fuel_log", { ...claim(), date: "2026-01-03T10:00:00Z", odometer: 1100 }));
    expect((await send(request("mileage_log", { ...reading(), odometer: 1101 }))).status).toBe(
      "conflict"
    );
    expect((await send(request("mileage_log", { ...reading(), odometer: 899 }))).status).toBe(
      "conflict"
    );
    expect((await send(request("mileage_log", reading()))).status).toBe("processed");
  });
  it("enforces school ownership, active staff, immutable records and positive claims", async () => {
    expect((await send(request("fuel_log", { ...claim(), vehicleId: randomUUID() }))).status).toBe(
      "failed"
    );
    expect((await send(request("fuel_log", { ...claim(), cost: "0" }))).status).toBe("failed");
    expect((await send({ ...request("fuel_log", claim()), action: "UPDATE" })).status).toBe(
      "failed"
    );
    await client.user.update({ where: { id: userId }, data: { role: "INSTRUCTOR" } });
    expect((await send(request("mileage_log", reading()))).status).toBe("failed");
    expect(await client.mileageLog.count({ where: { schoolId } })).toBe(0);
  });
  it("serializes conflicting concurrent mileage writes", async () => {
    const results = await Promise.all([
      send(request("mileage_log", reading())),
      send(request("mileage_log", { ...reading(), odometer: 999 }))
    ]);
    expect(results.map((row) => row.status).sort()).toEqual(["conflict", "processed"]);
    expect(await client.mileageLog.count({ where: { schoolId } })).toBe(1);
  });

  const settings = { minimum: "5", maximum: "10", allowancePercent: "20", notes: "Lesson driving" };
  const benchmarkRequest = (): SyncMutation => ({
    ...request("vehicle", { id: vehicleId, fuelBenchmark: settings }),
    action: "UPDATE",
    expectedVersion: 0
  });
  it("persists an owner benchmark, receipt, audit and synchronized update exactly once", async () => {
    const entry = benchmarkRequest();
    expect((await Promise.all([send(entry), send(entry)])).map((row) => row.status).sort()).toEqual(
      ["duplicate", "processed"]
    );
    expect(await client.vehicle.findUnique({ where: { id: vehicleId } })).toMatchObject({
      benchmarkVersion: 1,
      fuelBenchmark: { maximum: "10.00", allowancePercent: "20.00" }
    });
    const audit = await client.auditLog.findMany({
      where: { schoolId, entity: "vehicle", action: "UPDATE" }
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ changedFields: ["fuelBenchmark"] });
    const changes = await pullChanges(schoolId, "0", 100);
    expect(changes.changes.at(-1)).toMatchObject({
      entity: "vehicle",
      action: "UPDATE",
      record: { benchmarkVersion: 1, fuelBenchmark: { maximum: "10.00" } }
    });
    expect((await send({ ...entry, expectedVersion: 1 })).status).toBe("conflict");
  });
  it("audits vehicle, mileage and fuel writes once with changed field names only", async () => {
    const vehicleAudit = await client.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "vehicle", entityId: vehicleId, action: "CREATE" }
    });
    expect(vehicleAudit).toMatchObject({ schoolId, userId, entityId: vehicleId });
    expect(vehicleAudit.metadata).toMatchObject({
      changedFields: expect.arrayContaining(["plateNumber", "model"])
    });

    const benchmark = benchmarkRequest();
    expect((await send(benchmark)).status).toBe("processed");
    const updateAudit = await client.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "vehicle", entityId: vehicleId, action: "UPDATE" }
    });
    expect(updateAudit).toMatchObject({ schoolId, userId, entityId: vehicleId });
    expect(updateAudit.metadata).toEqual({ changedFields: ["fuelBenchmark"] });

    const mileage = reading();
    mileage.date = "2026-01-01T10:00:00Z";
    mileage.odometer = 900;
    expect((await send(request("mileage_log", mileage))).status).toBe("processed");
    const mileageAudit = await client.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "mileage_log", entityId: mileage.id }
    });
    expect(mileageAudit).toMatchObject({
      schoolId,
      userId,
      action: "CREATE",
      entityId: mileage.id
    });
    expect(mileageAudit.metadata).toMatchObject({
      changedFields: expect.arrayContaining(["vehicleId", "date", "odometer"])
    });

    const fuel = { ...claim(), date: "2026-01-02T10:00:00Z", odometer: 1000 };
    expect((await send(request("fuel_log", fuel))).status).toBe("processed");
    const fuelAudit = await client.auditLog.findFirstOrThrow({
      where: { schoolId, entity: "fuel_log", entityId: fuel.id }
    });
    expect(fuelAudit).toMatchObject({
      schoolId,
      userId,
      action: "CREATE",
      entityId: fuel.id
    });
    expect(JSON.stringify(fuelAudit.metadata)).not.toContain(fuel.receiptReference);
    expect(JSON.stringify(fuelAudit.metadata)).not.toContain("19000");
  });
  it("does not leave audit rows for rejected fleet writes or allow cross-school attribution", async () => {
    const before = await client.auditLog.count({ where: { schoolId } });
    expect((await send(request("fuel_log", { ...claim(), cost: "0" }))).status).toBe("failed");
    expect(await client.auditLog.count({ where: { schoolId } })).toBe(before);

    const otherSchool = randomUUID();
    await client.school.create({
      data: { id: otherSchool, name: "Other", phone: randomUUID(), address: "Other" }
    });
    const result = await processMutation(otherSchool, userId, {
      ...request("vehicle", { id: randomUUID(), plateNumber: "XYZ-987", model: "Other" }),
      schoolId: otherSchool
    });
    expect(result.status).toBe("failed");
    expect(await client.auditLog.count({ where: { schoolId: otherSchool } })).toBe(0);
    expect(await client.auditLog.count({ where: { schoolId } })).toBe(before);
  });
  it("rejects concurrent stale benchmark edits and accepts the latest version", async () => {
    expect(
      (await Promise.all([send(benchmarkRequest()), send(benchmarkRequest())]))
        .map((row) => row.status)
        .sort()
    ).toEqual(["conflict", "processed"]);
    expect((await send({ ...benchmarkRequest(), expectedVersion: 1 })).status).toBe("processed");
    expect((await client.vehicle.findUnique({ where: { id: vehicleId } }))?.benchmarkVersion).toBe(
      2
    );
  });
  it("enforces benchmark owner permissions, school isolation and validation", async () => {
    expect(
      (
        await send({
          ...benchmarkRequest(),
          payload: { id: randomUUID(), fuelBenchmark: settings }
        })
      ).status
    ).toBe("failed");
    expect((await send({ ...benchmarkRequest(), schoolId: randomUUID() })).status).toBe("failed");
    expect((await send({ ...benchmarkRequest(), expectedVersion: undefined })).status).toBe(
      "failed"
    );
    expect(
      (
        await send({
          ...benchmarkRequest(),
          payload: { id: vehicleId, fuelBenchmark: { ...settings, minimum: "99" } }
        })
      ).status
    ).toBe("failed");
    await client.user.update({ where: { id: userId }, data: { role: "RECEPTIONIST" } });
    expect((await send(benchmarkRequest())).status).toBe("failed");
    expect((await client.vehicle.findUnique({ where: { id: vehicleId } }))?.benchmarkVersion).toBe(
      0
    );
  });
});
