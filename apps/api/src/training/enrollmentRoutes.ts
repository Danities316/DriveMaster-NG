import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import {
  BLOOD_GROUPS,
  DEFAULT_ENROLLMENT_SETTINGS,
  DEFAULT_SCHOOL_RULES,
  INTAKE_FIELDS,
  isValidDate,
  lagosDay,
  sumMoney,
  validInstructorNin,
  type ApplicantDetails,
  type EnrollmentSettings,
  type SchoolRules,
  type TrainingPackage,
  type TrainingEnrollment
} from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";
import { KnownApiError } from "../middleware/errorHandler.js";

const fail = (message: string, status = 400): never => {
  throw new KnownApiError(message, status, "ENROLLMENT_ERROR");
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fieldNames = INTAKE_FIELDS.map(([key]) => key) as [string, ...string[]];
export const enrollmentSettingsInput = z.object({
  enabled: z.boolean(),
  welcome: z.string().trim().max(1000),
  packageIds: z.array(z.string().min(1).max(100)).max(100),
  requiredFields: z.array(z.enum(fieldNames)).max(fieldNames.length),
  allowUnpaidStart: z.boolean(),
  reason: z.string().trim().min(1).max(500)
});
export function parseApplicant(value: unknown): ApplicantDetails {
  const raw = z.record(z.string().trim().max(500)).parse(value);
  const data = Object.fromEntries(
    INTAKE_FIELDS.map(([key]) => [key, raw[key] ?? ""])
  ) as ApplicantDetails;
  if (!data.firstName || !data.lastName) fail("Enter your first name and surname.");
  data.phone = data.phone.replace(/[\s()-]/g, "");
  if (/^0\d{10}$/.test(data.phone)) data.phone = "+234" + data.phone.slice(1);
  if (!/^\+?\d{7,15}$/.test(data.phone)) fail("Enter a valid phone number.");
  if (data.nin && !validInstructorNin(data.nin)) fail("NIN must contain exactly 11 digits.");
  if (data.bloodGroup && !(BLOOD_GROUPS as readonly string[]).includes(data.bloodGroup))
    fail("Choose a blood group from the list.");
  if (
    data.dateOfBirth &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) ||
      !isValidDate(data.dateOfBirth) ||
      data.dateOfBirth >= lagosDay(new Date().toISOString()))
  )
    fail("Enter a real date of birth in the past.");
  if (data.email && !z.string().email().safeParse(data.email).success)
    fail("Enter a valid email address.");
  if (
    data.heightCm &&
    (!/^\d{2,3}$/.test(data.heightCm) || Number(data.heightCm) < 50 || Number(data.heightCm) > 250)
  )
    fail("Enter height in centimetres between 50 and 250.");
  for (const [key, choices] of [
    ["sex", ["Male", "Female"]],
    ["maritalStatus", ["Single", "Married", "Divorced", "Widowed"]],
    ["licenceClass", ["A", "B", "C", "D", "E", "F", "G", "H", "J"]],
    ["licenceValidity", ["3 years", "5 years"]]
  ] as const) {
    if (data[key] && !(choices as readonly string[]).includes(data[key]))
      fail(`Choose a valid ${key} option.`);
  }
  if (data.nextOfKinPhone && !/^\+?[\d\s()-]{7,25}$/.test(data.nextOfKinPhone))
    fail("Enter a valid next-of-kin phone number.");
  return data;
}
const nameOf = (d: ApplicantDetails) =>
  [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
const normalizedPhone = (value: string) => value.replace(/\D/g, "").replace(/^234/, "0");
function routeError(error: unknown) {
  if (error instanceof ZodError)
    return new KnownApiError(
      error.issues[0]?.message ?? "Check the form.",
      400,
      "VALIDATION_ERROR"
    );
  return error;
}
export function createPublicEnrollmentRouter() {
  const router = Router();
  const traffic = new Map<string, { count: number; until: number }>();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const now = Date.now();
    for (const [key, entry] of traffic) if (entry.until <= now) traffic.delete(key);
    const key = `${req.method}:${req.ip}`;
    let entry = traffic.get(key);
    if (!entry) {
      if (traffic.size >= 10000)
        return next(new KnownApiError("Please try again later.", 429, "RATE_LIMIT"));
      entry = { count: 0, until: now + 600000 };
      traffic.set(key, entry);
    }
    if (++entry.count > (req.method === "POST" ? 30 : 150)) {
      res.set("Retry-After", "600");
      return next(
        new KnownApiError(
          "Too many requests. Please wait a few minutes or contact the school.",
          429,
          "RATE_LIMIT"
        )
      );
    }
    next();
  });
  router.get("/:schoolId", async (req, res, next) => {
    try {
      const schoolId = z.string().max(100).parse(req.params["schoolId"]);
      const db = getPrismaClient();
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, phone: true }
      });
      const rows = await db.trainingRecord.findMany({
        where: { schoolId, kind: { in: ["enrollment_settings", "package", "school_rules"] } }
      });
      const settingsRow = rows.find((r) => r.kind === "enrollment_settings");
      const settings = settingsRow?.data as unknown as EnrollmentSettings | undefined;
      if (!school || !settings?.enabled)
        fail("This enrollment link is not open. Please contact the school.", 404);
      const rules = rows.find((r) => r.kind === "school_rules");
      res.json({
        school,
        settings: { welcome: settings!.welcome, requiredFields: settings!.requiredFields },
        settingsVersion: settingsRow!.version,
        rulesVersion: rules?.version ?? -1,
        schoolTargetDays:
          (rules?.data as unknown as SchoolRules | undefined)?.schoolTargetDays ?? 26,
        packages: rows
          .filter((r) => r.kind === "package" && settings!.packageIds.includes(r.id))
          .map(({ id, version, data }) => ({ id, version, data }))
      });
    } catch (error) {
      next(routeError(error));
    }
  });
  router.post("/:schoolId", async (req, res, next) => {
    try {
      const schoolId = z.string().max(100).parse(req.params["schoolId"]);
      const input = z
        .object({
          id: z.string().uuid(),
          packageId: z.string().max(100),
          packageVersion: z.number().int().nonnegative(),
          settingsVersion: z.number().int().nonnegative(),
          rulesVersion: z.number().int().min(-1),
          details: z.unknown(),
          consent: z.literal(true),
          website: z.string().max(0).optional()
        })
        .parse(req.body);
      const details = parseApplicant(input.details);
      const hash = createHash("sha256")
        .update(JSON.stringify({ schoolId, ...input, details }))
        .digest("hex");
      await getPrismaClient().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
        const previous = await tx.enrollmentApplication.findUnique({ where: { id: input.id } });
        if (previous) {
          if (previous.schoolId !== schoolId || previous.requestHash !== hash)
            fail(
              "This submission reference was already used. Contact the school before submitting again.",
              409
            );
          return;
        }
        const rows = await tx.trainingRecord.findMany({ where: { schoolId } });
        const config = rows.find((r) => r.kind === "enrollment_settings");
        const settings = config?.data as unknown as EnrollmentSettings | undefined;
        const rules = rows.find((r) => r.kind === "school_rules");
        if (!settings?.enabled) fail("This enrollment link is not open. Contact the school.", 404);
        const pack = rows.find(
          (r) =>
            r.kind === "package" && r.id === input.packageId && settings!.packageIds.includes(r.id)
        );
        if (
          !pack ||
          pack.version !== input.packageVersion ||
          config!.version !== input.settingsVersion ||
          (rules?.version ?? -1) !== input.rulesVersion
        )
          fail(
            "The school’s packages or rules changed. Reload the options, review them and submit again.",
            409
          );
        for (const field of settings!.requiredFields)
          if (!details[field])
            fail(`Please enter ${INTAKE_FIELDS.find(([key]) => key === field)?.[1] ?? field}.`);
        const duplicates = await tx.enrollmentApplication.findFirst({
          where: { schoolId, phone: details.phone, status: { not: "REJECTED" } }
        });
        if (duplicates)
          fail(
            "Please contact the school to check your registration before submitting again.",
            409
          );
        await tx.enrollmentApplication.create({
          data: {
            id: input.id,
            schoolId,
            name: nameOf(details),
            phone: details.phone,
            details: json(details),
            packageId: pack!.id,
            packageSnapshot: pack!.data!,
            rulesSnapshot: json(rules?.data ?? DEFAULT_SCHOOL_RULES),
            requestHash: hash,
            consentAt: new Date()
          }
        });
      });
      res.status(201).json({ received: true, reference: input.id });
    } catch (error) {
      next(routeError(error));
    }
  });
  return router;
}

