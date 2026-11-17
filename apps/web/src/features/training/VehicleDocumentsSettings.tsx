import { useState } from "react";
import {
  DEFAULT_SCHOOL_RULES,
  lagosDay,
  vehicleDocumentIssues,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { EntryForm, Field } from "./TrainingFields";
export function VehicleDocumentsSettings({
  snapshot,
  pending,
  onSave
}: {
  snapshot: TrainingSnapshot;
  pending: (id: string) => boolean;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const [vehicleId, setVehicle] = useState("");
  const vehicle = snapshot.vehicles.find((v) => v.id === vehicleId);
  const record = snapshot.vehicleDocuments?.find((r) => r.data.vehicleId === vehicleId);
  const target = record?.id ?? `documents-${vehicleId}`;
  const currentDocuments = {
    insuranceExpiryDate: vehicle?.insuranceExpiryDate ?? record?.data.insuranceExpiryDate ?? null,
    vehicleLicenceExpiryDate:
      vehicle?.vehicleLicenceExpiryDate ?? record?.data.vehicleLicenceExpiryDate ?? null,
    roadworthinessExpiryDate:
      vehicle?.roadworthinessExpiryDate ?? record?.data.roadworthinessExpiryDate ?? null
  };
  const issues = vehicleId
    ? vehicleDocumentIssues(
        {
          vehicleId,
          insuranceExpiryDate: currentDocuments.insuranceExpiryDate,
          vehicleLicenceExpiryDate: currentDocuments.vehicleLicenceExpiryDate,
          roadworthinessExpiryDate: currentDocuments.roadworthinessExpiryDate,
          reason: record?.data.reason ?? ""
        },
        snapshot.schoolRules?.data ?? DEFAULT_SCHOOL_RULES,
        lagosDay(new Date().toISOString())
      )
    : [];
  const documentStatus = (
    key: "insurance" | "vehicle-licence" | "roadworthiness",
    expiry?: string | null
  ) => {
    const issue = issues.find((item) => item.key === key);
    if (!expiry) return "Missing";
    if (!issue) return "Valid";
    return issue.status === "EXPIRED" ? "Expired" : "Expires soon";
  };
  return (
    <details className="dm-panel training-panel training-setting">
      <summary>Vehicle insurance and roadworthiness dates</summary>
      <p>
        Enter dates from the vehicle documents. Change reminder timing and warning/blocking options
        under School rules.
      </p>
      <label>
        Vehicle to update
        <select value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>
          <option value="">Choose vehicle</option>
          {snapshot.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber}
            </option>
          ))}
        </select>
      </label>
      {vehicleId && (
        <>
          <div className="vehicle-document-cards">
            {(
              [
                ["Insurance", "insurance", currentDocuments.insuranceExpiryDate],
                ["Vehicle licence", "vehicle-licence", currentDocuments.vehicleLicenceExpiryDate],
                ["Roadworthiness", "roadworthiness", currentDocuments.roadworthinessExpiryDate]
              ] as const
            ).map(([label, key, expiry]) => (
              <article key={key}>
                <h3>{label}</h3>
                <p>{expiry ? `Expires ${expiry}` : "Expiry date not entered"}</p>
                <strong>{documentStatus(key, expiry)}</strong>
              </article>
            ))}
          </div>
          <EntryForm
            key={`${vehicleId}-${record?.version ?? -1}`}
            title="Save vehicle document dates"
            disabled={pending(target)}
            onSave={(f) =>
              onSave(
                "VEHICLE_DOCUMENTS",
                target,
                {
                  vehicleId,
                  insuranceExpiryDate: String(f.get("insuranceExpiryDate") ?? ""),
                  vehicleLicenceExpiryDate: String(f.get("vehicleLicenceExpiryDate") ?? ""),
                  roadworthinessExpiryDate: String(f.get("roadworthinessExpiryDate") ?? ""),
                  reason: String(f.get("reason") ?? "")
                },
                record?.version
              )
            }
          >
            <Field
              label="Insurance expiry date"
              name="insuranceExpiryDate"
              type="date"
              required={false}
              initial={currentDocuments.insuranceExpiryDate ?? ""}
            />
            <Field
              label="Vehicle licence expiry date"
              name="vehicleLicenceExpiryDate"
              type="date"
              required={false}
              initial={currentDocuments.vehicleLicenceExpiryDate ?? ""}
            />
            <Field
              label="Roadworthiness expiry date"
              name="roadworthinessExpiryDate"
              type="date"
              required={false}
              initial={currentDocuments.roadworthinessExpiryDate ?? ""}
            />
            <Field label="Reason for updating vehicle documents" name="reason" />
            {pending(target) && (
              <p>Your document change is waiting to be sent. Current school rules still apply.</p>
            )}
          </EntryForm>
        </>
      )}
    </details>
  );
}
