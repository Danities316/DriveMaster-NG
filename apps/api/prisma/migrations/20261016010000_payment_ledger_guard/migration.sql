-- Enforce tenant and linkage integrity even for non-HTTP writers.
CREATE FUNCTION dm_payment_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent payments%ROWTYPE; operation payment_adjustments%ROWTYPE;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM students WHERE id = NEW."studentId" AND "schoolId" = NEW."schoolId") THEN
  RAISE EXCEPTION 'Payment student must belong to school';
 END IF;
 IF NEW."recordedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."recordedById" AND "schoolId" = NEW."schoolId") THEN
  RAISE EXCEPTION 'Payment actor must belong to school';
 END IF;
 IF NEW."originalPaymentId" IS NOT NULL THEN
  SELECT * INTO parent FROM payments WHERE id = NEW."originalPaymentId";
  IF NOT FOUND OR parent."schoolId" <> NEW."schoolId" THEN RAISE EXCEPTION 'Invalid linked payment'; END IF;
  IF NEW."entryType" <> 'PAYMENT' AND parent."studentId" <> NEW."studentId" THEN RAISE EXCEPTION 'Adjustment student must match original'; END IF;
  IF NEW."entryType" IN ('REVERSAL','REFUND') AND parent."entryType" <> 'PAYMENT' THEN RAISE EXCEPTION 'Adjustment requires original payment'; END IF;
  IF NEW."entryType" = 'REFUND_REVERSAL' AND (parent."entryType" <> 'REFUND' OR NEW.amount <> -parent.amount) THEN RAISE EXCEPTION 'Invalid refund reversal'; END IF;
  IF NEW."entryType" = 'REVERSAL' AND NEW.amount <> -parent.amount THEN RAISE EXCEPTION 'Reversal must offset original'; END IF;
 END IF;
 IF NEW."adjustmentId" IS NOT NULL THEN
  SELECT * INTO operation FROM payment_adjustments WHERE id = NEW."adjustmentId";
  IF NOT FOUND OR operation."schoolId" <> NEW."schoolId" OR operation."createdById" IS DISTINCT FROM NEW."recordedById" THEN RAISE EXCEPTION 'Invalid payment operation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_link_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION dm_payment_link_guard();
CREATE UNIQUE INDEX payment_once_reversed ON payments("originalPaymentId") WHERE "entryType" IN ('REVERSAL','REFUND_REVERSAL');
