jvv# Local usability review

The September 25 update adds a daily training overview, setup checklist, filtered confirmation lists, explicit attendance selection, a three-step lesson completion form, and clearer money/status wording. It does not require a new database migration beyond the existing training migration.

## Try the changes locally

The latest training redesign opens on today's lessons. Test the **Today’s lessons**, **Student progress** and **Training settings** buttons. Settings and student costs are expandable, so daily work stays focused. Use **Book training → Check booking → Save booking**, then the card's **Start training** and **Finish training** actions. Check that **More options** keeps fuel changes and cancellation separate from the main action.

Also test a training trip that started on an earlier date: the daily screen must offer **View training in progress**. Students should see their driving minutes beside the two attendance choices. A student with fewer than 30 recorded minutes must be able to report a problem but cannot confirm a full lesson.

Start the API and web app using the commands in TRAINING.md. Use test students and a test vehicle. Sign in as the owner.

1. Open **School setup** from the dashboard. Each checklist action opens the matching form or page. Add a package, instructor, vehicle and student. Assign the package. Enter monthly instructor pay and planned teaching hours for the month being tested. Records count as ready after they are sent.
2. Book two students on one outing. Open **Your school today** to see its planned fuel money. Cancelled outings must not count. The date is based on Lagos time; the screen displays when records were last loaded.
3. Open the booking. Tick the students who are actually present. Starting with none selected is blocked. At ₦1,500 each, one present student gives ₦1,500; two give ₦3,000. A missing student keeps their session.
4. Complete the outing through **Driving time and mileage → Fuel bought → Check and save**. Use actual data. For a quick historical test, choose an outing that began at least one hour earlier for two students driving 30 minutes each. Times cannot be in the future. Use mileage consistent with the vehicle's history.
5. Try entering more driving minutes than the outing lasted. Check that the error explains how to correct it. Try a fuel purchase outside the outing's time/mileage range. Move Back and Continue and confirm the entries remain.
6. Check the summary before saving. The fuel purchase should appear once in Mileage & fuel after sending. Lessons should await each student's response.
7. Use a separate browser profile/private window to sign in as a student. Confirm one lesson, or report a problem with a reason. Update records on the owner's screen. The dashboard buttons should open the matching unanswered/problem lists across all dates.
8. Open student costs. The remaining-money figure is an estimate after training costs, before rent, repairs and other school expenses. Payment records sent to the school account are not bank verification.
9. Repeat on a phone-sized screen. Check that labels, buttons and forms are readable, the Log out button remains visible, and only the current completion step is shown.

## Observe real driving school owners

Invite a small group of owners with different levels of computer experience. Use sample records and ask each person to add a student, record a payment, book/finish a lesson, find an unanswered confirmation, and explain a student's training cost. Do not show them where to click first.

Record whether each task was completed without help, where they hesitated, mistakes made, and which labels they misunderstood. Ask what “Record sent” and “Estimated money left after training” mean to them. Check that they distinguish saved records from bank verification and estimated training margin from final profit.

These are proposed acceptance checks. Automated tests do not establish that real owners find the app easy, and no owner interviews are claimed by this update.
