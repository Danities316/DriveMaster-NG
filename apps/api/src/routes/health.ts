import { Router } from "express";
import { API_HEALTH_SERVICE_NAME, type HealthCheckResponse } from "@drivemaster/shared";
import { getPrismaClient } from "../prisma.js";

export function createHealthRouter(
  checkDatabase: () => Promise<unknown> = () => getPrismaClient().$queryRaw`SELECT 1`,
  timeoutMs = 3000
) {
  const router = Router();
  let pending: Promise<unknown> | undefined;
  router.get("/health", (_req, res) => {
    const body: HealthCheckResponse = { status: "ok", service: API_HEALTH_SERVICE_NAME };
    res.status(200).json(body);
  });
  router.get("/ready", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Reuse an outstanding query so a stalled database cannot accumulate probe queries.
      pending ??= Promise.resolve()
        .then(checkDatabase)
        .finally(() => {
          pending = undefined;
        });
      await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Readiness timeout")), timeoutMs);
        })
      ]);
      res.status(200).json({ status: "ready", service: API_HEALTH_SERVICE_NAME });
    } catch {
      res.status(503).json({ status: "unavailable", service: API_HEALTH_SERVICE_NAME });
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
}

export const healthRouter = createHealthRouter();
