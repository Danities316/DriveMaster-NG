import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAuthRouter } from "./auth.js";
import {
  createOwnerVerification,
  type VerificationState,
  type VerificationStore
} from "../auth/ownerVerification.js";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { hashPassword } from "../auth/password.js";
import { createSessionToken } from "../auth/token.js";
import { SESSION_COOKIE_NAME } from "../auth/constants.js";

const secret = "verification-http-test-secret-with-32-characters";
const registration = {
  ownerName: "Ada Owner",
  phone: "08012345678",
  password: "Password123",
  schoolName: "Ada School",
  schoolAddress: "Lagos road",
  acceptedTerms: true
};
function fixture() {
  let registered = false;
  const state: VerificationState = {
    user: {
      id: "owner",
      schoolId: "school",
      schoolName: "Ada School",
      name: "Ada Owner",
      phone: "+2348012345678",
      role: "OWNER",
      isActive: true,
      passwordHash: hashPassword(registration.password),
      phoneVerificationRequired: true
    },
    challenge: null,
    verifiedAt: null
  };
  const store: VerificationStore = {
    transaction: async (_id, action) => action(state),
    consume: async () => {}
  };
  const send = vi.fn().mockResolvedValue(true);
  const verification = createOwnerVerification({ store, secret, send, code: () => "123456" });
  const register = vi.fn(async () => {
    registered = true;
    return { user: { id: "owner" } };
  });
  const deps = {
    findUserByPhone: async (phone: string) =>
      registered && phone === state.user.phone ? state.user : null
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      securityLimit: async () => {},
      authSecret: secret,
      sessionMaxAgeSeconds: 3600,
      secureCookies: false,
      authDeps: deps,
      verification,
      register,
      registrationLimit: async () => {}
    })
  );
  app.get("/workspace", createAuthenticateMiddleware(secret, deps.findUserByPhone), (_req, res) =>
    res.json({ allowed: true })
  );
  app.use(errorHandler);
  return { app, register, send, state };
}
function cookies(response: request.Response) {
  return (response.headers["set-cookie"] as unknown as string[])
    .map((cookie) => cookie.split(";")[0]!)
    .filter((cookie) => !cookie.endsWith("="))
    .join("; ");
}
describe("owner verification HTTP flow", () => {
  it("issues only restricted access, resumes after reload and grants workspace access once verified", async () => {
    const f = fixture();
    const agent = request.agent(f.app);
    const pending = await agent.post("/api/auth/register-owner").send(registration);
    expect(pending.status).toBe(202);
    expect(pending.body.user).toBeUndefined();
    expect(pending.body.verificationRequired).toBe(true);
    expect(cookies(pending)).toContain("dm_owner_verification=");
    expect(cookies(pending)).not.toContain(`${SESSION_COOKIE_NAME}=`);
    expect((await agent.get("/workspace")).status).toBe(401);
    expect((await agent.get("/api/auth/owner-verification")).body.delivery).toBe("sent");
    const confirmed = await agent
      .post("/api/auth/owner-verification/confirm")
      .send({ code: "123456" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.user.schoolName).toBe("Ada School");
    expect(JSON.stringify(confirmed.body)).not.toContain("passwordHash");
    expect((await agent.get("/workspace")).status).toBe(200);
    expect(
      (await agent.post("/api/auth/owner-verification/confirm").send({ code: "123456" })).status
    ).toBe(401);
  });
  it("resumes repeated registration and password login without creating another school", async () => {
    const f = fixture();
    const agent = request.agent(f.app);
    await agent.post("/api/auth/register-owner").send(registration);
    expect((await agent.post("/api/auth/register-owner").send(registration)).status).toBe(202);
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(
      (
        await agent
          .post("/api/auth/login")
          .send({ phone: registration.phone, password: registration.password })
      ).status
    ).toBe(202);
    expect(
      (await agent.post("/api/auth/login").send({ phone: registration.phone, password: "wrong" }))
        .status
    ).toBe(401);
  });
  it("blocks existing workspace cookies and provides a migration path through /me", async () => {
    const f = fixture();
    await request(f.app).post("/api/auth/register-owner").send(registration);
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken({ sub: "owner", schoolId: "school", name: "Ada", phone: f.state.user.phone, role: "OWNER" }, secret, 3600)}`;
    expect((await request(f.app).get("/workspace").set("Cookie", cookie)).status).toBe(403);
    const me = await request(f.app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(202);
    expect(me.body.verificationRequired).toBe(true);
    expect(cookies(me)).toContain("dm_owner_verification=");
  });
  it("preserves a pending school after delivery failure and rejects missing or invalid verification cookies", async () => {
    const f = fixture();
    f.send.mockResolvedValue(false);
    const pending = await request(f.app).post("/api/auth/register-owner").send(registration);
    expect(pending.status).toBe(202);
    expect(pending.body.delivery).toBe("failed");
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(
      (await request(f.app).post("/api/auth/owner-verification/confirm").send({ code: "123456" }))
        .status
    ).toBe(401);
    expect(
      (
        await request(f.app)
          .get("/api/auth/owner-verification")
          .set("Cookie", "dm_owner_verification=tampered")
      ).status
    ).toBe(401);
  });
});
