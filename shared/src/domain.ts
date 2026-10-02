/**
 * @drivemaster/shared — domain contracts
 *
 * UNIT 1 SCOPE NOTE:
 * These are hand-written application/domain contracts, not re-exports of
 * Prisma-generated types. The frontend must never import from
 * `@prisma/client` directly (PRD §14: "API contracts are architectural
 * boundaries"); it depends on these instead. Keeping them separate also
 * means the backend's database representation (e.g. Decimal, Json) can
 * differ from the wire/JSON representation the frontend actually receives
 * (e.g. numbers, typed payload unions) without forcing a leaky coupling.
 *
 * No business logic, validation, or persistence code lives in this file —
 * only shape.
 */

// ==================================================
// ENUMS
// ==================================================

export const USER_ROLES = ["OWNER", "RECEPTIONIST", "INSTRUCTOR", "STUDENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const BOOKING_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const VEHICLE_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "POS"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CURRENCY_CODES = ["NGN"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const MUTATION_ACTIONS = ["CREATE", "UPDATE", "DELETE"] as const;
export type MutationAction = (typeof MUTATION_ACTIONS)[number];

export const MUTATION_STATUSES = ["PENDING", "SYNCING", "FAILED", "CONFLICT"] as const;
export type MutationStatus = (typeof MUTATION_STATUSES)[number];

/**
 * Entities that participate in offline outbox synchronization, per PRD
 * §12's mutation structure ("entity: student | payment | booking |
 * fuel_log"). School, User, and Vehicle are not offline-created in the
 * current MVP scope, so they are intentionally excluded — see the Unit 1
 * report. This is part of the sync API contract; extending it requires
 * Founder/PM approval.
 */
export const MUTATION_ENTITIES = [
  "student",
  "payment",
  "booking",
  "fuel_log",
  "vehicle",
  "mileage_log"
] as const;
export type MutationEntityType = (typeof MUTATION_ENTITIES)[number];

// ==================================================
// DOMAIN ENTITIES
// ==================================================

export interface School {
  id: string;
  name: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  schoolId: string;
  name: string;
  email: string | null;
  phone: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // passwordHash intentionally omitted — never sent to the client.
}

export interface Student {
  version?: number;
  id: string;
  schoolId: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  /** ISO 8601 date string. */
  enrollmentDate: string;
  /**
   * Decimal amount represented as a string on the wire to avoid floating
   * point precision loss for money (mirrors Prisma's Decimal handling).
   * Arithmetic on this value must use a decimal-safe library, not `+`.
   */
  totalTuition: string;
  createdAt: string;
  updatedAt: string;
}

/** Append-only financial record — no update/delete contract exists. */
export interface Payment {
  id: string;
  schoolId: string;
  studentId: string;
  /** Decimal amount as a string — see Student.totalTuition note. */
  amount: string;
  /** ISO 8601 date string. */
  paymentDate: string;
  method: PaymentMethod;
  currency: CurrencyCode;
  reference: string | null;
  createdAt: string;
}

export interface Vehicle {
  fuelBenchmark?: import("./fuelBenchmark.js").FuelBenchmark | null;
  benchmarkVersion?: number;
  id: string;
  schoolId: string;
  plateNumber: string;
  model: string;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
}

/** Append-only historical record. */
export interface FuelLog {
  driverName?: string | null;
  notes?: string | null;
  receiptReference?: string | null;
  fullTank?: boolean | null;
  recordedById?: string | null;
  id: string;
  schoolId: string;
  vehicleId: string;
  /** ISO 8601 date string. */
  date: string;
  odometer: number;
  /** Decimal amount as a string — see Student.totalTuition note. */
  litres: string;
  /** Decimal amount as a string — see Student.totalTuition note. */
  cost: string;
  discrepancyAlert: boolean;
  createdAt: string;
}

export interface SessionBooking {
  id: string;
  schoolId: string;
  studentId: string;
  instructorId: string;
  vehicleId: string;
  /** ISO 8601 datetime string. */
  startTime: string;
  durationMinutes: number;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape of an outbox mutation as understood by both the Dexie local
 * outbox and the server's OutboxMutation table. `payload` is intentionally
 * `unknown` here — its concrete shape depends on `entity`/`action` and is
 * defined by later units alongside the actual sync engine.
 */
export interface OutboxMutationRecord {
  schoolId?: string;
  sequence?: number;
  expectedVersion?: number;
  dependsOn?: string;
  nextAttemptAt?: number;
  serverStudent?: Student;
  mutationId: string;
  deviceId: string;
  entity: MutationEntityType;
  action: MutationAction;
  payload: unknown;
  createdAt: string;
  status: MutationStatus;
  retryCount: number;
  /** Local-only: last error message from a failed sync attempt, if any. */
  lastError?: string;
}

export interface AuditLog {
  id: string;
  schoolId: string;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

/** Local-only synchronization bookkeeping (Dexie `syncState` table). */
export interface SyncState {
  nextPullAt?: number;
  schoolId?: string;
  lastError?: string;
  authRequired?: boolean;
  bootstrapComplete?: boolean;
  deviceId: string;
  lastPulledCursor: string | null;
  lastSyncAt: string | null;
}

export interface MileageLog {
  id: string;
  schoolId: string;
  vehicleId: string;
  date: string;
  odometer: number;
  driverName: string;
  notes: string | null;
  recordedById: string;
  createdAt: string;
}
