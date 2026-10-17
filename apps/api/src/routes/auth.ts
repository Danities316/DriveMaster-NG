import { Router } from "express";
import { randomInt } from "node:crypto";
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
import { registerOwner, type OwnerRegistrationInput } from "../auth/ownerRegistration.js";
import { createOwnerVerification } from "../auth/ownerVerification.js";
import { verificationStore } from "../auth/verificationRepository.js";
import { sendOwnerCode, smsConfig } from "../auth/sms.js";
import {
  createVerificationSession,
  readVerificationSession,
  readVerificationVersion,
  VERIFICATION_COOKIE,
  VERIFICATION_SESSION_SECONDS
} from "../auth/verificationSession.js";
import { parseCookieHeader } from "../lib/cookies.js";
import type { Request, Response } from "express";
import { securityLimit, type RateConsumer } from "../middleware/securityLimits.js";
import { createPasswordRecovery, changeAccountPassword } from "../auth/passwordRecovery.js";
import { getPrismaClient } from "../prisma.js";
import { verifySessionToken } from "../auth/token.js";

const loginRequestSchema = z.object({
  phone: z.string().trim().min(1, "Phone number is required."),
  password: z.string().min(1, "Password is required.").max(128)
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
  securityLimit?: RateConsumer;
  recovery?: ReturnType<typeof createPasswordRecovery>;
  verification?: ReturnType<typeof createOwnerVerification>;
  register?: (input: OwnerRegistrationInput) => Promise<{ user: { id: string } }>;
  registrationLimit?: (ip: string) => Promise<void>;
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
  schoolName?: string;
  name: string;
  phone: string;
  role: AuthenticatedUser["role"];
}): AuthenticatedUser {
  return {
    id: user.id,
    schoolId: user.schoolId,
    name: user.name,
    phone: user.phone,
    role: user.role,
    ...(user.schoolName ? { schoolName: user.schoolName } : {})
  };
}

