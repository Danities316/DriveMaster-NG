import { useRef, useState, type FormEvent } from "react";
import type { AuthenticatedUser, OutboxMutationRecord, Vehicle } from "@drivemaster/shared";
import { discardFuelBenchmarkProposal, saveFuelBenchmark } from "./benchmarkService";

export function FuelBenchmarkPanel({
  user,
  vehicle,
  pending
}: {
  user: AuthenticatedUser;
  vehicle: Vehicle;
  pending?: OutboxMutationRecord;
}) {
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const benchmark = vehicle.fuelBenchmark;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    try {
      await saveFuelBenchmark(user, vehicle.id, Object.fromEntries(values), version);
      setEditing(false);
      setMessage(
        "Fuel limit saved on this device. It will be used after it reaches your school’s account."
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the fuel limit.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function discard() {
    if (!pending || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await discardFuelBenchmarkProposal(user, pending.mutationId);
      setMessage(
        "Unsent fuel limit removed. Connect to the internet to load the latest saved limit."
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to discard proposal.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="dm-panel fleet-form-panel" aria-labelledby="benchmark-title">
      <h2 id="benchmark-title">Expected fuel use · {vehicle.plateNumber}</h2>
      {benchmark ? (
        <p className="fleet-benchmark-summary">
          Expected {benchmark.minimum}–{benchmark.maximum} L/100 km, plus{" "}
          {benchmark.allowancePercent}% lesson / idling allowance.
          <strong className="fleet-detail">
            Flag above{" "}
            {(Number(benchmark.maximum) * (1 + Number(benchmark.allowancePercent) / 100)).toFixed(
              4
            )}{" "}
            L/100 km
          </strong>
          <span className="fleet-detail">Reason: {benchmark.notes}</span>
        </p>
      ) : (
        <p>No fuel limit yet. The owner can set one so the app knows when fuel use is too high.</p>
      )}
      <p className="fleet-consumption-help">
        L/100 km means litres of fuel used to travel 100 kilometres. These limits are used to check
        both new and older fuel records. Choose figures that suit this vehicle and your lessons. A
        warning asks you to check the records; it does not approve or reject a claim.
      </p>
      {pending && (
        <div className="dm-notice">
          <strong>
            {["FAILED", "CONFLICT"].includes(pending.status)
              ? `${pending.action === "CREATE" ? "Vehicle registration" : "Fuel limit"} needs attention`
              : `${pending.action === "CREATE" ? "Vehicle registration" : "Fuel limit"} waiting to be sent`}
          </strong>
          <p>
            {["FAILED", "CONFLICT"].includes(pending.status)
              ? "This saved change could not be accepted. Open Saved records to review it."
              : "Saved on this device. DriveMaster will try to send it when possible. Fuel checks still use the last accepted limit."}
          </p>
          {pending.lastError && (
            <details>
              <summary>Technical details</summary>
              <p>{pending.lastError}</p>
            </details>
          )}
          {user.role === "OWNER" &&
            pending.action === "UPDATE" &&
            ["FAILED", "CONFLICT"].includes(pending.status) && (
              <button
                className="dm-secondary"
                type="button"
                disabled={busy}
                onClick={() => void discard()}
              >
                Remove this saved fuel limit change
              </button>
            )}
        </div>
      )}
      {user.role === "OWNER" && !editing && (
        <button
          className="dm-secondary"
          disabled={!!pending || busy}
          onClick={() => {
            setVersion(vehicle.benchmarkVersion ?? 0);
            setEditing(true);
            setError("");
            setMessage("");
          }}
        >
          {benchmark ? "Change expected fuel use" : "Set expected fuel use"}
        </button>
      )}
      {editing && (
        <form className="fleet-form" onSubmit={(event) => void save(event)}>
          <label>
            Minimum L/100 km
            <input
              name="minimum"
              type="number"
              min="0.01"
              max="999.99"
              step="0.01"
              required
              defaultValue={benchmark?.minimum ?? ""}
            />
          </label>
          <label>
            Maximum L/100 km
            <input
              name="maximum"
              type="number"
              min="0.01"
              max="999.99"
              step="0.01"
              required
              defaultValue={benchmark?.maximum ?? ""}
            />
          </label>
          <label>
            Lesson / idling allowance (%)
            <input
              name="allowancePercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              defaultValue={benchmark?.allowancePercent ?? "0"}
            />
            <small>
              Extra room for lessons and time with the engine running. For example, 10 litres plus
              20% gives a limit of 12 litres per 100 km.
            </small>
          </label>
          <label className="fleet-wide">
            Why did you choose these figures?
            <textarea
              name="notes"
              required
              maxLength={500}
              rows={3}
              defaultValue={benchmark?.notes ?? ""}
              placeholder="For example: based on our past fuel records, with extra fuel allowed for lessons."
            />
          </label>
          <div className="fleet-actions fleet-wide">
            <button className="dm-primary" disabled={busy || !!pending} type="submit">
              {busy ? "Saving…" : "Save fuel limit"}
            </button>
            <button
              className="dm-secondary"
              disabled={busy}
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="fleet-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="fleet-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
