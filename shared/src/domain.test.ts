import { describe, expect, it } from "vitest";
import {
  USER_ROLES,
  BOOKING_STATUSES,
  MUTATION_ACTIONS,
  MUTATION_STATUSES,
  MUTATION_ENTITIES,
  type UserRole,
  type BookingStatus,
  type MutationEntityType
} from "./domain";

describe("domain enums", () => {
  it("USER_ROLES matches the PRD-approved MVP roles (§26.3)", () => {
    expect(USER_ROLES).toEqual(["OWNER", "RECEPTIONIST", "INSTRUCTOR", "STUDENT"]);
  });

  it("BOOKING_STATUSES matches the PRD-approved statuses (§26.4)", () => {
    expect(BOOKING_STATUSES).toEqual(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
  });

  it("MUTATION_ACTIONS covers CREATE/UPDATE/DELETE", () => {
    expect(MUTATION_ACTIONS).toEqual(["CREATE", "UPDATE", "DELETE"]);
  });

  it("MUTATION_STATUSES matches the PRD-approved retry states (§26.8)", () => {
    expect(MUTATION_STATUSES).toEqual(["PENDING", "SYNCING", "FAILED", "CONFLICT"]);
  });

  it("MUTATION_ENTITIES matches the PRD §12 sync protocol plus vehicle recording entities", () => {
    expect(MUTATION_ENTITIES).toEqual([
      "student",
      "payment",
      "booking",
      "fuel_log",
      "vehicle",
      "mileage_log"
    ]);
  });

  it("type-level: a value assignable to UserRole must be one of the constants", () => {
    const role: UserRole = "OWNER";
    expect(USER_ROLES).toContain(role);
  });

  it("type-level: a value assignable to BookingStatus must be one of the constants", () => {
    const status: BookingStatus = "SCHEDULED";
    expect(BOOKING_STATUSES).toContain(status);
  });

  it("type-level: a value assignable to MutationEntityType must be one of the constants", () => {
    const entity: MutationEntityType = "fuel_log";
    expect(MUTATION_ENTITIES).toContain(entity);
  });
});
