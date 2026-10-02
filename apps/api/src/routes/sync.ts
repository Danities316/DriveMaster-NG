import { Router } from "express";
import { z } from "zod";
import type { SyncBatchResponse } from "@drivemaster/shared";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/requireRole.js";
import { KnownApiError } from "../middleware/errorHandler.js";
import type { AuthDeps } from "../auth/authService.js";
import { syncDeps, type SyncDeps } from "../sync/syncRepository.js";

const mutation = z.object({
  mutationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  schoolId: z.string().min(1).max(200),
  entity: z.enum(["student", "payment", "booking", "fuel_log", "vehicle", "mileage_log"]),
  action: z.enum(["CREATE", "UPDATE", "DELETE"]),
  payload: z.unknown(),
  expectedVersion: z.number().int().nonnegative().optional()
});
const batch = z.object({ mutations: z.array(mutation).min(1).max(50) });
const query = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .default("0")
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  schoolId: z.string().min(1)
});

export function createSyncRouter(options: {
  authSecret: string;
  authDeps: AuthDeps;
  syncDeps?: SyncDeps;
}): Router {
  const router = Router();
  const deps = options.syncDeps ?? syncDeps;
  router.use(
    createAuthenticateMiddleware(options.authSecret, options.authDeps.findUserByPhone),
    requireRole("OWNER", "RECEPTIONIST")
  );
  router.post("/batch", async (req, res, next) => {
    try {
      const parsed = batch.safeParse(req.body);
      if (!parsed.success)
        throw new KnownApiError("Invalid synchronization request.", 400, "VALIDATION_ERROR");
      if (parsed.data.mutations.some((entry) => entry.schoolId !== req.auth!.schoolId))
        throw new KnownApiError(
          "Sign in to the school that owns these changes.",
          403,
          "TENANT_MISMATCH"
        );
      const result: SyncBatchResponse = {
        success: true,
        processedIds: [],
        duplicateIds: [],
        results: [],
        conflicts: [],
        failures: []
      };
      for (const entry of parsed.data.mutations) {
        // Enforce at the route boundary as well as the repository.
        if (entry.schoolId !== req.auth!.schoolId)
          throw new KnownApiError(
            "Sign in to the school that owns these changes.",
            403,
            "TENANT_MISMATCH"
          );
        const outcome = await deps.process(req.auth!.schoolId, req.auth!.userId, {
          ...entry,
          payload: entry.payload
        });
        if (outcome.status === "processed" || outcome.status === "duplicate") {
          result.processedIds.push(entry.mutationId);
          result.results.push(outcome.result);
          if (outcome.status === "duplicate") result.duplicateIds.push(entry.mutationId);
        } else if (outcome.status === "conflict") result.conflicts.push(outcome.conflict);
        else if (outcome.status === "failed")
          result.failures.push({ mutationId: entry.mutationId, message: outcome.message });
      }
      result.success = !result.conflicts.length && !result.failures.length;
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
  router.get("/changes", async (req, res, next) => {
    try {
      const parsed = query.safeParse(req.query);
      if (!parsed.success)
        throw new KnownApiError("Invalid synchronization cursor.", 400, "VALIDATION_ERROR");
      if (parsed.data.schoolId !== req.auth!.schoolId)
        throw new KnownApiError("School session changed. Sign in again.", 403, "TENANT_MISMATCH");
      res.json(await deps.pull(req.auth!.schoolId, parsed.data.cursor, parsed.data.limit));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
