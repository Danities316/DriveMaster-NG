import { createHash } from "node:crypto";
import type { Prisma, Vehicle as DbVehicle } from "@prisma/client";
import {
  FleetValidationError,
  parseFleetInput,
  validateOdometer,
  parseFuelBenchmark
} from "@drivemaster/shared";
import type {
  FleetEntity,
  Vehicle,
  FuelBenchmark,
  FuelInput,
  MileageInput,
  SyncMutation,
  SyncResult,
  VehicleInput
} from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import type { MutationOutcome } from "../sync/syncRepository.js";

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const toVehicle = (row: DbVehicle): Vehicle => ({
  ...row,
  fuelBenchmark: row.fuelBenchmark as FuelBenchmark | null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()
});
export async function processFleetMutation(
  schoolId: string,
  userId: string,
  mutation: SyncMutation
): Promise<MutationOutcome> {
  const conflict = (message: string): MutationOutcome => ({
    status: "conflict",
    conflict: { mutationId: mutation.mutationId, message }
  });
  if (mutation.schoolId !== schoolId)
    return { status: "failed", message: "This record belongs to another school." };
  const benchmarkUpdate = mutation.entity === "vehicle" && mutation.action === "UPDATE";
  if (mutation.action !== "CREATE" && !benchmarkUpdate)
    return {
      status: "failed",
      message: "Vehicle recordings are append-only. Updates and deletion are not supported."
    };
  try {
    const payload = mutation.payload as { id?: unknown; fuelBenchmark?: unknown } | null;
    if (
      benchmarkUpdate &&
      (!payload ||
        typeof payload.id !== "string" ||
        !payload.id ||
        payload.id.length > 100 ||
        !Number.isInteger(mutation.expectedVersion) ||
        (mutation.expectedVersion ?? -1) < 0)
    )
      throw new FleetValidationError("A vehicle and its current benchmark version are required.");
    const benchmark = benchmarkUpdate ? parseFuelBenchmark(payload?.fuelBenchmark) : undefined;
    const input = benchmarkUpdate
      ? { id: payload!.id as string, fuelBenchmark: benchmark! }
      : parseFleetInput(mutation.entity as FleetEntity, mutation.payload);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          entity: mutation.entity,
          action: mutation.action,
          schoolId,
          deviceId: mutation.deviceId,
          input,
          ...(benchmarkUpdate ? { expectedVersion: mutation.expectedVersion } : {})
        })
      )
      .digest("hex");
    return await getPrismaClient().$transaction(
      async (tx): Promise<MutationOutcome> => {
        await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
        const actor = await tx.user.findFirst({
          where: { id: userId, schoolId, isActive: true, role: { in: ["OWNER", "RECEPTIONIST"] } }
        });
        if (!actor)
          return {
            status: "failed",
            message: "Your account cannot record vehicle activity for this school."
          };
        if (benchmarkUpdate && actor.role !== "OWNER")
          return { status: "failed", message: "Only an owner can change fuel benchmarks." };
        const receipt = await tx.syncReceipt.findUnique({
          where: { mutationId: mutation.mutationId }
        });
        if (receipt)
          return receipt.schoolId === schoolId && receipt.requestHash === requestHash
            ? { status: "duplicate", result: receipt.result as unknown as SyncResult }
            : conflict("This change ID has already been used for different data.");
        const result: SyncResult = { mutationId: mutation.mutationId };
        let benchmarkBefore: Prisma.JsonValue | undefined;
        if (benchmarkUpdate) {
          const vehicle = await tx.vehicle.findFirst({ where: { id: input.id, schoolId } });
          if (!vehicle) return { status: "failed", message: "Vehicle not found in this school." };
          if (vehicle.benchmarkVersion !== mutation.expectedVersion)
            return conflict(
              "The benchmark changed on another device. Synchronize and discard this proposal before editing the latest settings."
            );
          benchmarkBefore = vehicle.fuelBenchmark;
          result.vehicle = toVehicle(
            await tx.vehicle.update({
              where: { id: vehicle.id },
              data: {
                fuelBenchmark: json(benchmark),
                benchmarkVersion: { increment: 1 }
              }
            })
          );
        } else if (mutation.entity === "vehicle") {
          const vehicle = input as VehicleInput;
          const samePlate = (
            await tx.vehicle.findMany({ where: { schoolId }, select: { plateNumber: true } })
          ).some(
            (row) => row.plateNumber.toUpperCase().replace(/[\s-]/g, "") === vehicle.plateNumber
          );
          if (samePlate)
            return conflict(
              "A vehicle with this registration number already exists in your school."
            );
          const row = await tx.vehicle.create({ data: { ...vehicle, schoolId, status: "ACTIVE" } });
          result.vehicle = toVehicle(row);
        } else {
          const reading = input as MileageInput;
          const vehicle = await tx.vehicle.findFirst({
            where: { id: reading.vehicleId, schoolId }
          });
          if (!vehicle)
            return {
              status: "failed",
              message: "Vehicle not found in this school. Synchronize its registration first."
            };
          if (vehicle.status === "INACTIVE")
            return { status: "failed", message: "This vehicle is inactive." };
          const [mileage, fuel] = await Promise.all([
            tx.mileageLog.findMany({
              where: { schoolId, vehicleId: reading.vehicleId },
              select: { date: true, odometer: true }
            }),
            tx.fuelLog.findMany({
              where: { schoolId, vehicleId: reading.vehicleId },
              select: {
                date: true,
                odometer: true,
                receiptReference: true,
                litres: true,
                cost: true
              }
            })
          ]);
          try {
            validateOdometer(
              reading,
              [...mileage, ...fuel].map((row) => ({
                date: row.date.toISOString(),
                odometer: row.odometer
              }))
            );
          } catch (error) {
            if (error instanceof FleetValidationError) return conflict(error.message);
            throw error;
          }
          if (mutation.entity === "mileage_log") {
            if (
              mileage.some(
                (row) =>
                  row.date.getTime() === Date.parse(reading.date) &&
                  row.odometer === reading.odometer
              )
            )
              return conflict("This mileage reading has already been recorded.");
            const row = await tx.mileageLog.create({
              data: { ...reading, schoolId, recordedById: userId, date: new Date(reading.date) }
            });
            result.mileageLog = {
              ...row,
              date: row.date.toISOString(),
              createdAt: row.createdAt.toISOString()
            };
          } else {
            const claim = input as FuelInput;
            if (
              fuel.some(
                (row) =>
                  row.receiptReference?.trim().toUpperCase() === claim.receiptReference ||
                  (row.date.getTime() === Date.parse(claim.date) &&
                    row.odometer === claim.odometer &&
                    row.litres.toFixed(2) === claim.litres &&
                    row.cost.toFixed(2) === claim.cost)
              )
            )
              return conflict(
                "This fuel reference or matching claim has already been recorded for this vehicle."
              );
            const row = await tx.fuelLog.create({
              data: { ...claim, schoolId, recordedById: userId, date: new Date(claim.date) }
            });
            result.fuelLog = {
              ...row,
              date: row.date.toISOString(),
              createdAt: row.createdAt.toISOString(),
              litres: row.litres.toFixed(2),
              cost: row.cost.toFixed(2)
            };
          }
        }
        const record = result.vehicle ?? result.mileageLog ?? result.fuelLog!;
        await tx.syncChange.create({
          data: { schoolId, entity: mutation.entity, action: mutation.action, record: json(record) }
        });
        await tx.auditLog.create({
          data: {
            schoolId,
            userId,
            action: mutation.action,
            entity: mutation.entity,
            entityId: record.id,
            metadata: {
              mutationId: mutation.mutationId,
              deviceId: mutation.deviceId,
              ...(benchmarkUpdate
                ? {
                    benchmarkBefore: benchmarkBefore ?? null,
                    benchmarkAfter: json(benchmark),
                    benchmarkVersion: result.vehicle!.benchmarkVersion!
                  }
                : {})
            }
          }
        });
        await tx.syncReceipt.create({
          data: {
            mutationId: mutation.mutationId,
            schoolId,
            deviceId: mutation.deviceId,
            requestHash,
            result: json(result)
          }
        });
        return { status: "processed", result };
      },
      { timeout: 15000 }
    );
  } catch (error) {
    if (error instanceof FleetValidationError) return { status: "failed", message: error.message };
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return conflict("This record ID or reference is already in use. No duplicate was recorded.");
    throw error;
  }
}
