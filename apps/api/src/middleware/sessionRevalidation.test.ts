import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createAuthenticateMiddleware } from "./authenticate.js";
import { createSessionToken } from "../auth/token.js";
import { SESSION_COOKIE_NAME } from "../auth/constants.js";

const secret = "test-secret-long-enough-for-session-tests";
const claims = {
  sub: "u",
  schoolId: "s",
  role: "OWNER" as const,
  name: "Ada",
  phone: "08012345678"
};
describe("existing session authorization", () => {
  it("rejects a user deactivated after the session was issued", async () => {
    const lookup = vi.fn(async () => ({
      id: "u",
      schoolId: "s",
      role: "OWNER" as const,
      name: "Ada",
      phone: claims.phone,
      passwordHash: "",
      isActive: false
    }));
    const req = {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(claims, secret, 3600)}` }
    } as Request;
    const next = vi.fn();
    await createAuthenticateMiddleware(secret, lookup)(req, {} as Response, next);
    expect(req.auth).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Not authenticated." }));
  });
  it("uses the current role rather than the role in an old token", async () => {
    const lookup = vi.fn(async () => ({
      id: "u",
      schoolId: "s",
      role: "INSTRUCTOR" as const,
      name: "Ada",
      phone: claims.phone,
      passwordHash: "",
      isActive: true
    }));
    const req = {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(claims, secret, 3600)}` }
    } as Request;
    const next = vi.fn();
    await createAuthenticateMiddleware(secret, lookup)(req, {} as Response, next);
    expect(req.auth?.role).toBe("INSTRUCTOR");
    expect(next).toHaveBeenCalledWith();
  });
});
