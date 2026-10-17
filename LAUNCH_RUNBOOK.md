# Launch validation and release

Batch 4 is locally validated only when the recorded checks below pass. Deployment, live SMS, real-device acceptance and hosted restore/monitoring evidence remain separate release gates. These protect confidence in the result and reduce waiting and repeated work, in line with Hormozi's value equation. Passing a local benchmark is not a conversion, uptime or capacity guarantee.

## Repeatable local validation

Build with `npm run build`, run `npm test` (database tests are opt-in), and run `npm run lint`. To include all PostgreSQL integration tests, point `SYNC_TEST_DATABASE_URL` at an isolated localhost database named `sync_test`, deploy migrations there, and run API tests with `--maxWorkers=1 --minWorkers=1`. Never use the configured application database for these tests.

With PostgreSQL 16 installed on Windows and port 55438 free:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-launch.ps1
```

The script builds a fresh temporary localhost cluster, applies every migration, creates synthetic schools with 100/500/1,000 students and five completed historical outings plus five payments per student, and measures the authenticated HTTP snapshot endpoint. Each school gets one warm-up, five sequential requests and three concurrent requests. It asserts full counts and payment totals, and reports JSON bytes and timings. Fixtures represent data volumes; their shared instructor/calendar is synthetic and does not validate scheduling rules. Existing integration tests cover booking rules. Only the local test databases on port 55438 are accepted by the Node script.

Then it makes a custom-format PostgreSQL dump, restores into a second database, checks database readiness and the append-only payment trigger, and compares SHA-256 fingerprints and counts of every public table, including migration history, plus every public sequence state. The cluster stops in `finally`. Temporary dumps contain synthetic data only. The script prints the artifact directory; keep the benchmark, fingerprints and server log as validation evidence. No application connection, real SMS, deployment or production data is used.

## Deploy one reviewed release to staging

1. Identify the staging Railway API project/database and Vercel web project. `vercel.json` currently rewrites `/api` to `drivemaster-production.up.railway.app`; set the staging rewrite to its own API and verify that it cannot reach production. Record the release commit and last healthy deployment IDs. Do not use an unreviewed working tree as a production release.
2. Take a hosted database backup and restore it into a separate protected staging database. Verify records, payment totals, sequences, triggers and migration history before proceeding. Keep production backups encrypted and access controlled. Do not put dumps or credentials in this repository.
3. Configure the API environment using `apps/api/.env.example`: database, strong signing secret, exact allowed web origins, verified proxy hop count, `NODE_ENV=production`, `SMS_PROVIDER=kudis`, KudiSMS key and approved sender ID. Configure the web API path to the same deployment. Production mode deliberately refuses mock SMS.
4. Generate Prisma for the release and run `prisma migrate deploy` against the explicitly selected staging database. Run `prisma migrate status` afterward. All 17 migrations through `20261017000000_enrollment_resume` must be present. Readiness checks database access, not migration completeness.
5. Deploy API and web from the same release. Use a brief write-maintenance window while versions differ. Direct tuition edits now require `expectedVersion`; financial adjustments require the initiating-owner header. Verify `/api/ready` through both the API domain and Vercel rewrite, then reopen writes. Check a previously installed PWA and an already-open tab. Preserve offline queues; do not clear browser storage to force an upgrade.

## Staging acceptance and live SMS

Use disposable accounts and an explicitly approved recipient. Record SMS provider acceptance separately from handset delivery and the time the code arrives. Do not record OTPs, passwords, session cookies or provider keys in evidence.

- New owner signup: reload before verification, wrong/expired code, resend cooldown, successful verification, workspace access only afterward, no duplicate school, trial starts once. Verify real KudiSMS delivery on the approved handset.
- Owner password recovery: neutral unknown-account response, actual approved-account delivery, successful one-time reset, old password/session rejected and new login succeeds. Each additional paid SMS needs to be within the agreed test scope.
- Record a student and payment offline on a real phone; reload, reconnect and verify one server record, correct balance and receipt. Keep an uncertain adjustment across reload and confirm one audited result. Re-upload the same CSV and confirm no duplicate students.
- Create and deactivate a receptionist; verify role limits, cross-tab locking, session revocation and preserved queued work. Check another school cannot read records.
- Register a public applicant; reload after submission and payment reporting; verify private resume access, report status and separate receipt opening. Review, record actual payment, activate, book and complete a lesson, then confirm as the student.
- Repeat the snapshot benchmark on staging with the expected school sizes, concurrency and network/device constraints. Measure request errors, response bytes, memory, pool waiting, CPU and device rendering time. The endpoint still returns full history; large payloads can require pagination or incremental snapshots even after server scans are optimized. Set launch enrollment/history limits from measured staging results.

## Monitoring and recovery gates

`GET /api/health` is process liveness. `GET /api/ready` performs a bounded database probe, returns 200 or 503 with no sensitive error details, and disables caching. Concurrent probes share an outstanding query. Configure deployment readiness against `/api/ready`; use `/api/health` for process liveness. A database outage should fail readiness without triggering a restart loop solely because the database is unavailable.

Before launch, enable an external HTTPS probe every minute for web and API readiness, alert after three consecutive failures, and route alerts to the actual operator. Track 5xx rates, slow requests, database connections/storage, backup age, failed sync submissions and SMS delivery failures/budget exhaustion. Do not log applicant biodata, OTPs, auth headers or secrets. Test alert delivery and database-outage recovery on staging. These monitors are deployment settings; a code endpoint alone does not enable them.

Enable hosted scheduled backups and point-in-time recovery if supported. Agree business RPO/RTO, retention and responsible operator before launch; then time a real restore and compare it with those targets. This local rehearsal does not prove hosted retention or restore times. Restore into a new database first and reconcile post-backup payments before any cutover.

For a failed release, disable writes and roll API/web back together to the recorded compatible release. Keep additive schema columns and payment history. Do not reset the database, delete immutable ledger rows or reverse migrations automatically. If an old release is incompatible with the ledger/session changes, restore service by rolling forward; use database recovery only with a reviewed reconciliation plan.


## Recorded local result: 17 October 2026

583 distinct tests passed; the production build passed, with the API rebuilt after the snapshot optimization. Lint: zero errors, 12 existing warnings. The complete migration/backup/restore rehearsal passed and all test servers stopped. Snapshot medians were 221/657/1,509 ms for 100/500/1,000 students; corresponding JSON sizes were 412,202/2,058,202/4,115,702 bytes. See `validation/batch4-local-20261017.json` for timings and restored-data fingerprints.

The supplied live web URL and health endpoint returned 200; readiness and owner-verification endpoints returned 404. No live deployment, account creation or SMS send was performed. Hosted acceptance and operations gates above remain open.
