BEGIN;
LOCK TABLE students, payments IN ACCESS EXCLUSIVE MODE;
ALTER TABLE students ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE sync_receipts (
  "mutationId" TEXT PRIMARY KEY, "schoolId" TEXT NOT NULL REFERENCES schools(id),
  "deviceId" TEXT NOT NULL, "requestHash" TEXT NOT NULL, result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sync_receipts_school_idx ON sync_receipts("schoolId");
CREATE TABLE sync_changes (
  id BIGSERIAL PRIMARY KEY, "schoolId" TEXT NOT NULL REFERENCES schools(id),
  entity TEXT NOT NULL, action TEXT NOT NULL, record JSONB NOT NULL
);
CREATE INDEX sync_changes_school_cursor_idx ON sync_changes("schoolId", id);

-- Lock BEFORE allocating a cursor. Concurrent writers for one school cannot
-- commit a higher cursor before a lower one, which would make incremental pull skip data.
CREATE FUNCTION dm_sync_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM id FROM schools WHERE id = OLD."schoolId" FOR UPDATE;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."schoolId" <> OLD."schoolId" THEN
    RAISE EXCEPTION 'Tenant ownership cannot change';
  END IF;
  PERFORM id FROM schools WHERE id = NEW."schoolId" FOR UPDATE;
  IF TG_TABLE_NAME = 'students' AND TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION dm_sync_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body JSONB; tenant TEXT; entity_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN body := to_jsonb(OLD); ELSE body := to_jsonb(NEW); END IF;
  tenant := body->>'schoolId';
  body := body || jsonb_build_object('createdAt', (body->>'createdAt') || 'Z');
  IF TG_TABLE_NAME = 'students' THEN
    entity_name := 'student';
    body := body || jsonb_build_object(
      'totalTuition', body->>'totalTuition',
      'enrollmentDate', (body->>'enrollmentDate') || 'Z',
      'updatedAt', (body->>'updatedAt') || 'Z');
  ELSE
    entity_name := 'payment';
    body := body || jsonb_build_object('amount', body->>'amount', 'paymentDate', (body->>'paymentDate') || 'Z');
  END IF;
  INSERT INTO sync_changes("schoolId", entity, action, record)
  VALUES (tenant, entity_name, CASE TG_OP WHEN 'INSERT' THEN 'CREATE' WHEN 'UPDATE' THEN 'UPDATE' ELSE 'DELETE' END, body);
  RETURN NULL;
END $$;

CREATE TRIGGER dm_student_before BEFORE INSERT OR UPDATE OR DELETE ON students FOR EACH ROW EXECUTE FUNCTION dm_sync_before_write();
CREATE TRIGGER dm_payment_before BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION dm_sync_before_write();
CREATE TRIGGER dm_student_after AFTER INSERT OR UPDATE OR DELETE ON students FOR EACH ROW EXECUTE FUNCTION dm_sync_record();
CREATE TRIGGER dm_payment_after AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION dm_sync_record();

-- Bootstrap existing installations without modifying their records or versions.
INSERT INTO sync_changes("schoolId", entity, action, record)
SELECT "schoolId", 'student', 'CREATE', to_jsonb(s) || jsonb_build_object(
  'totalTuition', "totalTuition"::text,
  'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt', to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'enrollmentDate', to_char("enrollmentDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM students s ORDER BY id;
INSERT INTO sync_changes("schoolId", entity, action, record)
SELECT "schoolId", 'payment', 'CREATE', to_jsonb(p) || jsonb_build_object(
  'amount', amount::text,
  'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'paymentDate', to_char("paymentDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM payments p ORDER BY id;
COMMIT;
