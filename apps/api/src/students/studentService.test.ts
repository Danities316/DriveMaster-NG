import { beforeEach, describe, expect, it } from "vitest";
import {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  type StudentDeps,
  type StudentRecord
} from "./studentService.js";

function buildFakeDeps(seed: StudentRecord[] = []): StudentDeps {
  const students = new Map<string, StudentRecord>(seed.map((student) => [student.id, student]));
  const payments = new Map<string, string[]>();

  return {
    createStudentRecord: async (schoolId, input) => {
      const record: StudentRecord = {
        id: input.id,
        schoolId,
        name: input.name,
        phone: input.phone,
        licenseNumber: input.licenseNumber ?? null,
        enrollmentDate: input.enrollmentDate,
        totalTuition: input.totalTuition,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      students.set(record.id, record);
      return record;
    },
    findStudentById: async (id) => students.get(id) ?? null,
    findStudentsBySchool: async (schoolId, query) => {
      let matches = Array.from(students.values()).filter((s) => s.schoolId === schoolId);
      if (query.search) {
        const term = query.search.toLowerCase();
        matches = matches.filter(
          (s) => s.name.toLowerCase().includes(term) || s.phone.includes(term)
        );
      }
      matches.sort((a, b) => a.name.localeCompare(b.name));
      const total = matches.length;
      const page = matches.slice(query.offset, query.offset + query.limit);
      return { students: page, total };
    },
    updateStudentRecord: async (id, patch) => {
      const existing = students.get(id);
      if (!existing) {
        throw new Error("not found in fake store");
      }
      const updated: StudentRecord = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.licenseNumber !== undefined ? { licenseNumber: patch.licenseNumber } : {}),
        ...(patch.enrollmentDate !== undefined ? { enrollmentDate: patch.enrollmentDate } : {}),
        ...(patch.totalTuition !== undefined ? { totalTuition: patch.totalTuition } : {}),
        updatedAt: new Date().toISOString()
      };
      students.set(id, updated);
      return updated;
    },
    sumPaymentsByStudentIds: async (studentIds) => {
      const sums: Record<string, string> = {};
      for (const id of studentIds) {
        const amounts = payments.get(id) ?? [];
        if (amounts.length > 0) {
          sums[id] = amounts
            .reduce((total, amount) => total + Math.round(Number(amount) * 100), 0)
            .toString();
          // Represent as a proper decimal string for realism.
          sums[id] = (Number(sums[id]) / 100).toFixed(2);
        }
      }
      return sums;
    }
  };
}

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

