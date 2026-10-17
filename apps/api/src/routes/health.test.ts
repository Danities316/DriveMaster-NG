import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHealthRouter } from "./health.js";

function app(check: () => Promise<unknown>, timeout = 3000) {
  return express().use("/api", createHealthRouter(check, timeout));
}
describe("deployment readiness", () => {
  it("reports a reachable database without caching the result", async () => {
    const response = await request(app(async () => 1))
      .get("/api/ready")
      .expect(200);
    expect(response.body).toEqual({ status: "ready", service: "drivemaster-api" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("returns 503 without disclosing connection details and recovers on the next probe", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret connection details"))
      .mockResolvedValue(1);
    const server = app(check);
    const response = await request(server).get("/api/ready").expect(503);
    expect(JSON.stringify(response.body)).not.toContain("secret");
    await request(server).get("/api/ready").expect(200);
  });
  it("bounds slow probes and reuses the outstanding query", async () => {
    let finish!: () => void;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const server = app(check, 20);
    await request(server).get("/api/ready").expect(503);
    await request(server).get("/api/ready").expect(503);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
  });
  it("keeps liveness independent of database failures", async () => {
    const check = vi.fn().mockRejectedValue(new Error("offline"));
    await request(app(check)).get("/api/health").expect(200);
    expect(check).not.toHaveBeenCalled();
  });
});
