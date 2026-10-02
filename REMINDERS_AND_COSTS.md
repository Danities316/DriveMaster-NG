# Reminders and training costs

Restart the API and refresh the browser after this update. In Training, select Refresh to load the new fields. Existing pending records do not need to be deleted or recreated.

## Document reminders

- Under Training → Training settings, save vehicle insurance and roadworthiness expiry dates. Instructor permit dates remain in Instructor profiles.
- Under School rules, choose the reminder period (0–365 days) and whether missing/expired documents warn or block. Defaults are 30 days and warning only.
- Dashboard and Training show missing, due-soon and expired documents. These are in-app notices, not SMS, email or WhatsApp notifications.
- A document stays valid through its expiry date, using the Nigerian calendar date. Blocking is checked by the server for booking, rescheduling and starting lessons. Finishing an ongoing trip remains possible so attendance and expenses can be recorded.
- Offline notices use the last saved dates. Pending document/rule changes take effect only after acceptance by the server. Warning mode is an operational setting, not a statement that expired documents are legally valid.

## Costs and expenses

Open Training → Costs and expenses as the owner.

- The report shows lifetime agreed fees and payments separately, then each student's recorded fuel spending, instructor pay share, other recorded costs, other estimates and expected money left.
- Add an expense for one student, share it equally among several students, enter custom shares, or leave it as a school expense not assigned to students. Custom shares must total the expense exactly. Equal shares preserve every kobo.
- Recorded costs and estimates are separate. Cancel an incorrect expense with a reason and add a replacement. The original remains in history. When an estimate becomes a recorded cost, cancel the estimate before adding the actual cost to avoid counting both.
- Instructor pay is allocated from monthly salary by teaching time. It is not evidence that salary has been paid. Unused teaching capacity, unassigned overheads and unrecorded costs are not included in student margins. These totals are not final business profit or a bank balance.
- Expected money left = agreed fee − recorded fuel spending − instructor pay share − other assigned recorded expenses − estimated remaining lessons − other assigned estimates. Future lesson costs use the current fuel allowance and current saved instructor-pay rates. Missing current pay hides an incomplete forecast.

## Fuel accountability

Starting a trip records money issued. Finishing asks for the actual purchase amount and receipt details, or an explicit no-purchase answer. Purchases enter Mileage & fuel once; spending is shared among attending students. Fuel bought does not prove those litres were consumed by those students: full-tank consumption remains a separate vehicle measurement.

For example, two students receive ₦3,000; the instructor buys ₦2,400 of fuel. Each gets ₦1,200 of recorded fuel spending and ₦600 remains to be accounted for. The owner records returned cash under Fuel money to account for. Returns cannot exceed the unspent advance and do not reduce actual fuel spending a second time. Overspending is flagged for the owner to check funding.

Fuel advances for ongoing trips are included in estimated remaining costs, not recorded purchases. Older completed trips retain their original figures. A pending finish saved by an older app without an actual amount uses the issued allowance and is labelled as an older allowance-based record; no historical receipt is invented.

## Storage and access

Vehicle dates, expense entries, cancellations and fuel returns use existing versioned TrainingRecord records, command receipts, audits and the durable offline training queue. No additional database migration or IndexedDB store is needed for this increment. Owners control expenses, returns and vehicle dates. Private student costs are excluded from instructor/student/receptionist snapshots. Pending edits do not enter confirmed totals.

## Quick local check

1. Set a vehicle insurance date to yesterday using a test vehicle. Confirm a reminder appears. In warning mode bookings still work; in blocking mode new bookings and starts are rejected.
2. Renew the date and send changes. Refresh and confirm the warning disappears when outside the reminder window.
3. Complete a test trip with spending below the advance. Check the student's fuel cost, the fuel purchase and the amount to return. Record the return once.
4. Add a shared expense; check student costs. Add an estimate; it should affect expected money left but not recorded spending. Cancel an incorrect entry and confirm history remains.
5. Disconnect, save an expense, reconnect and send saved records. Only the accepted entry should appear in totals.
