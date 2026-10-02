import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { recordStudentPaymentOffline } from "./paymentService";
import { getLocalStudentPaymentHistory } from "./paymentLocalStore";
const student = {
  id: "s",
  schoolId: "school",
  name: "Ada",
  phone: "08012345678",
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00",
  amountPaid: "40000.00",
  balanceRemaining: "60000.00",
  licenseNumber: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01"
};
const payment = { id: "p", amount: "10000", paymentDate: "2026-01-02", method: "CASH" as const };
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  await db.students.put(student);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("local payment commands", () => {
  it("stores payment and complete queue payload atomically without direct delivery", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await recordStudentPaymentOffline("s", payment)).queued).toBe(true);
    expect(await db.outbox.get("p")).toMatchObject({
      schoolId: "school",
      entity: "payment",
      action: "CREATE",
      status: "PENDING",
      retryCount: 0,
      payload: { ...payment, studentId: "s" }
    });
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("50000.00");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("deduplicates equivalent decimal and date representations locally", async () => {
    await recordStudentPaymentOffline("s", payment);
    await recordStudentPaymentOffline("s", {
      ...payment,
      amount: "10000.00",
      paymentDate: "2026-01-02T00:00:00.000Z"
    });
    expect(await db.payments.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });
  it("rejects reused payment IDs with different details", async () => {
    await recordStudentPaymentOffline("s", payment);
    await expect(recordStudentPaymentOffline("s", { ...payment, amount: "20000" })).rejects.toThrow(
      "different payment data"
    );
    expect((await db.payments.get("p"))?.amount).toBe("10000.00");
  });
  it("rejects missing student and non-cash reference", async () => {
    await expect(recordStudentPaymentOffline("unknown", payment)).rejects.toThrow();
    await expect(recordStudentPaymentOffline("s", { ...payment, method: "POS" })).rejects.toThrow();
    expect(await db.outbox.count()).toBe(0);
  });
  it("rejects invalid dates and amounts before persistence", async () => {
    await expect(recordStudentPaymentOffline("s", { ...payment, amount: "0" })).rejects.toThrow();
    await expect(
      recordStudentPaymentOffline("s", { ...payment, paymentDate: "2026-02-30" })
    ).rejects.toThrow();
    expect(await db.payments.count()).toBe(0);
  });
  it("rolls back payment storage if enqueue fails", async () => {
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("quota"));
    await expect(recordStudentPaymentOffline("s", payment)).rejects.toThrow("quota");
    expect(await db.payments.count()).toBe(0);
  });
});
