import { describe, expect, it } from "vitest";
import { parseFleetInput, validateOdometer } from "./fleet.js";
const base = {
  id: "b4e9f6bc-39e4-4dd1-95aa-f1f007ec5c48",
  vehicleId: "v",
  date: "2026-01-02T10:00:00Z",
  odometer: 1500,
  driverName: " Ada ",
  notes: ""
};
const fuel = { ...base, litres: "20", cost: "19000", receiptReference: " rec-1 ", fullTank: true };
describe("fleet validation", () => {
  it("normalizes plates, money, references and dates", () => {
    expect(
      parseFleetInput("vehicle", { id: base.id, plateNumber: " abc-123 xy ", model: " Corolla " })
    ).toMatchObject({ plateNumber: "ABC123XY", model: "Corolla" });
    expect(parseFleetInput("fuel_log", fuel)).toMatchObject({
      litres: "20.00",
      cost: "19000.00",
      receiptReference: "REC-1",
      driverName: "Ada",
      notes: null,
      date: "2026-01-02T10:00:00.000Z"
    });
  });
  it.each([-1, 1.5, NaN, 2147483648])("rejects invalid odometer %s", (odometer) => {
    expect(() => parseFleetInput("mileage_log", { ...base, odometer })).toThrow(/Odometer/);
  });
  it.each([
    { litres: "0" },
    { cost: "-10" },
    { litres: "1000000" },
    { cost: "1.001" },
    { receiptReference: " " },
    { fullTank: undefined },
    { driverName: "" },
    { date: "2026-02-30T10:00:00Z" },
    { date: "2999-01-01T10:00:00Z" }
  ])("rejects invalid fuel field %j", (patch) => {
    expect(() => parseFleetInput("fuel_log", { ...fuel, ...patch })).toThrow();
  });
  it("checks both sides of backdated readings and equal timestamps", () => {
    const history = [
      { date: "2026-01-01T10:00:00Z", odometer: 1000 },
      { date: "2026-01-03T10:00:00Z", odometer: 2000 }
    ];
    expect(() => validateOdometer(base, history)).not.toThrow();
    expect(() => validateOdometer({ ...base, odometer: 999 }, history)).toThrow();
    expect(() => validateOdometer({ ...base, odometer: 2001 }, history)).toThrow();
    expect(() => validateOdometer(base, [{ date: base.date, odometer: 1501 }])).toThrow();
    expect(() => validateOdometer(base, [{ date: base.date, odometer: 1500 }])).not.toThrow();
  });
});
