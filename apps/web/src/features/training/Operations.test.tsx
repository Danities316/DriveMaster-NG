import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TrainingSnapshot, TrainingOuting } from "@drivemaster/shared";
import { FinishOutingForm } from "./LessonWorkflow";
import { DocumentReminders } from "./DocumentReminders";
import { CostReport } from "./CostReport";
import { VehicleDocumentsSettings } from "./VehicleDocumentsSettings";
const snapshot = {
  schoolId: "school",
  viewerRole: "OWNER",
  instructors: [],
  vehicles: [{ id: "v", plateNumber: "ABC123" }],
  vehicleDocuments: [],
  instructorPermitDates: [],
  students: [{ id: "s", name: "Ada" }],
  enrollments: [{ id: "e", version: 0, data: { studentId: "s" } }],
  summaries: [],
  expenses: [],
  outings: []
} as unknown as TrainingSnapshot;
it("finishes a lesson without requiring hidden purchase fields when no fuel was bought", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const outing = {
    status: "STARTED",
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    startOdometer: 100,
    fuelIssued: "1500",
    members: [{ studentId: "s", status: "DRIVING", minutes: 0 }]
  } as TrainingOuting;
  render(<FinishOutingForm outing={outing} name={() => "Ada"} disabled={false} onSave={save} />);
  fireEvent.change(screen.getByLabelText("Ending mileage (km)"), { target: { value: "110" } });
  fireEvent.change(screen.getByLabelText("Topics taught — Ada"), {
    target: { value: "Steering" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Was fuel bought during this trip?"), {
    target: { value: "no" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish training" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ fuelSpent: "0.00", odometer: 110 }))
  );
  expect(save.mock.calls[0]?.[0]).not.toHaveProperty("receiptReference");
});
it("shows missing document reminders and takes the owner to the settings", () => {
  const onSettings = vi.fn();
  render(<DocumentReminders snapshot={snapshot} onSettings={onSettings} />);
  fireEvent.click(screen.getByText("2 document reminders to check"));
  expect(screen.getAllByText(/Expiry date not entered/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Update document details" }));
  expect(onSettings).toHaveBeenCalledOnce();
});
it("queues vehicle expiry dates without changing confirmed records", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<VehicleDocumentsSettings snapshot={snapshot} pending={() => false} onSave={save} />);
  fireEvent.click(screen.getByText("Vehicle insurance and roadworthiness dates"));
  fireEvent.change(screen.getByLabelText("Vehicle to update"), { target: { value: "v" } });
  expect(screen.getByRole("heading", { name: "Insurance" })).toBeVisible();
  expect(screen.getAllByText("Missing")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Insurance expiry date"), {
    target: { value: "2027-01-01" }
  });
  fireEvent.change(screen.getByLabelText("Reason for updating vehicle documents"), {
    target: { value: "Renewed" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save vehicle document dates" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "VEHICLE_DOCUMENTS",
      "documents-v",
      {
        vehicleId: "v",
        insuranceExpiryDate: "2027-01-01",
        roadworthinessExpiryDate: "",
        reason: "Renewed"
      },
      undefined
    )
  );
});
it("rejects an invalid split before queueing, then lets an owner allocate an estimate", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<CostReport snapshot={snapshot} pending={() => false} onSave={save} />);
  expect(screen.getByText(/not final business profit/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Add expense"));
  fireEvent.change(screen.getByLabelText("What was this expense for?"), {
    target: { value: "Books" }
  });
  fireEvent.change(screen.getByLabelText("Amount (₦)"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Recorded cost or estimate?"), {
    target: { value: "ESTIMATE" }
  });
  fireEvent.change(screen.getByLabelText("Who was this expense for?"), {
    target: { value: "ONE" }
  });
  fireEvent.change(screen.getByLabelText("Student"), { target: { value: "s" } });
  fireEvent.click(screen.getByText("More options"));
  fireEvent.change(screen.getByLabelText("Description or reason"), {
    target: { value: "Expected workbook" }
  });
  fireEvent.change(screen.getByLabelText("How should the cost be shared?"), {
    target: { value: "CUSTOM" }
  });
  fireEvent.change(screen.getByLabelText("Ada: share (₦)"), { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The student shares must add up");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("How should the cost be shared?"), {
    target: { value: "EQUAL" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "EXPENSE",
      expect.any(String),
      expect.objectContaining({
        category: "Books",
        amount: "500",
        basis: "ESTIMATE",
        studentIds: ["s"],
        allocationMode: "EQUAL"
      })
    )
  );
});
