import { useMemo, useState, type FormEvent } from "react";
import { multiplyTrainingMoney, type TrainingSnapshot } from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

export type BookingRequirement =
  "students" | "packages" | "enrollment" | "instructors" | "vehicles";

export function BookTrainingForm({
  snapshot,
  onSave,
  initialStudentId = "",
  onResolveMissing
}: {
  snapshot: TrainingSnapshot;
  onSave: (payload: unknown) => Promise<void>;
  initialStudentId?: string;
  onResolveMissing?: (requirement: BookingRequirement) => void;
}) {
  const eligible = useMemo(
    () =>
      snapshot.enrollments.filter((enrollment) => {
        if (enrollment.data.activationStatus === "PENDING_PAYMENT") return false;
        const summary = snapshot.summaries.find(
          (item) => item.studentId === enrollment.data.studentId
        );
        return !summary || summary.remaining - summary.booked > 0;
      }),
    [snapshot.enrollments, snapshot.summaries]
  );
  const preferred = eligible.some((item) => item.data.studentId === initialStudentId)
    ? initialStudentId
    : (eligible[0]?.data.studentId ?? "");
  const [primaryStudentId, setPrimaryStudentId] = useState(preferred);
  const [additionalStudentIds, setAdditionalStudentIds] = useState<string[]>([]);
  const [showAdditional, setShowAdditional] = useState(false);
  const [instructorId, setInstructor] = useState(
    snapshot.instructors.length === 1 ? snapshot.instructors[0]!.id : ""
  );
  const [vehicleId, setVehicle] = useState(
    snapshot.vehicles.length === 1 ? snapshot.vehicles[0]!.id : ""
  );
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = [primaryStudentId, ...additionalStudentIds].filter(Boolean);
  const fuel = snapshot.settings?.data.fuelPerStudent ?? "1500.00";
  const missing: Array<{ requirement: BookingRequirement; message: string; action: string }> = [];
  if (!snapshot.students.length)
    missing.push({
      requirement: "students",
      message: "Add a registered student.",
      action: "Add student"
    });
  if (!snapshot.packages.length)
    missing.push({
      requirement: "packages",
      message: "Create a training package.",
      action: "Set up packages"
    });
  if (snapshot.students.length && snapshot.packages.length && !snapshot.enrollments.length)
    missing.push({
      requirement: "enrollment",
      message: "Assign a training package to a registered student.",
      action: "Assign package"
    });
  if (!snapshot.instructors.length)
    missing.push({
      requirement: "instructors",
      message: "Add an instructor.",
      action: "Add instructor"
    });
  if (!snapshot.vehicles.length)
    missing.push({ requirement: "vehicles", message: "Add a vehicle.", action: "Add vehicle" });
  if (snapshot.enrollments.length && !eligible.length)
    missing.push({
      requirement: "enrollment",
      message: snapshot.enrollments.some((item) => item.data.activationStatus === "PENDING_PAYMENT")
        ? "Activate a student's package payment before booking."
        : "No student currently has an unbooked lesson available.",
      action: "Review student packages"
    });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!primaryStudentId || selected.length > 3) {
      setError("Choose one student and no more than two additional students.");
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
      setPrimaryStudentId(eligible[0]?.data.studentId ?? "");
      setAdditionalStudentIds([]);
      setShowAdditional(false);
      setTime("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (missing.length)
    return (
      <section
        className="training-booking-requirements"
        aria-labelledby="booking-requirements-title"
      >
        <h3 id="booking-requirements-title">Complete these before booking</h3>
        <ul>
          {missing.map((item) => (
            <li key={`${item.requirement}-${item.message}`}>
              <span>{item.message}</span>
              {onResolveMissing && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => onResolveMissing(item.requirement)}
                >
                  {item.action}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <form className="training-form" onSubmit={(event) => void submit(event)}>
      <fieldset>
        <legend>Lesson details</legend>
        <label>
          Student
          <select
            value={primaryStudentId}
            onChange={(event) => {
              setPrimaryStudentId(event.target.value);
              setAdditionalStudentIds((ids) => ids.filter((id) => id !== event.target.value));
            }}
            required
          >
            <option value="">Choose student</option>
            {eligible.map((enrollment) => {
              const summary = snapshot.summaries.find(
                (item) => item.studentId === enrollment.data.studentId
              );
              const name =
                snapshot.students.find((student) => student.id === enrollment.data.studentId)
                  ?.name ?? "Student";
              return (
                <option key={enrollment.id} value={enrollment.data.studentId}>
                  {name}
                  {summary
                    ? ` (${Math.max(0, summary.remaining - summary.booked)} lessons available)`
                    : ""}
                </option>
              );
            })}
          </select>
        </label>
        {!showAdditional ? (
          eligible.length > 1 && (
            <button className="text-button" type="button" onClick={() => setShowAdditional(true)}>
              Add another student
            </button>
          )
        ) : (
          <fieldset>
            <legend>Additional students (optional)</legend>
            <p>Choose up to two. Each student receives a separate 30-minute lesson.</p>
            {eligible
              .filter((enrollment) => enrollment.data.studentId !== primaryStudentId)
              .map((enrollment) => {
                const checked = additionalStudentIds.includes(enrollment.data.studentId);
                const name =
                  snapshot.students.find((student) => student.id === enrollment.data.studentId)
                    ?.name ?? "Student";
                return (
                  <label className="training-check" key={enrollment.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && additionalStudentIds.length === 2}
                      onChange={(event) =>
                        setAdditionalStudentIds(
                          event.target.checked
                            ? [...additionalStudentIds, enrollment.data.studentId]
                            : additionalStudentIds.filter((id) => id !== enrollment.data.studentId)
                        )
                      }
                    />
                    <span>{name}</span>
                  </label>
                );
              })}
          </fieldset>
        )}
        <label>
          Instructor
          <select
            value={instructorId}
            onChange={(event) => setInstructor(event.target.value)}
            required
          >
            <option value="">Choose instructor</option>
            {snapshot.instructors.map((instructor) => (
              <option key={instructor.id} value={instructor.id}>
                {instructor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vehicle
          <select value={vehicleId} onChange={(event) => setVehicle(event.target.value)} required>
            <option value="">Choose vehicle</option>
            {snapshot.vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date and start time
          <input
            type="datetime-local"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />
        </label>
      </fieldset>
      {snapshot.instructorDocumentWarnings
        ?.filter((warning) => warning.instructorId === instructorId)
        .map((warning, index) => (
          <p className="dm-notice" key={index}>
            {warning.message} Document dates are checked against the lesson date when the booking is
            sent.
          </p>
        ))}
      <section className="workflow-review" aria-label="Booking summary" aria-live="polite">
        <h3>Booking summary</h3>
        <p>
          {selected.length} student{selected.length === 1 ? "" : "s"} · {selected.length * 30}{" "}
          minutes of driving
        </p>
        <p>
          Fuel money: <strong>{naira(multiplyTrainingMoney(fuel, selected.length))}</strong> (
          {naira(fuel)} per student)
        </p>
      </section>
      {error && (
        <p role="alert" className="fleet-error">
          {error}
        </p>
      )}
      <div className="workflow-actions">
        <button className="dm-primary" disabled={busy || !primaryStudentId}>
          {busy ? "Booking…" : "Confirm booking"}
        </button>
      </div>
    </form>
  );
}
