import { lagosDay, type SchoolRules } from "./schoolRules.js";
export interface VehicleDocuments {
  vehicleId: string;
  insuranceExpiryDate: string | null;
  roadworthinessExpiryDate: string | null;
  reason: string;
}
export interface TrainingExpense {
  category: string;
  date: string;
  amount: string;
  basis: "RECORDED" | "ESTIMATE";
  allocations: { studentId: string; amount: string }[];
  reason: string;
  voidReason?: string;
}
export interface DocumentReminder {
  key: string;
  label: string;
  expiresOn: string | null;
  daysLeft: number | null;
  status: "MISSING" | "EXPIRED" | "DUE";
  blocked: boolean;
}
export function expiryReminder(
  key: string,
  label: string,
  expiry: string | null,
  reminderDays: number,
  action: "WARN" | "BLOCK",
  day: string
): DocumentReminder | null {
  if (!expiry)
    return {
      key,
      label,
      expiresOn: null,
      daysLeft: null,
      status: "MISSING",
      blocked: action === "BLOCK"
    };
  const daysLeft = Math.round((Date.parse(expiry) - Date.parse(day)) / 86400000);
  if (daysLeft > reminderDays) return null;
  return {
    key,
    label,
    expiresOn: expiry,
    daysLeft,
    status: daysLeft < 0 ? "EXPIRED" : "DUE",
    blocked: daysLeft < 0 && action === "BLOCK"
  };
}
export function vehicleDocumentIssues(
  documents: VehicleDocuments | undefined,
  rules: SchoolRules,
  day: string
) {
  return [
    expiryReminder(
      "insurance",
      "Vehicle insurance",
      documents?.insuranceExpiryDate ?? null,
      rules.vehicleReminderDays ?? 30,
      rules.vehicleExpiryAction ?? "WARN",
      day
    ),
    expiryReminder(
      "roadworthiness",
      "Vehicle roadworthiness",
      documents?.roadworthinessExpiryDate ?? null,
      rules.vehicleReminderDays ?? 30,
      rules.vehicleExpiryAction ?? "WARN",
      day
    )
  ].filter((r): r is DocumentReminder => r !== null);
}
export function schoolDocumentReminders(
  snapshot: {
    schoolRules?: { data: SchoolRules } | null;
    instructorPermitDates?: { instructorId: string; expiresOn: string | null }[];
    instructors: { id: string; name: string }[];
    vehicles: { id: string; plateNumber: string }[];
    vehicleDocuments?: { data: VehicleDocuments }[];
  },
  now = new Date()
): DocumentReminder[] {
  const day = lagosDay(now.toISOString()),
    rules = snapshot.schoolRules?.data;
  const results: DocumentReminder[] = [];
  for (const row of snapshot.instructorPermitDates ?? []) {
    const name = snapshot.instructors.find((i) => i.id === row.instructorId)?.name ?? "Instructor";
    const reminder = expiryReminder(
      `instructor-${row.instructorId}`,
      `${name}: instructor permit`,
      row.expiresOn,
      rules?.permitReminderDays ?? 30,
      rules?.permitExpiryAction ?? "WARN",
      day
    );
    if (reminder) results.push(reminder);
  }
  // Undefined means an older offline snapshot: do not invent missing document records.
  if (snapshot.vehicleDocuments)
    for (const vehicle of snapshot.vehicles) {
      const docs = snapshot.vehicleDocuments.find((r) => r.data.vehicleId === vehicle.id)?.data;
      for (const [field, label] of [
        ["insuranceExpiryDate", "insurance"],
        ["roadworthinessExpiryDate", "roadworthiness"]
      ] as const) {
        const reminder = expiryReminder(
          `${vehicle.id}-${field}`,
          `${vehicle.plateNumber}: ${label}`,
          docs?.[field] ?? null,
          rules?.vehicleReminderDays ?? 30,
          rules?.vehicleExpiryAction ?? "WARN",
          day
        );
        if (reminder) results.push(reminder);
      }
    }
  return results.sort(
    (a, b) =>
      (a.daysLeft ?? -Infinity) - (b.daysLeft ?? -Infinity) || a.label.localeCompare(b.label)
  );
}
