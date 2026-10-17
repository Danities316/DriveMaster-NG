ALTER TABLE payments ADD COLUMN "entryType" TEXT NOT NULL DEFAULT 'PAYMENT',
 ADD COLUMN "originalPaymentId" TEXT REFERENCES payments(id) ON DELETE RESTRICT,
 ADD COLUMN "adjustmentId" TEXT, ADD COLUMN reason TEXT,
 ADD COLUMN "recordedById" TEXT REFERENCES users(id) ON DELETE RESTRICT;
CREATE TABLE payment_adjustments (
 id TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
 "rootPaymentId" TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 "requestHash" TEXT NOT NULL, "createdById" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payment_adjustments_schoolId_rootPaymentId_idx" ON payment_adjustments("schoolId", "rootPaymentId");
ALTER TABLE payments ADD CONSTRAINT payments_adjustment_fk FOREIGN KEY ("adjustmentId") REFERENCES payment_adjustments(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_entry_valid CHECK (
 ("entryType" = 'PAYMENT' AND amount > 0) OR
 ("entryType" IN ('REVERSAL','REFUND') AND amount < 0 AND "originalPaymentId" IS NOT NULL AND "adjustmentId" IS NOT NULL AND length(reason) >= 5 AND "recordedById" IS NOT NULL) OR
 ("entryType" = 'REFUND_REVERSAL' AND amount > 0 AND "originalPaymentId" IS NOT NULL AND "adjustmentId" IS NOT NULL AND length(reason) >= 5 AND "recordedById" IS NOT NULL)
) NOT VALID;
-- Existing imported history is retained; all new writes satisfy the constraint.
CREATE FUNCTION dm_payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payments are immutable; append an audited adjustment'; END $$;
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION dm_payment_immutable();
CREATE TRIGGER payment_adjustment_immutable BEFORE UPDATE OR DELETE ON payment_adjustments FOR EACH ROW EXECUTE FUNCTION dm_payment_immutable();
