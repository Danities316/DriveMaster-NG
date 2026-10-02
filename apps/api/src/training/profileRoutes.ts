import { Router } from "express";
import { z, ZodError } from "zod";
import { validInstructorLicence, validInstructorNin, validPermitDate } from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";

const optionalText = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value || null);
const edit = {
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1, "Tell us why you are changing this profile.").max(500)
};
export const schoolProfileInput = z.object({
  ...edit,
  school_cac_rc: optionalText.transform((value) => value?.toUpperCase() ?? null),
  frsc_accreditation_number: optionalText
});
export const instructorProfileInput = z.object({
  ...edit,
  drivers_license_number: optionalText
    .transform((value) => value?.toUpperCase() ?? null)
    .refine(
      (value) => !value || validInstructorLicence(value),
      "Use 3 letters, 5 digits, 2 letters and 2 digits, for example YEN12801AA01."
    ),
  nin: optionalText.refine(
    (value) => !value || validInstructorNin(value),
    "NIN must contain exactly 11 digits."
  ),
  permitExpiryDate: optionalText.refine(
    (value) => !value || validPermitDate(value),
    "Enter a real permit expiry date."
  )
});
export function createProfileRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.auth!.role !== "OWNER")
      return next(
        new KnownApiError("Only the owner can view or change these profiles.", 403, "FORBIDDEN")
      );
    next();
  });
  router.get("/", async (req, res, next) => {
    try {
      const db = getPrismaClient();
      const [school, instructors] = await Promise.all([
        db.school.findUnique({
          where: { id: req.auth!.schoolId },
          select: {
            id: true,
            name: true,
            school_cac_rc: true,
            frsc_accreditation_number: true,
            profileVersion: true
          }
        }),
        db.user.findMany({
          where: { schoolId: req.auth!.schoolId, role: "INSTRUCTOR", isActive: true },
          select: {
            id: true,
            name: true,
            drivers_license_number: true,
            nin: true,
            permitExpiryDate: true,
            profileVersion: true
          },
          orderBy: { name: "asc" }
        })
      ]);
      res.json({ school, instructors });
    } catch (error) {
      next(error);
    }
  });
  for (const type of ["school", "instructor"] as const) {
    router.post(type === "school" ? "/school" : "/instructor/:id", async (req, res, next) => {
      try {
        const input =
          type === "school"
            ? schoolProfileInput.parse(req.body)
            : instructorProfileInput.parse(req.body);
        const { expectedVersion, reason, ...fields } = input;
        const schoolId = req.auth!.schoolId;
        const targetId = type === "school" ? schoolId : String((req.params as { id?: string }).id);
        await getPrismaClient().$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
          const owner = await tx.user.findFirst({
            where: { id: req.auth!.userId, schoolId, role: "OWNER", isActive: true }
          });
          if (!owner)
            throw new KnownApiError("Only the owner can change these profiles.", 403, "FORBIDDEN");
          const result =
            type === "school"
              ? await tx.school.updateMany({
                  where: { id: targetId, profileVersion: expectedVersion },
                  data: {
                    ...schoolProfileInput
                      .omit({ expectedVersion: true, reason: true })
                      .parse(req.body),
                    profileVersion: { increment: 1 }
                  }
                })
              : await tx.user.updateMany({
                  where: {
                    id: targetId,
                    schoolId,
                    role: "INSTRUCTOR",
                    profileVersion: expectedVersion
                  },
                  data: {
                    ...instructorProfileInput
                      .omit({ expectedVersion: true, reason: true })
                      .parse(req.body),
                    profileVersion: { increment: 1 }
                  }
                });
          if (result.count !== 1)
            throw new KnownApiError(
              "This profile changed or is no longer available. Load profiles again before editing.",
              409,
              "PROFILE_CONFLICT"
            );
          // Record accountability without copying sensitive identifiers into audit metadata.
          await tx.auditLog.create({
            data: {
              schoolId,
              userId: owner.id,
              action: "UPDATE",
              entity: `${type}_profile`,
              entityId: targetId,
              metadata: {
                reason,
                fields: Object.keys(fields),
                previousVersion: expectedVersion,
                version: expectedVersion + 1
              }
            }
          });
        });
        res.json({ success: true });
      } catch (error) {
        next(
          error instanceof ZodError
            ? new KnownApiError(
                error.issues[0]?.message ?? "Check the profile details.",
                400,
                "VALIDATION_ERROR"
              )
            : error && typeof error === "object" && "code" in error && error.code === "P2002"
              ? new KnownApiError(
                  "This CAC registration number is already used by another school.",
                  409,
                  "DUPLICATE_PROFILE"
                )
              : error
        );
      }
    });
  }
  return router;
}
