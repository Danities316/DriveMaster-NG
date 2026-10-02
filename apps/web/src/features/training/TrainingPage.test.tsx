import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { AuthenticatedUser, TrainingSnapshot } from "@drivemaster/shared";
import { db } from "../../db/db";
import { TrainingPage } from "./TrainingPage";
import { sendTraining } from "./trainingLocal";
const student: AuthenticatedUser = {
  id: "student-user",
  schoolId: "school",
  role: "STUDENT",
  name: "Ada",
  phone: "test"
};
const snapshot: TrainingSnapshot = {
  viewerRole: student.role,
  userId: student.id,
  schoolId: student.schoolId,
  packages: [],
  enrollments: [],
  settings: null,
  salaries: [],
  outings: [],
  students: [],
  instructors: [],
  vehicles: [],
  summaries: [],
  lessons: [
    {
      outingId: "o",
      version: 2,
      instructor: "Mr Ade",
      vehicle: "ABC123",
      date: "2026-01-02T10:00:00Z",
      minutes: 30,
      status: "PENDING",
      topics: "Braking"
    }
  ]
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
it("gives students a simple private confirmation form", async () => {
  await db.trainingCache.put({
    userId: student.id,
    schoolId: student.schoolId,
    snapshot,
    loadedAt: "2026-01-02"
  });
  render(<TrainingPage user={student} />);
  expect(await screen.findByText(/Mr Ade/)).toBeInTheDocument();
  expect(screen.queryByText("Monthly instructor pay")).not.toBeInTheDocument();
  expect(screen.queryByText("Training settings")).not.toBeInTheDocument();
  expect(screen.queryByText("School setup")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Report a problem"));
  fireEvent.change(screen.getByLabelText("What went wrong?"), {
    target: { value: "The lesson did not take place" }
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send my response" }));
  });
  await waitFor(async () => expect(await db.trainingQueue.count()).toBe(1));
  expect(await screen.findByRole("heading", { name: "Saved training records" })).toBeVisible();
  expect(await screen.findByText(/Saved on this device\. Waiting to be sent/)).toBeVisible();
  expect((await db.trainingQueue.toArray())[0]).toMatchObject({
    action: "RESPOND",
    expectedVersion: 2,
    data: { attended: false, reason: "The lesson did not take place" }
  });
});
it("lets an owner change the default fuel amount and explains existing bookings", async () => {
  const owner: AuthenticatedUser = { ...student, id: "owner", role: "OWNER" };
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    snapshot: { ...snapshot, userId: owner.id, viewerRole: owner.role, lessons: [] },
    loadedAt: "2026-01-02"
  });
  render(<TrainingPage user={owner} />);
  fireEvent.click(await screen.findByRole("button", { name: "School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Costs & rules" }));
  fireEvent.click(
    screen.getByText("Fuel money for each attending student", { selector: "summary" })
  );
  expect(
    screen.getByText(/Existing training trips keep their saved fuel amount/)
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Fuel money for each attending student (₦)"), {
    target: { value: "2000" }
  });
  fireEvent.change(screen.getByLabelText("Reason for this amount"), {
    target: { value: "New fuel price" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save fuel money per student" }));
  await waitFor(async () => expect(await db.trainingQueue.count()).toBe(1));
  expect((await db.trainingQueue.toArray())[0]).toMatchObject({
    action: "SETTINGS",
    data: { fuelPerStudent: "2000", reason: "New fuel price" }
  });
});

it("guides setup to instructor accounts and connects student and vehicle creation", async () => {
  const owner: AuthenticatedUser = { ...student, id: "owner", role: "OWNER" };
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    snapshot: { ...snapshot, userId: owner.id, viewerRole: owner.role, lessons: [] },
    loadedAt: "2026-01-02"
  });
  const onAddStudent = vi.fn(),
    onVehicles = vi.fn();
  render(
    <TrainingPage
      user={owner}
      initialTab="setup"
      onAddStudent={onAddStudent}
      onVehicles={onVehicles}
    />
  );
  fireEvent.click(await screen.findByRole("button", { name: "Set up Add your instructors" }));
  expect(screen.getByLabelText("Account type")).toHaveValue("INSTRUCTOR");
  expect(screen.queryByLabelText("Student record (for student accounts)")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Set up Add a training vehicle" }));
  expect(onVehicles).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Set up Add your first student" }));
  expect(onAddStudent).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Set up Book the first lesson" }));
  expect(document.getElementById("book-outing")).toHaveAttribute("open");
});

it("organizes owner setup into clear areas and keeps package terms visible", async () => {
  const owner: AuthenticatedUser = { ...student, id: "owner", role: "OWNER" };
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    snapshot: {
      ...snapshot,
      userId: owner.id,
      viewerRole: owner.role,
      lessons: [],
      packages: [
        {
          id: "package",
          version: 2,
          data: { name: "Beginner Package", sessions: 15, minutes: 30, price: "150000.00" }
        }
      ]
    },
    loadedAt: "2026-01-02"
  });
  const { container } = render(<TrainingPage user={owner} initialTab="setup" />);
  expect(await screen.findByRole("heading", { name: "School setup" })).toBeVisible();
  for (const area of [
    "School profile",
    "Training",
    "People",
    "Vehicles",
    "Registration",
    "Costs & rules"
  ]) {
    expect(screen.getByRole("button", { name: `Open ${area}` })).toBeVisible();
  }
  expect(screen.getByText("1 training package set up")).toBeVisible();
  expect(screen.getByText("Required to operate")).toBeVisible();
  expect(screen.getByText("Useful configuration")).toBeVisible();
  expect(container.querySelector("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Training" }));
  fireEvent.click(screen.getByText("Training packages", { selector: "summary" }));
  expect(screen.getByRole("heading", { name: "Beginner Package" })).toBeVisible();
  expect(screen.getByText("15 lessons")).toBeVisible();
  expect(screen.getByText("₦150,000.00")).toBeVisible();
  fireEvent.click(screen.getByText("Choose a student’s training package", { selector: "summary" }));
  expect(screen.getByText(/Later package changes do not change this agreement/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Open People" }));
  expect(screen.getByText("Monthly instructor pay", { selector: "summary" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Vehicles" }));
  expect(
    screen.getByText("Vehicle insurance and roadworthiness dates", { selector: "summary" })
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Registration" }));
  expect(
    screen.getByText("QR enrollment: let students register themselves", { selector: "summary" })
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to School setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Costs & rules" }));
  fireEvent.click(screen.getByText("School rules", { selector: "summary" }));
  expect(screen.getByText(/Your school target is/)).toBeVisible();
  expect(screen.getByText(/recorded DSSP reference is 26 days/)).toBeVisible();
});

it("does not give non-owners owner-only School setup areas", async () => {
  const receptionist: AuthenticatedUser = { ...student, id: "reception", role: "RECEPTIONIST" };
  await db.trainingCache.put({
    userId: receptionist.id,
    schoolId: receptionist.schoolId,
    snapshot: { ...snapshot, userId: receptionist.id, viewerRole: receptionist.role, lessons: [] },
    loadedAt: "2026-01-02"
  });
  render(<TrainingPage user={receptionist} initialTab="setup" />);
  expect(await screen.findByRole("button", { name: "Open Training" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Vehicles" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open People" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Costs & rules" })).toBeNull();
  expect(screen.queryByText("Monthly instructor pay", { selector: "summary" })).toBeNull();
});

it("does not expose School setup to instructors", async () => {
  const instructor: AuthenticatedUser = { ...student, id: "instructor", role: "INSTRUCTOR" };
  await db.trainingCache.put({
    userId: instructor.id,
    schoolId: instructor.schoolId,
    snapshot: { ...snapshot, userId: instructor.id, viewerRole: instructor.role, lessons: [] },
    loadedAt: "2026-01-02"
  });
  render(<TrainingPage user={instructor} />);
  expect(await screen.findByText(/Last loaded:/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "School setup" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Costs & rules" })).toBeNull();
});

it("lets the owner restart a stuck sender from the visible busy message", async () => {
  const owner: AuthenticatedUser = { ...student, id: "owner", role: "OWNER" };
  const ownerSnapshot = { ...snapshot, userId: owner.id, viewerRole: owner.role, lessons: [] };
  localStorage.clear();
  localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(owner));
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    snapshot: ownerSnapshot,
    loadedAt: "2026-01-02"
  });
  await db.trainingQueue.put({
    id: "c",
    targetId: "pay",
    action: "SALARY",
    data: { instructorId: "i", month: "2026-09", salary: "100000.00", teachingHours: 100 },
    userId: owner.id,
    schoolId: owner.schoolId,
    role: owner.role,
    status: "PENDING",
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0
  });
  await db.syncLease.put({ key: "training", owner: "closed-tab", expiresAt: Date.now() + 120000 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ownerSnapshot }));
  try {
    render(<TrainingPage user={owner} />);
    await act(async () => {
      await sendTraining(owner);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Restart sending" }));
    await waitFor(async () => expect(await db.trainingQueue.count()).toBe(0));
    expect(
      await screen.findByText(/All saved changes for this account have been sent/)
    ).toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
