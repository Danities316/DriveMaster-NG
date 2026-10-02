import type { Payment, PaymentMethod } from "@drivemaster/shared";
import { normalizeMoney, subtractMoney, sumMoney, ZERO_MONEY } from "@drivemaster/shared";

export interface PaymentRecord {
  id: string;
  schoolId: string;
  studentId: string;
  amount: string;
  paymentDate: string;
  method: PaymentMethod;
  currency: "NGN";
  reference: string | null;
  createdAt: string;
}

export interface CreatePaymentInput {
  id: string;
  amount: string;
  paymentDate: string;
  method: PaymentMethod;
  currency?: "NGN";
  reference?: string | null;
}

export interface PaymentDeps {
  findPaymentById: (id: string) => Promise<PaymentRecord | null>;
  createPaymentRecord: (
    schoolId: string,
    studentId: string,
    input: CreatePaymentInput
  ) => Promise<PaymentRecord>;
  findPaymentsByStudent: (schoolId: string, studentId: string) => Promise<PaymentRecord[]>;
  sumPaymentsByStudentIds: (
    studentIds: string[],
    schoolId: string
  ) => Promise<Record<string, string>>;
  findStudentById: (
    studentId: string,
    schoolId: string
  ) => Promise<{ id: string; schoolId: string; totalTuition: string } | null>;
}

export type StudentPaymentLookupResult =
  | { ok: true; payments: Payment[]; totalPaid: string; outstandingBalance: string }
  | { ok: false; reason: "NOT_FOUND" };

export type CreateStudentPaymentResult =
  | { ok: true; payment: Payment; totalPaid: string; outstandingBalance: string }
  | { ok: false; reason: "NOT_FOUND" | "ID_CONFLICT" };

function toPayment(record: PaymentRecord): Payment {
  return {
    id: record.id,
    schoolId: record.schoolId,
    studentId: record.studentId,
    amount: record.amount,
    paymentDate: record.paymentDate,
    method: record.method,
    currency: record.currency,
    reference: record.reference,
    createdAt: record.createdAt
  };
}

function matchesPaymentInput(
  record: PaymentRecord,
  studentId: string,
  input: CreatePaymentInput
): boolean {
  return (
    record.studentId === studentId &&
    normalizeMoney(record.amount) === normalizeMoney(input.amount) &&
    Date.parse(record.paymentDate) === Date.parse(input.paymentDate) &&
    record.method === input.method &&
    record.currency === (input.currency ?? "NGN") &&
    record.reference === (input.method === "CASH" ? null : (input.reference?.trim() ?? null))
  );
}

export async function listStudentPayments(
  schoolId: string,
  studentId: string,
  deps: PaymentDeps
): Promise<StudentPaymentLookupResult> {
  const student = await deps.findStudentById(studentId, schoolId);
  if (!student || student.schoolId !== schoolId) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const payments = await deps.findPaymentsByStudent(schoolId, studentId);
  const totalPaid = sumMoney(payments.map((payment) => payment.amount));
  const outstandingBalance = subtractMoney(student.totalTuition, totalPaid);

  return {
    ok: true,
    payments: payments.map((payment) => ({
      id: payment.id,
      schoolId: payment.schoolId,
      studentId: payment.studentId,
      amount: payment.amount,
      paymentDate: payment.paymentDate,
      method: payment.method,
      currency: payment.currency,
      reference: payment.reference,
      createdAt: payment.createdAt
    })),
    totalPaid,
    outstandingBalance
  };
}

export async function createStudentPayment(
  schoolId: string,
  studentId: string,
  input: CreatePaymentInput,
  deps: PaymentDeps
): Promise<CreateStudentPaymentResult> {
  const existingPayment = await deps.findPaymentById(input.id);
  if (existingPayment) {
    if (
      existingPayment.schoolId !== schoolId ||
      !matchesPaymentInput(existingPayment, studentId, input)
    ) {
      return { ok: false, reason: "ID_CONFLICT" };
    }

    const existingStudent = await deps.findStudentById(studentId, schoolId);
    if (!existingStudent || existingStudent.schoolId !== schoolId) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    const totalPaid = await deps.sumPaymentsByStudentIds([studentId], schoolId);
    return {
      ok: true,
      payment: toPayment(existingPayment),
      totalPaid: totalPaid[studentId] ?? ZERO_MONEY,
      outstandingBalance: subtractMoney(
        existingStudent.totalTuition,
        totalPaid[studentId] ?? ZERO_MONEY
      )
    };
  }

  const student = await deps.findStudentById(studentId, schoolId);
  if (!student || student.schoolId !== schoolId) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (input.method !== "CASH" && (!input.reference || input.reference.trim().length === 0)) {
    throw new Error("Reference is required for BANK_TRANSFER and POS payments.");
  }

  const payment = await deps.createPaymentRecord(schoolId, studentId, {
    ...input,
    currency: input.currency ?? "NGN",
    reference: input.method === "CASH" ? null : (input.reference ?? null)
  });
  if (payment.schoolId !== schoolId || !matchesPaymentInput(payment, studentId, input)) {
    return { ok: false, reason: "ID_CONFLICT" };
  }

  const totalPaid = await deps.sumPaymentsByStudentIds([studentId], schoolId);
  const balance = subtractMoney(student.totalTuition, totalPaid[studentId] ?? ZERO_MONEY);

  return {
    ok: true,
    payment: toPayment(payment),
    totalPaid: totalPaid[studentId] ?? ZERO_MONEY,
    outstandingBalance: balance
  };
}
