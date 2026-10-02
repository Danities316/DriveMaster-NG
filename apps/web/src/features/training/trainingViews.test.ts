import { expect, it } from "vitest";
import type { TrainingOuting, TrainingRecord } from "@drivemaster/shared";
import { matchesTrainingView, trainingGroups } from "./trainingViews";
const row = (id: string, status: TrainingOuting["status"], at: string, memberStatus = "BOOKED") =>
  ({
    id,
    version: 0,
    data: { status, plannedStart: at, members: [{ status: memberStatus }] }
  }) as TrainingRecord<TrainingOuting>;
it("prioritizes active work, real problems, chronological bookings and quiet completions", () => {
  const at = "2026-09-29T10:00:00Z";
  const rows = [
    row("done", "COMPLETED", at, "PENDING"),
    row("late", "BOOKED", at),
    row("early", "BOOKED", "2026-09-29T07:00:00Z"),
    row("running", "STARTED", at),
    row("dispute", "COMPLETED", at, "DISPUTED"),
    row("failed", "BOOKED", at)
  ];
  const groups = trainingGroups(rows, "today", new Set(["failed"]), new Date(at));
  expect(groups.map((g) => g.id)).toEqual(["now", "attention", "upcoming", "completed"]);
  expect(groups[1]?.rows.map((r) => r.id)).toEqual(["dispute", "failed"]);
  expect(groups[2]?.rows.map((r) => r.id)).toEqual(["early", "late"]);
  expect(groups[3]?.rows[0]?.id).toBe("done");
});
it("uses the Nigerian calendar day across the UTC midnight boundary and excludes cancellations", () => {
  const now = new Date("2026-09-28T23:30:00Z");
  const rows = [
    row("today", "BOOKED", "2026-09-28T23:10:00Z"),
    row("yesterday", "BOOKED", "2026-09-28T22:59:00Z"),
    row("cancelled", "CANCELLED", "2026-09-29T09:00:00Z")
  ];
  expect(
    trainingGroups(rows, "today", new Set(), now).flatMap((g) => g.rows.map((r) => r.id))
  ).toEqual(["today"]);
  expect(matchesTrainingView(rows[1]!.data, "today", now)).toBe(false);
  expect(trainingGroups(rows, "all", new Set(), now).flatMap((g) => g.rows)).toHaveLength(3);
});
it("orders 8 AM, 9:30 AM, 11 AM and 2 PM by timestamps rather than formatted labels", () => {
  const rows = [
    row("2 PM", "BOOKED", "2026-09-29T13:00:00Z"),
    row("9:30 AM", "BOOKED", "2026-09-29T08:30:00Z"),
    row("8 AM", "BOOKED", "2026-09-29T07:00:00Z"),
    row("11 AM", "BOOKED", "2026-09-29T10:00:00Z")
  ];
  expect(
    trainingGroups(rows, "today", new Set(), new Date("2026-09-29T06:00:00Z"))[0]?.rows.map(
      (r) => r.id
    )
  ).toEqual(["8 AM", "9:30 AM", "11 AM", "2 PM"]);
});
it("keeps older running trips visible today and through the existing active filter", () => {
  const old = row("old", "STARTED", "2026-09-27T10:00:00Z");
  expect(
    trainingGroups([old], "today", new Set(), new Date("2026-09-29T10:00:00Z"))[0]?.rows
  ).toEqual([old]);
  expect(trainingGroups([old], "active", new Set())[0]?.rows).toEqual([old]);
});
