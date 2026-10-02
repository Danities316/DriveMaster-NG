import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, User } from "@prisma/client";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { schoolRulesInput } from "./schoolRulesInput.js";
import { enrollmentSettingsInput } from "./enrollmentRoutes.js";
import type { EnrollmentSettings } from "@drivemaster/shared";
import {
  vehicleDocumentIssues,
  validPermitDate,
  moneyCents,
  type VehicleDocuments,
  type TrainingExpense
} from "@drivemaster/shared";
import {
  DEFAULT_SCHOOL_RULES,
  instructorDocumentIssues,
  lagosDay,
  type SchoolRules
} from "@drivemaster/shared";
import {
  isValidStoredMoney,
  normalizeMoney,
  multiplyTrainingMoney,
  instructorTimeCost,
  splitTrainingMoney,
  trainingSummary,
  sumMoney,
  parseFleetInput,
  validateOdometer
} from "@drivemaster/shared";
import type {
  TrainingCommand,
  TrainingRecord,
  TrainingPackage,
  TrainingEnrollment,
  TrainingSettings,
  InstructorSalary,
  TrainingOuting,
  TrainingSnapshot,
  StudentLessonView
} from "@drivemaster/shared";

const money = z
  .string()
  .refine((s) => isValidStoredMoney(s), "Enter a valid naira amount.")
  .transform(normalizeMoney);
