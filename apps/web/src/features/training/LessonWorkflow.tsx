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
export const COMMON_LESSON_TOPICS = [
  "Know your car and basic controls",
  "Simulator and basic vehicle control",
  "Road signs, rules and safe driving",
  "Traffic lights, wardens and hand signals",
  "Junctions, roundabouts and right of way",
  "Overtaking and meeting other vehicles",
  "Steering, gears and road positioning",
  "Moving off, stopping and observation",
  "Real-road driving practice",
  "Straight-line and corner reversing",
  "Parking and manoeuvres",
  "Revision and internal test",
  "FRSC theory and test preparation",
  "Test preparation and reverse practice",
  "Road practice and confidence building"
] as const;
const OTHER_TOPIC = "__OTHER__";
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
  const [fuelBought, setFuelBought] = useState(false);
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [lessonTopic, setLessonTopic] = useState("");
  const [otherTopic, setOtherTopic] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const members = outing.members.filter((m) => m.status === "DRIVING");
  const read = (f: FormData, key: string) => String(f.get(key) ?? "");
  const sharedTopic = () => (lessonTopic === OTHER_TOPIC ? otherTopic : lessonTopic).trim();
  function validate() {
    const form = formRef.current!;
    const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
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
    if (!sharedTopic()) {
      const missing = members.find((member) => !read(f, `topics-${member.studentId}`).trim());
      if (missing)
        return fail(
          "lessonTopic",
          "Choose what was taught. Open individual changes only when students did different topics."
        );
    }
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
    if (fuelBought) {
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
    if (!validate()) return;
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
          topics: read(f, `topics-${m.studentId}`).trim() || sharedTopic(),
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
        <p>
          Started {new Date(outing.startedAt!).toLocaleString("en-NG")}. Starting mileage:{" "}
          {outing.startOdometer?.toLocaleString()} km.
        </p>

        <div className="lesson-topic-card">
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

          <label>
            What did you teach today?
            <select
              name="lessonTopic"
              value={lessonTopic}
              aria-invalid={fieldError?.name === "lessonTopic" ? true : undefined}
              onChange={(event) => {
                setLessonTopic(event.target.value);
                setFieldError(undefined);
              }}
            >
              <option value="">Choose the main lesson</option>
              {COMMON_LESSON_TOPICS.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
              <option value={OTHER_TOPIC}>Something else</option>
            </select>
          </label>
          {lessonTopic === OTHER_TOPIC && (
            <Input
              label="Describe what was taught"
              name="otherTopic"
              initial={otherTopic}
              onChange={setOtherTopic}
            />
          )}
          {fieldError?.name === "lessonTopic" && (
            <span className="fleet-error" role="alert">
              {fieldError.message}
            </span>
          )}
          <p>
            This lesson will be used for everyone in the car. Keep the default 30 minutes unless a
            student did something different.
          </p>
        </div>

        <details className="lesson-student-changes">
          <summary>Change time, topic or notes for one student</summary>
          <p>Open this only when a student did something different.</p>
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
                label={`Different topic (optional) — ${name(m.studentId)}`}
                name={`topics-${m.studentId}`}
                required={false}
              />
              <Input
                label={`Notes (optional) — ${name(m.studentId)}`}
                name={`note-${m.studentId}`}
                required={false}
              />
            </fieldset>
          ))}
          <p>
            Short lessons are allowed, but the owner can review them later. Fuel and other costs are
            still recorded.
          </p>
        </details>

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
          <h4>Purchase details</h4>
          <p>Use the actual fuel purchase details so the trip is easy to check later.</p>
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
        </fieldset>
        {!fuelBought && <FuelBalance given={outing.fuelIssued ?? "0"} spent="0" />}
        {!fuelBought && (
          <p>
            No purchase will be added. The full issued amount remains to be accounted for by the
            owner.
          </p>
        )}
        {error && (
          <p className="fleet-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="submit" className="dm-primary" disabled={disabled || busy}>
            {busy ? "Saving…" : "Finish training"}
          </button>
        </div>
      </form>
    </FieldError.Provider>
  );
}
