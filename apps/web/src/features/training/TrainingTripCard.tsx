import { useState } from "react";
import {
  multiplyTrainingMoney,
  type TrainingSnapshot,
  type TrainingRecord,
  type TrainingOuting
} from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";
import { EntryForm, Field } from "./TrainingFields";
import { StartOutingForm, FinishOutingForm } from "./LessonWorkflow";
import { findQueuedPay, type QueuedTraining } from "./trainingLocal";

const lessonStatus: Record<string, string> = {
  BOOKED: "Booked",
  DRIVING: "Training now",
  MISSED: "Absent — book another date",
  PENDING: "Waiting for student confirmation",
  CONFIRMED: "Lesson confirmed",
  DISPUTED: "Student reported a problem",
  VOID: "This lesson was not deducted"
};
const localTime = (date: string) => {
  const d = new Date(date);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function TrainingTripCard({
  record,
  snapshot,
  owner,
  office,
  changes,
  payChanges = [],
  onSave,
  onSetup
}: {
  record: TrainingRecord<TrainingOuting>;
  snapshot: TrainingSnapshot;
  owner: boolean;
  office: boolean;
  changes: QueuedTraining[];
  payChanges?: QueuedTraining[];
  onSave: (action: string, payload: unknown) => Promise<void>;
  onSetup: () => void;
}) {
  const [editor, setEditor] = useState(false),
    [details, setDetails] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const [moveAction, setMoveAction] = useState("RESCHEDULE");
  const o = record.data;
  const name = (id: string) => snapshot.students.find((s) => s.id === id)?.name ?? "Student";
  const pending = changes.length > 0;
  const canFinish =
    !pending ||
    (changes.length === 1 && changes[0]?.action === "START" && changes[0]?.status === "PENDING");
  const complaint = o.members.some((m) => m.status === "DISPUTED");
  const currentMonth = new Date(Date.parse(o.plannedStart) + 3600000).toISOString().slice(0, 7);
  const waitingPay = findQueuedPay(payChanges, o.instructorId, currentMonth);
  const savedAction = changes.find((change) => change.status !== "FAILED")?.action;
  const missingPay =
    owner &&
    o.status === "BOOKED" &&
    !snapshot.salaries.some(
      (s) => s.data.instructorId === o.instructorId && s.data.month === currentMonth
    );
  const fuel = o.fuelIssued ?? multiplyTrainingMoney(o.fuelPerStudent, o.members.length);
  async function save(action: string, payload: unknown) {
    await onSave(action, payload);
    setEditor(false);
  }
  return (
    <article
      className="dm-panel training-panel training-trip-card"
      aria-label={`Training trip for ${o.members.map((m) => name(m.studentId)).join(", ")}`}
    >
      <div className="training-outing-heading">
        <div>
          <p className="dm-eyebrow">
            {o.status === "STARTED" && o.startedAt ? "Started " : ""}
            {new Date(
              o.status === "STARTED" && o.startedAt ? o.startedAt : o.plannedStart
            ).toLocaleString("en-NG", {
              timeZone: "Africa/Lagos",
              hour: "numeric",
              minute: "2-digit",
              hour12: true
            })}
          </p>
          <h3>{o.members.map((m) => name(m.studentId)).join(" and ")}</h3>
        </div>
        <strong>
          {
            {
              BOOKED: "Booked",
              STARTED: "Training now",
              COMPLETED: "Completed",
              CANCELLED: "Booking cancelled"
            }[o.status]
          }
        </strong>
      </div>
      <p className="text-sm text-slate-600">
        {new Date(o.plannedStart).toLocaleDateString("en-NG", {
          timeZone: "Africa/Lagos",
          day: "numeric",
          month: "short"
        })}
      </p>
      <p>
        Instructor:{" "}
        <strong>
          {snapshot.instructors.find((i) => i.id === o.instructorId)?.name ?? "Assigned instructor"}
        </strong>{" "}
        · Vehicle:{" "}
        <strong>
          {snapshot.vehicles.find((v) => v.id === o.vehicleId)?.plateNumber ?? "Assigned vehicle"}
        </strong>
      </p>
      <div className="trip-key-facts">
        {o.status === "BOOKED" &&
          snapshot.instructorDocumentWarnings
            ?.filter((warning) => warning.instructorId === o.instructorId)
            .map((warning, index) => (
              <p className="dm-notice" key={index}>
                {warning.message}{" "}
                {warning.blocked
                  ? "Your school rules require this before training."
                  : "Warning only under your school rules."}
              </p>
            ))}
      </div>
      {o.status === "COMPLETED" && (
        <p className="trip-confirmation-counts">
          {o.members.some((m) => m.status === "PENDING") && (
            <span>
              {o.members.filter((m) => m.status === "PENDING").length} waiting for student
              confirmation.{" "}
            </span>
          )}
          {complaint && (
            <strong>
              {o.members.filter((m) => m.status === "DISPUTED").length} reported with a problem.
            </strong>
          )}
        </p>
      )}
      {pending && (
        <p className="trip-save-status" role="status">
          {changes.some((c) => c.status === "FAILED")
            ? "A saved change needs attention. Open Saved training records above."
            : savedAction === "START"
              ? "Training start saved on this device. Waiting to be sent."
              : savedAction === "FINISH"
                ? "Training finish saved on this device. Waiting to be sent."
                : "Saved on this device. Waiting to be sent."}
        </p>
      )}
      {!pending && (o.status === "STARTED" || o.status === "COMPLETED") && (
        <p>{o.status === "STARTED" ? "Training started" : "Training completed"}</p>
      )}
      {changes.some((c) => c.action === "START" && c.status === "PENDING") && (
        <p>
          Training can continue. Keep the app open; DriveMaster will try to send this record when
          possible.
        </p>
      )}
      {missingPay && (
        <p className="trip-setup-note">
          {waitingPay
            ? `Monthly pay for this instructor is saved on this device for ${currentMonth}, but ${waitingPay.status === "FAILED" ? "needs attention" : "is waiting to be sent"}. Open Saved training records above. Do not create it again.`
            : `Monthly pay for ${currentMonth} is not in the records loaded for this instructor. If you already entered it, select Refresh before creating it again.`}{" "}
          <button className="text-button" onClick={onSetup}>
            {waitingPay ? "View saved instructor pay" : "Set up instructor pay"}
          </button>{" "}
          {waitingPay
            ? "Training can start once the pay record has been accepted."
            : "before starting training in the booked month."}
        </p>
      )}
      <div className="trip-actions">
        {o.status === "BOOKED" || o.status === "STARTED" ? (
          <button
            className="dm-primary"
            aria-expanded={editor}
            aria-controls={`trip-work-${record.id}`}
            disabled={o.status === "BOOKED" ? pending : !canFinish}
            onClick={() => {
              setFormStatus(o.status);
              setEditor(!editor);
            }}
          >
            {editor ? "Close form" : o.status === "BOOKED" ? "Start training" : "Finish training"}
          </button>
        ) : (
          <button
            className={complaint && owner ? "dm-primary" : "dm-secondary"}
            aria-expanded={details}
            aria-controls={`trip-details-${record.id}`}
            onClick={() => setDetails(!details)}
          >
            {details
              ? "Close lesson record"
              : complaint && owner
                ? "Review the student’s complaint"
                : "View lesson record"}
          </button>
        )}
        {(o.status === "BOOKED" || o.status === "STARTED") && (
          <button
            className="dm-secondary"
            aria-expanded={details}
            aria-controls={`trip-details-${record.id}`}
            onClick={() => setDetails(!details)}
          >
            {details ? "Hide lesson details" : "View lesson details"}
          </button>
        )}
      </div>
      <div id={`trip-work-${record.id}`} hidden={!editor}>
        {formStatus === o.status && o.status === "BOOKED" && (
          <StartOutingForm
            outing={o}
            name={name}
            disabled={pending}
            onSave={async (payload) => {
              const month = new Date(
                Date.parse((payload as { startedAt: string }).startedAt) + 3600000
              )
                .toISOString()
                .slice(0, 7);
              if (
                owner &&
                !snapshot.salaries.some(
                  (s) => s.data.instructorId === o.instructorId && s.data.month === month
                )
              )
                throw new Error(
                  findQueuedPay(payChanges, o.instructorId, month)
                    ? `Pay for ${month} is already saved on this device. Send or review that pay record first, then start training.`
                    : `Enter this instructor’s monthly pay for ${month} in School setup, then return to start training.`
                );
              await save("START", payload);
            }}
          />
        )}
        {formStatus === o.status && o.status === "STARTED" && (
          <FinishOutingForm
            outing={o}
            name={name}
            disabled={!canFinish}
            onSave={(payload) => save("FINISH", payload)}
          />
        )}
      </div>
      <section id={`trip-details-${record.id}`} hidden={!details} className="trip-details">
        <p>
          30 minutes per student · {o.fuelIssued ? "Fuel money issued" : "Planned fuel money"}:{" "}
          <strong>{naira(fuel)}</strong>
        </p>
        <h4>Each student’s lesson</h4>
        <ul>
          {o.members.map((m) => (
            <li key={m.studentId}>
              <strong>{name(m.studentId)}</strong>
              <p>
                {lessonStatus[m.status]}
                {m.minutes > 0 ? ` · ${m.minutes} driving minutes` : ""}
              </p>
              {m.topics && <p>Taught: {m.topics}</p>}
              {m.note && <p>Notes: {m.note}</p>}
              {m.response && <p>Student’s response: {m.response}</p>}
              {m.reviewReason && <p>Owner’s decision: {m.reviewReason}</p>}
              {owner && m.status === "DISPUTED" && (
                <EntryForm
                  title="Save review decision"
                  disabled={pending}
                  onSave={async (f) =>
                    onSave("RESOLVE", {
                      studentId: m.studentId,
                      credit: f.get("credit") === "yes",
                      reason: String(f.get("reason"))
                    })
                  }
                >
                  <label>
                    Decision
                    <select name="credit">
                      <option value="no">Do not deduct this lesson</option>
                      {m.minutes >= 30 && (
                        <option value="yes">Count this lesson as completed</option>
                      )}
                    </select>
                  </label>
                  <Field label="Reason for this decision" name="reason" />
                </EntryForm>
              )}
            </li>
          ))}
        </ul>
        {o.startOdometer != null && (
          <p>
            Start mileage: {o.startOdometer.toLocaleString()} km
            {o.endOdometer != null
              ? ` · End mileage: ${o.endOdometer.toLocaleString()} km · Distance: ${(o.endOdometer - o.startOdometer).toLocaleString()} km`
              : ""}
          </p>
        )}
        <p>
          Fuel money per student: {naira(o.fuelPerStudent)}. Reason: {o.allowanceReason}.
        </p>
        {o.fuelSpent && (
          <p>
            Fuel spending recorded: {naira(o.fuelSpent)}.{" "}
            {o.fuelLogId
              ? "Find the purchase in Mileage & fuel."
              : "No fuel purchase was entered for this trip."}
          </p>
        )}
        <p className="training-help">
          Fuel money is a spending record, not a measurement of the fuel each student used.
        </p>
        {o.status === "CANCELLED" && (
          <p>This booking did not use any student’s lesson. {o.changeReason}</p>
        )}
      </section>
      {o.status === "BOOKED" && office && (
        <details className="trip-more">
          <summary>More options</summary>
          {owner && (
            <details>
              <summary>Change fuel money for this trip</summary>
              <EntryForm
                title="Save fuel money"
                disabled={pending}
                onSave={async (f) =>
                  onSave("ALLOWANCE", {
                    fuelPerStudent: String(f.get("fuelPerStudent")),
                    reason: String(f.get("reason"))
                  })
                }
              >
                <Field
                  label="Fuel money per student (₦)"
                  name="fuelPerStudent"
                  type="number"
                  min="0.01"
                  step="0.01"
                  initial={o.fuelPerStudent}
                />
                <Field label="Reason for changing it" name="reason" />
              </EntryForm>
            </details>
          )}
          <details>
            <summary>Move or cancel this booking</summary>
            <EntryForm
              title="Save booking change"
              disabled={pending}
              onSave={async (f) =>
                onSave(moveAction, {
                  ...(moveAction === "RESCHEDULE"
                    ? { plannedStart: new Date(String(f.get("plannedStart"))).toISOString() }
                    : {}),
                  reason: String(f.get("reason"))
                })
              }
            >
              <label>
                What would you like to do?
                <select
                  name="action"
                  value={moveAction}
                  onChange={(e) => setMoveAction(e.target.value)}
                >
                  <option value="RESCHEDULE">Move to another date</option>
                  <option value="CANCEL">Cancel without using a lesson</option>
                </select>
              </label>
              {moveAction === "RESCHEDULE" && (
                <Field
                  label="New date and time"
                  name="plannedStart"
                  type="datetime-local"
                  initial={localTime(o.plannedStart)}
                />
              )}
              <Field label="Reason" name="reason" />
            </EntryForm>
          </details>
        </details>
      )}
    </article>
  );
}
