import { Router } from "express";
import { z, ZodError } from "zod";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import type { AuthDeps } from "../auth/authService.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { getPrismaClient } from "../prisma.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { executeTraining, trainingSnapshot } from "./trainingService.js";
import { createProfileRouter } from "./profileRoutes.js";
import { createEnrollmentReviewRouter } from "./enrollmentRoutes.js";

export function createTrainingRouter(options: { authSecret: string; authDeps: AuthDeps }) {
  const router = Router();
  router.use(createAuthenticateMiddleware(options.authSecret, options.authDeps.findUserByPhone));
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
  // Passwords are sent online only; never stored in the offline queue or audit metadata.
  router.post("/accounts", async (req, res, next) => {
    try {
      if (req.auth!.role !== "OWNER")
        throw new KnownApiError("Only the owner can create accounts.", 403, "FORBIDDEN");
      const input = z
        .object({
          role: z.enum(["INSTRUCTOR", "STUDENT"]),
          name: z.string().trim().min(1).max(100),
          phone: z.string().trim().min(7).max(30),
          password: z.string().min(10).max(128),
          studentId: z.string().min(1).max(100).optional()
        })
        .parse(req.body);
      const passwordHash = hashPassword(input.password);
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
              where: { id: input.studentId ?? "", schoolId: owner.schoolId }
            })
            : null;
        if (input.role === "STUDENT" && (!student || student.phone !== input.phone))
          throw new KnownApiError(
            "Use this student's registered phone number.",
            400,
            "INVALID_STUDENT"
          );
        const account = await tx.user.create({
          data: {
            name: student?.name ?? input.name,
            phone: input.phone,
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
  router.post("/password", async (req, res, next) => {
    try {
      const input = z
        .object({
          currentPassword: z.string().min(1).max(128),
          password: z.string().min(10).max(128)
        })
        .parse(req.body);
      const user = await getPrismaClient().user.findFirst({
        where: { id: req.auth!.userId, schoolId: req.auth!.schoolId, isActive: true }
      });
      if (!user || !verifyPassword(input.currentPassword, user.passwordHash))
        throw new KnownApiError("The current password is incorrect.", 400, "PASSWORD_ERROR");
      await getPrismaClient().user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(input.password) }
      });
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
