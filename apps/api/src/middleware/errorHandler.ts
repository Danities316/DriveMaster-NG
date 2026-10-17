import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "@drivemaster/shared";

/**
 * Base class for errors that are safe to surface to API clients.
 * Anything thrown that is NOT a KnownApiError is treated as an unexpected
 * internal failure and reduced to a generic message before being sent to
 * the client (PRD §16 Error and Failure Handling, §17 Security
 * Requirements: no internal implementation details in responses).
 */
export class KnownApiError extends Error {
  readonly statusCode: number;
  readonly code: string | undefined;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = "KnownApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const parserType = err && typeof err === "object" && "type" in err ? err.type : undefined;
  if (parserType === "entity.too.large" || parserType === "entity.parse.failed") {
    res.status(parserType === "entity.too.large" ? 413 : 400).json({
      error: {
        message:
          parserType === "entity.too.large"
            ? "Upload is too large. Choose a receipt image under 2 MB."
            : "Invalid JSON request.",
        code: parserType === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR"
      }
    });
    return;
  }
  const isProduction = process.env["NODE_ENV"] === "production";

  if (err instanceof KnownApiError) {
    if (err.statusCode === 429 && !res.getHeader("Retry-After")) res.setHeader("Retry-After", "60");
    const body: ApiErrorResponse = {
      error: { message: err.message, code: err.code }
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected error: log full detail server-side, but never leak it to
  // the client. Stack traces / driver errors / file paths must not appear
  // in the HTTP response, especially in production.
  console.error(`[unhandled-error] ${req.method} ${req.path}`, err);

  const body: ApiErrorResponse = {
    error: {
      message: isProduction
        ? "Internal server error"
        : String(err instanceof Error ? err.message : err),
      code: "INTERNAL_ERROR"
    }
  };
  res.status(500).json(body);
}
