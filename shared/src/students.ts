import type { Student } from "./domain.js";

/**
 * A Student with computed financial visibility fields. `amountPaid` is
 * the sum of that student's recorded Payment rows and `balanceRemaining`
 * is `totalTuition - amountPaid` (PRD §10.1), both computed server-side
 * using decimal-safe arithmetic (see money.ts) — never stored as a
 * mutable column (PRD §26.14: "Do not create a mutable student balance
 * field").
 *
 * Unit 3 does not implement the Payment Management module (no way to
 * record a payment yet), so `amountPaid` will read "0.00" for every
 * student until that module exists — the calculation itself is already
 * correct and will reflect real payments as soon as they exist.
 */
export interface StudentWithBalance extends Student {
  amountPaid: string;
  balanceRemaining: string;
}

export interface CreateStudentRequest {
  /**
   * Client-generated UUID (PRD Unit 1: "Offline-created entities must be
   * able to receive their UUID before synchronization"). Required so a
   * student created while offline keeps the same identity once synced —
   * the server honors this id rather than generating its own.
   */
  id: string;
  name: string;
  phone: string;
  licenseNumber?: string | null;
  /** ISO 8601 date string. */
  enrollmentDate: string;
  /** Decimal amount as a string, e.g. "150000.00" — see money.ts. */
  totalTuition: string;
}

export type UpdateStudentRequest = Partial<Omit<CreateStudentRequest, "id">>;

export interface StudentListQuery {
  /** Matches against student name or phone (case-insensitive, partial). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface StudentListResponse {
  students: StudentWithBalance[];
  total: number;
}

export interface StudentResponse {
  student: StudentWithBalance;
}
