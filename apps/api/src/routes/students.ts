import { Router } from "express";
import { z, type ZodError } from "zod";
import type { StudentListResponse, StudentResponse } from "@drivemaster/shared";
import { isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  type StudentDeps
} from "../students/studentService.js";
import {
  createStudentPayment,
  listStudentPayments,
  type PaymentDeps
} from "../students/paymentService.js";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/requireRole.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import type { AuthDeps } from "../auth/authService.js";

/**
 * ROLE SCOPE (documented, not a silent decision): PRD §26.3 gives Owner
 * "full school-level visibility" and Receptionist "student management",
 * but describes Instructor access as limited to "assigned/relevant"
 * students — a relationship that only the Booking module (deferred,
 * explicitly out of scope for this unit) can compute. Rather than either
 * grant Instructors full visibility (broader than the PRD describes) or
 * invent a partial-access rule not yet supported by any data, this unit
 * restricts all student endpoints to OWNER and RECEPTIONIST. This is a
 * conservative, reversible restriction — see the Unit 3 report.
 */
const STUDENT_STAFF_ROLES = ["OWNER", "RECEPTIONIST"] as const;

const moneySchema = z
  .string()
  .trim()
  .refine((value) => isValidStoredMoney(value), "Enter a non-negative amount up to 9999999999.99.");

export const createStudentSchema = z.object({
  id: z.string().uuid("Invalid student id."),
  name: z.string().trim().min(1, "Student name is required."),
  phone: z.string().trim().min(7, "Enter a valid phone number.").max(20),
  licenseNumber: z.string().trim().min(1).optional().nullable(),
  enrollmentDate: z.string().trim().refine(isValidDate, "Enter a valid enrollment date."),
  totalTuition: moneySchema
});

export const updateStudentSchema = createStudentSchema.omit({ id: true }).partial();

const paymentMethodSchema = z.enum(["CASH", "BANK_TRANSFER", "POS"] as const);
export const createPaymentSchema = z
  .object({
    id: z.string().uuid("Invalid payment id."),
    amount: z
      .string()
      .trim()
      .refine(
        (value) => isValidStoredMoney(value, true),
        "Enter a positive amount up to 9999999999.99."
      )
      .refine((value) => Number(value) > 0, "Payment amount must be greater than 0."),
    paymentDate: z
      .string()
      .trim()
      .min(1, "Payment date is required.")
      .refine(isValidDate, "Payment date must be a valid ISO 8601 date."),
    method: paymentMethodSchema,
    currency: z.enum(["NGN"]).default("NGN"),
    reference: z.string().trim().min(1).nullish()
  })
  .refine(
    (value) => value.method === "CASH" || (value.reference && value.reference.trim().length > 0),
    {
      message: "Reference is required for BANK_TRANSFER and POS payments.",
      path: ["reference"]
    }
  );

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

function firstZodMessage(error: ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

export interface CreateStudentsRouterOptions {
  authSecret: string;
  studentDeps: StudentDeps;
  paymentDeps: PaymentDeps;
  authDeps: AuthDeps;
}

export function createStudentsRouter(options: CreateStudentsRouterOptions): Router {
  const { authSecret, studentDeps, paymentDeps } = options;
  const router = Router();
  const authenticate = createAuthenticateMiddleware(authSecret, options.authDeps.findUserByPhone);
  const staffOnly = requireRole(...STUDENT_STAFF_ROLES);

  router.get("/", authenticate, staffOnly, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new KnownApiError("Invalid search parameters.", 400, "VALIDATION_ERROR");
      }

      const { students, total } = await listStudents(req.auth!.schoolId, parsed.data, studentDeps);
      const body: StudentListResponse = { students, total };
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  router.post("/", authenticate, staffOnly, async (req, res, next) => {
    try {
      const parsed = createStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new KnownApiError(
          firstZodMessage(parsed.error, "Please check the student details and try again."),
          400,
          "VALIDATION_ERROR"
        );
      }

      const student = await createStudent(req.auth!.schoolId, parsed.data, studentDeps);
      const body: StudentResponse = { student };
      res.status(201).json(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id", authenticate, staffOnly, async (req, res, next) => {
    try {
      const studentId = req.params.id;
      if (!studentId) {
        throw new KnownApiError("Student id is required.", 400, "VALIDATION_ERROR");
      }

      const result = await getStudent(req.auth!.schoolId, studentId, studentDeps);
      if (!result.ok) {
        throw new KnownApiError("Student not found.", 404, "NOT_FOUND");
      }

      const body: StudentResponse = { student: result.student };
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", authenticate, staffOnly, async (req, res, next) => {
    try {
      const studentId = req.params.id;
      if (!studentId) {
        throw new KnownApiError("Student id is required.", 400, "VALIDATION_ERROR");
      }

      const parsed = updateStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new KnownApiError(
          firstZodMessage(parsed.error, "Please check the student details and try again."),
          400,
          "VALIDATION_ERROR"
        );
      }

      const result = await updateStudent(req.auth!.schoolId, studentId, parsed.data, studentDeps);
      if (!result.ok) {
        throw new KnownApiError("Student not found.", 404, "NOT_FOUND");
      }

      const body: StudentResponse = { student: result.student };
      res.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/payments", authenticate, staffOnly, async (req, res, next) => {
    try {
      const studentId = req.params.id;
      if (!studentId) {
        throw new KnownApiError("Student id is required.", 400, "VALIDATION_ERROR");
      }

      const result = await listStudentPayments(req.auth!.schoolId, studentId, paymentDeps);
      if (!result.ok) {
        throw new KnownApiError("Student not found.", 404, "NOT_FOUND");
      }

      res.status(200).json({
        payments: result.payments,
        totalPaid: result.totalPaid,
        outstandingBalance: result.outstandingBalance
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/payments", authenticate, staffOnly, async (req, res, next) => {
    try {
      const studentId = req.params.id;
      if (!studentId) {
        throw new KnownApiError("Student id is required.", 400, "VALIDATION_ERROR");
      }

      const parsed = createPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new KnownApiError(
          firstZodMessage(parsed.error, "Please check the payment details and try again."),
          400,
          "VALIDATION_ERROR"
        );
      }

      const result = await createStudentPayment(
        req.auth!.schoolId,
        studentId,
        parsed.data,
        paymentDeps
      );
      if (!result.ok) {
        if (result.reason === "ID_CONFLICT") {
          throw new KnownApiError(
            "Payment id is already used for different payment data.",
            409,
            "ID_CONFLICT"
          );
        }
        throw new KnownApiError("Student not found.", 404, "NOT_FOUND");
      }

      res.status(201).json({
        payment: result.payment,
        totalPaid: result.totalPaid,
        outstandingBalance: result.outstandingBalance
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
