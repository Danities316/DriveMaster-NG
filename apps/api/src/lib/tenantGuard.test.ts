import { describe, expect, it } from "vitest";
import { assertSameSchool } from "./tenantGuard";
import { KnownApiError } from "../middleware/errorHandler";

describe("assertSameSchool (tenant isolation)", () => {
  it("does not throw when the resource belongs to the user's school", () => {
    expect(() => assertSameSchool("school-1", "school-1")).not.toThrow();
  });

  it("throws a 404 KnownApiError when the resource belongs to a different school", () => {
    expect(() => assertSameSchool("school-1", "school-2")).toThrow(KnownApiError);

    try {
      assertSameSchool("school-1", "school-2");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KnownApiError);
      const apiError = error as KnownApiError;
      expect(apiError.statusCode).toBe(404);
      expect(apiError.code).toBe("NOT_FOUND");
      // Cross-tenant mismatch must never be distinguishable from "does
      // not exist" — the message must not reveal that a same-ID resource
      // exists in another school.
      expect(apiError.message.toLowerCase()).not.toContain("school");
      expect(apiError.message.toLowerCase()).not.toContain("forbidden");
    }
  });
});
