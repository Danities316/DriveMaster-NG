import { PrismaClient } from '@prisma/client';

/**
 * Centralized Prisma client.
 *
 * Lazily instantiated (see getPrismaClient) rather than constructed at
 * module-import time. Express/Node hoist static imports before any
 * application code runs, so an eager `new PrismaClient()` at the top of
 * this module would execute — and could throw — before env.ts has had a
 * chance to validate configuration in server.ts. Lazy construction keeps
 * env validation the first thing that can fail, giving a clear error
 * instead of a confusing Prisma stack trace when config is missing.
 *
 * The domain schema itself is NOT defined in Unit 0 (see
 * prisma/schema.prisma comment) — this file only establishes the
 * connection plumbing.
 */

declare global {
  var __drivemasterPrisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (globalThis.__drivemasterPrisma) {
    return globalThis.__drivemasterPrisma;
  }

  const client = new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"]
  });

  // Reuse one pool in production too: recurring sync requests must not open a
  // new pool for every mutation and incremental download.
  globalThis.__drivemasterPrisma = client;

  return client;
}
