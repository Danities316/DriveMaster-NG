# Changes and verification

## Home page and dashboard

- A responsive public home page explains the student/payment outcome, demonstrates a sample payment without an account, and answers access/offline/scope questions.
- Working hash navigation connects the home page, sign-in, and authenticated workspace. Marketing copy avoids invented customer results, pricing, guarantees, and unavailable features.
- A new app shell connects Overview, Students, Payments, and Synchronization. Instructor accounts remain excluded from financial screens.
- School-scoped dashboard totals use exact money arithmetic, Lagos calendar days, and separate confirmed versus unconfirmed payments. Overpayments do not hide other students' debts.
- Payment history supports search, status filters, and pagination. Quick actions open existing student and payment workflows.
- Automated tests cover financial aggregation, navigation, empty states, payment filtering, the interactive example, keyboard tabs, and role restrictions.

## Automatic synchronization

- Durable local queue with persisted retry deadlines, restart recovery and a cross-tab lease.
- Authenticated, tenant-scoped batch processing with transactional receipts and audit events.
- PostgreSQL change log, ordered cursors and incremental downloads, including an initial history bootstrap.
- Student version checks and explicit conflict resolution; immutable, deduplicated payments.
- Offline create/edit/payment dependency ordering and atomic local acknowledgement handling.
- Separate confirmed records prevent payment double counting after a lost response.
- Sync status, retry controls, conflict review, session-change cancellation and safe legacy queue upgrades.
- Missing payment/authentication migration added so a fresh migrated database matches the Prisma schema.

## Earlier correctness work retained

Exact bigint money calculations; normalized replay comparisons; amount/calendar-date validation; school-scoped repositories; revalidated sessions and roles; safe school switching and offline logout; preserved incomplete-history totals; instructor UI restrictions; VehicleStatus schema alignment.

## Verification

Automated regression suites, TypeScript checks, ESLint and production builds are run for this revision. Tests include fake IndexedDB queue/retry/concurrency cases and real PostgreSQL integration tests against a separate local sync_test database. The four checked-in migrations were applied successfully there. See SYNC.md for reproducible commands and browser acceptance steps.

The user's configured application database is not modified by this verification. Apply migrations there explicitly before running the updated application. Real browser/multiple-device acceptance and production deployment remain separate checks.

## Remaining modules

WhatsApp receipts, vehicle/fuel workflows, bookings, dashboards, financial correction transactions, comprehensive audit coverage outside synchronization, production onboarding and deployment readiness remain outside this update.

## Full-tank fuel consumption

- Added school- and vehicle-scoped full-tank intervals with partial-refill accumulation, distance, L/100 km, km/L, refill totals and refill cost/km.
- Added a live consumption table to Mileage & fuel. Backdated synchronized fills recalculate cycles. Unconfirmed, unknown or invalid records interrupt cycles; zero-distance cycles are withheld.
- Added setup and calculation guidance in FLEET_RECORDING.md and corrected outdated feature descriptions in README, SYNC and the public FAQ.
- Verification: 11 calculation tests and 8 fleet service/UI tests passed. Production TypeScript and Vite/PWA builds passed.

## Vehicle benchmarks and discrepancy flags

- Owners can configure a vehicle's expected L/100 km range, lesson/idling allowance and supporting reason. Settings synchronize through version-checked, idempotent transactions and before/after audit records.
- Completed full-tank cycles display their current threshold, high/low/in-range status, percentage over and litres above the allowance. A filter isolates high-consumption cycles. Pending settings do not change confirmed assessments.
- Concurrent stale settings are flagged as conflicts; owners can discard failed/conflicting local proposals and start from the synchronized settings. Stale receipts cannot roll back newer vehicle benchmarks.
- Added migration `20260922000000_fuel_benchmarks`; verified in isolated `sync_test` database with no Prisma schema drift. The user's application database and environment files were not modified.
- Validation: 279 automated tests passed (63 shared, 110 API, 106 frontend), including database integration tests. Type checks passed. See FLEET_RECORDING.md for setup and limitations.
