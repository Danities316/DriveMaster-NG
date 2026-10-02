import { INTAKE_FIELDS, type ApplicantDetails, type IntakeField } from "@drivemaster/shared";
export const emptyApplicant = (): ApplicantDetails =>
  Object.fromEntries(INTAKE_FIELDS.map(([key]) => [key, ""])) as ApplicantDetails;
export const applicantSteps: IntakeField[][] = [
  ["firstName", "middleName", "lastName", "phone", "email", "dateOfBirth", "sex", "maritalStatus"],
  [
    "address",
    "state",
    "lga",
    "nationality",
    "stateOfOrigin",
    "occupation",
    "nextOfKinName",
    "nextOfKinPhone",
    "nextOfKinRelationship"
  ],
  [
    "nin",
    "bloodGroup",
    "heightCm",
    "learnerPermitNumber",
    "licenceClass",
    "licenceValidity",
    "preferredCentre"
  ]
];
