import { getPrismaClient } from "../prisma.js";
import { addMoney, ZERO_MONEY } from "@drivemaster/shared";
import type { PaymentRecord, CreatePaymentInput } from "./paymentService.js";

interface PrismaPaymentRow {
  id: string;
  schoolId: string;
  studentId: string;
  amount: { toString(): string };
  paymentDate: Date;
  method: string;
  currency: string;
  reference: string | null;
  createdAt: Date;
}

function toPaymentRecord(row: PrismaPaymentRow): PaymentRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentId,
    amount: row.amount.toString(),
    paymentDate: row.paymentDate.toISOString(),
    method: row.method as PaymentRecord["method"],
    currency: row.currency as PaymentRecord["currency"],
    reference: row.reference,
    createdAt: row.createdAt.toISOString()
  };
}

export async function createPaymentRecord(
  schoolId: string,
  studentId: string,
  input: CreatePaymentInput
): Promise<PaymentRecord> {
  const prisma = getPrismaClient();
  try {
    const created = await prisma.payment.create({
      data: {
        id: input.id,
        schoolId,
        studentId,
        amount: input.amount,
        paymentDate: new Date(input.paymentDate),
        method: input.method,
        currency: input.currency ?? "NGN",
        reference: input.method === "CASH" ? null : (input.reference ?? null)
      }
    });

    return toPaymentRecord(created as unknown as PrismaPaymentRow);
  } catch (error) {
    // A concurrent retry may win the unique primary-key race. Returning the
    // stored row lets the service perform its normal tenant/payload check.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      const existing = await findPaymentById(input.id);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

export async function findPaymentById(id: string): Promise<PaymentRecord | null> {
  const prisma = getPrismaClient();
  const payment = await prisma.payment.findUnique({ where: { id } });
  return payment ? toPaymentRecord(payment as unknown as PrismaPaymentRow) : null;
}

export async function findPaymentsByStudent(
  schoolId: string,
  studentId: string
): Promise<PaymentRecord[]> {
  const prisma = getPrismaClient();
  const payments = await prisma.payment.findMany({
    where: { schoolId, studentId },
    orderBy: { paymentDate: "desc" }
  });

  return (payments as unknown as PrismaPaymentRow[]).map(toPaymentRecord);
}

export async function sumPaymentsByStudentIds(
  studentIds: string[],
  schoolId: string
): Promise<Record<string, string>> {
  if (studentIds.length === 0) {
    return {};
  }

  const prisma = getPrismaClient();
  const payments = await prisma.payment.findMany({
    where: { schoolId, studentId: { in: studentIds } },
    select: { studentId: true, amount: true }
  });

  const sums: Record<string, string> = {};
  for (const payment of payments as { studentId: string; amount: { toString(): string } }[]) {
    const amount = payment.amount.toString();
    sums[payment.studentId] = addMoney(sums[payment.studentId] ?? ZERO_MONEY, amount);
  }
  return sums;
}
