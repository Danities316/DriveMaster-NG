import { z } from "zod";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";
export const staffAccessInput = z.object({
  isActive: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(5, "Explain why you are changing access.").max(500)
});
export async function changeStaffAccess(
  schoolId: string,
  ownerId: string,
  targetId: string,
  input: z.infer<typeof staffAccessInput>
) {
  input = staffAccessInput.parse(input);
  return getPrismaClient().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    const owner = await tx.user.findFirst({
      where: {
        id: ownerId,
        schoolId,
        role: "OWNER",
        isActive: true,
        phoneVerificationRequired: false,
        school: { status: { in: ["ACTIVE", "TRIAL"] } }
      }
    });
    if (!owner)
      throw new KnownApiError("Only an active owner can change staff access.", 403, "FORBIDDEN");
    const target = await tx.user.findFirst({
      where: { id: targetId, schoolId, role: { in: ["INSTRUCTOR", "RECEPTIONIST"] } }
    });
    if (!target) throw new KnownApiError("Staff account not found.", 404, "NOT_FOUND");
    if (target.sessionVersion !== input.expectedVersion || target.isActive === input.isActive)
      throw new KnownApiError(
        "This account changed. Reload staff accounts before changing access.",
        409,
        "STAFF_CONFLICT"
      );
    await tx.user.update({
      where: { id: target.id },
      data: { isActive: input.isActive, sessionVersion: { increment: 1 } }
    });
    await tx.passwordReset.updateMany({ where: { userId: target.id }, data: { digest: null } });
    await tx.ownerPhoneVerification.updateMany({
      where: { userId: target.id },
      data: { digest: null, delivered: false }
    });
    await tx.auditLog.create({
      data: {
        schoolId,
        userId: ownerId,
        entity: "STAFF_ACCOUNT",
        entityId: target.id,
        action: input.isActive ? "REACTIVATE" : "DEACTIVATE",
        metadata: {
          role: target.role,
          wasActive: target.isActive,
          isActive: input.isActive,
          reason: input.reason,
          previousVersion: target.sessionVersion,
          version: target.sessionVersion + 1
        }
      }
    });
    return { success: true };
  });
}
