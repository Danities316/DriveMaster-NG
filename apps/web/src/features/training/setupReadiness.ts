import type { TrainingSnapshot } from "@drivemaster/shared";

export function trainingSetupReadiness(snapshot: TrainingSnapshot, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  return {
    packages: snapshot.packages.length > 0,
    instructors: snapshot.instructors.length > 0,
    vehicles: snapshot.vehicles.length > 0,
    instructorPay:
      snapshot.instructors.length > 0 &&
      snapshot.instructors.every((instructor) =>
        snapshot.salaries.some(
          (salary) => salary.data.instructorId === instructor.id && salary.data.month === month
        )
      ),
    students: snapshot.students.length > 0,
    enrollments: snapshot.enrollments.length > 0,
    firstBooking: snapshot.outings.some((outing) => outing.data.status !== "CANCELLED")
  };
}
