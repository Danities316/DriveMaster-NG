import { Router } from "express";
import { API_HEALTH_SERVICE_NAME, type HealthCheckResponse } from "@drivemaster/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const body: HealthCheckResponse = {
    status: "ok",
    service: API_HEALTH_SERVICE_NAME
  };
  res.status(200).json(body);
});
