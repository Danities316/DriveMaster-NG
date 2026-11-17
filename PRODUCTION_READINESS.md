# Production readiness — progress and next batches

Reviewed 16 October 2026. Apply Hormozi's value equation through dependable records (confidence), fast activation (time delay), and recoverable workflows (effort). Do not claim measured conversion or profit improvements.

## Batch 1 — record integrity

Implementation complete. Targeted regression tests and typecheck passed. Lint has zero errors and 12 existing warnings in the SMS sample and DocumentReminders component.

- Payment adjustments: Dexie schema v5 adds `pendingAdjustments`. Persist the exact request before HTTP, scope it to school/payment and initiating user, and reserve it transactionally across tabs. Reload/reopen restores it; even a now-reversed entry allows the original request to be replayed. Only a server acknowledgement or definite validation/conflict rejection clears it. Authentication failures, initiating-owner mismatches and uncertain responses preserve it. The API requires `X-Adjustment-User` to match the authenticated owner so a cookie changed in another tab cannot silently change the initiating account. Requests time out after 20 seconds. Pending requests block switching schools so they cannot be erased by cache preparation.
- Direct student edits: require `expectedVersion` on `PATCH /api/students/:id`; expose current `version` in GET/list/create/update responses. Compare again under the school lock before updating. A stale edit returns 409 `STUDENT_CONFLICT` and adds no audit/write. Missing versions return 400. Offline sync retains its existing version envelope. Direct API callers must fetch the student and submit the version they reviewed.
- CSV imports: preview and saving share validation (including phone maximum length). Parse quoted spreadsheet fields. Derive a school-scoped UUIDv8 from normalized row content, and atomically avoid recreating an existing row. Re-uploading identical rows after a reload or from another device uses the same student IDs. Changed rows are new content; this is not an update/import-merge tool. Remove each successfully processed row from the preview immediately; catch partial failures and keep remaining rows available for retry. Later student edits are preserved.

No new PostgreSQL migration. Existing Phase 1–3 migrations remain prerequisites. The local IndexedDB upgrade preserves queued work.

Relevant files: `PaymentAdjustment.tsx`, `db.ts`, `localSession.ts`, `studentImport.ts`, `StudentCsvImport.tsx`, `studentService.ts`, API `routes/students.ts`, `students/studentService.ts`, `students/studentRepository.ts`, shared `students.ts`.

## Batch 2 ? account and SMS controls

Implementation complete. All 89 targeted tests passed: 37 frontend, 17 API unit/HTTP, and 35 isolated PostgreSQL integration tests. Typecheck passed; lint has zero errors and the same 12 existing warnings. The test database was stopped afterward.

- Cross-tab logout/account change locks stale screens without revoking a newer user's cookie. Shared auth revisions reject stale login/session responses. Session checks run on focus/online/visibility and every 60 seconds in visible tabs, without restarting sync for an unchanged user. Queued work and unresolved financial requests remain intact.
- Owner-only online receptionist provisioning and paginated staff management in School setup ? People. Versioned deactivation/reactivation requires a reason, revokes old sessions and reset codes, and audits the change atomically. Only instructor/receptionist targets are allowed; records are retained. Offline devices cannot be remotely wiped or locked until they reconnect.
- SMS request-abuse limits are separate from the shared provider-attempt budget. Cooldown rejection and ineligible recovery requests do not spend delivery budget. A durable reset-delivery claim prevents duplicate tasks from sending/charging twice. Provider failures still count as attempts; budget exhaustion invalidates the unusable challenge.

Deployment: regenerate Prisma and apply `20261016020000_reset_delivery_claim` before the updated API, then deploy API/web together. Only the isolated localhost:55438/sync_test database has been migrated during implementation. See ACCOUNT_SECURITY.md for behavior and operational limits.

Relevant files: web App.tsx/lib/auth.ts, TrainingPage.tsx/StaffAccounts.tsx; API staffAccounts.ts/trainingRoutes.ts, ownerVerification.ts/passwordRecovery.ts; Prisma password reset delivery claim.

## Batch 3 - registration and capacity

Implementation complete. All 47 distinct targeted tests passed: 22 frontend, 7 API HTTP, and 18 isolated PostgreSQL integration tests. Typecheck passed; lint has zero errors and the same 12 existing warnings.

- Secure same-browser registration resume: persist only opaque registration/payment IDs and a random 256-bit token before sending. The API stores its hash with a 30-day expiry; references alone cannot fetch status. Reload checks registration and latest payment-report status without returning biodata, receipts or bank-transfer details. Protected registration retries and payment reports require the token, including duplicate report acknowledgements. Stable IDs prevent duplicate reports after uncertain responses. No applicant draft or receipt image is stored locally. Clear saved access from the success page for shared-device use; lost/expired access or another device requires school assistance. Legacy registrations retain the old flow and cannot resume.
- Registration review lists select receipt MIME metadata instead of image bytes, return `hasReceipt`, and omit resume credentials. Only the authenticated receipt endpoint fetches image bytes when opened.
- First-day owner guidance remains despite payments or multiple students until a real first booking. Missing snapshots still show a setup action. This reduces setup effort and delays while reliable submission/report status increases confidence, in line with Hormozi's value equation.

