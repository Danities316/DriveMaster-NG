import type { UserRole } from "@drivemaster/shared";
import { verifyPasswordAsync, DUMMY_PASSWORD_HASH } from "./password.js";

/**
 * Internal shape of a user record as needed for authentication. Distinct
 * from the Prisma-generated User type and from the shared
 * `AuthenticatedUser` contract on purpose — this is an internal
 * implementation detail of the auth module, not exposed to the client
 * (it includes passwordHash) and not coupled to Prisma (see
 * userRepository.ts for the only file that bridges the two).
 */
export interface UserRecordForAuth {
  id: string;
  schoolId: string;
  schoolName?: string;
  name: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  phoneVerificationRequired?: boolean;
  sessionVersion?: number;
  schoolStatus?: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
}

export interface AuthDeps {
  isTokenRevoked?: (token: string) => Promise<boolean>;
  revokeToken?: (token: string, expiresAt: Date) => Promise<void>;
  findUserByPhone: (phone: string) => Promise<UserRecordForAuth | null>;
}

export type LoginResult =
  | { ok: true; user: UserRecordForAuth }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "ACCOUNT_INACTIVE" };

/**
 * Verifies phone + password. Deliberately does not distinguish "unknown
 * phone" from "wrong password" in its result reason as far as the HTTP
 * layer is concerned (routes/auth.ts maps both to the same generic
 * client-facing message) — see PRD-driven requirement: "Do not expose
 * security-sensitive information by revealing whether a specific phone
 * number exists."
 */
export async function login(phone: string, password: string, deps: AuthDeps): Promise<LoginResult> {
  const user = await deps.findUserByPhone(phone);

  if (!user) {
    // Perform a dummy hash comparison so an unknown phone number takes
    // roughly the same time as a known phone number with a wrong
    // password, reducing (not eliminating) a timing side-channel.
    await verifyPasswordAsync(password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const passwordValid = await verifyPasswordAsync(password, user.passwordHash);
  if (!passwordValid) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (!user.isActive || user.schoolStatus === "SUSPENDED" || user.schoolStatus === "CLOSED") {
    return { ok: false, reason: "ACCOUNT_INACTIVE" };
  }

  return { ok: true, user };
}
