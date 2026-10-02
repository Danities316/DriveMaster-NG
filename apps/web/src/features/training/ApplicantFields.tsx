import {
  BLOOD_GROUPS,
  INTAKE_FIELDS,
  type ApplicantDetails,
  type IntakeField
} from "@drivemaster/shared";
const choices: Partial<Record<IntakeField, readonly string[]>> = {
  bloodGroup: BLOOD_GROUPS,
  sex: ["Male", "Female"],
  maritalStatus: ["Single", "Married", "Divorced", "Widowed"],
  licenceClass: ["A", "B", "C", "D", "E", "F", "G", "H", "J"],
  licenceValidity: ["3 years", "5 years"]
};
export function ApplicantFields({
  fields,
  details,
  onChange,
  requiredFields = []
}: {
  fields: readonly IntakeField[];
  details: ApplicantDetails;
  onChange: (key: IntakeField, value: string) => void;
  requiredFields?: readonly IntakeField[];
}) {
  return (
    <>
      {fields.map((key) => {
        const required =
          ["firstName", "lastName", "phone"].includes(key) || requiredFields.includes(key);
        const label = INTAKE_FIELDS.find(([field]) => field === key)![1];
        return (
          <label key={key}>
            {label}
            {required ? " *" : " (optional)"}
            {choices[key] ? (
              <select
                value={details[key]}
                required={required}
                onChange={(e) => onChange(key, e.target.value)}
              >
                <option value="">
                  {key === "bloodGroup" ? "Choose only if you know it" : "Choose an option"}
                </option>
                {choices[key]!.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={details[key]}
                required={required}
                onChange={(e) => onChange(key, e.target.value)}
                type={
                  key === "nin"
                    ? "password"
                    : key === "dateOfBirth"
                      ? "date"
                      : key === "email"
                        ? "email"
                        : key.toLowerCase().includes("phone")
                          ? "tel"
                          : key === "heightCm"
                            ? "number"
                            : "text"
                }
                inputMode={key === "nin" ? "numeric" : undefined}
                pattern={key === "nin" ? "[0-9]{11}" : undefined}
                minLength={key === "nin" ? 11 : undefined}
                maxLength={key === "nin" ? 11 : 500}
                min={key === "heightCm" ? 50 : undefined}
                max={key === "heightCm" ? 250 : undefined}
                autoComplete={key === "nin" ? "off" : undefined}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
