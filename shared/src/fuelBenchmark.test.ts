import { expect, it } from "vitest";
import { assessFuelConsumption, parseFuelBenchmark } from "./fuelBenchmark.js";
import type { FuelConsumptionInterval } from "./fuelConsumption.js";
const benchmark = {
  minimum: "5",
  maximum: "10",
  allowancePercent: "20",
  notes: "Observed lessons"
};
const cycle = (litres = "60.00"): FuelConsumptionInterval => ({
  vehicleId: "v",
  startId: "a",
  endId: "b",
  startDate: "2026-01-01",
  endDate: "2026-01-02",
  distanceKm: 500,
  litres,
  refillCost: "60000.00",
  fillCount: 2,
  litresPer100Km: Number(litres) / 5,
  kmPerLitre: 500 / Number(litres),
  refillCostPerKm: 120
});
it("normalizes and validates an explicit range and operating allowance", () => {
  expect(parseFuelBenchmark(benchmark)).toEqual({
    minimum: "5.00",
    maximum: "10.00",
    allowancePercent: "20.00",
    notes: "Observed lessons"
  });
});
it.each([
  { minimum: "0" },
  { maximum: "4" },
  { maximum: "1000" },
  { minimum: "1.001" },
  { allowancePercent: "101" },
  { allowancePercent: "-1" },
  { notes: " " },
  { notes: "x".repeat(501) }
])("rejects invalid benchmark %j", (patch) => {
  expect(() => parseFuelBenchmark({ ...benchmark, ...patch })).toThrow();
});
it("does not flag an exact limit and flags a value above it before rounding", () => {
  expect(assessFuelConsumption(cycle(), benchmark)).toMatchObject({
    status: "within_limit",
    limit: 12
  });
  expect(assessFuelConsumption(cycle("60.01"), benchmark)).toMatchObject({
    status: "above_limit",
    limit: 12
  });
});
it("explains percentage and litres above the allowance", () => {
  expect(assessFuelConsumption(cycle("75.00"), benchmark)).toEqual({
    status: "above_limit",
    limit: 12,
    excessPercent: 25,
    excessLitres: 15
  });
});
it("distinguishes low readings and missing or malformed benchmarks", () => {
  expect(assessFuelConsumption(cycle("20.00"), benchmark).status).toBe("below_range");
  expect(assessFuelConsumption(cycle(), null).status).toBe("not_configured");
  expect(assessFuelConsumption(cycle(), { ...benchmark, maximum: "invalid" }).status).toBe(
    "not_configured"
  );
});
it("handles fractional percentage allowances exactly", () => {
  const settings = { ...benchmark, maximum: "10.01", allowancePercent: "0.01" };
  expect(assessFuelConsumption(cycle("50.06"), settings).status).toBe("above_limit");
  expect(assessFuelConsumption(cycle("50.05"), settings).status).toBe("within_limit");
});
