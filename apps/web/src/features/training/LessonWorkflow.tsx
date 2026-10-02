import { useId, useRef, useState, createContext, useContext, type FormEvent } from "react";
import {
  isValidStoredMoney,
  multiplyTrainingMoney,
  subtractMoney,
  type TrainingOuting
} from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

const localTime = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
type Props = {
  outing: TrainingOuting;
  name: (id: string) => string;
  disabled: boolean;
  onSave: (payload: unknown) => Promise<void>;
};
const FieldError = createContext<{ name: string; message: string } | undefined>(undefined);
function Input({
  label,
  name,
  type = "text",
  initial,
  min,
  max,
  step,
  required = true,
  onChange
}: {
  label: string;
  name: string;
  type?: string;
  initial?: string | number;
  min?: string | number;
  max?: string | number;
  step?: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const error = useContext(FieldError);
  const errorId = useId();
  const message = error?.name === name ? error.message : undefined;
  return (
    <label>
      {label}
      <input
        name={name}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        type={type}
        inputMode={type === "number" ? (step === "1" ? "numeric" : "decimal") : undefined}
        onChange={(event) => onChange?.(event.target.value)}
        defaultValue={initial}
        min={min}
        max={max}
        step={step}
        required={required}
        maxLength={500}
      />
      {message && (
        <span id={errorId} className="fleet-error" role="alert">
          {message}
        </span>
      )}
    </label>
  );
}
function FuelBalance({ given, spent }: { given: string; spent: string }) {
  if (!isValidStoredMoney(spent)) return <p>Enter the amount spent to see the money to return.</p>;
  const balance = subtractMoney(given, spent);
  return (
    <div className="workflow-total" role="status">
      {balance.startsWith("-") ? (
        <strong>
          Fuel cost is {naira(subtractMoney(spent, given))} more than the fuel money given.
        </strong>
      ) : (
        <>
          <span>Money to return</span>
          <strong>{naira(balance)}</strong>
        </>
      )}
      <p>The owner records money actually returned separately.</p>
    </div>
  );
}
export function StartOutingForm({ outing, name, disabled, onSave }: Props) {
  const [mileage, setMileage] = useState("");
  const [present, setPresent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    if (!present.length) {
      setError("Choose at least one student who is here before starting.");
      return;
    }
    const f = new FormData(event.currentTarget);
    const startedAt = new Date(String(f.get("startedAt")));
    if (startedAt.getTime() > Date.now() + 300000) {
      setError("The start time cannot be in the future. Check the time entered.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        startedAt: startedAt.toISOString(),
        odometer: Number(f.get("odometer")),
        present
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="training-form lesson-workflow" onSubmit={(event) => void submit(event)}>
      <h3>Start training</h3>
      <fieldset>
        <legend>Who is here for this training trip?</legend>
        <p>Select only the students who are here.</p>
        {outing.members.map((m) => (
          <label className="training-check" key={m.studentId}>
            <input
              type="checkbox"
              checked={present.includes(m.studentId)}
              onChange={(e) =>
                setPresent(
                  e.target.checked
                    ? [...present, m.studentId]
                    : present.filter((id) => id !== m.studentId)
                )
              }
            />
            {name(m.studentId)}
          </label>
        ))}
      </fieldset>
      <Input
        label="Actual start time"
        name="startedAt"
        type="datetime-local"
        initial={localTime()}
      />
      <Input
        label="Starting mileage (km)"
        onChange={setMileage}
        name="odometer"
        type="number"
        min={0}
        max={2147483647}
        step="1"
      />
      <div className="workflow-total" role="status">
        <span>Fuel money</span>
        <strong>{naira(multiplyTrainingMoney(outing.fuelPerStudent, present.length))}</strong>
        <p>
          Based on {present.length} {present.length === 1 ? "student" : "students"} attending.
        </p>
        {mileage && <p>Starting mileage: {Number(mileage).toLocaleString("en-NG")} km</p>}
      </div>
      {error && (
        <p role="alert" className="fleet-error">
          {error}
        </p>
      )}
      <button className="dm-primary" disabled={disabled || busy || !present.length}>
        {busy ? "Saving…" : "Start training"}
      </button>
    </form>
  );
}

export function FinishOutingForm({ outing, name, disabled, onSave }: Props) {
  const [fuelBought, setFuelBought] = useState(true);
  const [endMileage, setEndMileage] = useState("");
  const [spent, setSpent] = useState(outing.fuelIssued ?? "0");
  const [fieldError, setFieldError] = useState<{ name: string; message: string }>();
  const fuelErrorId = useId();
  const distance =
    endMileage !== "" &&
    Number.isInteger(Number(endMileage)) &&
    Number(endMileage) >= (outing.startOdometer ?? 0) &&
    Number(endMileage) <= 2147483647
      ? Number(endMileage) - (outing.startOdometer ?? 0)
      : undefined;
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [review, setReview] = useState<FormData>();
  const formRef = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const members = outing.members.filter((m) => m.status === "DRIVING");
  const titles = ["Driving time and mileage", "Fuel bought", "Check and save"];
  const read = (f: FormData, key: string) => String(f.get(key) ?? "");
  function go(next: number) {
    setStep(next);
    setError("");
    setFieldError(undefined);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function validate(section: number) {
    const form = formRef.current!;
    const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      `[data-step="${section}"] input, [data-step="${section}"] select`
    );
    const fail = (fieldName: string, message: string) => {
      const field = form.elements.namedItem(fieldName) as HTMLInputElement;
      field.setCustomValidity(message);
      field.setAttribute("aria-invalid", "true");
      field.focus();
      setFieldError({ name: fieldName, message });
      return false;
    };
    for (const field of fields) {
      if (!field.willValidate) continue;
      field.setCustomValidity("");
      field.removeAttribute("aria-invalid");
      const student = members.find((m) => field.name === `minutes-${m.studentId}`);
      if (field.name.startsWith("topics-") && !field.value.trim())
        return fail(field.name, "Enter what was taught during this lesson.");
      if (!field.checkValidity()) {
        const message =
          field.name === "odometer" && field.validity.rangeUnderflow
            ? "Ending mileage cannot be lower than starting mileage."
            : student
              ? `Enter driving time for ${name(student.studentId)} as whole minutes from 0 to 180.`
              : field.validationMessage;
        return fail(field.name, message);
      }
    }
    const f = new FormData(form);
    const end = Date.parse(read(f, "endedAt")),
      start = Date.parse(outing.startedAt!);
    if (section === 0) {
      if (end <= start || end > Date.now() + 300000 || end - start > 43200000)
        return fail(
          "endedAt",
          "Choose a finish time after the start, no later than now, and within 12 hours of starting."
        );
      const minutes = members.reduce((sum, m) => sum + Number(f.get(`minutes-${m.studentId}`)), 0);
      if (minutes > (end - start) / 60000)
        return fail(
          "endedAt",
          `You entered ${minutes} driving minutes. The training trip must last at least that long. Check the finish time or driving minutes.`
        );
    }
    if (section === 1 && fuelBought) {
      const fuelTime = Date.parse(read(f, "fuelDate"));
      if (fuelTime < start || fuelTime > end)
        return fail(
          "fuelDate",
          "Enter the time fuel was bought between the start and finish of this training trip."
        );
      if (Number(f.get("fuelOdometer")) > Number(f.get("odometer")))
        return fail(
          "fuelOdometer",
          "Fuel purchase mileage cannot be higher than the ending mileage."
        );
    }
    return true;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    if (step < 2) {
      if (!validate(step)) return;
      setReview(new FormData(formRef.current!));
      go(step + 1);
      return;
    }
    const f = new FormData(formRef.current!);
    setBusy(true);
    setError("");
    try {
      await onSave({
        endedAt: new Date(read(f, "endedAt")).toISOString(),
        odometer: Number(f.get("odometer")),
        fuelSpent: fuelBought ? read(f, "fuelSpent") : "0.00",
        ...(fuelBought
          ? {
              litres: read(f, "litres"),
              receiptReference: read(f, "receiptReference"),
              fuelDate: new Date(read(f, "fuelDate")).toISOString(),
              fuelOdometer: Number(f.get("fuelOdometer")),
              fullTank: read(f, "fullTank") === "yes"
            }
          : {}),
        lessons: members.map((m) => ({
          studentId: m.studentId,
          minutes: Number(f.get(`minutes-${m.studentId}`)),
          topics: read(f, `topics-${m.studentId}`),
          note: read(f, `note-${m.studentId}`)
        }))
      });
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
    <FieldError.Provider value={fieldError}>
      <form
        ref={formRef}
        className="training-form lesson-workflow"
        noValidate
        onSubmit={(event) => void submit(event)}
        onInput={(event) => {
          if (event.target instanceof HTMLInputElement) {
            event.target.setCustomValidity("");
            if (event.target.name === fieldError?.name) setFieldError(undefined);
          }
        }}
      >
        <h3>Finish training</h3>
        <h4 ref={heading} tabIndex={-1}>
          Step {step + 1} of 3: {titles[step]}
        </h4>
        <fieldset data-step="0" hidden={step !== 0}>
          <legend>1. How far did you drive?</legend>
          <p>
            Started {new Date(outing.startedAt!).toLocaleString("en-NG")}. Starting mileage:{" "}
            {outing.startOdometer?.toLocaleString()} km.
          </p>
          <Input
            label="Actual finish time"
            name="endedAt"
            type="datetime-local"
            initial={localTime()}
          />
          <Input
            label="Ending mileage (km)"
            onChange={setEndMileage}
            name="odometer"
            type="number"
            min={outing.startOdometer ?? 0}
            max={2147483647}
            step="1"
          />
          {distance !== undefined && (
            <p className="workflow-total" role="status">
              Distance driven: {distance.toLocaleString("en-NG")} km
            </p>
          )}
          <h4>2. What did each student do?</h4>
          {members.map((m) => (
            <fieldset className="workflow-student" key={m.studentId}>
              <legend>{name(m.studentId)}</legend>
              <Input
                label={`Driving minutes — ${name(m.studentId)}`}
                name={`minutes-${m.studentId}`}
                type="number"
                min={0}
                max={180}
                step="1"
                initial={30}
              />
              <Input
                label={`Topics taught — ${name(m.studentId)}`}
                name={`topics-${m.studentId}`}
              />
              <Input
                label={`Notes (optional) — ${name(m.studentId)}`}
                name={`note-${m.studentId}`}
                required={false}
              />
            </fieldset>
          ))}
          <p>
            Enter the time each student actually drove. Less than 30 minutes will be recorded as a
            short lesson for the owner to review. Fuel and other costs are still recorded.
          </p>
        </fieldset>
        <fieldset data-step="1" hidden={step !== 1}>
          <legend>3. What happened to the fuel money?</legend>
          <div className="workflow-total">
            <span>Fuel money given</span>
            <strong>{naira(outing.fuelIssued ?? "0")}</strong>
          </div>
          <label>
            Was fuel bought during this trip?
            <select
              value={fuelBought ? "yes" : "no"}
              onChange={(e) => setFuelBought(e.target.value === "yes")}
            >
              <option value="yes">Bought fuel</option>
              <option value="no">No fuel bought</option>
            </select>
          </label>
          <fieldset disabled={!fuelBought} hidden={!fuelBought}>
            <Input
              label="Amount spent (₦)"
              name="fuelSpent"
              onChange={setSpent}
              type="number"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              initial={outing.fuelIssued ?? "0"}
            />
            <FuelBalance given={outing.fuelIssued ?? "0"} spent={spent} />
            <h4>Purchase details (required)</h4>
            <p>Copy these details from the fuel purchase. They help check fuel use and mileage.</p>
            <Input
              label="Fuel bought (litres)"
              name="litres"
              type="number"
              min="0.01"
              max="999999.99"
              step="0.01"
            />
            <Input label="Fuel receipt reference" name="receiptReference" />
            <Input label="Fuel purchase time" name="fuelDate" type="datetime-local" />
            <Input
              label="Mileage when fuel was bought (km)"
              name="fuelOdometer"
              type="number"
              min={outing.startOdometer ?? 0}
              max={2147483647}
              step="1"
            />
            <label>
              Did this purchase fill the tank completely?
              <select
                name="fullTank"
                defaultValue=""
                required
                aria-invalid={fieldError?.name === "fullTank" ? true : undefined}
                aria-describedby={fieldError?.name === "fullTank" ? fuelErrorId : undefined}
                onChange={() => setFieldError(undefined)}
              >
                <option value="">Choose</option>
                <option value="yes">Yes, full tank</option>
                <option value="no">No, partial fill</option>
              </select>
              {fieldError?.name === "fullTank" && (
                <span id={fuelErrorId} className="fleet-error" role="alert">
                  Choose whether this purchase filled the tank completely.
                </span>
              )}
            </label>
            <p>
              Use the actual purchase time and mileage. Do not record this receipt again on the
              vehicle page.
            </p>
          </fieldset>
          {!fuelBought && <FuelBalance given={outing.fuelIssued ?? "0"} spent="0" />}
          {!fuelBought && (
            <p>
              No purchase will be added. The full issued amount remains to be accounted for by the
              owner.
            </p>
          )}
        </fieldset>
        {step === 2 && review && (
          <section className="workflow-review" aria-label="Lesson summary">
            <h4>Training summary</h4>
            <p>
              <strong>Distance driven: {distance?.toLocaleString("en-NG")} km</strong>
            </p>
            <ul>
              {members.map((m) => (
                <li key={m.studentId}>
                  <strong>{name(m.studentId)}</strong>: {read(review, `minutes-${m.studentId}`)}{" "}
                  minutes · {read(review, `topics-${m.studentId}`)}
                  {read(review, `note-${m.studentId}`) &&
                    ` · ${read(review, `note-${m.studentId}`)}`}
                </li>
              ))}
            </ul>
            <p>
              Finished: {new Date(read(review, "endedAt")).toLocaleString("en-NG")} · Mileage:{" "}
              {outing.startOdometer} → {read(review, "odometer")} km
            </p>
            <p>
              Fuel: {fuelBought ? read(review, "litres") : "0"} litres for{" "}
              {naira(fuelBought ? read(review, "fuelSpent") : "0")} · Receipt:{" "}
              {fuelBought ? read(review, "receiptReference") : "Not applicable"} ·{" "}
              {fuelBought
                ? read(review, "fullTank") === "yes"
                  ? "Full tank"
                  : "Partial fill"
                : "No purchase"}
            </p>
            {fuelBought && (
              <p>
                Bought: {new Date(read(review, "fuelDate")).toLocaleString("en-NG")} at{" "}
                {read(review, "fuelOdometer")} km.
              </p>
            )}
            <p>
              Fuel money given: {naira(outing.fuelIssued ?? "0")} / Spent:{" "}
              {naira(fuelBought ? read(review, "fuelSpent") : "0")}
            </p>
            <FuelBalance
              given={outing.fuelIssued ?? "0"}
              spent={fuelBought ? read(review, "fuelSpent") : "0"}
            />
            <p>
              Students will see these lessons when the records are sent. Each student must sign in
              to confirm or report a problem.
            </p>
          </section>
        )}
        {error && (
          <p className="fleet-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          {step > 0 && (
            <button
              type="button"
              className="dm-secondary"
              disabled={busy}
              onClick={() => go(step - 1)}
            >
              Back
            </button>
          )}
          <button type="submit" className="dm-primary" disabled={disabled || busy}>
            {busy ? "Saving…" : step === 2 ? "Finish training" : "Continue"}
          </button>
        </div>
      </form>
    </FieldError.Provider>
  );
}
