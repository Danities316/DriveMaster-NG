import { useState } from "react";
import QRCode from "qrcode";
import {
  DEFAULT_ENROLLMENT_SETTINGS,
  INTAKE_FIELDS,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { EntryForm, Field } from "./TrainingFields";
export function EnrollmentSettings({
  snapshot,
  pending,
  onSave
}: {
  snapshot: TrainingSnapshot;
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const record = snapshot.enrollmentSettings,
    settings = record?.data ?? DEFAULT_ENROLLMENT_SETTINGS;
  const target = record?.id ?? `intake-${snapshot.schoolId}`;
  const [address, setAddress] = useState(window.location.origin),
    [qr, setQr] = useState("");
  let link = "",
    local = false;
  try {
    const url = new URL(address);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
      link = `${url.origin}/#enroll/${encodeURIComponent(snapshot.schoolId)}`;
      local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    }
  } catch {
    /* Explain invalid address below. */
  }
  const [qrError, setQrError] = useState("");
  return (
    <details className="dm-panel training-panel training-setting">
      <summary>QR enrollment: let students register themselves</summary>
      <p>
        Students scan the code, enter their details and choose a package. Open Registrations to
        review them. No payment is collected by the public form.
      </p>
      <p>
        <strong>{settings.enabled ? "Enrollment is open" : "Enrollment is closed"}</strong>
        {pending(target) ? " — a settings change is waiting to be sent." : ""}
      </p>
      <EntryForm
        key={record?.version ?? -1}
        title="Save QR enrollment settings"
        disabled={pending(target)}
        onSave={(f) =>
          onSave(
            "ENROLLMENT_SETTINGS",
            target,
            {
              enabled: f.get("enabled") === "on",
              welcome: String(f.get("welcome") ?? ""),
              packageIds: f.getAll("packageIds").map(String),
              requiredFields: f.getAll("requiredFields").map(String),
              allowUnpaidStart: f.get("allowUnpaidStart") === "on",
              reason: String(f.get("reason") ?? "")
            },
            record?.version
          )
        }
      >
        <label className="training-check">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          Open student registration
        </label>
        <Field
          label="Welcome message for students"
          name="welcome"
          initial={settings.welcome}
          required={false}
        />
        <fieldset>
          <legend>Packages students can choose</legend>
          {snapshot.packages.map((p) => (
            <label className="training-check" key={p.id}>
              <input
                type="checkbox"
                name="packageIds"
                value={p.id}
                defaultChecked={settings.packageIds.includes(p.id)}
              />
              {p.data.name} — {p.data.sessions} lessons
            </label>
          ))}
          {!snapshot.packages.length && <p>Create a training package first.</p>}
        </fieldset>
        <details className="workflow-review">
          <summary>What should students fill in?</summary>
          <p>
            First name, surname and phone are always required. Choose other details students must
            enter now. Unchecked details remain optional.
          </p>
          {INTAKE_FIELDS.filter(([key]) => !["firstName", "lastName", "phone"].includes(key)).map(
            ([key, label]) => (
              <label className="training-check" key={key}>
                <input
                  type="checkbox"
                  name="requiredFields"
                  value={key}
                  defaultChecked={settings.requiredFields.includes(key)}
                />
                {label}
              </label>
            )
          )}
          <label className="training-check">
            <input
              type="checkbox"
              name="allowUnpaidStart"
              defaultChecked={settings.allowUnpaidStart}
            />
            Allow the office to activate training before payment
          </label>
          <h4>Can students start training before payment?</h4>
          <p>
            When unchecked, a paid package needs at least one confirmed payment before activation.
            This does not mean the full fee has been paid. Free packages can be activated without
            payment.
          </p>
        </details>
        <Field label="Reason for changing enrollment settings" name="reason" />
      </EntryForm>
      <div className="enrollment-share">
        <h3>Your school’s registration link</h3>
        <label>
          App address students can open
          <input
            value={address}
            type="url"
            onChange={(e) => {
              setAddress(e.target.value);
              setQr("");
              setQrError("");
            }}
          />
        </label>
        {local && (
          <p className="dm-notice">
            This localhost address works only on this computer. For a phone test, use this
            computer’s local network address and connect both devices to the same Wi-Fi. For
            customers, use your hosted HTTPS website.
          </p>
        )}
        {!link && <p>Enter a full website address starting with https:// or http://.</p>}
        {link && (
          <p>
            <a href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
          </p>
        )}
        {link && (
          <button
            type="button"
            className="dm-secondary"
            onClick={() => {
              setQrError("");
              void QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: "M" })
                .then(setQr)
                .catch(() =>
                  setQrError(
                    "Unable to draw the QR code. You can still share the registration link above."
                  )
                );
            }}
          >
            Create QR code
          </button>
        )}
        {qrError && <p role="alert">{qrError}</p>}
        {qr && (
          <>
            <img
              className="enrollment-qr"
              src={qr}
              alt="QR code for this school's student registration page"
            />
            <a className="dm-secondary" href={qr} download="school-registration-qr.png">
              Download QR code for printing
            </a>
          </>
        )}
        {!settings.enabled && (
          <p>Save and send your settings to open this link before sharing it.</p>
        )}
      </div>
    </details>
  );
}
