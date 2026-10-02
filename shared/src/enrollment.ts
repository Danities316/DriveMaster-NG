import type { SchoolRules } from "./schoolRules.js";
import type { TrainingPackage, TrainingRecord } from "./training.js";
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const INTAKE_FIELDS = [
  ["firstName", "First name"],
  ["middleName", "Other names"],
  ["lastName", "Surname"],
  ["phone", "Phone number"],
  ["email", "Email address"],
  ["dateOfBirth", "Date of birth"],
  ["sex", "Sex"],
  ["maritalStatus", "Marital status"],
  ["address", "Home address"],
  ["state", "State of residence"],
  ["lga", "Local government of residence"],
  ["nationality", "Nationality"],
  ["stateOfOrigin", "State of origin"],
  ["occupation", "Occupation"],
  ["heightCm", "Height in centimetres"],
  ["nin", "NIN (11 digits)"],
  ["bloodGroup", "Blood group"],
  ["learnerPermitNumber", "Learner’s permit number"],
  ["nextOfKinName", "Next of kin: name"],
  ["nextOfKinPhone", "Next of kin: phone number"],
  ["nextOfKinRelationship", "Next of kin: relationship"],
  ["licenceClass", "Preferred licence class"],
  ["preferredCentre", "Preferred licence processing centre"],
  ["licenceValidity", "Preferred licence validity"]
] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number][0];
export type ApplicantDetails = Record<IntakeField, string>;
export interface EnrollmentSettings {
  enabled: boolean;
  welcome: string;
  packageIds: string[];
  requiredFields: IntakeField[];
  allowUnpaidStart: boolean;
  reason: string;
}
export const DEFAULT_ENROLLMENT_SETTINGS: EnrollmentSettings = {
  enabled: false,
  welcome: "Fill in your details. Our office will help you with payment and your first lesson.",
  packageIds: [],
  requiredFields: [],
  allowUnpaidStart: false,
  reason: "Starting enrollment settings"
};
export interface PublicEnrollmentInfo {
  school: { id: string; name: string; phone: string };
  settings: Pick<EnrollmentSettings, "welcome" | "requiredFields">;
  settingsVersion: number;
  rulesVersion: number;
  schoolTargetDays: number;
  packages: TrainingRecord<TrainingPackage>[];
}
export interface EnrollmentApplicationView {
  id: string;
  name: string;
  phone: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "REJECTED";
  version: number;
  createdAt: string;
  studentId: string | null;
  packageSnapshot: TrainingPackage;
  rulesSnapshot: SchoolRules;
  details?: ApplicantDetails;
  paid: string;
  reviewReason: string | null;
}
