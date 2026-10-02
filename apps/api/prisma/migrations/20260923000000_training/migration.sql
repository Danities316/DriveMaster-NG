ALTER TYPE "UserRole" ADD VALUE 'STUDENT';
ALTER TABLE users ADD COLUMN "studentId" TEXT;
CREATE UNIQUE INDEX "users_studentId_key" ON users("studentId");
ALTER TABLE users ADD CONSTRAINT "users_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES students(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE training_records (
 id TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL, kind TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, data JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "training_records_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "training_records_schoolId_kind_idx" ON training_records("schoolId", kind);
CREATE TABLE training_receipts (
 id TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "training_receipts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "training_receipts_schoolId_idx" ON training_receipts("schoolId");
