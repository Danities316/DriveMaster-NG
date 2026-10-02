import { getPrismaClient } from "../prisma.js";
import type {
  StudentRecord,
  CreateStudentInput,
  UpdateStudentInput,
  ListStudentsQuery
} from "./studentService.js";
import { KnownApiError } from "../middleware/errorHandler.js";

/**
 * NOTE ON VERIFICATION: same limitation as auth/userRepository.ts — this
 * sandbox cannot reach the Prisma engine binaries needed for
 * `prisma generate`/`migrate` against a live PostgreSQL database (see
 * Unit 0/1 reports), so this file cannot be integration-tested here.
 * `studentService.ts` (all the actual business logic — balance
 * calculation, tenant isolation, search) is fully unit-tested against a
 * fake implementation of the same `StudentDeps` interface. This file is a
 * thin, low-risk mapping from Prisma's Student model to `StudentRecord`.
 * Please verify it against your local database once the Unit 1 migration
 * has been applied.
 */

interface PrismaStudentRow {
  id: string;
  schoolId: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  enrollmentDate: Date;
  totalTuition: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
}

function toStudentRecord(row: PrismaStudentRow): StudentRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    phone: row.phone,
    licenseNumber: row.licenseNumber,
    enrollmentDate: row.enrollmentDate.toISOString(),
    totalTuition: row.totalTuition.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function createStudentRecord(
  schoolId: string,
  input: CreateStudentInput
): Promise<StudentRecord> {
  const prisma = getPrismaClient();
  try {
    const created = await prisma.student.create({
      data: {
        // Honors the client-generated id (offline-first requirement, PRD
        // Unit 1) instead of relying on Prisma's server-side default(uuid()).
        id: input.id,
        schoolId,
        name: input.name,
        phone: input.phone,
        licenseNumber: input.licenseNumber ?? null,
        enrollmentDate: new Date(input.enrollmentDate),
        totalTuition: input.totalTuition
      }
    });
    return toStudentRecord(created as PrismaStudentRow);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const existing = await findStudentById(input.id, schoolId);
      if (existing) return existing;
      throw new KnownApiError("Student id is already used for different data.", 409, "ID_CONFLICT");
    }
    throw error;
  }
}

export async function findStudentById(id: string, schoolId: string): Promise<StudentRecord | null> {
  const prisma = getPrismaClient();
  const student = await prisma.student.findUnique({ where: { id, schoolId } });
  return student ? toStudentRecord(student as PrismaStudentRow) : null;
}

export async function findStudentsBySchool(
  schoolId: string,
  query: ListStudentsQuery
): Promise<{ students: StudentRecord[]; total: number }> {
  const prisma = getPrismaClient();
  const where = {
    schoolId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search } }
          ]
        }
      : {})
  };

  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy: { name: "asc" },
      take: query.limit,
      skip: query.offset
    }),
    prisma.student.count({ where })
  ]);

  return { students: (rows as PrismaStudentRow[]).map(toStudentRecord), total };
}

export async function updateStudentRecord(
  id: string,
  patch: UpdateStudentInput,
  schoolId: string
): Promise<StudentRecord> {
  const prisma = getPrismaClient();
  const updated = await prisma.student.update({
    where: { id, schoolId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.licenseNumber !== undefined ? { licenseNumber: patch.licenseNumber } : {}),
      ...(patch.enrollmentDate !== undefined
        ? { enrollmentDate: new Date(patch.enrollmentDate) }
        : {}),
      ...(patch.totalTuition !== undefined ? { totalTuition: patch.totalTuition } : {})
    }
  });
  return toStudentRecord(updated as PrismaStudentRow);
}
