import { KnownApiError } from "../middleware/errorHandler.js";

/**
 * Enforces tenant isolation for a single resource lookup: throws unless
 * the authenticated user's school matches the resource's school.
 *
 * SECURITY NOTE: returns 404 ("Not found"), not 403 ("Forbidden"), on
 * mismatch. A 403 confirms to an attacker that a resource with that ID
 * exists (just not accessible to them) — for cross-tenant requests we
 * don't want to confirm existence at all, so a resource in another
 * school is indistinguishable from a resource that doesn't exist. This
 * is a deliberate choice, not an oversight.
 *
 * This utility doesn't yet have a caller in Unit 2 (no tenant-owned CRUD
 * routes exist until later units), but it is the enforcement point every
 * future Student/Payment/Vehicle/etc. route must call before returning
 * or mutating a record — see the Unit 2 report.
 */
export function assertSameSchool(userSchoolId: string, resourceSchoolId: string): void {
  if (userSchoolId !== resourceSchoolId) {
    throw new KnownApiError("Not found", 404, "NOT_FOUND");
  }
}
