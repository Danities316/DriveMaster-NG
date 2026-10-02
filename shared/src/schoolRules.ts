import { isValidDate } from "./validation.js";

// User-supplied reference, not a claim of live FRSC verification.
export const RECORDED_DSSP_MINIMUM_DAYS = 26;
export interface SchoolRules {
  vehicleExpiryAction?: "WARN" | "BLOCK";
  vehicleReminderDays?: number;
  schoolTargetDays: number;
  requireInstructorNin: boolean;
  requireInstructorLicence: boolean;
  permitExpiryAction: "WARN" | "BLOCK";
  permitReminderDays: number;
  reason: string;
}
export const DEFAULT_SCHOOL_RULES: SchoolRules = {
  vehicleExpiryAction: "WARN",
  vehicleReminderDays: 30,
  schoolTargetDays: 26,
  requireInstructorNin: false,
  requireInstructorLicence: false,
  permitExpiryAction: "WARN",
  permitReminderDays: 30,
  reason: "Starting school rules"
};
export interface InstructorDocuments {
  drivers_license_number: string | null;
  nin: string | null;
  permitExpiryDate: string | null;
}
export interface SchoolProfileResponse {
  school: {
    id: string;
    name: string;
    school_cac_rc: string | null;
    frsc_accreditation_number: string | null;
    profileVersion: number;
  };
  instructors: (InstructorDocuments & { id: string; name: string; profileVersion: number })[];
}
export function validInstructorNin(value: string): boolean {
  return /^\d{11}$/.test(value);
}
export function validInstructorLicence(value: string): boolean {
  return /^[A-Z]{3}\d{5}[A-Z]{2}\d{2}$/.test(value);
}
export function validPermitDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValidDate(value);
}
export function lagosDay(value: string): string {
  return new Date(Date.parse(value) + 3600000).toISOString().slice(0, 10);
}
export function instructorDocumentIssues(
  documents: InstructorDocuments,
  rules: SchoolRules,
  day: string
): { message: string; blocked: boolean }[] {
  const issues: { message: string; blocked: boolean }[] = [];
  if (!documents.nin && rules.requireInstructorNin)
    issues.push({
      message: "Instructor NIN is missing. Ask the owner to complete the profile.",
      blocked: true
    });
  if (!documents.drivers_license_number && rules.requireInstructorLicence)
    issues.push({
      message: "Instructor licence number is missing. Ask the owner to complete the profile.",
      blocked: true
    });
  const expiry = documents.permitExpiryDate;
  if (!expiry || expiry < day) {
    issues.push({
      message: expiry
        ? "Instructor permit has expired. Ask the owner to update it."
        : "Instructor permit expiry date has not been entered.",
      blocked: rules.permitExpiryAction === "BLOCK"
    });
  } else {
    const days = Math.round((Date.parse(expiry) - Date.parse(day)) / 86400000);
    if (days <= rules.permitReminderDays)
      issues.push({
        message: `Instructor permit expires in ${days} day${days === 1 ? "" : "s"}.`,
        blocked: false
      });
  }
  return issues;
}
