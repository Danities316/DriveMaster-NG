import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAuthRouter } from "./auth.js";
import { errorHandler, KnownApiError } from "../middleware/errorHandler.js";
function fixture() {
  const deliver = vi.fn().mockResolvedValue(undefined);
  const recovery = {
    request: vi.fn(async () => ({ requestId: randomUUID(), deliver })),
    confirm: vi.fn().mockResolvedValue(undefined)
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      authSecret: "recovery-route-test-secret-with-32-characters",
      sessionMaxAgeSeconds: 3600,
      secureCookies: false,
      authDeps: { findUserByPhone: async () => null },
      securityLimit: async () => {},
      recovery
    })
  );
  app.use(errorHandler);
  return { app, recovery, deliver };
}
describe("password recovery HTTP boundary", () => {
  it("returns a neutral accepted response without issuing a workspace session", async () => {
    const f = fixture();
    const first = await request(f.app)
      .post("/api/auth/password-reset/request")
      .send({ phone: "08012345678" });
    const second = await request(f.app)
      .post("/api/auth/password-reset/request")
      .send({ phone: "+2348098765432" });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.message).toBe(second.body.message);
    expect(first.body.requestId).not.toBe(second.body.requestId);
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(first.body.user).toBeUndefined();
    expect(f.recovery.request).toHaveBeenCalledWith("+2348012345678", expect.any(String));
    expect(f.deliver).toHaveBeenCalledTimes(2);
  });
  it("requires the reference, code and a valid new password and clears cookies after success", async () => {
    const f = fixture();
    const id = randomUUID();
    expect(
      (
        await request(f.app)
          .post("/api/auth/password-reset/confirm")
          .send({ requestId: id, code: "123456", password: "short" })
      ).status
    ).toBe(400);
    expect(f.recovery.confirm).not.toHaveBeenCalled();
    const result = await request(f.app)
      .post("/api/auth/password-reset/confirm")
      .send({ requestId: id, code: "123456", password: "NewPassword123" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true });
    expect(f.recovery.confirm).toHaveBeenCalledWith(
      id,
      "123456",
      "NewPassword123",
      expect.any(String)
    );
    expect(JSON.stringify(result.headers["set-cookie"])).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("does not claim reset success when the code is rejected", async () => {
    const f = fixture();
    f.recovery.confirm.mockRejectedValue(
      new KnownApiError("Reset code expired.", 400, "INVALID_RESET_CODE")
    );
    const result = await request(f.app)
      .post("/api/auth/password-reset/confirm")
      .send({ requestId: randomUUID(), code: "123456", password: "NewPassword123" });
    expect(result.status).toBe(400);
    expect(result.body.success).toBeUndefined();
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
});
