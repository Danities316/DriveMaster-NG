CREATE TABLE "payment_claims" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transferDate" TIMESTAMP(3) NOT NULL,
  "senderName" TEXT NOT NULL,
  "reference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "requestHash" TEXT NOT NULL,
  "receipt" BYTEA,
  "receiptMime" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_claims_schoolId_status_createdAt_idx" ON "payment_claims"("schoolId", "status", "createdAt");
CREATE INDEX "payment_claims_applicationId_createdAt_idx" ON "payment_claims"("applicationId", "createdAt");
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "enrollment_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
