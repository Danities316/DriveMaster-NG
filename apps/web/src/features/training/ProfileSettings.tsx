import { useState } from "react";
import {
  validInstructorLicence,
  validInstructorNin,
  type SchoolProfileResponse
} from "@drivemaster/shared";
import { trainingRequest } from "./trainingLocal";
import { EntryForm, Field } from "./TrainingFields";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
export function ProfileSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const [profiles, setProfiles] = useState<SchoolProfileResponse>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const instructor = profiles?.instructors.find((row) => row.id === selected);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const result: SchoolProfileResponse = await trainingRequest("profiles");
      setProfiles(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load profiles.");
    } finally {
      setBusy(false);
    }
  }
  async function save(path: string, data: unknown) {
    setMessage("");
    if (!navigator.onLine)
      throw new Error(
        "Connect to the internet to save these private details. They are not saved offline."
      );
    await trainingRequest(`profiles/${path}`, data);
    setProfiles(undefined);
    setMessage("Profile saved on the school server.");
    await load();
    await onSaved();
  }
  return (
    <details className="dm-panel training-panel training-setting">
      <summary>School and instructor details</summary>
      <p>
        Add your school registration numbers and instructors’ identity details. Only the owner can
        open this section. Internet is needed; these private details are not saved in the offline
        records.
      </p>
      <button type="button" className="dm-secondary" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading profiles…" : "Load profiles"}
      </button>
      {error && (
        <p className="fleet-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {profiles && (
        <>
          <EntryForm
            key={`school-${profiles.school.profileVersion}`}
            title="Save school details"
            onSave={(f) =>
              save("school", {
                school_cac_rc: value(f, "school_cac_rc"),
                frsc_accreditation_number: value(f, "frsc_accreditation_number"),
                expectedVersion: profiles.school.profileVersion,
                reason: value(f, "reason")
              })
            }
          >
            <p>{profiles.school.name}. You can leave a number blank and complete it later.</p>
            <Field
              label="CAC registration number"
              name="school_cac_rc"
              initial={profiles.school.school_cac_rc ?? ""}
              required={false}
            />
            <Field
              label="FRSC accreditation number"
              name="frsc_accreditation_number"
              initial={profiles.school.frsc_accreditation_number ?? ""}
              required={false}
            />
            <Field label="Reason for this school update" name="reason" />
          </EntryForm>
          <label>
            Instructor to update
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose instructor</option>
              {profiles.instructors.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {!profiles.instructors.length && (
            <p>Create an instructor login below, then load profiles again.</p>
          )}
          {instructor && (
            <EntryForm
              key={`${instructor.id}-${instructor.profileVersion}`}
              title="Save instructor details"
              onSave={async (f) => {
                const nin = value(f, "nin"),
                  licence = value(f, "drivers_license_number").toUpperCase();
                if (nin && !validInstructorNin(nin))
                  throw new Error("NIN must contain exactly 11 digits.");
                if (licence && !validInstructorLicence(licence))
                  throw new Error(
                    "Use the format YEN12801AA01: 3 letters, 5 digits, 2 letters and 2 digits."
                  );
                await save(`instructor/${encodeURIComponent(instructor.id)}`, {
                  nin,
                  drivers_license_number: licence,
                  permitExpiryDate: value(f, "permitExpiryDate"),
                  expectedVersion: instructor.profileVersion,
                  reason: value(f, "reason")
                });
              }}
            >
              <p>
                These checks confirm the format only. They do not verify the number with FRSC or
                NIMC. Missing details can be completed later; your school rules control whether
                training can proceed.
              </p>
              <Field
                label="Driver’s licence number"
                name="drivers_license_number"
                initial={instructor.drivers_license_number ?? ""}
                required={false}
              />
              <label>
                NIN (11 digits)
                <input
                  name="nin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  minLength={11}
                  maxLength={11}
                  defaultValue={instructor.nin ?? ""}
                />
              </label>
              <Field
                label="Instructor permit expiry date"
                name="permitExpiryDate"
                type="date"
                initial={instructor.permitExpiryDate ?? ""}
                required={false}
              />
              <Field label="Reason for this instructor update" name="reason" />
            </EntryForm>
          )}
        </>
      )}
    </details>
  );
}
