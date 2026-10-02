import { isHealthCheckResponse, type HealthCheckResponse } from "@drivemaster/shared";

/**
 * Base URL for the DriveMaster API.
 * Configured via Vite env var so dev/staging/prod can point at different
 * backends without a code change. Falls back to same-origin "/api" so the
 * app still works when the API is reverse-proxied behind the web app.
 */
const API_BASE_URL: string = import.meta.env["VITE_API_BASE_URL"] ?? "/api";

export class ApiHealthCheckError extends Error {}

/**
 * Calls GET /api/health and validates the response shape against the
 * shared contract. This function exists in Unit 0 purely to prove the
 * frontend, backend, and shared package are wired together correctly —
 * it is not part of any offline domain workflow.
 */
export async function fetchApiHealth(): Promise<HealthCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new ApiHealthCheckError(`API health check failed with status ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isHealthCheckResponse(data)) {
    throw new ApiHealthCheckError("API health check returned an unexpected shape");
  }

  return data;
}
