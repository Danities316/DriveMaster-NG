import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TrainingSnapshot } from "@drivemaster/shared";
import { db } from "../../db/db";
import { FirstDayOnboarding } from "./FirstDayOnboarding";

const user = {
  id: "owner",
  schoolId: "school",
  role: "OWNER" as const,
  name: "Ada",
  phone: "0800"
};
const base: TrainingSnapshot = {
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
  lessons: []
};
const callbacks = () => ({
  onSetup: vi.fn(),
  onAddStudent: vi.fn(),
  onRecordPayment: vi.fn(),
  onTraining: vi.fn()
});
const renderGuide = (options: Partial<React.ComponentProps<typeof FirstDayOnboarding>> = {}) => {
  const actions = callbacks();
  render(
    <FirstDayOnboarding user={user} studentCount={0} paymentCount={0} {...actions} {...options} />
  );
  return actions;
};
const cache = async (snapshot: TrainingSnapshot) =>
  db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot
  });

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});

it("gives a completely new owner one clear way to begin", async () => {
  const actions = renderGuide();
  fireEvent.click(await screen.findByRole("button", { name: /Open School setup/ }));
  expect(actions.onSetup).toHaveBeenCalledOnce();
});

it("uses the existing readiness order and does not offer booking through a missing blocker", async () => {
  await cache({
    ...base,
    packages: [
      { id: "p", version: 1, data: { name: "Standard", price: "0.00", sessions: 26, minutes: 30 } }
    ],
    instructors: [{ id: "i", name: "Instructor" }]
  });
  const actions = renderGuide();
  expect(await screen.findByRole("button", { name: /Add vehicle/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Book first training/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Add vehicle/ }));
  expect(actions.onSetup).toHaveBeenCalledOnce();
});

it("offers the first booking only after the existing required records are ready", async () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  await cache({
    ...base,
    packages: [
      { id: "p", version: 1, data: { name: "Standard", price: "0.00", sessions: 26, minutes: 30 } }
    ],
    instructors: [{ id: "i", name: "Instructor" }],
    vehicles: [{ id: "v", plateNumber: "ABC-123" }],
    students: [{ id: "s", name: "Emeka", totalTuition: "0.00" }],
    enrollments: [
      {
        id: "e",
        version: 1,
        data: {
          studentId: "s",
          packageId: "p",
          name: "Standard",
          price: "0.00",
          sessions: 26,
          minutes: 30,
          activationStatus: "ACTIVE"
        }
      }
    ],
    salaries: [
      {
        id: "pay",
        version: 1,
        data: { instructorId: "i", month, salary: "100000.00", teachingHours: 160 }
      }
    ]
  });
  const actions = renderGuide({ studentCount: 1 });
  fireEvent.click(await screen.findByRole("button", { name: /Book first training/ }));
  expect(actions.onTraining).toHaveBeenCalledWith({ tab: "outings", filter: "today" });
  expect(screen.getByRole("button", { name: "Record payment" })).toBeVisible();
});

it("stays out of the way for operating schools and non-owners", async () => {
  await cache({
    ...base,
    outings: [
      {
        id: "trip",
        version: 1,
        data: {
          instructorId: "i",
          vehicleId: "v",
          plannedStart: new Date().toISOString(),
          plannedEnd: new Date().toISOString(),
          status: "BOOKED",
          members: [],
          fuelPerStudent: "1500.00",
          allowanceReason: "Default"
        }
      }
    ]
  });
  const { rerender } = render(
    <FirstDayOnboarding user={user} studentCount={1} paymentCount={0} {...callbacks()} />
  );
  expect(screen.queryByText("Get DriveMaster ready")).toBeNull();
  rerender(
    <FirstDayOnboarding
      user={{ ...user, role: "RECEPTIONIST" }}
      studentCount={0}
      paymentCount={0}
      {...callbacks()}
    />
  );
  expect(screen.queryByText("Get DriveMaster ready")).toBeNull();
});
