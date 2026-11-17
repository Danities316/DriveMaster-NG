BEGIN;
DO $$ BEGIN PERFORM id FROM schools ORDER BY id FOR UPDATE; END $$;
ALTER TABLE vehicles
  ADD COLUMN "insuranceExpiryDate" TEXT,
  ADD COLUMN "vehicleLicenceExpiryDate" TEXT,
  ADD COLUMN "roadworthinessExpiryDate" TEXT;
COMMIT;
