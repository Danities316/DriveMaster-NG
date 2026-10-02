import type { TrainingOuting, TrainingRecord } from "@drivemaster/shared";

export type TrainingView = "all" | "today" | "active" | "waiting" | "problems";
export const lagosDay = (date: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(date));
export function matchesTrainingView(outing: TrainingOuting, view: TrainingView, now = new Date()) {
  if (view === "active") return outing.status === "STARTED";
  if (view === "today")
    return outing.status !== "CANCELLED" && lagosDay(outing.plannedStart) === lagosDay(now);
  if (view === "waiting") return outing.members.some((m) => m.status === "PENDING");
  if (view === "problems") return outing.members.some((m) => m.status === "DISPUTED");
  return true;
}

export function trainingGroups(
  rows: TrainingRecord<TrainingOuting>[],
  view: TrainingView,
  failedIds: ReadonlySet<string>,
  now = new Date()
) {
  const groups = [
    { id: "now", title: "Training now", rows: [] as TrainingRecord<TrainingOuting>[] },
    { id: "attention", title: "Needs attention", rows: [] as TrainingRecord<TrainingOuting>[] },
    {
      id: "upcoming",
      title: view === "today" ? "Coming up" : "Scheduled training",
      rows: [] as TrainingRecord<TrainingOuting>[]
    },
    {
      id: "completed",
      title: view === "today" ? "Completed today" : "Completed training",
      rows: [] as TrainingRecord<TrainingOuting>[]
    },
    { id: "cancelled", title: "Cancelled bookings", rows: [] as TrainingRecord<TrainingOuting>[] }
  ];
  // Ongoing work remains actionable even when its booking date was yesterday.
  for (const row of rows.filter(
    (r) =>
      matchesTrainingView(r.data, view, now) || (view === "today" && r.data.status === "STARTED")
  )) {
    const group =
      row.data.status === "STARTED"
        ? 0
        : failedIds.has(row.id) || row.data.members.some((m) => m.status === "DISPUTED")
          ? 1
          : row.data.status === "BOOKED"
            ? 2
            : row.data.status === "COMPLETED"
              ? 3
              : 4;
    groups[group]!.rows.push(row);
  }
  for (const group of groups)
    group.rows.sort((a, b) => Date.parse(a.data.plannedStart) - Date.parse(b.data.plannedStart));
  return groups.filter((g) => g.rows.length);
}
