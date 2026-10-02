# Student and payment synchronization

## Behavior

Every student or payment save commits the visible local record and its outbox entry in one IndexedDB transaction. The background controller wakes after a save, on reconnection, when the page becomes visible and periodically while open. The interface shows unsynchronized work, last completed download, authentication problems and changes needing review.

On an existing synchronized installation, a cycle uploads eligible mutations, records acknowledgements locally, then downloads server changes. A first installation downloads the complete history before uploading, so confirmed financial totals have an authoritative baseline. Partial bootstrap pages persist their cursor and resume after interruption.

Delivery attempts happen immediately, then after delays of 5 seconds, 30 seconds, 2 minutes and 10 minutes. After five unsuccessful attempts the item remains FAILED on the device. The retry button resets failed attempts. Authentication failures pause delivery without consuming attempts. Server validation failures remain visible for review. App closure/background timer throttling can delay attempts; persisted deadlines survive restart.

An expiring IndexedDB lease coordinates tabs. Expired SYNCING entries are recovered. Logout or identity changes abort the controller and prevent stale responses from changing local data. A student creation must be acknowledged before its queued edits/payments are sent; each edit follows the preceding student mutation.

## Server guarantees

- POST /api/v1/sync/batch accepts up to 50 changes. The current client sends one eligible change per request.
- Mutation IDs and device IDs are UUIDs. Tenant and acting user come from the session; explicit school IDs must match.
- Mutation receipts, domain writes, change-log entries and audit events commit atomically. Identical redelivery returns the stored result. Reusing a mutation ID for a different request produces a conflict.
- Payments are append-only and ID-deduplicated. Matching older payment retries can be acknowledged without creating another payment or audit event.
- Student updates require the expected server version. A stale or missing version returns a conflict with the server record.
- PostgreSQL triggers capture student/payment writes, including writes made through older API routes. A per-school row lock orders committed cursors so concurrent writers cannot leave an unseen lower cursor behind a downloaded higher cursor.
- Downloads are school-scoped, ordered and paginated using opaque decimal-string cursors. Local records and cursor advancement commit in one IndexedDB transaction.

The change log and receipts currently retain history indefinitely. Introduce a retention/snapshot policy before large production deployments; do not prune the log without an explicit client reset protocol.

## Conflicts and financial totals

Review saved changes shows server student details alongside the proposed fields. Keep my changes creates a new mutation ID based on the reviewed version. Use server for this change discards only that queued edit and preserves later dependent work. If a newer server version arrives during review, another review is required. Payment conflicts remain visible for administrator investigation; they are never automatically overwritten or counted as newly accepted money.

Confirmed payment IDs are stored separately from the local pending projection. A payment already observed in a download is not counted again while its acknowledgement is retried. Locally queued payments contribute to the displayed provisional total and remain labeled as queued. Before bootstrap completes, previously saved confirmed totals remain available.

## Upgrade

Run from the source root:

```powershell
npm run prisma:generate --workspace=apps/api
npm exec --workspace=apps/api -- prisma migrate deploy
```

Migration 20260919000000_durable_sync adds student versions, receipts, a change log, transactional triggers and initial snapshots of existing students/payments. Migration 20260919010000_complete_payment_and_auth_schema adds missing payment method/currency fields, makes user email optional and enforces unique login phone numbers. Existing payments without method/currency receive CASH/NGN defaults. The phone index intentionally fails if existing accounts have duplicate phone numbers; resolve those identities explicitly before completing that migration.

Dexie version 2 upgrades existing queued IDs and payloads in place, infers the school from cached students and orders dependencies. Older queued edits without a known server version require conflict review. Entries whose school cannot be identified are retained with an administrator-recovery warning; their ownership is never guessed.

Do not clear browser site data while unsynchronized work exists. School switching preserves this rule. Browser private mode and manually clearing storage can still remove local data.

## Manual local check

1. Start the API and frontend using README.md. Sign in and wait for Last synchronized.
2. Open browser developer tools, Network tab, and choose Offline. Keep the already loaded app open.
3. Add a student, edit the name, and record a payment. Confirm queued status and the provisional balance.
4. Restore Online. The queue should empty automatically and show Last synchronized.
5. Reload online, then sign in through a second browser profile. Confirm the same student/payment and balance, with only one payment recorded.
6. For conflict review, edit the same existing student offline in profile A, save a different edit online in profile B, then reconnect A. Review the conflict using either action.
7. For restart recovery in development, stop the API while leaving Vite running, create queued work, reload, restart the API and use Sync now or wait for its saved retry deadline. A true offline reload requires the installed/built PWA; Vite development assets are not an offline acceptance environment.

## PostgreSQL integration tests

Use a separate local PostgreSQL database named sync_test. Never point this command at your development or production school database. Replace the example test connection with your local test credentials.

```powershell
$env:DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/sync_test?schema=public'
npm exec --workspace=apps/api -- prisma migrate deploy
$env:SYNC_TEST_DATABASE_URL = $env:DATABASE_URL
npm test --workspace=apps/api -- src/sync/syncRepository.integration.test.ts
Remove-Item Env:SYNC_TEST_DATABASE_URL
Remove-Item Env:DATABASE_URL
```

The suite creates uniquely identified test schools and leaves them in this disposable database. It checks concurrent/idempotent delivery, versions, legacy payment retries, transaction rollback, tenant isolation, pagination and cursor ordering. Regular npm test skips these six checks unless SYNC_TEST_DATABASE_URL is explicitly set.

## Scope

Automatic synchronization covers students, payments, vehicle registration, mileage readings and fuel claims. Booking mutations remain unsupported. Fleet writes create their change journal through the application transaction; direct database edits to fleet records are not synchronized automatically. Consumption figures are derived locally from synchronized fuel history. There is no closed-app background upload service, automated payment correction workflow or claim of production/browser/device acceptance from unit tests alone.