export function createEnrollmentReviewRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["OWNER", "RECEPTIONIST"].includes(req.auth!.role))
      return next(
        new KnownApiError("Only school office staff can review registrations.", 403, "FORBIDDEN")
      );
    next();
  });
  router.get("/", async (req, res, next) => {
    try {
      const status = z
        .enum(["PENDING_PAYMENT", "ACTIVE", "REJECTED"])
        .parse(req.query["status"] ?? "PENDING_PAYMENT");
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(req.query["offset"] ?? 0);
      const found = await getPrismaClient().enrollmentApplication.findMany({
        where: { schoolId: req.auth!.schoolId, status },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 101,
        skip: offset
      });
      const rows = found.slice(0, 100);
      const payments = await getPrismaClient().payment.findMany({
        where: {
          schoolId: req.auth!.schoolId,
          studentId: { in: rows.flatMap((r) => (r.studentId ? [r.studentId] : [])) }
        }
      });
      res.json({
        hasMore: found.length > 100,
        applications: rows.map(({ requestHash: _hash, details, ...row }) => ({
          ...row,
          ...(req.auth!.role === "OWNER" ? { details } : {}),
          paid: sumMoney(
            payments.filter((p) => p.studentId === row.studentId).map((p) => p.amount.toFixed(2))
          )
        }))
      });
    } catch (error) {
      next(routeError(error));
    }
  });
  router.post("/:id", async (req, res, next) => {
    try {
      const input = z
        .object({
          action: z.enum(["REVIEW", "ACTIVATE", "REJECT", "CORRECT"]),
          expectedVersion: z.number().int().nonnegative(),
          reason: z.string().trim().min(1).max(500),
          details: z.unknown().optional()
        })
        .parse(req.body);
      const schoolId = req.auth!.schoolId,
        applicationId = String(req.params["id"]);
      await getPrismaClient().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
        const actor = await tx.user.findFirst({
          where: {
            id: req.auth!.userId,
            schoolId,
            isActive: true,
            role: { in: ["OWNER", "RECEPTIONIST"] }
          }
        });
        if (!actor) fail("Sign in as office staff.", 403);
        const row = await tx.enrollmentApplication.findFirst({
          where: { id: applicationId, schoolId }
        });
        if (!row) fail("Registration not found.", 404);
        if (row!.version !== input.expectedVersion)
          fail("This registration changed. Refresh the list before trying again.", 409);
        if (row!.status === "REJECTED") fail("This registration was rejected.", 409);
        const pack = row!.packageSnapshot as unknown as TrainingPackage;
        let studentId = row!.studentId,
          status = row!.status;
        if (input.action === "REVIEW") {
          if (studentId) fail("A student record already exists for this registration.", 409);
          const students = await tx.student.findMany({
            where: { schoolId },
            select: { phone: true }
          });
          if (students.some((s) => normalizedPhone(s.phone) === normalizedPhone(row!.phone)))
            fail(
              "A student with this phone number already exists. Check that student and reject this submission if it is a duplicate.",
              409
            );
          studentId = randomUUID();
          await tx.student.create({
            data: {
              id: studentId,
              schoolId,
              name: row!.name,
              phone: row!.phone,
              enrollmentDate: new Date(),
              totalTuition: pack.price
            }
          });
          await tx.trainingRecord.create({
            data: {
              id: randomUUID(),
              schoolId,
              kind: "enrollment",
              data: json({
                ...pack,
                studentId,
                packageId: row!.packageId,
                applicationId,
                activationStatus: "PENDING_PAYMENT",
                rulesSnapshot: row!.rulesSnapshot
              })
            }
          });
        } else if (input.action === "ACTIVATE") {
          if (!studentId || status !== "PENDING_PAYMENT")
            fail("Create the student record before activating training.", 409);
          const records = await tx.trainingRecord.findMany({ where: { schoolId } });
          const settings = (records.find((r) => r.kind === "enrollment_settings")?.data ??
            DEFAULT_ENROLLMENT_SETTINGS) as unknown as EnrollmentSettings;
          const paid = sumMoney(
            (await tx.payment.findMany({ where: { schoolId, studentId: studentId! } })).map((p) =>
              p.amount.toFixed(2)
            )
          );
          if (Number(pack.price) > 0 && Number(paid) <= 0 && !settings.allowUnpaidStart)
            fail(
              "Record and send the first payment before activating training. The owner can change this in QR enrollment settings.",
              409
            );
          const enrollment = records.find(
            (r) =>
              r.kind === "enrollment" &&
              (r.data as unknown as TrainingEnrollment).applicationId === applicationId
          );
          if (!enrollment) fail("Student package not found.", 409);
          await tx.trainingRecord.update({
            where: { id: enrollment!.id },
            data: {
              version: { increment: 1 },
              data: json({ ...(enrollment!.data as object), activationStatus: "ACTIVE" })
            }
          });
          status = "ACTIVE";
        } else if (input.action === "REJECT") {
          if (studentId)
            fail(
              "This registration already has a student record. Keep its financial history and resolve it through the school office.",
              409
            );
          status = "REJECTED";
        } else {
          if (actor!.role !== "OWNER") fail("Only the owner can correct private details.", 403);
          const details = parseApplicant(input.details);
          // Avoid silently changing login identifiers or financial records after review.
          if (studentId) {
            const student = await tx.student.findFirst({ where: { id: studentId, schoolId } });
            if (
              !student ||
              nameOf(details) !== student.name ||
              normalizedPhone(details.phone) !== normalizedPhone(student.phone)
            )
              fail(
                "After review, use the name and phone saved on the student record. Change that record first if needed.",
                409
              );
          }
          await tx.enrollmentApplication.update({
            where: { id: applicationId },
            data: { details: json(details), name: nameOf(details), phone: details.phone }
          });
        }
        await tx.enrollmentApplication.update({
          where: { id: applicationId },
          data: { studentId, status, reviewReason: input.reason, version: { increment: 1 } }
        });
        await tx.auditLog.create({
          data: {
            schoolId,
            userId: actor!.id,
            action: "UPDATE",
            entity: "enrollment_application",
            entityId: applicationId,
            metadata: {
              operation: input.action,
              reason: input.reason,
              previousVersion: row!.version,
              studentId,
              status
            }
          }
        });
      });
      res.json({ success: true });
    } catch (error) {
      next(routeError(error));
    }
  });
  return router;
}
