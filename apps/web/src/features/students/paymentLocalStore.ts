import type { Payment } from "@drivemaster/shared";
import { subtractMoney } from "@drivemaster/shared";
import { db } from "../../db/db";
import { withPendingPayments } from "./localConsistency";

export interface LocalStudentPaymentHistory {
  payments: Payment[];
  totalPaid: string;
  outstandingBalance: string;
  queuedPaymentIds: string[];
  conflictPaymentIds: string[];
}

export async function getLocalStudentPaymentHistory(
  studentId: string
): Promise<LocalStudentPaymentHistory | null> {
  const student = await db.students.get(studentId);
  if (!student) {
    return null;
  }

  const payments = (await db.payments.where("studentId").equals(studentId).toArray()).filter(
    (payment) => payment.schoolId === student.schoolId
  );
  const queuedMutations = await db.outbox
    .where("entity")
    .equals("payment")
    .filter((mutation) => mutation.action === "CREATE")
    .toArray();
  const queuedPaymentIds = queuedMutations
    .map((mutation) => mutation.mutationId)
    .filter((id) => payments.some((payment) => payment.id === id));
  const balance = await withPendingPayments(student);
  const totalPaid = balance.amountPaid;

  return {
    payments: payments.sort(
      (first, second) =>
        new Date(second.paymentDate).getTime() - new Date(first.paymentDate).getTime()
    ),
    totalPaid,
    outstandingBalance: subtractMoney(student.totalTuition, totalPaid),
    queuedPaymentIds,
    conflictPaymentIds: queuedMutations
      .filter((mutation) => mutation.status === "CONFLICT")
      .map((mutation) => mutation.mutationId)
  };
}
