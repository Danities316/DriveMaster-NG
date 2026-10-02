import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { errorHandler, KnownApiError } from "./errorHandler.js";

function createMockResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = { method: "GET", path: "/api/whatever" } as Request;

describe("errorHandler", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env["NODE_ENV"] = originalNodeEnv;
    consoleErrorSpy.mockRestore();
  });

  it("returns the exact status/message for a KnownApiError", () => {
    const res = createMockResponse();
    const err = new KnownApiError("Invalid payload", 400, "VALIDATION_ERROR");

    errorHandler(err, req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: { message: "Invalid payload", code: "VALIDATION_ERROR" }
    });
  });

  it("hides internal error details in production", () => {
    process.env["NODE_ENV"] = "production";
    const res = createMockResponse();
    const err = new Error("Connection refused at 10.0.0.5:5432 (pg_hba.conf entry missing)");

    errorHandler(err, req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: { message: "Internal server error", code: "INTERNAL_ERROR" }
    });
  });

  it("still logs the full error server-side in production", () => {
    process.env["NODE_ENV"] = "production";
    const res = createMockResponse();
    const err = new Error("Sensitive internal detail");

    errorHandler(err, req, res, vi.fn());

    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
