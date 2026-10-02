import {
  DEFAULT_SCHOOL_RULES,
  RECORDED_DSSP_MINIMUM_DAYS,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { EntryForm, Field } from "./TrainingFields";

export function SchoolRulesSettings({
  snapshot,
  pending,
  onSave
}: {
  snapshot: TrainingSnapshot;
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const record = snapshot.schoolRules;
  const rules = record?.data ?? DEFAULT_SCHOOL_RULES;
  const target = record?.id ?? `rules-${snapshot.schoolId}`;
  return (
    <details className="dm-panel training-panel training-setting">
      <summary>School rules</summary>
      <p>
        Your school target is <strong>{rules.schoolTargetDays} separate training days</strong>. The
        recorded DSSP reference is {RECORDED_DSSP_MINIMUM_DAYS} days. Changing your target does not
        change that reference or mean a student has been approved by FRSC.
      </p>
      {rules.schoolTargetDays < RECORDED_DSSP_MINIMUM_DAYS && (
        <p className="dm-notice">
          Your school target is below the recorded DSSP minimum. Meeting your target alone will not
          meet that minimum.
        </p>
      )}
      <p>
        New targets apply to packages assigned after the change is accepted. Existing students keep
        their saved target. Document rules apply to new bookings, moved bookings and starting
        training once accepted. Paid lesson counts and past costs stay unchanged.
      </p>
      {pending(target) && (
        <p role="status">
          Your rule change is waiting to be sent. The accepted rules above still apply.
        </p>
      )}
      <EntryForm
        key={record?.version ?? -1}
        title="Save school rules"
        disabled={pending(target)}
        onSave={(f) =>
          onSave(
            "SCHOOL_RULES",
            target,
            {
              schoolTargetDays: Number(f.get("schoolTargetDays")),
              requireInstructorNin: f.get("requireInstructorNin") === "on",
              requireInstructorLicence: f.get("requireInstructorLicence") === "on",
              permitExpiryAction: String(f.get("permitExpiryAction")),
              permitReminderDays: Number(f.get("permitReminderDays")),
              vehicleExpiryAction: String(f.get("vehicleExpiryAction")),
              vehicleReminderDays: Number(f.get("vehicleReminderDays")),
              reason: String(f.get("reason") ?? "")
            },
            record?.version
          )
        }
      >
        <Field
          label="School target: separate training days"
          name="schoolTargetDays"
          type="number"
          min="1"
          max="1000"
          step="1"
          initial={rules.schoolTargetDays}
        />
        <details className="workflow-review">
          <summary>Instructor document rules</summary>
          <label className="training-check">
            <input
              type="checkbox"
              name="requireInstructorNin"
              defaultChecked={rules.requireInstructorNin}
            />
            Require instructor NIN before booking or starting training
          </label>
          <label className="training-check">
            <input
              type="checkbox"
              name="requireInstructorLicence"
              defaultChecked={rules.requireInstructorLicence}
            />
            Require instructor licence number before booking or starting training
          </label>
          <label>
            If the instructor permit is expired or its date is missing
            <select name="permitExpiryAction" defaultValue={rules.permitExpiryAction}>
              <option value="WARN">Show a warning and allow training</option>
              <option value="BLOCK">Stop booking and starting training</option>
            </select>
          </label>
          <Field
            label="Remind me this many days before permit expiry"
            name="permitReminderDays"
            type="number"
            min="0"
            max="365"
            step="1"
            initial={rules.permitReminderDays}
          />
          <p>
            Allowing training is your school’s operational choice, not confirmation that a document
            is legally valid.
          </p>
        </details>
        <Field label="Reason for changing the rules" name="reason" />
        <details className="workflow-review">
          <summary>Vehicle document reminders</summary>
          <label>
            If insurance or roadworthiness is expired or its date is missing
            <select name="vehicleExpiryAction" defaultValue={rules.vehicleExpiryAction ?? "WARN"}>
              <option value="WARN">Show a warning and allow training</option>
              <option value="BLOCK">Stop booking and starting training</option>
            </select>
          </label>
          <Field
            label="Remind me this many days before vehicle documents expire"
            name="vehicleReminderDays"
            type="number"
            min="0"
            max="365"
            step="1"
            initial={rules.vehicleReminderDays ?? 30}
          />
        </details>
      </EntryForm>
      <details>
        <summary>Change one existing student’s target</summary>
        <p>
          This changes only the chosen student’s school target. It does not add paid lessons, remove
          attendance or change the recorded DSSP minimum. Every change is recorded with your reason.
        </p>
        <EntryForm
          title="Update this student’s target"
          onSave={(f) => {
            const enrollment = snapshot.enrollments.find((e) => e.id === f.get("enrollmentId"));
            if (!enrollment) throw new Error("Choose a student.");
            return onSave(
              "ENROLLMENT_RULES",
              enrollment.id,
              {
                schoolTargetDays: Number(f.get("schoolTargetDays")),
                reason: String(f.get("reason") ?? "")
              },
              enrollment.version
            );
          }}
        >
          <label>
            Student whose target will change
            <select name="enrollmentId" required defaultValue="">
              <option value="">Choose student</option>
              {snapshot.enrollments.map((e) => (
                <option key={e.id} value={e.id} disabled={pending(e.id)}>
                  {snapshot.students.find((s) => s.id === e.data.studentId)?.name ?? "Student"} —{" "}
                  {e.data.rulesSnapshot?.schoolTargetDays ?? 26} days
                </option>
              ))}
            </select>
          </label>
          <Field
            label="New school target for this student"
            name="schoolTargetDays"
            type="number"
            min="1"
            max="1000"
            step="1"
          />
          <Field label="Reason for changing this student’s target" name="reason" />
        </EntryForm>
      </details>
    </details>
  );
}
