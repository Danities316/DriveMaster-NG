import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@drivemaster/shared";
import { KnownApiError } from "./errorHandler.js";

/**
 * Restricts a route to one or more roles. Must run after `authenticate`
 * (it relies on `req.auth` being set) — if `req.auth` is missing, this
 * fails closed with 401 rather than assuming any particular role.
 *
 * No route in Unit 2 uses this yet (no business/tenant-owned endpoints
 * exist until later units), but it is the enforcement point future
 * OWNER-only or INSTRUCTOR-only routes will use — see the Unit 2 report.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.auth) {
      next(new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED"));
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      next(
        new KnownApiError("You do not have permission to perform this action.", 403, "FORBIDDEN")
      );
      return;
    }

    next();
  };
}
