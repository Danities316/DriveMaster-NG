import { getPrismaClient } from "../prisma.js";
import { hashPasswordAsync } from "./password.js";
import {
  DEFAULT_ENROLLMENT_SETTINGS,
  DEFAULT_SCHOOL_CURRICULUM,
  DEFAULT_SCHOOL_RULES,
  DEFAULT_STARTER_PACKAGE,
  DEFAULT_TRAINING_SETTINGS
} from "@drivemaster/shared";

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
  const passwordHash = await hashPasswordAsync(input.password);
  return prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: input.schoolName,
        phone: input.phone,
        address: input.schoolAddress,
        school_cac_rc: input.cacNumber || null,
        frsc_accreditation_number: input.frscNumber || null,
        status: "TRIAL",
        trialEndsAt: null
      }
    });
    const user = await tx.user.create({
      data: {
        schoolId: school.id,
        name: input.ownerName,
        phone: input.phone,
        passwordHash,
        role: "OWNER",
        isActive: true,
        phoneVerificationRequired: true
      }
    });
    const starterRecords = [
      [`package-${school.id}-starter`, "package", DEFAULT_STARTER_PACKAGE],
      [`settings-${school.id}`, "settings", DEFAULT_TRAINING_SETTINGS],
      [`school-rules-${school.id}`, "school_rules", DEFAULT_SCHOOL_RULES],
      [`enrollment-settings-${school.id}`, "enrollment_settings", DEFAULT_ENROLLMENT_SETTINGS],
      [`curriculum-${school.id}`, "curriculum", DEFAULT_SCHOOL_CURRICULUM]
    ] as const;
    await tx.trainingRecord.createMany({
      data: starterRecords.map(([id, kind, data]) => ({
        id,
        schoolId: school.id,
        kind,
        data: JSON.parse(JSON.stringify(data))
      }))
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
