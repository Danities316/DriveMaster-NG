import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import type { AuthDeps, UserRecordForAuth } from "../auth/authService.js";
import { hashPassword } from "../auth/password.js";
import type { StudentDeps, StudentRecord } from "../students/studentService.js";

const AUTH_SECRET = "students-route-test-secret-at-least-32-chars";
const SESSION_MAX_AGE_SECONDS = 3600;

const OWNER_A: UserRecordForAuth = {
  id: "user-owner-a",
  schoolId: "school-a",
  name: "Ada Owner",
  phone: "+2348011111111",
  passwordHash: hashPassword("correct-password"),
  role: "OWNER",
  isActive: true
};

const RECEPTIONIST_A: UserRecordForAuth = {
  id: "user-receptionist-a",
  schoolId: "school-a",
  name: "Bola Receptionist",
  phone: "+2348022222222",
  passwordHash: hashPassword("correct-password"),
  role: "RECEPTIONIST",
  isActive: true
};

const INSTRUCTOR_A: UserRecordForAuth = {
  id: "user-instructor-a",
  schoolId: "school-a",
  name: "Chidi Instructor",
  phone: "+2348033333333",
  passwordHash: hashPassword("correct-password"),
  role: "INSTRUCTOR",
  isActive: true
};

function buildAuthDeps(): AuthDeps {
  const usersByPhone = new Map<string, UserRecordForAuth>(
    [OWNER_A, RECEPTIONIST_A, INSTRUCTOR_A].map((u) => [u.phone, u])
  );
  return { findUserByPhone: async (phone) => usersByPhone.get(phone) ?? null };
}

function buildStudentDeps(seed: StudentRecord[] = []) {
  const students = new Map<string, StudentRecord>(seed.map((s) => [s.id, s]));
  const deps: StudentDeps = {
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
      return { students: matches.slice(query.offset, query.offset + query.limit), total };
    },
    updateStudentRecord: async (id, patch) => {
      const existing = students.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      students.set(id, updated);
      return updated;
    },
    sumPaymentsByStudentIds: async () => ({})
  };
  return { deps, students };
}

function buildApp(studentDeps: StudentDeps) {
  return createApp({
    webOrigin: "http://localhost:5173",
    authSecret: AUTH_SECRET,
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    secureCookies: false,
    authDeps: buildAuthDeps(),
    studentDeps
  });
}

function extractSessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) throw new Error("Expected a Set-Cookie header");
  return header.split(";")[0] ?? "";
}

async function loginAs(app: ReturnType<typeof buildApp>, user: UserRecordForAuth): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ phone: user.phone, password: "correct-password" });
  return extractSessionCookie(res);
}

const STUDENT_A1: StudentRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  schoolId: "school-a",
  name: "Ngozi Adekunle",
  phone: "+2348055555555",
  licenseNumber: null,
  enrollmentDate: "2026-01-01T00:00:00.000Z",
  totalTuition: "150000.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const STUDENT_B1: StudentRecord = {
  id: "22222222-2222-2222-2222-222222222222",
  schoolId: "school-b",
  name: "Tunde Bello",
  phone: "+2348066666666",
  licenseNumber: null,
  enrollmentDate: "2026-01-01T00:00:00.000Z",
  totalTuition: "90000.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("Student Management routes", () => {
  let studentDeps: StudentDeps;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    const built = buildStudentDeps([STUDENT_A1, STUDENT_B1]);
    studentDeps = built.deps;
    app = buildApp(studentDeps);
  });

  describe("authentication", () => {
    it("rejects listing students with no session", async () => {
      const res = await request(app).get("/api/students");
      expect(res.status).toBe(401);
    });

    it("rejects creating a student with no session", async () => {
      const res = await request(app).post("/api/students").send({});
      expect(res.status).toBe(401);
    });
  });

  describe("role enforcement", () => {
    it("allows OWNER to list students", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app).get("/api/students").set("Cookie", cookie);
      expect(res.status).toBe(200);
    });

    it("allows RECEPTIONIST to list students", async () => {
      const cookie = await loginAs(app, RECEPTIONIST_A);
      const res = await request(app).get("/api/students").set("Cookie", cookie);
      expect(res.status).toBe(200);
    });

    it("denies INSTRUCTOR access to student endpoints (documented Unit 3 restriction)", async () => {
      const cookie = await loginAs(app, INSTRUCTOR_A);
      const res = await request(app).get("/api/students").set("Cookie", cookie);
      expect(res.status).toBe(403);
    });
  });

  describe("tenant isolation", () => {
    it("only lists students belonging to the authenticated user's school", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app).get("/api/students").set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([STUDENT_A1.id]);
    });

    it("returns 404 (not 403) when fetching another school's student by id", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app).get(`/api/students/${STUDENT_B1.id}`).set("Cookie", cookie);

      expect(res.status).toBe(404);
    });

    it("returns the SAME 404 body for a cross-school id as for a genuinely missing id", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const crossSchool = await request(app)
        .get(`/api/students/${STUDENT_B1.id}`)
        .set("Cookie", cookie);
      const missing = await request(app)
        .get("/api/students/00000000-0000-0000-0000-000000000000")
        .set("Cookie", cookie);

      expect(crossSchool.status).toBe(missing.status);
      expect(crossSchool.body).toEqual(missing.body);
    });

    it("refuses to update another school's student", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app)
        .patch(`/api/students/${STUDENT_B1.id}`)
        .set("Cookie", cookie)
        .send({ name: "Hacked" });

      expect(res.status).toBe(404);
    });
  });

  describe("create", () => {
    it("creates a student and returns financial visibility fields", async () => {
      const cookie = await loginAs(app, RECEPTIONIST_A);
      const res = await request(app).post("/api/students").set("Cookie", cookie).send({
        id: "33333333-3333-3333-3333-333333333333",
        name: "Emeka Nwosu",
        phone: "08099999999",
        enrollmentDate: "2026-02-01",
        totalTuition: "200000.00"
      });

      expect(res.status).toBe(201);
      expect(res.body.student).toMatchObject({
        name: "Emeka Nwosu",
        schoolId: "school-a",
        amountPaid: "0.00",
        balanceRemaining: "200000.00"
      });
    });

    it("rejects a create request missing required fields", async () => {
      const cookie = await loginAs(app, RECEPTIONIST_A);
      const res = await request(app).post("/api/students").set("Cookie", cookie).send({ name: "" });

      expect(res.status).toBe(400);
    });

    it("rejects a malformed tuition amount", async () => {
      const cookie = await loginAs(app, RECEPTIONIST_A);
      const res = await request(app).post("/api/students").set("Cookie", cookie).send({
        id: "44444444-4444-4444-4444-444444444444",
        name: "Bad Amount",
        phone: "08088888888",
        enrollmentDate: "2026-02-01",
        totalTuition: "not-a-number"
      });

      expect(res.status).toBe(400);
    });
  });

  describe("search", () => {
    it("filters the list by name or phone", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app)
        .get("/api/students")
        .query({ search: "ngozi" })
        .set("Cookie", cookie);

      expect(res.status).toBe(200);
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0].id).toBe(STUDENT_A1.id);
    });
  });

  describe("update", () => {
    it("applies a partial update to a student in the same school", async () => {
      const cookie = await loginAs(app, OWNER_A);
      const res = await request(app)
        .patch(`/api/students/${STUDENT_A1.id}`)
        .set("Cookie", cookie)
        .send({ totalTuition: "175000.00" });

      expect(res.status).toBe(200);
      expect(res.body.student.totalTuition).toBe("175000.00");
      expect(res.body.student.balanceRemaining).toBe("175000.00");
    });
  });
});
