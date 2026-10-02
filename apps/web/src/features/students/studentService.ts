import type {
  StudentWithBalance,
  CreateStudentRequest,
  UpdateStudentRequest
} from "@drivemaster/shared";
import { subtractMoney, isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import { db } from "../../db/db";
import { enqueue, requestSync } from "../../sync/queue";
import { StudentApiError } from "./studentApi";

export interface CreateStudentResult {
  student: StudentWithBalance;
  queued: boolean;
}
export type UpdateStudentResult = CreateStudentResult;
export async function createStudentOffline(
  input: Omit<CreateStudentRequest, "id">,
  schoolId: string
): Promise<CreateStudentResult> {
  validateStudent(input);
  const now = new Date().toISOString();
  const student: StudentWithBalance = {
    ...input,
    id: crypto.randomUUID(),
    schoolId,
    licenseNumber: input.licenseNumber ?? null,
    amountPaid: "0.00",
    balanceRemaining: input.totalTuition,
    createdAt: now,
    updatedAt: now
  };
  await db.transaction("rw", db.students, db.outbox, async () => {
    await db.students.add(student);
    await enqueue({
      schoolId,
      entity: "student",
      action: "CREATE",
      payload: { ...input, id: student.id }
    });
  });
  requestSync();
  return { student, queued: true };
}
export async function updateStudentOffline(
  id: string,
  patch: UpdateStudentRequest
): Promise<UpdateStudentResult> {
  validateStudent(patch);
  const student = await db.transaction(
    "rw",
    db.students,
    db.serverStudents,
    db.outbox,
    async () => {
      const existing = await db.students.get(id);
      if (!existing) throw new Error("Cannot update a student that does not exist locally.");
      const remote = await db.serverStudents.get(id);
      const updated: StudentWithBalance = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
        balanceRemaining: subtractMoney(
          patch.totalTuition ?? existing.totalTuition,
          existing.amountPaid
        )
      };
      await db.students.put(updated);
      await enqueue({
        schoolId: existing.schoolId,
        entity: "student",
        action: "UPDATE",
        payload: { id, ...patch },
        expectedVersion: remote?.version ?? existing.version
      });
      return updated;
    }
  );
  requestSync();
  return { student, queued: true };
}
export async function refreshStudentsFromServer(): Promise<void> {
  requestSync();
}
function validateStudent(input: UpdateStudentRequest): void {
  if (
    (input.name !== undefined && !input.name.trim()) ||
    (input.phone !== undefined &&
      (input.phone.trim().length < 7 || input.phone.trim().length > 20)) ||
    (input.totalTuition !== undefined && !isValidStoredMoney(input.totalTuition)) ||
    (input.enrollmentDate !== undefined && !isValidDate(input.enrollmentDate))
  )
    throw new StudentApiError(
      "Please check the student name, phone, date and tuition amount.",
      400
    );
}
