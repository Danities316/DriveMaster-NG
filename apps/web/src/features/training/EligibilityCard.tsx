import type {
  StudentTrainingSummary,
  TrainingEnrollment,
  TrainingRecord
} from "@drivemaster/shared";
import { EntryForm, Field } from "./TrainingFields";
export function EligibilityCard({
  summary,
  enrollment,
  owner,
  pending,
  studentVersion,
  onSave
}: {
  summary: StudentTrainingSummary;
  enrollment?: TrainingRecord<TrainingEnrollment>;
  owner: boolean;
  pending: boolean;
  studentVersion: number;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const days = summary.qualifyingDays;
  return (
    <div>
      <div className="flex flex-col gap-3">
        <div>
          <strong>
            {days === undefined
              ? "Training-day progress unavailable"
              : `${days} training days completed`}
          </strong>
          <p>School target: {summary.schoolTargetDays ?? 26} days</p>
          {days !== undefined && (
            <p>
              {days} / {summary.schoolTargetDays ?? 26} training days
            </p>
          )}
          <p>
            {days === undefined
              ? "Refresh to load training-day progress."
              : summary.schoolTargetMet
                ? "School target met"
                : "More confirmed training days needed"}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-600">DSSP reference: 26 training days</p>
          <p>
            {days === undefined
              ? "Refresh to check progress against the reference."
              : summary.dsspMinimumMet
                ? "Training-day minimum met"
                : "Training-day minimum not yet met"}
          </p>
        </div>
      </div>
      <p>
        Only confirmed lessons of at least 30 minutes count. Two lessons on the same day count as
        one training day. Meeting the minimum does not issue a licence or confirm other application
        requirements.
      </p>
      {summary.activationStatus === "PENDING_PAYMENT" && (
        <p className="dm-notice">
          Waiting for payment or office activation. Lessons cannot be booked yet.
        </p>
      )}
      {summary.schoolCompletedAt && (
        <p>
          School completion recorded on{" "}
          {new Date(summary.schoolCompletedAt).toLocaleDateString("en-NG")}.
          {!summary.schoolTargetMet && " The current target is not met; review the changed target."}
        </p>
      )}
      {owner && enrollment && (
        <details>
          <summary>Extra lessons and school completion</summary>
          <EntryForm
            title="Add extra lessons"
            disabled={pending || summary.activationStatus === "PENDING_PAYMENT"}
            onSave={(f) =>
              onSave(
                "EXTRA_LESSONS",
                enrollment.id,
                {
                  sessions: Number(f.get("sessions")),
                  fee: String(f.get("fee") ?? ""),
                  studentVersion,
                  reason: String(f.get("reason") ?? "")
                },
                enrollment.version
              )
            }
          >
            <p>
              This adds lessons to the student’s package and adds the agreed extra fee to their
              balance. Enter 0 for free extra lessons. Their training-day target stays the same.
            </p>
            <Field
              label="Extra lessons to add"
              name="sessions"
              type="number"
              min="1"
              max="200"
              step="1"
            />
            <Field
              label="Agreed fee for all extra lessons (₦)"
              name="fee"
              type="number"
              min="0"
              step="0.01"
            />
            <Field label="Reason for extra lessons" name="reason" />
          </EntryForm>
          {!summary.schoolCompletedAt && (
            <EntryForm
              title="Mark school training complete"
              disabled={
                pending ||
                !summary.schoolTargetMet ||
                summary.activationStatus === "PENDING_PAYMENT"
              }
              onSave={(f) =>
                onSave(
                  "COMPLETE_SCHOOL",
                  enrollment.id,
                  { reason: String(f.get("reason") ?? "") },
                  enrollment.version
                )
              }
            >
              <p>
                This records completion against the saved school target. It does not issue an FRSC
                certificate. Additional training can continue.
              </p>
              {!summary.dsspMinimumMet && (
                <p className="dm-notice">
                  The recorded 26-day minimum is not met. School completion will not change this.
                </p>
              )}
              <Field label="School completion note" name="reason" />
            </EntryForm>
          )}
        </details>
      )}
    </div>
  );
}