describe("studentService", () => {
  let deps: StudentDeps;

  beforeEach(() => {
    deps = buildFakeDeps();
  });

  describe("createStudent", () => {
    it("replays the same client ID without duplicating the student", async () => {
      const input = {
        id: "retry-student",
        name: "Ada",
        phone: "08012345678",
        enrollmentDate: "2026-01-01",
        totalTuition: "100000.00"
      };
      const first = await createStudent(SCHOOL_A, input, deps);
      const replay = await createStudent(SCHOOL_A, { ...input, totalTuition: "100000" }, deps);
      expect(replay).toEqual(first);
      expect((await listStudents(SCHOOL_A, { limit: 50, offset: 0 }, deps)).total).toBe(1);
      await expect(createStudent(SCHOOL_A, { ...input, name: "Different" }, deps)).rejects.toThrow(
        /different data/
      );
    });
    it("creates a student and returns balance fields with zero paid so far", async () => {
      const student = await createStudent(
        SCHOOL_A,
        {
          id: "student-1",
          name: "Ada Okafor",
          phone: "+2348012345678",
          licenseNumber: null,
          enrollmentDate: "2026-01-01",
          totalTuition: "150000.00"
        },
        deps
      );

      expect(student.amountPaid).toBe("0.00");
      expect(student.balanceRemaining).toBe("150000.00");
      expect(student.schoolId).toBe(SCHOOL_A);
    });
  });

  describe("listStudents", () => {
    beforeEach(async () => {
      await createStudent(
        SCHOOL_A,
        {
          id: "a1",
          name: "Ada Okafor",
          phone: "+2348011111111",
          enrollmentDate: "2026-01-01",
          totalTuition: "100000.00"
        },
        deps
      );
      await createStudent(
        SCHOOL_A,
        {
          id: "a2",
          name: "Bola Musa",
          phone: "+2348022222222",
          enrollmentDate: "2026-01-02",
          totalTuition: "120000.00"
        },
        deps
      );
      await createStudent(
        SCHOOL_B,
        {
          id: "b1",
          name: "Chidi Eze",
          phone: "+2348033333333",
          enrollmentDate: "2026-01-03",
          totalTuition: "90000.00"
        },
        deps
      );
    });

    it("only returns students belonging to the requested school (tenant isolation)", async () => {
      const { students, total } = await listStudents(SCHOOL_A, { limit: 50, offset: 0 }, deps);
      expect(total).toBe(2);
      expect(students.map((s) => s.id).sort()).toEqual(["a1", "a2"]);
    });

    it("filters by search term across name and phone", async () => {
      const byName = await listStudents(SCHOOL_A, { search: "ada", limit: 50, offset: 0 }, deps);
      expect(byName.students.map((s) => s.id)).toEqual(["a1"]);

      const byPhone = await listStudents(
        SCHOOL_A,
        { search: "022222222", limit: 50, offset: 0 },
        deps
      );
      expect(byPhone.students.map((s) => s.id)).toEqual(["a2"]);
    });

    it("respects limit/offset for pagination", async () => {
      const page1 = await listStudents(SCHOOL_A, { limit: 1, offset: 0 }, deps);
      const page2 = await listStudents(SCHOOL_A, { limit: 1, offset: 1 }, deps);

      expect(page1.total).toBe(2);
      expect(page1.students).toHaveLength(1);
      expect(page2.students).toHaveLength(1);
      expect(page1.students[0]?.id).not.toBe(page2.students[0]?.id);
    });
  });

  describe("getStudent (tenant isolation)", () => {
    beforeEach(async () => {
      await createStudent(
        SCHOOL_A,
        {
          id: "a1",
          name: "Ada Okafor",
          phone: "+2348011111111",
          enrollmentDate: "2026-01-01",
          totalTuition: "100000.00"
        },
        deps
      );
    });

    it("returns the student when it belongs to the requesting school", async () => {
      const result = await getStudent(SCHOOL_A, "a1", deps);
      expect(result.ok).toBe(true);
    });

    it("returns NOT_FOUND for a genuinely missing id", async () => {
      const result = await getStudent(SCHOOL_A, "does-not-exist", deps);
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    });

    it("returns the SAME NOT_FOUND result for a student that exists but belongs to another school", async () => {
      const crossSchoolResult = await getStudent(SCHOOL_B, "a1", deps);
      const missingResult = await getStudent(SCHOOL_B, "does-not-exist", deps);
      expect(crossSchoolResult).toEqual(missingResult);
      expect(crossSchoolResult).toEqual({ ok: false, reason: "NOT_FOUND" });
    });
  });

  describe("financial visibility", () => {
    it("computes balanceRemaining as totalTuition minus summed payments", async () => {
      await createStudent(
        SCHOOL_A,
        {
          id: "a1",
          name: "Ada Okafor",
          phone: "+2348011111111",
          enrollmentDate: "2026-01-01",
          totalTuition: "150000.00"
        },
        deps
      );

      // Simulate payments existing (even though this unit has no way to
      // create them yet) by directly seeding the fake payment sum.
      const depsWithPayments: StudentDeps = {
        ...deps,
        sumPaymentsByStudentIds: async (ids) =>
          Object.fromEntries(ids.map((id) => [id, "45000.00"]))
      };

      const result = await getStudent(SCHOOL_A, "a1", depsWithPayments);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.student.amountPaid).toBe("45000.00");
        expect(result.student.balanceRemaining).toBe("105000.00");
      }
    });
  });

  describe("updateStudent (tenant isolation)", () => {
    beforeEach(async () => {
      await createStudent(
        SCHOOL_A,
        {
          id: "a1",
          name: "Ada Okafor",
          phone: "+2348011111111",
          enrollmentDate: "2026-01-01",
          totalTuition: "100000.00"
        },
        deps
      );
    });

    it("applies a partial update", async () => {
      const result = await updateStudent(SCHOOL_A, "a1", { totalTuition: "175000.00" }, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.student.totalTuition).toBe("175000.00");
        expect(result.student.name).toBe("Ada Okafor");
      }
    });

    it("refuses to update a student belonging to another school", async () => {
      const result = await updateStudent(SCHOOL_B, "a1", { name: "Hacked Name" }, deps);
      expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });

      // Confirm the record was genuinely untouched.
      const stillOriginal = await getStudent(SCHOOL_A, "a1", deps);
      expect(stillOriginal.ok).toBe(true);
      if (stillOriginal.ok) {
        expect(stillOriginal.student.name).toBe("Ada Okafor");
      }
    });
  });
});
