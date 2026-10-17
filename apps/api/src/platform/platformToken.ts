import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

interface PlatformClaims {
  credentialStamp?: string;
  sessionId?: string;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}
const encode = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const signature = (value: string, secret: string) =>
  createHmac("sha256", secret).update(`platform-session:${value}`).digest();
export const platformCredentialStamp = (passwordHash: string, secret: string) =>
  createHmac("sha256", secret).update(`platform-credential:${passwordHash}`).digest("hex");

export function createPlatformToken(
  claims: Omit<PlatformClaims, "iat" | "exp">,
  secret: string,
  maxAgeSeconds: number
) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = encode(
    JSON.stringify({ ...claims, sessionId: randomUUID(), iat, exp: iat + maxAgeSeconds })
  );
  return `${payload}.${encode(signature(payload, secret))}`;
}

export function verifyPlatformToken(token: string, secret: string): PlatformClaims | null {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = signature(payload, secret);
  let received: Buffer;
  try {
    received = Buffer.from(supplied, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PlatformClaims;
    const now = Math.floor(Date.now() / 1000);
    if (
      !claims.sub ||
      !claims.email ||
      !claims.name ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) ||
      claims.exp <= claims.iat ||
      claims.exp <= now ||
      claims.iat > now
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
