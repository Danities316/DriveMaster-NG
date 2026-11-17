import { describe, expect, it } from "vitest";
import {
  calculateFuelDiscrepancyAlert,
  FUEL_DISCREPANCY_COST_NGN,
  FUEL_DISCREPANCY_DISTANCE_KM
} from "./fuelDiscrepancy.js";

const record = (
  overrides: Partial<{
    schoolId: string;
    vehicleId: string;
    date: string;
    createdAt: string;
    odometer: number;
    cost: string;
  }> = {}
) => ({
  schoolId: "school",
  vehicleId: "vehicle",
  date: "2026-01-02T10:00:00.000Z",
  createdAt: "2026-01-02T11:00:00.000Z",
  odometer: 1009,
  cost: FUEL_DISCREPANCY_COST_NGN,
  ...overrides
});
const previous = (overrides: Parameters<typeof record>[0] = {}) =>
  record({
    date: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T11:00:00.000Z",
    odometer: 0,
    ...overrides
  });

describe("fuel discrepancy alerts", () => {
  it("uses the strict distance boundary", () => {
    expect(FUEL_DISCREPANCY_DISTANCE_KM).toBe(10);
    expect(calculateFuelDiscrepancyAlert(record({ odometer: 9 }), [previous()])).toBe(true);
    expect(calculateFuelDiscrepancyAlert(record({ odometer: 10 }), [previous()])).toBe(false);
    expect(calculateFuelDiscrepancyAlert(record({ odometer: 10.1 }), [previous()])).toBe(false);
  });

  it("uses exact integer-cents comparison at the cost boundary", () => {
    expect(
      calculateFuelDiscrepancyAlert(record({ cost: "4999.99" }), [previous({ odometer: 1000 })])
    ).toBe(false);
    expect(
      calculateFuelDiscrepancyAlert(record({ cost: "5000.00" }), [previous({ odometer: 1000 })])
    ).toBe(true);
    expect(
      calculateFuelDiscrepancyAlert(record({ cost: "5001.00" }), [previous({ odometer: 1000 })])
    ).toBe(true);
  });

  it("does not alert for a vehicle's first fuel log", () => {
    expect(calculateFuelDiscrepancyAlert(record(), [])).toBe(false);
  });

  it("ignores earlier logs from another vehicle or school", () => {
    expect(
      calculateFuelDiscrepancyAlert(record(), [
        previous({ vehicleId: "other-vehicle", odometer: 1000 }),
        previous({ schoolId: "other-school", odometer: 1000 })
      ])
    ).toBe(false);
  });

  it("uses the most recent earlier date and ignores out-of-order future logs", () => {
    expect(
      calculateFuelDiscrepancyAlert(record(), [
        previous({ odometer: 1000 }),
        record({ date: "2026-01-03T10:00:00.000Z", odometer: 2000 })
      ])
    ).toBe(true);
  });

  it("uses createdAt to order fuel logs with the same entry date", () => {
    expect(
      calculateFuelDiscrepancyAlert(
        record({ odometer: 999 }),
        [
          record({
            date: "2026-01-02T10:00:00.000Z",
            createdAt: "2026-01-02T09:00:00.000Z",
            odometer: 980
          }),
          record({
            date: "2026-01-02T10:00:00.000Z",
            createdAt: "2026-01-02T10:00:00.000Z",
            odometer: 990
          })
        ]
      )
    ).toBe(true);
  });
});
