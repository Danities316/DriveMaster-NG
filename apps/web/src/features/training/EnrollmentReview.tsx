import { useState } from "react";
import { INTAKE_FIELDS, type EnrollmentApplicationView } from "@drivemaster/shared";
import { trainingRequest } from "./trainingLocal";
import { EntryForm, Field } from "./TrainingFields";
import { ApplicantFields } from "./ApplicantFields";
import { naira } from "../dashboard/dashboardData";
function ApplicantCorrection({
  application,
  save
}: {
  application: EnrollmentApplicationView;
  save: (action: string, reason: string, details?: unknown) => Promise<void>;
}) {
  const [details, setDetails] = useState(application.details!);
  return (
    <details>
      <summary>Correct private application details</summary>
      <EntryForm
        title="Save corrected details"
        onSave={(f) => save("CORRECT", String(f.get("reason") ?? ""), details)}
      >
        <ApplicantFields
          fields={INTAKE_FIELDS.map(([key]) => key)}
          details={details}
          onChange={(key, value) => setDetails((old) => ({ ...old, [key]: value }))}
        />
        <Field label="Reason for correcting these details" name="reason" />
      </EntryForm>
    </details>
  );
}
export function EnrollmentReview({
  owner,
  onSaved
}: {
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const [applications, setApplications] = useState<EnrollmentApplicationView[]>([]),
    [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState("PENDING_PAYMENT"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(nextPage = page) {
    setBusy(true);
    setError("");
    try {
      const result = await trainingRequest(
        `applications?status=${filter}&offset=${nextPage * 100}`
      );
      setApplications(result.applications);
      setHasMore(result.hasMore);
      setPage(nextPage);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load registrations.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dm-panel training-panel">
      <h2>Student registrations</h2>
      <p>
        1. Review the details and create the student record. 2. Open Students to record payment. 3.
        Return here, load the list and activate training. Payment must be sent to the server first.
      </p>
      <p>
        Registrations and private biodata are available online. Records are shown in pages of 100.
      </p>
      <label>
        Show registrations
        <select
          value={filter}
          disabled={busy}
          onChange={(e) => {
            setFilter(e.target.value);
            setApplications([]);
            setLoaded(false);
            setPage(0);
            setHasMore(false);
          }}
        >
          <option value="PENDING_PAYMENT">Waiting for review or payment</option>
          <option value="ACTIVE">Training activated</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <button type="button" className="dm-secondary" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading…" : "Load registrations"}
      </button>
      {error && (
        <p role="alert" className="fleet-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {loaded && !applications.length && <p>No registrations in this list.</p>}
      {loaded && (
        <div className="workflow-actions">
          <button
            type="button"
            className="dm-secondary"
            disabled={busy || page === 0}
            onClick={() => void load(page - 1)}
          >
            Newer registrations
          </button>
          <span>Page {page + 1}</span>
          <button
            type="button"
            className="dm-secondary"
            disabled={busy || !hasMore}
            onClick={() => void load(page + 1)}
          >
            Older registrations
          </button>
        </div>
      )}
      {applications.map((application) => {
        const save = async (action: string, reason: string, details?: unknown) => {
          setMessage("");
          await trainingRequest(`applications/${encodeURIComponent(application.id)}`, {
            action,
            reason,
            details,
            expectedVersion: application.version
          });
          setMessage(
            action === "REVIEW"
              ? "Student record created. Record payment in Students, then return here to activate training."
              : action === "ACTIVATE"
                ? "Training activated. You can now book lessons."
                : "Registration updated."
          );
          await load();
          await onSaved();
        };
        return (
          <article key={`${application.id}-${application.version}`} className="training-summary">
            <h3>{application.name}</h3>
            <p>
              {application.phone} · {new Date(application.createdAt).toLocaleDateString("en-NG")}
            </p>
            <p>
              {application.packageSnapshot.name} · {application.packageSnapshot.sessions} lessons ·{" "}
              {naira(application.packageSnapshot.price)} agreed at registration
            </p>
            <p>
              Confirmed payments: {naira(application.paid)} · School target:{" "}
              {application.rulesSnapshot.schoolTargetDays} separate days
            </p>
            <p>
              {application.status === "ACTIVE"
                ? "Training activated"
                : application.status === "REJECTED"
                  ? "Rejected"
                  : application.studentId
                    ? "Student record created — waiting for payment or activation"
                    : "New registration — waiting for review"}
            </p>
            {owner && application.details && (
              <details>
                <summary>View licence-preparation details (private)</summary>
                <dl>
                  {INTAKE_FIELDS.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{application.details![key] || "Not supplied"}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  These are student-supplied details, not verified licence-application approval.
                </p>
              </details>
            )}
            {application.status === "PENDING_PAYMENT" && (
              <EntryForm
                title={application.studentId ? "Activate training" : "Create student record"}
                onSave={(f) =>
                  save(application.studentId ? "ACTIVATE" : "REVIEW", String(f.get("reason") ?? ""))
                }
              >
                <Field label="Review note" name="reason" />
              </EntryForm>
            )}
            {application.status === "PENDING_PAYMENT" && !application.studentId && (
              <details>
                <summary>Reject a duplicate or unwanted registration</summary>
                <EntryForm
                  title="Reject registration"
                  onSave={(f) => save("REJECT", String(f.get("reason") ?? ""))}
                >
                  <Field label="Reason for rejecting" name="reason" />
                </EntryForm>
              </details>
            )}
            {owner && application.details && application.status !== "REJECTED" && (
              <ApplicantCorrection application={application} save={save} />
            )}
            {application.reviewReason && <p>Last office note: {application.reviewReason}</p>}
          </article>
        );
      })}
    </section>
  );
}
