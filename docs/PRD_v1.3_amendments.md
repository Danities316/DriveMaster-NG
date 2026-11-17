# PRD v1.3 amendments

D1
Decision: D1 — Fuel: IMPLEMENT the locked §26.5 rule now. Park the consumption/benchmark model as post-MVP behind a disabled flag (do not delete). FOUNDER-APPROVED
Reason: PRD v1.2 §26.5 locks fuel rule: discrepancyAlert = distanceDelta < 10 km AND fuelCost >= ₦5,000; forbids fuel-efficiency models without approval.
PRD sections amended: §26.5
Follow-up work:

- [ ] implement the discrepancyAlert gate in fleetService
- [ ] keep the consumption/benchmark model behind a disabled flag without deleting it
- [ ] confirm no fuel-efficiency model is enabled without approval

D2
Decision: D2 — Bookings: ADOPT "training outings" as the MVP booking model and amend §26.4 statuses to match the code. CONDITIONS: every command must be idempotent, server conflicts must be surfaced to the user as CONFLICT (never discarded), and tests must cover duplicate delivery, retry and conflict. Reconciling trainingQueue into the outbox is post-pilot. FOUNDER-APPROVED
Reason: PRD §26.4 defines SessionBooking (SCHEDULED/COMPLETED/CANCELLED/NO_SHOW; vehicle + instructor overlap blocked); code uses training outings via /api/training/commands and a trainingQueue (PENDING/FAILED only), bypassing the outbox with mutationId, deviceId and CONFLICT.
PRD sections amended: §26.4
Follow-up work:

- [ ] adopt training outings as the booking model for MVP
- [ ] align statuses to the code paths and server-side overlap checks
- [ ] enforce idempotent commands and surface CONFLICT to users
- [ ] test duplicate delivery, retry and conflict handling
- [ ] keep trainingQueue-to-outbox reconciliation post-pilot

Outing statuses:

| Training status        | Old SessionBooking meaning                             |
| ---------------------- | ------------------------------------------------------ |
| BOOKED                 | SCHEDULED                                              |
| STARTED                | SCHEDULED (lesson in progress; no separate old status) |
| COMPLETED              | COMPLETED                                              |
| CANCELLED              | CANCELLED                                              |
| MISSED (member status) | NO_SHOW                                                |

D3
Decision: D3 — Scope: DEFER (flag off) SALARY/payroll, group outings, training packages and expenses. KEEP QR enrollment, CSV import, platform admin, document reminders and payment claims. FOUNDER-APPROVED
Reason: PRD §5/§6 define payroll, advanced accounting and reporting as non-MVP; code contains SALARY, group outing, training package, expense, QR enrollment, CSV import, platform admin, document reminder and payment-claim features.
PRD sections amended: §5, §6
Follow-up work:

- [ ] flag off SALARY/payroll and related flows
- [ ] flag off group outings, training packages and expenses
- [ ] keep QR enrollment, CSV import, platform admin, document reminders and payment claims in scope

D4
Decision: D4 — SMS: Add env flag SMS_VERIFICATION_REQUIRED, default false for the pilot. Pilot schools are onboarded personally. Enable only after real KudiSMS delivery is proven. Password reset stays owner-assisted until then. FOUNDER-APPROVED
Reason: PRD §26.1 deferred OTP login to avoid SMS cost/dependency; code currently requires SMS verification at owner signup and SMS password reset via KudiSMS, still in mock mode with real delivery unproven.
PRD sections amended: §26.1
Follow-up work:

- [ ] add SMS_VERIFICATION_REQUIRED default false
- [ ] restrict pilot onboarding to personal enrollment
- [ ] require proven real KudiSMS delivery before enabling
- [ ] keep password reset owner-assisted until then

D5
Decision: D5 — Colour: FOLLOW the PRD: emerald-600 primary, rose-600 danger. Blue is retired. FOUNDER-APPROVED
Reason: PRD §15 primary colour is emerald-600 (#059669); code uses #0000FF.
PRD sections amended: §15
Follow-up work:

- [ ] set primary brand colour to emerald-600
- [ ] set danger colour to rose-600
- [ ] retire blue from the approved palette

D6
Decision: D6 — Chart: DROP the seven-day chart from MVP. Remove the README claim; delete the unused days/weekPaid code in Phase 4A. FOUNDER-APPROVED
Reason: README claims a seven-day chart; Dashboard.tsx never renders it and days/weekPaid are computed but unused.
PRD sections amended: MVP dashboard scope; README status note
Follow-up work:

- [ ] remove the seven-day chart from MVP
- [ ] remove the README claim
- [ ] delete unused days/weekPaid logic in Phase 4A

PRD v1.3 change log
D1: Fuel rule locked and post-MVP benchmark model parked behind a disabled flag.
D2: Training outings adopted as MVP bookings with idempotent commands and CONFLICT surfaced.
D3: SALARY, group outings, training packages and expenses deferred; QR, CSV, admin and claims retained.
D4: SMS verification gated by SMS_VERIFICATION_REQUIRED default false until KudiSMS proves delivery.
D5: Brand palette corrected to emerald-600 primary and rose-600 danger; blue retired.
D6: Seven-day chart removed from MVP and README/docs claim removed with unused code deleted in Phase 4A.
