import type { Payment } from "@drivemaster/shared";
import { normalizeMoney, isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import { db } from "../../db/db";
import { enqueue, requestSync } from "../../sync/queue";
import { type CreatePaymentRequest, StudentApiError } from "./studentApi";

export interface RecordPaymentResult {
  payment: Payment;
  queued: boolean;
}
export async function recordStudentPaymentOffline(
  studentId: string,
  input: CreatePaymentRequest
): Promise<RecordPaymentResult> {
  if (
    !isValidStoredMoney(input.amount, true) ||
    !isValidDate(input.paymentDate) ||
    !["CASH", "BANK_TRANSFER", "POS"].includes(input.method) ||
    (input.currency !== undefined && input.currency !== "NGN") ||
    (input.method !== "CASH" && !input.reference?.trim())
  )
    throw new StudentApiError("Check the payment amount, date, method and reference.", 400);
  const result = await db.transaction("rw", db.students, db.payments, db.outbox, async () => {
    const student = await db.students.get(studentId);
    if (!student)
      throw new Error("Cannot record a payment for a student that does not exist locally.");
    const existing = await db.payments.get(input.id);
    const mutation = await db.outbox.get(input.id);
    if (existing) {
      if (
        existing.schoolId !== student.schoolId ||
        existing.studentId !== studentId ||
        normalizeMoney(existing.amount) !== normalizeMoney(input.amount) ||
        Date.parse(existing.paymentDate) !== Date.parse(input.paymentDate) ||
        existing.method !== input.method ||
        existing.reference !== (input.method === "CASH" ? null : input.reference?.trim())
      )
        throw new Error("Payment id is already used for different payment data.");
      return { payment: existing, queued: Boolean(mutation) };
    }
    if (mutation) throw new Error("Payment mutation is incomplete and cannot be replaced safely.");
    const payment: Payment = {
      ...input,
      schoolId: student.schoolId,
      studentId,
      amount: normalizeMoney(input.amount),
      currency: "NGN",
      reference: input.method === "CASH" ? null : input.reference!.trim(),
      createdAt: new Date().toISOString()
    };
    await db.payments.add(payment);
    await enqueue({
      schoolId: student.schoolId,
      mutationId: payment.id,
      entity: "payment",
      action: "CREATE",
      payload: { studentId, ...input }
    });
    return { payment, queued: true };
  });
  requestSync();
  return result;
}
export async function refreshLocalStudent(_studentId: string): Promise<void> {
  requestSync();
}
