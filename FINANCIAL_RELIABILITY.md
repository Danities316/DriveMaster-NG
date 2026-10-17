# Financial reliability — Phase 3

Owners can open a student's **Payment history → Review / adjust payment** while connected. Ordinary payment entry remains offline-first for owners and receptionists. Adjustments require confirmed, fully loaded payment history; queued payments must sync first.

- **Correct**: appends a full reversal and a replacement payment in one transaction. Supports the corrected amount, student, date, method and reference. The original stays visible.
- **Reverse**: cancels a mistaken payment record. This does not return money.
- **Refund**: records money already returned, up to the unrefunded amount on that payment. DriveMaster does not execute a bank transfer.
- **Undo mistaken refund**: appends a compensating entry, retaining the refund history. Active refunds must be resolved before correcting/reversing their original payment.

Every adjustment requires a reason, current owner authorization, and a fresh ledger revision. School-level locking serializes competing financial changes. Request IDs protect retries; an uncertain response leaves the form locked to the same request until retry resolves it. The unresolved request is saved in IndexedDB before sending. After a reload, Review / adjust payment restores the exact request for a safe retry, including when the original entry is already reversed. Another owner on the same device must sign back into the initiating account to resolve that request. Switching schools is blocked until pending adjustments are resolved. Saving requests sync; the UI explicitly distinguishes server confirmation from this device's next balance update.

Payment amounts remain decimal strings. Corrections/reversals offset the original payment date; refunds and refund reversals use the recording date. Creation timestamps retain when the adjustment was made. Existing balance, dashboard, training-cost and enrollment calculations sum signed ledger entries. Refunds and reversals have explicit history labels. Corrections download as an indivisible pair even at a sync page boundary. Offline devices receive adjustments when they reconnect.

Direct student creates/updates and payment creates now commit their audit record with the write. Tuition edits include the previous tuition and submitted patch. Existing offline sync and payment-claim confirmation audits remain transactional; payment rows also record the acting user. Database triggers reject payment updates/deletes, enforce school linkage, and prevent repeat reversals. Legacy rows are retained.

Receipt claim JSON bodies allow 3 MB to accommodate base64 encoding of the existing 2 MB JPEG/PNG/WebP image limit. Ordinary public intake stays at 32 KB. Oversized/malformed JSON receives a safe 413/400 response. The owner progress view displays payment totals once; the student detail view uses its live local money section instead of duplicating cached training totals.

## Deployment

Deploy the API and web together after backing up the database. Apply the pending migrations with the project's normal `npm run db:deploy`, then regenerate Prisma with `npm run prisma:generate --workspace=apps/api` and build. Phase 3 adds `20261016000000_payment_adjustments` and `20261016010000_payment_ledger_guard`; Phase 1/2 migrations must also be present. These have only been applied to the isolated local `sync_test` database during implementation, not the configured application database.

The ledger is intentionally append-only. Database imports/support tools must append valid entries instead of editing/deleting payments. Correction and refund APIs are online-only; offline queued adjustments are not supported. A correction/refund changes accounting records; it does not automatically cancel a student's existing enrollment or training entitlement.
