import { createHash } from "node:crypto";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import type { VerificationState, VerificationStore } from "./ownerVerification.js";

export const verificationStore: VerificationStore = {
  async transaction(id, action) {
    return getPrismaClient().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const user = await tx.user.findUnique({
          where: { id },
          include: { school: true, ownerPhoneVerification: true }
        });
        if (!user) throw new KnownApiError("Sign in again to continue.", 401, "UNAUTHENTICATED");
        const state: VerificationState = {
          user: { ...user, schoolName: user.school.name, schoolStatus: user.school.status },
          challenge: user.ownerPhoneVerification ? { ...user.ownerPhoneVerification } : null,
          verifiedAt: null
        };
        const result = await action(state);
        if (state.correctedPhone) {
          await tx.user.update({ where: { id }, data: { phone: state.correctedPhone } });
          // Existing school contact details remain intact; only new pending schools follow correction.
          if (!user.school.trialEndsAt && user.school.status === "TRIAL")
            await tx.school.update({
              where: { id: user.schoolId },
              data: { phone: state.correctedPhone }
            });
        }
        if (state.challenge)
          await tx.ownerPhoneVerification.upsert({
            where: { userId: id },
            create: { userId: id, ...state.challenge },
            update: state.challenge
          });
        if (state.verifiedAt) {
          await tx.user.update({
            where: { id },
            data: { phoneVerifiedAt: state.verifiedAt, phoneVerificationRequired: false }
          });
          if (user.school.status === "TRIAL" && !user.school.trialEndsAt)
            await tx.school.update({
              where: { id: user.schoolId },
              data: { trialEndsAt: new Date(state.verifiedAt.getTime() + 14 * 86400000) }
            });
          await tx.auditLog.create({
            data: {
              schoolId: user.schoolId,
              userId: id,
              action: "VERIFY_OWNER_PHONE",
              entity: "USER",
              entityId: id
            }
          });
        }
        return result;
      },
      { timeout: 10000 }
    );
  },
  async consume(value, maximum, windowMs, now) {
    const key = createHash("sha256").update(value).digest("hex");
    const allowed = await getPrismaClient().$transaction(async (tx) => {
      // The column is timestamp without time zone; explicitly use UTC rather than the
      // database session timezone when converting the bound timestamptz parameter.
      await tx.$executeRaw`INSERT INTO verification_rate_limits (key, count, "windowStartedAt") VALUES (${key}, 0, (${now}::timestamptz AT TIME ZONE 'UTC')) ON CONFLICT (key) DO NOTHING`;
      await tx.$queryRaw`SELECT key FROM verification_rate_limits WHERE key = ${key} FOR UPDATE`;
      const row = await tx.verificationRateLimit.findUniqueOrThrow({ where: { key } });
      if (row.windowStartedAt > now) {
        row.windowStartedAt = now;
        await tx.verificationRateLimit.update({ where: { key }, data: { windowStartedAt: now } });
      }
      const expired = now.getTime() - row.windowStartedAt.getTime() >= windowMs;
      if (!expired && row.count >= maximum) return false;
      await tx.verificationRateLimit.update({
        where: { key },
        data: {
          count: expired ? 1 : row.count + 1,
          windowStartedAt: expired ? now : row.windowStartedAt
        }
      });
      return true;
    });
    if (!allowed)
      throw new KnownApiError(
        "Too many requests. Please try again later.",
        429,
        "VERIFICATION_RATE_LIMIT"
      );
  }
};
