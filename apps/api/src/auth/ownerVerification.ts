import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { OwnerVerificationStatus } from "@drivemaster/shared";
import { KnownApiError } from "../middleware/errorHandler.js";
import type { UserRecordForAuth } from "./authService.js";

export interface VerificationChallenge {
  phone: string;
  digest: string | null;
  nonce: string;
  expiresAt: Date;
  resendAt: Date;
  attempts: number;
  delivered: boolean;
}
export interface VerificationState {
  user: UserRecordForAuth;
  challenge: VerificationChallenge | null;
  verifiedAt: Date | null;
  correctedPhone?: string;
}
export interface VerificationStore {
  transaction<T>(id: string, action: (state: VerificationState) => T | Promise<T>): Promise<T>;
  consume(key: string, maximum: number, windowMs: number, now: Date): Promise<void>;
}
export function createOwnerVerification(deps: {
  store: VerificationStore;
  secret: string;
  send: (phone: string, code: string) => Promise<boolean>;
  code?: () => string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const code = deps.code ?? (() => String(randomInt(0, 1000000)).padStart(6, "0"));
  const digest = (id: string, phone: string, nonce: string, value: string) =>
    createHmac("sha256", deps.secret)
      .update(JSON.stringify(["owner-phone", id, phone, nonce, value]))
      .digest("hex");
  const requirePending = (state: VerificationState, sessionVersion: number) => {
    if (
      !state.user.isActive ||
      (state.user.sessionVersion ?? 0) !== sessionVersion ||
      state.user.role !== "OWNER" ||
      !state.user.phoneVerificationRequired ||
      ["SUSPENDED", "CLOSED"].includes(state.user.schoolStatus ?? "")
    )
      throw new KnownApiError("Sign in again to continue.", 401, "UNAUTHENTICATED");
  };
  const statusOf = (state: VerificationState): OwnerVerificationStatus => ({
    verificationRequired: true,
    maskedPhone: `${state.user.phone.slice(0, 4)}******${state.user.phone.slice(-4)}`,
    resendAt: state.challenge?.resendAt.toISOString() ?? null,
    expiresAt: state.challenge?.expiresAt.toISOString() ?? null,
    delivery: state.challenge ? (state.challenge.delivered ? "sent" : "failed") : "not_sent"
  });
  const status = (id: string, sessionVersion = 0) =>
    deps.store.transaction(id, (state) => {
      requirePending(state, sessionVersion);
      return statusOf(state);
    });
  async function send(
    id: string,
    ip: string,
    phone?: string,
    sessionVersion = 0
  ): Promise<OwnerVerificationStatus> {
    const time = now();
    // Durable aggregate limits also apply across replacement challenges and server restarts.
    await deps.store.consume(`sms-ip:${ip}`, 20, 3600000, time);
    await deps.store.consume(`sms-owner:${id}`, 10, 86400000, time);
    const target =
      phone ??
      (await deps.store.transaction(id, (state) => {
        requirePending(state, sessionVersion);
        return state.user.phone;
      }));
    await deps.store.consume(`sms-phone:${target}`, 10, 86400000, time);
    const value = code();
    const prepared = await deps.store.transaction(id, async (state) => {
      requirePending(state, sessionVersion);
      if (state.challenge && state.challenge.resendAt > time)
        throw new KnownApiError("Wait before requesting another code.", 429, "RESEND_TOO_SOON");
      if (!phone && state.user.phone !== target)
        throw new KnownApiError("Your phone changed. Reload before requesting a code.", 409);
      if (phone) {
        state.user.phone = phone;
        state.correctedPhone = phone;
      }
      const nonce = randomUUID();
      state.challenge = {
        phone: target,
        nonce,
        digest: digest(id, target, nonce, value),
        expiresAt: new Date(time.getTime() + 600000),
        resendAt: new Date(time.getTime() + 60000),
        attempts: 0,
        delivered: false
      };
      return { phone: target, nonce };
    });
    let delivered = false;
    try {
      // Reserve the shared delivery budget only after the challenge passed all guards.
      await deps.store.consume("sms-delivery-global", 500, 86400000, now());
      delivered = await deps.send(prepared.phone, value).catch(() => false);
    } catch {
      /* Unavailable budget must not expose a usable, undelivered code. */
    }
    return deps.store.transaction(id, (state) => {
      requirePending(state, sessionVersion);
      if (state.challenge?.nonce === prepared.nonce) {
        state.challenge.delivered = delivered;
        if (!delivered) state.challenge.digest = null;
      }
      return statusOf(state);
    });
  }
  async function verify(
    id: string,
    value: string,
    ip: string,
    sessionVersion = 0
  ): Promise<UserRecordForAuth> {
    const time = now();
    await deps.store.consume(`verify-ip:${ip}`, 60, 3600000, time);
    await deps.store.consume(`verify-owner:${id}`, 20, 3600000, time);
    const result = await deps.store.transaction(id, (state) => {
      requirePending(state, sessionVersion);
      const challenge = state.challenge;
      if (
        !challenge?.digest ||
        !challenge.delivered ||
        challenge.phone !== state.user.phone ||
        challenge.expiresAt <= time ||
        challenge.attempts >= 5
      )
        return { error: "Your code expired or is unavailable. Request another code." };
      challenge.attempts += 1;
      const expected = Buffer.from(challenge.digest, "hex");
      const supplied = Buffer.from(digest(id, challenge.phone, challenge.nonce, value), "hex");
      if (!/^\d{6}$/.test(value) || !timingSafeEqual(expected, supplied))
        return { error: "The code is incorrect. Check it and try again." };
      challenge.digest = null;
      state.verifiedAt = time;
      state.user.phoneVerificationRequired = false;
      return { user: state.user };
    });
    // Return errors after committing attempt counters, rather than rolling them back.
    if (!result.user) throw new KnownApiError(result.error, 400, "INVALID_VERIFICATION_CODE");
    return result.user;
  }
  return { status, send, verify };
}
