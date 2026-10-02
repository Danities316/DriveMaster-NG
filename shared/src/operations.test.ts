import { expect, it } from "vitest";
import { expiryReminder, schoolDocumentReminders, type TrainingExpense } from "./operations.js";
import { trainingSummary, type TrainingOuting } from "./training.js";
it("warns at the reminder boundary and only blocks after expiry or for missing dates", () => {
  expect(expiryReminder("v", "Insurance", "2026-02-01", 30, "BLOCK", "2026-01-01")).toBeNull();
  expect(expiryReminder("v", "Insurance", "2026-01-31", 30, "BLOCK", "2026-01-01")).toMatchObject({
    daysLeft: 30,
    blocked: false
  });
  expect(expiryReminder("v", "Insurance", "2026-01-01", 0, "BLOCK", "2026-01-01")).toMatchObject({
    daysLeft: 0,
    blocked: false
  });
  expect(expiryReminder("v", "Insurance", "2025-12-31", 0, "BLOCK", "2026-01-01")).toMatchObject({
    status: "EXPIRED",
    blocked: true
  });
  expect(expiryReminder("v", "Insurance", null, 30, "WARN", "2026-01-01")).toMatchObject({
    status: "MISSING",
    blocked: false
  });
  expect(expiryReminder("v", "Insurance", null, 30, "BLOCK", "2026-01-01")).toMatchObject({
    blocked: true
  });
});
it("uses Lagos dates and does not invent missing documents for legacy offline snapshots", () => {
  expect(
    schoolDocumentReminders({ instructors: [], vehicles: [{ id: "v", plateNumber: "ABC" }] })
  ).toEqual([]);
  expect(
    schoolDocumentReminders(
      {
        instructors: [{ id: "i", name: "Ada" }],
        vehicles: [],
        instructorPermitDates: [{ instructorId: "i", expiresOn: "2026-01-01" }]
      },
      new Date("2026-01-01T23:30:00Z")
    )[0]
  ).toMatchObject({ status: "EXPIRED", daysLeft: -1 });
});
it("separates advances, recorded spending and estimates without double counting cancelled or unallocated expenses", () => {
  const expenses: TrainingExpense[] = [
    {
      category: "Repairs",
      date: "2026-01-01",
      amount: "100",
      basis: "RECORDED",
      allocations: [
        { studentId: "s", amount: "40" },
        { studentId: "other", amount: "60" }
      ],
      reason: "Shared"
    },
    {
      category: "Books",
      date: "2026-01-01",
      amount: "20",
      basis: "ESTIMATE",
      allocations: [{ studentId: "s", amount: "20" }],
      reason: "Future"
    },
    {
      category: "Rent",
      date: "2026-01-01",
      amount: "500",
      basis: "RECORDED",
      allocations: [],
      reason: "School"
    },
    {
      category: "Mistake",
      date: "2026-01-01",
      amount: "10",
      basis: "RECORDED",
      allocations: [{ studentId: "s", amount: "10" }],
      reason: "Entry",
      voidReason: "Duplicate"
    }
  ];
  const outings = [
    { status: "STARTED", members: [{ studentId: "s", status: "DRIVING", fuelCost: "1500" }] },
    {
      status: "COMPLETED",
      members: [{ studentId: "s", status: "CONFIRMED", fuelCost: "1000", instructorCost: "500" }]
    }
  ] as TrainingOuting[];
  expect(
    trainingSummary(
      { studentId: "s", packageId: "p", name: "Basic", sessions: 3, minutes: 30, price: "10000" },
      "Ada",
      "5000",
      outings,
      "1500",
      "500",
      expenses
    )
  ).toMatchObject({
    fuelCost: "1000.00",
    fuelAdvanceInProgress: "1500.00",
    otherRecordedCost: "40.00",
    otherEstimatedCost: "20.00",
    costSoFar: "1540.00",
    paymentsLessRecordedCosts: "3460.00",
    estimatedRemainingCost: "4000.00",
    expectedMargin: "4440.00"
  });
});
