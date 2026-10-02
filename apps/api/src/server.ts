import { ensureEnvFile, loadEnv } from "./env.js";
import { createApp } from "./app.js";
import { getPrismaClient } from "./prisma.js";

async function main(): Promise<void> {
  ensureEnvFile();

  // Fail fast with a clear error if required configuration is missing.
  // This must run before anything that could itself throw (e.g. Prisma
  // client construction) so misconfiguration always surfaces as a
  // readable env-validation error, not a confusing downstream stack trace.
  const env = loadEnv();

  const app = createApp({
    webOrigin: env.WEB_ORIGIN,
    authSecret: env.AUTH_TOKEN_SECRET,
    sessionMaxAgeSeconds: env.AUTH_TOKEN_EXPIRES_IN_SECONDS,
    secureCookies: env.NODE_ENV === "production"
  });
  const prisma = getPrismaClient();

  // Verify the PostgreSQL connection at startup. This is a connectivity
  // check only — no domain queries exist yet (Unit 1 scope).
  try {
    await prisma.$connect();
    console.log("[drivemaster-api] PostgreSQL connection established");
  } catch (error) {
    console.error("[drivemaster-api] Failed to connect to PostgreSQL:", error);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(
      `[drivemaster-api] listening on port ${env.PORT} (${env.NODE_ENV}), allowed origin(s): ${env.WEB_ORIGIN}`
    );
  });

  async function shutdown(signal: string): Promise<void> {
    console.log(`[drivemaster-api] received ${signal}, shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[drivemaster-api] Fatal startup error:", error);
  process.exit(1);
});
