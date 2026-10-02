import type { StudentWithBalance } from "@drivemaster/shared";
import { addMoney, subtractMoney, sumMoney } from "@drivemaster/shared";
import { db } from "../../db/db";

export async function hasPendingStudent(id: string): Promise<boolean> {
  return (await db.outbox.where("entity").equals("student").toArray()).some((mutation) => {
    const payload = mutation.payload as { id?: string } | null;
    return payload?.id === id;
  });
}

/** A server response cannot replace a profile whose local changes are unacknowledged. */
export async function cacheStudents(students: StudentWithBalance[]): Promise<void> {
  await db.transaction("rw", db.students, db.outbox, async () => {
    for (const student of students) {
      const activeSchool = localStorage.getItem("drivemaster:localSchool");
      if (activeSchool && activeSchool !== student.schoolId) continue;
      const pendingPayments = await db.outbox.where("entity").equals("payment").toArray();
      const hasPendingPayments = pendingPayments.some(
        (mutation) => (mutation.payload as { studentId?: string } | null)?.studentId === student.id
      );
      // Without payment IDs, a summary response cannot tell us which queued payments it includes.
      if (!(await hasPendingStudent(student.id)) && !hasPendingPayments)
        await db.students.put(student);
    }
  });
}

/** amountPaid is the last confirmed server total; queued payments are added exactly once. */
export async function withPendingPayments(
  student: StudentWithBalance
): Promise<StudentWithBalance> {
  const payments = await db.payments.where("studentId").equals(student.id).toArray();
  const pending = await db.outbox.bulkGet(payments.map((payment) => payment.id));
  const confirmed = await db.serverPayments.bulkGet(payments.map((payment) => payment.id));
  const extra = sumMoney(
    payments
      .filter(
        (payment, index) =>
          payment.schoolId === student.schoolId &&
          pending[index]?.entity === "payment" &&
          !confirmed[index] &&
          pending[index]?.status !== "CONFLICT"
      )
      .map((payment) => payment.amount)
  );
  const amountPaid = addMoney(student.amountPaid, extra);
  return {
    ...student,
    amountPaid,
    balanceRemaining: subtractMoney(student.totalTuition, amountPaid)
  };
}
