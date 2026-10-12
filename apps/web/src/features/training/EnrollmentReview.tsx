import { useState } from "react";
import { INTAKE_FIELDS, type EnrollmentApplicationView } from "@drivemaster/shared";
import { openTrainingFile, trainingRequest } from "./trainingLocal";
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
        1. Review the details and create the student record. 2. Check any reported bank transfer
        against the school’s bank account and confirm it. 3. Activate training after payment.
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
            {!!application.paymentClaims.length && (
              <div className="payment-claim-list">
                <h4>Bank transfers reported by this student</h4>
                {application.paymentClaims.map((claim) => (
                  <article key={claim.id} className={`payment-claim ${claim.status.toLowerCase()}`}>
                    <div>
                      <strong>{naira(claim.amount)}</strong>
                      <span>
                        {claim.senderName} ·{" "}
                        {new Date(claim.transferDate).toLocaleDateString("en-NG")}
                      </span>
                      <small>
                        {claim.status === "WAITING"
                          ? "Waiting for the school to check its bank account"
                          : claim.status === "CONFIRMED"
                            ? "Confirmed and added to the student’s payments"
                            : "Rejected — not added to payments"}
                      </small>
                    </div>
                    {claim.reference && <p>Bank reference: {claim.reference}</p>}
                    {claim.hasReceipt && (
                      <button
                        type="button"
                        className="dm-secondary"
                        onClick={() =>
                          void openTrainingFile(
                            `applications/payment-claims/${encodeURIComponent(claim.id)}/receipt`
                          ).catch((e) =>
                            setError(e instanceof Error ? e.message : "Unable to open receipt.")
                          )
                        }
                      >
                        View receipt
                      </button>
                    )}
                    {claim.status === "WAITING" && !application.studentId && (
                      <p className="dm-notice">
                        Create the student record before confirming this payment.
                      </p>
                    )}
                    {claim.status === "WAITING" && application.studentId && (
                      <>
                        <EntryForm
                          title="Confirm money received"
                          onSave={async (form) => {
                            setMessage("");
                            await trainingRequest(
                              `applications/payment-claims/${encodeURIComponent(claim.id)}`,
                              { action: "CONFIRM", note: String(form.get("note") ?? "") }
                            );
                            setMessage("Payment confirmed and added to the student’s balance.");
                            await load();
                            await onSaved();
                          }}
                        >
                          <Field label="Confirmation note" name="note" />
                        </EntryForm>
                        <details>
                          <summary>Reject this transfer report</summary>
                          <EntryForm
                            title="Reject transfer report"
                            onSave={async (form) => {
                              await trainingRequest(
                                `applications/payment-claims/${encodeURIComponent(claim.id)}`,
                                { action: "REJECT", note: String(form.get("note") ?? "") }
                              );
                              setMessage("Transfer report rejected. No payment was added.");
                              await load();
                            }}
                          >
                            <Field label="Reason for rejecting" name="note" />
                          </EntryForm>
                        </details>
                      </>
                    )}
                    {claim.reviewNote && <p>Office note: {claim.reviewNote}</p>}
                  </article>
                ))}
              </div>
            )}
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
