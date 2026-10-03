import type { UserRole } from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import type { UserRecordForAuth } from "./authService.js";

/**
 * The real (Prisma/PostgreSQL-backed) implementation of AuthDeps.findUserByPhone.
 *
 * NOTE ON VERIFICATION: this file cannot be integration-tested in the
 * sandbox this was built in — the same network restriction that blocks
 * `prisma generate`/`migrate` (see Unit 0/Unit 1 reports) also means
 * there is no live PostgreSQL connection available here. `authService.ts`
 * (the actual login logic) is fully unit-tested against a fake
 * implementation of this same interface, so the business logic is
 * verified; this file is a thin, low-risk mapping from Prisma's User
 * model to UserRecordForAuth. Please verify this specific file against
 * your local database (e.g. seed a user, hit POST /api/auth/login) once
 * the Unit 1 migration has been applied.
 */
export async function findUserByPhone(phone: string): Promise<UserRecordForAuth | null> {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { phone }, include: { school: true } });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    schoolId: user.schoolId,
    name: user.name,
    phone: user.phone,
    passwordHash: user.passwordHash,
    role: user.role as UserRole,
    isActive: user.isActive,
    schoolStatus: user.school.status
  };
}
