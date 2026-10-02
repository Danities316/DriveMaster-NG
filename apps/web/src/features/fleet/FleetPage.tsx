import { FuelUsageCards } from "./FuelUsageCards";
import { FuelBenchmarkPanel } from "./FuelBenchmarkPanel";
import { assessFuelConsumption, calculateFuelConsumption } from "@drivemaster/shared";
import { useRef, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Car, Fuel, Gauge, Plus } from "lucide-react";
import type { AuthenticatedUser, FleetEntity } from "@drivemaster/shared";
import { db } from "../../db/db";
import { recordFleet } from "./fleetService";
import { naira } from "../dashboard/dashboardData";
import "./fleet.css";

const localTime = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const savedRecordError = (message: string) => {
  if (/401|403|unauthor|forbidden|sign.?in|session|token/i.test(message))
    return "Sign in again, then try to send this record.";
  if (/conflict|version|already|changed/i.test(message))
    return "The school record changed. Review this saved record before trying again.";
  return "This saved record needs attention before it can be sent.";
};
export function FleetPage({ user }: { user: AuthenticatedUser }) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [form, setForm] = useState<FleetEntity | null>(null);
  const [recordId, setRecordId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const data = useLiveQuery(async () => {
    const [vehicles, mileage, fuel, queue, training] = await Promise.all([
      db.vehicles.where("schoolId").equals(user.schoolId).toArray(),
      db.mileageLogs.where("schoolId").equals(user.schoolId).toArray(),
      db.fuelLogs.where("schoolId").equals(user.schoolId).toArray(),
      db.outbox.where("schoolId").equals(user.schoolId).toArray(),
      db.trainingCache.get(user.id)
    ]);
    return {
      vehicles: vehicles.sort((a, b) => a.plateNumber.localeCompare(b.plateNumber)),
      mileage,
      fuel,
      queue,
      tripFuelIds: new Set(
        training?.schoolId === user.schoolId &&
          training.snapshot.userId === user.id &&
          training.snapshot.viewerRole === user.role
          ? training.snapshot.outings.map((o) => o.data.fuelLogId).filter(Boolean)
          : []
      )
    };
  }, [user.schoolId, user.id, user.role]);
  function open(next: FleetEntity) {
    setError("");
    setMessage("");
    setRecordId(crypto.randomUUID());
    setForm(next);
    requestAnimationFrame(() => {
      const heading = document.getElementById("fleet-record-title");
      heading?.scrollIntoView?.({ block: "nearest" });
      heading?.focus();
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "");
    try {
      if (form === "fuel_log" && !["yes", "no"].includes(value("fullTank")))
        throw new Error("Choose whether the tank was filled completely.");
      const payload =
        form === "vehicle"
          ? { id: recordId, plateNumber: value("plateNumber"), model: value("model") }
          : {
              id: recordId,
              vehicleId,
              date: new Date(value("date")).toISOString(),
              odometer: Number(value("odometer")),
              driverName: value("driverName"),
              notes: value("notes"),
              ...(form === "fuel_log"
                ? {
                    litres: value("litres"),
                    cost: value("cost"),
                    receiptReference: value("receiptReference"),
                    fullTank: value("fullTank") === "yes"
                  }
                : {})
            };
      await recordFleet(user, form, payload);
      if (form === "vehicle") setVehicleId(recordId);
      setMessage("Saved on this device. Waiting to be sent.");
      setForm(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save. Your form has been kept."
      );
    } finally {
      if (form) requestAnimationFrame(() => document.getElementById("fleet-record-error")?.focus());
      saving.current = false;
      setBusy(false);
    }
  }
  if (!["OWNER", "RECEPTIONIST"].includes(user.role))
    return <p>You do not have access to vehicle recording.</p>;
  if (!data)
    return (
      <p className="dashboard-loading" role="status">
        Loading vehicle records…
      </p>
    );
  const queue = new Map(data.queue.map((row) => [row.mutationId, row]));
  const intervals = calculateFuelConsumption(
    data.fuel,
    user.schoolId,
    new Set(queue.keys())
  ).filter((row) => !vehicleId || row.vehicleId === vehicleId);
  const assessed = intervals.map((cycle) => ({
    ...cycle,
    assessment: assessFuelConsumption(
      cycle,
      data.vehicles.find((vehicle) => vehicle.id === cycle.vehicleId)?.fuelBenchmark
    )
  }));
  const flagged = assessed.filter((cycle) => cycle.assessment.status === "above_limit");
  const selected = data.vehicles.find((row) => row.id === vehicleId);
  const history = [
    ...data.mileage.map((row) => ({ ...row, kind: "Mileage" as const })),
    ...data.fuel.map((row) => ({ ...row, kind: "Fuel claim" as const }))
  ]
    .filter((row) => !vehicleId || row.vehicleId === vehicleId)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const latestReading = history[0];
  const status = (id: string) => {
    const pending = queue.get(id);
    return pending
      ? pending.status === "CONFLICT" || pending.status === "FAILED"
        ? "Needs attention"
        : "Waiting to be sent"
      : "Confirmed";
  };
  return (
    <div className="dashboard-content fleet-page">
      <div className="dashboard-heading">
        <div>
          <p className="dm-eyebrow">VEHICLE RECORDS</p>
          <h1>Mileage & fuel</h1>
          <p>Track vehicle mileage, fuel purchases and fuel usage.</p>
        </div>
        <button className="dm-primary" onClick={() => open("vehicle")}>
          <Plus size={17} />
          Register vehicle
        </button>
      </div>
      <div className="dm-notice">
        Fuel purchases saved through Finish training already appear here. Do not record them again.
        Saved mileage and fuel records cannot be edited or deleted. Recording a fuel purchase does
        not approve payment. After your records are sent, the app checks fuel use against the limit
        set for each vehicle.
      </div>
      <section className="dm-panel fleet-controls">
        <label htmlFor="fleet-vehicle">Vehicle</label>
        <select
          id="fleet-vehicle"
          value={vehicleId}
          onChange={(event) => {
            setVehicleId(event.target.value);
            setForm(null);
            setError("");
          }}
        >
          <option value="">All vehicles</option>
          {data.vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.plateNumber} · {vehicle.model} · {status(vehicle.id)}
            </option>
          ))}
        </select>
        <div className="fleet-actions">
          <button
            className="dm-secondary"
            disabled={!selected || selected.status === "INACTIVE"}
            onClick={() => open("mileage_log")}
          >
            <Gauge size={17} />
            Record mileage
          </button>
          <button
            className="dm-secondary"
            disabled={!selected || selected.status === "INACTIVE"}
            onClick={() => open("fuel_log")}
          >
            <Fuel size={17} />
            Record fuel
          </button>
        </div>
        <p>
          {selected
            ? `${selected.model} · ${selected.plateNumber} · ${selected.status.toLowerCase()}`
            : data.vehicles.length
              ? "Select a vehicle to record mileage or a fuel purchase."
              : "Register your first vehicle to start recording."}
        </p>
      </section>
      <section className="dm-panel" aria-labelledby="consumption-title">
        <div className="panel-heading">
          <div>
            <h2 id="consumption-title">Vehicle fuel usage</h2>
            <p>
              Check the latest completed periods for each vehicle. Open a calculation for the
              supporting figures.
            </p>
          </div>
        </div>
        <div className="fleet-review-summary">
          {flagged.length > 0 && (
            <strong>{flagged.length} completed period(s) need checking for high fuel use</strong>
          )}
          <label>
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(event) => setFlaggedOnly(event.target.checked)}
            />{" "}
            Show only high fuel use
          </label>
          <p>
            Check the mileage, fuel purchases and driving conditions. A high reading is not proof of
            a false claim. New fuel limits are used only after they have been sent.
          </p>
        </div>
        <FuelUsageCards
          vehicles={data.vehicles.filter((v) => !vehicleId || v.id === vehicleId)}
          cycles={intervals}
          flaggedOnly={flaggedOnly}
          fuel={data.fuel}
          unconfirmedIds={new Set(queue.keys())}
        />
      </section>
      {selected && (
        <details className="fleet-benchmark-details">
          <summary>Expected fuel use settings</summary>

          <FuelBenchmarkPanel
            key={selected.id}
            user={user}
            vehicle={selected}
            pending={data.queue.find(
              (entry) =>
                entry.entity === "vehicle" && (entry.payload as { id?: string }).id === selected.id
            )}
          />
        </details>
      )}
      {message && (
        <p className="fleet-success" role="status">
          {message}
        </p>
      )}
      {form && (
        <section className="dm-panel fleet-form-panel">
          <h2 id="fleet-record-title" tabIndex={-1}>
            {form === "vehicle"
              ? "Register vehicle"
              : form === "mileage_log"
                ? "Record mileage"
                : "Record fuel"}
          </h2>
          <form
            onSubmit={(event) => void save(event)}
            key={`${form}-${recordId}`}
            className="fleet-form"
            aria-describedby={error ? "fleet-record-error" : undefined}
          >
            {form !== "vehicle" && (
              <p className="fleet-wide">
                <strong>
                  Vehicle: {selected?.model} / {selected?.plateNumber}
                </strong>
              </p>
            )}
            {form === "vehicle" ? (
              <>
                <label>
                  Registration number
                  <input
                    name="plateNumber"
                    required
                    maxLength={30}
                    placeholder="e.g. ABC-123-XY"
                    autoFocus
                  />
                </label>
                <label>
                  Vehicle model
                  <input name="model" required maxLength={100} placeholder="e.g. Toyota Corolla" />
                </label>
              </>
            ) : (
              <>
                {form === "fuel_log" && (
                  <>
                    <label>
                      How much did the fuel cost? (₦)
                      <input
                        name="cost"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="9999999999.99"
                        step="0.01"
                        required
                      />
                    </label>
                    <label>
                      How many litres?
                      <input
                        name="litres"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max="999999.99"
                        step="0.01"
                        required
                      />
                    </label>
                  </>
                )}
                <label>
                  Current mileage (km)
                  <input
                    name="odometer"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="2147483647"
                    step="1"
                    required
                    placeholder="Whole kilometres"
                  />
                  {latestReading && (
                    <small>
                      Last recorded: {latestReading.odometer.toLocaleString()} km /{" "}
                      {status(latestReading.id)}. Enter the reading you see on the vehicle.
                    </small>
                  )}
                </label>
                {form === "fuel_log" && (
                  <>
                    <label>
                      Receipt / claim reference
                      <input name="receiptReference" required maxLength={100} />
                      <small>
                        Use the receipt number or a unique reference for this claim. No receipt
                        image upload yet.
                      </small>
                    </label>
                    <label>
                      Was the tank filled completely?
                      <select name="fullTank" required defaultValue="">
                        <option value="" disabled>
                          Choose an option
                        </option>
                        <option value="yes">Yes — full tank</option>
                        <option value="no">No — partial fill</option>
                      </select>
                      <small>This helps DriveMaster calculate fuel usage between fill-ups.</small>
                    </label>
                  </>
                )}
                <label>
                  Date and time
                  <input
                    name="date"
                    type="datetime-local"
                    step="1"
                    required
                    defaultValue={localTime()}
                  />
                  <small>Uses this device’s local timezone.</small>
                </label>
                <label>
                  Driver / instructor name
                  <input name="driverName" required maxLength={120} defaultValue={user.name} />
                </label>
                <label className="fleet-wide">
                  Notes (optional)
                  <textarea name="notes" maxLength={500} rows={3} />
                </label>
              </>
            )}
            {error && (
              <p
                id="fleet-record-error"
                role="alert"
                className="fleet-error fleet-wide"
                tabIndex={-1}
              >
                {error}
              </p>
            )}
            <div className="fleet-actions fleet-wide">
              <button className="dm-primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save record"}
              </button>
              <button
                className="dm-secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setForm(null);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {data.vehicles.some((row) => queue.get(row.id)?.lastError) && (
        <div className="dm-notice">
          A vehicle registration needs attention. Open Saved records before recording against that
          vehicle.
        </div>
      )}
      <section className="dm-panel">
        <div className="panel-heading">
          <div>
            <h2>Recording history</h2>
            <p>
              {vehicleId
                ? "Mileage readings and fuel purchases for the selected vehicle"
                : "Mileage readings and fuel purchases across your school"}
            </p>
          </div>
          <Car size={20} />
        </div>
        {history.length ? (
          <div className="fleet-history-cards">
            {history.map((row) => (
              <article key={`${row.kind}-${row.id}`} className="fleet-history-card">
                <h3>
                  {data.vehicles.find((v) => v.id === row.vehicleId)?.plateNumber ??
                    "Unknown vehicle"}{" "}
                  / {row.kind}
                </h3>
                <p>
                  {new Date(row.date).toLocaleString("en-NG", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Africa/Lagos"
                  })}
                </p>
                <p>
                  {row.kind === "Fuel claim" ? (
                    <>
                      {naira(row.cost)} / {row.litres} L
                    </>
                  ) : (
                    <>{row.odometer.toLocaleString()} km</>
                  )}
                </p>
                <span
                  className={`payment-badge ${status(row.id) === "Confirmed" ? "confirmed" : "pending"}`}
                >
                  {status(row.id)}
                </span>
                {queue.get(row.id)?.lastError && (
                  <div className="fleet-error">
                    <p>{savedRecordError(queue.get(row.id)!.lastError!)}</p>
                    <details>
                      <summary>Technical details</summary>
                      <p>{queue.get(row.id)!.lastError}</p>
                    </details>
                  </div>
                )}
                <details>
                  <summary>View record details</summary>
                  <p>
                    Mileage: {row.odometer.toLocaleString()} km /{" "}
                    {row.driverName || "Driver not recorded (legacy)"}
                  </p>
                  {row.kind === "Fuel claim" && (
                    <p>
                      {row.fullTank == null
                        ? "Tank level unknown"
                        : row.fullTank
                          ? "Full tank"
                          : "Partial fill"}{" "}
                      / {row.receiptReference || "No reference (legacy)"}
                    </p>
                  )}
                  {row.kind === "Fuel claim" && (
                    <p>
                      {data.tripFuelIds.has(row.id)
                        ? "Recorded from training. Do not enter this purchase again."
                        : "No training link in the loaded records."}
                    </p>
                  )}
                  {row.notes && <p className="fleet-notes">{row.notes}</p>}
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty">
            <Gauge size={30} />
            <h3>No mileage or fuel records yet</h3>
            <p>Select a vehicle to save its first mileage reading or fuel purchase.</p>
          </div>
        )}
      </section>
    </div>
  );
}
