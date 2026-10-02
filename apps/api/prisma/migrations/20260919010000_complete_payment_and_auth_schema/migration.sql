BEGIN;
-- Earlier feature work updated the Prisma model without a matching migration.
-- IF NOT EXISTS also supports development databases previously aligned with db push.
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'POS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method "PaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
-- Fail explicitly on ambiguous existing logins instead of changing account data.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users(phone);
-- Bootstrap snapshots from databases predating payment methods need the same defaults.
UPDATE sync_changes SET record = jsonb_build_object('currency', 'NGN', 'method', 'CASH') || record
WHERE entity = 'payment' AND (NOT record ? 'currency' OR NOT record ? 'method');
COMMIT;
