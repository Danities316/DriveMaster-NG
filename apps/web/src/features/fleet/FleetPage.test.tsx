import { beforeEach, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FleetPage } from "./FleetPage";
import { db } from "../../db/db";
import type { TrainingSnapshot } from "@drivemaster/shared";
const user = { id: "u", schoolId: "s", name: "Ada", phone: "08012345678", role: "OWNER" as const };
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
it("registers a vehicle then records an offline fuel claim with validation", async () => {
  render(<FleetPage user={user} />);
  fireEvent.click(await screen.findByRole("button", { name: "Register vehicle" }));
  fireEvent.change(screen.getByLabelText("Registration number"), {
    target: { value: "ABC-123-XY" }
  });
  fireEvent.change(screen.getByLabelText("Vehicle model"), { target: { value: "Corolla" } });
  fireEvent.click(screen.getByRole("button", { name: "Save record" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Record fuel" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Record fuel" }));
  fireEvent.change(screen.getByLabelText(/Current mileage/), { target: { value: "1200" } });
  fireEvent.change(screen.getByLabelText(/How many litres/), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText(/How much did the fuel cost/), {
    target: { value: "19000" }
  });
  fireEvent.change(screen.getByLabelText(/Receipt \/ claim reference/), {
    target: { value: "REF-001" }
  });
  fireEvent.change(screen.getByLabelText(/Was the tank/), { target: { value: "yes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save record" }));
  expect(await screen.findByText(/20.00 L/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("View record details"));
  expect(screen.getByText(/Full tank \/ REF-001/)).toBeVisible();
  expect(screen.getByText("Waiting to be sent")).toBeInTheDocument();
  expect((await db.fuelLogs.toArray())[0]).toMatchObject({
    cost: "19000.00",
    driverName: "Ada",
    fullTank: true
  });
  expect(await db.outbox.count()).toBe(2);
});
it("keeps inputs visible after an invalid backdated odometer reading", async () => {
  const id = crypto.randomUUID();
  await db.vehicles.add({
    id,
    schoolId: "s",
    plateNumber: "ABC123XY",
    model: "Corolla",
    status: "ACTIVE",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  });
  await db.mileageLogs.add({
    id: crypto.randomUUID(),
    schoolId: "s",
    vehicleId: id,
    date: "2026-01-03T10:00:00Z",
    odometer: 1200,
    driverName: "Ada",
    recordedById: "u",
    notes: null,
    createdAt: "2026-01-03"
  });
  render(<FleetPage user={user} />);
  fireEvent.change(await screen.findByLabelText("Vehicle"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Record mileage" }));
  expect(screen.getByText(/Last recorded: 1,200 km/)).toBeVisible();
  expect(screen.getByLabelText(/Current mileage/)).toHaveValue(null);
  fireEvent.change(screen.getByLabelText(/Date and time/), {
    target: { value: "2026-01-02T10:00" }
  });
  fireEvent.change(screen.getByLabelText(/Current mileage/), { target: { value: "1300" } });
  fireEvent.click(screen.getByRole("button", { name: "Save record" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/earlier or later/);
  expect(screen.getByLabelText(/Current mileage/)).toHaveValue(1300);
  expect(await db.mileageLogs.count()).toBe(1);
  expect(await db.outbox.count()).toBe(0);
});
it.each(["INSTRUCTOR", "STUDENT"] as const)("keeps vehicle recording private from %s", (role) => {
  render(<FleetPage user={{ ...user, role }} />);
  expect(screen.getByText("You do not have access to vehicle recording.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Record fuel" })).toBeNull();
});
it("shows a trip-originated purchase once and prevents recording its receipt again", async () => {
  const vehicleId = crypto.randomUUID();
  await db.vehicles.add({
    id: vehicleId,
    schoolId: "s",
    model: "Corolla",
    plateNumber: "ABC123",
    status: "ACTIVE",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  });
  await db.fuelLogs.add({
    id: "trip-fuel",
    schoolId: "s",
    vehicleId,
    date: "2026-01-01T10:00:00Z",
    odometer: 1000,
    cost: "2400.00",
    litres: "2.40",
    receiptReference: "TRIP-1",
    fullTank: false,
    discrepancyAlert: false,
    createdAt: "2026-01-01"
  });
  const snapshot: TrainingSnapshot = {
    userId: user.id,
    schoolId: "s",
    viewerRole: "OWNER",
    settings: null,
    salaries: [],
    packages: [],
    enrollments: [],
    lessons: [],
    summaries: [],
    students: [],
    instructors: [],
    vehicles: [],
    outings: [
      {
        id: "trip",
        version: 2,
        data: {
          vehicleId,
          instructorId: "i",
          plannedStart: "2026-01-01T09:00:00Z",
          plannedEnd: "2026-01-01T11:00:00Z",
          status: "COMPLETED",
          members: [],
          fuelPerStudent: "1500",
          allowanceReason: "School rate",
          fuelLogId: "trip-fuel",
          fuelIssued: "3000",
          fuelSpent: "2400",
          fuelReturned: "0"
        }
      }
    ]
  };
  await db.trainingCache.put({ userId: user.id, schoolId: "s", snapshot, loadedAt: "2026-01-01" });
  render(<FleetPage user={user} />);
  fireEvent.change(await screen.findByLabelText("Vehicle"), { target: { value: vehicleId } });
  fireEvent.click(screen.getByText("View record details"));
  expect(
    screen.getByText("Recorded from training. Do not enter this purchase again.")
  ).toBeVisible();
  expect(await db.fuelLogs.count()).toBe(1);
  expect(await db.outbox.count()).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Record fuel" }));
  fireEvent.change(screen.getByLabelText(/Current mileage/), { target: { value: "1100" } });
  fireEvent.change(screen.getByLabelText(/How much did/), { target: { value: "2400" } });
  fireEvent.change(screen.getByLabelText(/How many litres/), { target: { value: "2.4" } });
  fireEvent.change(screen.getByLabelText(/Receipt \/ claim/), { target: { value: "TRIP-1" } });
  fireEvent.change(screen.getByLabelText(/Was the tank/), { target: { value: "no" } });
  fireEvent.click(screen.getByRole("button", { name: "Save record" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/already|duplicate/i);
  expect(await db.fuelLogs.count()).toBe(1);
  expect(await db.outbox.count()).toBe(0);
});
it("shows a completed consumption cycle and recalculates when a backdated partial fill arrives", async () => {
  const common = {
    schoolId: "s",
    vehicleId: "v",
    fullTank: true,
    litres: "20.00",
    cost: "20000.00",
    discrepancyAlert: false,
    createdAt: "2026-01-01"
  };
  await db.fuelLogs.bulkAdd([
    { ...common, id: "first", date: "2026-01-01T10:00:00Z", odometer: 1000 },
    { ...common, id: "last", date: "2026-01-03T10:00:00Z", odometer: 1500 }
  ]);
  render(<FleetPage user={user} />);
  expect(await screen.findByText("4.00")).toBeInTheDocument();
  await act(async () => {
    await db.fuelLogs.add({
      ...common,
      id: "partial",
      fullTank: false,
      litres: "10.00",
      cost: "10000.00",
      date: "2026-01-02T10:00:00Z",
      odometer: 1200
    });
  });
  expect(await screen.findByText("6.00")).toBeInTheDocument();
  expect(screen.getByText(/Fuel counted: 30.00 L/)).toBeInTheDocument();
});
