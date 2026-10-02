import type { UserRole } from "@drivemaster/shared";

/** The authenticated identity derived from a verified session token. */
export interface AuthenticatedIdentity {
  userId: string;
  schoolId: string;
  role: UserRole;
  name: string;
  phone: string;
}
