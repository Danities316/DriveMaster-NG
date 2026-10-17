import { changeStaffAccess, staffAccessInput } from "./staffAccounts.js";
import { Router } from "express";
import { z, ZodError } from "zod";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import type { AuthDeps } from "../auth/authService.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { getPrismaClient } from "../prisma.js";
import { hashPasswordAsync } from "../auth/password.js";
import { normalizeNigerianPhone } from "../auth/phone.js";
import { executeTraining, trainingSnapshot } from "./trainingService.js";
import { createProfileRouter } from "./profileRoutes.js";
import { createEnrollmentReviewRouter } from "./enrollmentRoutes.js";
import { changeAccountPassword } from "../auth/passwordRecovery.js";
import { securityLimit } from "../middleware/securityLimits.js";

export function createTrainingRouter(options: { authSecret: string; authDeps: AuthDeps }) {
  const router = Router();
  router.use(
    createAuthenticateMiddleware(
      options.authSecret,
      options.authDeps.findUserByPhone,
      false,
      options.authDeps.isTokenRevoked
    )
  );
  router.use((req, _res, next) => {
    if (
      req.get("X-Training-User") !== req.auth!.userId ||
      req.get("X-Training-School") !== req.auth!.schoolId
    )
      return next(
        new KnownApiError(
          "The signed-in account changed. Reload and sign in again.",
          409,
          "ACCOUNT_CHANGED"
        )
      );
    next();
  });
  router.use("/profiles", createProfileRouter());
  router.use("/applications", createEnrollmentReviewRouter());
  router.get("/snapshot", async (req, res, next) => {
    try {
      res.json(await trainingSnapshot(req.auth!.schoolId, req.auth!.userId));
    } catch (e) {
      next(e);
    }
  });
  router.post("/commands", async (req, res, next) => {
    try {
      res.json(await executeTraining(req.auth!.schoolId, req.auth!.userId, req.body));
    } catch (e) {
      if (e instanceof ZodError)
        next(
          new KnownApiError(
            e.issues[0]?.message ?? "Check the training details.",
            400,
            "VALIDATION_ERROR"
          )
        );
      else if (e instanceof Error && e.name === "FleetValidationError")
        next(new KnownApiError(e.message, 409, "TRAINING_CONFLICT"));
      else if (e && typeof e === "object" && "code" in e && e.code === "P2002")
        next(
          new KnownApiError(
            "This record already exists. Load the latest records before trying again.",
            409,
            "DUPLICATE"
          )
        );
      else next(e);
    }
  });
  router.get("/accounts", async (req, res, next) => {
    try {
      if (req.auth!.role !== "OWNER")
        throw new KnownApiError("Only the owner can manage staff.", 403, "FORBIDDEN");
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(req.query.offset ?? 0);
      const rows = await getPrismaClient().user.findMany({
        where: { schoolId: req.auth!.schoolId, role: { in: ["INSTRUCTOR", "RECEPTIONIST"] } },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          sessionVersion: true
        },
        orderBy: { id: "asc" },
        skip: offset,
        take: 101
      });
      res
        .set("Cache-Control", "no-store")
        .json({
          accounts: rows
            .slice(0, 100)
            .map(({ sessionVersion, ...row }) => ({ ...row, version: sessionVersion })),
          hasMore: rows.length > 100
        });
    } catch (e) {
      next(
        e instanceof ZodError
          ? new KnownApiError("Invalid staff page.", 400, "VALIDATION_ERROR")
          : e
      );
    }
  });
  router.post("/accounts/:id/access", async (req, res, next) => {
    try {
      if (req.auth!.role !== "OWNER")
        throw new KnownApiError("Only the owner can manage staff.", 403, "FORBIDDEN");
      res.json(
        await changeStaffAccess(
          req.auth!.schoolId,
          req.auth!.userId,
          String(req.params.id),
          staffAccessInput.parse(req.body)
        )
      );
    } catch (e) {
      next(
        e instanceof ZodError
          ? new KnownApiError(
              e.issues[0]?.message ?? "Check access details.",
              400,
              "VALIDATION_ERROR"
            )
          : e
      );
    }
  });
  // Passwords are sent online only; never stored in the offline queue or audit metadata.
  router.post("/accounts", async (req, res, next) => {
    try {
      if (req.auth!.role !== "OWNER")
        throw new KnownApiError("Only the owner can create accounts.", 403, "FORBIDDEN");
      const input = z
        .discriminatedUnion("role", [
          z.object({
            role: z.enum(["INSTRUCTOR", "RECEPTIONIST"]),
            name: z.string().trim().min(1, "Enter the instructor's name.").max(100),
            phone: z.string().trim().min(1, "Enter the instructor's phone number.").max(30),
            password: z.string().min(10, "Use at least 10 characters for the password.").max(128)
          }),
          z.object({
            role: z.literal("STUDENT"),
            studentId: z.string().min(1, "Choose a registered student.").max(100),
            password: z.string().min(10, "Use at least 10 characters for the password.").max(128)
          })
        ])
        .parse(req.body);
      const passwordHash = await hashPasswordAsync(input.password);
      await getPrismaClient().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM schools WHERE id = ${req.auth!.schoolId} FOR UPDATE`;
        const owner = await tx.user.findFirst({
          where: {
            id: req.auth!.userId,
            schoolId: req.auth!.schoolId,
            isActive: true,
            role: "OWNER"
          }
        });
        if (!owner)
          throw new KnownApiError("Only the owner can create accounts.", 403, "FORBIDDEN");
        const student =
          input.role === "STUDENT"
            ? await tx.student.findFirst({
                where: { id: input.studentId, schoolId: owner.schoolId }
              })
            : null;
        if (input.role === "STUDENT" && !student)
          throw new KnownApiError(
            "Choose a registered student from this school.",
            400,
            "INVALID_STUDENT"
          );
        const phone = normalizeNigerianPhone(
          student?.phone ?? (input.role !== "STUDENT" ? input.phone : "")
        );
        if (!phone)
          throw new KnownApiError(
            input.role === "STUDENT"
              ? "This student's registered phone number is invalid. Update the student record first."
              : "Enter a valid Nigerian phone number.",
            400,
            "VALIDATION_ERROR"
          );
        const account = await tx.user.create({
          data: {
            name: student?.name ?? (input.role !== "STUDENT" ? input.name : ""),
            phone,
            role: input.role,
            passwordHash,
            schoolId: owner.schoolId,
            studentId: student?.id ?? null
          }
        });
        await tx.auditLog.create({
          data: {
            userId: owner.id,
            schoolId: owner.schoolId,
            action: "CREATE",
            entity: "training_account",
            entityId: account.id,
            metadata: { role: input.role, studentId: student?.id ?? null }
          }
        });
      });
      res.status(201).json({ success: true });
    } catch (e) {
      if (e instanceof ZodError)
        next(
          new KnownApiError(
            e.issues[0]?.message ?? "Check the account details.",
            400,
            "VALIDATION_ERROR"
          )
        );
      else if (e && typeof e === "object" && "code" in e && e.code === "P2002")
        next(
          new KnownApiError(
            "An account already uses this phone number or student record.",
            409,
            "ACCOUNT_EXISTS"
          )
        );
      else next(e);
    }
  });
  router.post("/password", securityLimit("change-password", 15, 900000), async (req, res, next) => {
    try {
      const input = z
        .object({
          currentPassword: z.string().min(1).max(128),
          password: z.string().min(10).max(128)
        })
        .parse(req.body);
      await changeAccountPassword(req.auth!.userId, input.currentPassword, input.password);
      res.json({ success: true });
    } catch (e) {
      next(
        e instanceof ZodError
          ? new KnownApiError(
              "Use at least 10 characters for your new password.",
              400,
              "VALIDATION_ERROR"
            )
          : e
      );
    }
  });
  return router;
}
