import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { getPrismaClient } from "../prisma.js";
import { verifyPassword } from "../auth/password.js";
import { parseCookieHeader } from "../lib/cookies.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { createPlatformToken, verifyPlatformToken } from "./platformToken.js";

const COOKIE = "dm_platform_session";
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const statusSchema = z.object({
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"]),
  reason: z.string().trim().min(5).max(300)
});

export function createPlatformRouter(options: {
  authSecret: string;
  secureCookies: boolean;
}): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax" as const,
    path: "/"
  };
  const authenticate: RequestHandler = async (req, res, next) => {
    try {
      const token = parseCookieHeader(req.headers.cookie)[COOKIE];
      const claims = token ? verifyPlatformToken(token, options.authSecret) : null;
      if (!claims) throw new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED");
      const admin = await getPrismaClient().platformAdmin.findUnique({ where: { id: claims.sub } });
      if (!admin?.isActive) throw new KnownApiError("Not authenticated.", 401, "UNAUTHENTICATED");
      res.locals["platformAdmin"] = admin;
      next();
    } catch (error) {
      next(error);
    }
  };

  router.post("/auth/login", async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new KnownApiError("Email and password are required.", 400);
      const admin = await getPrismaClient().platformAdmin.findUnique({
        where: { email: parsed.data.email.toLowerCase() }
      });
      if (!admin?.isActive || !verifyPassword(parsed.data.password, admin.passwordHash))
        throw new KnownApiError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");
      const maxAge = 60 * 60 * 8;
      const token = createPlatformToken(
        { sub: admin.id, email: admin.email, name: admin.name },
        options.authSecret,
        maxAge
      );
      res.cookie(COOKIE, token, { ...cookieOptions, maxAge: maxAge * 1000 });
      await getPrismaClient().platformAuditLog.create({
        data: {
          adminId: admin.id,
          action: "PLATFORM_ADMIN_LOGIN",
          entity: "PLATFORM_ADMIN",
          entityId: admin.id
        }
      });
      res.json({ admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ success: true });
  });

  router.get("/overview", authenticate, async (_req, res, next) => {
    try {
      const prisma = getPrismaClient();
      const [schools, students, sessions, recentActivity] = await Promise.all([
        prisma.school.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            phone: true,
            status: true,
            trialEndsAt: true,
            createdAt: true,
            _count: { select: { users: true, students: true } }
          }
        }),
        prisma.student.count(),
        prisma.sessionBooking.count(),
        prisma.platformAuditLog.findMany({ orderBy: { timestamp: "desc" }, take: 50 })
      ]);
      res.json({
        totals: {
          schools: schools.length,
          activeSchools: schools.filter((school) => school.status === "ACTIVE").length,
          trialSchools: schools.filter((school) => school.status === "TRIAL").length,
          students,
          sessions
        },
        schools,
        recentActivity
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/schools/:schoolId/status", authenticate, async (req, res, next) => {
    try {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) throw new KnownApiError("Choose a status and give a clear reason.", 400);
      const admin = res.locals["platformAdmin"] as { id: string };
      const school = await getPrismaClient().$transaction(async (tx) => {
        const updated = await tx.school.update({
          where: { id: req.params["schoolId"] },
          data: { status: parsed.data.status }
        });
        await tx.platformAuditLog.create({
          data: {
            adminId: admin.id,
            schoolId: updated.id,
            action: "SCHOOL_STATUS_CHANGED",
            entity: "SCHOOL",
            entityId: updated.id,
            metadata: { status: parsed.data.status, reason: parsed.data.reason }
          }
        });
        return updated;
      });
      res.json({ school: { id: school.id, status: school.status } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
