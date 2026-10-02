import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { calculateFuelConsumption, type Vehicle, type FuelLog } from "@drivemaster/shared";
import { FuelUsageCards } from "./FuelUsageCards";
const vehicle: Vehicle = {
  id: "v",
  schoolId: "s",
  model: "Toyota Corolla",
  plateNumber: "ABC123XY",
  status: "ACTIVE",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  fuelBenchmark: { minimum: "5", maximum: "10", allowancePercent: "0", notes: "Expected driving" }
};
const base = {
  schoolId: "s",
  vehicleId: "v",
  fullTank: true,
  discrepancyAlert: false,
  createdAt: "2026-01-01"
};
const fuel: FuelLog[] = [
  {
    ...base,
    id: "first",
    date: "2026-01-01T10:00:00Z",
    odometer: 1000,
    litres: "30",
    cost: "30000"
  },
  {
    ...base,
    id: "last",
    date: "2026-01-02T10:00:00Z",
    odometer: 1420,
    litres: "41.2",
    cost: "38500"
  }
];
function show(v = vehicle, logs = fuel, unconfirmedIds = new Set<string>()) {
  return render(
    <FuelUsageCards
      vehicles={[v]}
      cycles={calculateFuelConsumption(logs, "s", unconfirmedIds)}
      fuel={logs}
      unconfirmedIds={unconfirmedIds}
      flaggedOnly={false}
    />
  );
}
it("shows the conclusion and practical figures before unchanged full-tank metrics", () => {
  const { container } = show();
  expect(screen.getByRole("heading", { name: "Toyota Corolla · ABC123XY" })).toBeVisible();
  const conclusion = screen.getByRole("heading", { name: "Fuel usage looks normal" });
  expect(conclusion).toBeVisible();
  expect(screen.getByText("Distance recorded").parentElement).toHaveTextContent("420 km");
  expect(screen.getByText("Fuel spent in this period").parentElement).toHaveTextContent(
    "₦38,500.00"
  );
  expect(screen.getByText("L/100 km")).not.toBeVisible();
  expect(container.querySelector("table")).toBeNull();
  fireEvent.click(screen.getByText("See calculation"));
  expect(screen.getByText("L/100 km").parentElement).toHaveTextContent("9.81");
  expect(screen.getByText("km/L").parentElement).toHaveTextContent("10.19");
  expect(screen.getByText("Refill cost/km").parentElement).toHaveTextContent("₦91.67");
  expect(screen.getByText(/Fuel counted: 41.20 L/)).toBeVisible();
  expect(
    conclusion.compareDocumentPosition(screen.getByText("L/100 km")) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});
it.each([
  ["8", "Fuel usage is higher than expected"],
  ["20", "Fuel usage is lower than expected"]
])("uses the existing benchmark for a maximum of %s", (maximum, conclusion) => {
  show({
    ...vehicle,
    fuelBenchmark: {
      minimum: maximum === "20" ? "15" : "5",
      maximum,
      allowancePercent: "0",
      notes: "School range"
    }
  });
  expect(screen.getByRole("heading", { name: conclusion })).toBeVisible();
  expect(screen.queryByText(/theft|misconduct/i)).toBeNull();
});
it("does not call a valid calculation normal without a saved benchmark", () => {
  show({ ...vehicle, fuelBenchmark: undefined });
  expect(screen.getByRole("heading", { name: "Not enough information yet" })).toBeVisible();
  expect(screen.getByText(/fuel limit has not been set/)).toBeVisible();
  expect(screen.queryByText("Fuel usage looks normal")).toBeNull();
});
it.each(["one fill", "pending fill", "unknown tank"])(
  "does not replace insufficient %s data with zero consumption",
  (scenario) => {
    show(
      vehicle,
      scenario === "one fill"
        ? fuel.slice(0, 1)
        : scenario === "unknown tank"
          ? fuel.map((r) => ({ ...r, fullTank: null }))
          : fuel,
      new Set(scenario === "pending fill" ? ["last"] : [])
    );
    expect(screen.getByText("Not enough information yet")).toBeVisible();
    expect(screen.queryByText("L/100 km")).toBeNull();
    expect(screen.queryByText("Fuel usage looks normal")).toBeNull();
  }
);
it("excludes unsent purchases from accepted spending and retains incomplete spending as unknown", () => {
  const { rerender } = show(vehicle, fuel, new Set(["last"]));
  expect(screen.getByText(/Fuel purchases recorded/)).toHaveTextContent("₦30,000.00");
  rerender(
    <FuelUsageCards
      vehicles={[vehicle]}
      cycles={[]}
      fuel={[{ ...fuel[0]!, cost: "unknown" }]}
      unconfirmedIds={new Set()}
      flaggedOnly={false}
    />
  );
  expect(screen.getByText(/Fuel purchases recorded/)).toHaveTextContent(
    "Spending information incomplete"
  );
});
