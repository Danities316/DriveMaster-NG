import type { FuelLog } from "./domain.js";

export interface FuelConsumptionInterval {
  vehicleId: string;
  startId: string;
  endId: string;
  startDate: string;
  endDate: string;
  distanceKm: number;
  litres: string;
  refillCost: string;
  fillCount: number;
  litresPer100Km: number;
  kmPerLitre: number;
  refillCostPerKm: number;
}

const hundredths = (value: string): bigint | null => {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null;
};
const decimal = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

/** Derived from complete recorded fill history; pending or uncertain fills break a cycle. */
export function calculateFuelConsumption(
  records: readonly FuelLog[],
  schoolId: string,
  unconfirmedIds: ReadonlySet<string> = new Set()
): FuelConsumptionInterval[] {
  const groups = new Map<string, FuelLog[]>();
  for (const row of records) {
    if (row.schoolId !== schoolId) continue;
    const rows = groups.get(row.vehicleId) ?? [];
    rows.push(row);
    groups.set(row.vehicleId, rows);
  }
  const result: FuelConsumptionInterval[] = [];
  for (const rows of groups.values()) {
    // An undated record cannot safely be assigned to any interval.
    if (rows.some((row) => !Number.isFinite(Date.parse(row.date)))) continue;
    rows.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    let start: FuelLog | undefined;
    let previousOdometer = 0;
    let litres = 0n;
    let cost = 0n;
    let fills = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const quantity = hundredths(row.litres);
      const amount = hundredths(row.cost);
      const tied = [rows[index - 1], rows[index + 1]].some(
        (other) => other && Date.parse(other.date) === Date.parse(row.date)
      );
      if (
        unconfirmedIds.has(row.id) ||
        row.fullTank == null ||
        tied ||
        quantity === null ||
        amount === null ||
        !Number.isSafeInteger(row.odometer) ||
        row.odometer < 0
      ) {
        start = undefined;
        continue;
      }
      if (start && row.odometer < previousOdometer) start = undefined;
      if (start) {
        litres += quantity;
        cost += amount;
        fills++;
        const distanceKm = row.odometer - start.odometer;
        if (
          row.fullTank &&
          distanceKm > 0 &&
          litres <= BigInt(Number.MAX_SAFE_INTEGER) &&
          cost <= BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          result.push({
            vehicleId: row.vehicleId,
            startId: start.id,
            endId: row.id,
            startDate: start.date,
            endDate: row.date,
            distanceKm,
            litres: decimal(litres),
            refillCost: decimal(cost),
            fillCount: fills,
            litresPer100Km: Number(litres) / distanceKm,
            kmPerLitre: (distanceKm * 100) / Number(litres),
            refillCostPerKm: Number(cost) / 100 / distanceKm
          });
        }
      }
      if (row.fullTank) {
        start = row;
        litres = 0n;
        cost = 0n;
        fills = 0;
      }
      previousOdometer = row.odometer;
    }
  }
  return result.sort((a, b) => Date.parse(b.endDate) - Date.parse(a.endDate));
}
