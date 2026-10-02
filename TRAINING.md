# Training sessions, fuel spending and student margins

## Activate locally

Open the `review-source` folder in VS Code. Stop the API and frontend, then run:

```powershell
npm run prisma:generate --workspace=apps/api
npm exec --workspace=apps/api -- prisma migrate deploy
npm run build:shared
```

Restart with `npm run dev:api` and `npm run dev:web` in separate terminals. This applies `20260923000000_training` to the database configured in your existing API `.env`. Development verification used a separate local `sync_test` database; your application database and `.env` were not changed.

## First-time setup (owner)

The dashboard now has **Your school today**, with direct links to today's outings, unanswered student confirmations and reported problems. Open **School setup** for the guided checklist. See [USABILITY-TESTING.md](USABILITY-TESTING.md) for a full local walkthrough and an owner usability test plan.

When starting an outing, attendance is not preselected: tick students who are actually present and check the calculated fuel total. Finishing uses three steps: driving time and mileage, fuel bought, then check and save. Entries stay in the form when moving Back and Continue. The fuel purchase time and mileage must be entered from the actual purchase.

Open **Training → Training settings**. Each settings section opens only when you need it:

1. Create training packages with a name, fee and number of sessions. Every session gives one student 30 minutes of driving.
2. Assign a package to each existing student. This sets the student's tuition fee to the selected package price; existing payments remain. The package and student version are checked before assignment, including offline requests. Later package edits do not change assigned sessions or the agreed package price. The financial summary follows the student's current tuition record if staff later explicitly change tuition through the existing student editor.
3. Set the default fuel money per student. It starts at ₦1,500 and can be changed, with a reason. New bookings use the default; existing bookings retain their amount. The owner can override a particular outing's amount before fuel is issued.
4. Create instructor login accounts if they do not already exist. Record each instructor's monthly salary and planned teaching hours for the month. A salary rate is required before an outing can start. School salary months use Lagos time.
5. Create a student login using the student's registered phone number and a starting password of at least 10 characters. Give the details privately to the student. Students and instructors can change their own password after signing in. Account creation and password changes require internet; passwords are never saved in the offline queue or audit metadata.

Existing vehicles and students must be synchronized before they appear in training setup. One training package can currently be assigned per student; package upgrades or a second enrollment require a later workflow.

## Book and run an outing

Training now opens on **Today's lessons**. Use **Show training** to choose all dates, training in progress, unanswered confirmations or reported problems. A reminder links to unfinished training from another date. The other two main views are **Student progress** and **Training settings**. Advanced student costs are under **View training costs**.

Select **Book training**, choose up to three students, then select the instructor, vehicle and time. Check the duration and planned fuel total before saving. The daily card shows student names, instructor, vehicle and fuel money. Select **Start training** or **Finish training** for the next step. **More options** contains fuel changes and moving/cancelling a booking. Cancellation does not ask for a new date.

Students choose **Yes, I attended** or **Report a problem**, alongside their recorded driving minutes. Reporting a problem requires an explanation. A lesson below 30 minutes cannot be confirmed as a full lesson. Instructor and owner permissions remain unchanged.

An **outing** is one instructor taking one vehicle with one to three students. Each student has a separate lesson record. The booking reserves 30 minutes and one package session per student. The server rejects overlaps involving a student, instructor or vehicle, and prevents bookings beyond the student's remaining package sessions. Future bookings can be made while another outing is running; a second outing cannot start with that instructor or vehicle until the first finishes.

Use **Start outing** to record the actual time, dashboard mileage and students who are present. Fuel money issued is the outing's saved per-student allowance multiplied by the number present. At ₦1,500 each, two students receive a combined ₦3,000 allocation; an owner-set ₦2,000 allowance gives ₦6,000 for three students. Absent students receive no fuel allocation and keep their session. Office staff can book them for another date. Unstarted outings can be moved or cancelled without deducting a session.

Use **Finish outing** to record:

- Actual finish time and mileage.
- Each attending student's actual driving minutes, topics taught and progress notes.
- Litres purchased with the issued fuel money, receipt reference, actual purchase time and mileage, and full/partial tank status.

The current workflow assumes the full issued allowance is spent on one recorded fuel purchase during that outing, following the school's stated practice. The purchase time and mileage must be within the outing. It creates the fuel record automatically in **Mileage & fuel**; do not enter that receipt there a second time. Fuel returns, multiple purchases per outing, pre-existing purchase linking and spending adjustments need a separate reconciliation workflow and are not included here.

Start/end mileage readings are also added to the existing mileage history. They obey the same chronological checks as other vehicle readings. A finish cannot precede its start, last more than 12 hours, lower the mileage, overlap another outing or claim more total driving minutes than elapsed outing time. A lesson shorter than 30 minutes cannot receive full-session credit.

