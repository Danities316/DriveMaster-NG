import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { queryLocalStudents, getLocalStudent } from "./studentLocalStore";

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

const ADA = {
  id: "student-ada",
  schoolId: SCHOOL_A,
  name: "Ada Okafor",
  phone: "+2348011111111",
  licenseNumber: null,
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00",
  amountPaid: "0.00",
  balanceRemaining: "100000.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const BOLA = {
  ...ADA,
  id: "student-bola",
  name: "Bola Musa",
  phone: "+2348022222222"
};

const OTHER_SCHOOL_STUDENT = {
  ...ADA,
  id: "student-other-school",
  schoolId: SCHOOL_B,
  name: "Chidi Eze",
  phone: "+2348033333333"
};

describe("queryLocalStudents", () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.students.bulkAdd([ADA, BOLA, OTHER_SCHOOL_STUDENT]);
  });

  afterEach(async () => {
    await db.students.clear();
  });

  it("only returns students from the given school (tenant isolation, enforced client-side too)", async () => {
    const results = await queryLocalStudents(SCHOOL_A);
    expect(results.map((s) => s.id).sort()).toEqual(["student-ada", "student-bola"]);
  });

  it("sorts results alphabetically by name", async () => {
    const results = await queryLocalStudents(SCHOOL_A);
    expect(results.map((s) => s.name)).toEqual(["Ada Okafor", "Bola Musa"]);
  });

  it("filters by a case-insensitive partial name match", async () => {
    const results = await queryLocalStudents(SCHOOL_A, "ada");
    expect(results.map((s) => s.id)).toEqual(["student-ada"]);
  });

  it("filters by a partial phone match", async () => {
    const results = await queryLocalStudents(SCHOOL_A, "22222222");
    expect(results.map((s) => s.id)).toEqual(["student-bola"]);
  });

  it("returns nothing for a search term matching no one", async () => {
    const results = await queryLocalStudents(SCHOOL_A, "no-such-person");
    expect(results).toEqual([]);
  });
});

describe("getLocalStudent", () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.students.add(ADA);
  });

  afterEach(async () => {
    await db.students.clear();
  });

  it("returns the student when it exists locally", async () => {
    const result = await getLocalStudent(ADA.id);
    expect(result).toEqual(ADA);
  });

  it("returns null when the student is not cached locally", async () => {
    const result = await getLocalStudent("does-not-exist");
    expect(result).toBeNull();
  });
});
