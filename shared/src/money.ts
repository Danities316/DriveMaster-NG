/**
 * Decimal-safe money arithmetic for currency amounts represented as
 * strings (see domain.ts's note on Student.totalTuition / Payment.amount
 * — Prisma Decimal columns are serialized to strings on the wire to avoid
 * floating-point precision loss).
 *
 * Implemented with integer-cents math rather than a decimal library
 * (e.g. decimal.js, big.js): every value in this domain is a plain
 * currency amount with at most 2 decimal places, which integer-cents
 * arithmetic handles exactly, without adding a new dependency.
 */

const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class InvalidMoneyError extends Error {}

export const ZERO_MONEY = "0.00";

/** True if `value` is a valid money string (optional leading '-', digits, optional 1-2 decimal places). */
export function isValidMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

function toCents(value: string): bigint {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new InvalidMoneyError(`"${value}" is not a valid money amount.`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const paddedFraction = `${fractionPart}00`.slice(0, 2);
  const cents = BigInt(wholePart!) * 100n + BigInt(paddedFraction);
  return negative ? -cents : cents;
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const absCents = negative ? -cents : cents;
  const whole = absCents / 100n;
  const fraction = String(absCents % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function addMoney(a: string, b: string): string {
  return fromCents(toCents(a) + toCents(b));
}

export function subtractMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

export function sumMoney(amounts: string[]): string {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0n));
}

export function normalizeMoney(value: string): string {
  return fromCents(toCents(value));
}

/** PostgreSQL Decimal(12,2), non-negative tuition or positive payment. */
export function isValidStoredMoney(value: string, positive = false): boolean {
  if (!isValidMoneyString(value)) return false;
  const cents = toCents(value);
  return cents >= (positive ? 1n : 0n) && cents <= 999999999999n;
}
