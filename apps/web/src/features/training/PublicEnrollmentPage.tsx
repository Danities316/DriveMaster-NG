import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Phone,
  Route,
  ShieldCheck
} from "lucide-react";
import { INTAKE_FIELDS, type PublicEnrollmentInfo } from "@drivemaster/shared";
import { ApplicantFields } from "./ApplicantFields";
import { applicantSteps, emptyApplicant } from "./applicantForm";
import { naira } from "../dashboard/dashboardData";
import { registrationId } from "./registrationId";
import "./training.css";

const stepNames = ["About you", "Address & next of kin", "Licence details", "Package & review"];
function friendlyError(error: unknown, submitting = false) {
  const message = error instanceof Error ? error.message : "";
  if (/not open|closed/i.test(message))
    return "This school is not accepting online registrations right now. Please contact the school.";
  if (/network|fetch|abort|timeout|connection/i.test(message))
    return submitting
      ? "We could not confirm that your registration was received. Keep this page open and try again. You will not be registered twice."
      : "We could not load the school’s registration details. Check your internet connection and try again.";
  return (
    message ||
    (submitting
      ? "We could not send your registration. Please try again."
      : "We could not open this registration. Please try again.")
  );
}

export function PublicEnrollmentPage({ schoolId }: { schoolId: string }) {
  const [info, setInfo] = useState<PublicEnrollmentInfo>();
  const [details, setDetails] = useState(emptyApplicant);
  const [packageId, setPackage] = useState("");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [received, setReceived] = useState(false);
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [receiptDataUrl, setReceiptDataUrl] = useState("");
  const [website, setWebsite] = useState("");
  const requestId = useRef(registrationId());
  const paymentRequestId = useRef(registrationId());
  const loadNumber = useRef(0);
  const base = import.meta.env["VITE_API_BASE_URL"] ?? "/api";

  const load = useCallback(async () => {
    const current = ++loadNumber.current;
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${base}/enroll/${encodeURIComponent(schoolId)}`, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Unable to open this registration.");
      if (current === loadNumber.current) setInfo(result);
    } catch (cause) {
      if (current === loadNumber.current) setError(friendlyError(cause));
    } finally {
      if (current === loadNumber.current) setLoading(false);
    }
  }, [base, schoolId]);

  useEffect(() => {
    void load();
  }, [load]);
  const pack = info?.packages.find((item) => item.id === packageId);
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
    } catch (cause) {
      setError(friendlyError(cause, true));
    } finally {
      setBusy(false);
    }
  }
  async function reportPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paymentBusy || !info) return;
    const form = new FormData(event.currentTarget);
    setPaymentBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${base}/enroll/${encodeURIComponent(schoolId)}/${requestId.current}/payment-claims`,
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            id: paymentRequestId.current,
            amount: String(form.get("amount") ?? ""),
            transferDate: String(form.get("transferDate") ?? ""),
            senderName: String(form.get("senderName") ?? ""),
            reference: String(form.get("reference") ?? ""),
            receiptDataUrl: receiptDataUrl || undefined
          })
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Unable to report payment.");
      setPaymentSent(true);
    } catch (cause) {
      setError(friendlyError(cause, true));
    } finally {
      setPaymentBusy(false);
    }
  }

  return (
    <main className="enroll-page training-page">
      <header className="enroll-brand">
        <span>
          <Route size={22} />
        </span>
        <strong>
          DriveMaster<em>NG</em>
        </strong>
        <small>Student registration</small>
      </header>
      <div className="enroll-layout">
        <aside className="enroll-value-card">
          <p className="dm-eyebrow">YOUR ROAD STARTS HERE</p>
          <h1>
            {info?.school.name
              ? `Start driving with ${info.school.name}`
              : "Start your driving journey"}
          </h1>
          <p className="enroll-value-lead">
            Register once and let the school keep your payment, lessons and progress together.
          </p>
          <ul>
            <li>
              <span>
                <Clock3 size={18} />
              </span>
              <div>
                <strong>About 5 minutes</strong>
                <small>Complete it on your phone</small>
              </div>
            </li>
            <li>
              <span>
                <Check size={18} />
              </span>
              <div>
                <strong>Choose the right package</strong>
                <small>See the lessons and price before submitting</small>
              </div>
            </li>
            <li>
              <span>
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>Your details stay private</strong>
                <small>They go directly to the driving school</small>
              </div>
            </li>
          </ul>
          <div className="enroll-no-payment">
            <CheckCircle2 size={20} />
            <span>
              <strong>Pay only after you register</strong>
              <small>You will see the school’s account details after submitting.</small>
            </span>
          </div>
          {info?.school.phone && (
            <a className="enroll-phone" href={`tel:${info.school.phone}`}>
              <Phone size={17} />
              Need help? Call {info.school.phone}
            </a>
          )}
        </aside>

        <section className="enroll-form-card">
          {loading && !info ? (
            <div className="enroll-loading" role="status">
              <span />
              <h2>Opening your registration…</h2>
              <p>Please wait while we load the school’s packages.</p>
            </div>
          ) : received ? (
            <div className="enroll-success" role="status">
              <span>
                <CheckCircle2 size={34} />
              </span>
              <p className="dm-eyebrow">REGISTRATION RECEIVED</p>
              <h2>Your details have been received</h2>
              <p>The school will review your details and help you book your first lesson.</p>
              <div className="enroll-reference">
                <small>Your reference</small>
                <strong>{requestId.current}</strong>
              </div>
              <p>
                Keep this reference. This is not a payment receipt or a driver’s licence
                application.
              </p>
              {info?.settings.showBankTransfer && !paymentSent && (
                <section className="enroll-payment-card">
                  <p className="dm-eyebrow">PAY DIRECTLY TO THE SCHOOL</p>
                  <h3>Make your bank transfer</h3>
                  <p>
                    Transfer to the account below. Your payment will be added only after the school
                    confirms that the money entered its account.
                  </p>
                  <dl>
                    <div>
                      <dt>Bank</dt>
                      <dd>{info.settings.bankName}</dd>
                    </div>
                    <div>
                      <dt>Account name</dt>
                      <dd>{info.settings.accountName}</dd>
                    </div>
                    <div className="enroll-account-number">
                      <dt>Account number</dt>
                      <dd>{info.settings.accountNumber}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="dm-secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(info.settings.accountNumber)
                        .then(() => setCopied(true))
                    }
                  >
                    <Copy size={16} /> {copied ? "Account number copied" : "Copy account number"}
                  </button>
                  {info.settings.paymentInstructions && (
                    <p className="enroll-payment-note">{info.settings.paymentInstructions}</p>
                  )}
                  <details>
                    <summary>I have made payment</summary>
                    <form
                      className="training-form enroll-payment-form"
                      onSubmit={(event) => void reportPayment(event)}
                    >
                      <label>
                        Amount transferred (₦)
                        <input name="amount" type="number" min="1" step="0.01" required />
                      </label>
                      <label>
                        Transfer date
                        <input
                          name="transferDate"
                          type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          required
                        />
                      </label>
                      <label>
                        Name on the sender’s account
                        <input name="senderName" maxLength={150} required />
                      </label>
                      <label>
                        Bank reference <small>Optional</small>
                        <input name="reference" maxLength={100} />
                      </label>
                      {info.settings.allowReceiptUpload && (
                        <label>
                          Receipt screenshot{" "}
                          <small>Optional — JPG, PNG or WebP, maximum 2 MB</small>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              setError("");
                              if (!file) return setReceiptDataUrl("");
                              if (file.size > 2_000_000) {
                                event.target.value = "";
                                setError("The receipt image must be smaller than 2 MB.");
                                return;
                              }
                              const reader = new FileReader();
                              reader.onload = () => setReceiptDataUrl(String(reader.result ?? ""));
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                      )}
                      {error && (
                        <p role="alert" className="enroll-error">
                          {error}
                        </p>
                      )}
                      <button className="dm-primary" disabled={paymentBusy}>
                        {paymentBusy ? "Sending…" : "Send payment details"}
                      </button>
                      <small>
                        This reports your transfer. It does not confirm payment automatically.
                      </small>
                    </form>
                  </details>
                </section>
              )}
              {paymentSent && (
                <div className="enroll-payment-waiting">
                  <CheckCircle2 size={22} />
                  <div>
                    <strong>Payment details sent</strong>
                    <p>
                      The school will check its bank account. Your payment is waiting for
                      confirmation.
                    </p>
                  </div>
                </div>
              )}
              {info?.school.phone && (
                <a className="dm-primary" href={`tel:${info.school.phone}`}>
                  <Phone size={17} />
                  Call the school
                </a>
              )}
            </div>
          ) : info ? (
            <>
              <div className="enroll-form-heading">
                <p className="dm-eyebrow">STUDENT REGISTRATION</p>
                <h2>Tell us about yourself</h2>
                <p>
                  {info.settings.welcome ||
                    "Complete the steps below. The school will help you with the rest."}
                </p>
              </div>
              <ol className="enroll-progress" aria-label="Registration progress">
                {stepNames.map((name, index) => (
                  <li
                    key={name}
                    className={index < step ? "is-done" : index === step ? "is-current" : ""}
                    aria-current={index === step ? "step" : undefined}
                  >
                    <span>{index < step ? <Check size={15} /> : index + 1}</span>
                    <small>{name}</small>
                  </li>
                ))}
              </ol>
              <div className="enroll-step-heading">
                <div>
                  <span>Step {step + 1} of 4</span>
                  <h3>{stepNames[step]}</h3>
                </div>
                <small>{Math.round(((step + 1) / 4) * 100)}% complete</small>
              </div>
              <p className="enroll-field-note">
                <strong>*</strong> means the school needs this information now. Optional details can
                be completed later.
              </p>
              {error && (
                <div role="alert" className="enroll-error">
                  <CircleAlertIcon />
                  <span>{error}</span>
                </div>
              )}
              <form className="training-form enroll-form" onSubmit={(event) => void submit(event)}>
                {step < 3 && (
                  <ApplicantFields
                    fields={applicantSteps[step]!}
                    details={details}
                    requiredFields={info.settings.requiredFields}
                    onChange={(key, value) => setDetails((old) => ({ ...old, [key]: value }))}
                  />
                )}
                {step === 2 && (
                  <div className="enroll-help">
                    <ShieldCheck size={18} />
                    <p>
                      These details help the school prepare your licence application later. Leave
                      your blood group blank if you do not know it. Official tests, verification and
                      biometric capture are separate.
                    </p>
                  </div>
                )}
                {step === 3 && (
                  <>
                    <label className="enroll-package-select">
                      <span>Choose your training package *</span>
                      <select
                        value={packageId}
                        onChange={(event) => setPackage(event.target.value)}
                        required
                      >
                        <option value="">Choose a package</option>
                        {info.packages.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.data.name} — {item.data.sessions} lessons —{" "}
                            {naira(item.data.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!info.packages.length && (
                      <p className="enroll-error">
                        No packages are open. Please contact the school.
                      </p>
                    )}
                    {pack && (
                      <div className="enroll-package-card">
                        <span>YOUR CHOICE</span>
                        <h4>{pack.data.name}</h4>
                        <div>
                          <strong>{pack.data.sessions}</strong>
                          <small>lessons</small>
                        </div>
                        <div>
                          <strong>{naira(pack.data.price)}</strong>
                          <small>package price</small>
                        </div>
                      </div>
                    )}
                    <div className="enroll-help">
                      <CheckCircle2 size={18} />
                      <p>
                        Your school expects training on {info.schoolTargetDays} separate days. The
                        recorded DSSP minimum is 26 days. The school will explain any extra lessons
                        before you pay.
                      </p>
                    </div>
                    <details open className="workflow-review enroll-review">
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
                    <label className="training-check enroll-consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(event) => setConsent(event.target.checked)}
                        required
                      />
                      <span>
                        I agree that this school may store my details to manage my training and help
                        prepare my licence application. I have permission to provide my next-of-kin
                        contact details.
                      </span>
                    </label>
                    <label hidden>
                      Leave this blank
                      <input
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                      />
                    </label>
                  </>
                )}
                <div className="workflow-actions enroll-actions">
                  {step > 0 && (
                    <button
                      type="button"
                      className="dm-secondary"
                      disabled={busy}
                      onClick={() => {
                        setStep(step - 1);
                        setError("");
                      }}
                    >
                      Back
                    </button>
                  )}
                  <button
                    className="dm-primary"
                    disabled={busy || (step === 3 && !info.packages.length)}
                    type="submit"
                  >
                    {busy ? (
                      "Sending…"
                    ) : step === 3 ? (
                      "Submit my registration"
                    ) : (
                      <>
                        Continue <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </div>
              </form>
              <p className="enroll-privacy">
                <ShieldCheck size={14} />
                Private details are sent securely and are not saved on this phone.
              </p>
            </>
          ) : (
            <div className="enroll-loading enroll-load-error">
              <h2>We couldn’t open this registration</h2>
              <p role="alert">{error}</p>
              <button type="button" className="dm-primary" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}
        </section>
      </div>
      <footer className="enroll-footer">
        Powered by DriveMaster NG · Built for Nigerian driving schools
      </footer>
    </main>
  );
}

function CircleAlertIcon() {
  return <span aria-hidden="true">!</span>;
}
