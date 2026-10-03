import { describe, expect, it } from "vitest";
import { normalizeNigerianPhone } from "./phone.js";

describe("normalizeNigerianPhone", () => {
  it("stores local and international Nigerian numbers consistently", () => {
    expect(normalizeNigerianPhone("0801 234 5678")).toBe("+2348012345678");
    expect(normalizeNigerianPhone("+2348012345678")).toBe("+2348012345678");
  });

  it("rejects incomplete and non-Nigerian numbers", () => {
    expect(normalizeNigerianPhone("0801234")).toBeNull();
    expect(normalizeNigerianPhone("+447700900123")).toBeNull();
  });
});
