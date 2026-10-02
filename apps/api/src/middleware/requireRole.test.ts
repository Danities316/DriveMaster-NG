import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requireRole } from "./requireRole";
import { KnownApiError } from "./errorHandler";
import type { AuthenticatedIdentity } from "../auth/identity";

function makeReq(auth?: AuthenticatedIdentity): Request {
  return { auth } as unknown as Request;
}

const OWNER_IDENTITY: AuthenticatedIdentity = {
  userId: "user-1",
  schoolId: "school-1",
  role: "OWNER",
  name: "Ada Okafor",
  phone: "+2348012345678"
};

const RECEPTIONIST_IDENTITY: AuthenticatedIdentity = {
  ...OWNER_IDENTITY,
  role: "RECEPTIONIST"
};

describe("requireRole", () => {
  it("calls next() with no error when the user has an allowed role", () => {
    const guard = requireRole("OWNER");
    const req = makeReq(OWNER_IDENTITY);
    const next = vi.fn();

    guard(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("calls next() with a 403 KnownApiError when the user's role is not allowed", () => {
    const guard = requireRole("OWNER");
    const req = makeReq(RECEPTIONIST_IDENTITY);
    const next = vi.fn();

    guard(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as KnownApiError;
    expect(err).toBeInstanceOf(KnownApiError);
    expect(err.statusCode).toBe(403);
  });

  it("allows any of multiple permitted roles", () => {
    const guard = requireRole("OWNER", "RECEPTIONIST");
    const next = vi.fn();

    guard(makeReq(OWNER_IDENTITY), {} as Response, next);
    guard(makeReq(RECEPTIONIST_IDENTITY), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenNthCalledWith(1);
    expect(next).toHaveBeenNthCalledWith(2);
  });

  it("calls next() with a 401 KnownApiError when there is no authenticated identity at all", () => {
    const guard = requireRole("OWNER");
    const req = makeReq(undefined);
    const next = vi.fn();

    guard(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as KnownApiError;
    expect(err.statusCode).toBe(401);
  });
});
