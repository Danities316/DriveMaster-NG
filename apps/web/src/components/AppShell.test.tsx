import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthenticatedUser, OutboxMutationRecord } from "@drivemaster/shared";
import { db } from "../db/db";
import { AppShell } from "./AppShell";

const user: AuthenticatedUser = {
  id: "owner",
  schoolId: "school",
  role: "OWNER",
  name: "School Owner",
  phone: "08000000000"
};
const outbox: OutboxMutationRecord = {
  mutationId: "failed",
  deviceId: "device",
  schoolId: "school",
  entity: "payment",
  action: "CREATE",
  payload: { studentId: "student", amount: "20000", method: "CASH" },
  createdAt: "2026-09-30T10:00:00Z",
  status: "FAILED",
  retryCount: 1
};

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

it("prioritizes attention and counts only this account's saved training records", async () => {
  await db.outbox.put(outbox);
  await db.trainingQueue.bulkPut([
    {
      id: "own",
      targetId: "outing",
      action: "START",
      data: {},
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
      status: "PENDING",
      createdAt: 1,
      attempts: 0,
      nextAttemptAt: 0
    },
    {
      id: "other",
      targetId: "outing-2",
      action: "FINISH",
      data: {},
      userId: "other",
      schoolId: user.schoolId,
      role: user.role,
      status: "FAILED",
      createdAt: 2,
      attempts: 1,
      nextAttemptAt: 0
    }
  ]);
  render(
    <AppShell user={user} section="home" onNavigate={() => {}} onLogout={() => {}}>
      <p>Content</p>
    </AppShell>
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("1 record needs attention")
  );
  await act(async () => void (await db.outbox.delete("failed")));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("1 record waiting to be sent")
  );
});

it("explains that work can still be saved while offline", async () => {
  render(
    <AppShell user={user} section="home" onNavigate={() => {}} onLogout={() => {}}>
      <p>Content</p>
    </AppShell>
  );
  await screen.findByText("Content");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("status")).toHaveTextContent("Offline · work can still be saved");
});

it("uses the five plain owner destinations and routes every primary action", () => {
  const onNavigate = vi.fn();
  render(
    <AppShell user={user} section="home" onNavigate={onNavigate} onLogout={() => {}}>
      <p>Content</p>
    </AppShell>
  );
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  for (const destination of ["Home", "Students", "Training", "Money", "More"])
    fireEvent.click(within(navigation).getByRole("button", { name: destination }));
  expect(onNavigate.mock.calls.map(([section]) => section)).toEqual([
    "home",
    "students",
    "training",
    "money",
    "more"
  ]);
  expect(within(navigation).queryByText("Overview")).toBeNull();
  expect(within(navigation).queryByText("Payments")).toBeNull();
  expect(within(navigation).queryByText("Mileage & fuel")).toBeNull();
  expect(within(navigation).queryByText("Saved records")).toBeNull();
});

it.each([
  ["RECEPTIONIST", ["Home", "Students", "Training", "Money", "More"]],
  ["INSTRUCTOR", ["Home", "Training"]],
  ["STUDENT", []]
] as const)("shows only permitted navigation to %s", (role, allowed) => {
  render(
    <AppShell user={{ ...user, role }} section="home" onNavigate={() => {}} onLogout={() => {}}>
      <p>Content</p>
    </AppShell>
  );
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  expect(
    within(navigation)
      .queryAllByRole("button")
      .map((button) => button.textContent)
  ).toEqual(allowed);
  if (!["OWNER", "RECEPTIONIST"].includes(role))
    expect(screen.queryByRole("button", { name: "Find a student" })).toBeNull();
});
