import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { recordFleet } from "./fleetService";
import { synchronize } from "../../sync/controller";
import { getOrCreateDeviceId } from "../../lib/device";
import type { AuthenticatedUser, SyncMutation } from "@drivemaster/shared";
const user: AuthenticatedUser = {
  id: "u",
  schoolId: "school",
  role: "OWNER",
  name: "Ada",
  phone: "08012345678"
};
const vehicleId = "b4e9f6bc-39e4-4dd1-95aa-f1f007ec5c48";
const vehicle = { id: vehicleId, plateNumber: "ABC-123-XY", model: "Corolla" };
const reading = () => ({
  id: crypto.randomUUID(),
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
  receiptReference: "R1",
  fullTank: false
});
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("atomically queues vehicle creation before mileage and fuel", async () => {
  await recordFleet(user, "vehicle", vehicle);
  await recordFleet(user, "mileage_log", reading());
  await recordFleet(user, "fuel_log", claim());
  const queue = await db.outbox.toArray();
  expect(
    queue.filter((row) => row.entity !== "vehicle").every((row) => row.dependsOn === vehicleId)
  ).toBe(true);
  expect(await db.mileageLogs.count()).toBe(1);
  expect(await db.fuelLogs.count()).toBe(1);
});
it("rolls back the record when queue persistence fails", async () => {
  await recordFleet(user, "vehicle", vehicle);
  vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("quota"));
  await expect(recordFleet(user, "fuel_log", claim())).rejects.toThrow("quota");
  expect(await db.fuelLogs.count()).toBe(0);
});
it("prevents duplicate plates, fuel references and mileage readings", async () => {
  await recordFleet(user, "vehicle", vehicle);
  await expect(
    recordFleet(user, "vehicle", { ...vehicle, id: crypto.randomUUID(), plateNumber: "abc123xy" })
  ).rejects.toThrow(/already/);
  await recordFleet(user, "fuel_log", claim());
  await expect(recordFleet(user, "fuel_log", claim())).rejects.toThrow(/already/);
  await recordFleet(user, "mileage_log", reading());
  await expect(recordFleet(user, "mileage_log", reading())).rejects.toThrow(/already/);
});
it("validates across mileage and fuel history and excludes another school's vehicle", async () => {
  await recordFleet(user, "vehicle", vehicle);
  await recordFleet(user, "mileage_log", reading());
  await expect(
    recordFleet(user, "fuel_log", { ...claim(), date: "2026-01-01T10:00:00Z", odometer: 1001 })
  ).rejects.toThrow(/earlier or later/);
  await expect(recordFleet({ ...user, schoolId: "other" }, "fuel_log", claim())).rejects.toThrow(
    /school/
  );
  await expect(recordFleet({ ...user, role: "INSTRUCTOR" }, "fuel_log", claim())).rejects.toThrow(
    /account/
  );
});
it("uploads fleet records through the controller and downloads another device's history", async () => {
  await recordFleet(user, "vehicle", vehicle);
  const fuel = claim();
  await recordFleet(user, "fuel_log", fuel);
  const deviceId = getOrCreateDeviceId();
  await db.syncState.put({
    deviceId,
    schoolId: user.schoolId,
    lastPulledCursor: "0",
    lastSyncAt: null,
    bootstrapComplete: true
  });
  const remoteMileage = {
    ...reading(),
    date: "2026-01-03T10:00:00Z",
    odometer: 1020,
    schoolId: user.schoolId,
    recordedById: user.id,
    createdAt: "2026-01-03T10:00:00Z"
  };
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      if (!init.body)
        return {
          ok: true,
          json: async () => ({
            changes: [
              { cursor: "1", entity: "mileage_log", action: "CREATE", record: remoteMileage }
            ],
            nextCursor: "1",
            hasMore: false
          })
        };
      const entry = JSON.parse(init.body as string).mutations[0] as SyncMutation;
      sent.push(entry.entity);
      const record = {
        ...(entry.payload as object),
        schoolId: user.schoolId,
        recordedById: user.id,
        createdAt: remoteMileage.createdAt,
        updatedAt: remoteMileage.createdAt,
        status: "ACTIVE",
        discrepancyAlert: false
      };
      return {
        ok: true,
        json: async () => ({
          processedIds: [entry.mutationId],
          results: [
            {
              mutationId: entry.mutationId,
              [entry.entity === "vehicle" ? "vehicle" : "fuelLog"]: record
            }
          ],
          failures: [],
          conflicts: []
        })
      };
    })
  );
  await synchronize(user);
  expect(sent).toEqual(["vehicle", "fuel_log"]);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.mileageLogs.get(remoteMileage.id)).toMatchObject({ odometer: 1020 });
  expect((await db.syncState.get(deviceId))?.lastPulledCursor).toBe("1");
});
