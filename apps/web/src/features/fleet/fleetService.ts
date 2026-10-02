import { FleetValidationError, parseFleetInput, validateOdometer } from "@drivemaster/shared";
import type { AuthenticatedUser, FleetEntity } from "@drivemaster/shared";
import { db } from "../../db/db";
import { enqueue, requestSync } from "../../sync/queue";

export async function recordFleet(
  user: AuthenticatedUser,
  entity: FleetEntity,
  payload: unknown
): Promise<void> {
  if (!["OWNER", "RECEPTIONIST"].includes(user.role))
    throw new FleetValidationError("Your account cannot record vehicle activity.");
  const input = parseFleetInput(entity, payload);
  await db.transaction("rw", db.vehicles, db.mileageLogs, db.fuelLogs, db.outbox, async () => {
    const timestamp = new Date().toISOString();
    if ("plateNumber" in input) {
      const vehicles = await db.vehicles.where("schoolId").equals(user.schoolId).toArray();
      if (
        vehicles.some(
          (row) => row.plateNumber.toUpperCase().replace(/[\s-]/g, "") === input.plateNumber
        )
      )
        throw new FleetValidationError("This registration number already exists in your school.");
      await db.vehicles.add({
        ...input,
        schoolId: user.schoolId,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    } else {
      const vehicle = await db.vehicles.get(input.vehicleId);
      if (!vehicle || vehicle.schoolId !== user.schoolId)
        throw new FleetValidationError("Select a vehicle in your school.");
      if (vehicle.status === "INACTIVE")
        throw new FleetValidationError("This vehicle is inactive.");
      const rejected = new Set(
        (await db.outbox.toArray())
          .filter((row) => ["FAILED", "CONFLICT"].includes(row.status))
          .map((row) => row.mutationId)
      );
      const mileage = (await db.mileageLogs.where("vehicleId").equals(vehicle.id).toArray()).filter(
        (row) => row.schoolId === user.schoolId && !rejected.has(row.id)
      );
      const fuel = (await db.fuelLogs.where("vehicleId").equals(vehicle.id).toArray()).filter(
        (row) => row.schoolId === user.schoolId && !rejected.has(row.id)
      );
      validateOdometer(input, [...mileage, ...fuel]);
      if ("litres" in input) {
        if (
          fuel.some(
            (row) =>
              row.receiptReference?.trim().toUpperCase() === input.receiptReference ||
              (Date.parse(row.date) === Date.parse(input.date) &&
                row.odometer === input.odometer &&
                Number(row.litres) === Number(input.litres) &&
                Number(row.cost) === Number(input.cost))
          )
        )
          throw new FleetValidationError(
            "This fuel reference or matching claim is already recorded for this vehicle."
          );
        await db.fuelLogs.add({
          ...input,
          schoolId: user.schoolId,
          recordedById: user.id,
          discrepancyAlert: false,
          createdAt: timestamp
        });
      } else {
        if (
          mileage.some(
            (row) =>
              Date.parse(row.date) === Date.parse(input.date) && row.odometer === input.odometer
          )
        )
          throw new FleetValidationError("This mileage reading is already recorded.");
        await db.mileageLogs.add({
          ...input,
          schoolId: user.schoolId,
          recordedById: user.id,
          createdAt: timestamp
        });
      }
    }
    await enqueue({
      mutationId: input.id,
      schoolId: user.schoolId,
      entity,
      action: "CREATE",
      payload: input
    });
  });
  requestSync();
}
