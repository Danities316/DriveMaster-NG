import { describe, expect, it } from "vitest";
import { createPlatformToken, verifyPlatformToken } from "./platformToken.js";

describe("platform administrator session", () => {
  const secret = "a-secure-test-secret-that-is-long-enough";

  it("verifies a signed, unexpired administrator session", () => {
    const token = createPlatformToken({ sub: "admin", email: "admin@example.com", name: "Admin" }, secret, 60);
    expect(verifyPlatformToken(token, secret)?.sub).toBe("admin");
  });

  it("rejects a tampered session", () => {
    const token = createPlatformToken({ sub: "admin", email: "admin@example.com", name: "Admin" }, secret, 60);
    expect(verifyPlatformToken(`${token}x`, secret)).toBeNull();
  });
});
