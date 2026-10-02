import { beforeEach, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AuthenticatedUser, TrainingOuting, TrainingSnapshot } from "@drivemaster/shared";
import { db } from "../../db/db";
import { TrainingPage } from "./TrainingPage";
const user: AuthenticatedUser = {
  id: "owner",
  schoolId: "school",
  role: "OWNER",
  name: "Owner",
  phone: "test"
};
const at = new Date().toISOString();
const outing = (status: TrainingOuting["status"], studentId: string): TrainingOuting => ({
  instructorId: "i",
  vehicleId: "v",
  plannedStart: at,
  plannedEnd: at,
  ...(status === "STARTED" ? { startedAt: at, startOdometer: 100, fuelIssued: "1500" } : {}),
  status,
  fuelPerStudent: "1500",
  allowanceReason: "Default",
  members: [
    {
      studentId,
      enrollmentId: `e-${studentId}`,
      minutes: 30,
      status: status === "STARTED" ? "DRIVING" : status === "COMPLETED" ? "PENDING" : "BOOKED"
    }
  ]
});
const snapshot: TrainingSnapshot = {
  userId: user.id,
  schoolId: user.schoolId,
  viewerRole: user.role,
  settings: null,
  packages: [],
  enrollments: [],
  salaries: [],
  outings: [],
  summaries: [],
  lessons: [],
  students: ["Ada", "Bola", "Chidi"].map((name) => ({ id: name, name, totalTuition: "10000" })),
  instructors: [{ id: "i", name: "Mr Ade" }],
  vehicles: [{ id: "v", plateNumber: "ABC123" }]
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
async function cache(data = snapshot, viewer = user) {
  await db.trainingCache.put({
    userId: viewer.id,
    schoolId: viewer.schoolId,
    snapshot: { ...data, userId: viewer.id, viewerRole: viewer.role },
    loadedAt: at
  });
}
it("shows the default schedule hierarchy and only valid card actions", async () => {
  await cache({
    ...snapshot,
    outings: [
      { id: "booked", version: 0, data: outing("BOOKED", "Bola") },
      { id: "done", version: 2, data: outing("COMPLETED", "Chidi") },
      { id: "active", version: 1, data: outing("STARTED", "Ada") }
    ]
  });
  render(<TrainingPage user={user} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Today's training" })).toBeVisible();
  const now = await screen.findByRole("region", { name: "Training now" });
  expect(within(now).getByRole("button", { name: "Finish training" })).toBeEnabled();
  const coming = screen.getByRole("region", { name: "Coming up" });
  expect(within(coming).getByRole("button", { name: "Start training" })).toBeEnabled();
  expect(within(coming).getByRole("heading", { name: "Bola" })).toBeVisible();
  expect(within(coming).getByText("Mr Ade")).toBeVisible();
  expect(within(coming).getByText("ABC123")).toBeVisible();
  expect(
    within(coming).getByText(
      new Date(at).toLocaleString("en-NG", {
        timeZone: "Africa/Lagos",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      })
    )
  ).toBeVisible();
  const done = screen.getByRole("region", { name: "Completed today" });
  expect(within(done).queryByRole("button", { name: "Start training" })).toBeNull();
  expect(within(done).getByRole("button", { name: "View lesson record" })).toHaveClass(
    "dm-secondary"
  );
  expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  expect(now.compareDocumentPosition(coming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(coming.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(now.querySelector("table")).toBeNull();
});
it.each(["OWNER", "RECEPTIONIST", "INSTRUCTOR"] as const)(
  "keeps the empty %s schedule and booking permissions clear",
  async (role) => {
    const viewer = { ...user, role };
    await cache(snapshot, viewer);
    render(<TrainingPage user={viewer} />);
    expect(await screen.findByRole("heading", { name: "No training booked today" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Book training" }) !== null).toBe(
      role !== "INSTRUCTOR"
    );
    expect(screen.queryByText("Agreed fee")).toBeNull();
  }
);
it("keeps a queued finish in training now, labelled locally saved and not completed", async () => {
  await cache({
    ...snapshot,
    outings: [{ id: "active", version: 1, data: outing("STARTED", "Ada") }]
  });
  await db.trainingQueue.put({
    id: "finish",
    targetId: "active",
    action: "FINISH",
    data: {},
    expectedVersion: 1,
    userId: user.id,
    schoolId: user.schoolId,
    role: user.role,
    status: "PENDING",
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: 0
  });
  render(<TrainingPage user={user} />);
  const active = await screen.findByRole("region", { name: "Training now" });
  expect(
    within(active).getByText("Training finish saved on this device. Waiting to be sent.")
  ).toBeVisible();
  expect(within(active).getByRole("button", { name: "Finish training" })).toBeDisabled();
  expect(screen.queryByText("Training completed")).toBeNull();
  expect(screen.queryByText("Training started")).toBeNull();
  expect(screen.queryByRole("region", { name: "Completed today" })).toBeNull();
});
it("keeps yesterday's unfinished training visible without a contradictory empty state", async () => {
  const old = new Date(Date.now() - 172800000).toISOString();
  await cache({
    ...snapshot,
    outings: [
      {
        id: "old",
        version: 1,
        data: { ...outing("STARTED", "Ada"), plannedStart: old, startedAt: old }
      }
    ]
  });
  render(<TrainingPage user={user} />);
  const active = await screen.findByRole("region", { name: "Training now" });
  expect(within(active).getByRole("button", { name: "Finish training" })).toBeEnabled();
  expect(within(active).getByText("Training started")).toBeVisible();
  expect(screen.getByText("Training from another date is still in progress.")).toBeVisible();
  expect(screen.queryByText("No training booked today")).toBeNull();
});
it.each(["PENDING", "FAILED"] as const)(
  "keeps a %s offline start accurately labelled with only valid continuation",
  async (status) => {
    await cache({
      ...snapshot,
      outings: [{ id: "trip", version: 0, data: outing("BOOKED", "Ada") }]
    });
    await db.trainingQueue.put({
      id: "start",
      targetId: "trip",
      action: "START",
      data: { startedAt: at, odometer: 100, present: ["Ada"] },
      expectedVersion: 0,
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
      status,
      attempts: 0,
      createdAt: Date.now(),
      nextAttemptAt: 0,
      ...(status === "FAILED" ? { error: "The vehicle already has a lesson at this time." } : {})
    });
    render(<TrainingPage user={user} />);
    const region = await screen.findByRole("region", {
      name: status === "PENDING" ? "Training now" : "Needs attention"
    });
    if (status === "PENDING") {
      expect(screen.queryByText("Training started")).toBeNull();
      expect(
        within(region).getByText("Training start saved on this device. Waiting to be sent.")
      ).toBeVisible();
      expect(within(region).getByRole("button", { name: "Finish training" })).toBeEnabled();
    } else {
      expect(within(region).getByText(/A saved change needs attention/)).toBeVisible();
      expect(within(region).getByRole("button", { name: "Start training" })).toBeDisabled();
      expect(within(region).queryByRole("button", { name: "Finish training" })).toBeNull();
    }
    expect(screen.queryByRole("region", { name: "Completed today" })).toBeNull();
  }
);
it("surfaces disputes while keeping normal waiting-for-confirmation trips out of problems", async () => {
  const problem = outing("COMPLETED", "Ada");
  problem.members[0]!.status = "DISPUTED";
  await cache({
    ...snapshot,
    outings: [
      { id: "problem", version: 3, data: problem },
      { id: "waiting", version: 2, data: outing("COMPLETED", "Bola") }
    ]
  });
  render(<TrainingPage user={user} />);
  const attention = await screen.findByRole("region", { name: "Needs attention" });
  expect(within(attention).getByText("Training completed")).toBeVisible();
  expect(within(attention).getByRole("heading", { name: "Ada" })).toBeVisible();
  expect(
    within(attention).getByRole("button", { name: "Review the student’s complaint" })
  ).toBeEnabled();
  expect(within(attention).queryByRole("button", { name: "Start training" })).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "Completed today" })).getByRole("heading", {
      name: "Bola"
    })
  ).toBeVisible();
});
