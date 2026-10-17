import type { NextFunction, Request, Response } from "express";
import { verifySessionToken } from "../auth/token.js";
import { parseCookieHeader } from "../lib/cookies.js";
import { SESSION_COOKIE_NAME } from "../auth/constants.js";
import { KnownApiError } from "./errorHandler.js";
import type { AuthDeps } from "../auth/authService.js";

/**
 * Reads the session cookie, verifies its signature and expiry, and
 * attaches the resulting identity to `req.auth`. On any failure, calls
 * `next` with a 401 KnownApiError rather than continuing — there is no
 * "anonymous" pass-through mode.
 *
 * Application routes supply the user lookup to enforce current account
 * status, tenant ownership and roles even for previously issued tokens.
 */
export function createAuthenticateMiddleware(
  secret: string,
  findUser?: AuthDeps["findUserByPhone"],
  allowUnverified = false,
  isTokenRevoked?: AuthDeps["isTokenRevoked"]
) {
  return async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];

    if (!token) {
      next(new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED"));
      return;
    }

    const payload = verifySessionToken(token, secret);
    if (!payload) {
      next(new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED"));
      return;
    }

    let current = payload;
    if (findUser) {
      try {
        if (isTokenRevoked && (await isTokenRevoked(token))) {
          next(new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED"));
          return;
        }
        const user = await findUser(payload.phone);
        if (
          !user?.isActive ||
          user.id !== payload.sub ||
          user.schoolId !== payload.schoolId ||
          ["SUSPENDED", "CLOSED"].includes(user.schoolStatus ?? "") ||
          (payload.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)
        ) {
          next(new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED"));
          return;
        }
        if (user.phoneVerificationRequired && !allowUnverified) {
          next(
            new KnownApiError(
              "Verify your phone number before opening your school workspace.",
              403,
              "PHONE_VERIFICATION_REQUIRED"
            )
          );
          return;
        }
        current = {
          ...payload,
          role: user.role,
          name: user.name,
          phone: user.phone,
          schoolName: user.schoolName
        };
      } catch (error) {
        next(error);
        return;
      }
    }
    req.auth = {
      userId: payload.sub,
      schoolId: payload.schoolId,
      schoolName: current.schoolName,
      role: current.role,
      name: current.name,
      phone: current.phone
    };
    next();
  };
}
