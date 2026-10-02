BEGIN;
-- Follow the sync writer lock order before allocating bootstrap cursors.
DO $$ BEGIN PERFORM id FROM schools ORDER BY id FOR UPDATE; END $$;
ALTER TABLE fuel_logs ADD COLUMN "driverName" TEXT,
  ADD COLUMN notes TEXT, ADD COLUMN "receiptReference" TEXT,
  ADD COLUMN "fullTank" BOOLEAN, ADD COLUMN "recordedById" TEXT;
CREATE UNIQUE INDEX "fuel_logs_schoolId_vehicleId_receiptReference_key" ON fuel_logs("schoolId", "vehicleId", "receiptReference");
CREATE TABLE mileage_logs (
  id TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL, "vehicleId" TEXT NOT NULL,
  date TIMESTAMP(3) NOT NULL, odometer INTEGER NOT NULL CHECK (odometer >= 0),
  "driverName" TEXT NOT NULL, notes TEXT, "recordedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mileage_logs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mileage_logs_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES vehicles(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "mileage_logs_schoolId_vehicleId_date_idx" ON mileage_logs("schoolId", "vehicleId", date);
INSERT INTO sync_changes("schoolId", entity, action, record)
SELECT "schoolId", 'vehicle', 'CREATE', to_jsonb(v) || jsonb_build_object(
 'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'updatedAt', to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM vehicles v;
INSERT INTO sync_changes("schoolId", entity, action, record)
SELECT "schoolId", 'fuel_log', 'CREATE', to_jsonb(f) || jsonb_build_object(
 'litres', litres::text, 'cost', cost::text,
 'date', to_char(date, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM fuel_logs f;
COMMIT;
