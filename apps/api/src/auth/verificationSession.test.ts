import { describe, expect, it } from "vitest";
import { createVerificationSession, readVerificationSession } from "./verificationSession.js";
import { verifySessionToken, createSessionToken } from "./token.js";
describe("restricted verification sessions", () => {
  it("cannot be substituted for workspace cookies, or vice versa", () => {
    const secret = "long-test-secret";
    const pending = createVerificationSession("owner", secret);
    expect(readVerificationSession(pending, secret)).toBe("owner");
    expect(readVerificationSession(pending + "x", secret)).toBeNull();
    expect(readVerificationSession(pending, "different-secret")).toBeNull();
    expect(verifySessionToken(pending, secret)).toBeNull();
    const full = createSessionToken(
      { sub: "owner", schoolId: "school", role: "OWNER", name: "Ada", phone: "+2348012345678" },
      secret,
      3600
    );
    expect(readVerificationSession(full, secret)).toBeNull();
  });
});
