ALTER TABLE "users" ADD COLUMN "phoneVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
-- Existing owners verify on their next online session; school records stay intact.
UPDATE "users" SET "phoneVerificationRequired" = true WHERE role = 'OWNER';
CREATE TABLE "owner_phone_verifications" (
  "userId" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "phone" TEXT NOT NULL, "digest" TEXT, "nonce" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "resendAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "delivered" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE "verification_rate_limits" (
  "key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "windowStartedAt" TIMESTAMP(3) NOT NULL
);
