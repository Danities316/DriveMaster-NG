import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../../db/db";
import { FleetPage } from "./FleetPage";
const user = { id: "u", schoolId: "s", name: "Owner", phone: "test", role: "OWNER" as const };
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  await db.vehicles.put({
    id: "v",
    schoolId: "s",
    plateNumber: "ABC123",
    model: "Corolla",
    status: "ACTIVE",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01"
  });
});
it("lets an owner configure a benchmark while keeping it pending until synchronized", async () => {
  render(<FleetPage user={user} />);
  fireEvent.change(await screen.findByLabelText("Vehicle"), { target: { value: "v" } });
  fireEvent.click(screen.getByText("Expected fuel use settings"));
  fireEvent.click(screen.getByRole("button", { name: "Set expected fuel use" }));
  fireEvent.change(screen.getByLabelText("Minimum L/100 km"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Maximum L/100 km"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/Lesson \/ idling allowance/), {
    target: { value: "20" }
  });
  fireEvent.change(screen.getByLabelText("Why did you choose these figures?"), {
    target: { value: "Observed lessons" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save fuel limit" }));
  expect(await screen.findByText("Fuel limit waiting to be sent")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set expected fuel use" })).toBeDisabled();
  expect((await db.vehicles.get("v"))?.fuelBenchmark).toBeUndefined();
  expect((await db.outbox.toArray())[0]?.expectedVersion).toBe(0);
});
it("shows a clear discrepancy explanation and a filter, without owner editing controls for receptionists", async () => {
  await db.vehicles.update("v", {
    benchmarkVersion: 1,
    fuelBenchmark: {
      minimum: "5.00",
      maximum: "10.00",
      allowancePercent: "20.00",
      notes: "Lessons"
    }
  });
  const common = {
    schoolId: "s",
    vehicleId: "v",
    fullTank: true,
    cost: "60000.00",
    discrepancyAlert: false,
    createdAt: "2026-01-01"
  };
  await db.fuelLogs.bulkAdd([
    { ...common, id: "a", date: "2026-01-01T10:00:00Z", odometer: 1000, litres: "20.00" },
    { ...common, id: "b", date: "2026-01-02T10:00:00Z", odometer: 1500, litres: "75.00" },
    { ...common, id: "c", date: "2026-01-03T10:00:00Z", odometer: 2000, litres: "60.00" }
  ]);
  render(<FleetPage user={{ ...user, role: "RECEPTIONIST" }} />);
  expect(await screen.findByText("Fuel usage is higher than expected")).toBeInTheDocument();
  expect(screen.getByText(/25.00% over limit/)).toHaveTextContent(
    "15.00 L above allowance for 500 km"
  );
  expect(screen.getByText("Fuel usage looks normal")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Show only high fuel use"));
  expect(screen.queryByText("Fuel usage looks normal")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Vehicle"), { target: { value: "v" } });
  fireEvent.click(screen.getByText("Expected fuel use settings"));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Expected fuel use · ABC123" })).toBeInTheDocument()
  );
  expect(
    screen.queryByRole("button", { name: "Change expected fuel use" })
  ).not.toBeInTheDocument();
});
