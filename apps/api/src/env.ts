import { existsSync } from "node:fs";
import { z } from "zod";

/**
 * Environment contract.
 *
 * Unit 0: server port, environment, allowed web origin, database
 * connection string. Unit 2 adds session token configuration (PRD §26.1:
 * "Authenticated sessions/tokens must be implemented using a secure
 * server-approved mechanism").
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL connection string)"),
  WEB_ORIGIN: z.string().min(1, "WEB_ORIGIN is required (comma-separated allowed CORS origins)"),

  /**
   * Secret used to sign/verify session tokens (see auth/token.ts).
   * Minimum length enforced so a weak/short secret fails fast at startup
   * rather than silently producing a brute-forceable signing key.
   */
  AUTH_TOKEN_SECRET: z
    .string()
    .min(32, "AUTH_TOKEN_SECRET must be at least 32 characters (use a long random value)"),

  /**
   * How long a session stays valid, in seconds. Defaults to 30 days —
   * deliberately generous (not the "short-lived token" a typical Western
   * SaaS might use) because of this unit's offline-first requirement:
   * users with unreliable connectivity should not be forced to re-login
   * every few hours. Documented assumption — see the Unit 2 report.
   */
  AUTH_TOKEN_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30)
});

export type Env = z.infer<typeof envSchema>;

/**
 * Ensures the local project env file exists before startup. Hosted production
 * environments provide configuration directly and do not need a .env file.
 */
export function ensureEnvFile(path = ".env"): void {
  if (process.env.NODE_ENV !== "production" && !existsSync(path)) {
    throw new Error(
      `Missing environment file at ${path}. Copy apps/api/.env.example to apps/api/.env and fill in the required values before starting the API.`
    );
  }
}

/**
 * Parses and validates process.env. Throws a descriptive error immediately
 * on failure so misconfiguration is caught at startup rather than
 * surfacing as a confusing runtime error later.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Check your .env file against .env.example:\n${details}`
    );
  }

  return result.data;
}

/** Parses WEB_ORIGIN into a list of allowed CORS origins. */
export function parseAllowedOrigins(webOrigin: string): string[] {
  return webOrigin
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}
