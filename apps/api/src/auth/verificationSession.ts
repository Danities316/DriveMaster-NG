import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

export const VERIFICATION_COOKIE = "dm_owner_verification";
export const VERIFICATION_SESSION_SECONDS = 86400;
export function createVerificationSession(
  userId: string,
  secret: string,
  sessionVersion = 0
): string {
  const body = Buffer.from(
    JSON.stringify({ userId, sessionVersion, nonce: randomUUID(), exp: Date.now() + 86400000 })
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`owner-verification:${body}`).digest("base64url")}`;
}
export function readVerificationVersion(token: string | undefined, secret: string): number | null {
  if (!readVerificationSession(token, secret)) return null;
  const value = JSON.parse(Buffer.from(token!.split(".")[0]!, "base64url").toString()) as {
    sessionVersion?: number;
  };
  const version = value.sessionVersion ?? 0;
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}
export function readVerificationSession(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(`owner-verification:${body}`).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      userId?: unknown;
      exp?: unknown;
    };
    return typeof value.userId === "string" &&
      typeof value.exp === "number" &&
      value.exp > Date.now()
      ? value.userId
      : null;
  } catch {
    return null;
  }
}
