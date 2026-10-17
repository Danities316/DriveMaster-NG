ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "password_resets" (
  "id" TEXT PRIMARY KEY, "userId" TEXT REFERENCES "users"("id") ON DELETE CASCADE,
  "phoneKey" TEXT NOT NULL, "sessionVersion" INTEGER NOT NULL,
  "digest" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "delivered" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "password_resets_phoneKey_idx" ON "password_resets"("phoneKey");
CREATE INDEX "password_resets_expiresAt_idx" ON "password_resets"("expiresAt");
CREATE TABLE "revoked_sessions" ("tokenHash" TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "revoked_sessions_expiresAt_idx" ON "revoked_sessions"("expiresAt");
