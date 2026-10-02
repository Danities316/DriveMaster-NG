import { isValidDate } from "./validation.js";
import { isValidStoredMoney, normalizeMoney } from "./money.js";

export type FleetEntity = "vehicle" | "mileage_log" | "fuel_log";
export interface VehicleInput {
  id: string;
  plateNumber: string;
  model: string;
}
export interface MileageInput {
  id: string;
  vehicleId: string;
  date: string;
  odometer: number;
  driverName: string;
  notes: string | null;
}
export interface FuelInput extends MileageInput {
  litres: string;
  cost: string;
  receiptReference: string;
  fullTank: boolean;
}
export class FleetValidationError extends Error {}
const fail = (message: string): never => {
  throw new FleetValidationError(message);
};
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`${label} is required and must be no longer than ${max} characters.`);
  return (value as string).trim();
}
export function parseFleetInput(entity: "vehicle", input: unknown, now?: number): VehicleInput;
export function parseFleetInput(entity: "mileage_log", input: unknown, now?: number): MileageInput;
export function parseFleetInput(entity: "fuel_log", input: unknown, now?: number): FuelInput;
export function parseFleetInput(
  entity: FleetEntity,
  input: unknown,
  now?: number
): VehicleInput | MileageInput | FuelInput;
export function parseFleetInput(
  entity: FleetEntity,
  input: unknown,
  now = Date.now()
): VehicleInput | MileageInput | FuelInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid vehicle record.");
  const row = input as Record<string, unknown>;
  const id = text(row.id, "Record ID", 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    fail("Record ID must be a UUID.");
  if (entity === "vehicle") {
    const plateNumber = text(row.plateNumber, "Registration number", 30)
      .toUpperCase()
      .replace(/[\s-]/g, "");
    if (!/^[A-Z0-9]{3,20}$/.test(plateNumber))
      fail("Registration number must contain 3–20 letters or numbers.");
    return { id, plateNumber, model: text(row.model, "Vehicle model", 100) };
  }
  const vehicleId = text(row.vehicleId, "Vehicle", 100);
  const date = text(row.date, "Date and time", 40);
  if (
    !isValidDate(date) ||
    !/T.*(Z|[+-]\d{2}:\d{2})$/.test(date) ||
    Date.parse(date) > now + 300000
  )
    fail("Enter a valid date and time that is not in the future.");
  if (
    typeof row.odometer !== "number" ||
    !Number.isInteger(row.odometer) ||
    row.odometer < 0 ||
    row.odometer > 2147483647
  )
    fail("Odometer must be a whole number between 0 and 2,147,483,647 km.");
  const notes = row.notes == null || row.notes === "" ? null : text(row.notes, "Notes", 500);
  const mileage: MileageInput = {
    id,
    vehicleId,
    date: new Date(date).toISOString(),
    odometer: row.odometer as number,
    driverName: text(row.driverName, "Driver / instructor name", 120),
    notes
  };
  if (entity === "mileage_log") return mileage;
  if (
    typeof row.litres !== "string" ||
    !isValidStoredMoney(row.litres, true) ||
    Number(row.litres) > 999999.99
  )
    fail(
      "Fuel quantity must be greater than zero, at most 999,999.99 litres, with up to two decimal places."
    );
  if (typeof row.cost !== "string" || !isValidStoredMoney(row.cost, true))
    fail("Fuel cost must be a positive naira amount with up to two decimal places.");
  if (typeof row.fullTank !== "boolean") fail("Choose whether the tank was filled completely.");
  return {
    ...mileage,
    litres: normalizeMoney(row.litres as string),
    cost: normalizeMoney(row.cost as string),
    receiptReference: text(row.receiptReference, "Receipt / claim reference", 100).toUpperCase(),
    fullTank: row.fullTank as boolean
  };
}
export function validateOdometer(
  input: { date: string; odometer: number },
  history: { date: string; odometer: number }[]
): void {
  const time = Date.parse(input.date);
  for (const row of history) {
    const other = Date.parse(row.date);
    if (
      (other < time && row.odometer > input.odometer) ||
      (other > time && row.odometer < input.odometer)
    )
      fail(
        "This odometer reading conflicts with an earlier or later recorded reading. Check the date and mileage."
      );
    if (other === time && row.odometer !== input.odometer)
      fail("Readings at the same date and time must have the same odometer value.");
  }
}
