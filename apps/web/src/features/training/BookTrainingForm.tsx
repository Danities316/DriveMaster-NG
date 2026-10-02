import { useState, type FormEvent } from "react";
import { multiplyTrainingMoney, type TrainingSnapshot } from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

export function BookTrainingForm({
  snapshot,
  onSave
}: {
  snapshot: TrainingSnapshot;
  onSave: (payload: unknown) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instructorId, setInstructor] = useState("");
  const [vehicleId, setVehicle] = useState("");
  const [time, setTime] = useState("");
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fuel = snapshot.settings?.data.fuelPerStudent ?? "1500.00";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selected.length || selected.length > 3) {
      setError("Choose one, two or three students.");
      return;
    }
    if (!review) {
      setReview(true);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        studentIds: selected,
        instructorId,
        vehicleId,
        plannedStart: new Date(time).toISOString()
      });
      setReview(false);
      setSelected([]);
      setInstructor("");
      setVehicle("");
      setTime("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!snapshot.enrollments.length || !snapshot.instructors.length || !snapshot.vehicles.length)
    return (
      <p>
        Open School setup first to add an instructor, a vehicle and a student with a training
        package.
      </p>
    );
  return (
    <form className="training-form" onSubmit={(e) => void submit(e)}>
      {snapshot.instructorDocumentWarnings
        ?.filter((warning) => warning.instructorId === instructorId)
        .map((warning, index) => (
          <p className="dm-notice" key={index}>
            {warning.message} Document dates are checked against the lesson date when the booking is
            sent.
          </p>
        ))}
      <fieldset hidden={review}>
        <legend>1. Choose students</legend>
        <p>Up to three students can share a training trip. Each gets one 30-minute lesson.</p>
        {snapshot.enrollments
          .filter((e) => e.data.activationStatus !== "PENDING_PAYMENT")
          .map((e) => {
            const summary = snapshot.summaries.find((s) => s.studentId === e.data.studentId);
            const left = summary ? Math.max(0, summary.remaining - summary.booked) : undefined;
            const checked = selected.includes(e.data.studentId);
            return (
              <label className="training-check" key={e.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && (selected.length === 3 || left === 0)}
                  onChange={(ev) =>
                    setSelected(
                      ev.target.checked
                        ? [...selected, e.data.studentId]
                        : selected.filter((id) => id !== e.data.studentId)
                    )
                  }
                />
                <span>
                  {snapshot.students.find((s) => s.id === e.data.studentId)?.name ?? "Student"}
                  <small>
                    {e.data.name}
                    {left !== undefined ? ` · ${left} lessons available to book` : ""}
                  </small>
                </span>
              </label>
            );
          })}
      </fieldset>
      <fieldset hidden={review}>
        <legend>2. Choose the instructor, vehicle and time</legend>
        <label>
          Instructor
          <select value={instructorId} onChange={(e) => setInstructor(e.target.value)} required>
            <option value="">Choose instructor</option>
            {snapshot.instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vehicle
          <select value={vehicleId} onChange={(e) => setVehicle(e.target.value)} required>
            <option value="">Choose vehicle</option>
            {snapshot.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date and start time
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </label>
      </fieldset>
      <section className="workflow-review" aria-label="Booking summary" aria-live="polite">
        <h3>{review ? "Check your booking" : "Your training trip"}</h3>
        <p>
          {selected.length} students · {selected.length * 30} minutes of driving in total
        </p>
        <p>
          Fuel money: <strong>{naira(multiplyTrainingMoney(fuel, selected.length))}</strong> (
          {naira(fuel)} per student). The amount issued depends on who attends.
        </p>
        {review && (
          <>
            <p>
              {selected
                .map((id) => snapshot.students.find((s) => s.id === id)?.name ?? "Student")
                .join(", ")}
            </p>
            <p>
              Instructor: {snapshot.instructors.find((i) => i.id === instructorId)?.name} · Vehicle:{" "}
              {snapshot.vehicles.find((v) => v.id === vehicleId)?.plateNumber}
            </p>
            <p>
              {new Date(time).toLocaleString("en-NG", {
                timeZone: "Africa/Lagos",
                dateStyle: "medium",
                timeStyle: "short"
              })}{" "}
              (Lagos time)
            </p>
            <p>
              We check availability when the booking is sent. A booking waiting to be sent is not
              yet final.
            </p>
          </>
        )}
      </section>
      {error && (
        <p role="alert" className="fleet-error">
          {error}
        </p>
      )}
      <div className="workflow-actions">
        {review && (
          <button
            type="button"
            className="dm-secondary"
            disabled={busy}
            onClick={() => setReview(false)}
          >
            Back to edit
          </button>
        )}
        <button className="dm-primary" disabled={busy || !selected.length}>
          {busy ? "Saving…" : review ? "Save booking" : "Check booking"}
        </button>
      </div>
    </form>
  );
}
