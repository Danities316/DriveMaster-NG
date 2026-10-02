import type {
  OutboxMutationRecord,
  Student,
  StudentWithBalance,
  SyncChange,
  SyncResult
} from "@drivemaster/shared";
import { subtractMoney, sumMoney } from "@drivemaster/shared";
import { db } from "../db/db";
import { ordered, studentIdOf } from "./queue";

/** Rebuild the visible profile from confirmed data plus the ordered local edits. */
export async function projectStudent(id: string, complete: boolean): Promise<void> {
  const existing = await db.students.get(id);
  const remote = await db.serverStudents.get(id);
  const pending = ordered(
    (await db.outbox.where("entity").equals("student").toArray()).filter(
      (entry) => studentIdOf(entry) === id
    )
  );
  let profile: Student | undefined = remote ?? existing;
  for (const entry of pending) {
    const data = entry.payload as Partial<Student>;
    if (profile)
      profile = {
        ...profile,
        ...data,
        id: profile.id,
        schoolId: profile.schoolId,
        version: remote?.version ?? profile.version
      };
  }
  if (!profile) return;
  const confirmed = (await db.serverPayments.where("studentId").equals(id).toArray()).filter(
    (payment) => payment.schoolId === profile!.schoolId
  );
  const amountPaid = complete
    ? sumMoney(confirmed.map((payment) => payment.amount))
    : (existing?.amountPaid ?? "0.00");
  const student: StudentWithBalance = {
    ...profile,
    amountPaid,
    balanceRemaining: subtractMoney(profile.totalTuition, amountPaid)
  };
  await db.students.put(student);
}

export async function storeResult(result: SyncResult): Promise<void> {
  if (result.vehicle) {
    const existing = await db.vehicles.get(result.vehicle.id);
    if (!existing || (result.vehicle.benchmarkVersion ?? 0) >= (existing.benchmarkVersion ?? 0))
      await db.vehicles.put(result.vehicle);
  }
  if (result.fuelLog) await db.fuelLogs.put(result.fuelLog);
  if (result.mileageLog) await db.mileageLogs.put(result.mileageLog);
  if (result.student) {
    const existing = await db.serverStudents.get(result.student.id);
    if (!existing || (result.student.version ?? 0) >= (existing.version ?? 0))
      await db.serverStudents.put(result.student);
  }
  if (result.payment) {
    await db.serverPayments.put(result.payment);
    const pending = await db.outbox.get(result.payment.id);
    if (!pending || pending.mutationId === result.mutationId) await db.payments.put(result.payment);
  }
}

export async function storeChange(change: SyncChange): Promise<void> {
  if (
    change.entity === "vehicle" ||
    change.entity === "fuel_log" ||
    change.entity === "mileage_log"
  ) {
    const table =
      change.entity === "vehicle"
        ? db.vehicles
        : change.entity === "fuel_log"
          ? db.fuelLogs
          : db.mileageLogs;
    const pending = await db.outbox.get(change.record.id);
    if (pending) return;
    if (change.action === "DELETE") await table.delete(change.record.id);
    else if (change.entity === "vehicle")
      await storeResult({ mutationId: "", vehicle: change.record });
    else if (change.entity === "fuel_log") await db.fuelLogs.put(change.record);
    else await db.mileageLogs.put(change.record);
    return;
  }
  if (change.action !== "DELETE") {
    await storeResult({
      mutationId: "",
      ...(change.entity === "student" ? { student: change.record } : { payment: change.record })
    });
    return;
  }
  if (change.entity === "payment") {
    await db.serverPayments.delete(change.record.id);
    if (!(await db.outbox.get(change.record.id))) await db.payments.delete(change.record.id);
  } else {
    await db.serverStudents.delete(change.record.id);
    const pending = (await db.outbox.toArray()).filter(
      (entry) => studentIdOf(entry) === change.record.id
    );
    if (!pending.length) await db.students.delete(change.record.id);
    for (const entry of pending)
      await db.outbox.update(entry.mutationId, {
        status: "CONFLICT",
        lastError: "This student was removed on the server. Contact your school administrator."
      });
  }
}
export async function rebaseDependents(
  entry: OutboxMutationRecord,
  result: SyncResult
): Promise<void> {
  for (const next of await db.outbox.toArray()) {
    if (next.dependsOn === entry.mutationId)
      await db.outbox.update(next.mutationId, {
        dependsOn: undefined,
        ...(next.entity === "student" && next.action === "UPDATE" && result.student
          ? { expectedVersion: result.student.version }
          : {})
      });
  }
}
