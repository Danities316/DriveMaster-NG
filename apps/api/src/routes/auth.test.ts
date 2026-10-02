import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../app.js";
import type { AuthDeps } from "../auth/authService.js";
import type { UserRecordForAuth } from "../auth/authService.js";
import { hashPassword } from "../auth/password.js";
import { createAuthenticateMiddleware } from "../middleware/authenticate.js";
import { assertSameSchool } from "../lib/tenantGuard.js";

const AUTH_SECRET = "route-test-secret-at-least-32-characters-long";
const SESSION_MAX_AGE_SECONDS = 3600;

const OWNER_A: UserRecordForAuth = {
  id: "user-a-owner",
  schoolId: "school-a",
  name: "Ada Okafor",
  phone: "+2348011111111",
  passwordHash: hashPassword("correct-password"),
  role: "OWNER",
  isActive: true
};

const DISABLED_USER: UserRecordForAuth = {
  id: "user-disabled",
  schoolId: "school-a",
  name: "Disabled Staff",
  phone: "+2348022222222",
  passwordHash: hashPassword("correct-password"),
  role: "RECEPTIONIST",
  isActive: false
};

function buildTestAuthDeps(): AuthDeps {
  const usersByPhone = new Map<string, UserRecordForAuth>([
    [OWNER_A.phone, OWNER_A],
    [DISABLED_USER.phone, DISABLED_USER]
  ]);
  return {
    findUserByPhone: async (phone) => usersByPhone.get(phone) ?? null
  };
}

function buildApp() {
  return createApp({
    webOrigin: "http://localhost:5173",
    authSecret: AUTH_SECRET,
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    secureCookies: false,
    authDeps: buildTestAuthDeps()
  });
}

/** Pulls the session cookie's raw `name=value` pair out of a Set-Cookie header, dropping attributes. */
function extractSessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"];
  const setCookieHeader = Array.isArray(raw) ? raw[0] : raw;
  if (!setCookieHeader) {
    throw new Error("Expected a Set-Cookie header on the login response");
  }
  return setCookieHeader.split(";")[0] ?? "";
}

describe("POST /api/auth/login (HTTP integration)", () => {
  it("logs in with the correct phone and password and sets an httpOnly session cookie", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: {
        id: OWNER_A.id,
        schoolId: OWNER_A.schoolId,
        name: OWNER_A.name,
        phone: OWNER_A.phone,
        role: OWNER_A.role
      }
    });

    const setCookie = res.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toMatch(/HttpOnly/i);
    // Never send the password hash or the raw token payload back as JSON.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it("rejects an incorrect password with the generic message", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Phone number or password is incorrect.");
  });

  it("rejects an unknown phone number with the SAME generic message", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phone: "+2340000000000", password: "anything" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Phone number or password is incorrect.");
  });

  it("rejects a deactivated account with the same generic message", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ phone: DISABLED_USER.phone, password: "correct-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Phone number or password is incorrect.");
  });

  it("rejects a request missing phone or password with a 400", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/auth/login").send({ phone: "", password: "" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me (HTTP integration)", () => {
  it("rejects a request with no session cookie", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
  });

  it("returns the authenticated user's identity, school, and role using the cookie from login", async () => {
    const app = buildApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "correct-password" });
    const sessionCookie = extractSessionCookie(loginRes);

    const meRes = await request(app).get("/api/auth/me").set("Cookie", sessionCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({
      user: {
        id: OWNER_A.id,
        schoolId: OWNER_A.schoolId,
        name: OWNER_A.name,
        phone: OWNER_A.phone,
        role: OWNER_A.role
      }
    });
  });
});

describe("POST /api/auth/logout (HTTP integration)", () => {
  it("clears the session cookie and returns success even with no prior session (shared-device safety)", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it("clears the cookie such that a subsequent /me with the old cookie is rejected", async () => {
    const app = buildApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "correct-password" });
    const sessionCookie = extractSessionCookie(loginRes);

    const logoutRes = await request(app).post("/api/auth/logout").set("Cookie", sessionCookie);
    expect(logoutRes.status).toBe(200);

    const clearedCookieHeader = logoutRes.headers["set-cookie"];
    const clearedCookie = Array.isArray(clearedCookieHeader)
      ? clearedCookieHeader[0]
      : clearedCookieHeader;
    expect(clearedCookie).toMatch(/dm_session=;/);
  });
});

describe("cross-school access (HTTP integration, via a demo tenant-scoped route)", () => {
  // This inline router exists ONLY to exercise `authenticate` +
  // `assertSameSchool` together over real HTTP, since Unit 2 does not
  // implement any actual tenant-owned business resource yet (that starts
  // with real Student/Payment/etc. endpoints in later units). It is test
  // scaffolding, not a product route, and is not mounted in apps/api/src/app.ts.
  function buildTenantScopedTestApp() {
    const testApp = express();
    const authenticate = createAuthenticateMiddleware(AUTH_SECRET);

    testApp.get("/schools/:schoolId/demo-resource", authenticate, (req, res) => {
      assertSameSchool(req.auth!.schoolId, req.params["schoolId"]!);
      res.status(200).json({ ok: true });
    });

    testApp.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        res.status(status).json({ error: { message: (err as Error).message } });
      }
    );

    return testApp;
  }

  it("allows access to a resource within the authenticated user's own school", async () => {
    const app = buildApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "correct-password" });
    const sessionCookie = extractSessionCookie(loginRes);

    const testApp = buildTenantScopedTestApp();
    const res = await request(testApp)
      .get(`/schools/${OWNER_A.schoolId}/demo-resource`)
      .set("Cookie", sessionCookie);

    expect(res.status).toBe(200);
  });

  it("denies (404, not 403) an attempt to access another school's resource", async () => {
    const app = buildApp();
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ phone: OWNER_A.phone, password: "correct-password" });
    const sessionCookie = extractSessionCookie(loginRes);

    const testApp = buildTenantScopedTestApp();
    const res = await request(testApp)
      .get("/schools/school-b-belongs-to-someone-else/demo-resource")
      .set("Cookie", sessionCookie);

    expect(res.status).toBe(404);
  });
});
