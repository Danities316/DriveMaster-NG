import { describe, expect, it } from "vitest";
import type { Payment, StudentWithBalance, OutboxMutationRecord } from "@drivemaster/shared";
import { summarize, naira } from "./dashboardData";

const now = new Date("2026-09-21T12:00:00Z");
const student: StudentWithBalance = {
  id: "s",
  schoolId: "school",
  name: "Ada",
  phone: "08012345678",
  enrollmentDate: "2026-09-01",
  totalTuition: "100000",
  amountPaid: "20000",
  balanceRemaining: "80000",
  licenseNumber: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString()
};
const payment = (id: string, amount: string, schoolId = "school"): Payment => ({
  id,
  studentId: "s",
  schoolId,
  amount,
  currency: "NGN",
  method: "CASH",
  reference: null,
  paymentDate: now.toISOString(),
  createdAt: now.toISOString()
});
const queue = (
  id: string,
  status: OutboxMutationRecord["status"] = "PENDING"
): OutboxMutationRecord => ({
  mutationId: id,
  schoolId: "school",
  deviceId: "device",
  entity: "payment",
  action: "CREATE",
  payload: {},
  retryCount: 0,
  status,
  createdAt: now.toISOString()
});
describe("dashboard financial summary", () => {
  it("excludes other schools and separates unconfirmed or conflicting payments", () => {
    const result = summarize(
      "school",
      [student, { ...student, id: "foreign", schoolId: "other" }],
      [
        payment("accepted", "20000"),
        payment("pending", "5000"),
        payment("conflict", "9000"),
        payment("foreign", "999999", "other")
      ],
      [],
      [queue("pending"), queue("conflict", "CONFLICT")],
      now
    );
    expect(result.students).toHaveLength(1);
    expect(result.todayPaid).toBe("20000.00");
    expect(result.pendingMoney).toBe("5000.00");
    expect(result.outstanding).toBe("80000.00");
    expect(result.review).toBe(1);
  });
  it("does not double count payments downloaded before their acknowledgement", () => {
    const p = payment("p", "25000");
    const result = summarize("school", [student], [p], [p], [queue("p")], now);
    expect(result.todayPaid).toBe("25000.00");
    expect(result.pendingMoney).toBe("0.00");
    expect(result.paymentRows).toHaveLength(1);
    expect(result.paymentRows[0]?.status).toBe("Confirmed");
  });
  it("uses Lagos midnight and excludes receipts outside the seven-day window", () => {
    const result = summarize(
      "school",
      [],
      [
        { ...payment("night", "100"), paymentDate: "2026-09-20T23:30:00Z" },
        { ...payment("old", "500"), paymentDate: "2026-09-14" }
      ],
      [],
      [],
      now
    );
    expect(result.todayPaid).toBe("100.00");
    expect(result.weekPaid).toBe("100.00");
    expect(result.days).toHaveLength(7);
  });
  it("does not offset another student's debt with an overpayment", () => {
    const result = summarize(
      "school",
      [student, { ...student, id: "credit", amountPaid: "200000" }],
      [],
      [],
      [],
      now
    );
    expect(result.outstanding).toBe("80000.00");
    expect(result.owing).toHaveLength(1);
  });
  it("formats large monetary totals without floating-point rounding", () => {
    expect(naira("9999999999999999.99")).toBe("₦9,999,999,999,999,999.99");
  });
});
