import { createTrainingRouter } from "./training/trainingRoutes.js";
import express, { type Express } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createStudentsRouter } from "./routes/students.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { parseAllowedOrigins } from "./env.js";
import { findUserByPhone as defaultFindUserByPhone } from "./auth/userRepository.js";
import type { AuthDeps } from "./auth/authService.js";
import {
  createStudentRecord as defaultCreateStudentRecord,
  findStudentById as defaultFindStudentById,
  findStudentsBySchool as defaultFindStudentsBySchool,
  updateStudentRecord as defaultUpdateStudentRecord
} from "./students/studentRepository.js";
import {
  createPaymentRecord as defaultCreatePaymentRecord,
  findPaymentById as defaultFindPaymentById,
  findPaymentsByStudent as defaultFindPaymentsByStudent,
  sumPaymentsByStudentIds as defaultSumPaymentsByStudentIds
} from "./students/paymentRepository.js";
import type { StudentDeps } from "./students/studentService.js";
import type { PaymentDeps } from "./students/paymentService.js";
import "./types/express.js";
import { createSyncRouter } from "./routes/sync.js";
import { createPublicEnrollmentRouter } from "./training/enrollmentRoutes.js";
import type { SyncDeps } from "./sync/syncRepository.js";
import { createPlatformRouter } from "./platform/platformRoutes.js";
import { securityLimit, type RateConsumer } from "./middleware/securityLimits.js";
import { isTokenRevoked, revokeToken } from "./auth/sessionRepository.js";

export interface CreateAppOptions {
  securityLimit?: RateConsumer;
  syncDeps?: SyncDeps;
  /** Raw WEB_ORIGIN env value (comma-separated allowed CORS origins). */
  webOrigin: string;
  /** Secret used to sign/verify session tokens. */
  authSecret: string;
  /** Seconds until a session cookie/token expires. */
  sessionMaxAgeSeconds: number;
  /**
   * true in production (requires HTTPS for the cookie), false in
   * dev/test so cookies still work over plain http://localhost.
   */
  secureCookies: boolean;
  /**
   * Overridable for tests, so the auth routes can be exercised via
   * supertest without a live PostgreSQL connection. Defaults to the real
   * Prisma-backed lookup used in production.
   */
  authDeps?: AuthDeps;
  /** Same idea as authDeps, for the student management routes. */
  studentDeps?: StudentDeps;
  /** Payment management dependencies for school-scoped payment routes. */
  paymentDeps?: PaymentDeps;
}

/**
 * Builds the Express application without starting a listener, so it can
 * be exercised directly by tests (supertest) and by server.ts.
 */
export function createApp(options: CreateAppOptions): Express {
  const { webOrigin, authSecret, sessionMaxAgeSeconds, secureCookies } = options;
  const authDeps: AuthDeps = options.authDeps ?? {
    findUserByPhone: defaultFindUserByPhone,
    isTokenRevoked,
    revokeToken
  };
  const studentDeps: StudentDeps = options.studentDeps ?? {
    createStudentRecord: defaultCreateStudentRecord,
    findStudentById: defaultFindStudentById,
    findStudentsBySchool: defaultFindStudentsBySchool,
    updateStudentRecord: defaultUpdateStudentRecord,
    sumPaymentsByStudentIds: defaultSumPaymentsByStudentIds
  };
  const paymentDeps: PaymentDeps = options.paymentDeps ?? {
    findPaymentById: defaultFindPaymentById,
    createPaymentRecord: defaultCreatePaymentRecord,
    findPaymentsByStudent: defaultFindPaymentsByStudent,
    sumPaymentsByStudentIds: defaultSumPaymentsByStudentIds,
    findStudentById: defaultFindStudentById
  };

  const app = express();
  const allowedOrigins = parseAllowedOrigins(webOrigin);

  // Public, unauthenticated intake accepts no cookies; staff routes retain strict origin checks.
  app.use(
    "/api/enroll",
    cors({ origin: "*", credentials: false }),
    securityLimit("public-enroll", 180, 600000, options.securityLimit),
    (req, res, next) =>
      req.method === "POST"
        ? securityLimit("public-enroll-write", 30, 600000, options.securityLimit)(req, res, next)
        : next(),
    (req, res, next) =>
      express.json({
        limit:
          req.method === "POST" && /^\/[^/]+\/[^/]+\/payment-claims\/?$/.test(req.path)
            ? "3mb"
            : "32kb"
      })(req, res, next),
    createPublicEnrollmentRouter()
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser requests (no Origin header, e.g. curl/health checks).
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      // Required so the browser sends/receives the httpOnly session cookie
      // across the web app's origin and the API's origin.
      credentials: true
    })
  );

  app.use(express.json());

  app.use("/api", healthRouter);
  app.use(
    "/api/platform",
    createPlatformRouter({ authSecret, secureCookies, securityLimit: options.securityLimit })
  );
  app.use(
    "/api/auth",
    createAuthRouter({
      authSecret,
      sessionMaxAgeSeconds,
      authDeps,
      secureCookies,
      securityLimit: options.securityLimit
    })
  );
  app.use(
    "/api/students",
    createStudentsRouter({ authSecret, studentDeps, paymentDeps, authDeps })
  );

  app.use("/api/v1/sync", createSyncRouter({ authSecret, authDeps, syncDeps: options.syncDeps }));
  app.use("/api/training", createTrainingRouter({ authSecret, authDeps }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
