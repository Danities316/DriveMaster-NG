import { FleetValidationError, parseFuelBenchmark } from "@drivemaster/shared";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { db } from "../../db/db";
import { enqueue, requestSync } from "../../sync/queue";

export async function saveFuelBenchmark(
  user: AuthenticatedUser,
  vehicleId: string,
  value: unknown,
  expectedVersion: number
) {
  if (user.role !== "OWNER")
    throw new FleetValidationError("Only an owner can change fuel benchmarks.");
  const fuelBenchmark = parseFuelBenchmark(value);
  await db.transaction("rw", db.vehicles, db.outbox, async () => {
    const vehicle = await db.vehicles.get(vehicleId);
    if (!vehicle || vehicle.schoolId !== user.schoolId)
      throw new FleetValidationError("Select a vehicle in your school.");
    if ((vehicle.benchmarkVersion ?? 0) !== expectedVersion)
      throw new FleetValidationError(
        "The benchmark changed. Close this form and reopen the latest settings."
      );
    const pending = (await db.outbox.where("schoolId").equals(user.schoolId).toArray()).find(
      (entry) => entry.entity === "vehicle" && (entry.payload as { id?: string }).id === vehicleId
    );
    if (pending)
      throw new FleetValidationError(
        "Synchronize or review this vehicle's pending change before saving a benchmark."
      );
    await enqueue({
      schoolId: user.schoolId,
      entity: "vehicle",
      action: "UPDATE",
      expectedVersion,
      payload: { id: vehicleId, fuelBenchmark }
    });
  });
  requestSync();
}

export async function discardFuelBenchmarkProposal(user: AuthenticatedUser, mutationId: string) {
  if (user.role !== "OWNER")
    throw new FleetValidationError("Only an owner can discard a benchmark proposal.");
  await db.transaction("rw", db.outbox, async () => {
    const entry = await db.outbox.get(mutationId);
    if (
      !entry ||
      entry.schoolId !== user.schoolId ||
      entry.entity !== "vehicle" ||
      entry.action !== "UPDATE" ||
      !["FAILED", "CONFLICT"].includes(entry.status)
    )
      throw new FleetValidationError(
        "Only a failed or conflicting benchmark proposal can be discarded."
      );
    await db.outbox.delete(mutationId);
  });
  requestSync();
}