export function createAuthRouter(options: CreateAuthRouterOptions): Router {
  const { authSecret, sessionMaxAgeSeconds, authDeps, secureCookies } = options;
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const authenticateForMe = createAuthenticateMiddleware(
    authSecret,
    authDeps.findUserByPhone,
    true,
    authDeps.isTokenRevoked
  );
  const verification =
    options.verification ??
    createOwnerVerification({
      store: verificationStore,
      secret: authSecret,
      send: sendOwnerCode,
      code: () => {
        const config = smsConfig();
        return config.provider === "mock"
          ? config.mockCode
          : String(randomInt(0, 1000000)).padStart(6, "0");
      }
    });
  const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";
  const recovery =
    options.recovery ??
    createPasswordRecovery({ secret: authSecret, consume: options.securityLimit });
  const authenticate = createAuthenticateMiddleware(
    authSecret,
    authDeps.findUserByPhone,
    false,
    authDeps.isTokenRevoked
  );
  const phoneIdentity = (body: Record<string, unknown>) =>
    typeof body.phone === "string" ? normalizeNigerianPhone(body.phone) : null;
  const limitLogin = securityLimit(
    "school-login",
    60,
    900000,
    options.securityLimit,
    phoneIdentity
  );

  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/"
  };
  function setPending(res: Response, id: string, sessionVersion = 0) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.cookie(VERIFICATION_COOKIE, createVerificationSession(id, authSecret, sessionVersion), {
      ...cookieOptions,
      maxAge: VERIFICATION_SESSION_SECONDS * 1000
    });
  }
  async function pendingId(req: Request) {
    const token = parseCookieHeader(req.headers.cookie)[VERIFICATION_COOKIE];
    if (token && authDeps.isTokenRevoked && (await authDeps.isTokenRevoked(token)))
      throw new KnownApiError("Sign in again to continue.", 401, "UNAUTHENTICATED");
    const version = readVerificationVersion(
      parseCookieHeader(req.headers.cookie)[VERIFICATION_COOKIE],
      authSecret
    );
    const id = readVerificationSession(
      parseCookieHeader(req.headers.cookie)[VERIFICATION_COOKIE],
      authSecret
    );
    if (!id || version === null)
      throw new KnownApiError(
        "Sign in again to continue phone verification.",
        401,
        "UNAUTHENTICATED"
      );
    return { id, version };
  }
  async function beginVerification(
    req: Request,
    res: Response,
    id: string,
    statusCode: number,
    sessionVersion = 0
  ) {
    setPending(res, id, sessionVersion);
    let status = await verification.status(id, sessionVersion);
    if (status.delivery === "not_sent") {
      try {
        status = await verification.send(id, ipOf(req), undefined, sessionVersion);
      } catch (error) {
        if (!(error instanceof KnownApiError) || error.statusCode !== 429) throw error;
      }
    }
    res.status(statusCode).json(status);
  }
  function issueSession(
    res: Response,
    user: Parameters<typeof toAuthenticatedUser>[0] & { sessionVersion?: number }
  ) {
    const token = createSessionToken(
      {
        sub: user.id,
        sessionVersion: user.sessionVersion ?? 0,
        schoolId: user.schoolId,
        schoolName: user.schoolName,
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
    res.clearCookie(VERIFICATION_COOKIE, { path: "/" });
  }

  router.get("/owner-verification", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const pending = await pendingId(req);
      res.json(await verification.status(pending.id, pending.version));
    } catch (error) {
      next(error);
    }
  });
  router.post("/owner-verification/send", async (req, res, next) => {
    try {
      const input = z.object({ phone: z.string().max(30).optional() }).parse(req.body);
      const phone = input.phone === undefined ? undefined : normalizeNigerianPhone(input.phone);
      if (phone === null)
        throw new KnownApiError("Enter a valid Nigerian phone number.", 400, "VALIDATION_ERROR");
      const pending = await pendingId(req);
      res.json(await verification.send(pending.id, ipOf(req), phone, pending.version));
    } catch (error) {
      if (error instanceof z.ZodError)
        return next(new KnownApiError("Check the phone number.", 400));
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
        return next(
          new KnownApiError(
            "This phone number is already registered. Use another number or sign in.",
            409
          )
        );
      next(error);
    }
  });
  router.post("/owner-verification/confirm", async (req, res, next) => {
    try {
      const input = z.object({ code: z.string().max(20) }).parse(req.body);
      const pending = await pendingId(req);
      const user = await verification.verify(pending.id, input.code, ipOf(req), pending.version);
      issueSession(res, user);
      res.json({ user: toAuthenticatedUser(user) });
    } catch (error) {
      next(
        error instanceof z.ZodError ? new KnownApiError("Enter the six-digit code.", 400) : error
      );
    }
  });

  router.post("/login", limitLogin, async (req, res, next) => {
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
      if (user.phoneVerificationRequired) {
        await beginVerification(req, res, user.id, 202, user.sessionVersion ?? 0);
        return;
      }
      const token = createSessionToken(
        {
          sub: user.id,
          sessionVersion: user.sessionVersion ?? 0,
          schoolId: user.schoolId,
          schoolName: user.schoolName,
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
      res.clearCookie(VERIFICATION_COOKIE, { path: "/" });

      const body: LoginResponse = { user: toAuthenticatedUser(user) };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/register-owner",
    securityLimit("owner-register", 30, 3600000, options.securityLimit, phoneIdentity),
    async (req, res, next) => {
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
        await (
          options.registrationLimit ??
          ((ip: string) =>
            verificationStore.consume(`registration-ip:${ip}`, 10, 3600000, new Date()))
        )(ipOf(req));
        // A retry with the same credentials resumes its pending school, never creates another.
        const existing = await login(phone, parsed.data.password, authDeps);
        if (
          existing.ok &&
          existing.user.role === "OWNER" &&
          existing.user.phoneVerificationRequired
        ) {
          await beginVerification(
            req,
            res,
            existing.user.id,
            202,
            existing.user.sessionVersion ?? 0
          );
          return;
        }
        let created;
        try {
          created = await (options.register ?? registerOwner)({ ...parsed.data, phone });
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
        await beginVerification(req, res, user.id, 202);
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/password-reset/request",
    securityLimit("reset-entry", 30, 3600000, options.securityLimit),
    async (req, res, next) => {
      try {
        const input = z.object({ phone: z.string().max(30) }).parse(req.body);
        const phone = normalizeNigerianPhone(input.phone);
        if (!phone) throw new KnownApiError("Enter a valid Nigerian phone number.", 400);
        const pending = await recovery.request(phone, ipOf(req));
        res
          .status(202)
          .json({
            requestId: pending.requestId,
            message:
              "If an eligible account uses this number, a reset code will be sent. Check your SMS messages."
          });
        // Deliver after the uniform response; provider latency must not disclose account existence.
        void pending
          .deliver()
          .catch(() => console.error("[password-reset] SMS delivery task failed"));
      } catch (error) {
        next(
          error instanceof z.ZodError
            ? new KnownApiError("Enter a valid phone number.", 400)
            : error
        );
      }
    }
  );
  router.post(
    "/password-reset/confirm",
    securityLimit("reset-confirm-entry", 60, 3600000, options.securityLimit),
    async (req, res, next) => {
      try {
        const input = z
          .object({
            requestId: z.string().uuid(),
            code: z.string().max(20),
            password: z.string().min(10).max(128)
          })
          .parse(req.body);
        await recovery.confirm(input.requestId, input.code, input.password, ipOf(req));
        res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
        res.clearCookie(VERIFICATION_COOKIE, { path: "/" });
        res.json({ success: true });
      } catch (error) {
        next(
          error instanceof z.ZodError
            ? new KnownApiError("Enter the code and a password of at least 10 characters.", 400)
            : error
        );
      }
    }
  );
  router.post(
    "/change-password",
    authenticate,
    securityLimit("change-password", 15, 900000, options.securityLimit),
    async (req, res, next) => {
      try {
        const input = z
          .object({
            currentPassword: z.string().min(1).max(128),
            password: z.string().min(10).max(128)
          })
          .parse(req.body);
        await changeAccountPassword(req.auth!.userId, input.currentPassword, input.password);
        res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
        res.json({ success: true });
      } catch (error) {
        next(
          error instanceof z.ZodError
            ? new KnownApiError("Use at least 10 characters for your new password.", 400)
            : error
        );
      }
    }
  );
  router.post("/logout-all", authenticate, async (req, res, next) => {
    try {
      const claims = verifySessionToken(
        parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME]!,
        authSecret
      )!;
      await getPrismaClient().user.updateMany({
        where: { id: req.auth!.userId, sessionVersion: claims.sessionVersion ?? 0 },
        data: { sessionVersion: { increment: 1 } }
      });
      res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      res.clearCookie(VERIFICATION_COOKIE, { path: "/" });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Deliberately does not require a valid session — a shared device with
  // an already-expired/corrupted cookie must still be able to clear it.
  router.post("/logout", async (req, res, next) => {
    try {
      const cookies = parseCookieHeader(req.headers.cookie);
      const session = cookies[SESSION_COOKIE_NAME];
      const pending = cookies[VERIFICATION_COOKIE];
      const claims = session ? verifySessionToken(session, authSecret) : null;
      if (session && claims) await authDeps.revokeToken?.(session, new Date(claims.exp * 1000));
      if (pending && readVerificationSession(pending, authSecret))
        await authDeps.revokeToken?.(pending, new Date(Date.now() + 86400000));
      res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      res.clearCookie(VERIFICATION_COOKIE, { path: "/" });
      const body: LogoutResponse = { success: true };
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", authenticateForMe, async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      const current = await authDeps.findUserByPhone(req.auth!.phone);
      if (current?.phoneVerificationRequired) {
        setPending(res, current.id, current.sessionVersion ?? 0);
        res.status(202).json(await verification.status(current.id, current.sessionVersion ?? 0));
        return;
      }
      // req.auth is guaranteed by `authenticate` at this point.
      const auth = req.auth!;
      const body: MeResponse = {
        user: {
          id: auth.userId,
          schoolId: auth.schoolId,
          ...(auth.schoolName ? { schoolName: auth.schoolName } : {}),
          name: auth.name,
          phone: auth.phone,
          role: auth.role
        }
      };
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
