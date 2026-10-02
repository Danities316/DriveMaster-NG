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
export const API_HEALTH_SERVICE_NAME = "drivemaster-api";
export function isHealthCheckResponse(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return candidate["status"] === "ok" && candidate["service"] === API_HEALTH_SERVICE_NAME;
}
//# sourceMappingURL=index.js.map