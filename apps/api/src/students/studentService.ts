import type { StudentWithBalance } from "@drivemaster/shared";
import { normalizeMoney, subtractMoney, sumMoney, ZERO_MONEY } from "@drivemaster/shared";
import { KnownApiError } from "../middleware/errorHandler.js";

/**
 * Internal shape of a student record, distinct from the Prisma-generated
 * type and from the shared `Student`/`StudentWithBalance` contracts —
 * same pattern as `UserRecordForAuth` in auth/authService.ts. This is
 * what a repository implementation returns; `toStudentWithBalance` below
 * adds the computed financial fields for the client-facing shape.
 */
export interface StudentRecord {
  id: string;
  schoolId: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  enrollmentDate: string;
  totalTuition: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudentInput {
  id: string;
  name: string;
  phone: string;
  licenseNumber?: string | null;
  enrollmentDate: string;
  totalTuition: string;
}

export type UpdateStudentInput = Partial<Omit<CreateStudentInput, "id">>;

export interface ListStudentsQuery {
  search?: string;
  limit: number;
  offset: number;
}

/**
 * Injected dependencies, mirroring auth/authService.ts's `AuthDeps`
 * pattern: this lets the business logic below be fully unit-tested with
 * an in-memory fake, independent of whether a live PostgreSQL connection
 * is available (see studentRepository.ts for why that matters here).
 */
export interface StudentDeps {
  createStudentRecord: (schoolId: string, input: CreateStudentInput) => Promise<StudentRecord>;
  findStudentById: (id: string, schoolId: string) => Promise<StudentRecord | null>;
  findStudentsBySchool: (
    schoolId: string,
    query: ListStudentsQuery
  ) => Promise<{ students: StudentRecord[]; total: number }>;
  updateStudentRecord: (
    id: string,
    patch: UpdateStudentInput,
    schoolId: string
  ) => Promise<StudentRecord>;
  /** Sum of Payment.amount per student id. Missing keys mean "no payments yet". */
  sumPaymentsByStudentIds: (
    studentIds: string[],
    schoolId: string
  ) => Promise<Record<string, string>>;
}

function toStudentWithBalance(record: StudentRecord, amountPaid: string): StudentWithBalance {
  return {
    ...record,
    amountPaid,
    balanceRemaining: subtractMoney(record.totalTuition, amountPaid)
  };
}

export async function createStudent(
  schoolId: string,
  input: CreateStudentInput,
  deps: StudentDeps
): Promise<StudentWithBalance> {
  const existing = await deps.findStudentById(input.id, schoolId);
  const record = existing ?? (await deps.createStudentRecord(schoolId, input));
  if (
    record.schoolId !== schoolId ||
    record.name !== input.name ||
    record.phone !== input.phone ||
    record.licenseNumber !== (input.licenseNumber ?? null) ||
    Date.parse(record.enrollmentDate) !== Date.parse(input.enrollmentDate) ||
    normalizeMoney(record.totalTuition) !== normalizeMoney(input.totalTuition)
  ) {
    throw new KnownApiError("Student id is already used for different data.", 409, "ID_CONFLICT");
  }
  const sums = await deps.sumPaymentsByStudentIds([record.id], schoolId);
  return toStudentWithBalance(record, sums[record.id] ?? ZERO_MONEY);
}

export async function listStudents(
  schoolId: string,
  query: ListStudentsQuery,
  deps: StudentDeps
): Promise<{ students: StudentWithBalance[]; total: number }> {
  const { students, total } = await deps.findStudentsBySchool(schoolId, query);
  const sums = await deps.sumPaymentsByStudentIds(
    students.map((student) => student.id),
    schoolId
  );
  return {
    students: students.map((student) =>
      toStudentWithBalance(student, sums[student.id] ?? ZERO_MONEY)
    ),
    total
  };
}

export type StudentLookupResult =
  { ok: true; student: StudentWithBalance } | { ok: false; reason: "NOT_FOUND" };

/**
 * Looks up a student and enforces tenant isolation in one step: a
 * student that exists but belongs to a different school produces the
 * SAME "NOT_FOUND" result as a student that doesn't exist at all. The
 * route layer maps this to a 404 either way, so a cross-school request
 * never learns whether the id exists in another school (PRD/Unit 2:
 * never confirm existence of another tenant's resource).
 */
export async function getStudent(
  schoolId: string,
  studentId: string,
  deps: StudentDeps
): Promise<StudentLookupResult> {
  const record = await deps.findStudentById(studentId, schoolId);
  if (!record || record.schoolId !== schoolId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  const sums = await deps.sumPaymentsByStudentIds([record.id], schoolId);
  return { ok: true, student: toStudentWithBalance(record, sums[record.id] ?? ZERO_MONEY) };
}

export async function updateStudent(
  schoolId: string,
  studentId: string,
  patch: UpdateStudentInput,
  deps: StudentDeps
): Promise<StudentLookupResult> {
  const existing = await deps.findStudentById(studentId, schoolId);
  if (!existing || existing.schoolId !== schoolId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  const updated = await deps.updateStudentRecord(studentId, patch, schoolId);
  const sums = await deps.sumPaymentsByStudentIds([updated.id], schoolId);
  return { ok: true, student: toStudentWithBalance(updated, sums[updated.id] ?? ZERO_MONEY) };
}

// Re-exported so tests can build sums without importing money.ts directly
// for this one convenience — the actual computation stays in money.ts.
export { sumMoney };
