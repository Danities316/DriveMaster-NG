# School profiles and configurable rules

Open **Training → Training settings** as the owner.

## School and instructor details

Select **Load profiles**, then enter the school's CAC registration and FRSC accreditation numbers. CAC numbers are trimmed, converted to uppercase and unique across schools; the internal school ID remains the relationship key. Both numbers may be blank for existing schools.

Choose an existing instructor to edit their licence number, NIN and permit expiry date. Create their login in the existing account form first if necessary. The supplied licence example `YEN12801AA01` has 12 characters: 3 letters, 5 digits, 2 letters, 2 digits. NIN is stored as text with exactly 11 digits. Leading zeroes are retained. These are format checks, not FRSC/NIMC verification. Blank values clear a field. Calendar dates are validated.

Profile reads and writes require an authenticated owner, matching account/school headers and an internet connection. Responses use `Cache-Control: no-store`. Private identifiers are not included in training snapshots, IndexedDB queues or automatic audit metadata. They are stored in the server database; this change does not add database-at-rest encryption. Profile updates require a reason and version check. A lost response can be resolved by loading the profile again; stale writes do not overwrite a newer edit.

## School rules

The owner can set:

- The school target of separate training days (1–1000; default 26).
- Whether an instructor NIN and licence number must be present before booking, moving a booking or starting training (default: neither is required).
- Whether an expired/missing instructor permit date warns or blocks those actions (default: warn).
- The permit reminder period (0–365 days; default 30).

The recorded DSSP reference stays 26 days independently of the school target. This is the user-supplied reference, not a verified live regulatory feed. A lower school target is explicitly labelled. Changing the target does not constitute FRSC approval, add paid lessons or change fees.

New enrollments snapshot the accepted rules; a stale enrollment request must be reviewed after a rule change. Existing enrollments retain their original snapshot. Legacy enrollments without a snapshot use the fixed starting target of 26, not the latest school target. The owner may explicitly change a selected existing student's target, with a reason and version check. Instructor-document requirements are current operational rules and apply to subsequent bookings, reschedules and starts, including existing bookings. Finishing a trip already in progress is not blocked, preserving attendance and expense records.

Permit expiry is evaluated against the lesson's Nigerian calendar date on the server. A permit is valid through its expiry date. Notices in the cached UI reflect the last loaded server snapshot; the server rechecks each operation. Warning mode does not certify legal validity.

Rules and enrollment targets use the existing durable `trainingQueue`, `trainingCache` and server `TrainingRecord`/receipt/audit flow. No new IndexedDB store is required for these JSON records. Pending changes do not pretend to be accepted rules. Reasons and before/after rule values are audited. Private profile details intentionally do not enter this offline flow.

## Database and local testing

The additive migration `20260928000000_profiles` adds nullable profile fields and version counters; it does not overwrite existing students, payments or lessons. It has been applied to the local development database in this workspace.

For another installation, from `apps/api` run `npx prisma migrate deploy` and `npm run prisma:generate`. Restart the API after generating the client. Start the app using the existing `npm run dev:api` and `npm run dev:web` commands from the project root.

Check that an instructor cannot access profile endpoints or change rules, that invalid NIN/licence/date values are rejected, and that changing the school target preserves existing students' saved targets. Use a test instructor to try warning/blocking modes. Existing financial records do not need to be recreated.

Later increments add QR enrollment, registration review and qualifying-day progress (see [QR_ENROLLMENT.md](QR_ENROLLMENT.md)), plus vehicle document reminders and expanded expense reporting (see [REMINDERS_AND_COSTS.md](REMINDERS_AND_COSTS.md)). Official DSSP exports remain outside the implemented scope.
