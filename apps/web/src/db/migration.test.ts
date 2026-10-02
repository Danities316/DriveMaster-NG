import Dexie from "dexie";
import { expect, it } from "vitest";
import { DriveMasterDB } from "./db";

it("upgrades existing queued work without losing IDs, payloads, or dependencies", async () => {
  const name = `upgrade-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old
    .version(1)
    .stores({
      students: "id, schoolId",
      payments: "id, schoolId, studentId",
      vehicles: "id, schoolId",
      fuelLogs: "id, schoolId, vehicleId",
      sessionBookings: "id, schoolId, vehicleId, instructorId, studentId, startTime",
      outbox: "mutationId, status, entity, createdAt",
      syncState: "deviceId"
    });
  await old.table("students").put({ id: "s", schoolId: "school", name: "Ada" });
  await old.table("outbox").bulkPut([
    {
      mutationId: "create",
      entity: "student",
      action: "CREATE",
      payload: { id: "s", name: "Ada" },
      createdAt: "2026-01-01",
      status: "SYNCING",
      retryCount: 1
    },
    {
      mutationId: "edit",
      entity: "student",
      action: "UPDATE",
      payload: { id: "s", name: "Edited" },
      createdAt: "2026-01-02",
      status: "PENDING",
      retryCount: 0
    },
    {
      mutationId: "payment",
      entity: "payment",
      action: "CREATE",
      payload: { id: "p", studentId: "s" },
      createdAt: "2026-01-03",
      status: "PENDING",
      retryCount: 0
    },
    {
      mutationId: "orphan",
      entity: "student",
      action: "UPDATE",
      payload: { id: "unknown" },
      createdAt: "2026-01-04",
      status: "PENDING",
      retryCount: 0
    }
  ]);
  old.close();
  const upgraded = new DriveMasterDB(name);
  try {
    await upgraded.open();
    expect(await upgraded.outbox.count()).toBe(4);
    expect(await upgraded.outbox.get("create")).toMatchObject({
      status: "PENDING",
      schoolId: "school",
      sequence: 1,
      retryCount: 1
    });
    expect(await upgraded.outbox.get("edit")).toMatchObject({
      dependsOn: "create",
      payload: { id: "s", name: "Edited" }
    });
    expect(await upgraded.outbox.get("payment")).toMatchObject({
      dependsOn: "edit",
      schoolId: "school"
    });
    expect(await upgraded.outbox.get("orphan")).toMatchObject({ status: "FAILED" });
  } finally {
    await upgraded.delete();
  }
});
