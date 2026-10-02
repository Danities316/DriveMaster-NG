import request from "supertest";
import { createApp } from "../app.js";
import { createSessionToken } from "../auth/token.js";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { executeTraining, trainingSnapshot } from "./trainingService.js";
import {
  DEFAULT_SCHOOL_RULES,
  DEFAULT_ENROLLMENT_SETTINGS,
  type TrainingCommand,
  type TrainingOuting
} from "@drivemaster/shared";
const url = process.env["SYNC_TEST_DATABASE_URL"];
describe.skipIf(!url)("training PostgreSQL workflow", () => {
  let client: PrismaClient,
    schoolId: string,
    ownerId: string,
    instructorId: string,
    vehicleId: string,
    studentIds: string[],
    studentUsers: string[],
    packageId: string;
  const entry = (
    action: string,
    targetId: string,
    data: unknown,
    expectedVersion?: number
  ): TrainingCommand => ({ id: randomUUID(), action, targetId, data, expectedVersion });
  const send = (
    action: string,
    targetId: string,
    data: unknown,
    expectedVersion?: number,
    actorId = ownerId
  ) => executeTraining(schoolId, actorId, entry(action, targetId, data, expectedVersion));
  beforeAll(() => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/sync_test")
      throw new Error("Use a local sync_test database.");
    client = new PrismaClient({ datasources: { db: { url } } });
    globalThis.__drivemasterPrisma = client;
  });
  afterAll(async () => {
    await client?.$disconnect();
    globalThis.__drivemasterPrisma = undefined;
  });
  beforeEach(async () => {
    schoolId = randomUUID();
    ownerId = randomUUID();
    instructorId = randomUUID();
    vehicleId = randomUUID();
    studentIds = [randomUUID(), randomUUID(), randomUUID()];
    studentUsers = studentIds.map(() => randomUUID());
    packageId = randomUUID();
    await client.school.create({
      data: { id: schoolId, name: "Training test", phone: "test", address: "Test" }
    });
    await client.user.createMany({
      data: [
        {
          id: ownerId,
          schoolId,
          name: "Owner",
          phone: randomUUID(),
          passwordHash: "test",
          role: "OWNER"
        },
        {
          id: instructorId,
          schoolId,
          name: "Instructor",
          phone: randomUUID(),
          passwordHash: "test",
          role: "INSTRUCTOR"
        }
      ]
    });
    await client.vehicle.create({
      data: { id: vehicleId, schoolId, plateNumber: "TEST-123", model: "Car", status: "ACTIVE" }
    });
    for (let i = 0; i < studentIds.length; i++) {
      await client.student.create({
        data: {
          id: studentIds[i]!,
          schoolId,
          name: `Student ${i + 1}`,
          phone: randomUUID(),
          totalTuition: "1",
          enrollmentDate: new Date("2026-01-01")
        }
      });
      await client.user.create({
        data: {
          id: studentUsers[i]!,
          schoolId,
          studentId: studentIds[i]!,
          name: `Student ${i + 1}`,
          phone: randomUUID(),
          passwordHash: "test",
          role: "STUDENT"
        }
      });
    }
    await send("PACKAGE", packageId, { name: "Basic", price: "15000", sessions: 3, minutes: 30 });
    for (const studentId of studentIds)
      await send("ENROLL", randomUUID(), {
        studentId,
        packageId,
        packageVersion: 0,
        studentVersion: 0
      });
    await send("SALARY", randomUUID(), {
      instructorId,
      month: "2026-01",
      salary: "180000",
      teachingHours: 180
    });
  });
  const book = async (ids = studentIds.slice(0, 2), date = "2026-01-02T10:00:00Z") => {
    const id = randomUUID();
    await send("BOOK", id, { instructorId, vehicleId, plannedStart: date, studentIds: ids });
    return id;
  };
  const finish = (id: string, ids = studentIds.slice(0, 2), minutes = 30) =>
    send(
      "FINISH",
      id,
      {
        endedAt: "2026-01-02T11:00:00Z",
        odometer: 120,
        litres: "3",
        receiptReference: `R-${id}`,
        fuelDate: "2026-01-02T10:00:00Z",
        fuelOdometer: 100,
        fullTank: false,
        lessons: ids.map((studentId) => ({
          studentId,
          minutes,
          topics: "Steering and braking",
          note: "Improving"
        }))
      },
      1,
      instructorId
    );
  it("records actual group fuel spending, bounds returned money and deduplicates returns", async () => {
    const id = await book();
    await send(
      "START",
      id,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: studentIds.slice(0, 2) },
      0,
      instructorId
    );
    await send(
      "FINISH",
      id,
      {
        endedAt: "2026-01-02T11:00:00Z",
        odometer: 120,
        fuelSpent: "2400",
        litres: "2",
        receiptReference: "ACTUAL-1",
        fuelDate: "2026-01-02T10:00:00Z",
        fuelOdometer: 100,
        fullTank: false,
        lessons: studentIds
          .slice(0, 2)
          .map((studentId) => ({ studentId, minutes: 30, topics: "Driving", note: "" }))
      },
      1,
      instructorId
    );
    const snapshot = await trainingSnapshot(schoolId, ownerId);
    expect(snapshot.outings[0]?.data).toMatchObject({
      fuelIssued: "3000.00",
      fuelSpent: "2400.00",
      fuelSpendingBasis: "REPORTED"
    });
    expect(snapshot.summaries.find((s) => s.studentId === studentIds[0])?.fuelCost).toBe("1200.00");
    expect((await client.fuelLog.findFirst({ where: { schoolId } }))?.cost.toFixed(2)).toBe(
      "2400.00"
    );
    await expect(send("RETURN_FUEL", id, { amount: "601", reason: "Return" }, 2)).rejects.toThrow(
      /cannot exceed/
    );
    await expect(
      send("RETURN_FUEL", id, { amount: "600", reason: "Return" }, 2, instructorId)
    ).rejects.toThrow(/Only the owner/);
    const cmd = entry("RETURN_FUEL", id, { amount: "600", reason: "Cash received" }, 2);
    await executeTraining(schoolId, ownerId, cmd);
    await executeTraining(schoolId, ownerId, cmd);
    expect((await trainingSnapshot(schoolId, ownerId)).outings[0]?.data.fuelReturned).toBe(
      "600.00"
    );
    expect(await client.auditLog.count({ where: { schoolId, action: "RETURN_FUEL" } })).toBe(1);
  });
  it("finishes without inventing a fuel purchase when the instructor reports zero spending", async () => {
    const id = await book([studentIds[0]!]);
    await send(
      "START",
      id,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: [studentIds[0]] },
      0,
      instructorId
    );
    await send(
      "FINISH",
      id,
      {
        endedAt: "2026-01-02T10:30:00Z",
        odometer: 110,
        fuelSpent: "0",
        lessons: [{ studentId: studentIds[0], minutes: 30, topics: "Driving", note: "" }]
      },
      1,
      instructorId
    );
    expect(await client.fuelLog.count({ where: { schoolId } })).toBe(0);
    expect((await trainingSnapshot(schoolId, ownerId)).outings[0]?.data).toMatchObject({
      fuelSpent: "0.00",
      fuelIssued: "1500.00"
    });
  });
  it("keeps expense allocations exact, owner-only, private and reversible with history", async () => {
    const id = randomUUID(),
      data = {
        category: "Repairs",
        date: "2026-01-01",
        amount: "10",
        basis: "RECORDED",
        studentIds,
        reason: "Shared repair"
      };
    await expect(send("EXPENSE", id, data, undefined, instructorId)).rejects.toThrow(
      /Only the owner/
    );
    await expect(
      send("EXPENSE", id, {
        ...data,
        allocationMode: "CUSTOM",
        allocations: studentIds.map((studentId) => ({ studentId, amount: "3" }))
      })
    ).rejects.toThrow(/add up/);
    await expect(send("EXPENSE", id, { ...data, studentIds: [randomUUID()] })).rejects.toThrow(
      /enrolled student/
    );
    await send("EXPENSE", id, data);
    expect(
      (await trainingSnapshot(schoolId, ownerId)).expenses?.[0]?.data.allocations.map(
        (a) => a.amount
      )
    ).toEqual(["3.34", "3.33", "3.33"]);
    const student = await trainingSnapshot(schoolId, studentUsers[0]!);
    expect(student.expenses ?? []).toEqual([]);
    expect(student.summaries[0]).not.toHaveProperty("otherRecordedCost");
    expect((await trainingSnapshot(schoolId, instructorId)).expenses ?? []).toEqual([]);
    await send("VOID_EXPENSE", id, { reason: "Duplicate receipt" }, 0);
    const snapshot = await trainingSnapshot(schoolId, ownerId);
    expect(snapshot.expenses?.[0]?.data.voidReason).toBe("Duplicate receipt");
    expect(snapshot.summaries.find((s) => s.studentId === studentIds[0])?.otherRecordedCost).toBe(
      "0.00"
    );
  });
  it("uses configurable vehicle document rules for bookings and starts without preventing a trip from finishing", async () => {
    const docs = randomUUID(),
      rules = randomUUID();
    await expect(
      send("VEHICLE_DOCUMENTS", docs, {
        vehicleId: randomUUID(),
        insuranceExpiryDate: "",
        roadworthinessExpiryDate: "",
        reason: "Set dates"
      })
    ).rejects.toThrow(/your school/);
    await send("VEHICLE_DOCUMENTS", docs, {
      vehicleId,
      insuranceExpiryDate: "2026-01-01",
      roadworthinessExpiryDate: "2026-12-31",
      reason: "Read documents"
    });
    const trip = await book();
    await send("SCHOOL_RULES", rules, {
      ...DEFAULT_SCHOOL_RULES,
      vehicleExpiryAction: "BLOCK",
      reason: "Require valid documents"
    });
    await expect(book([studentIds[2]!], "2026-01-03T10:00:00Z")).rejects.toThrow(/insurance/i);
    await expect(
      send(
        "START",
        trip,
        { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: studentIds.slice(0, 2) },
        0,
        instructorId
      )
    ).rejects.toThrow(/insurance/i);
    await send(
      "VEHICLE_DOCUMENTS",
      docs,
      {
        vehicleId,
        insuranceExpiryDate: "2026-01-02",
        roadworthinessExpiryDate: "2026-12-31",
        reason: "Renewal"
      },
      0
    );
    await send(
      "START",
      trip,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: studentIds.slice(0, 2) },
      0,
      instructorId
    );
    await send(
      "VEHICLE_DOCUMENTS",
      docs,
      {
        vehicleId,
        insuranceExpiryDate: "2026-01-01",
        roadworthinessExpiryDate: "2026-12-31",
        reason: "Corrected date"
      },
      1
    );
    await finish(trip);
    expect((await trainingSnapshot(schoolId, ownerId)).outings[0]?.data.status).toBe("COMPLETED");
  });
  it("runs a group outing, saves fuel once, and lets each student respond privately", async () => {
    const id = await book();
    await send(
      "START",
      id,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: studentIds.slice(0, 2) },
      0,
      instructorId
    );
    await finish(id);
    const owner = await trainingSnapshot(schoolId, ownerId),
      student = await trainingSnapshot(schoolId, studentUsers[0]!);
    expect(owner.outings[0]?.data).toMatchObject({
      fuelIssued: "3000.00",
      fuelSpent: "3000.00",
      instructorCost: "1000.00"
    });
    expect(owner.summaries[0]).toMatchObject({
      fuelCost: "1500.00",
      instructorCost: "500.00",
      awaiting: 1,
      confirmed: 0
    });
    expect(await client.fuelLog.count({ where: { schoolId } })).toBe(1);
    expect(await client.mileageLog.count({ where: { schoolId } })).toBe(2);
    expect(student.lessons).toHaveLength(1);
    expect(student.summaries).toHaveLength(1);
    expect(student.outings).toEqual([]);
    expect(student.students).toEqual([]);
    expect(student.salaries).toEqual([]);
    expect(student.summaries[0]).not.toHaveProperty("fuelCost");
    expect(student.summaries[0]).not.toHaveProperty("expectedMargin");
    const instructor = await trainingSnapshot(schoolId, instructorId);
    expect(instructor.outings[0]?.data.salarySnapshot).toBeUndefined();
    expect(instructor.outings[0]?.data.members[0]?.instructorCost).toBeUndefined();
    await expect(
      send("RESPOND", id, { attended: true, reason: "" }, 2, instructorId)
    ).rejects.toThrow(/Only the student/);
    await expect(
      send("RESPOND", id, { attended: true, reason: "" }, 2, studentUsers[2]!)
    ).rejects.toThrow(/not waiting/);
    await send("RESPOND", id, { attended: true, reason: "" }, 2, studentUsers[0]!);
    await send(
      "RESPOND",
      id,
      { attended: false, reason: "The lesson did not happen" },
      3,
      studentUsers[1]!
    );
    await send(
      "RESOLVE",
      id,
      {
        studentId: studentIds[1],
        credit: false,
        reason: "Checked with both people; arrange a replacement"
      },
      4
    );
    const updated = await trainingSnapshot(schoolId, ownerId);
    expect(updated.summaries.find((s) => s.studentId === studentIds[0])?.confirmed).toBe(1);
    expect(updated.summaries.find((s) => s.studentId === studentIds[1])).toMatchObject({
      remaining: 3,
      costSoFar: "2000.00"
    });
  });
  it("rejects overlapping and duplicate group bookings under concurrent requests", async () => {
    const attempts = [randomUUID(), randomUUID()].map((id) =>
      send("BOOK", id, {
        instructorId,
        vehicleId,
        plannedStart: "2026-01-02T10:00:00Z",
        studentIds: [studentIds[0]]
      })
    );
    const outcomes = await Promise.allSettled(attempts);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(book([studentIds[0]!, studentIds[0]!])).rejects.toThrow(/only once/);
  });
  it("edits allowance defaults without changing old bookings and audits an outing override", async () => {
    const settingsId = randomUUID();
    await send("SETTINGS", settingsId, { fuelPerStudent: "2000", reason: "New fuel price" });
    const id = await book(studentIds);
    await send("SETTINGS", settingsId, { fuelPerStudent: "2500", reason: "Updated price" }, 0);
    expect((await trainingSnapshot(schoolId, ownerId)).outings[0]?.data.fuelPerStudent).toBe(
      "2000.00"
    );
    await expect(
      send("ALLOWANCE", id, { fuelPerStudent: "3000", reason: "Long outing" }, 0, instructorId)
    ).rejects.toThrow(/Only the owner/);
    await send("ALLOWANCE", id, { fuelPerStudent: "3000", reason: "Long outing" }, 0);
    const cmd = entry(
      "START",
      id,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: studentIds },
      1
    );
    await Promise.all([
      executeTraining(schoolId, instructorId, cmd),
      executeTraining(schoolId, instructorId, cmd)
    ]);
    expect((await trainingSnapshot(schoolId, ownerId)).outings[0]?.data.fuelIssued).toBe("9000.00");
    expect(await client.auditLog.count({ where: { schoolId, action: "START" } })).toBe(1);
    await expect(
      send("ALLOWANCE", id, { fuelPerStudent: "3500", reason: "Changed mind" }, 2)
    ).rejects.toThrow(/original amount/);
  });
  it("missed students keep their session and a booking can move without credit deduction", async () => {
    const id = await book();
    await send(
      "RESCHEDULE",
      id,
      { plannedStart: "2026-01-02T12:00:00Z", reason: "Student requested another time" },
      0
    );
    await send(
      "START",
      id,
      { startedAt: "2026-01-02T12:00:00Z", odometer: 100, present: [studentIds[0]] },
      1,
      instructorId
    );
    const snapshot = await trainingSnapshot(schoolId, ownerId);
    expect(snapshot.outings[0]?.data.fuelIssued).toBe("1500.00");
    expect(snapshot.summaries.find((s) => s.studentId === studentIds[1])).toMatchObject({
      remaining: 3,
      booked: 0,
      fuelCost: "0.00"
    });
  });
  it("keeps agreed package fees and blocks short-lesson credit and invalid mileage", async () => {
    await send(
      "PACKAGE",
      packageId,
      { name: "Repriced", price: "20000", sessions: 4, minutes: 30 },
      0
    );
    expect((await trainingSnapshot(schoolId, ownerId)).summaries[0]?.fee).toBe("15000.00");
    const id = await book([studentIds[0]!]);
    await send(
      "START",
      id,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: [studentIds[0]] },
      0,
      instructorId
    );
    await finish(id, [studentIds[0]!], 20);
    await expect(
      send("RESPOND", id, { attended: true, reason: "" }, 2, studentUsers[0]!)
    ).rejects.toThrow(/shorter than 30/);
    await send(
      "RESPOND",
      id,
      { attended: false, reason: "Only twenty minutes" },
      2,
      studentUsers[0]!
    );
    await expect(
      send("RESOLVE", id, { studentId: studentIds[0], credit: true, reason: "Count it" }, 3)
    ).rejects.toThrow(/shorter than 30/);
  });
  it("rejects another school, an unrelated instructor, stale writes and exhausted packages", async () => {
    await expect(
      executeTraining(randomUUID(), ownerId, entry("PACKAGE", randomUUID(), {}))
    ).rejects.toThrow(/sign in/);
    await expect(
      send(
        "SETTINGS",
        randomUUID(),
        { fuelPerStudent: "1500", reason: "test" },
        undefined,
        studentUsers[0]!
      )
    ).rejects.toThrow(/owner/);
    const id = await book([studentIds[0]!]);
    await expect(
      send("RESCHEDULE", id, { plannedStart: "2026-01-03T10:00:00Z", reason: "test" }, 9)
    ).rejects.toThrow(/another device/);
    await book([studentIds[0]!], "2026-01-03T10:00:00Z");
    await book([studentIds[0]!], "2026-01-04T10:00:00Z");
    await expect(book([studentIds[0]!], "2026-01-05T10:00:00Z")).rejects.toThrow(
      /no unbooked sessions/
    );
    const stored = await client.trainingRecord.findUnique({ where: { id } });
    expect((stored!.data as unknown as TrainingOuting).status).toBe("BOOKED");
  });

  it("keeps rule changes owner-only, versioned and separate from existing student agreements", async () => {
    const rulesId = randomUUID();
    const rules = { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 20, reason: "School target review" };
    await expect(send("SCHOOL_RULES", rulesId, rules, undefined, instructorId)).rejects.toThrow(
      /owner/
    );
    await send("SCHOOL_RULES", rulesId, rules);
    const original = await trainingSnapshot(schoolId, ownerId);
    expect(original.schoolRules?.data.schoolTargetDays).toBe(20);
    expect(original.enrollments[0]?.data.rulesSnapshot?.schoolTargetDays).toBe(26);
    await expect(send("SCHOOL_RULES", rulesId, rules, 99)).rejects.toThrow(/another device/);
    const agreement = original.enrollments[0]!;
    await send(
      "ENROLLMENT_RULES",
      agreement.id,
      { schoolTargetDays: 32, reason: "Student requested longer training" },
      agreement.version
    );
    const changed = await trainingSnapshot(schoolId, ownerId);
    expect(changed.enrollments.find((e) => e.id === agreement.id)?.data).toMatchObject({
      sessions: 3,
      price: "15000.00",
      rulesSnapshot: { schoolTargetDays: 32 }
    });
    const newStudent = await client.student.create({
      data: {
        schoolId,
        name: "Later student",
        phone: randomUUID(),
        totalTuition: "1",
        enrollmentDate: new Date()
      }
    });
    await expect(
      send("ENROLL", randomUUID(), {
        studentId: newStudent.id,
        packageId,
        studentVersion: 0,
        packageVersion: 0
      })
    ).rejects.toThrow(/School rules changed/);
    await send("ENROLL", randomUUID(), {
      studentId: newStudent.id,
      packageId,
      studentVersion: 0,
      packageVersion: 0,
      rulesVersion: 0
    });
    expect(
      (await trainingSnapshot(schoolId, ownerId)).enrollments.find(
        (e) => e.data.studentId === newStudent.id
      )?.data.rulesSnapshot?.schoolTargetDays
    ).toBe(20);
  });

  it("enforces document rules at booking, moving and starting without preventing completion", async () => {
    const outingId = await book([studentIds[0]!]);
    const rulesId = randomUUID();
    await send("SCHOOL_RULES", rulesId, {
      ...DEFAULT_SCHOOL_RULES,
      requireInstructorNin: true,
      requireInstructorLicence: true,
      permitExpiryAction: "BLOCK",
      reason: "Require current documents"
    });
    await expect(book([studentIds[1]!], "2026-01-03T10:00:00Z")).rejects.toThrow(/NIN/);
    await expect(
      send("RESCHEDULE", outingId, { plannedStart: "2026-01-03T10:00:00Z", reason: "Move" }, 0)
    ).rejects.toThrow(/NIN/);
    await expect(
      send(
        "START",
        outingId,
        { startedAt: "2026-01-02T10:00:00Z", odometer: 1000, present: [studentIds[0]] },
        0
      )
    ).rejects.toThrow(/NIN/);
    await client.user.update({
      where: { id: instructorId },
      data: {
        nin: "01234567890",
        drivers_license_number: "YEN12801AA01",
        permitExpiryDate: "2026-01-02"
      }
    });
    await expect(book([studentIds[1]!], "2026-01-03T10:00:00Z")).rejects.toThrow(/expired/);
    await send(
      "START",
      outingId,
      { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: [studentIds[0]] },
      0
    );
    await client.user.update({ where: { id: instructorId }, data: { permitExpiryDate: null } });
    await finish(outingId, [studentIds[0]!]);
    const safe = JSON.stringify(await trainingSnapshot(schoolId, ownerId));
    expect(safe).not.toContain("01234567890");
    expect(safe).not.toContain("YEN12801AA01");
    await send("SCHOOL_RULES", rulesId, { ...DEFAULT_SCHOOL_RULES, reason: "Warn instead" }, 0);
    await book([studentIds[1]!], "2026-01-03T10:00:00Z");
  });

  it("validates private profiles, rejects cross-school and stale edits, and masks audit identifiers", async () => {
    const secret = "profile-test-secret";
    const app = createApp({
      webOrigin: "http://localhost",
      authSecret: secret,
      sessionMaxAgeSeconds: 3600,
      secureCookies: false
    });
    const headersFor = async (id: string) => {
      const user = await client.user.findUniqueOrThrow({ where: { id } });
      return {
        Cookie:
          "dm_session=" +
          createSessionToken(
            {
              sub: id,
              schoolId: user.schoolId,
              role: user.role,
              name: user.name,
              phone: user.phone
            },
            secret,
            3600
          ),
        "X-Training-User": id,
        "X-Training-School": user.schoolId
      };
    };
    const headers = await headersFor(ownerId);
    await request(app)
      .get("/api/training/profiles")
      .set(await headersFor(instructorId))
      .expect(403);
    await request(app)
      .get("/api/training/profiles")
      .set(await headersFor(studentUsers[0]!))
      .expect(403);
    const input = {
      nin: "01234567890",
      drivers_license_number: "yen12801aa01",
      permitExpiryDate: "2027-09-28",
      expectedVersion: 0,
      reason: "First profile entry"
    };
    for (const bad of [
      { nin: "123" },
      { drivers_license_number: "YEN12801AA1" },
      { permitExpiryDate: "2026-02-30" }
    ]) {
      await request(app)
        .post(`/api/training/profiles/instructor/${instructorId}`)
        .set(headers)
        .send({ ...input, ...bad })
        .expect(400);
    }
    await request(app)
      .post(`/api/training/profiles/instructor/${instructorId}`)
      .set(headers)
      .send(input)
      .expect(200);
    await request(app)
      .post(`/api/training/profiles/instructor/${instructorId}`)
      .set(headers)
      .send(input)
      .expect(409);
    const otherSchool = await client.school.create({
      data: {
        name: "Other school",
        phone: randomUUID(),
        address: "Other",
        school_cac_rc: `RC-${randomUUID()}`.toUpperCase()
      }
    });
    const outsider = await client.user.create({
      data: {
        schoolId: otherSchool.id,
        name: "Other instructor",
        phone: randomUUID(),
        passwordHash: "test",
        role: "INSTRUCTOR"
      }
    });
    await request(app)
      .post(`/api/training/profiles/instructor/${outsider.id}`)
      .set(headers)
      .send(input)
      .expect(409);
    const schoolInput = {
      school_cac_rc: otherSchool.school_cac_rc,
      frsc_accreditation_number: "FRSC-TEST",
      expectedVersion: 0,
      reason: "Registration details"
    };
    await request(app)
      .post("/api/training/profiles/school")
      .set(headers)
      .send(schoolInput)
      .expect(409);
    await request(app)
      .post("/api/training/profiles/school")
      .set(headers)
      .send({ ...schoolInput, school_cac_rc: `rc-${randomUUID()}` })
      .expect(200);
    const response = await request(app).get("/api/training/profiles").set(headers).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.instructors[0]).toMatchObject({
      nin: "01234567890",
      drivers_license_number: "YEN12801AA01",
      profileVersion: 1
    });
    const audit = JSON.stringify(
      await client.auditLog.findMany({ where: { schoolId, entity: "instructor_profile" } })
    );
    expect(audit).toContain("First profile entry");
    expect(audit).not.toContain("01234567890");
    expect(audit).not.toContain("YEN12801AA01");
  });

  it("runs QR registration through review, real payment and activation without leaking biodata", async () => {
    const app = createApp({
      webOrigin: "http://localhost",
      authSecret: "intake-test-secret",
      sessionMaxAgeSeconds: 3600,
      secureCookies: false
    });
    const headersFor = async (id: string) => {
      const user = await client.user.findUniqueOrThrow({ where: { id } });
      return {
        Cookie:
          "dm_session=" +
          createSessionToken(
            {
              sub: id,
              schoolId: user.schoolId,
              role: user.role,
              name: user.name,
              phone: user.phone
            },
            "intake-test-secret",
            3600
          ),
        "X-Training-User": id,
        "X-Training-School": user.schoolId
      };
    };
    const headers = await headersFor(ownerId);
    await request(app).get(`/api/enroll/${schoolId}`).expect(404);
    const settingsId = randomUUID();
    await send("ENROLLMENT_SETTINGS", settingsId, {
      ...DEFAULT_ENROLLMENT_SETTINGS,
      enabled: true,
      packageIds: [packageId],
      requiredFields: ["nin"],
      reason: "Open registration"
    });
    const info = await request(app).get(`/api/enroll/${schoolId}`).expect(200);
    expect(info.body.packages).toHaveLength(1);
    expect(info.body).not.toHaveProperty("students");
    const input = {
      id: randomUUID(),
      packageId,
      packageVersion: 0,
      settingsVersion: 0,
      rulesVersion: -1,
      details: {
        firstName: "New",
        lastName: "Learner",
        phone: "08012345678",
        nin: "01234567890",
        bloodGroup: "A+"
      },
      consent: true,
      website: ""
    };
    await request(app)
      .post(`/api/enroll/${schoolId}`)
      .send({ ...input, details: { ...input.details, nin: "123" } })
      .expect(400);
    await request(app)
      .post(`/api/enroll/${schoolId}`)
      .send({ ...input, details: { ...input.details, bloodGroup: "Unknown" } })
      .expect(400);
    await request(app).post(`/api/enroll/${schoolId}`).send(input).expect(201);
    await request(app).post(`/api/enroll/${schoolId}`).send(input).expect(201);
    expect(await client.enrollmentApplication.count({ where: { schoolId } })).toBe(1);
    await request(app)
      .post(`/api/enroll/${schoolId}`)
      .send({ ...input, id: randomUUID() })
      .expect(409);
    await request(app)
      .get("/api/training/applications")
      .set(await headersFor(instructorId))
      .expect(403);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "REVIEW", expectedVersion: 0, reason: "Details checked" })
      .expect(200);
    const row = await client.enrollmentApplication.findUniqueOrThrow({ where: { id: input.id } });
    const newStudent = row.studentId!;
    await expect(book([newStudent])).rejects.toThrow(/waiting for payment/);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "ACTIVATE", expectedVersion: 1, reason: "Start" })
      .expect(409);
    await request(app)
      .post(`/api/students/${newStudent}/payments`)
      .set(headers)
      .send({ id: randomUUID(), amount: "1000", paymentDate: "2026-01-01", method: "CASH" })
      .expect(201);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "ACTIVATE", expectedVersion: 1, reason: "First payment received" })
      .expect(200);
    await book([newStudent]);
    expect(
      (await client.enrollmentApplication.findUniqueOrThrow({ where: { id: input.id } })).status
    ).toBe("ACTIVE");
    const snapshot = JSON.stringify(await trainingSnapshot(schoolId, ownerId));
    expect(snapshot).not.toContain("01234567890");
    const sync = JSON.stringify(
      await client.syncChange.findMany({ where: { schoolId } }),
      (_key, value) => (typeof value === "bigint" ? value.toString() : value)
    );
    expect(sync).not.toContain("01234567890");
    expect(JSON.stringify(await client.auditLog.findMany({ where: { schoolId } }))).not.toContain(
      "01234567890"
    );
    const receptionist = await client.user.create({
      data: {
        schoolId,
        name: "Office",
        phone: randomUUID(),
        passwordHash: "test",
        role: "RECEPTIONIST"
      }
    });
    const safeList = await request(app)
      .get("/api/training/applications?status=ACTIVE")
      .set(await headersFor(receptionist.id))
      .expect(200);
    expect(safeList.body.applications[0]).not.toHaveProperty("details");
    await send(
      "ENROLLMENT_SETTINGS",
      settingsId,
      { ...DEFAULT_ENROLLMENT_SETTINGS, reason: "Close registration" },
      0
    );
    await request(app).get(`/api/enroll/${schoolId}`).expect(404);
    await request(app).post(`/api/enroll/${schoolId}`).send(input).expect(201);
  });

  it("rejects stale public offers and cross-school review and allows owner-authorised unpaid activation", async () => {
    const app = createApp({
      webOrigin: "http://localhost",
      authSecret: "intake-secret",
      sessionMaxAgeSeconds: 3600,
      secureCookies: false
    });
    const owner = await client.user.findUniqueOrThrow({ where: { id: ownerId } });
    const headers = {
      Cookie:
        "dm_session=" +
        createSessionToken(
          { sub: ownerId, schoolId, role: "OWNER", name: owner.name, phone: owner.phone },
          "intake-secret",
          3600
        ),
      "X-Training-User": ownerId,
      "X-Training-School": schoolId
    };
    await send("ENROLLMENT_SETTINGS", randomUUID(), {
      ...DEFAULT_ENROLLMENT_SETTINGS,
      enabled: true,
      allowUnpaidStart: true,
      packageIds: [packageId],
      reason: "Allow instalments later"
    });
    const input = {
      id: randomUUID(),
      packageId,
      packageVersion: 99,
      settingsVersion: 0,
      rulesVersion: -1,
      details: { firstName: "Another", lastName: "Learner", phone: "08012345679" },
      consent: true
    };
    await request(app).post(`/api/enroll/${schoolId}`).send(input).expect(409);
    await request(app)
      .post(`/api/enroll/${schoolId}`)
      .send({ ...input, packageVersion: 0 })
      .expect(201);
    await request(app)
      .post(`/api/training/applications/${randomUUID()}`)
      .set(headers)
      .send({ action: "REVIEW", expectedVersion: 0, reason: "Wrong record" })
      .expect(404);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "REVIEW", expectedVersion: 0, reason: "Reviewed" })
      .expect(200);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "REVIEW", expectedVersion: 0, reason: "Duplicate" })
      .expect(409);
    await request(app)
      .post(`/api/training/applications/${input.id}`)
      .set(headers)
      .send({ action: "ACTIVATE", expectedVersion: 1, reason: "Owner allows later payment" })
      .expect(200);
    expect(await client.payment.count({ where: { schoolId } })).toBe(0);
  });

  it("enforces school completion on the server and adds extra lessons and fees exactly once", async () => {
    const enrollment = (await trainingSnapshot(schoolId, ownerId)).enrollments.find(
      (e) => e.data.studentId === studentIds[0]
    )!;
    await expect(
      send("COMPLETE_SCHOOL", enrollment.id, { reason: "Too early" }, enrollment.version)
    ).rejects.toThrow(/not reached/);
    const student = await client.student.findUniqueOrThrow({ where: { id: studentIds[0] } });
    const command = entry(
      "EXTRA_LESSONS",
      enrollment.id,
      { sessions: 30, fee: "5000", studentVersion: student.version, reason: "Extra practice" },
      enrollment.version
    );
    await executeTraining(schoolId, ownerId, command);
    await executeTraining(schoolId, ownerId, command);
    const after = (await trainingSnapshot(schoolId, ownerId)).enrollments.find(
      (e) => e.id === enrollment.id
    )!;
    expect(after.data.sessions).toBe(33);
    expect(
      (
        await client.student.findUniqueOrThrow({ where: { id: studentIds[0] } })
      ).totalTuition.toFixed(2)
    ).toBe("20000.00");
    for (let day = 1; day <= 26; day++) {
      const startedAt = new Date(Date.UTC(2026, 0, day, 9)).toISOString();
      await client.trainingRecord.create({
        data: {
          id: randomUUID(),
          schoolId,
          kind: "outing",
          data: {
            instructorId,
            vehicleId,
            startedAt,
            endedAt: new Date(Date.parse(startedAt) + 1800000).toISOString(),
            plannedStart: startedAt,
            plannedEnd: startedAt,
            status: "COMPLETED",
            fuelPerStudent: "1500",
            allowanceReason: "test",
            members: [
              {
                studentId: studentIds[0]!,
                enrollmentId: enrollment.id,
                status: "CONFIRMED",
                minutes: 30
              }
            ]
          }
        }
      });
    }
    await send("COMPLETE_SCHOOL", enrollment.id, { reason: "Target reached" }, after.version);
    const summary = (await trainingSnapshot(schoolId, ownerId)).summaries.find(
      (s) => s.studentId === studentIds[0]
    )!;
    expect(summary).toMatchObject({
      qualifyingDays: 26,
      schoolTargetMet: true,
      dsspMinimumMet: true,
      remaining: 7
    });
    expect(summary.schoolCompletedAt).toBeTruthy();
    await book([studentIds[0]!], "2026-02-01T10:00:00Z");
  });

  it("requires a matching signed-in account and provisions a private student login", async () => {
    const app = createApp({
      webOrigin: "http://localhost",
      authSecret: "training-test-secret",
      sessionMaxAgeSeconds: 3600,
      secureCookies: false
    });
    const owner = await client.user.findUniqueOrThrow({ where: { id: ownerId } });
    const token = createSessionToken(
      { sub: owner.id, schoolId, role: "OWNER", name: owner.name, phone: owner.phone },
      "training-test-secret",
      3600
    );
    const headers = {
      Cookie: "dm_session=" + token,
      "X-Training-User": owner.id,
      "X-Training-School": schoolId
    };
    await request(app).get("/api/training/snapshot").set({ Cookie: headers.Cookie }).expect(409);
    const studentId = randomUUID(),
      phone = randomUUID().slice(0, 24);
    await client.student.create({
      data: {
        id: studentId,
        schoolId,
        name: "New student",
        phone,
        totalTuition: "15000",
        enrollmentDate: new Date("2026-01-01")
      }
    });
    await request(app)
      .post("/api/training/accounts")
      .set(headers)
      .send({ role: "STUDENT", studentId, name: "Ignored", phone, password: "Private-pass-123" })
      .expect(201);
    const account = await client.user.findFirstOrThrow({ where: { studentId } });
    expect(account.name).toBe("New student");
    expect(account.passwordHash).not.toBe("Private-pass-123");
    const login = await request(app)
      .post("/api/auth/login")
      .send({ phone, password: "Private-pass-123" })
      .expect(200);
    expect(login.body.user.role).toBe("STUDENT");
    const studentCookie = login.headers["set-cookie"];
    const studentHeaders = {
      Cookie: studentCookie,
      "X-Training-User": account.id,
      "X-Training-School": schoolId
    };
    const personal = await request(app)
      .get("/api/training/snapshot")
      .set(studentHeaders)
      .expect(200);
    expect(personal.body.outings).toEqual([]);
    expect(personal.body.salaries).toEqual([]);
    await request(app).get("/api/students").set(studentHeaders).expect(403);
    await request(app)
      .post("/api/training/accounts")
      .set(studentHeaders)
      .send({ role: "INSTRUCTOR", name: "Bad", phone: randomUUID(), password: "Private-pass-123" })
      .expect(403);
    await request(app)
      .post("/api/training/password")
      .set(studentHeaders)
      .send({ currentPassword: "Private-pass-123", password: "New-private-456" })
      .expect(200);
    await request(app)
      .post("/api/auth/login")
      .send({ phone, password: "Private-pass-123" })
      .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ phone, password: "New-private-456" })
      .expect(200);
    const audits = await client.auditLog.findMany({
      where: { schoolId, entity: "training_account" }
    });
    expect(JSON.stringify(audits)).not.toContain("Private-pass-123");
  });
});
