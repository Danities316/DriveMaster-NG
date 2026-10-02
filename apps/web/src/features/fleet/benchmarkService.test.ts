import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { db } from "../../db/db";
import { saveFuelBenchmark, discardFuelBenchmarkProposal } from "./benchmarkService";
import { storeChange, storeResult } from "../../sync/projection";
import type { AuthenticatedUser, Vehicle } from "@drivemaster/shared";
const user: AuthenticatedUser = {
  id: "u",
  schoolId: "s",
  name: "Owner",
  phone: "test",
  role: "OWNER"
};
const settings = { minimum: "5.00", maximum: "10.00", allowancePercent: "20.00", notes: "Lessons" };
const vehicle: Vehicle = {
  id: "v",
  schoolId: "s",
  plateNumber: "ABC123",
  model: "Corolla",
  status: "ACTIVE",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  await db.vehicles.put(vehicle);
});
afterEach(() => vi.restoreAllMocks());
it("queues an owner proposal without activating unconfirmed thresholds", async () => {
  await saveFuelBenchmark(user, "v", settings, 0);
  expect((await db.outbox.toArray())[0]).toMatchObject({
    entity: "vehicle",
    action: "UPDATE",
    expectedVersion: 0,
    payload: { id: "v", fuelBenchmark: settings }
  });
  expect((await db.vehicles.get("v"))?.fuelBenchmark).toBeUndefined();
  await expect(saveFuelBenchmark(user, "v", settings, 0)).rejects.toThrow(/pending/);
});
it("prevents unauthorized and stale local proposals", async () => {
  await expect(
    saveFuelBenchmark({ ...user, role: "RECEPTIONIST" }, "v", settings, 0)
  ).rejects.toThrow(/owner/);
  await expect(saveFuelBenchmark({ ...user, schoolId: "other" }, "v", settings, 0)).rejects.toThrow(
    /school/
  );
  await expect(saveFuelBenchmark(user, "v", settings, 1)).rejects.toThrow(/changed/);
  expect(await db.outbox.count()).toBe(0);
});
it("does not leave a proposal or modify confirmed settings when queue persistence fails", async () => {
  vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("quota"));
  await expect(saveFuelBenchmark(user, "v", settings, 0)).rejects.toThrow("quota");
  expect(await db.outbox.count()).toBe(0);
  expect((await db.vehicles.get("v"))?.fuelBenchmark).toBeUndefined();
});
it("accepts remote settings with a pending proposal, ignores stale replay, and allows conflict discard", async () => {
  await saveFuelBenchmark(user, "v", settings, 0);
  const entry = (await db.outbox.toArray())[0]!;
  await storeChange({
    cursor: "2",
    entity: "vehicle",
    action: "UPDATE",
    record: { ...vehicle, benchmarkVersion: 2, fuelBenchmark: settings }
  });
  await storeResult({
    mutationId: "old",
    vehicle: { ...vehicle, benchmarkVersion: 1, fuelBenchmark: { ...settings, maximum: "99.00" } }
  });
  expect((await db.vehicles.get("v"))?.benchmarkVersion).toBe(2);
  expect((await db.vehicles.get("v"))?.fuelBenchmark?.maximum).toBe("10.00");
  await expect(discardFuelBenchmarkProposal(user, entry.mutationId)).rejects.toThrow(
    /failed or conflicting/
  );
  await db.outbox.update(entry.mutationId, { status: "CONFLICT" });
  await discardFuelBenchmarkProposal(user, entry.mutationId);
  expect(await db.outbox.count()).toBe(0);
  expect((await db.vehicles.get("v"))?.benchmarkVersion).toBe(2);
});
