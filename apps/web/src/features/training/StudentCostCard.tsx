import { moneyCents, sumMoney, type StudentTrainingSummary } from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

const amount = (value: string | undefined) =>
  value === undefined ? "Not available — refresh records" : naira(value);
export function StudentCostCard({ summary: s }: { summary: StudentTrainingSummary }) {
  const categories = [
    { label: "Fuel spent", value: s.fuelCost },
    { label: "Instructor cost", value: s.instructorCost },
    { label: "Other recorded costs", value: s.otherRecordedCost }
  ];
  const estimates =
    s.estimatedRemainingCost === undefined || s.otherEstimatedCost === undefined
      ? undefined
      : sumMoney([s.estimatedRemainingCost, s.otherEstimatedCost]);
  return (
    <article className="student-cost-card" aria-label={`Costs for ${s.name}`}>
      <h3>{s.name}</h3>
      <h4>Money</h4>
      <dl className="cost-money-grid">
        <div>
          <dt>Agreed fee</dt>
          <dd>{amount(s.fee)}</dd>
        </div>
        <div>
          <dt>Money received</dt>
          <dd>{amount(s.paid)}</dd>
        </div>
        <div>
          <dt>Still to pay</dt>
          <dd>{amount(s.balance)}</dd>
        </div>
      </dl>
      <h4>Training costs</h4>
      <dl className="cost-money-grid">
        {categories
          .filter((c) => c.value === undefined || moneyCents(c.value) !== 0n)
          .map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>{amount(c.value)}</dd>
            </div>
          ))}
        <div>
          <dt>Recorded costs so far</dt>
          <dd>{amount(s.costSoFar)}</dd>
        </div>
        {(estimates === undefined || estimates !== "0.00") && (
          <div>
            <dt>Estimated remaining costs</dt>
            <dd>{estimates === undefined ? "Estimate incomplete" : naira(estimates)}</dd>
          </div>
        )}
      </dl>
      <div className="cost-expected">
        <span>Expected money left</span>
        <strong>
          {s.expectedMargin === undefined ? "Cost estimate is incomplete" : naira(s.expectedMargin)}
        </strong>
      </div>
      {s.expectedMargin === undefined && (
        <p className="dm-notice">
          Check this month's instructor pay in School setup, then refresh these records. Missing pay
          can prevent an estimate for remaining lessons.
        </p>
      )}
      <details>
        <summary>View breakdown</summary>
        <dl className="cost-money-grid">
          {categories
            .filter((c) => c.value !== undefined && moneyCents(c.value) === 0n)
            .map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd>{amount(c.value)}</dd>
              </div>
            ))}
          <div>
            <dt>Estimated remaining lessons</dt>
            <dd>{amount(s.estimatedRemainingCost)}</dd>
          </div>
          <div>
            <dt>Other estimates</dt>
            <dd>{amount(s.otherEstimatedCost)}</dd>
          </div>
        </dl>
        <details>
          <summary>See how this was calculated</summary>
          <p>
            We start with the agreed fee and subtract recorded fuel, the instructor cost, other
            recorded costs, estimated remaining lessons and other estimates. Money received does not
            change this calculation.
          </p>
          <p>
            Estimated remaining costs above combine the remaining-lesson estimate and other
            estimates. They are not money already spent.
          </p>
          <p>
            Instructor cost is a share of monthly pay based on teaching time. It does not confirm
            that the salary has been paid. Remaining instructor costs use the current monthly pay
            settings.
          </p>
          <p>
            Fuel money issued for unfinished trips stays in the remaining-lesson estimate until the
            purchase is recorded. Fuel spent records purchases, not the fuel used by an individual
            student.
          </p>
          <p>
            Whole-school expenses are excluded. This estimate is not final business profit or a bank
            balance.
          </p>
          <p>
            Money received minus recorded costs: {amount(s.paymentsLessRecordedCosts)}. This is
            separate from expected money left.
          </p>
        </details>
      </details>
    </article>
  );
}
