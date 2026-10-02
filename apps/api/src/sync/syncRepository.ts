import { processFleetMutation } from "../fleet/fleetRepository.js";
import { createHash } from "node:crypto";
import type { Prisma, Student as DbStudent, Payment as DbPayment } from "@prisma/client";
import type {
  Student,
  Payment,
  SyncMutation,
  SyncResult,
  SyncConflict,
  SyncPullResponse
} from "@drivemaster/shared";
import { normalizeMoney } from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import {
  createStudentSchema,
  updateStudentSchema,
  createPaymentSchema
} from "../routes/students.js";

export type MutationOutcome =
  | { status: "processed" | "duplicate"; result: SyncResult }
  | { status: "conflict"; conflict: SyncConflict }
  | { status: "failed"; message: string };
export interface SyncDeps {
  process: (schoolId: string, userId: string, mutation: SyncMutation) => Promise<MutationOutcome>;
  pull: (schoolId: string, cursor: string, limit: number) => Promise<SyncPullResponse>;
}

export function toStudent(row: DbStudent): Student {
  return {
    ...row,
    totalTuition: row.totalTuition.toFixed(2),
    enrollmentDate: row.enrollmentDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
function toPayment(row: DbPayment): Payment {
  return {
    ...row,
    amount: row.amount.toFixed(2),
    currency: "NGN",
    paymentDate: row.paymentDate.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function processMutation(
  schoolId: string,
  userId: string,
  mutation: SyncMutation
): Promise<MutationOutcome> {
  const conflict = (message: string, serverStudent?: Student): MutationOutcome => ({
    status: "conflict",
    conflict: {
      mutationId: mutation.mutationId,
      message,
      ...(serverStudent ? { serverStudent } : {})
    }
  });
  if (mutation.schoolId !== schoolId)
    return { status: "failed", message: "This change belongs to another school." };
  if (["vehicle", "mileage_log", "fuel_log"].includes(mutation.entity))
    return processFleetMutation(schoolId, userId, mutation);
  const payload = mutation.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object")
    return { status: "failed", message: "Invalid change details." };
  const create =
    mutation.entity === "student" && mutation.action === "CREATE"
      ? createStudentSchema.safeParse(payload)
      : null;
  const update =
    mutation.entity === "student" && mutation.action === "UPDATE"
      ? updateStudentSchema.safeParse(payload)
      : null;
  const payment =
    mutation.entity === "payment" && mutation.action === "CREATE"
      ? createPaymentSchema.safeParse(payload)
      : null;
  const parsed = create ?? update ?? payment;
  if (!parsed) return { status: "failed", message: "This type of change is not supported yet." };
  if (!parsed.success)
    return {
      status: "failed",
      message: parsed.error.issues[0]?.message ?? "Invalid change details."
    };
  if (
    update &&
    (typeof payload.id !== "string" || !payload.id || Object.keys(parsed.data).length === 0)
  )
    return { status: "failed", message: "Student and changed fields are required." };
  if (payment && (typeof payload.studentId !== "string" || !payload.studentId))
    return { status: "failed", message: "Student is required." };

  const requestHash = createHash("sha256").update(canonical(mutation)).digest("hex");
  try {
    return await getPrismaClient().$transaction(
      async (tx) => {
        // Same lock order as change-log triggers. Receipt, business write and audit are one commit.
        await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
        const receipt = await tx.syncReceipt.findUnique({
          where: { mutationId: mutation.mutationId }
        });
        if (receipt) {
          if (receipt.schoolId !== schoolId || receipt.requestHash !== requestHash)
            return conflict("This change ID was already used for different data.");
          return { status: "duplicate", result: receipt.result as unknown as SyncResult };
        }
        const result: SyncResult = { mutationId: mutation.mutationId };
        let changed = false;
        if (create?.success) {
          const data = create.data;
          let row = await tx.student.findUnique({ where: { id: data.id } });
          if (row) {
            if (
              row.schoolId !== schoolId ||
              row.name !== data.name ||
              row.phone !== data.phone ||
              row.licenseNumber !== (data.licenseNumber ?? null) ||
              row.enrollmentDate.getTime() !== Date.parse(data.enrollmentDate) ||
              normalizeMoney(row.totalTuition.toString()) !== normalizeMoney(data.totalTuition)
            )
              return conflict("A different student record already uses this ID.");
          } else {
            row = await tx.student.create({
              data: { ...data, schoolId, enrollmentDate: new Date(data.enrollmentDate) }
            });
            changed = true;
          }
          result.student = toStudent(row);
        } else if (update?.success) {
          const row = await tx.student.findFirst({ where: { id: payload.id as string, schoolId } });
          if (!row) return { status: "failed", message: "Student not found in this school." };
          if (mutation.expectedVersion === undefined || row.version !== mutation.expectedVersion)
            return conflict(
              "This student was changed elsewhere. Review the latest record before retrying.",
              toStudent(row)
            );
          const data = update.data;
          const count = await tx.student.updateMany({
            where: { id: row.id, schoolId, version: mutation.expectedVersion },
            data: {
              ...data,
              ...(data.enrollmentDate ? { enrollmentDate: new Date(data.enrollmentDate) } : {})
            }
          });
          if (count.count !== 1)
            return conflict("This student changed while saving. Pull the latest record and retry.");
          result.student = toStudent(
            await tx.student.findUniqueOrThrow({ where: { id: row.id, schoolId } })
          );
          changed = true;
        } else if (payment?.success) {
          const data = payment.data;
          const studentId = payload.studentId as string;
          if (!(await tx.student.findFirst({ where: { id: studentId, schoolId } })))
            return { status: "failed", message: "Student not found in this school." };
          let row = await tx.payment.findUnique({ where: { id: data.id } });
          const reference = data.method === "CASH" ? null : (data.reference ?? null);
          if (row) {
            if (
              row.schoolId !== schoolId ||
              row.studentId !== studentId ||
              normalizeMoney(row.amount.toString()) !== normalizeMoney(data.amount) ||
              row.paymentDate.getTime() !== Date.parse(data.paymentDate) ||
              row.method !== data.method ||
              row.currency !== data.currency ||
              row.reference !== reference
            )
              return conflict(
                "A different payment already uses this ID. No additional payment was recorded."
              );
          } else {
            row = await tx.payment.create({
              data: {
                ...data,
                reference,
                schoolId,
                studentId,
                paymentDate: new Date(data.paymentDate)
              }
            });
            changed = true;
          }
          result.payment = toPayment(row);
        }
        if (changed)
          await tx.auditLog.create({
            data: {
              schoolId,
              userId,
              action: mutation.action,
              entity: mutation.entity,
              entityId: result.student?.id ?? result.payment!.id,
              metadata: { mutationId: mutation.mutationId, deviceId: mutation.deviceId }
            }
          });
        await tx.syncReceipt.create({
          data: {
            mutationId: mutation.mutationId,
            schoolId,
            deviceId: mutation.deviceId,
            requestHash,
            result: asJson(result)
          }
        });
        return { status: "processed", result };
      },
      { timeout: 15000 }
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return conflict("This record ID is already in use. Review the record before retrying.");
    throw error;
  }
}

export async function pullChanges(
  schoolId: string,
  cursor: string,
  limit: number
): Promise<SyncPullResponse> {
  const rows = await getPrismaClient().syncChange.findMany({
    where: { schoolId, id: { gt: BigInt(cursor) } },
    orderBy: { id: "asc" },
    take: limit + 1
  });
  const page = rows.slice(0, limit);
  return {
    changes: page.map((row) => ({
      cursor: row.id.toString(),
      entity: row.entity,
      action: row.action,
      record: row.record
    })) as unknown as SyncPullResponse["changes"],
    nextCursor: page.at(-1)?.id.toString() ?? cursor,
    hasMore: rows.length > limit
  };
}
export const syncDeps: SyncDeps = { process: processMutation, pull: pullChanges };
