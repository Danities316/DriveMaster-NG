import { describe, expect, it } from "vitest";
import { addMoney, subtractMoney, sumMoney, isValidMoneyString, InvalidMoneyError } from "./money";

describe("money arithmetic (integer-cents based)", () => {
  it("adds two amounts exactly, avoiding classic floating-point errors", () => {
    // 0.1 + 0.2 !== 0.3 in plain floating point — this must not happen here.
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(addMoney("10.10", "20.20")).toBe("30.30");
  });

  it("subtracts two amounts exactly", () => {
    expect(subtractMoney("150000.00", "45000.50")).toBe("104999.50");
  });

  it("sums a list of amounts exactly", () => {
    expect(sumMoney(["10.00", "20.00", "0.50"])).toBe("30.50");
  });

  it("sums an empty list to zero", () => {
    expect(sumMoney([])).toBe("0.00");
  });

  it("handles whole-number amounts with no decimal part", () => {
    expect(addMoney("100", "50")).toBe("150.00");
  });

  it("produces a negative result when subtracting a larger amount", () => {
    expect(subtractMoney("50.00", "75.00")).toBe("-25.00");
  });

  it("validates well-formed money strings", () => {
    expect(isValidMoneyString("150000")).toBe(true);
    expect(isValidMoneyString("150000.5")).toBe(true);
    expect(isValidMoneyString("150000.50")).toBe(true);
    expect(isValidMoneyString("-50.00")).toBe(true);
  });

  it("rejects malformed money strings", () => {
    expect(isValidMoneyString("abc")).toBe(false);
    expect(isValidMoneyString("150,000")).toBe(false);
    expect(isValidMoneyString("150.505")).toBe(false);
    expect(isValidMoneyString("")).toBe(false);
  });

  it("throws InvalidMoneyError when arithmetic is attempted on a malformed string", () => {
    expect(() => addMoney("not-a-number", "10.00")).toThrow(InvalidMoneyError);
  });
});
