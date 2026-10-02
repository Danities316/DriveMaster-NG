import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TrainingOuting, TrainingSnapshot } from "@drivemaster/shared";
import { BookTrainingForm } from "./BookTrainingForm";
import { TrainingTripCard } from "./TrainingTripCard";
import { TrainingPage } from "./TrainingPage";
import { StudentConfirmation } from "./StudentConfirmation";
import { db } from "../../db/db";

const owner = {
  id: "owner",
  schoolId: "school",
  name: "Owner",
  role: "OWNER" as const,
  phone: "test"
};
const packageData = { name: "Beginner", sessions: 5, minutes: 30, price: "50000.00" };
const snapshot: TrainingSnapshot = {
  userId: owner.id,
  schoolId: owner.schoolId,
  viewerRole: owner.role,
  settings: null,
  salaries: [],
  outings: [],
  lessons: [],
  summaries: [],
  packages: [{ id: "p", version: 0, data: packageData }],
  enrollments: ["Ada", "Bola", "Chidi", "Dayo"].map((id) => ({
    id: `e-${id}`,
    version: 0,
    data: { ...packageData, studentId: id, packageId: "p" }
  })),
  students: ["Ada", "Bola", "Chidi", "Dayo"].map((id) => ({
    id,
    name: id,
    totalTuition: "50000.00"
  })),
  instructors: [{ id: "i", name: "Mr Ade" }],
  vehicles: [{ id: "v", plateNumber: "ABC123" }]
};
const outing: TrainingOuting = {
  instructorId: "i",
  vehicleId: "v",
  plannedStart: new Date().toISOString(),
  plannedEnd: new Date(Date.now() + 3600000).toISOString(),
  status: "BOOKED",
  fuelPerStudent: "1500.00",
  allowanceReason: "Default",
  members: ["Ada", "Bola"].map((studentId) => ({
    studentId,
    enrollmentId: `e-${studentId}`,
    status: "BOOKED",
    minutes: 0
  }))
};
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});

