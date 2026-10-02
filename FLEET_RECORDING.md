# Mileage, fuel claims and consumption

Owners and receptionists can open **Mileage & fuel**, register a vehicle and record mileage or fuel claims. Record every refill with its date/time, odometer, litres, total cost, receipt reference and whether the tank was filled completely. Claims are append-only; recording does not approve payment.

## Local setup

From `review-source`, after configuring your existing API database:

```powershell
npm run prisma:generate --workspace=apps/api
npm exec --workspace=apps/api -- prisma migrate deploy
npm run build:shared
```

Restart the API and frontend. The fleet recording migration is `20260921000000_fleet_recording`. Benchmark configuration additionally requires `20260922000000_fuel_benchmarks`; the deploy command applies all outstanding migrations. No changes to your application database or `.env` were made when adding consumption calculations.

## Calculation

For each vehicle, sort its fuel records by actual timestamp. The first full tank establishes the baseline. The next full tank closes the cycle and becomes the baseline for the next cycle.

- Distance = closing odometer minus opening odometer.
- Fuel = all litres purchased after the opening fill through and including the closing fill. Partial refills count; the opening fill does not.
- L/100 km = fuel / distance × 100.
- km/L = distance / fuel.
- Refill cost/km = total cost of those same refills / distance. This is purchase cost allocation, not the inventory value of fuel consumed.

Example: full at 1,000 km, partial refill of 10 L, then full at 1,500 km with 20 L. The cycle covers 500 km using 30 L: **6.00 L/100 km** and **16.67 km/L**.

Quantities and costs are summed in integer hundredths; derived ratios are rounded only for display. Cycles are calculated independently by vehicle and school. Backdated synchronized fills automatically update the results. Results work offline using the synchronized records available on that device; synchronize first for the latest history.

## When results are withheld

Pending, failed or conflicting fuel records interrupt a cycle instead of being silently omitted. Unknown legacy tank levels, invalid quantities/costs, decreasing odometers and ambiguous equal-time fills also interrupt calculations. Undated records prevent calculation for that vehicle. A new valid full tank establishes a fresh baseline. Zero-distance and unfinished cycles show no efficiency result.

Record every refill: the app cannot detect an entirely unrecorded purchase. Figures are estimates based on recorded full-tank declarations, not proof of fuel use or claim legitimacy. In-app discrepancy flags are implemented; external notifications, claim approval, receipt image uploads and corrections are not implemented.

Recording validates whole nonnegative odometers against mileage and fuel history, positive decimal quantities/costs, duplicate references and tenant/staff permissions. Server transactions serialize conflicting writes and audit the authenticated recorder. The entered driver name is self-reported. Future timestamps allow five minutes of clock skew.

## Vehicle benchmarks and discrepancy flags

1. Sign in as an owner, open **Mileage & fuel**, select a synchronized vehicle and choose **Set benchmark**.
2. Enter the expected minimum and maximum L/100 km, an additional lesson/idling allowance percentage, and the basis for your figures. No manufacturer benchmark is assumed. The range must be positive, ordered and at most 999.99 L/100 km; allowance is 0–100%. Values accept two decimals.
3. Save and synchronize. Receptionists can view the saved benchmark and flags but cannot change settings. Pending proposals never change the displayed assessment.

The high-consumption threshold is **maximum × (1 + allowance / 100)**. A 5–10 L/100 km range with a 20% allowance flags consumption strictly above 12 L/100 km. At 75 L over 500 km, consumption is 15 L/100 km: 25% above the limit and 15 L above the allowance for that distance. The exact boundary is compared before display rounding; a value exactly at the limit is not flagged.

The cycle table shows the measured consumption, applicable limit, percentage over and excess litres. **Show flagged cycles only** filters high-consumption cycles. Below-minimum cycles carry a separate prompt to check missing refills or benchmark suitability. Unconfigured vehicles are explicitly unassessed, not marked healthy. Incomplete and uncertain cycles remain excluded under the calculation rules above.

Assessments use the **current saved benchmark**, including for historical cycles. Updating a benchmark or synchronizing backdated fills recalculates the displayed results. Flags belong to a cycle, not an individual claim or driver. They do not update the legacy `FuelLog.discrepancyAlert` column, approve/reject claims or send external notifications.

Benchmark writes are owner-only, school-scoped, version-checked, deduplicated and audited with before/after settings. Concurrent stale proposals become conflicts. Synchronize to load the latest settings, discard a failed/conflicting local proposal using the benchmark panel, then edit again. An ordinary pending proposal cannot be discarded while it may be uploading. Only one local proposal per vehicle is allowed at a time. As with fuel recording, direct database edits bypass the application change journal.
