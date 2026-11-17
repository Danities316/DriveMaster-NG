import type { FuelLog } from "./domain.js";
import { subtractMoney } from "./money.js";

export const FUEL_DISCREPANCY_DISTANCE_KM = 10;
export const FUEL_DISCREPANCY_COST_NGN = "5000.00";

type FuelDiscrepancyRecord = Pick<
  FuelLog,
  "schoolId" | "vehicleId" | "date" | "createdAt" | "odometer" | "cost"
>;

function compareChronology(a: FuelDiscrepancyRecord, b: FuelDiscrepancyRecord): number {
  const dateDifference = Date.parse(a.date) - Date.parse(b.date);
  return dateDifference || Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function calculateFuelDiscrepancyAlert(
  current: FuelDiscrepancyRecord,
  history: readonly FuelDiscrepancyRecord[]
): boolean {
  const currentDate = Date.parse(current.date);
  const currentCreatedAt = Date.parse(current.createdAt);
  if (!Number.isFinite(currentDate) || !Number.isFinite(currentCreatedAt)) return false;

  let previous: FuelDiscrepancyRecord | undefined;
  for (const row of history) {
    if (
      row.schoolId !== current.schoolId ||
      row.vehicleId !== current.vehicleId ||
      !Number.isFinite(Date.parse(row.date)) ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      compareChronology(row, current) >= 0
    )
      continue;
    if (!previous || compareChronology(row, previous) > 0) previous = row;
  }
  if (!previous) return false;

  const distanceDelta = current.odometer - previous.odometer;
  const costDifference = subtractMoney(current.cost, FUEL_DISCREPANCY_COST_NGN);
  return distanceDelta < FUEL_DISCREPANCY_DISTANCE_KM && !costDifference.startsWith("-");
}
