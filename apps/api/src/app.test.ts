import * as prismaModule from "./prisma.js";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { AuthDeps } from "./auth/authService.js";

const TEST_ORIGIN = "http://localhost:5173";

// A no-op authDeps stub is enough here — these tests exercise health/404/CORS,
// none of which touch the auth routes. See routes/auth.test.ts for the auth
// flow itself, which supplies a real (fake) findUserByPhone implementation.
const noopAuthDeps: AuthDeps = {
  findUserByPhone: async () => null
};

const app = createApp({
  securityLimit: async () => {},
  webOrigin: TEST_ORIGIN,
  authSecret: "test-secret-at-least-32-characters-long",
  sessionMaxAgeSeconds: 3600,
  secureCookies: false,
  authDeps: noopAuthDeps
});

describe("GET /api/health", () => {
  it("returns the expected health payload", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "drivemaster-api"
    });
  });
});

describe("unmatched routes", () => {
  it("returns a 404 with a safe error shape", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { message: "Not found", code: "NOT_FOUND" }
    });
  });
});

describe("CORS", () => {
  it("allows requests from the configured WEB_ORIGIN", async () => {
    const response = await request(app).get("/api/health").set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
  });

  it("allows the browser origin when WEB_ORIGIN has a trailing slash", async () => {
    const appWithTrailingSlash = createApp({
      securityLimit: async () => {},
      webOrigin: `${TEST_ORIGIN}/`,
      authSecret: "test-secret-at-least-32-characters-long",
      sessionMaxAgeSeconds: 3600,
      secureCookies: false,
      authDeps: noopAuthDeps
    });
    const response = await request(appWithTrailingSlash)
      .get("/api/health")
      .set("Origin", TEST_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
  });

  it("rejects requests from an origin that is not allowed", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "https://not-allowed.example.com");

    // cors() surfaces disallowed origins as an error, which the shared
    // error handler turns into a 500. See errorHandler.test.ts for
    // verification that production responses hide the internal message.
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("receipt upload JSON limits", () => {
  it("allows receipt bodies over 32 KB to reach route validation", async () => {
    const lookup = vi
      .spyOn(prismaModule, "getPrismaClient")
      .mockReturnValue({
        school: { findUnique: async () => ({ status: "ACTIVE" }) }
      } as unknown as ReturnType<typeof prismaModule.getPrismaClient>);
    const response = await request(app)
      .post("/api/enroll/school/00000000-0000-4000-8000-000000000001/payment-claims")
      .send({ receiptDataUrl: "x".repeat(100000) });
    lookup.mockRestore();
    expect(response.status).toBe(400);
    expect(response.body.error.code).not.toBe("PAYLOAD_TOO_LARGE");
  });
  it("keeps normal intake small and rejects oversized receipts safely", async () => {
    const intake = await request(app)
      .post("/api/enroll/school")
      .send({ padding: "x".repeat(40000) });
    expect(intake.status).toBe(413);
    const receipt = await request(app)
      .post("/api/enroll/school/00000000-0000-4000-8000-000000000001/payment-claims")
      .send({ receiptDataUrl: "x".repeat(3200000) });
    expect(receipt.status).toBe(413);
    expect(receipt.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
