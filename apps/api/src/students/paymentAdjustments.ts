import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Payment as DbPayment, Prisma } from "@prisma/client";
import { isValidStoredMoney, normalizeMoney, sumMoney, subtractMoney } from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";

const positive = z
  .string()
  .trim()
  .refine((v) => isValidStoredMoney(v, true));
export const adjustmentSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    action: z.enum(["CORRECT", "REVERSE", "REFUND", "UNDO_REFUND"]),
    reason: z.string().trim().min(5).max(500),
    amount: positive.optional(),
    studentId: z.string().uuid().optional(),
    method: z.enum(["CASH", "BANK_TRANSFER", "POS"]).optional(),
    reference: z.string().trim().max(150).optional(),
    paymentDate: z.string().datetime({ offset: true }).optional()
  })
  .superRefine((v, ctx) => {
    if ((v.action === "CORRECT" || v.action === "REFUND") && !v.amount)
      ctx.addIssue({ code: "custom", message: "Enter a positive amount." });
    if (
      v.action === "CORRECT" &&
      (!v.studentId || !v.method || !v.paymentDate || (v.method !== "CASH" && !v.reference))
    )
      ctx.addIssue({
        code: "custom",
        message: "Provide the corrected student, method, date and payment reference."
      });
  });
const fail = (message: string, status = 409, code = "PAYMENT_ADJUSTMENT_ERROR"): never => {
  throw new KnownApiError(message, status, code);
};
export const paymentJson = (p: DbPayment) => ({
  ...p,
  amount: p.amount.toFixed(2),
  paymentDate: p.paymentDate.toISOString(),
  createdAt: p.createdAt.toISOString()
});
async function review(tx: Prisma.TransactionClient, schoolId: string, paymentId: string) {
  const target = await tx.payment.findFirst({ where: { id: paymentId, schoolId } });
  if (!target || !["PAYMENT", "REFUND"].includes(target.entryType)) fail("Payment not found.", 404);
  const root =
    target!.entryType === "REFUND"
      ? await tx.payment.findFirst({
          where: { id: target!.originalPaymentId!, schoolId, entryType: "PAYMENT" }
        })
      : target;
  if (!root) fail("Original payment not found.", 404);
  const refunds = await tx.payment.findMany({
    where: { schoolId, originalPaymentId: root!.id, entryType: "REFUND" }
  });
  const rows = await tx.payment.findMany({
    where: {
      schoolId,
      OR: [{ originalPaymentId: root!.id }, { originalPaymentId: { in: refunds.map((p) => p.id) } }]
    }
  });
  const netRefund = sumMoney(
    rows
      .filter((p) => ["REFUND", "REFUND_REVERSAL"].includes(p.entryType))
      .map((p) => p.amount.toFixed(2))
  );
  const reversed = rows.some((p) => p.entryType === "REVERSAL");
  const undone = rows.some(
    (p) => p.entryType === "REFUND_REVERSAL" && p.originalPaymentId === target!.id
  );
  const revision = await tx.paymentAdjustment.count({
    where: { schoolId, rootPaymentId: root!.id }
  });
  return {
    target: target!,
    root: root!,
    rows,
    netRefund,
    reversed,
    undone,
    revision,
    refundable: reversed ? "0.00" : sumMoney([root!.amount.toFixed(2), netRefund])
  };
}
export async function reviewPayment(schoolId: string, paymentId: string) {
  return getPrismaClient().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    const r = await review(tx, schoolId, paymentId);
    return {
      payment: paymentJson(r.target),
      revision: r.revision,
      refundable: r.refundable,
      reversed: r.reversed,
      refunded: r.netRefund !== "0.00",
      undone: r.undone,
      history: r.rows.map(paymentJson)
    };
  });
}
export async function adjustPayment(
  schoolId: string,
  userId: string,
  paymentId: string,
  input: z.infer<typeof adjustmentSchema>,
  studentId?: string
) {
  input = adjustmentSchema.parse(input);
  const hash = createHash("sha256")
    .update(JSON.stringify([schoolId, userId, paymentId, input]))
    .digest("hex");
  return getPrismaClient().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    const actor = await tx.user.findFirst({
      where: {
        id: userId,
        schoolId,
        role: "OWNER",
        isActive: true,
        phoneVerificationRequired: false,
        school: { status: { in: ["ACTIVE", "TRIAL"] } }
      }
    });
    if (!actor) fail("Sign in as an active school owner.", 403);
    const existing = await tx.paymentAdjustment.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.schoolId !== schoolId || existing.requestHash !== hash)
        fail(
          "This request id has already been used for different details.",
          409,
          "ADJUSTMENT_ID_CONFLICT"
        );
      return {
        payments: (
          await tx.payment.findMany({
            where: { schoolId, adjustmentId: input.id },
            orderBy: { id: "asc" }
          })
        ).map(paymentJson)
      };
    }
    const r = await review(tx, schoolId, paymentId);
    if (studentId && r.target.studentId !== studentId) fail("Payment not found.", 404);
    if (input.revision !== r.revision) fail("Payment history changed. Close and review it again.");
    const undo = input.action === "UNDO_REFUND";
    if (
      undo
        ? r.target.entryType !== "REFUND" || r.undone || r.reversed
        : r.target.entryType !== "PAYMENT" || r.reversed
    )
      fail("This entry cannot be adjusted again.");
    if (["CORRECT", "REVERSE"].includes(input.action) && r.netRefund !== "0.00")
      fail(
        "This payment has refunds. Undo mistaken refund records before correcting or reversing it."
      );
    if (input.action === "REFUND" && Number(subtractMoney(input.amount!, r.refundable)) > 0)
      fail("Refund exceeds the amount remaining on this payment.");
    const replacementStudentId = input.action === "CORRECT" ? input.studentId! : r.root.studentId;
    if (!(await tx.student.findFirst({ where: { id: replacementStudentId, schoolId } })))
      fail("Student not found.", 404);
    await tx.paymentAdjustment.create({
      data: {
        id: input.id,
        schoolId,
        rootPaymentId: r.root.id,
        requestHash: hash,
        createdById: userId
      }
    });
    const base = {
      schoolId,
      studentId: r.root.studentId,
      currency: "NGN",
      adjustmentId: input.id,
      reason: input.reason,
      recordedById: userId,
      paymentDate: ["CORRECT", "REVERSE"].includes(input.action) ? r.root.paymentDate : new Date(),
      method: r.target.method,
      reference: r.target.reference
    };
    const entries: DbPayment[] = [];
    entries.push(
      await tx.payment.create({
        data: {
          ...base,
          id: randomUUID(),
          originalPaymentId: r.target.id,
          entryType: undo ? "REFUND_REVERSAL" : input.action === "REFUND" ? "REFUND" : "REVERSAL",
          amount: undo
            ? r.target.amount.abs()
            : `-${normalizeMoney(input.action === "REFUND" ? input.amount! : r.root.amount.toFixed(2))}`
        }
      })
    );
    if (input.action === "CORRECT")
      entries.push(
        await tx.payment.create({
          data: {
            ...base,
            id: randomUUID(),
            studentId: replacementStudentId,
            originalPaymentId: r.root.id,
            entryType: "PAYMENT",
            amount: normalizeMoney(input.amount!),
            paymentDate: new Date(input.paymentDate!),
            method: input.method!,
            reference: input.method === "CASH" ? null : input.reference!
          }
        })
      );
    await tx.auditLog.create({
      data: {
        schoolId,
        userId,
        action: input.action,
        entity: "PAYMENT",
        entityId: r.root.id,
        metadata: {
          adjustmentId: input.id,
          reason: input.reason,
          entries: entries.map(paymentJson)
        }
      }
    });
    return { payments: entries.sort((a, b) => a.id.localeCompare(b.id)).map(paymentJson) };
  });
}
