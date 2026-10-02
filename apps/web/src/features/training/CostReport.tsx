import { FuelAccountability } from "./FuelAccountability";
import type { QueuedTraining } from "./trainingLocal";
import { sumMoney, subtractMoney, type TrainingSnapshot } from "@drivemaster/shared";
import { StudentCostCard } from "./StudentCostCard";
import { ExpenseForm } from "./ExpenseForm";
import { EntryForm, Field } from "./TrainingFields";
import { naira } from "../dashboard/dashboardData";
export function CostReport({
  snapshot,
  changes,
  pending,
  onSave
}: {
  snapshot: TrainingSnapshot;
  changes?: QueuedTraining[];
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  if (snapshot.viewerRole !== "OWNER") return null;
  if (snapshot.expenses === undefined)
    return (
      <section className="dm-panel training-panel cost-report">
        <h2>Costs and expenses</h2>
        <p>Refresh training records to load the updated cost report.</p>
      </section>
    );
  const name = (id: string) => snapshot.students.find((s) => s.id === id)?.name ?? "Student";
  const liveExpenses = (snapshot.expenses ?? []).filter((e) => !e.data.voidReason);
  const unallocated = (basis: string) =>
    sumMoney(
      liveExpenses
        .filter((e) => e.data.basis === basis && !e.data.allocations.length)
        .map((e) => e.data.amount)
    );
  const fees = sumMoney(snapshot.summaries.map((s) => s.fee));
  const received = sumMoney(snapshot.summaries.map((s) => s.paid));
  const recorded = snapshot.summaries.some((s) => s.costSoFar === undefined)
    ? undefined
    : sumMoney(snapshot.summaries.map((s) => s.costSoFar!));
  return (
    <section className="dm-panel training-panel cost-report">
      <h2>Costs and expenses</h2>
      <p>
        All-time totals for students with training packages. Only accepted records are included.
        Payments received are shown separately from agreed fees.
      </p>
      <p>
        This is an estimate based on agreed fees and recorded or estimated training costs. It is not
        final business profit or a bank balance.
      </p>
      <div className="student-cost-list">
        {snapshot.summaries.map((s) => (
          <StudentCostCard key={s.studentId} summary={s} />
        ))}
      </div>
      {!snapshot.summaries.length && (
        <p>
          No student cost summaries yet. Students appear here after they have a training package.
          Fuel and instructor costs are added when training is recorded.
        </p>
      )}
      <details>
        <summary>Totals for students with training packages</summary>
        <dl className="cost-money-grid">
          <div>
            <dt>Agreed fees</dt>
            <dd>{naira(fees)}</dd>
          </div>
          <div>
            <dt>Money received</dt>
            <dd>{naira(received)}</dd>
          </div>
          <div>
            <dt>Recorded costs assigned to students</dt>
            <dd>{recorded === undefined ? "Not available — refresh records" : naira(recorded)}</dd>
          </div>
          <div>
            <dt>Money received minus recorded costs</dt>
            <dd>
              {recorded === undefined
                ? "Not available — refresh records"
                : naira(subtractMoney(received, recorded))}
            </dd>
          </div>
        </dl>
        <p>
          These totals exclude whole-school expenses. Money received minus recorded costs is
          separate from expected money left.
        </p>
      </details>
      <details>
        <summary>Whole-school costs</summary>
        <p>
          These expenses are not shared with students, so they are excluded from student costs and
          expected money left.
        </p>
        <p>
          Recorded costs: {naira(unallocated("RECORDED"))}. Estimates:{" "}
          {naira(unallocated("ESTIMATE"))}.
        </p>
      </details>
      {!snapshot.expenses.length && (
        <div>
          <h3>No other expenses recorded</h3>
          <p>
            Fuel purchases and instructor cost shares appear through training records. Add other
            costs here; avoid adding fuel or instructor pay already included in a lesson.
          </p>
        </div>
      )}
      <details>
        <summary>Add expense</summary>
        <p>Avoid adding fuel or instructor pay already included in a lesson.</p>
        <ExpenseForm snapshot={snapshot} onSave={onSave} />
      </details>
      <details>
        <summary>Expense history ({snapshot.expenses?.length ?? 0})</summary>
        {[...(snapshot.expenses ?? [])]
          .sort((a, b) => b.data.date.localeCompare(a.data.date))
          .map((e) => (
            <article key={e.id} className="training-summary">
              <h3>
                {e.data.category} — {naira(e.data.amount)}
              </h3>
              <p>
                {e.data.date} · {e.data.basis === "ESTIMATE" ? "Estimate" : "Recorded cost"} ·{" "}
                {e.data.allocations.length
                  ? e.data.allocations
                      .map((a) => `${name(a.studentId)}: ${naira(a.amount)}`)
                      .join("; ")
                  : "Whole-school expense"}
              </p>
              <p>{e.data.reason}</p>
              {e.data.voidReason ? (
                <p>Cancelled: {e.data.voidReason}</p>
              ) : (
                <details>
                  <summary>Cancel expense</summary>
                  <p>
                    Cancel the incorrect entry, then add a corrected entry. The original stays in
                    the history.
                  </p>
                  <EntryForm
                    title="Cancel expense"
                    disabled={pending(e.id)}
                    onSave={(f) =>
                      onSave(
                        "VOID_EXPENSE",
                        e.id,
                        { reason: String(f.get("reason") ?? "") },
                        e.version
                      )
                    }
                  >
                    <Field label="Tell us why this record is being cancelled" name="reason" />
                  </EntryForm>
                </details>
              )}
            </article>
          ))}
      </details>
      <details>
        <summary>Fuel money to account for</summary>
        <FuelAccountability
          snapshot={snapshot}
          changes={changes}
          pending={pending}
          onSave={onSave}
        />
      </details>
    </section>
  );
}
