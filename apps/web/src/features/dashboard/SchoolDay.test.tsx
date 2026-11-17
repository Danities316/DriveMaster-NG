import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TrainingSnapshot, TrainingOuting } from "@drivemaster/shared";
import { db } from "../../db/db";
import { SchoolDay } from "./SchoolDay";

const user = {
  id: "owner",
  schoolId: "school",
  name: "Ada",
  phone: "test",
  role: "OWNER" as const
};
const snapshot: TrainingSnapshot = {
  userId: user.id,
  schoolId: user.schoolId,
  viewerRole: user.role,
  packages: [],
  enrollments: [],
  salaries: [],
  settings: null,
  outings: [],
  students: [],
  instructors: [],
  vehicles: [],
  summaries: [],
  lessons: [],
  instructorPermitDates: [],
  vehicleDocuments: []
};
const outing: TrainingOuting = {
  instructorId: "i",
  vehicleId: "v",
  plannedStart: new Date().toISOString(),
  plannedEnd: new Date().toISOString(),
  status: "BOOKED",
  members: [{ studentId: "a", enrollmentId: "a", minutes: 0, status: "BOOKED" }],
  fuelPerStudent: "1500.00",
  allowanceReason: "Default"
};
const attention = { recordsNeedAttention: 0, recordsWaiting: 0, studentsOwing: 0 };
const props = () => ({
  user,
  attention,
  onTraining: vi.fn(),
  onSavedRecords: vi.fn(),
  onStudents: vi.fn()
});

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});

it("summarizes today's training as information and provides one clear route to it", async () => {
  await db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot: {
      ...snapshot,
      outings: [
        { id: "booked", version: 0, data: outing },
        { id: "active", version: 1, data: { ...outing, status: "STARTED" } },
        { id: "done", version: 2, data: { ...outing, status: "COMPLETED" } },
        { id: "cancelled", version: 1, data: { ...outing, status: "CANCELLED" } }
      ]
    }
  });
  const callbacks = props();
  render(<SchoolDay {...callbacks} />);
  const today = await screen.findByRole("region", { name: "Training overview" });
  expect(within(today).getByText("Coming up").previousElementSibling).toHaveTextContent("1");
  expect(within(today).getByText("Training now").previousElementSibling).toHaveTextContent("1");
  expect(within(today).getByText("Completed").previousElementSibling).toHaveTextContent("1");
  fireEvent.click(within(today).getByRole("button", { name: /Open today’s training/ }));
  expect(callbacks.onTraining).toHaveBeenCalledWith({ tab: "outings", filter: "today" });
});

it("prioritizes real attention items and leaves ordinary waiting records out", async () => {
  await db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot: {
      ...snapshot,
      outings: [
        {
          id: "problem",
          version: 1,
          data: {
            ...outing,
            status: "COMPLETED",
            members: [{ ...outing.members[0]!, status: "DISPUTED" }]
          }
        }
      ]
    }
  });
  const callbacks = props();
  render(
    <SchoolDay
      {...callbacks}
      attention={{ recordsNeedAttention: 2, recordsWaiting: 4, studentsOwing: 3 }}
    />
  );
  const area = await screen.findByRole("region", { name: "What needs your attention?" });
  expect(within(area).getByText("2 records need attention")).toBeVisible();
  expect(within(area).getByText(/1 lesson.*reported with a problem/)).toBeVisible();
  expect(within(area).getByText("3 students still owe fees")).toBeVisible();
  expect(within(area).queryByText(/4 records waiting/)).toBeNull();
});

it("does not show cached owner information after the account role changes", async () => {
  await db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot
  });
  const callbacks = props();
  const { rerender } = render(<SchoolDay {...callbacks} />);
  expect(
    await screen.findByText("Based on training records loaded", { exact: false })
  ).toBeVisible();
  rerender(<SchoolDay {...callbacks} user={{ ...user, role: "RECEPTIONIST" }} />);
  expect(await screen.findByText(/Open Training to load today/)).toBeVisible();
  expect(screen.queryByText(/Based on training records loaded/)).toBeNull();
});

it("opens the document settings area directly from a dashboard reminder", async () => {
  await db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot: {
      ...snapshot,
      vehicles: [
        {
          id: "vehicle",
          plateNumber: "ABC123",
          vehicleLicenceExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        }
      ],
      vehicleDocuments: []
    }
  });
  const callbacks = props();
  render(<SchoolDay {...callbacks} />);
  fireEvent.click(await screen.findByText("2 document reminders to check"));
  fireEvent.click(screen.getByRole("button", { name: "Update document details" }));
  expect(callbacks.onTraining).toHaveBeenCalledWith({ tab: "setup", setupArea: "vehicles" });
});
