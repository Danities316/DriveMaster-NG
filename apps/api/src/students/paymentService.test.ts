import { describe, expect, it, vi } from "vitest";
import { createStudentPayment, type PaymentDeps, type PaymentRecord } from "./paymentService.js";

const payment: PaymentRecord = {
  id: "payment-1",
  schoolId: "school-1",
  studentId: "student-1",
  amount: "25000",
  paymentDate: "2026-01-01T00:00:00.000Z",
  method: "CASH",
  currency: "NGN",
  reference: null,
  createdAt: "2026-01-01T00:00:00.000Z"
};
function deps(existing: PaymentRecord | null): PaymentDeps {
  return {
    findPaymentById: vi.fn(async () => existing),
    createPaymentRecord: vi.fn(async () => payment),
    findPaymentsByStudent: vi.fn(async () => [payment]),
    sumPaymentsByStudentIds: vi.fn(async () => ({ "student-1": "25000.00" })),
    findStudentById: vi.fn(async () => ({
      id: "student-1",
      schoolId: "school-1",
      totalTuition: "100000"
    }))
  };
}
describe("payment database normalization", () => {
  it.each([true, false])("accepts normalized persisted values on retry=%s", async (retry) => {
    const dependencies = deps(retry ? payment : null);
    const result = await createStudentPayment(
      "school-1",
      "student-1",
      {
        id: payment.id,
        amount: "25000.00",
        paymentDate: "2026-01-01T01:00:00+01:00",
        method: "CASH"
      },
      dependencies
    );
    expect(result).toMatchObject({
      ok: true,
      totalPaid: "25000.00",
      outstandingBalance: "75000.00"
    });
    expect(dependencies.createPaymentRecord).toHaveBeenCalledTimes(retry ? 0 : 1);
  });
  it("rejects different data without appending another payment", async () => {
    const dependencies = deps(payment);
    expect(
      await createStudentPayment(
        "school-1",
        "student-1",
        {
          id: payment.id,
          amount: "26000",
          paymentDate: payment.paymentDate,
          method: "CASH"
        },
        dependencies
      )
    ).toEqual({ ok: false, reason: "ID_CONFLICT" });
    expect(dependencies.createPaymentRecord).not.toHaveBeenCalled();
  });
});
