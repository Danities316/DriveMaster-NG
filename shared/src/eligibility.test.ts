import { expect, it } from "vitest";
import { trainingSummary, type TrainingOuting, type TrainingEnrollment } from "./training.js";
import { DEFAULT_SCHOOL_RULES } from "./schoolRules.js";
const enrollment: TrainingEnrollment = {
  studentId: "s",
  packageId: "p",
  name: "Complete",
  sessions: 40,
  minutes: 30,
  price: "50000",
  rulesSnapshot: { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 20 }
};
const outing = (at: string, status = "CONFIRMED", minutes = 30): TrainingOuting => ({
  instructorId: "i",
  vehicleId: "v",
  plannedStart: at,
  plannedEnd: at,
  startedAt: at,
  endedAt: new Date(Date.parse(at) + 1800000).toISOString(),
  status: "COMPLETED",
  fuelPerStudent: "1500",
  allowanceReason: "default",
  members: [{ studentId: "s", enrollmentId: "e", status: status as "CONFIRMED", minutes }]
});
it("counts one qualifying day per Lagos date and excludes short, disputed, missing and cancelled lessons", () => {
  const rows = [
    outing("2026-01-01T23:30:00Z"),
    outing("2026-01-02T09:00:00Z"),
    outing("2026-01-03T09:00:00Z", "PENDING"),
    outing("2026-01-04T09:00:00Z", "DISPUTED"),
    outing("2026-01-05T09:00:00Z", "CONFIRMED", 29),
    { ...outing("2026-01-06T09:00:00Z"), status: "CANCELLED" as const },
    outing("2026-01-07T09:00:00Z", "MISSED")
  ];
  expect(trainingSummary(enrollment, "Ada", "0", rows, "0", "0")).toMatchObject({
    qualifyingDays: 1,
    schoolTargetMet: false,
    dsspMinimumMet: false
  });
});
it("keeps school completion, 26-day eligibility and paid lessons separate beyond the minimum", () => {
  const rows = Array.from({ length: 28 }, (_, i) =>
    outing(new Date(Date.UTC(2026, 0, i + 1, 9)).toISOString())
  );
  expect(trainingSummary(enrollment, "Ada", "0", rows.slice(0, 20), "0", "0")).toMatchObject({
    qualifyingDays: 20,
    schoolTargetMet: true,
    dsspMinimumMet: false,
    remaining: 20
  });
  expect(trainingSummary(enrollment, "Ada", "0", rows, "0", "0")).toMatchObject({
    qualifyingDays: 28,
    schoolTargetMet: true,
    dsspMinimumMet: true,
    remaining: 12
  });
  expect(
    trainingSummary(
      { ...enrollment, rulesSnapshot: { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 30 } },
      "Ada",
      "0",
      rows,
      "0",
      "0"
    )
  ).toMatchObject({ schoolTargetMet: false, dsspMinimumMet: true });
});
