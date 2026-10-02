import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import type { AuthDeps, UserRecordForAuth } from "../auth/authService.js";
import { hashPassword } from "../auth/password.js";
import type { PaymentDeps, PaymentRecord } from "../students/paymentService.js";
import type { StudentDeps, StudentRecord } from "../students/studentService.js";

const AUTH_SECRET = "payment-route-test-secret-at-least-32-chars";
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

const PAYMENT_A1: PaymentRecord = {
    id: "00000000-0000-0000-0000-000000000001",
    schoolId: "school-a",
    studentId: STUDENT_A1.id,
    amount: "50000.00",
    paymentDate: "2026-01-15T00:00:00.000Z",
    method: "CASH",
    currency: "NGN",
    reference: null,
    createdAt: "2026-01-15T00:00:00.000Z"
};

function buildAuthDeps(): AuthDeps {
    const usersByPhone = new Map<string, UserRecordForAuth>(
        [OWNER_A, RECEPTIONIST_A, INSTRUCTOR_A].map((user) => [user.phone, user])
    );

    return { findUserByPhone: async (phone) => usersByPhone.get(phone) ?? null };
}

function buildStudentDeps(): StudentDeps {
    const students = new Map<string, StudentRecord>([STUDENT_A1, STUDENT_B1].map((student) => [student.id, student]));

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
        findStudentsBySchool: async (schoolId) => ({
            students: Array.from(students.values()).filter((student) => student.schoolId === schoolId),
            total: Array.from(students.values()).filter((student) => student.schoolId === schoolId).length
        }),
        updateStudentRecord: async (id, patch) => {
            const existing = students.get(id);
            if (!existing) throw new Error("not found");
            const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
            students.set(id, updated);
            return updated;
        },
        sumPaymentsByStudentIds: async () => ({})
    };
}

function buildPaymentDeps(): PaymentDeps {
    const payments = new Map<string, PaymentRecord>([[PAYMENT_A1.id, PAYMENT_A1]]);

    return {
        findPaymentById: async (id) => payments.get(id) ?? null,
        createPaymentRecord: async (schoolId, studentId, input) => {
            const record: PaymentRecord = {
                id: input.id,
                schoolId,
                studentId,
                amount: input.amount,
                paymentDate: input.paymentDate,
                method: input.method,
                currency: input.currency ?? "NGN",
                reference: input.reference ?? null,
                createdAt: new Date().toISOString()
            };
            payments.set(record.id, record);
            return record;
        },
        findPaymentsByStudent: async (schoolId, studentId) => {
            const matches = Array.from(payments.values()).filter(
                (payment) => payment.schoolId === schoolId && payment.studentId === studentId
            );
            return matches.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
        },
        sumPaymentsByStudentIds: async (studentIds) => {
            const sums: Record<string, string> = {};
            for (const studentId of studentIds) {
                const total = Array.from(payments.values())
                    .filter((payment) => payment.studentId === studentId)
                    .reduce((sum, payment) => sum + Number(payment.amount), 0);
                sums[studentId] = total.toFixed(2);
            }
            return sums;
        },
        findStudentById: async (id) => {
            const student = [STUDENT_A1, STUDENT_B1].find((entry) => entry.id === id);
            return student ?? null;
        }
    };
}