const id = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(500);
const date = z.string().datetime({ offset: true });
const odo = z.number().int().min(0).max(2147483647);
const commandSchema = z.object({
  id: z.string().uuid(),
  targetId: id,
  action: z.string().max(30),
  expectedVersion: z.number().int().nonnegative().optional(),
  data: z.unknown()
});
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fail = (message: string, status = 400): never => {
  throw new KnownApiError(message, status, "TRAINING_ERROR");
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
type Raw = { id: string; version: number; kind: string; data: Prisma.JsonValue };
const list = <T>(rows: Raw[], kind: string): TrainingRecord<T>[] =>
  rows
    .filter((r) => r.kind === kind)
    .map((r) => ({ id: r.id, version: r.version, data: r.data as T }));
const staff = (user: User) => ["OWNER", "RECEPTIONIST"].includes(user.role);
const owner = (user: User) => {
  if (user.role !== "OWNER") fail("Only the owner can change this setting.", 403);
};
const monthOf = (date: string) => new Date(Date.parse(date) + 3600000).toISOString().slice(0, 7); // School operating month: Lagos.
const occupied = (s: string) =>
  ["BOOKED", "DRIVING", "PENDING", "CONFIRMED", "DISPUTED"].includes(s);
function checkOverlap(
  outing: TrainingOuting,
  outings: TrainingRecord<TrainingOuting>[],
  ignore: string,
  requireIdle = false
) {
  for (const other of outings) {
    if (other.id === ignore || other.data.status === "CANCELLED") continue;
    const o = other.data;
    const end = o.endedAt ?? o.plannedEnd;
    if (
      Date.parse(outing.plannedStart) < Date.parse(end) &&
      Date.parse(outing.plannedEnd) > Date.parse(o.startedAt ?? o.plannedStart) &&
      (o.vehicleId === outing.vehicleId ||
        o.instructorId === outing.instructorId ||
        o.members.some(
          (m) => m.status !== "MISSED" && outing.members.some((n) => n.studentId === m.studentId)
        ))
    )
      fail("The vehicle, instructor or a student already has a lesson at this time.", 409);
    if (
      requireIdle &&
      o.status === "STARTED" &&
      (o.vehicleId === outing.vehicleId || o.instructorId === outing.instructorId)
    )
      fail(
        "Finish the current outing before starting or booking another with this instructor or vehicle.",
        409
      );
  }
}

export async function executeTraining(
  schoolId: string,
  actorId: string,
  value: unknown
): Promise<{ success: true }> {
  const parsed = commandSchema.parse(value);
  const command: TrainingCommand = { ...parsed, data: parsed.data };
  const fingerprint = createHash("sha256")
    .update(canonical({ schoolId, actorId, command }))
    .digest("hex");
  await getPrismaClient().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
      const actor = await tx.user.findFirst({ where: { id: actorId, schoolId, isActive: true } });
      if (!actor) fail("Please sign in again.", 401);
      const user = actor!;
      const receipt = await tx.trainingReceipt.findUnique({ where: { id: command.id } });
      if (receipt) {
        if (
          receipt.schoolId !== schoolId ||
          receipt.actorId !== actorId ||
          receipt.requestHash !== fingerprint
        )
          fail("This saved change ID has already been used.", 409);
        return;
      }
      const rows = await tx.trainingRecord.findMany({ where: { schoolId } });
      const packages = list<TrainingPackage>(rows, "package"),
        enrollments = list<TrainingEnrollment>(rows, "enrollment");
      const outings = list<TrainingOuting>(rows, "outing"),
        salaries = list<InstructorSalary>(rows, "salary");
      const old = rows.find((r) => r.id === command.targetId);
      const rulesRecord = list<SchoolRules>(rows, "school_rules")[0];
      const schoolRules = rulesRecord?.data ?? DEFAULT_SCHOOL_RULES;
      const vehicleDocuments = list<VehicleDocuments>(rows, "vehicle_documents");
      const checkVehicleDocuments = (vehicleId: string, at: string) => {
        const blocked = vehicleDocumentIssues(
          vehicleDocuments.find((r) => r.data.vehicleId === vehicleId)?.data,
          schoolRules,
          lagosDay(at)
        ).find((r) => r.blocked);
        if (blocked)
          fail(
            `${blocked.label} is expired or its date is missing. Ask the owner to update the vehicle documents.`,
            409
          );
      };
      const checkInstructorDocuments = async (instructorId: string, at: string) => {
        const instructor = await tx.user.findFirst({
          where: { id: instructorId, schoolId, role: "INSTRUCTOR", isActive: true }
        });
        if (!instructor) fail("Choose an active instructor.");
        const blocked = instructorDocumentIssues(instructor!, schoolRules, lagosDay(at)).find(
          (issue) => issue.blocked
        );
        if (blocked) fail(blocked.message, 409);
      };
      if (old && command.expectedVersion !== old.version)
        fail("This record changed on another device. Load the latest records and try again.", 409);
      let kind = "",
        data: unknown;
      const settings = list<TrainingSettings>(rows, "settings")[0]?.data ?? {
        fuelPerStudent: "1500.00",
        reason: "Starting allowance"
      };
      const action = command.action;
      if (action === "VEHICLE_DOCUMENTS") {
        owner(user);
        kind = "vehicle_documents";
        const expiry = z
          .string()
          .refine((s) => !s || validPermitDate(s), "Enter a real expiry date.")
          .transform((s) => s || null);
        const input = z
          .object({
            vehicleId: id,
            insuranceExpiryDate: expiry,
            roadworthinessExpiryDate: expiry,
            reason: text
          })
          .parse(command.data);
        if (!(await tx.vehicle.findFirst({ where: { id: input.vehicleId, schoolId } })))
          fail("Choose a vehicle from your school.");
        if (
          vehicleDocuments.some(
            (r) => r.data.vehicleId === input.vehicleId && r.id !== command.targetId
          )
        )
          fail("Edit the existing vehicle documents.", 409);
        if (old && (old.data as unknown as VehicleDocuments).vehicleId !== input.vehicleId)
          fail("This document record belongs to another vehicle.", 409);
        data = input;
      } else if (action === "EXPENSE" || action === "VOID_EXPENSE") {
        owner(user);
        kind = "expense";
        if (action === "VOID_EXPENSE") {
          if (!old || old.kind !== "expense") fail("Expense not found.", 404);
          const input = z.object({ reason: text }).parse(command.data);
          if ((old!.data as unknown as TrainingExpense).voidReason)
            fail("This expense was already cancelled.", 409);
          data = { ...(old!.data as object), voidReason: input.reason };
        } else {
          if (old)
            fail("Keep the original expense. Cancel it with a reason and add a correction.", 409);
          const input = z
            .object({
              category: z.string().trim().min(1).max(100),
              date: z.string().refine(validPermitDate, "Enter a real expense date."),
              amount: money.refine(
                (s) => moneyCents(s) > 0n,
                "Expense amount must be greater than zero."
              ),
              basis: z.enum(["RECORDED", "ESTIMATE"]),
              studentIds: z.array(id).max(500),
              allocationMode: z.enum(["EQUAL", "CUSTOM"]).default("EQUAL"),
              allocations: z
                .array(z.object({ studentId: id, amount: money }))
                .max(500)
                .optional(),
              reason: text
            })
            .parse(command.data);
          if (
            new Set(input.studentIds).size !== input.studentIds.length ||
            input.studentIds.some(
              (studentId) => !enrollments.some((e) => e.data.studentId === studentId)
            )
          )
            fail("Choose each enrolled student once.");
          if (input.basis === "RECORDED" && input.date > lagosDay(new Date().toISOString()))
            fail("Use an estimate for a future expense.");
          let allocations: TrainingExpense["allocations"] = [];
          if (input.allocationMode === "CUSTOM") {
            allocations = input.allocations ?? [];
            if (
              !allocations.length ||
              allocations.length !== input.studentIds.length ||
              new Set(allocations.map((a) => a.studentId)).size !== allocations.length ||
              allocations.some((a) => !input.studentIds.includes(a.studentId)) ||
              sumMoney(allocations.map((a) => a.amount)) !== input.amount
            )
              fail(
                "The student shares must match the selected students and add up to the full expense."
              );
          } else if (input.studentIds.length) {
            const shares = splitTrainingMoney(input.amount, input.studentIds.length);
            allocations = input.studentIds.map((studentId, i) => ({
              studentId,
              amount: shares[i]!
            }));
          }
          data = {
            category: input.category,
            date: input.date,
            amount: input.amount,
            basis: input.basis,
            reason: input.reason,
            allocations
          };
        }
      } else if (action === "ENROLLMENT_SETTINGS") {
        owner(user);
        kind = "enrollment_settings";
        const input = enrollmentSettingsInput.parse(command.data);
        if (rows.some((r) => r.kind === kind && r.id !== command.targetId))
          fail("Edit the existing enrollment settings.", 409);
        if (input.packageIds.some((id) => !packages.some((p) => p.id === id)))
          fail("Choose saved training packages.");
        if (input.enabled && !input.packageIds.length)
          fail("Choose at least one package before opening enrollment.");
        data = input;
      } else if (action === "EXTRA_LESSONS" || action === "COMPLETE_SCHOOL") {
        owner(user);
        if (!old || old.kind !== "enrollment") fail("Choose a student package.", 404);
        kind = "enrollment";
        const enrollment = old!.data as unknown as TrainingEnrollment;
        if (enrollment.activationStatus === "PENDING_PAYMENT")
          fail("Activate this student's training first.", 409);
        if (action === "EXTRA_LESSONS") {
          const input = z
            .object({
              sessions: z.number().int().min(1).max(200),
              fee: money,
              studentVersion: z.number().int().nonnegative(),
              reason: text
            })
            .parse(command.data);
          const student = await tx.student.findFirst({
            where: { id: enrollment.studentId, schoolId }
          });
          if (!student || student.version !== input.studentVersion)
            fail("The student's fee changed. Refresh before adding lessons.", 409);
          const price = sumMoney([student!.totalTuition.toFixed(2), input.fee]);
          if (!isValidStoredMoney(price) || enrollment.sessions + input.sessions > 10000)
            fail("The new package total is too large.");
          data = {
            ...enrollment,
            sessions: enrollment.sessions + input.sessions,
            price,
            extraLessonReason: input.reason
          };
          await tx.student.update({
            where: { id: enrollment.studentId },
            data: { totalTuition: price }
          });
        } else {
          const input = z.object({ reason: text }).parse(command.data);
          const progress = trainingSummary(
            enrollment,
            "",
            "0",
            outings.map((o) => o.data),
            "0",
            "0"
          );
          if (!progress.schoolTargetMet)
            fail("The student has not reached their saved school training-day target.", 409);
          if (enrollment.schoolCompletedAt)
            fail("School completion has already been recorded.", 409);
          data = {
            ...enrollment,
            schoolCompletedAt: new Date().toISOString(),
            completionReason: input.reason,
            completionTarget: progress.schoolTargetDays,
            completionDays: progress.qualifyingDays
          };
        }
      } else if (action === "SCHOOL_RULES") {
        owner(user);
        kind = "school_rules";
        if (rulesRecord && rulesRecord.id !== command.targetId)
          fail("Edit the existing school rules.", 409);
        data = schoolRulesInput.parse(command.data);
      } else if (action === "ENROLLMENT_RULES") {
        owner(user);
        if (!old || old.kind !== "enrollment") fail("Choose an existing student package.", 404);
        const input = schoolRulesInput
          .pick({ schoolTargetDays: true, reason: true })
          .parse(command.data);
        kind = "enrollment";
        const enrollment = old!.data as unknown as TrainingEnrollment;
        data = {
          ...enrollment,
          rulesSnapshot: { ...(enrollment.rulesSnapshot ?? DEFAULT_SCHOOL_RULES), ...input }
        };
      } else if (["PACKAGE", "SETTINGS", "SALARY"].includes(action)) {
        owner(user);
        if (action === "PACKAGE") {
          kind = "package";
          data = z
            .object({
              name: z.string().trim().min(1).max(100),
              price: money,
              sessions: z.number().int().min(1).max(200),
              minutes: z.literal(30)
            })
            .parse(command.data);
        } else if (action === "SETTINGS") {
          kind = "settings";
          data = z
            .object({
              fuelPerStudent: money.refine(
                (v) => Number(v) > 0,
                "Fuel allowance must be greater than zero."
              ),
              reason: text
            })
            .parse(command.data);
          if (rows.some((r) => r.kind === kind && r.id !== command.targetId))
            fail("Edit the existing fuel allowance.", 409);
        } else {
          kind = "salary";
          const input = z
            .object({
              instructorId: id,
              month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
              salary: money,
              teachingHours: z.number().int().min(1).max(744)
            })
            .parse(command.data);
          if (
            !(await tx.user.findFirst({
              where: { id: input.instructorId, schoolId, role: "INSTRUCTOR", isActive: true }
            }))
          )
            fail("Choose an instructor from your school.");
          if (
            salaries.some(
              (s) =>
                s.id !== command.targetId &&
                s.data.instructorId === input.instructorId &&
                s.data.month === input.month
            )
          )
            fail("Edit the salary already saved for this month.", 409);
          data = input;
        }
      } else if (action === "ENROLL") {
        if (!staff(user)) fail("Only office staff can assign a training package.", 403);
        if (old) fail("A student's agreed package cannot be overwritten.", 409);
        const input = z
          .object({
            studentId: id,
            packageId: id,
            packageVersion: z.number().int().nonnegative(),
            studentVersion: z.number().int().nonnegative(),
            rulesVersion: z.number().int().min(-1).optional()
          })
          .parse(command.data);
        if ((input.rulesVersion ?? -1) !== (rulesRecord?.version ?? -1))
          fail("School rules changed. Refresh and review them before assigning the package.", 409);
        const pack = packages.find((p) => p.id === input.packageId);
        const student = await tx.student.findFirst({ where: { id: input.studentId, schoolId } });
        if (!student || !pack) fail("Choose a saved student and training package.");
        if (pack!.version !== input.packageVersion || student!.version !== input.studentVersion)
          fail(
            "The package or student fee changed. Load the latest records before assigning it.",
            409
          );
        if (enrollments.some((e) => e.data.studentId === input.studentId))
          fail("This student already has an agreed training package.", 409);
        kind = "enrollment";
        data = { ...pack!.data, ...input, rulesSnapshot: schoolRules };
        await tx.student.update({
          where: { id: input.studentId },
          data: { totalTuition: pack!.data.price, version: { increment: 1 } }
        });
      } else if (action === "BOOK") {
        if (!staff(user)) fail("Only office staff can book an outing.", 403);
        if (old) fail("This outing already exists.", 409);
        const input = z
          .object({
            instructorId: id,
            vehicleId: id,
            plannedStart: date,
            studentIds: z.array(id).min(1).max(3)
          })
          .parse(command.data);
        if (new Set(input.studentIds).size !== input.studentIds.length)
          fail("Choose each student only once.");
        await checkInstructorDocuments(input.instructorId, input.plannedStart);
        checkVehicleDocuments(input.vehicleId, input.plannedStart);
        if (
          !(await tx.user.findFirst({
            where: { id: input.instructorId, schoolId, role: "INSTRUCTOR", isActive: true }
          }))
        )
          fail("Choose an active instructor.");
        if (
          !(await tx.vehicle.findFirst({
            where: { id: input.vehicleId, schoolId, status: "ACTIVE" }
          }))
        )
          fail("Choose an active vehicle.");
        const members = input.studentIds.map((studentId) => {
          const enrollment = enrollments.find((e) => e.data.studentId === studentId);
          if (!enrollment) fail("Assign a package to every student first.");
          if (enrollment!.data.activationStatus === "PENDING_PAYMENT")
            fail("This student's registration is waiting for payment or office activation.", 409);
          const reserved = outings
            .flatMap((o) => o.data.members)
            .filter((m) => m.enrollmentId === enrollment!.id && occupied(m.status)).length;
          if (reserved >= enrollment!.data.sessions)
            fail("A student has no unbooked sessions left.", 409);
          return { studentId, enrollmentId: enrollment!.id, status: "BOOKED" as const, minutes: 0 };
        });
        const outing: TrainingOuting = {
          instructorId: input.instructorId,
          vehicleId: input.vehicleId,
          plannedStart: input.plannedStart,
          plannedEnd: new Date(
            Date.parse(input.plannedStart) + members.length * 30 * 60000
          ).toISOString(),
          members,
          status: "BOOKED",
          fuelPerStudent: settings.fuelPerStudent,
          allowanceReason: "School default at booking"
        };
        checkOverlap(outing, outings, command.targetId);
        kind = "outing";
        data = outing;
      } else {
        if (!old || old.kind !== "outing") fail("This outing was not found.", 404);
        const outing = structuredClone(old!.data) as unknown as TrainingOuting;
        const assigned = user.role === "INSTRUCTOR" && outing.instructorId === actorId;
        if (!["RESPOND"].includes(action) && !staff(user) && !assigned)
          fail("You cannot change this outing.", 403);
        kind = "outing";
        if (action === "RETURN_FUEL") {
          owner(user);
          if (outing.status !== "COMPLETED")
            fail("Finish the outing before recording returned money.", 409);
          const input = z
            .object({
              amount: money.refine((s) => moneyCents(s) > 0n, "Enter a positive amount returned."),
              reason: text
            })
            .parse(command.data);
          const total = sumMoney([outing.fuelReturned ?? "0", input.amount]);
          if (
            moneyCents(total) >
            moneyCents(outing.fuelIssued ?? "0") - moneyCents(outing.fuelSpent ?? "0")
          )
            fail("The returned amount cannot exceed unspent fuel money.");
          outing.fuelReturned = total;
          outing.fuelReturnReason = input.reason;
        } else if (action === "ALLOWANCE") {
          owner(user);
          if (outing.status !== "BOOKED")
            fail("Fuel already issued keeps its original amount.", 409);
          const input = z.object({ fuelPerStudent: money, reason: text }).parse(command.data);
          outing.fuelPerStudent = input.fuelPerStudent;
          outing.allowanceReason = input.reason;
        } else if (action === "RESCHEDULE" || action === "CANCEL") {
          if (!staff(user)) fail("Only office staff can move a booking.", 403);
          if (outing.status !== "BOOKED")
            fail("Only a booking that has not started can be moved.", 409);
          const input = z
            .object({ reason: text, plannedStart: date.optional() })
            .parse(command.data);
          outing.changeReason = input.reason;
          if (action === "CANCEL") {
            outing.status = "CANCELLED";
            outing.members.forEach((m) => {
              m.status = "MISSED";
            });
          } else {
            if (!input.plannedStart) fail("Choose the new date and time.");
            await checkInstructorDocuments(outing.instructorId, input.plannedStart!);
            checkVehicleDocuments(outing.vehicleId, input.plannedStart!);
            outing.plannedStart = input.plannedStart!;
            outing.plannedEnd = new Date(
              Date.parse(input.plannedStart!) + outing.members.length * 30 * 60000
            ).toISOString();
            checkOverlap(outing, outings, command.targetId);
          }
        } else if (action === "START") {
          if (outing.status !== "BOOKED")
            fail("This outing has already started or was cancelled.", 409);
          const input = z
            .object({ startedAt: date, odometer: odo, present: z.array(id).min(1).max(3) })
            .parse(command.data);
          if (Date.parse(input.startedAt) > Date.now() + 300000)
            fail("The start time cannot be in the future.");
          await checkInstructorDocuments(outing.instructorId, input.startedAt);
          checkVehicleDocuments(outing.vehicleId, input.startedAt);
          if (
            new Set(input.present).size !== input.present.length ||
            input.present.some((s) => !outing.members.some((m) => m.studentId === s))
          )
            fail("Choose the students present from this outing.");
          if (
            !(await tx.vehicle.findFirst({
              where: { id: outing.vehicleId, schoolId, status: "ACTIVE" }
            })) ||
            !(await tx.user.findFirst({
              where: { id: outing.instructorId, schoolId, role: "INSTRUCTOR", isActive: true }
            }))
          )
            fail("The vehicle or instructor is no longer available.", 409);
          const salary = salaries.find(
            (s) =>
              s.data.instructorId === outing.instructorId &&
              s.data.month === monthOf(input.startedAt)
          );
          if (!salary)
            fail(
              "Ask the owner to enter this instructor's salary and planned teaching hours for this month."
            );
          outing.startedAt = input.startedAt;
          outing.startOdometer = input.odometer;
          outing.plannedStart = input.startedAt;
          outing.plannedEnd = new Date(
            Date.parse(input.startedAt) + input.present.length * 30 * 60000
          ).toISOString();
          checkOverlap(outing, outings, command.targetId, true);
          await checkMileage(tx, schoolId, outing.vehicleId, input.startedAt, input.odometer);
          outing.status = "STARTED";
          outing.salarySnapshot = salary!.data;
          outing.fuelIssued = multiplyTrainingMoney(outing.fuelPerStudent, input.present.length);
          if (!isValidStoredMoney(outing.fuelIssued, true))
            fail("The total fuel money is too large. Reduce the allowance before starting.");
          outing.members.forEach((m) => {
            m.status = input.present.includes(m.studentId) ? "DRIVING" : "MISSED";
            m.fuelCost = m.status === "DRIVING" ? outing.fuelPerStudent : "0.00";
          });
          await writeMileage(
            tx,
            schoolId,
            actorId,
            outing,
            input.startedAt,
            input.odometer,
            "Training outing started"
          );
        } else if (action === "FINISH") {
          if (outing.status !== "STARTED") fail("Start this outing before finishing it.", 409);
          const input = z
            .object({
              endedAt: date,
              odometer: odo,
              fuelSpent: money.optional(),
              litres: z.string().optional(),
              receiptReference: text.optional(),
              fuelDate: date.optional(),
              fuelOdometer: odo.optional(),
              fullTank: z.boolean().optional(),
              lessons: z
                .array(
                  z.object({
                    studentId: id,
                    minutes: z.number().int().min(0).max(180),
                    topics: text,
                    note: z.string().trim().max(500)
                  })
                )
                .min(1)
                .max(3)
            })
            .parse(command.data);
          const duration = Math.floor(
            (Date.parse(input.endedAt) - Date.parse(outing.startedAt!)) / 60000
          );
          if (Date.parse(input.endedAt) > Date.now() + 300000 || duration < 1 || duration > 720)
            fail("Enter a finish time after the start, within 12 hours and not in the future.");
          const present = outing.members.filter((m) => m.status === "DRIVING");
          if (
            input.lessons.length !== present.length ||
            new Set(input.lessons.map((l) => l.studentId)).size !== present.length ||
            input.lessons.some((l) => !present.some((m) => m.studentId === l.studentId))
          )
            fail("Record each attending student's lesson once.");
          if (input.lessons.reduce((sum, m) => sum + m.minutes, 0) > duration)
            fail("Students' driving minutes cannot exceed the outing's actual duration.");
          if (input.odometer < outing.startOdometer!)
            fail("The end mileage cannot be lower than the start mileage.");
          checkOverlap({ ...outing, plannedEnd: input.endedAt }, outings, command.targetId);
          await checkMileage(tx, schoolId, outing.vehicleId, input.endedAt, input.odometer);
          const instructor = await tx.user.findUnique({ where: { id: outing.instructorId } });
          const fuelSpent = input.fuelSpent ?? outing.fuelIssued ?? "0.00";
          if (moneyCents(fuelSpent) > 0n) {
            if (
              !input.fuelDate ||
              input.fuelOdometer === undefined ||
              !input.litres ||
              !input.receiptReference ||
              input.fullTank === undefined
            )
              fail("Enter the fuel purchase time, mileage, litres, receipt and full-tank status.");
            if (
              Date.parse(input.fuelDate!) < Date.parse(outing.startedAt!) ||
              Date.parse(input.fuelDate!) > Date.parse(input.endedAt) ||
              input.fuelOdometer! < outing.startOdometer! ||
              input.fuelOdometer! > input.odometer
            )
              fail("The fuel purchase time and mileage must fall within this outing.");
            const fuel = parseFleetInput("fuel_log", {
              id: randomUUID(),
              vehicleId: outing.vehicleId,
              date: input.fuelDate,
              odometer: input.fuelOdometer,
              litres: input.litres,
              cost: fuelSpent,
              receiptReference: input.receiptReference,
              fullTank: input.fullTank,
              driverName: instructor!.name,
              notes: `Fuel for training outing ${command.targetId}`
            });
            await checkMileage(tx, schoolId, outing.vehicleId, fuel.date, fuel.odometer);
            const existingFuel = await tx.fuelLog.findMany({
              where: { schoolId, vehicleId: outing.vehicleId }
            });
            if (
              existingFuel.some(
                (f) =>
                  f.receiptReference?.toUpperCase().trim() === fuel.receiptReference ||
                  (f.date.getTime() === Date.parse(fuel.date) &&
                    f.odometer === fuel.odometer &&
                    f.cost.toFixed(2) === fuel.cost &&
                    f.litres.toFixed(2) === fuel.litres)
              )
            )
              fail(
                "This fuel purchase is already recorded. Ask the owner to check it before saving again.",
                409
              );
            const savedFuel = await tx.fuelLog.create({
              data: { ...fuel, schoolId, recordedById: actorId, date: new Date(fuel.date) }
            });
            await tx.syncChange.create({
              data: {
                schoolId,
                entity: "fuel_log",
                action: "CREATE",
                record: json({
                  ...savedFuel,
                  date: savedFuel.date.toISOString(),
                  createdAt: savedFuel.createdAt.toISOString(),
                  litres: savedFuel.litres.toFixed(2),
                  cost: savedFuel.cost.toFixed(2)
                })
              }
            });
            outing.fuelLogId = savedFuel.id;
          }
          outing.endedAt = input.endedAt;
          outing.endOdometer = input.odometer;
          outing.status = "COMPLETED";
          outing.fuelSpent = fuelSpent;
          outing.fuelReturned = "0.00";
          outing.fuelSpendingBasis =
            input.fuelSpent === undefined ? "LEGACY_ALLOWANCE" : "REPORTED";
          outing.instructorCost = instructorTimeCost(outing.salarySnapshot!, duration);
          const shares = splitTrainingMoney(outing.instructorCost, present.length);
          const fuelShares = splitTrainingMoney(fuelSpent, present.length);
          present.forEach((m, i) => {
            const lesson = input.lessons.find((l) => l.studentId === m.studentId)!;
            Object.assign(m, lesson);
            m.status = "PENDING";
            m.instructorCost = shares[i];
            m.fuelCost = fuelShares[i];
          });
          await writeMileage(
            tx,
            schoolId,
            actorId,
            outing,
            input.endedAt,
            input.odometer,
            "Training outing finished"
          );
        } else if (action === "RESPOND") {
          if (user.role !== "STUDENT" || !user.studentId)
            fail("Only the student can confirm their own lesson.", 403);
          const input = z
            .object({ attended: z.boolean(), reason: z.string().trim().max(500) })
            .parse(command.data);
          const member = outing.members.find((m) => m.studentId === user.studentId);
          if (!member || member.status !== "PENDING" || outing.status !== "COMPLETED")
            fail("This lesson is not waiting for your response.", 409);
          if (input.attended && member!.minutes < 30)
            fail("This lesson was shorter than 30 minutes. Report it for the owner to check.");
          if (!input.attended && !input.reason) fail("Tell the owner what was wrong.");
          member!.status = input.attended ? "CONFIRMED" : "DISPUTED";
          member!.response = input.attended ? "Student confirmed attendance" : input.reason;
          member!.respondedAt = new Date().toISOString();
        } else if (action === "RESOLVE") {
          owner(user);
          const input = z
            .object({ studentId: id, credit: z.boolean(), reason: text })
            .parse(command.data);
          const member = outing.members.find((m) => m.studentId === input.studentId);
          if (!member || member.status !== "DISPUTED")
            fail("Only a disputed lesson can be reviewed.", 409);
          if (input.credit && member!.minutes < 30)
            fail("A lesson shorter than 30 minutes cannot count as a full session.");
          member!.status = input.credit ? "CONFIRMED" : "VOID";
          member!.reviewReason = input.reason;
        } else fail("Unknown training action.");
        data = outing;
      }
      if (old && old.kind !== kind) fail("This ID belongs to a different record.", 409);
      if (old)
        await tx.trainingRecord.update({
          where: { id: old.id },
          data: { data: json(data), version: { increment: 1 } }
        });
      else
        await tx.trainingRecord.create({
          data: { id: command.targetId, schoolId, kind, data: json(data) }
        });
      await tx.auditLog.create({
        data: {
          schoolId,
          userId: actorId,
          action,
          entity: `training_${kind}`,
          entityId: command.targetId,
          metadata: { commandId: command.id, before: old?.data ?? null, after: json(data) }
        }
      });
      await tx.trainingReceipt.create({
        data: { id: command.id, schoolId, actorId, requestHash: fingerprint }
      });
    },
    { timeout: 20000 }
  );
  return { success: true };
}

