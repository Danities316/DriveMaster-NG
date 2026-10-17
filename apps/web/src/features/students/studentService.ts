import type {
  AuthenticatedUser,
  StudentWithBalance,
  CreateStudentRequest,
  UpdateStudentRequest
} from "@drivemaster/shared";
import { subtractMoney, isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import { db } from "../../db/db";
import { enqueue, requestSync } from "../../sync/queue";
import { StudentApiError } from "./studentApi";
import { requestTrainingSync, type QueuedTraining } from "../training/trainingLocal";

export interface CreateStudentResult {
  student: StudentWithBalance;
  queued: boolean;
}
export type UpdateStudentResult = CreateStudentResult;
export async function createStudentOffline(
  input: Omit<CreateStudentRequest, "id">,
  schoolId: string,
  stableId?: string
): Promise<CreateStudentResult> {
  validateStudent(input);
  const now = new Date().toISOString();
  const student: StudentWithBalance = {
    ...input,
    id: stableId ?? crypto.randomUUID(),
    schoolId,
    licenseNumber: input.licenseNumber ?? null,
    amountPaid: "0.00",
    balanceRemaining: input.totalTuition,
    createdAt: now,
    updatedAt: now
  };
  await db.transaction("rw", db.students, db.outbox, async () => {
    const existing = await db.students.get(student.id);
    if (existing) {
      if (existing.schoolId !== schoolId) throw new Error("Student belongs to another school.");
      return;
    }
    await db.students.add(student);
    await enqueue({
      schoolId,
      entity: "student",
      action: "CREATE",
      payload: { ...input, id: student.id }
    });
  });
  requestSync();
  return { student: (await db.students.get(student.id))!, queued: true };
}

export async function createStudentWithPackageOffline(
  input: Omit<CreateStudentRequest, "id">,
  user: AuthenticatedUser,
  packageId: string
): Promise<CreateStudentResult> {
  validateStudent(input);
  const cached = await db.trainingCache.get(user.id);
  if (
    !cached ||
    cached.schoolId !== user.schoolId ||
    cached.snapshot.viewerRole !== user.role ||
    cached.snapshot.userId !== user.id
  )
    throw new StudentApiError("Refresh Training before registering a student.", 409);
  const trainingPackage = cached.snapshot.packages.find((entry) => entry.id === packageId);
  if (!trainingPackage) throw new StudentApiError("Choose a saved training package.", 400);

  const now = new Date().toISOString();
  const student: StudentWithBalance = {
    ...input,
    totalTuition: trainingPackage.data.price,
    id: crypto.randomUUID(),
    schoolId: user.schoolId,
    licenseNumber: input.licenseNumber ?? null,
    amountPaid: "0.00",
    balanceRemaining: trainingPackage.data.price,
    createdAt: now,
    updatedAt: now
  };
  const enrollment: QueuedTraining = {
    id: crypto.randomUUID(),
    action: "ENROLL",
    targetId: crypto.randomUUID(),
    data: {
      studentId: student.id,
      packageId: trainingPackage.id,
      packageVersion: trainingPackage.version,
      studentVersion: 0,
      rulesVersion: cached.snapshot.schoolRules?.version ?? -1,
      studentName: student.name,
      totalTuition: trainingPackage.data.price
    },
    userId: user.id,
    schoolId: user.schoolId,
    role: user.role,
    createdAt: Date.now(),
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: 0
  };

  await db.transaction("rw", db.students, db.outbox, db.trainingQueue, async () => {
    await db.students.add(student);
    await enqueue({
      schoolId: user.schoolId,
      entity: "student",
      action: "CREATE",
      payload: { ...input, totalTuition: trainingPackage.data.price, id: student.id }
    });
    await db.trainingQueue.add(enrollment);
  });
  requestSync();
  requestTrainingSync();
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
export function validateStudent(input: UpdateStudentRequest): void {
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
