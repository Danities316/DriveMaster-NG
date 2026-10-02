import { expect, it } from "vitest";
import {
  instructorTimeCost,
  multiplyTrainingMoney,
  splitTrainingMoney,
  trainingSummary
} from "./training.js";
import type { TrainingOuting } from "./training.js";
it("calculates per-student fuel and salary allocations without rounding loss", () => {
  expect(multiplyTrainingMoney("1500", 3)).toBe("4500.00");
  expect(multiplyTrainingMoney("2000", 3)).toBe("6000.00");
  expect(
    instructorTimeCost(
      { instructorId: "i", month: "2026-01", salary: "180000", teachingHours: 180 },
      90
    )
  ).toBe("1500.00");
  expect(splitTrainingMoney("10.00", 3)).toEqual(["3.34", "3.33", "3.33"]);
});
it("keeps costs after a disputed lesson is voided and budgets a replacement session", () => {
  const summary = trainingSummary(
    { studentId: "s", packageId: "p", name: "Basic", sessions: 3, minutes: 30, price: "15000.00" },
    "Ada",
    "5000.00",
    [
      {
        members: [
          {
            studentId: "s",
            enrollmentId: "e",
            status: "VOID",
            minutes: 0,
            fuelCost: "1500.00",
            instructorCost: "500.00"
          }
        ]
      } as TrainingOuting
    ],
    "1500.00",
    "500.00"
  );
  expect(summary).toMatchObject({
    remaining: 3,
    confirmed: 0,
    costSoFar: "2000.00",
    estimatedRemainingCost: "6000.00",
    expectedMargin: "7000.00",
    balance: "10000.00"
  });
});
it("shows confirmation pending separately and never treats fees received as profit", () => {
  const summary = trainingSummary(
    { studentId: "s", packageId: "p", name: "Basic", sessions: 3, minutes: 30, price: "15000.00" },
    "Ada",
    "1000.00",
    [
      {
        members: [
          {
            studentId: "s",
            enrollmentId: "e",
            status: "PENDING",
            minutes: 30,
            fuelCost: "1500.00",
            instructorCost: "500.00"
          }
        ]
      } as TrainingOuting
    ],
    "1500.00",
    "500.00"
  );
  expect(summary).toMatchObject({
    confirmed: 0,
    awaiting: 1,
    remaining: 2,
    expectedMargin: "9000.00",
    balance: "14000.00"
  });
});
