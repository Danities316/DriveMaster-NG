import { describe, expect, it } from "vitest";
import { isValidDate } from "./validation.js";
import { isValidStoredMoney, normalizeMoney, sumMoney } from "./money.js";

describe("storage validation", () => {
  it("normalizes equivalent amounts and preserves precision beyond number's integer limit", () => {
    expect(normalizeMoney("025000.0")).toBe("25000.00");
    expect(sumMoney(["90071992547409.91", "0.02"])).toBe("90071992547409.93");
  });
  it("enforces database amount limits and positive payments", () => {
    expect(isValidStoredMoney("9999999999.99")).toBe(true);
    for (const amount of ["-1", "10000000000", "Infinity", "1.001"]) {
      expect(isValidStoredMoney(amount)).toBe(false);
    }
    expect(isValidStoredMoney("0", true)).toBe(false);
    expect(isValidStoredMoney("0.01", true)).toBe(true);
  });
  it("rejects rolled-over dates and accepts explicit ISO times", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-01-01T01:00:00+01:00")).toBe(true);
    expect(isValidDate("01/02/2026")).toBe(false);
  });
});
