import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { INTAKE_FIELDS, type PublicEnrollmentInfo } from "@drivemaster/shared";
import { ApplicantFields } from "./ApplicantFields";
import { applicantSteps, emptyApplicant } from "./applicantForm";
import { naira } from "../dashboard/dashboardData";
import "./training.css";
import { registrationId } from "./registrationId";
export function PublicEnrollmentPage({ schoolId }: { schoolId: string }) {
  const [info, setInfo] = useState<PublicEnrollmentInfo>();
  const [details, setDetails] = useState(emptyApplicant);
  const [packageId, setPackage] = useState("");
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [consent, setConsent] = useState(false),
    [received, setReceived] = useState(false);
  const [website, setWebsite] = useState("");
  const requestId = useRef(registrationId());
  const base = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`${base}/enroll/${encodeURIComponent(schoolId)}`, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Unable to open this registration.");
      setInfo(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect to the internet and try again.");
    }
  }, [base, schoolId]);
  useEffect(() => {
    void load();
  }, [load]);
  const pack = info?.packages.find((p) => p.id === packageId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !info) return;
    setError("");
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    if (!pack) {
      setError("Choose a training package.");
      return;
    }
    if (!consent) {
      setError("Please confirm how the school may use your details.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${base}/enroll/${encodeURIComponent(schoolId)}`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          id: requestId.current,
          packageId,
          packageVersion: pack.version,
          settingsVersion: info.settingsVersion,
          rulesVersion: info.rulesVersion,
          details,
          consent,
          website
        })
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Unable to submit. Please try again.");
      setReceived(true);
      setDetails(emptyApplicant());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We could not confirm receipt. Keep this page open and try again; the same reference prevents duplicate submissions."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="enroll-page training-page">
      <section className="dm-panel training-panel">
        <p className="dm-eyebrow">STUDENT REGISTRATION</p>
        <h1>{info?.school.name ?? "Join your driving school"}</h1>
        {error && (
          <p role="alert" className="fleet-error">
            {error}
          </p>
        )}
        {!received && (
          <button
            type="button"
            className="dm-secondary"
            onClick={() => void load()}
            disabled={busy}
          >
            Reload school options
          </button>
        )}
        {received ? (
          <div role="status">
            <h2>Your details have been received</h2>
            <p>
              Your registration is waiting for payment and school review. Contact the office to
              arrange payment and your first lesson.
            </p>
            <p>
              Reference: <strong>{requestId.current}</strong>
            </p>
            <p>School phone: {info?.school.phone}</p>
            <p>
              This is not a payment receipt or a driver’s licence application. Keep your reference.
            </p>
          </div>
        ) : (
          info && (
            <>
              <p>{info.settings.welcome}</p>
              <p>
                Step {step + 1} of 4:{" "}
                {
                  [
                    "About you",
                    "Address and next of kin",
                    "Licence preparation",
                    "Package and review"
                  ][step]
                }
              </p>
              <p>
                Fields marked * are needed now. Other details can be completed with the school
                later. Internet is needed to submit; private details are not saved on this device.
              </p>
              <form className="training-form" onSubmit={(e) => void submit(e)}>
                {step < 3 && (
                  <ApplicantFields
                    fields={applicantSteps[step]!}
                    details={details}
                    requiredFields={info.settings.requiredFields}
                    onChange={(key, value) => setDetails((old) => ({ ...old, [key]: value }))}
                  />
                )}
                {step === 2 && (
                  <p>
                    These details help the school prepare your application later. Leave unknown
                    blood group blank. Official tests, verification and biometric capture are
                    separate. Licence class is a preference, subject to eligibility.
                  </p>
                )}
                {step === 3 && (
                  <>
                    <label>
                      Choose your training package *
                      <select
                        value={packageId}
                        onChange={(e) => setPackage(e.target.value)}
                        required
                      >
                        <option value="">Choose a package</option>
                        {info.packages.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.data.name} — {p.data.sessions} lessons — {naira(p.data.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!info.packages.length && (
                      <p>No packages are open. Please contact the school.</p>
                    )}
                    <p>
                      School target: {info.schoolTargetDays} separate training days. Recorded DSSP
                      minimum: 26 days. A shorter package may need extra lessons; fees for extra
                      lessons are agreed separately.
                    </p>
                    <details open className="workflow-review">
                      <summary>Check your details</summary>
                      <dl>
                        {INTAKE_FIELDS.filter(([key]) => details[key]).map(([key, label]) => (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>
                              {key === "nin" ? `•••••••${details[key].slice(-4)}` : details[key]}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    <label className="training-check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        required
                      />
                      I agree that this school may store my details to manage my training and help
                      prepare my licence application. I have permission to provide my next-of-kin
                      contact details.
                    </label>
                    <label hidden>
                      Leave this blank
                      <input
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                      />
                    </label>
                  </>
                )}
                <div className="workflow-actions">
                  {step > 0 && (
                    <button
                      type="button"
                      className="dm-secondary"
                      disabled={busy}
                      onClick={() => setStep(step - 1)}
                    >
                      Back
                    </button>
                  )}
                  <button
                    className="dm-primary"
                    disabled={busy || (step === 3 && !info.packages.length)}
                    type="submit"
                  >
                    {busy ? "Sending…" : step === 3 ? "Submit my registration" : "Continue"}
                  </button>
                </div>
              </form>
            </>
          )
        )}
      </section>
    </main>
  );
}