Deployment: regenerate Prisma and apply `20261017000000_enrollment_resume` before deploying the updated API/web. All 17 migrations were validated on a fresh isolated localhost:55438/sync_test database. Its server was stopped afterward. No migration was applied to the configured application database. See QR_ENROLLMENT.md for access and recovery limits.

Relevant files: API enrollmentRoutes.ts and Prisma enrollment resume migration; web PublicEnrollmentPage.tsx/enrollmentResume.ts and FirstDayOnboarding.tsx.

## Batch 4 - local validation complete; hosted release gates pending

17 October 2026: 583 distinct automated tests pass: 75 shared, 133 API unit/HTTP, 58 PostgreSQL integration and 317 frontend. The full production build passed; the API was rebuilt and affected training/readiness tests rerun after the load-driven fix. Lint has zero errors and the same 12 existing warnings.

- Added `/api/ready` with a three-second database-probe deadline, a safe 503 response, no caching, and reuse of an outstanding query. `/api/health` remains process liveness. Four tests cover success, failure/recovery, timeout/coalescing and independent liveness.
- Growing-history validation found a snapshot transaction expiring after 23.9 seconds. Moved pure derived calculations outside the consistent read transaction and indexed student/payment/outing/expense/account lookups once rather than rescanning school history for each enrollment. A new regression compares indexed results with full-history accounting, including shared outings/expenses. Existing tests still verify privacy and tenant boundaries.
- Rehearsed all 17 migrations in a fresh synthetic localhost database, then custom-format PostgreSQL backup and restore into a second isolated database. All public-table row counts/SHA-256 fingerprints and sequence states matched. Restored readiness and payment immutability checks passed. Both test clusters were stopped. The configured application database was not migrated or modified.
- Authenticated snapshot benchmark: 100 students/500 outings/500 payments: median 221 ms, largest of three concurrent requests 483 ms, 412,202 response bytes. 500/2,500/2,500: median 657 ms, concurrent max 1,425 ms, 2,058,202 bytes. 1,000/5,000/5,000: median 1,509 ms, concurrent max 1,648 ms, 4,115,702 bytes. Five sequential samples and one concurrent batch of three after warm-up per school. These local synthetic measurements do not establish hosted capacity or mobile usability. Full-history payload growth remains a staging gate; pagination/incremental snapshots may be needed for larger schools.
- Added `scripts/validate-launch.ps1`, `apps/api/scripts/launch-validation.mjs`, `LAUNCH_RUNBOOK.md`, and durable evidence in `validation/batch4-local-20261017.json`. The runbook covers coordinated deployment, previously installed PWAs, real SMS/device acceptance, monitoring, hosted backup/restore and rollback without discarding queued work or payment history.

Live read-only check of the supplied `https://drivemaster-silk.vercel.app/`: web and `/api/health` return 200, but `/api/ready` and `/api/auth/owner-verification` return 404. The checked-in Vercel rewrite targets the production Railway API. No SMS was sent and no live test account was created. A test recipient has been provided; first identify the deployable projects/repository and confirm the environment is suitable for disposable account tests.

Still required before declaring production ready: deploy the reviewed release and migrations to the intended hosted environment; verify actual KudiSMS delivery and owner verification; perform the real-phone/offline acceptance flow and representative hosted load checks; enable and test alerts; prove hosted backup retention and restore against agreed RPO/RTO. These external checks need deployment access/environment details and cannot be replaced by local automated tests.

Batch 1 validation: 56 distinct frontend tests, 35 API unit/HTTP tests, and 13 PostgreSQL integration tests passed across targeted runs (104 total). Coverage includes storage failure before sending, exact refund retry after remount/reversal, initiating-owner mismatch, school-switch preservation, partial CSV failures and re-upload, concurrent imports, UUIDv8 API acceptance, IndexedDB upgrade, missing/stale tuition versions, and one-winner concurrent tuition writes. Typecheck passed. PostgreSQL tests used only localhost:55438/sync_test and stopped the temporary server afterward. No migration was applied to the configured application database.

The full suite was run in Batch 4; subsequent snapshot changes received targeted regression checks. The previous review passed 292 frontend, 124 API, 75 shared and 50 database integration tests on the pre-Batch-1 snapshot. Deploy API and frontend together: direct PATCH calls now require `expectedVersion`, and adjustment POST calls require the initiating-owner header.

## Phase 2 re-verification — 15 November 2026

- `npm run build:shared`: passed; `npm run typecheck`: passed.
- `npm run lint`: 0 errors, 12 warnings.
- `npm test`: shared 75 passed; API unit/HTTP 135 passed (59 opt-in tests skipped); web 319 passed.
- PostgreSQL integration tests: NOT RUN. The local server on `127.0.0.1:5432` required a password for `sync_test`; no configured or hosted database was used.
