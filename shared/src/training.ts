import { normalizeMoney, subtractMoney, sumMoney } from "./money.js";
import { lagosDay, RECORDED_DSSP_MINIMUM_DAYS, type SchoolRules } from "./schoolRules.js";
import type { EnrollmentSettings } from "./enrollment.js";
import type { TrainingExpense, VehicleDocuments } from "./operations.js";

export interface TrainingRecord<T> {
  id: string;
  version: number;
  data: T;
}
export interface TrainingPackage {
  name: string;
  sessions: number;
  minutes: number;
  price: string;
}
export interface TrainingEnrollment extends TrainingPackage {
  applicationId?: string;
  activationStatus?: "PENDING_PAYMENT" | "ACTIVE";
  schoolCompletedAt?: string;
  completionReason?: string;
  rulesSnapshot?: SchoolRules;
  studentId: string;
  packageId: string;
}
export interface TrainingSettings {
  fuelPerStudent: string;
  reason: string;
}
export interface InstructorSalary {
  instructorId: string;
  month: string;
  salary: string;
  teachingHours: number;
}
export type LessonStatus =
  "BOOKED" | "DRIVING" | "MISSED" | "PENDING" | "CONFIRMED" | "DISPUTED" | "VOID";
export interface TrainingMember {
  studentId: string;
  enrollmentId: string;
  status: LessonStatus;
  minutes: number;
  topics?: string;
  note?: string;
  response?: string;
  respondedAt?: string;
  reviewReason?: string;
  fuelCost?: string;
  instructorCost?: string;
}
export interface TrainingOuting {
  instructorId: string;
  vehicleId: string;
  plannedStart: string;
  plannedEnd: string;
  status: "BOOKED" | "STARTED" | "COMPLETED" | "CANCELLED";
  members: TrainingMember[];
  fuelPerStudent: string;
  allowanceReason: string;
  startedAt?: string;
  endedAt?: string;
  startOdometer?: number;
  endOdometer?: number;
  fuelIssued?: string;
  fuelSpent?: string;
  fuelReturned?: string;
  fuelReturnReason?: string;
  fuelSpendingBasis?: "REPORTED" | "LEGACY_ALLOWANCE";
  fuelLogId?: string;
  salarySnapshot?: InstructorSalary;
  instructorCost?: string;
  changeReason?: string;
}
export interface StudentTrainingSummary {
  qualifyingDays?: number;
  schoolTargetMet?: boolean;
  dsspMinimumMet?: boolean;
  activationStatus?: "PENDING_PAYMENT" | "ACTIVE";
  schoolCompletedAt?: string;
  schoolTargetDays?: number;
  studentId: string;
  name: string;
  packageName: string;
  sessions: number;
  confirmed: number;
  awaiting: number;
  disputed: number;
  booked: number;
  remaining: number;
  fee: string;
  paid: string;
  balance: string;
  fuelCost?: string;
  instructorCost?: string;
  costSoFar?: string;
  estimatedRemainingCost?: string;
  expectedMargin?: string;
  otherRecordedCost?: string;
  otherEstimatedCost?: string;
  paymentsLessRecordedCosts?: string;
  fuelAdvanceInProgress?: string;
}
export interface StudentLessonView {
  outingId: string;
  version: number;
  instructor: string;
  vehicle: string;
  date: string;
  minutes: number;
  status: LessonStatus;
  topics?: string;
  note?: string;
  response?: string;
  reviewReason?: string;
}
export interface TrainingSnapshot {
  vehicleDocuments?: TrainingRecord<VehicleDocuments>[];
  instructorPermitDates?: { instructorId: string; expiresOn: string | null }[];
  expenses?: TrainingRecord<TrainingExpense>[];
  enrollmentSettings?: TrainingRecord<EnrollmentSettings> | null;
  schoolRules?: TrainingRecord<SchoolRules> | null;
  instructorDocumentWarnings?: { instructorId: string; message: string; blocked: boolean }[];
  viewerRole: string;
  userId: string;
  schoolId: string;
  packages: TrainingRecord<TrainingPackage>[];
  enrollments: TrainingRecord<TrainingEnrollment>[];
  settings: TrainingRecord<TrainingSettings> | null;
  salaries: TrainingRecord<InstructorSalary>[];
  outings: TrainingRecord<TrainingOuting>[];
  students: { id: string; name: string; totalTuition: string; version?: number }[];
  instructors: { id: string; name: string }[];
  vehicles: { id: string; plateNumber: string }[];
  summaries: StudentTrainingSummary[];
  lessons: StudentLessonView[];
}
export interface TrainingCommand {
  id: string;
  action: string;
  targetId: string;
  expectedVersion?: number;
  data: unknown;
}
export const moneyCents = (value: string): bigint => BigInt(normalizeMoney(value).replace(".", ""));
export function centsMoney(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export function multiplyTrainingMoney(value: string, count: number): string {
  return centsMoney(moneyCents(value) * BigInt(count));
}
export function instructorTimeCost(salary: InstructorSalary, minutes: number): string {
  const denominator = BigInt(salary.teachingHours * 60);
  return centsMoney((moneyCents(salary.salary) * BigInt(minutes) + denominator / 2n) / denominator);
}
export function splitTrainingMoney(value: string, count: number): string[] {
  const amount = moneyCents(value),
    divisor = BigInt(count);
  return Array.from({ length: count }, (_, i) =>
    centsMoney(amount / divisor + (BigInt(i) < amount % divisor ? 1n : 0n))
  );
}
export function trainingSummary(
  enrollment: TrainingEnrollment,
  name: string,
  paid: string,
  outings: TrainingOuting[],
  futureFuel: string,
  futureInstructor: string,
  expenses: TrainingExpense[] = []
): StudentTrainingSummary {
  const members = outings
    .flatMap((row) => row.members)
    .filter((row) => row.studentId === enrollment.studentId);
  const count = (status: LessonStatus) => members.filter((row) => row.status === status).length;
  const confirmed = count("CONFIRMED"),
    awaiting = count("PENDING"),
    disputed = count("DISPUTED");
  const used = confirmed + awaiting + disputed;
  const qualifyingDays = new Set(
    outings
      .filter(
        (o) =>
          o.status === "COMPLETED" &&
          o.startedAt &&
          o.endedAt &&
          Date.parse(o.endedAt) >= Date.parse(o.startedAt) &&
          o.members.some(
            (m) =>
              m.studentId === enrollment.studentId && m.status === "CONFIRMED" && m.minutes >= 30
          )
      )
      .map((o) => lagosDay(o.startedAt!))
  ).size;
  const schoolTargetDays = enrollment.rulesSnapshot?.schoolTargetDays ?? 26;
  const remaining = Math.max(0, enrollment.sessions - used);
  const fuelCost = sumMoney(
    outings
      .filter((o) => o.status !== "STARTED")
      .flatMap((o) => o.members)
      .filter((m) => m.studentId === enrollment.studentId)
      .map((row) => row.fuelCost ?? "0.00")
  );
  const fuelAdvanceInProgress = sumMoney(
    outings
      .filter((o) => o.status === "STARTED")
      .flatMap((o) => o.members)
      .filter((m) => m.studentId === enrollment.studentId && m.status === "DRIVING")
      .map((row) => row.fuelCost ?? "0.00")
  );
  const expenseTotal = (basis: TrainingExpense["basis"]) =>
    sumMoney(
      expenses
        .filter((e) => !e.voidReason && e.basis === basis)
        .flatMap((e) => e.allocations)
        .filter((a) => a.studentId === enrollment.studentId)
        .map((a) => a.amount)
    );
  const otherRecordedCost = expenseTotal("RECORDED"),
    otherEstimatedCost = expenseTotal("ESTIMATE");
  const instructorCost = sumMoney(members.map((row) => row.instructorCost ?? "0.00"));
  const costSoFar = sumMoney([fuelCost, instructorCost, otherRecordedCost]);
  // Started lessons have issued fuel, but their instructor allocation arrives at completion.
  const driving = count("DRIVING");
  const estimatedRemainingCost = sumMoney([
    multiplyTrainingMoney(futureFuel, Math.max(0, remaining - driving)),
    fuelAdvanceInProgress,
    multiplyTrainingMoney(futureInstructor, remaining)
  ]);
  return {
    studentId: enrollment.studentId,
    schoolTargetDays,
    qualifyingDays,
    schoolTargetMet: qualifyingDays >= schoolTargetDays,
    dsspMinimumMet: qualifyingDays >= RECORDED_DSSP_MINIMUM_DAYS,
    activationStatus: enrollment.activationStatus ?? "ACTIVE",
    schoolCompletedAt: enrollment.schoolCompletedAt,
    name,
    packageName: enrollment.name,
    sessions: enrollment.sessions,
    confirmed,
    awaiting,
    disputed,
    booked: count("BOOKED") + driving,
    remaining,
    fee: enrollment.price,
    paid,
    balance: subtractMoney(enrollment.price, paid),
    fuelCost,
    instructorCost,
    otherRecordedCost,
    otherEstimatedCost,
    paymentsLessRecordedCosts: subtractMoney(paid, costSoFar),
    fuelAdvanceInProgress,
    costSoFar,
    estimatedRemainingCost,
    expectedMargin: subtractMoney(
      enrollment.price,
      sumMoney([costSoFar, estimatedRemainingCost, otherEstimatedCost])
    )
  };
}
