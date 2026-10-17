import type { UserRole } from "./domain.js";

/** Public identity returned by authenticated API endpoints. */
export interface AuthenticatedUser {
  id: string;
  schoolId: string;
  schoolName?: string;
  name: string;
  phone: string;
  role: UserRole;
}

/** Response contract for POST /api/auth/login. */
export interface LoginResponse {
  user: AuthenticatedUser;
}

/** Response contract for GET /api/auth/me. */
export interface MeResponse {
  user: AuthenticatedUser;
}

/** Response contract for POST /api/auth/logout. */
export interface LogoutResponse {
  success: true;
}

export interface OwnerVerificationStatus {
  verificationRequired: true;
  maskedPhone: string;
  resendAt: string | null;
  expiresAt: string | null;
  delivery: "sent" | "failed" | "not_sent";
}
