import { useEffect, useState } from "react";
import { schoolDocumentReminders, type TrainingSnapshot } from "@drivemaster/shared";

export type DocumentSettingsArea = "profile" | "vehicles";

function settingsArea(key: string): DocumentSettingsArea {
  return key.startsWith("instructor-") ? "profile" : "vehicles";
}

export function documentReminderMessage(label: string, status: string, expiresOn: string | null) {
  const date = expiresOn
    ? ` The recorded expiry date is ${expiresOn}.`
    : " No expiry date is recorded.";
  return `DriveMaster reminder: ${label} ${status.toLowerCase()}.${date} Please review and update the document details.`;
}

function shareReminder(label: string, status: string, expiresOn: string | null) {
  const text = documentReminderMessage(label, status, expiresOn);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

export function DocumentReminders({
  snapshot,
  loadedAt,
  onSettings
}: {
  snapshot: TrainingSnapshot;
  loadedAt?: string;
  onSettings?: (area: DocumentSettingsArea) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const reminders = schoolDocumentReminders(snapshot, now);
  if (snapshot.instructorPermitDates === undefined && snapshot.vehicleDocuments === undefined)
    return <p>Refresh training records to load document reminders.</p>;
  return (
    <details className="dm-panel training-panel document-reminders">
      <summary>
        {reminders.length
          ? `${reminders.length} document reminder${reminders.length === 1 ? "" : "s"} to check`
          : "No document renewals due in your reminder period"}
      </summary>
      <p>
        Based on saved expiry dates
        {loadedAt
          ? ` last loaded ${new Date(loadedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`
          : ""}
        . Refresh after a renewal. Sharing opens a prepared message in WhatsApp for you to review
        and send.
      </p>
      <ul>
        {reminders.map((r) => (
          <li key={r.key}>
            <div>
              <strong>{r.label}</strong>:{" "}
              {r.status === "MISSING"
                ? "Expiry date not entered"
                : r.status === "EXPIRED"
                  ? `Expired ${Math.abs(r.daysLeft!)} days ago`
                  : r.daysLeft === 0
                    ? "Expires today"
                    : `Expires in ${r.daysLeft} days`}
              {r.expiresOn ? ` (${r.expiresOn})` : ""}.{" "}
              {r.blocked ? "School rules block new bookings and starts." : "Warning only."}
            </div>
            <div className="workflow-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => shareReminder(r.label, r.status, r.expiresOn)}
              >
                Share via WhatsApp
              </button>
              {onSettings && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onSettings(settingsArea(r.key))}
                >
                  Update details
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {onSettings && (
        <button
          type="button"
          className="dm-secondary"
          onClick={() => onSettings(settingsArea(reminders[0]?.key ?? "vehicle"))}
        >
          Update document details
        </button>
      )}
    </details>
  );
}
