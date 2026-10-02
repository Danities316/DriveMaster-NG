import { useId, useState, type FormEvent } from "react";
import {
  isValidStoredMoney,
  lagosDay,
  moneyCents,
  sumMoney,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";
import type { QueuedTraining } from "./trainingLocal";
import { fuelAccountability } from "./fuelAccountabilitySummary";

type Props = {
  snapshot: TrainingSnapshot;
  changes?: QueuedTraining[];
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
};
const display = (value: string | undefined) =>
  value !== undefined && isValidStoredMoney(value) ? naira(value) : "Not recorded";
function ReturnForm({
  due,
  disabled,
  onSave
}: {
  due: string;
  disabled: boolean;
  onSave: (amount: string, reason: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const errorId = useId();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled || busy || saved) return;
    const form = e.currentTarget;
    const input = form.elements.namedItem("amount") as HTMLInputElement;
    const data = new FormData(form),
      amount = String(data.get("amount") ?? "");
    if (!isValidStoredMoney(amount, true) || moneyCents(amount) > moneyCents(due)) {
      setError(
        isValidStoredMoney(amount, true)
          ? "Money returned cannot be more than the unspent fuel money."
          : "Enter an amount greater than ₦0, with no more than two decimal places."
      );
      input.focus();
      return;
    }
    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) {
      setError("Enter a return note or receipt reference.");
      (form.elements.namedItem("reason") as HTMLInputElement).focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(amount, reason);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your entries are still here. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="training-form fuel-return-form" onSubmit={(e) => void submit(e)} noValidate>
      <h4>How much money was returned?</h4>
      <p>
        Still to return: {naira(due)}. Enter only the money received now, not the total already
        returned.
      </p>
      <label>
        Money returned (₦)
        <input
          name="amount"
          type="number"
          inputMode="decimal"
          min="0.01"
          max={due}
          step="0.01"
          required
          aria-describedby={error ? errorId : undefined}
          onChange={() => setError("")}
        />
      </label>
      <label>
        Return note or receipt reference
        <input name="reason" required maxLength={500} />
      </label>
      {error && (
        <p id={errorId} className="fleet-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p role="status">
          Return saved on this device. Waiting to be sent. Do not enter this return again.
        </p>
      )}
      <button className="dm-primary" disabled={disabled || busy || saved}>
        {busy ? "Saving…" : "Record return"}
      </button>
    </form>
  );
}
export function FuelAccountability({ snapshot, changes = [], pending, onSave }: Props) {
  if (snapshot.viewerRole !== "OWNER") return null;
  const queue = changes.filter(
    (q) =>
      q.schoolId === snapshot.schoolId &&
      q.userId === snapshot.userId &&
      q.role === snapshot.viewerRole
  );
  const name = (id: string) => snapshot.students.find((s) => s.id === id)?.name ?? "Student";
  const rows = snapshot.outings
    .filter(
      (o) =>
        o.data.fuelIssued !== undefined ||
        o.data.status === "STARTED" ||
        o.data.status === "COMPLETED" ||
        queue.some((q) => q.targetId === o.id && q.action === "START")
    )
    .map((record) => ({
      record,
      balance: fuelAccountability(record.data),
      changes: queue.filter((q) => q.targetId === record.id),
      pending: pending(record.id)
    }));
  rows.sort(
    (a, b) =>
      Number(b.pending || !["ACCOUNTED", "IN_PROGRESS"].includes(b.balance.state)) -
        Number(a.pending || !["ACCOUNTED", "IN_PROGRESS"].includes(a.balance.state)) ||
      b.record.data.plannedStart.localeCompare(a.record.data.plannedStart)
  );
  const known = rows.filter((r) => ["DUE", "ACCOUNTED", "OVERSPENT"].includes(r.balance.state));
  const attention = rows.filter(
    (r) => r.pending || !["ACCOUNTED", "IN_PROGRESS"].includes(r.balance.state)
  ).length;
  return (
    <section className="fuel-accountability" aria-label="Fuel money accountability">
      <h3>What happened to the fuel money?</h3>
      <p>
        Amounts below are from the school's last loaded records. Saved changes are shown separately.
      </p>
      {!!rows.length && (
        <div className="fuel-overview">
          <p>
            <strong>
              {attention} {attention === 1 ? "trip needs" : "trips need"} attention
            </strong>
          </p>
          {known.length > 0 && (
            <p>
              Known money still to return
              <strong>{naira(sumMoney(known.map((r) => r.balance.due!)))}</strong>
            </p>
          )}
          <p>
            Return total covers completed trips with reported spending and complete amounts only. It
            excludes unfinished or incomplete trips, older allowance-based records and unsent
            changes. Overspending does not reduce money due on other trips.
          </p>
        </div>
      )}
      {!rows.length && (
        <p>
          No fuel money recorded yet. Trips appear here after fuel money is given at the start of
          training.
        </p>
      )}
      {rows.map(({ record, balance: b, changes: local, pending: waiting }) => {
        const o = record.data,
          legacy = b.state === "LEGACY";
        return (
          <article
            key={record.id}
            className={`fuel-accountability-card ${waiting || ["DUE", "OVERSPENT", "INCOMPLETE", "LEGACY"].includes(b.state) ? "fuel-attention" : ""}`}
            aria-label={`Fuel money for ${o.members.map((m) => name(m.studentId)).join(" and ")}`}
          >
            <h4>{o.members.map((m) => name(m.studentId)).join(" and ")}</h4>
            <p>
              {lagosDay(o.startedAt ?? o.plannedStart)} ·{" "}
              {snapshot.instructors.find((i) => i.id === o.instructorId)?.name ?? "Instructor"} ·{" "}
              {snapshot.vehicles.find((v) => v.id === o.vehicleId)?.plateNumber ?? "Vehicle"}
            </p>
            <dl className="fuel-money-chain">
              <div>
                <dt>Fuel money given</dt>
                <dd>{display(o.fuelIssued)}</dd>
              </div>
              <div>
                <dt>Fuel bought</dt>
                <dd>
                  {o.status !== "COMPLETED" ? "Training not finished" : display(o.fuelSpent)}
                  {legacy && " (allowance-based record)"}
                </dd>
              </div>
              <div>
                <dt>Should return</dt>
                <dd>{b.shouldReturn === undefined ? "Not yet known" : naira(b.shouldReturn)}</dd>
              </div>
              <div>
                <dt>Returned</dt>
                <dd>{display(o.fuelReturned)}</dd>
              </div>
            </dl>
            {waiting && (
              <p className="dm-notice" role="status">
                {local.some((q) => q.status === "FAILED")
                  ? "A saved change needs attention. Open Saved training records above."
                  : "Saved on this device. Waiting to be sent."}{" "}
                These amounts have not been updated with that change.
              </p>
            )}
            {b.state === "IN_PROGRESS" && (
              <p>Finish training to check fuel spending and money to return.</p>
            )}
            {b.state === "INCOMPLETE" && (
              <p className="dm-notice">
                <strong>Fuel information incomplete</strong>. Refresh training records and check the
                trip's fuel details.
              </p>
            )}
            {legacy && (
              <p className="dm-notice">
                Older record: spending was based on the stored allowance. It does not confirm an
                actual fuel purchase. Check the supporting records.
              </p>
            )}
            {b.overspend && (
              <p className="dm-notice">
                <strong>Fuel cost was {naira(b.overspend)} more than the money given.</strong> Check
                how the extra purchase was funded.
              </p>
            )}
            {b.due !== undefined && moneyCents(b.due) > 0n && (
              <p className="dm-notice">
                <strong>{naira(b.due)} still to return</strong>
                {waiting
                  ? " in the last loaded records."
                  : legacy
                    ? " based on the older record."
                    : "."}
              </p>
            )}
            {b.state === "ACCOUNTED" && !waiting && <p>✓ Fuel money accounted for</p>}
            {o.status === "COMPLETED" &&
              o.fuelSpendingBasis === "REPORTED" &&
              o.fuelSpent !== undefined &&
              isValidStoredMoney(o.fuelSpent) &&
              moneyCents(o.fuelSpent) === 0n && <p>No fuel was bought during this trip.</p>}
            {b.due !== undefined && moneyCents(b.due) > 0n && (
              <details>
                <summary>Record return</summary>
                <ReturnForm
                  key={`${record.version}-${waiting}`}
                  due={b.due}
                  disabled={waiting}
                  onSave={(amount, reason) =>
                    onSave("RETURN_FUEL", record.id, { amount, reason }, record.version)
                  }
                />
              </details>
            )}
            <details>
              <summary>View fuel details</summary>
              <p>
                Stored fuel money per student: {display(o.fuelPerStudent)}. {o.allowanceReason}
              </p>
              <p>
                Trip mileage: {o.startOdometer ?? "Not recorded"} to{" "}
                {o.endOdometer ?? "Not recorded"} km.
              </p>
              {o.fuelLogId ? (
                <p>
                  The purchase receipt, litres, purchase time, mileage and full-tank details are
                  available in Mileage &amp; fuel for this vehicle.
                </p>
              ) : (
                <p>No linked fuel purchase record is available for this trip.</p>
              )}
              <p>
                This is the whole trip's fuel purchase. Each student's share remains in their
                training cost breakdown; it is not a separate purchase.
              </p>
              {o.fuelReturnReason && <p>Latest accepted return note: {o.fuelReturnReason}</p>}
              <p>Returned is the total of accepted returns. A later return adds to that total.</p>
            </details>
          </article>
        );
      })}
    </section>
  );
}