function buildApp(paymentDeps: PaymentDeps) {
    return createApp({
        webOrigin: "http://localhost:5173",
        authSecret: AUTH_SECRET,
        sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
        secureCookies: false,
        authDeps: buildAuthDeps(),
        studentDeps: buildStudentDeps(),
        paymentDeps
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

describe("Student payment routes", () => {
    beforeEach(() => {
        // no-op for clarity; each test builds a fresh app instance
    });

    it("creates a cash payment and returns the payment plus derived totals", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, OWNER_A);

        const res = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({
                id: "00000000-0000-0000-0000-000000000002",
                amount: "25000.00",
                paymentDate: "2026-02-02T00:00:00.000Z",
                method: "CASH"
            });

        expect(res.status).toBe(201);
        expect(res.body.payment).toMatchObject({
            studentId: STUDENT_A1.id,
            amount: "25000.00",
            method: "CASH",
            currency: "NGN",
            reference: null
        });
        expect(res.body.totalPaid).toBe("75000.00");
        expect(res.body.outstandingBalance).toBe("75000.00");
    });

    it("requires a reference for non-cash payments", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, RECEPTIONIST_A);

        const res = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({
                id: "00000000-0000-0000-0000-000000000003",
                amount: "25000.00",
                paymentDate: "2026-02-02T00:00:00.000Z",
                method: "BANK_TRANSFER"
            });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/reference/i);
    });

    it("returns payment history with total paid and outstanding balance", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, OWNER_A);

        const res = await request(app).get(`/api/students/${STUDENT_A1.id}/payments`).set("Cookie", cookie);

        expect(res.status).toBe(200);
        expect(res.body.payments).toHaveLength(1);
        expect(res.body.payments[0].amount).toBe("50000.00");
        expect(res.body.totalPaid).toBe("50000.00");
        expect(res.body.outstandingBalance).toBe("100000.00");
    });

    it("rejects instructor access to payment endpoints", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, INSTRUCTOR_A);

        const res = await request(app)
            .get(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie);

        expect(res.status).toBe(403);
    });

    it("rejects an instructor attempting to create a payment directly", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, INSTRUCTOR_A);

        const res = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({
                id: "00000000-0000-0000-0000-000000000004",
                amount: "25000.00",
                paymentDate: "2026-02-02T00:00:00.000Z",
                method: "CASH",
                currency: "NGN"
            });

        expect(res.status).toBe(403);
    });

    it("rejects unsupported currency, invalid methods, and invalid amounts", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, OWNER_A);
        const base = {
            id: "00000000-0000-0000-0000-000000000005",
            amount: "25000.00",
            paymentDate: "2026-02-02T00:00:00.000Z",
            method: "CASH"
        };

        const invalidCurrency = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({ ...base, currency: "USD" });
        expect(invalidCurrency.status).toBe(400);

        const invalidAmount = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({ ...base, id: "00000000-0000-0000-0000-000000000006", amount: "-1.00" });
        expect(invalidAmount.status).toBe(400);

        const invalidMethod = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({ ...base, id: "00000000-0000-0000-0000-000000000007", method: "CHEQUE" });
        expect(invalidMethod.status).toBe(400);
    });

    it("replays the existing payment for the same id and rejects conflicting reuse", async () => {
        const paymentDeps = buildPaymentDeps();
        const app = buildApp(paymentDeps);
        const cookie = await loginAs(app, OWNER_A);
        const input = {
            id: PAYMENT_A1.id,
            amount: PAYMENT_A1.amount,
            paymentDate: PAYMENT_A1.paymentDate,
            method: PAYMENT_A1.method,
            currency: PAYMENT_A1.currency
        };

        const replay = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send(input);
        expect(replay.status).toBe(201);
        expect(replay.body.payment.id).toBe(PAYMENT_A1.id);

        const conflict = await request(app)
            .post(`/api/students/${STUDENT_A1.id}/payments`)
            .set("Cookie", cookie)
            .send({ ...input, amount: "25000.00" });
        expect(conflict.status).toBe(409);
        expect(conflict.body.error.code).toBe("ID_CONFLICT");
    });

    it("returns 404 when a payment request targets another school", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, OWNER_A);

        const res = await request(app)
            .get(`/api/students/${STUDENT_B1.id}/payments`)
            .set("Cookie", cookie);

        expect(res.status).toBe(404);
    });

    it("rejects payment creation for a student in another school", async () => {
        const app = buildApp(buildPaymentDeps());
        const cookie = await loginAs(app, OWNER_A);

        const res = await request(app)
            .post(`/api/students/${STUDENT_B1.id}/payments`)
            .set("Cookie", cookie)
            .send({
                id: "00000000-0000-0000-0000-000000000008",
                amount: "25000.00",
                paymentDate: "2026-02-02T00:00:00.000Z",
                method: "CASH",
                currency: "NGN"
            });

        expect(res.status).toBe(404);
    });
});
