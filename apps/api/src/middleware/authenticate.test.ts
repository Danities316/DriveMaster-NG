import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createAuthenticateMiddleware } from "./authenticate";
import { createSessionToken } from "../auth/token";
import { SESSION_COOKIE_NAME } from "../auth/constants";
import { KnownApiError } from "./errorHandler";

const SECRET = "test-secret-at-least-32-characters-long";
const CLAIMS = {
  sub: "user-1",
  schoolId: "school-1",
  role: "RECEPTIONIST" as const,
  name: "Bola Adeyemi",
  phone: "+2348099999999"
};

function makeReq(cookieHeader?: string): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

describe("authenticate middleware", () => {
  const authenticate = createAuthenticateMiddleware(SECRET);

  it("attaches req.auth and calls next() with no error for a valid session cookie", () => {
    const token = createSessionToken(CLAIMS, SECRET, 3600);
    const req = makeReq(`${SESSION_COOKIE_NAME}=${token}`);
    const next = vi.fn();

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
    expect(req.auth).toEqual({
      userId: CLAIMS.sub,
      schoolId: CLAIMS.schoolId,
      role: CLAIMS.role,
      name: CLAIMS.name,
      phone: CLAIMS.phone
    });
  });

  it("calls next() with a 401 KnownApiError when there is no cookie at all", () => {
    const req = makeReq(undefined);
    const next = vi.fn();

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as KnownApiError;
    expect(err).toBeInstanceOf(KnownApiError);
    expect(err.statusCode).toBe(401);
    expect(req.auth).toBeUndefined();
  });

  it("calls next() with a 401 KnownApiError for an invalid/tampered token", () => {
    const req = makeReq(`${SESSION_COOKIE_NAME}=not-a-real-token`);
    const next = vi.fn();

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as KnownApiError;
    expect(err).toBeInstanceOf(KnownApiError);
    expect(err.statusCode).toBe(401);
  });

  it("calls next() with a 401 KnownApiError for a token signed with a different secret", () => {
    const token = createSessionToken(CLAIMS, "a-totally-different-secret-value", 3600);
    const req = makeReq(`${SESSION_COOKIE_NAME}=${token}`);
    const next = vi.fn();

    authenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as KnownApiError;
    expect(err.statusCode).toBe(401);
  });
});