## Student confirmation

Students sign in through the normal phone/password form and land on **My lessons**. They see only their own package/fees, lesson history, instructor, vehicle and lesson notes. Instructor salaries, school margins, other students and other outings are not returned by the student API.

After the instructor finishes, each student chooses **Yes, I attended for at least 30 minutes** or **There is a problem**, with a reason. An instructor or office user cannot submit a student response. No response is not treated as an absence. Waiting and disputed lessons remain separate from confirmed sessions and reserve their package slot to prevent overbooking.

An owner can review a disputed lesson with a recorded reason. They can count a qualifying lesson or return the session to the student. The original student response, recorded minutes and before/after audit history remain. Fuel and instructor spending are retained even when a session is returned. There are no SMS/WhatsApp reminders, automatic confirmation or automatic claim approvals.

## Student costs and expected margin

Open **Training → Student progress & cost**, or use **View training, progress and costs** from a student's details.

- **Fuel money allocated:** each student's share of money issued for started outings. Completing the outing records the corresponding purchase. This is spending, not exact fuel physically consumed by one student.
- **Instructor cost:** monthly salary divided by planned teaching minutes, multiplied by actual outing duration. The total is divided equally among present students, with any kobo remainder allocated deterministically so shares equal the total. A started outing keeps its salary snapshot even if a monthly rate changes later. This is an allocation of salary, not an additional wage payment.
- **Estimated remaining cost:** the current fuel default plus the average currently configured instructor rate for this month, assuming 30 minutes per remaining session. Already-issued fuel for an ongoing lesson is not counted again. Future estimates change when current rates change. If required monthly rates are missing, the app withholds the estimate instead of treating instructor time as free.
- **Expected margin:** current agreed tuition minus incurred/allocated costs and estimated remaining costs. Payment received and balance owed are shown separately. Margin excludes rent, repairs, insurance, other overheads and extra direct expenses: it is **not net profit**. Longer outings, future price changes and repeated lessons can change the result.

Money uses integer kobo arithmetic. Completed outing rates and allowance amounts stay fixed. Vehicle-level full-tank consumption and discrepancy checks remain available separately; a per-student fuel allowance is not presented as measured consumption.

## Offline saving, permissions and audit

Training uses `/api/training/commands` with a separate durable Dexie queue and `/snapshot` with a role-filtered snapshot. The legacy `booking` sync entity and old `SessionBooking` table are not used for this group workflow. Packages, agreements, rates and outing aggregates live in versioned `training_records` JSON documents; application transactions validate all school/student/instructor/vehicle references. Direct database edits bypass these rules and are unsupported.

Changes are saved on the current device and sent automatically while the app is open. Bookings are tentative until accepted by the server. A queued start can be followed by a queued finish on the same device. Repeated delivery uses the same command ID and commits the business change, audit and receipt atomically; retries cannot issue fuel or deduct sessions twice. School-level transaction locks and expected versions protect overlapping bookings and conflicting edits.

Each command belongs to its school, account and role. Signed-in account headers are checked against the live server session to prevent a changed account from submitting another account's queue. Snapshot identity/role checks prevent cached owner data from being shown to students or instructors. Switching schools with unsent work is blocked. Offline caches remain local browser data: use separate browser profiles on shared computers and do not clear site data while work is unsent.

Failed changes retain their details. Load the latest records, inspect the reason and either retry or remove the failed unsent change and dependent later steps for that same record, then enter corrected details. Removing an unsent command does not delete server records. One failed command pauses that account's later queue until reviewed. No closed-app background delivery or visual/browser acceptance testing is claimed by automated tests alone.

The waiting list is ordered oldest first and shows the first blocking error prominently. **Send saved records** and **Refresh** try pending records immediately without waiting for the automatic retry timer; they do not bypass a rejected record or an active sender in another tab. Temporary connectivity/server failures continue retrying with a delay of up to five minutes instead of permanently stopping after five attempts. Background failures, expired sign-in and busy sending are shown on the Training screen.

Monthly pay saved locally is listed as waiting to send, not treated as missing or as accepted by the server. A second local entry for the same instructor and month is blocked until the first is sent or reviewed. The booking card checks the booked month, while starting training still validates the month of the actual start time. Existing saved records are retained.

If sending remains busy, **Restart sending** explicitly takes over the sending lock. The older sender checks ownership before changing local records and cannot clear or overwrite the newer sender's results. Requests retain their original IDs, so the API's transactional receipts prevent duplicate application of a record whose earlier response was lost. Restarting does not bypass a rejected record that needs review and does not delete saved changes.
