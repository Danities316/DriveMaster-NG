import { describe, expect, it } from "vitest";
import type { FuelLog } from "./domain.js";
import { calculateFuelConsumption } from "./fuelConsumption.js";

const fill = (day: number, odometer: number, patch: Partial<FuelLog> = {}): FuelLog => ({
  id: String(day),
  schoolId: "s",
  vehicleId: "v",
  date: `2026-01-${String(day).padStart(2, "0")}T10:00:00Z`,
  odometer,
  litres: "20.00",
  cost: "20000.00",
  fullTank: true,
  discrepancyAlert: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...patch
});
describe("full-tank consumption", () => {
  it("excludes the opening fill and includes partial and closing fills in date order", () => {
    const rows = [
      fill(3, 1500),
      fill(1, 1000, { litres: "99.00" }),
      fill(2, 1200, { fullTank: false, litres: "10.00", cost: "10000.00" })
    ];
    expect(calculateFuelConsumption(rows, "s")[0]).toMatchObject({
      distanceKm: 500,
      litres: "30.00",
      refillCost: "30000.00",
      fillCount: 2,
      litresPer100Km: 6,
      kmPerLitre: 500 / 30,
      refillCostPerKm: 60
    });
    expect(rows[0]?.id).toBe("3");
  });
  it("reuses a closing full tank as the next baseline without double counting", () => {
    expect(
      calculateFuelConsumption([fill(1, 1000), fill(2, 1200), fill(3, 1400)], "s").map(
        (row) => row.litres
      )
    ).toEqual(["20.00", "20.00"]);
  });
  it("does not calculate open cycles or zero-distance cycles", () => {
    expect(
      calculateFuelConsumption(
        [fill(1, 1000), fill(2, 1000), fill(3, 1100, { fullTank: false })],
        "s"
      )
    ).toEqual([]);
  });
  it.each([{ fullTank: null }, { litres: "0" }, { cost: "bad" }, { odometer: 900 }])(
    "breaks an uncertain or invalid cycle: %j",
    (patch) => {
      expect(
        calculateFuelConsumption(
          [fill(1, 1000), fill(2, 1100, { fullTank: false, ...patch }), fill(3, 1300)],
          "s"
        )
      ).toEqual([]);
    }
  );
  it("does not silently omit pending or rejected partial fills and resumes after a new baseline", () => {
    const rows = [fill(1, 1000), fill(2, 1100, { fullTank: false }), fill(3, 1300), fill(4, 1500)];
    expect(calculateFuelConsumption(rows, "s", new Set(["2"])).map((row) => row.startId)).toEqual([
      "3"
    ]);
  });
  it("isolates schools and vehicles", () => {
    expect(
      calculateFuelConsumption(
        [
          fill(1, 1000),
          fill(2, 1200, { schoolId: "other" }),
          fill(3, 1300, { vehicleId: "other" })
        ],
        "s"
      )
    ).toEqual([]);
  });
  it("blocks ambiguous same-time fills", () => {
    expect(
      calculateFuelConsumption(
        [fill(1, 1000), fill(2, 1200), fill(2, 1200, { id: "duplicate" })],
        "s"
      )
    ).toEqual([]);
  });
  it("sums decimal purchases exactly", () => {
    expect(
      calculateFuelConsumption(
        [
          fill(1, 1000),
          fill(2, 1100, { fullTank: false, litres: "0.10", cost: "0.10" }),
          fill(3, 1200, { litres: "0.20", cost: "0.20" })
        ],
        "s"
      )[0]
    ).toMatchObject({ litres: "0.30", refillCost: "0.30" });
  });
});
