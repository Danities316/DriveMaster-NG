import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { securityLimit, type RateConsumer } from "./securityLimits.js";
import { KnownApiError, errorHandler } from "./errorHandler.js";
import { normalizeNigerianPhone } from "../auth/phone.js";
describe("durable security limit boundaries", () => {
  it("limits the same normalized account across different client IPs before handler work", async () => {
    const counts = new Map<string, number>();
    const consume: RateConsumer = async (key, maximum) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > (key.includes(":account:") ? 2 : maximum))
        throw new KnownApiError("Too many requests", 429);
    };
    const work = vi.fn();
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post(
      "/login",
      securityLimit("test-login", 60, 900000, consume, (body) =>
        typeof body.phone === "string" ? normalizeNigerianPhone(body.phone) : null
      ),
      (_req, res) => {
        work();
        res.json({ ok: true });
      }
    );
    app.use(errorHandler);
    expect(
      (
        await request(app)
          .post("/login")
          .set("X-Forwarded-For", "192.0.2.1")
          .send({ phone: "08012345678" })
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/login")
          .set("X-Forwarded-For", "192.0.2.2")
          .send({ phone: "+2348012345678" })
      ).status
    ).toBe(200);
    const limited = await request(app)
      .post("/login")
      .set("X-Forwarded-For", "192.0.2.3")
      .send({ phone: "0801 234 5678" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
    expect(work).toHaveBeenCalledTimes(2);
  });
  it("fails closed if rate-limit storage is unavailable", async () => {
    const app = express();
    const work = vi.fn();
    app.use(
      securityLimit("test", 2, 60000, async () => {
        throw new Error("storage offline");
      })
    );
    app.get("/", (_req, res) => {
      work();
      res.sendStatus(200);
    });
    app.use(errorHandler);
    expect((await request(app).get("/")).status).toBe(500);
    expect(work).not.toHaveBeenCalled();
  });
});
