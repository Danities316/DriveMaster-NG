import { describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "./token";

const SECRET = "test-secret-at-least-32-characters-long";
const BASE_CLAIMS = {
  sub: "user-1",
  schoolId: "school-1",
  role: "OWNER" as const,
  name: "Ada Okafor",
  phone: "+2348012345678"
};

describe("session token", () => {
  it("round-trips valid claims", () => {
    const token = createSessionToken(BASE_CLAIMS, SECRET, 3600);
    const payload = verifySessionToken(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe(BASE_CLAIMS.sub);
    expect(payload?.schoolId).toBe(BASE_CLAIMS.schoolId);
    expect(payload?.role).toBe(BASE_CLAIMS.role);
    expect(payload?.name).toBe(BASE_CLAIMS.name);
    expect(payload?.phone).toBe(BASE_CLAIMS.phone);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken(BASE_CLAIMS, SECRET, 3600);
    expect(verifySessionToken(token, "a-completely-different-secret-value")).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = createSessionToken(BASE_CLAIMS, SECRET, 3600);
    const [payloadPart, signaturePart] = token.split(".");

    const tamperedClaims = JSON.parse(Buffer.from(payloadPart!, "base64url").toString("utf8"));
    tamperedClaims.role = "OWNER"; // attempt privilege escalation from a lower role
    tamperedClaims.schoolId = "some-other-school";
    const tamperedPayloadPart = Buffer.from(JSON.stringify(tamperedClaims)).toString("base64url");
    const tamperedToken = `${tamperedPayloadPart}.${signaturePart}`;

    expect(verifySessionToken(tamperedToken, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const token = createSessionToken(BASE_CLAIMS, SECRET, 60); // expires in 60s

    vi.setSystemTime(new Date("2026-01-01T00:02:00Z")); // 2 minutes later
    expect(verifySessionToken(token, SECRET)).toBeNull();

    vi.useRealTimers();
  });

  it("rejects a malformed token string", () => {
    expect(verifySessionToken("not-a-token", SECRET)).toBeNull();
    expect(verifySessionToken("", SECRET)).toBeNull();
    expect(verifySessionToken("a.b.c", SECRET)).toBeNull();
  });
});
