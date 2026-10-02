import { describe, expect, it } from "vitest";
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