it("reviews group time and fuel before saving and preserves the booking when going back", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<BookTrainingForm snapshot={snapshot} onSave={onSave} />);
  for (const student of ["Ada", "Bola", "Chidi"])
    fireEvent.click(screen.getByLabelText(new RegExp(student)));
  expect(screen.getByLabelText(/Dayo/)).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/Chidi/));
  expect(screen.getByRole("region", { name: "Booking summary" })).toHaveTextContent("60 minutes");
  expect(screen.getByRole("region", { name: "Booking summary" })).toHaveTextContent("₦3,000.00");
  change("Instructor", "i");
  change("Vehicle", "v");
  change("Date and start time", "2026-09-28T10:00");
  fireEvent.click(screen.getByRole("button", { name: "Check booking" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Booking summary" })).toHaveTextContent("Mr Ade");
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  expect(screen.getByLabelText("Vehicle")).toHaveValue("v");
  fireEvent.click(screen.getByRole("button", { name: "Check booking" }));
  fireEvent.click(screen.getByRole("button", { name: "Save booking" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith({
    studentIds: ["Ada", "Bola"],
    instructorId: "i",
    vehicleId: "v",
    plannedStart: new Date("2026-09-28T10:00").toISOString()
  });
});
it("opens today's lessons and keeps unfinished training from older dates discoverable", async () => {
  const old = {
    ...outing,
    plannedStart: new Date(Date.now() - 172800000).toISOString(),
    status: "STARTED" as const,
    startedAt: new Date(Date.now() - 172800000).toISOString()
  };
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    loadedAt: new Date().toISOString(),
    snapshot: {
      ...snapshot,
      outings: [
        { id: "today", version: 0, data: outing },
        {
          id: "old",
          version: 1,
          data: {
            ...old,
            members: [{ ...outing.members[0]!, studentId: "Chidi", status: "DRIVING" }]
          }
        }
      ]
    }
  });
  render(<TrainingPage user={owner} />);
  expect(
    await screen.findByRole("article", { name: "Training trip for Ada, Bola" })
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Show training")).toHaveValue("today");
  expect(
    screen.queryByRole("article", { name: "Training trip for Chidi" })
  ).toBeInTheDocument();
  expect(screen.queryByText("Get your school ready, one step at a time")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View training in progress" }));
  expect(screen.getByRole("article", { name: "Training trip for Chidi" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finish training" })).toBeInTheDocument();
});
it("keeps cancellation in More options and does not require a new date", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <TrainingTripCard
      record={{ id: "o", version: 0, data: outing }}
      snapshot={snapshot}
      owner
      office
      changes={[]}
      onSave={onSave}
      onSetup={vi.fn()}
    />
  );
  expect(screen.getByRole("button", { name: "Save booking change" })).not.toBeVisible();
  fireEvent.click(screen.getByText("More options", { selector: "summary" }));
  fireEvent.click(screen.getByText("Move or cancel this booking", { selector: "summary" }));
  change("What would you like to do?", "CANCEL");
  expect(screen.queryByLabelText("New date and time")).not.toBeInTheDocument();
  change("Reason", "Student asked to cancel");
  fireEvent.click(screen.getByRole("button", { name: "Save booking change" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith("CANCEL", { reason: "Student asked to cancel" })
  );
});
it("allows finishing a queued start but blocks finishing after a failed start", () => {
  const data = {
    ...outing,
    status: "STARTED" as const,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    startOdometer: 100,
    fuelIssued: "3000.00",
    members: outing.members.map((m) => ({ ...m, status: "DRIVING" as const }))
  };
  const command = {
    id: "c",
    targetId: "o",
    action: "START",
    data: {},
    userId: owner.id,
    schoolId: owner.schoolId,
    role: owner.role,
    status: "PENDING" as const,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0
  };
  const props = {
    record: { id: "o", version: 1, data },
    snapshot,
    owner: true,
    office: true,
    onSave: vi.fn(),
    onSetup: vi.fn()
  };
  const { rerender } = render(<TrainingTripCard {...props} changes={[command]} />);
  expect(screen.getByRole("button", { name: "Finish training" })).toBeEnabled();
  rerender(<TrainingTripCard {...props} changes={[{ ...command, status: "FAILED" }]} />);
  expect(screen.getByRole("button", { name: "Finish training" })).toBeDisabled();
});
it("does not let a student confirm a short lesson and sends their complaint", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<StudentConfirmation minutes={15} disabled={false} onSave={onSave} />);
  expect(screen.getByLabelText("Yes, I attended")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Report a problem"));
  change("What went wrong?", "I drove for 15 minutes");
  fireEvent.click(screen.getByRole("button", { name: "Send my response" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({ attended: false, reason: "I drove for 15 minutes" })
  );
});

it("shows a queued monthly pay entry as waiting to send instead of asking the owner to create it again", () => {
  const pay = {
    id: "pay",
    targetId: "salary",
    action: "SALARY",
    data: {
      instructorId: "i",
      month: new Date(Date.now() + 3600000).toISOString().slice(0, 7),
      salary: "120000.00",
      teachingHours: 120
    },
    userId: owner.id,
    schoolId: owner.schoolId,
    role: owner.role,
    status: "PENDING" as const,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0
  };
  render(
    <TrainingTripCard
      record={{ id: "o", version: 0, data: outing }}
      snapshot={snapshot}
      owner
      office
      changes={[]}
      payChanges={[pay]}
      onSave={vi.fn()}
      onSetup={vi.fn()}
    />
  );
  expect(screen.getByText(/Do not create it again/)).toHaveTextContent("is waiting to be sent");
  expect(screen.getByRole("button", { name: "View saved instructor pay" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set up instructor pay" })).not.toBeInTheDocument();
});

it("checks the booked month for a future lesson's pay warning", () => {
  const future = { ...outing, plannedStart: "2030-01-05T09:00:00Z" };
  const savedPay = {
    ...snapshot,
    salaries: [
      {
        id: "pay",
        version: 0,
        data: { instructorId: "i", month: "2030-01", salary: "120000.00", teachingHours: 120 }
      }
    ]
  };
  render(
    <TrainingTripCard
      record={{ id: "o", version: 0, data: future }}
      snapshot={savedPay}
      owner
      office
      changes={[]}
      onSave={vi.fn()}
      onSetup={vi.fn()}
    />
  );
  expect(screen.queryByRole("button", { name: "Set up instructor pay" })).not.toBeInTheDocument();
});
