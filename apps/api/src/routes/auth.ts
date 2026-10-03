import { Router } from "express";
import { z } from "zod";
import type {
  LoginResponse,
  MeResponse,
  LogoutResponse,
  AuthenticatedUser
} from "@drivemaster/shared";
import { login, type AuthDeps } from "../auth/authService.js";
import { createSessionToken } from "../auth/token.js";
import { SESSION_COOKIE_NAME } from "../auth/constants.js";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { normalizeNigerianPhone } from "../auth/phone.js";
import { registerOwner } from "../auth/ownerRegistration.js";

const loginRequestSchema = z.object({
  phone: z.string().trim().min(1, "Phone number is required."),
  password: z.string().min(1, "Password is required.")
});

const ownerRegistrationSchema = z.object({
  ownerName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(1),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-z]/, "Password must include a small letter.")
    .regex(/[A-Z]/, "Password must include a capital letter.")
    .regex(/\d/, "Password must include a number."),
  schoolName: z.string().trim().min(2).max(150),
  schoolAddress: z.string().trim().min(5).max(300),
  cacNumber: z.string().trim().max(50).optional(),
  frscNumber: z.string().trim().max(50).optional(),
  acceptedTerms: z.literal(true)
});

export interface CreateAuthRouterOptions {
  authSecret: string;
  /** Seconds until the session cookie/token expires. */
  sessionMaxAgeSeconds: number;
  /** Injected so this router is testable without a live database. */
  authDeps: AuthDeps;
  /** true in production, false in dev/test so cookies work over plain http://localhost. */
  secureCookies: boolean;
}

function toAuthenticatedUser(user: {
  id: string;
  schoolId: string;
  name: string;
  phone: string;
  role: AuthenticatedUser["role"];
}): AuthenticatedUser {
  return {
    id: user.id,
    schoolId: user.schoolId,
    name: user.name,
    phone: user.phone,
    role: user.role
  };
}

export function createAuthRouter(options: CreateAuthRouterOptions): Router {
  const { authSecret, sessionMaxAgeSeconds, authDeps, secureCookies } = options;
  const router = Router();
  const authenticate = createAuthenticateMiddleware(authSecret, authDeps.findUserByPhone);

  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/"
  };

  router.post("/login", async (req, res, next) => {
    try {
      const parsed = loginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        // Generic, non-technical message per this unit's UX requirement —
        // field-level zod detail is intentionally not surfaced to the client.
        throw new KnownApiError("Phone number and password are required.", 400, "VALIDATION_ERROR");
      }

      const phone = normalizeNigerianPhone(parsed.data.phone);
      if (!phone)
        throw new KnownApiError("Enter a valid Nigerian phone number.", 400, "VALIDATION_ERROR");
      const result = await login(phone, parsed.data.password, authDeps);

      if (!result.ok) {
        // Same message regardless of reason (unknown phone, wrong
        // password, or inactive account) — never reveal which case it was.
        throw new KnownApiError(
          "Phone number or password is incorrect.",
          401,
          "INVALID_CREDENTIALS"
        );
      }

      const { user } = result;
      const token = createSessionToken(
        {
          sub: user.id,
          schoolId: user.schoolId,
          role: user.role,
          name: user.name,
          phone: user.phone
        },
        authSecret,
        sessionMaxAgeSeconds
      );

      res.cookie(SESSION_COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: sessionMaxAgeSeconds * 1000
      });

      const body: LoginResponse = { user: toAuthenticatedUser(user) };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post("/register-owner", async (req, res, next) => {
    try {
      const parsed = ownerRegistrationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new KnownApiError(
          parsed.error.issues[0]?.message ?? "Check the registration details and try again.",
          400,
          "VALIDATION_ERROR"
        );
      }
      const phone = normalizeNigerianPhone(parsed.data.phone);
      if (!phone)
        throw new KnownApiError("Enter a valid Nigerian phone number.", 400, "VALIDATION_ERROR");
      let created;
      try {
        created = await registerOwner({ ...parsed.data, phone });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          throw new KnownApiError(
            "This phone number or CAC number is already registered.",
            409,
            "ACCOUNT_EXISTS"
          );
        }
        throw error;
      }
      const user = created.user;
      const token = createSessionToken(
        {
          sub: user.id,
          schoolId: user.schoolId,
          role: user.role,
          name: user.name,
          phone: user.phone
        },
        authSecret,
        sessionMaxAgeSeconds
      );
      res.cookie(SESSION_COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: sessionMaxAgeSeconds * 1000
      });
      const body: LoginResponse = { user: toAuthenticatedUser(user) };
      res.status(201).json(body);
    } catch (error) {
      next(error);
    }
  });

  // Deliberately does not require a valid session — a shared device with
  // an already-expired/corrupted cookie must still be able to clear it.
  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    const body: LogoutResponse = { success: true };
    res.status(200).json(body);
  });

  router.get("/me", authenticate, (req, res) => {
    // req.auth is guaranteed by `authenticate` at this point.
    const auth = req.auth!;
    const body: MeResponse = {
      user: {
        id: auth.userId,
        schoolId: auth.schoolId,
        name: auth.name,
        phone: auth.phone,
        role: auth.role
      }
    };
    res.status(200).json(body);
  });

  return router;
}
