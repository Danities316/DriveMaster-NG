import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { OutboxMutationRecord } from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";
import { retryFailed, resolveStudentConflict } from "../sync/controller";

function typeLabel(entry: OutboxMutationRecord) {
  if (entry.entity === "payment") return "Payment";
  if (entry.entity === "vehicle")
    return entry.action === "CREATE" ? "Vehicle added" : "Vehicle update";
  if (entry.entity === "mileage_log") return "Mileage recorded";
  if (entry.entity === "fuel_log") return "Fuel purchase";
  return entry.action === "CREATE" ? "Student added" : "Student update";
}
function plainError(entry: OutboxMutationRecord, authRequired?: boolean) {
  const error = entry.lastError?.toLowerCase() ?? "";
  if (authRequired || /401|auth|session|sign.?in/.test(error))
    return "Sign in again to send this record.";
  if (entry.status === "CONFLICT")
    return "The school record changed before this update could be accepted. Review it before trying again.";
  return "DriveMaster could not send this record yet. Try again later.";
}

export function ConnectionStatus({ schoolId }: { schoolId: string }) {
  const [online, setOnline] = useState(navigator.onLine);
  const data = useLiveQuery(
    async () => ({
      mutations: await db.outbox.where("schoolId").equals(schoolId).toArray(),
      students: await db.students.where("schoolId").equals(schoolId).toArray(),
      vehicles: await db.vehicles.where("schoolId").equals(schoolId).toArray()
    }),
    [schoolId]
  );
  const state = useLiveQuery(() => db.syncState.get(getOrCreateDeviceId()), []);
  const unidentified = useLiveQuery(() => db.outbox.filter((entry) => !entry.schoolId).count(), []);
  const [actionError, setActionError] = useState("");
  const mutations = data?.mutations ?? [];
  const attention = mutations.filter((entry) => ["FAILED", "CONFLICT"].includes(entry.status));
  const waiting = mutations.filter((entry) => !["FAILED", "CONFLICT"].includes(entry.status));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  async function act(action: () => Promise<void>) {
    setActionError("");
    try {
      await action();
    } catch {
      setActionError("DriveMaster could not update this saved record. Try again.");
    }
  }
  const context = (entry: OutboxMutationRecord) => {
    const payload = entry.payload as Record<string, unknown>;
    const studentId = String(payload["studentId"] ?? payload["id"] ?? "");
    const vehicleId = String(payload["vehicleId"] ?? payload["id"] ?? "");
    return entry.entity === "payment" || entry.entity === "student"
      ? data?.students.find((student) => student.id === studentId)?.name
      : data?.vehicles.find((vehicle) => vehicle.id === vehicleId)?.plateNumber;
  };
  const recordDetails = (entry: OutboxMutationRecord) => {
    const payload = entry.payload as Record<string, unknown>;
    if (entry.entity === "payment") {
      const method =
        payload["method"] === "BANK_TRANSFER"
          ? "Bank transfer"
          : payload["method"] === "CASH"
            ? "Cash"
            : String(payload["method"] ?? "");
      return payload["amount"] ? `₦${payload["amount"]}${method ? ` · ${method}` : ""}` : "";
    }
    if (entry.entity === "mileage_log" && payload["odometer"] != null)
      return `${Number(payload["odometer"]).toLocaleString()} km`;
    if (entry.entity === "fuel_log" && payload["cost"] != null) return `₦${payload["cost"]}`;
    return "";
  };
  const cards = (records: OutboxMutationRecord[], needsAttention: boolean) => (
    <div className="saved-record-cards">
      {records.map((entry) => (
        <article
          className={
            needsAttention ? "saved-record-card saved-record-attention" : "saved-record-card"
          }
          key={entry.mutationId}
        >
          <h3>
            {typeLabel(entry)}
            {context(entry) ? ` — ${context(entry)}` : ""}
          </h3>
          {recordDetails(entry) && <p>{recordDetails(entry)}</p>}
          <p>
            Saved{" "}
            {new Date(entry.createdAt).toLocaleString("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Africa/Lagos"
            })}
          </p>
          <strong>{needsAttention ? "Needs attention" : "Waiting to be sent"}</strong>
          {needsAttention && <p>{plainError(entry, state?.authRequired)}</p>}
          {entry.serverStudent && entry.entity === "student" && entry.action === "UPDATE" ? (
            <details>
              <summary>Review the student changes</summary>
              <p>
                School record: {entry.serverStudent.name}, {entry.serverStudent.phone}, tuition ₦
                {entry.serverStudent.totalTuition}
              </p>
              <div className="fleet-actions">
                <button
                  type="button"
                  className="dm-secondary"
                  onClick={() =>
                    void act(() => resolveStudentConflict(entry.mutationId, true, schoolId))
                  }
                >
                  Keep my changes
                </button>
                <button
                  type="button"
                  className="dm-secondary"
                  onClick={() =>
                    void act(() => resolveStudentConflict(entry.mutationId, false, schoolId))
                  }
                >
                  Use the school record
                </button>
              </div>
            </details>
          ) : entry.status === "CONFLICT" ? (
            <p>
              Ask the school owner to review this record. It will not be overwritten automatically.
            </p>
          ) : null}
          {entry.lastError && (
            <details>
              <summary>Technical details</summary>
              <p>{entry.lastError}</p>
            </details>
          )}
        </article>
      ))}
    </div>
  );
  return (
    <section aria-label="Saved records" className="saved-records-inbox">
      <div className="saved-record-connection" role="status">
        <strong>{online ? "Online" : "Offline"}</strong>
        <span>
          {online
            ? "DriveMaster can try to send saved records."
            : "New work can still be saved on this device."}
        </span>
      </div>
      {attention.length > 0 && (
        <>
          <h2>Needs attention</h2>
          <p>
            {attention.length} record{attention.length === 1 ? " needs" : "s need"} your attention.
          </p>
          {cards(attention, true)}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <h2>Waiting to be sent</h2>
          <p>
            {waiting.length} record{waiting.length === 1 ? " is" : "s are"} safely saved on this
            device. DriveMaster will try to send {waiting.length === 1 ? "it" : "them"} when
            possible.
          </p>
          {cards(waiting, false)}
        </>
      )}
      {!attention.length && !waiting.length && (
        <div className="dashboard-empty">
          <h2>No saved records are waiting</h2>
          <p>Work accepted by the school no longer appears here.</p>
        </div>
      )}
      {unidentified ? (
        <p className="dm-notice">
          {unidentified} older saved record(s) need administrator help because their school could
          not be identified. Keep this app's data.
        </p>
      ) : null}
      {state?.authRequired ? (
        <p className="dm-notice">
          Sign in again to send these records. Your saved work will remain on this device.
        </p>
      ) : null}
      {(waiting.length > 0 || attention.some((entry) => entry.status === "FAILED")) && (
        <button
          type="button"
          className="dm-primary"
          onClick={() => void act(() => retryFailed(schoolId))}
          disabled={!online}
        >
          {attention.length ? "Try again" : "Send saved records"}
        </button>
      )}
      {actionError ? <p role="alert">{actionError}</p> : null}
    </section>
  );
}
