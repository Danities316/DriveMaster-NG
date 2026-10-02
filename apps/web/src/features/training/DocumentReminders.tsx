import { useEffect, useState } from "react";
import { schoolDocumentReminders, type TrainingSnapshot } from "@drivemaster/shared";
export function DocumentReminders({
  snapshot,
  loadedAt,
  onSettings
}: {
  snapshot: TrainingSnapshot;
  loadedAt?: string;
  onSettings?: () => void;
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
        . Refresh after a renewal. These are in-app reminders, not SMS or WhatsApp messages.
      </p>
      <ul>
        {reminders.map((r) => (
          <li key={r.key}>
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
          </li>
        ))}
      </ul>
      {onSettings && (
        <button type="button" className="dm-secondary" onClick={onSettings}>
          Update document details
        </button>
      )}
    </details>
  );
}
