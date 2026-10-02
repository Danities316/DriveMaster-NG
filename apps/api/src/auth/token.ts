import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@drivemaster/shared";

/**
 * A minimal, self-contained signed session token — functionally
 * equivalent to a JWT using the HS256 algorithm (base64url payload +
 * base64url HMAC-SHA256 signature), implemented with only Node's
 * built-in `crypto` module rather than adding a `jsonwebtoken`
 * dependency.
 *
 * DECISION (documented, not silently made): the PRD requires "a secure
 * server-approved mechanism" (§26.1) but does not mandate a specific
 * library or a JWT-spec-compliant format. Given this project's repeated
 * "avoid unnecessary dependencies" instruction and Unit 2's explicit
 * "keep the authentication flow lightweight" instruction, a ~40-line
 * module built on Node's audited HMAC/timingSafeEqual primitives was
 * judged preferable to a new third-party dependency for something this
 * self-contained. It is a contained module — swapping it for
 * `jsonwebtoken` later touches only this file and its two call sites
 * (routes/auth.ts, middleware/authenticate.ts).
 *
 * The token is delivered to the browser exclusively via an httpOnly
 * cookie (see routes/auth.ts) — frontend JavaScript never reads or
 * stores the raw token, which is how this design satisfies PRD §26.1's
 * "must not be stored insecurely in ordinary localStorage or IndexedDB".
 */

export interface SessionTokenPayload {
  /** Subject — the authenticated user's id. */
  sub: string;
  schoolId: string;
  role: UserRole;
  name: string;
  phone: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64url");
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

export function createSessionToken(
  claims: Omit<SessionTokenPayload, "iat" | "exp">,
  secret: string,
  expiresInSeconds: number
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const payload: SessionTokenPayload = { ...claims, iat, exp };

  const payloadPart = base64url(JSON.stringify(payload));
  const signaturePart = base64url(sign(payloadPart, secret));

  return `${payloadPart}.${signaturePart}`;
}

/**
 * Verifies signature and expiry. Returns null (never throws) for any
 * malformed, tampered, or expired token, so callers can treat "invalid"
 * uniformly without needing to catch exceptions.
 */
export function verifySessionToken(token: string, secret: string): SessionTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const expectedSignature = sign(payloadPart, secret);
  let providedSignature: Buffer;
  try {
    providedSignature = base64urlDecode(signaturePart);
  } catch {
    return null;
  }

  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64urlDecode(payloadPart).toString("utf8"));
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== "object") return null;
  const payload = decoded as SessionTokenPayload;
  if (
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000) ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > Math.floor(Date.now() / 1000) ||
    payload.exp <= payload.iat ||
    ![payload.sub, payload.schoolId, payload.name, payload.phone].every(
      (value) => typeof value === "string" && value.length > 0
    ) ||
    !["OWNER", "RECEPTIONIST", "INSTRUCTOR", "STUDENT"].includes(payload.role)
  ) {
    return null;
  }

  return payload;
}
