import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  splitTrainingMoney,
  type TrainingOuting,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { FuelAccountability } from "./FuelAccountability";
import type { QueuedTraining } from "./trainingLocal";
import { fuelAccountability } from "./fuelAccountabilitySummary";
const trip: TrainingOuting = {
  instructorId: "i",
  vehicleId: "v",
  plannedStart: "2026-09-29T23:30:00Z",
  plannedEnd: "2026-09-30T00:30:00Z",
  startedAt: "2026-09-29T23:30:00Z",
  status: "COMPLETED",
  fuelPerStudent: "1500",
  allowanceReason: "Stored at booking",
  fuelIssued: "3000",
  fuelSpent: "2400",
  fuelReturned: "0",
  fuelSpendingBasis: "REPORTED",
  fuelLogId: "private-log-id",
  members: ["s", "g"].map((studentId) => ({
    studentId,
    enrollmentId: studentId,
    status: "CONFIRMED",
    minutes: 30,
    fuelCost: "1200"
  }))
};
const snapshot: TrainingSnapshot = {
  schoolId: "school",
  userId: "owner",
  viewerRole: "OWNER",
  settings: { id: "settings", version: 1, data: { fuelPerStudent: "9000", reason: "New rate" } },
  salaries: [],
  packages: [],
  enrollments: [],
  expenses: [],
  summaries: [],
  lessons: [],
  outings: [{ id: "trip", version: 3, data: trip }],
  students: [
    { id: "s", name: "Emeka", totalTuition: "150000" },
    { id: "g", name: "Grace", totalTuition: "150000" }
  ],
  instructors: [{ id: "i", name: "John" }],
  vehicles: [{ id: "v", plateNumber: "ABC123" }]
};
const record = (data = trip) => ({ ...snapshot, outings: [{ id: "trip", version: 3, data }] });
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
it.each([
  ["2400", "600", "Fuel money accounted for"],
  ["2400", "400", "₦200.00 still to return"],
  ["2400", "0", "₦600.00 still to return"],
  ["0", "3000", "Fuel money accounted for"],
  ["0", "0", "₦3,000.00 still to return"],
  ["3000", "0", "Fuel money accounted for"],
  ["3500", "0", "Fuel cost was ₦500.00 more than the money given"]
])(
  "presents the accepted chain for purchase %s and returned %s",
  (fuelSpent, fuelReturned, conclusion) => {
    render(
      <FuelAccountability
        snapshot={record({ ...trip, fuelSpent, fuelReturned })}
        pending={() => false}
        onSave={vi.fn()}
      />
    );
    const card = screen.getByRole("article", { name: "Fuel money for Emeka and Grace" });
    expect(card).toHaveTextContent(conclusion);
    expect(within(card).getByText("Fuel money given").parentElement).toHaveTextContent("₦3,000.00");
    expect(within(card).getByText("Returned").parentElement).toHaveTextContent(
      new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
        Number(fuelReturned)
      )
    );
    expect(card).toHaveTextContent("2026-09-30");
    expect(card).toHaveTextContent("John");
    expect(card).toHaveTextContent("ABC123");
    expect(card.querySelector("table")).toBeNull();
    expect(card).not.toHaveTextContent(/instructor debt|theft|missing money/i);
    if (fuelSpent === "2400")
      expect(within(card).getByText("Should return").parentElement).toHaveTextContent("₦600.00");
    if (fuelSpent === "3500") {
      expect(within(card).getByText("Should return").parentElement).toHaveTextContent("₦0.00");
      expect(within(card).queryByText("Record return")).toBeNull();
    }
    if (fuelSpent === "0") expect(card).toHaveTextContent("No fuel was bought");
  }
);
it("preserves stored historical amounts and keeps trip purchase distinct from student shares", () => {
  const data = {
    ...trip,
    fuelPerStudent: "1000",
    fuelIssued: "2000",
    fuelSpent: "1600",
    fuelReturned: "400"
  };
  render(<FuelAccountability snapshot={record(data)} pending={() => false} onSave={vi.fn()} />);
  expect(screen.getByText("Fuel money given").parentElement).toHaveTextContent("₦2,000.00");
  expect(screen.getByText("Fuel bought").parentElement).toHaveTextContent("₦1,600.00");
  fireEvent.click(screen.getByText("View fuel details"));
  expect(screen.getByText(/Stored fuel money per student/)).toHaveTextContent("₦1,000.00");
  expect(screen.getByText(/whole trip's fuel purchase/)).toBeVisible();
  expect(screen.getByText(/purchase receipt, litres/)).toBeVisible();
  expect(screen.queryByText("private-log-id")).toBeNull();
  expect(splitTrainingMoney("2400", 2)).toEqual(["1200.00", "1200.00"]);
  expect(trip.members.map((m) => m.fuelCost)).toEqual(["1200", "1200"]);
});
it.each(["fuelIssued", "fuelSpent", "fuelReturned"] as const)(
  "does not turn missing %s into a zero or a settled record",
  (field) => {
    render(
      <FuelAccountability
        snapshot={record({ ...trip, [field]: undefined })}
        pending={() => false}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText("Fuel information incomplete")).toBeVisible();
    expect(screen.queryByText(/Fuel money accounted for/)).toBeNull();
    expect(screen.queryByText("Known money still to return")).toBeNull();
    expect(screen.queryByText("Record return")).toBeNull();
  }
);
it("labels legacy allowance-based spending without claiming a reported purchase or settlement", () => {
  render(
    <FuelAccountability
      snapshot={record({ ...trip, fuelSpendingBasis: "LEGACY_ALLOWANCE", fuelSpent: "3000" })}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText(/Older record: spending/)).toBeVisible();
  expect(screen.getByText("Fuel bought").parentElement).toHaveTextContent("allowance-based record");
  expect(screen.queryByText(/Fuel money accounted for/)).toBeNull();
});
it("keeps unfinished trips out of confirmed spending and return totals", () => {
  render(
    <FuelAccountability
      snapshot={record({
        ...trip,
        status: "STARTED",
        fuelSpent: undefined,
        fuelReturned: undefined
      })}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText("Fuel bought").parentElement).toHaveTextContent("Training not finished");
  expect(screen.queryByText("Known money still to return")).toBeNull();
  expect(screen.queryByText("Record return")).toBeNull();
});
const queued = (action: string, status: "PENDING" | "FAILED" = "PENDING"): QueuedTraining => ({
  id: "queued",
  action,
  targetId: "trip",
  data: { amount: "600" },
  expectedVersion: 3,
  userId: "owner",
  schoolId: "school",
  role: "OWNER",
  status,
  createdAt: 1,
  attempts: 0,
  nextAttemptAt: 0
});
it.each(["PENDING", "FAILED"] as const)("does not count a %s return as accepted", (status) => {
  render(
    <FuelAccountability
      snapshot={snapshot}
      changes={[queued("RETURN_FUEL", status)]}
      pending={() => true}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText("Returned").parentElement).toHaveTextContent("₦0.00");
  expect(screen.queryByText(/Fuel money accounted for/)).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(
    status === "FAILED" ? "needs attention" : "Saved on this device"
  );
  fireEvent.click(screen.getByText("Record return", { selector: "summary" }));
  expect(screen.getByRole("button", { name: "Record return" })).toBeDisabled();
});
it.each(["START", "FINISH"])("keeps a locally saved %s separate from school records", (action) => {
  render(
    <FuelAccountability
      snapshot={record({
        ...trip,
        status: action === "START" ? "BOOKED" : "STARTED",
        fuelIssued: action === "START" ? undefined : "3000",
        fuelSpent: undefined,
        fuelReturned: undefined
      })}
      changes={[queued(action)]}
      pending={() => true}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByRole("status")).toHaveTextContent("Saved on this device");
  expect(screen.queryByText(/Fuel money accounted for/)).toBeNull();
});
it("validates an incremental return against money still due and updates only after accepted records arrive", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <FuelAccountability
      snapshot={record({ ...trip, fuelReturned: "400" })}
      pending={() => false}
      onSave={save}
    />
  );
  fireEvent.click(screen.getByText("Record return", { selector: "summary" }));
  change("Money returned (₦)", "201");
  change("Return note or receipt reference", "Cash received");
  fireEvent.click(screen.getByRole("button", { name: "Record return" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Money returned cannot be more than the unspent fuel money"
  );
  expect(save).not.toHaveBeenCalled();
  change("Money returned (₦)", "200");
  fireEvent.click(screen.getByRole("button", { name: "Record return" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "RETURN_FUEL",
      "trip",
      { amount: "200", reason: "Cash received" },
      3
    )
  );
  expect(screen.getByText("Returned").parentElement).toHaveTextContent("₦400.00");
  expect(screen.getByRole("status")).toHaveTextContent("saved on this device");
  expect(screen.queryByText(/Fuel money accounted for/)).toBeNull();
  rerender(
    <FuelAccountability
      snapshot={{
        ...snapshot,
        outings: [{ id: "trip", version: 4, data: { ...trip, fuelReturned: "600" } }]
      }}
      pending={() => false}
      onSave={save}
    />
  );
  expect(screen.getByText(/Fuel money accounted for/)).toBeVisible();
});
it("requires a positive return and a note, and preserves server errors", async () => {
  const save = vi.fn().mockRejectedValue(new Error("This trip changed. Refresh first."));
  render(<FuelAccountability snapshot={snapshot} pending={() => false} onSave={save} />);
  fireEvent.click(screen.getByText("Record return", { selector: "summary" }));
  change("Money returned (₦)", "0");
  fireEvent.click(screen.getByRole("button", { name: "Record return" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("greater than ₦0");
  change("Money returned (₦)", "50");
  fireEvent.click(screen.getByRole("button", { name: "Record return" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter a return note");
  change("Return note or receipt reference", "Cash");
  fireEvent.click(screen.getByRole("button", { name: "Record return" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This trip changed. Refresh first.");
  expect(screen.getByLabelText("Money returned (₦)")).toHaveValue(50);
});
it("puts exceptions first and never offsets an outstanding return with overspending", () => {
  render(
    <FuelAccountability
      snapshot={{
        ...snapshot,
        outings: [
          { id: "settled", version: 1, data: { ...trip, fuelReturned: "600" } },
          { id: "over", version: 1, data: { ...trip, fuelSpent: "3500" } },
          { id: "due", version: 1, data: trip },
          { id: "missing", version: 1, data: { ...trip, fuelIssued: undefined } }
        ]
      }}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText("Known money still to return")).toHaveTextContent("₦600.00");
  expect(screen.getByText("3 trips need attention")).toBeVisible();
  expect(screen.getAllByRole("article").at(-1)).toHaveTextContent("Fuel money accounted for");
});
it.each(["RECEPTIONIST", "INSTRUCTOR", "STUDENT"])("hides accountability from %s", (viewerRole) => {
  const { container } = render(
    <FuelAccountability
      snapshot={{ ...snapshot, viewerRole }}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(container).toBeEmptyDOMElement();
});
it("rejects inconsistent totals and preserves kobo precision", () => {
  expect(fuelAccountability({ ...trip, fuelReturned: "601" }).state).toBe("INCOMPLETE");
  expect(fuelAccountability({ ...trip, fuelSpent: "2399.99", fuelReturned: "400" })).toMatchObject({
    shouldReturn: "600.01",
    due: "200.01"
  });
});
