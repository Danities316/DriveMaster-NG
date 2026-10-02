import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { OutboxMutationRecord } from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";
import { ConnectionStatus } from "./ConnectionStatus";

const record = (
  id: string,
  status: OutboxMutationRecord["status"],
  entity: OutboxMutationRecord["entity"] = "payment"
): OutboxMutationRecord => ({
  mutationId: id,
  deviceId: "device",
  schoolId: "school",
  entity,
  action: "CREATE",
  payload:
    entity === "payment" ? { studentId: "student", amount: "20000.00", method: "CASH" } : { id },
  createdAt: "2026-09-30T09:42:00.000Z",
  status,
  retryCount: 0,
  ...(status === "FAILED" ? { lastError: "Request returned 401" } : {})
});

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await db.syncState.put({
    deviceId: getOrCreateDeviceId(),
    schoolId: "school",
    lastPulledCursor: "0",
    lastSyncAt: null,
    bootstrapComplete: true
  });
  await db.students.put({
    id: "student",
    schoolId: "school",
    name: "Emeka Okon",
    phone: "08000000000",
    licenseNumber: null,
    enrollmentDate: "2026-01-01",
    totalTuition: "100000.00",
    amountPaid: "0.00",
    balanceRemaining: "100000.00",
    version: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  });
});
afterEach(() => vi.restoreAllMocks());

it("presents offline saving as safe rather than a failure", async () => {
  render(<ConnectionStatus schoolId="school" />);
  await screen.findByRole("heading", { name: "No saved records are waiting" });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("offline")));
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Offline");
  expect(status).toHaveTextContent("New work can still be saved on this device");
  expect(status).not.toHaveTextContent(/failed|lost/i);
});

it("shows actionable records before waiting records with human-readable details", async () => {
  await db.outbox.bulkPut([record("waiting", "PENDING"), record("failed", "FAILED")]);
  await db.syncState.update(getOrCreateDeviceId(), { authRequired: true });
  const { container } = render(<ConnectionStatus schoolId="school" />);
  const attention = await screen.findByRole("heading", { name: "Needs attention" });
  const waiting = screen.getByRole("heading", { name: "Waiting to be sent" });
  expect(
    attention.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  const cards = container.querySelectorAll(".saved-record-card");
  expect(cards).toHaveLength(2);
  expect(within(cards[0] as HTMLElement).getByRole("heading")).toHaveTextContent(
    "Payment — Emeka Okon"
  );
  expect(within(cards[0] as HTMLElement).getByText("₦20000.00 · Cash")).toBeVisible();
  expect(screen.getAllByText("Sign in again to send this record.").length).toBeGreaterThan(0);
  expect(container.querySelector("table")).toBeNull();
});

it("does not count accepted records as waiting after they leave the existing queue", async () => {
  await db.outbox.put(record("accepted-next", "PENDING"));
  const { rerender } = render(<ConnectionStatus schoolId="school" />);
  expect(await screen.findByText(/1 record is safely saved/)).toBeVisible();
  await act(async () => void (await db.outbox.delete("accepted-next")));
  rerender(<ConnectionStatus schoolId="school" />);
  expect(
    await screen.findByRole("heading", { name: "No saved records are waiting" })
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Waiting to be sent" })).toBeNull();
});
