import { FleetValidationError } from "./fleet.js";
import type { FuelConsumptionInterval } from "./fuelConsumption.js";

export interface FuelBenchmark {
  minimum: string;
  maximum: string;
  allowancePercent: string;
  notes: string;
}
export function parseFuelBenchmark(value: unknown): FuelBenchmark {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new FleetValidationError("Enter a consumption benchmark.");
  const row = value as Record<string, unknown>;
  const decimal = (name: string, label: string, minimum: number, maximum: number) => {
    const value = row[name];
    if (
      typeof value !== "string" ||
      !/^\d{1,3}(\.\d{1,2})?$/.test(value) ||
      Number(value) < minimum ||
      Number(value) > maximum
    )
      throw new FleetValidationError(
        `${label} must be between ${minimum} and ${maximum}, with up to two decimal places.`
      );
    return Number(value).toFixed(2);
  };
  const minimum = decimal("minimum", "Minimum L/100 km", 0.01, 999.99);
  const maximum = decimal("maximum", "Maximum L/100 km", 0.01, 999.99);
  if (Number(minimum) > Number(maximum))
    throw new FleetValidationError("Minimum consumption cannot exceed maximum consumption.");
  const allowancePercent = decimal("allowancePercent", "Lesson / idling allowance (%)", 0, 100);
  if (typeof row.notes !== "string" || !row.notes.trim() || row.notes.trim().length > 500)
    throw new FleetValidationError("Explain the source of this benchmark in 1–500 characters.");
  return { minimum, maximum, allowancePercent, notes: row.notes.trim() };
}

export interface FuelAssessment {
  status: "not_configured" | "above_limit" | "below_range" | "within_limit";
  limit?: number;
  excessPercent?: number;
  excessLitres?: number;
}
/** Current benchmark reassessment, never a claim approval or fraud determination. */
export function assessFuelConsumption(
  cycle: FuelConsumptionInterval,
  benchmark?: FuelBenchmark | null
): FuelAssessment {
  if (!benchmark) return { status: "not_configured" };
  let settings: FuelBenchmark;
  try {
    settings = parseFuelBenchmark(benchmark);
  } catch {
    return { status: "not_configured" };
  }
  const units = (value: string) => BigInt(value.replace(".", ""));
  const maximum = units(settings.maximum);
  const allowance = units(settings.allowancePercent);
  // Compare exact hundredths before display rounding, including the percentage allowance.
  const limitUnits = maximum * (10000n + allowance);
  const actualUnits = units(cycle.litres) * 1000000n;
  const allowedUnits = BigInt(cycle.distanceKm) * limitUnits;
  const limit = Number(limitUnits) / 1000000;
  if (actualUnits > allowedUnits)
    return {
      status: "above_limit",
      limit,
      excessPercent: (Number(actualUnits - allowedUnits) / Number(allowedUnits)) * 100,
      excessLitres: Number(actualUnits - allowedUnits) / 100000000
    };
  return {
    status:
      units(cycle.litres) * 100n < BigInt(cycle.distanceKm) * units(settings.minimum)
        ? "below_range"
        : "within_limit",
    limit
  };
}