async function checkMileage(
  tx: Prisma.TransactionClient,
  schoolId: string,
  vehicleId: string,
  date: string,
  odometer: number
) {
  const [mileage, fuel] = await Promise.all([
    tx.mileageLog.findMany({ where: { schoolId, vehicleId } }),
    tx.fuelLog.findMany({ where: { schoolId, vehicleId } })
  ]);
  validateOdometer(
    { date, odometer },
    [...mileage, ...fuel].map((r) => ({ date: r.date.toISOString(), odometer: r.odometer }))
  );
}
async function writeMileage(
  tx: Prisma.TransactionClient,
  schoolId: string,
  actorId: string,
  outing: TrainingOuting,
  date: string,
  odometer: number,
  notes: string
) {
  const driver = await tx.user.findUnique({ where: { id: outing.instructorId } });
  const row = await tx.mileageLog.create({
    data: {
      id: randomUUID(),
      schoolId,
      vehicleId: outing.vehicleId,
      date: new Date(date),
      odometer,
      driverName: driver!.name,
      recordedById: actorId,
      notes
    }
  });
  await tx.syncChange.create({
    data: {
      schoolId,
      entity: "mileage_log",
      action: "CREATE",
      record: json({ ...row, date: row.date.toISOString(), createdAt: row.createdAt.toISOString() })
    }
  });
}

