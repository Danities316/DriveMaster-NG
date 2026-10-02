import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TrainingOuting } from "@drivemaster/shared";
import { FinishOutingForm, StartOutingForm } from "./LessonWorkflow";
const start = new Date(Date.now() - 7200000);
start.setSeconds(0, 0);
const local = (d: Date) => new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const outing: TrainingOuting = {
  instructorId: "i",
  vehicleId: "v",
  plannedStart: start.toISOString(),
  plannedEnd: new Date(+start + 3600000).toISOString(),
  startedAt: start.toISOString(),
  startOdometer: 100,
  status: "STARTED",
  fuelPerStudent: "1500.00",
  fuelIssued: "3000.00",
  allowanceReason: "Default",
  members: ["a", "b"].map((studentId) => ({
    studentId,
    enrollmentId: studentId,
    status: "DRIVING",
    minutes: 0
  }))
};
const name = (id: string) => (id === "a" ? "Ada" : "Bola");
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
it("puts attendance first, allows deselection and requires a valid starting mileage", () => {
  const save = vi.fn();
  const { container } = render(
    <StartOutingForm outing={outing} name={name} disabled={false} onSave={save} />
  );
  expect(container.querySelector("fieldset legend")).toHaveTextContent("Who is here");
  fireEvent.click(screen.getByLabelText("Ada"));
  fireEvent.click(screen.getByLabelText("Bola"));
  expect(screen.getByRole("status")).toHaveTextContent("₦3,000.00");
  fireEvent.click(screen.getByLabelText("Bola"));
  expect(screen.getByRole("status")).toHaveTextContent("Based on 1 student attending");
  const mileage = screen.getByLabelText("Starting mileage (km)");
  expect(mileage).toBeRequired();
  expect(mileage).toHaveAttribute("inputmode", "numeric");
  fireEvent.click(screen.getByRole("button", { name: "Start training" }));
  expect(save).not.toHaveBeenCalled();
  change("Starting mileage (km)", "-1");
  expect(mileage).toBeInvalid();
});
function drivingDetails() {
  change("Actual finish time", local(new Date(+start + 3600000)));
  change("Ending mileage (km)", "125462");
  change("Topics taught — Emeka", "Braking");
  change("Topics taught — Grace", "Turning");
}
const example = { ...outing, startOdometer: 125430 };
const exampleName = (id: string) => (id === "a" ? "Emeka" : "Grace");
it("records the Emeka and Grace example with 32 km, separate lessons and 600 to return", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<FinishOutingForm outing={example} name={exampleName} disabled={false} onSave={save} />);
  expect(screen.getByText(/Starting mileage:/)).toHaveTextContent("125,430 km");
  drivingDetails();
  expect(screen.getByRole("status")).toHaveTextContent("Distance driven: 32 km");
  expect(screen.getByLabelText("Notes (optional) — Emeka")).not.toBeRequired();
  expect(screen.getByLabelText("Topics taught — Grace")).toBeRequired();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  change("Amount spent (₦)", "2400");
  expect(screen.getByRole("status")).toHaveTextContent("Money to return₦600.00");
  change("Fuel bought (litres)", "2.4");
  change("Fuel receipt reference", "EXAMPLE-1");
  change("Fuel purchase time", local(new Date(+start + 600000)));
  change("Mileage when fuel was bought (km)", "125440");
  change("Did this purchase fill the tank completely?", "no");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const summary = screen.getByRole("region", { name: "Lesson summary" });
  expect(summary).toHaveTextContent("Distance driven: 32 km");
  expect(within(summary).getByRole("status")).toHaveTextContent("Money to return₦600.00");
  expect(summary).toHaveTextContent("owner records money actually returned separately");
  expect(screen.queryByLabelText("Money returned")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Finish training" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      odometer: 125462,
      fuelSpent: "2400",
      lessons: [
        { studentId: "a", minutes: 30, topics: "Braking", note: "" },
        { studentId: "b", minutes: 30, topics: "Turning", note: "" }
      ]
    })
  );
});
it.each([
  ["3000", "Money to return₦0.00"],
  ["3500", "Fuel cost is ₦500.00 more than the fuel money given."],
  ["2399.99", "Money to return₦600.01"]
])("calculates the live fuel balance for spending %s", (amount, expected) => {
  render(
    <FinishOutingForm outing={example} name={exampleName} disabled={false} onSave={vi.fn()} />
  );
  drivingDetails();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  change("Amount spent (₦)", amount);
  expect(screen.getByRole("status")).toHaveTextContent(expected);
  change("Was fuel bought during this trip?", "no");
  expect(screen.getByRole("status")).toHaveTextContent("Money to return₦3,000.00");
});
it("rejects lower mileage and missing topics with focused field errors, but permits short lessons", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<FinishOutingForm outing={example} name={exampleName} disabled={false} onSave={save} />);
  drivingDetails();
  const mileage = screen.getByLabelText("Ending mileage (km)");
  fireEvent.change(mileage, { target: { value: "125429" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Ending mileage cannot be lower than starting mileage."
  );
  expect(mileage).toHaveFocus();
  fireEvent.input(mileage, { target: { value: "125462" } });
  const topics = screen.getByLabelText("Topics taught — Grace");
  fireEvent.change(topics, { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter what was taught during this lesson.");
  expect(topics).toHaveFocus();
  fireEvent.input(topics, { target: { value: "Turning" } });
  change("Driving minutes — Emeka", "20");
  change("Driving minutes — Grace", "0");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  change("Was fuel bought during this trip?", "no");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish training" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        fuelSpent: "0.00",
        lessons: [
          { studentId: "a", minutes: 20, topics: "Braking", note: "" },
          { studentId: "b", minutes: 0, topics: "Turning", note: "" }
        ]
      })
    )
  );
});
it("identifies the student whose driving time is missing", () => {
  render(
    <FinishOutingForm outing={example} name={exampleName} disabled={false} onSave={vi.fn()} />
  );
  drivingDetails();
  change("Driving minutes — Grace", "");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter driving time for Grace");
});
it("requires actual attendance selection and calculates the correct fuel total", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<StartOutingForm outing={outing} name={name} disabled={false} onSave={onSave} />);
  expect(screen.getByRole("button", { name: "Start training" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Ada"));
  expect(screen.getByRole("status")).toHaveTextContent("₦1,500.00");
  change("Starting mileage (km)", "100");
  fireEvent.click(screen.getByRole("button", { name: "Start training" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ present: ["a"], odometer: 100 }))
  );
});
it("preserves entries between steps and saves the reviewed lesson and fuel details once", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<FinishOutingForm outing={outing} name={name} disabled={false} onSave={onSave} />);
  change("Actual finish time", local(new Date(+start + 3600000)));
  change("Ending mileage (km)", "120");
  change("Topics taught — Ada", "Braking");
  change("Topics taught — Bola", "Turning");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("heading", { name: /Step 2/ })).toBeInTheDocument();
  change("Fuel bought (litres)", "3");
  change("Fuel receipt reference", "TEST-1");
  change("Fuel purchase time", local(new Date(+start + 600000)));
  change("Mileage when fuel was bought (km)", "105");
  change("Did this purchase fill the tank completely?", "no");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Topics taught — Ada")).toHaveValue("Braking");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Fuel receipt reference")).toHaveValue("TEST-1");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Lesson summary" })).toHaveTextContent("₦3,000.00");
  fireEvent.click(screen.getByRole("button", { name: "Finish training" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      odometer: 120,
      fuelOdometer: 105,
      fullTank: false,
      receiptReference: "TEST-1",
      lessons: [
        { studentId: "a", minutes: 30, topics: "Braking", note: "" },
        { studentId: "b", minutes: 30, topics: "Turning", note: "" }
      ]
    })
  );
});
it("keeps an impossible driving duration on the first step with a useful error", () => {
  const onSave = vi.fn();
  render(<FinishOutingForm outing={outing} name={name} disabled={false} onSave={onSave} />);
  change("Actual finish time", local(new Date(+start + 1800000)));
  change("Ending mileage (km)", "120");
  change("Topics taught — Ada", "Braking");
  change("Topics taught — Bola", "Turning");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert")).toHaveTextContent("60 driving minutes");
  expect(screen.getByRole("heading", { name: /Step 1/ })).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
