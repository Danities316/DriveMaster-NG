import { describe, expect, it } from "vitest";
import { API_HEALTH_SERVICE_NAME, isHealthCheckResponse } from "./index";

describe("isHealthCheckResponse", () => {
  it("accepts a valid health check payload", () => {
    expect(isHealthCheckResponse({ status: "ok", service: API_HEALTH_SERVICE_NAME })).toBe(true);
  });

  it("rejects a payload with the wrong service name", () => {
    expect(isHealthCheckResponse({ status: "ok", service: "some-other-service" })).toBe(false);
  });

  it("rejects a payload with the wrong status", () => {
    expect(isHealthCheckResponse({ status: "down", service: API_HEALTH_SERVICE_NAME })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isHealthCheckResponse(null)).toBe(false);
    expect(isHealthCheckResponse(undefined)).toBe(false);
    expect(isHealthCheckResponse("ok")).toBe(false);
  });
});
