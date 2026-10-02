import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing via Node's built-in `crypto.scrypt`, not bcrypt/argon2.
 *
 * DECISION (documented, not silently made): scrypt is a well-regarded,
 * memory-hard KDF suitable for password hashing, and it ships in Node's
 * standard library — so this avoids adding bcrypt/argon2 as a new
 * dependency (and avoids bcrypt's native-addon build entirely, which
 * would be one more thing that could fail to compile in a restricted
 * network environment, as Prisma's engine download already does in this
 * project). If the team later prefers a dedicated password-hashing
 * library, swapping this module out is a contained change — nothing
 * outside auth/password.ts depends on the storage format.
 */

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Format: "<saltHex>:<hashHex>". Never store or log the raw password. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Constant-time comparison against a stored hash. Returns false (never
 * throws) for malformed stored values so a corrupted/unexpected DB value
 * fails closed rather than crashing the login request.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (
    !saltHex ||
    !hashHex ||
    stored.split(":").length !== 2 ||
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{128}$/i.test(hashHex)
  ) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }

  if (expected.length === 0) {
    return false;
  }

  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A precomputed hash of a value nobody will ever type, used to perform a
 * "dummy" verifyPassword() call when a phone number isn't found. This
 * keeps the login endpoint's timing profile closer to the "user exists,
 * wrong password" case, reducing (not eliminating) the ability to
 * distinguish "unknown phone" from "wrong password" via response timing.
 */
export const DUMMY_PASSWORD_HASH = hashPassword("dummy-password-for-timing-normalization");
