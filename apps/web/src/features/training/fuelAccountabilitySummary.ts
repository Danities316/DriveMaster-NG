import {
  isValidStoredMoney,
  moneyCents,
  subtractMoney,
  type TrainingOuting
} from "@drivemaster/shared";

// Presentation only: use the stored trip amounts and the same decimal-safe return calculation.
export function fuelAccountability(o: TrainingOuting) {
  const valid = (v: string | undefined): v is string => v !== undefined && isValidStoredMoney(v);
  if (o.status !== "COMPLETED") return { state: "IN_PROGRESS" as const };
  if (!valid(o.fuelIssued) || !valid(o.fuelSpent) || !valid(o.fuelReturned))
    return { state: "INCOMPLETE" as const };
  const difference = subtractMoney(o.fuelIssued, o.fuelSpent);
  const due = subtractMoney(difference, o.fuelReturned);
  const overspend = moneyCents(difference) < 0n;
  if (moneyCents(o.fuelReturned) > 0n && moneyCents(due) < 0n)
    return { state: "INCOMPLETE" as const };
  return {
    state:
      o.fuelSpendingBasis !== "REPORTED"
        ? ("LEGACY" as const)
        : overspend
          ? ("OVERSPENT" as const)
          : moneyCents(due) > 0n
            ? ("DUE" as const)
            : ("ACCOUNTED" as const),
    shouldReturn: overspend ? "0.00" : difference,
    due: overspend ? "0.00" : due,
    overspend: overspend ? subtractMoney(o.fuelSpent, o.fuelIssued) : undefined
  };
}
