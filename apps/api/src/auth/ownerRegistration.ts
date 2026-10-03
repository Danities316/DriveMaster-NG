import { getPrismaClient } from "../prisma.js";
import { hashPassword } from "./password.js";

export interface OwnerRegistrationInput {
  ownerName: string;
  phone: string;
  password: string;
  schoolName: string;
  schoolAddress: string;
  cacNumber?: string | undefined;
  frscNumber?: string | undefined;
}

export async function registerOwner(input: OwnerRegistrationInput) {
  const prisma = getPrismaClient();
  const trialEndsAt = new Date();
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 14);

  return prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: input.schoolName,
        phone: input.phone,
        address: input.schoolAddress,
        school_cac_rc: input.cacNumber || null,
        frsc_accreditation_number: input.frscNumber || null,
        status: "TRIAL",
        trialEndsAt
      }
    });
    const user = await tx.user.create({
      data: {
        schoolId: school.id,
        name: input.ownerName,
        phone: input.phone,
        passwordHash: hashPassword(input.password),
        role: "OWNER",
        isActive: true
      }
    });
    await tx.auditLog.create({
      data: {
        schoolId: school.id,
        userId: user.id,
        action: "CREATE_SCHOOL_ACCOUNT",
        entity: "SCHOOL",
        entityId: school.id,
        metadata: { source: "OWNER_SELF_REGISTRATION" }
      }
    });
    await tx.platformAuditLog.create({
      data: {
        schoolId: school.id,
        action: "SCHOOL_REGISTERED",
        entity: "SCHOOL",
        entityId: school.id,
        metadata: { status: "TRIAL" }
      }
    });
    return { user, school };
  });
}
