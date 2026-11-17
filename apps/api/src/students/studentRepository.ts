import { getPrismaClient } from "../prisma.js";
import type {
  StudentRecord,
  CreateStudentInput,
  UpdateStudentInput,
  ListStudentsQuery
} from "./studentService.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import { writeAuditLog } from "../audit.js";

interface PrismaStudentRow {
  version: number;
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
    version: row.version,
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
  input: CreateStudentInput,
  actorId?: string
): Promise<StudentRecord> {
  const prisma = getPrismaClient();
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (
        !actorId ||
        !(await tx.user.findFirst({ where: { id: actorId, schoolId, isActive: true } }))
      )
        throw new KnownApiError("An active school staff account is required.", 403, "FORBIDDEN");
      const student = await tx.student.create({
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
      await writeAuditLog(tx, {
        schoolId,
        userId: actorId,
        action: "CREATE",
        entity: "STUDENT",
        entityId: student.id,
        metadata: {
          changedFields: ["name", "phone", "licenseNumber", "enrollmentDate", "totalTuition"]
        }
      });
      return student;
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
  schoolId: string,
  actorId?: string,
  expectedVersion?: number
): Promise<StudentRecord> {
  if (!Number.isInteger(expectedVersion) || expectedVersion! < 0)
    throw new KnownApiError(
      "Reload the student and submit the version you reviewed.",
      400,
      "VERSION_REQUIRED"
    );
  const prisma = getPrismaClient();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    if (
      !actorId ||
      !(await tx.user.findFirst({ where: { id: actorId, schoolId, isActive: true } }))
    )
      throw new KnownApiError("An active school staff account is required.", 403, "FORBIDDEN");
    const before = await tx.student.findUniqueOrThrow({ where: { id, schoolId } });
    if (before.version !== expectedVersion)
      throw new KnownApiError(
        "This student changed elsewhere. Reload before editing.",
        409,
        "STUDENT_CONFLICT"
      );
    const student = await tx.student.update({
      where: { id, schoolId, version: expectedVersion },
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
    await writeAuditLog(tx, {
      schoolId,
      userId: actorId,
      action: "UPDATE",
      entity: "STUDENT",
      entityId: id,
      metadata: { changedFields: Object.keys(patch) }
    });
    return student;
  });
  return toStudentRecord(updated as PrismaStudentRow);
}
