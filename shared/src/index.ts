/**
 * @drivemaster/shared
 *
 * Shared TypeScript contracts consumed by both apps/web and apps/api.
 *
 * SCOPE NOTE (Unit 0):
 * This package intentionally contains only foundational, non-domain types.
 * The DriveMaster domain model (Student, Payment, Vehicle, FuelLog,
 * SessionBooking, OutboxMutation, AuditLog, etc.) is defined in the PRD
 * (sections 9 and 28) and will be implemented starting in Unit 1, after
 * the multi-tenant schema is reviewed. Adding domain types here now would
 * expand Unit 0 beyond its approved scope.
 */

export const API_HEALTH_SERVICE_NAME = "drivemaster-api" as const;

export type HealthStatus = "ok";

/** Response contract for GET /api/health */
export interface HealthCheckResponse {
  status: HealthStatus;
  service: typeof API_HEALTH_SERVICE_NAME;
}

/**
 * Standard shape for API error responses.
 * Production responses must never leak internal implementation details
 * (stack traces, raw driver errors, file paths, etc.) — see PRD section 16
 * (Error and Failure Handling) and section 17 (Security Requirements).
 */
export interface ApiErrorResponse {
  error: {
    message: string;
    code?: string;
  };
}

export function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate["status"] === "ok" && candidate["service"] === API_HEALTH_SERVICE_NAME;
}

// Domain contracts (School, User, Student, Payment, Vehicle, FuelLog,
// SessionBooking, OutboxMutationRecord, AuditLog, SyncState, and related
// enums) established in Unit 1.
export * from "./domain.js";

// Authentication contracts (Unit 2).
export * from "./auth.js";

// Money arithmetic and Student Management contracts (Unit 3).
export * from "./money.js";
export * from "./students.js";
export * from "./validation.js";
export * from "./sync.js";

export * from "./fleet.js";

export * from "./fuelConsumption.js";

export * from "./fuelBenchmark.js";

export * from "./training.js";
export * from "./schoolRules.js";
export * from "./enrollment.js";
export * from "./operations.js";
