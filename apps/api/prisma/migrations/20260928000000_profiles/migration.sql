ALTER TABLE "schools" ADD COLUMN "school_cac_rc" TEXT,
  ADD COLUMN "frsc_accreditation_number" TEXT,
  ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "schools_school_cac_rc_key" ON "schools"("school_cac_rc");
ALTER TABLE "users" ADD COLUMN "drivers_license_number" TEXT,
  ADD COLUMN "nin" TEXT,
  ADD COLUMN "permitExpiryDate" TEXT,
  ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "instructor_nin_format" CHECK ("nin" IS NULL OR "nin" ~ '^[0-9]{11}$'),
  ADD CONSTRAINT "instructor_licence_format" CHECK ("drivers_license_number" IS NULL OR "drivers_license_number" ~ '^[A-Z]{3}[0-9]{5}[A-Z]{2}[0-9]{2}$');