export async function trainingSnapshot(
  schoolId: string,
  actorId: string
): Promise<TrainingSnapshot> {
  return getPrismaClient().$transaction(
    async (tx) => {
      const user = await tx.user.findFirst({ where: { id: actorId, schoolId, isActive: true } });
      if (!user) fail("Please sign in again.", 401);
      const [rows, students, vehicles, instructors, payments] = await Promise.all([
        tx.trainingRecord.findMany({ where: { schoolId } }),
        tx.student.findMany({ where: { schoolId } }),
        tx.vehicle.findMany({ where: { schoolId } }),
        tx.user.findMany({
          where: { schoolId, role: "INSTRUCTOR", isActive: true },
          select: { id: true, name: true }
        }),
        tx.payment.findMany({ where: { schoolId }, select: { studentId: true, amount: true } })
      ]);
      const packages = list<TrainingPackage>(rows, "package"),
        enrollments = list<TrainingEnrollment>(rows, "enrollment");
      const salaries = list<InstructorSalary>(rows, "salary"),
        outings = list<TrainingOuting>(rows, "outing");
      const settings = list<TrainingSettings>(rows, "settings")[0] ?? null;
      const schoolRules = list<SchoolRules>(rows, "school_rules")[0] ?? null;
      const enrollmentSettings = list<EnrollmentSettings>(rows, "enrollment_settings")[0] ?? null;
      const vehicleDocuments = list<VehicleDocuments>(rows, "vehicle_documents");
      const expenses = list<TrainingExpense>(rows, "expense");
      const instructorProfiles =
        user!.role === "STUDENT"
          ? []
          : await tx.user.findMany({
              where: {
                schoolId,
                role: "INSTRUCTOR",
                isActive: true,
                ...(user!.role === "INSTRUCTOR" ? { id: actorId } : {})
              },
              select: { id: true, nin: true, drivers_license_number: true, permitExpiryDate: true }
            });
      const instructorDocumentWarnings = instructorProfiles.flatMap((profile) =>
        instructorDocumentIssues(
          profile,
          schoolRules?.data ?? DEFAULT_SCHOOL_RULES,
          lagosDay(new Date().toISOString())
        ).map((issue) => ({ instructorId: profile.id, ...issue }))
      );
      const currentSalaries = salaries.filter(
        (s) => s.data.month === monthOf(new Date().toISOString())
      );
      const futureInstructor = currentSalaries.length
        ? splitTrainingMoney(
            sumMoney(currentSalaries.map((s) => instructorTimeCost(s.data, 30))),
            currentSalaries.length
          )[0]!
        : "0.00";
      const summaries = enrollments.map((e) => {
        const result = trainingSummary(
          {
            ...e.data,
            price:
              students.find((s) => s.id === e.data.studentId)?.totalTuition.toFixed(2) ??
              e.data.price
          },
          students.find((s) => s.id === e.data.studentId)?.name ?? "Student",
          sumMoney(
            payments.filter((p) => p.studentId === e.data.studentId).map((p) => p.amount.toFixed(2))
          ),
          outings.map((o) => o.data),
          settings?.data.fuelPerStudent ?? "1500.00",
          futureInstructor,
          expenses.map((e) => e.data)
        );
        if (!currentSalaries.length && result.remaining > 0) {
          delete result.expectedMargin;
          delete result.estimatedRemainingCost;
        }
        return result;
      });
      const base: TrainingSnapshot = {
        viewerRole: user!.role,
        userId: actorId,
        schoolId,
        packages: [],
        enrollments: [],
        settings: null,
        salaries: [],
        outings: [],
        students: [],
        vehicles: [],
        instructors: [],
        summaries: [],
        lessons: []
      };
      if (user!.role === "STUDENT") {
        const own = summaries
          .filter((s) => s.studentId === user!.studentId)
          .map(
            ({
              fuelCost: _f,
              instructorCost: _i,
              costSoFar: _c,
              estimatedRemainingCost: _r,
              expectedMargin: _m,
              otherRecordedCost: _oc,
              otherEstimatedCost: _oe,
              paymentsLessRecordedCosts: _pc,
              fuelAdvanceInProgress: _fa,
              ...safe
            }) => safe
          );
        const lessons: StudentLessonView[] = outings.flatMap((o) =>
          o.data.members
            .filter((m) => m.studentId === user!.studentId)
            .map((m) => ({
              outingId: o.id,
              version: o.version,
              instructor:
                instructors.find((i) => i.id === o.data.instructorId)?.name ?? "Instructor",
              vehicle: vehicles.find((v) => v.id === o.data.vehicleId)?.plateNumber ?? "Vehicle",
              date: o.data.startedAt ?? o.data.plannedStart,
              minutes: m.minutes,
              status: m.status,
              topics: m.topics,
              note: m.note,
              response: m.response,
              reviewReason: m.reviewReason
            }))
        );
        return { ...base, summaries: own, lessons };
      }
      if (user!.role === "INSTRUCTOR") {
        const assigned = outings
          .filter((o) => o.data.instructorId === actorId)
          .map((o) => ({
            ...o,
            data: {
              ...o.data,
              salarySnapshot: undefined,
              instructorCost: undefined,
              members: o.data.members.map(({ instructorCost: _i, ...safe }) => safe)
            }
          }));
        const ids = new Set(assigned.flatMap((o) => o.data.members.map((m) => m.studentId)));
        return {
          ...base,
          outings: assigned,
          schoolRules: schoolRules
            ? { ...schoolRules, data: { ...schoolRules.data, reason: "School rules" } }
            : null,
          vehicleDocuments: vehicleDocuments.filter((v) =>
            assigned.some((o) => o.data.vehicleId === v.data.vehicleId)
          ),
          instructorPermitDates: instructorProfiles.map((i) => ({
            instructorId: i.id,
            expiresOn: i.permitExpiryDate
          })),
          instructorDocumentWarnings,
          instructors,
          vehicles: vehicles
            .filter((v) => assigned.some((o) => o.data.vehicleId === v.id))
            .map(({ id, plateNumber }) => ({ id, plateNumber })),
          students: students
            .filter((s) => ids.has(s.id))
            .map(({ id, name }) => ({ id, name, totalTuition: "0.00" }))
        };
      }
      return {
        ...base,
        schoolRules,
        vehicleDocuments,
        instructorPermitDates: instructorProfiles.map((i) => ({
          instructorId: i.id,
          expiresOn: i.permitExpiryDate
        })),
        expenses: user!.role === "OWNER" ? expenses : [],
        enrollmentSettings: user!.role === "OWNER" ? enrollmentSettings : null,
        instructorDocumentWarnings,
        packages,
        enrollments,
        settings,
        outings:
          user!.role === "OWNER"
            ? outings
            : outings.map((o) => ({
                ...o,
                data: {
                  ...o.data,
                  salarySnapshot: undefined,
                  instructorCost: undefined,
                  members: o.data.members.map(({ instructorCost: _i, ...m }) => m)
                }
              })),
        salaries: user!.role === "OWNER" ? salaries : [],
        summaries:
          user!.role === "OWNER"
            ? summaries
            : summaries.map(
                ({
                  fuelCost: _f,
                  instructorCost: _i,
                  costSoFar: _c,
                  estimatedRemainingCost: _r,
                  expectedMargin: _m,
                  otherRecordedCost: _oc,
                  otherEstimatedCost: _oe,
                  paymentsLessRecordedCosts: _pc,
                  fuelAdvanceInProgress: _fa,
                  ...safe
                }) => safe
              ),
        students: students.map(({ id, name, totalTuition, version }) => ({
          version,
          id,
          name,
          totalTuition: totalTuition.toFixed(2)
        })),
        vehicles: vehicles.map(({ id, plateNumber }) => ({ id, plateNumber })),
        instructors
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 }
  );
}
