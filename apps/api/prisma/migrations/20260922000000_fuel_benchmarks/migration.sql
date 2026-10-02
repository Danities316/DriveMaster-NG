BEGIN;
DO $$ BEGIN PERFORM id FROM schools ORDER BY id FOR UPDATE; END $$;
ALTER TABLE vehicles ADD COLUMN "fuelBenchmark" JSONB,
  ADD COLUMN "benchmarkVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("benchmarkVersion" >= 0);
COMMIT;
