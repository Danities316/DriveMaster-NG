CREATE TABLE "enrollment_applications" (
 "id" TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL REFERENCES "schools"("id"),
 "name" TEXT NOT NULL, "phone" TEXT NOT NULL, "details" JSONB NOT NULL,
 "packageId" TEXT NOT NULL, "packageSnapshot" JSONB NOT NULL, "rulesSnapshot" JSONB NOT NULL,
 "requestHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
 "version" INTEGER NOT NULL DEFAULT 0, "studentId" TEXT REFERENCES "students"("id"),
 "reviewReason" TEXT, "consentAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "enrollment_status" CHECK ("status" IN ('PENDING_PAYMENT', 'ACTIVE', 'REJECTED'))
);
CREATE INDEX "enrollment_applications_schoolId_status_createdAt_idx" ON "enrollment_applications"("schoolId", "status", "createdAt");
CREATE INDEX "enrollment_applications_schoolId_phone_idx" ON "enrollment_applications"("schoolId", "phone");
