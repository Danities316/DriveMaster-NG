import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./password";

describe("password hashing", () => {
  it("round-trips: verifyPassword succeeds for the original password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", () => {
    const a = hashPassword("same password");
    const b = hashPassword("same password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same password", a)).toBe(true);
    expect(verifyPassword("same password", b)).toBe(true);
  });

  it("fails closed for a malformed stored hash instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });

  it("DUMMY_PASSWORD_HASH is a valid hash usable for timing normalization", () => {
    expect(verifyPassword("dummy-password-for-timing-normalization", DUMMY_PASSWORD_HASH)).toBe(
      true
    );
  });
});
