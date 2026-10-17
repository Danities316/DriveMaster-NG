import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { durableLimit, type RateConsumer } from "../middleware/securityLimits.js";
import { hashPasswordAsync, verifyPasswordAsync } from "./password.js";
import { sendPasswordResetCode, smsConfig } from "./sms.js";

const invalid = () =>
  new KnownApiError(
    "The reset code is incorrect, expired or unavailable. Request another code.",
    400,
    "INVALID_RESET_CODE"
  );
export function createPasswordRecovery(options: {
  secret: string;
  consume?: RateConsumer;
  send?: (phone: string, code: string) => Promise<boolean>;
  code?: () => string;
  now?: () => Date;
}) {
  const consume = options.consume ?? durableLimit;
  const now = options.now ?? (() => new Date());
  const mac = (purpose: string, value: string) =>
    createHmac("sha256", options.secret).update(`${purpose}:${value}`).digest("hex");
  async function request(phone: string, ip: string) {
    const time = now();
    const phoneKey = mac("reset-phone", phone);
    await consume(`reset-request-ip:${ip}`, 20, 3600000, time);
    await consume(`reset-request-phone:${phoneKey}`, 5, 86400000, time);
    await consume(`reset-cooldown:${phoneKey}`, 1, 60000, time);
    const config = options.code ? null : smsConfig();
    const code =
      options.code?.() ??
      (config?.provider === "mock"
        ? config.mockCode
        : String(randomInt(0, 1000000)).padStart(6, "0"));
    const id = randomUUID();
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { phone }, include: { school: true } });
    const eligible = user?.isActive && !["SUSPENDED", "CLOSED"].includes(user.school.status);
    await prisma.$transaction(async (tx) => {
      if (user) await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      await tx.passwordReset.updateMany({ where: { phoneKey }, data: { digest: null } });
      // Decoy records give unknown and disabled accounts the same response shape and storage path.
      await tx.passwordReset.create({
        data: {
          id,
          phoneKey,
          userId: eligible ? user.id : null,
          sessionVersion: user?.sessionVersion ?? 0,
          digest: mac("reset-code", `${id}:${code}`),
          expiresAt: new Date(time.getTime() + 600000)
        }
      });
    });
    return {
      requestId: id,
      deliver: async () => {
        if (!eligible) return;
        const current = await prisma.user.findUnique({
          where: { id: user.id },
          include: { school: true }
        });
        if (
          !current?.isActive ||
          current.sessionVersion !== user.sessionVersion ||
          current.phone !== phone ||
          ["SUSPENDED", "CLOSED"].includes(current.school.status)
        )
          return;
        const digest = mac("reset-code", `${id}:${code}`);
        const claimed = await prisma.passwordReset.updateMany({
          where: { id, digest, deliveryStartedAt: null, expiresAt: { gt: now() } },
          data: { deliveryStartedAt: now() }
        });
        if (!claimed.count) return; // Durable claim: duplicate delivery tasks never spend twice.
        let delivered = false;
        try {
          await consume("sms-delivery-global", 500, 86400000, now());
          delivered = await (options.send ?? sendPasswordResetCode)(phone, code).catch(() => false);
        } catch {
          /* Keep the public recovery response neutral when delivery is unavailable. */
        }
        await prisma.passwordReset.updateMany({
          where: { id, digest: mac("reset-code", `${id}:${code}`) },
          data: { delivered, ...(!delivered ? { digest: null } : {}) }
        });
      }
    };
  }
  async function confirm(id: string, code: string, password: string, ip: string) {
    const time = now();
    await consume(`reset-verify-ip:${ip}`, 60, 3600000, time);
    const prisma = getPrismaClient();
    const reference = await prisma.passwordReset.findUnique({ where: { id } });
    if (!reference) throw invalid();
    await consume(`reset-verify-phone:${reference.phoneKey}`, 20, 3600000, time);
    // Hash outside the transaction and only after bounded per-IP/per-phone checks.
    const passwordHash = await hashPasswordAsync(password);
    const accepted = await prisma.$transaction(async (tx) => {
      if (reference.userId)
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${reference.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM password_resets WHERE id = ${id} FOR UPDATE`;
      const row = await tx.passwordReset.findUnique({ where: { id } });
      if (
        !row?.digest ||
        !row.delivered ||
        row.expiresAt <= time ||
        row.attempts >= 5 ||
        !row.userId
      )
        return false;
      await tx.passwordReset.update({ where: { id }, data: { attempts: { increment: 1 } } });
      if (
        !/^\d{6}$/.test(code) ||
        !timingSafeEqual(
          Buffer.from(row.digest, "hex"),
          Buffer.from(mac("reset-code", `${id}:${code}`), "hex")
        )
      )
        return false;
      const user = await tx.user.findUnique({
        where: { id: row.userId },
        include: { school: true }
      });
      if (
        !user?.isActive ||
        user.sessionVersion !== row.sessionVersion ||
        mac("reset-phone", user.phone) !== row.phoneKey ||
        ["SUSPENDED", "CLOSED"].includes(user.school.status)
      )
        return false;
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, sessionVersion: { increment: 1 } }
      });
      await tx.passwordReset.updateMany({ where: { userId: user.id }, data: { digest: null } });
      await tx.ownerPhoneVerification.updateMany({
        where: { userId: user.id },
        data: { digest: null, delivered: false }
      });
      await tx.auditLog.create({
        data: {
          schoolId: user.schoolId,
          userId: user.id,
          action: "RESET_PASSWORD",
          entity: "USER",
          entityId: user.id
        }
      });
      return true;
    });
    if (!accepted) throw invalid();
  }
  return { request, confirm };
}

export async function changeAccountPassword(
  userId: string,
  currentPassword: string,
  password: string
) {
  const prisma = getPrismaClient();
  const original = await prisma.user.findUnique({ where: { id: userId } });
  if (!original || !(await verifyPasswordAsync(currentPassword, original.passwordHash)))
    throw new KnownApiError("The current password is incorrect.", 400, "PASSWORD_ERROR");
  const passwordHash = await hashPasswordAsync(password);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId }, include: { school: true } });
    if (
      !current?.isActive ||
      current.passwordHash !== original.passwordHash ||
      current.sessionVersion !== original.sessionVersion ||
      ["SUSPENDED", "CLOSED"].includes(current.school.status)
    )
      throw new KnownApiError(
        "Sign in again before changing your password.",
        401,
        "UNAUTHENTICATED"
      );
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, sessionVersion: { increment: 1 } }
    });
    await tx.passwordReset.updateMany({ where: { userId }, data: { digest: null } });
    await tx.ownerPhoneVerification.updateMany({
      where: { userId },
      data: { digest: null, delivered: false }
    });
    await tx.auditLog.create({
      data: {
        schoolId: current.schoolId,
        userId,
        action: "CHANGE_PASSWORD",
        entity: "USER",
        entityId: userId
      }
    });
  });
}
