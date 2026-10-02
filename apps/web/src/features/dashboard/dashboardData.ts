import { addMoney, normalizeMoney, subtractMoney, sumMoney } from "@drivemaster/shared";
import type { OutboxMutationRecord, Payment, StudentWithBalance } from "@drivemaster/shared";
import { db } from "../../db/db";
import { getOrCreateDeviceId } from "../../lib/device";

export const naira = (value: string) => {
  const [whole, fraction] = normalizeMoney(value).split(".");
  return `₦${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
};
const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
export function schoolDay(value: Date | string): string {
  const parts = dayFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function summarize(
  schoolId: string,
  students: StudentWithBalance[],
  payments: Payment[],
  confirmed: Payment[],
  queue: OutboxMutationRecord[],
  now: Date
) {
  students = students.filter((row) => row.schoolId === schoolId);
  payments = payments.filter((row) => row.schoolId === schoolId);
  queue = queue.filter((row) => row.schoolId === schoolId);
  const queued = new Map(queue.map((row) => [row.mutationId, row]));
  const accepted = new Map(
    payments.filter((row) => !queued.has(row.id)).map((row) => [row.id, row])
  );
  for (const row of confirmed) if (row.schoolId === schoolId) accepted.set(row.id, row);
  const totalsByDay = new Map<string, string>();
  for (const row of accepted.values()) {
    const key = schoolDay(row.paymentDate);
    totalsByDay.set(key, addMoney(totalsByDay.get(key) ?? "0.00", row.amount));
  }
  const names = new Map(students.map((student) => [student.id, student.name]));
  const today = schoolDay(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    const key = schoolDay(date);
    return {
      key,
      label: date.toLocaleDateString("en-NG", { weekday: "short", timeZone: "Africa/Lagos" }),
      amount: totalsByDay.get(key) ?? "0.00"
    };
  });
  const owing = students
    .map((row) => ({ ...row, due: subtractMoney(row.totalTuition, row.amountPaid) }))
    .filter((row) => !row.due.startsWith("-") && row.due !== "0.00")
    .sort((a, b) => {
      const diff = subtractMoney(b.due, a.due);
      return diff === "0.00" ? a.name.localeCompare(b.name) : diff.startsWith("-") ? -1 : 1;
    });
  const rows = new Map(payments.map((row) => [row.id, row]));
  for (const [id, row] of accepted) rows.set(id, row);
  const paymentRows = [...rows.values()]
    .map((row) => ({
      ...row,
      studentName: names.get(row.studentId) ?? "Student unavailable",
      status: accepted.has(row.id)
        ? "Confirmed"
        : queued.get(row.id)?.status === "CONFLICT"
          ? "Conflict"
          : queued.get(row.id)?.status === "FAILED"
            ? "Needs review"
            : "Pending"
    }))
    .sort(
      (a, b) =>
        Date.parse(b.paymentDate) - Date.parse(a.paymentDate) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  return {
    students,
    owing,
    paymentRows,
    days,
    todayPaid: days[6]!.amount,
    weekPaid: sumMoney(days.map((day) => day.amount)),
    outstanding: sumMoney(owing.map((row) => row.due)),
    pending: queue.filter((row) => !["FAILED", "CONFLICT"].includes(row.status)).length,
    review: queue.filter((row) => ["FAILED", "CONFLICT"].includes(row.status)).length,
    pendingMoney: sumMoney(
      payments
        .filter(
          (row) =>
            queued.has(row.id) && !accepted.has(row.id) && queued.get(row.id)?.status !== "CONFLICT"
        )
        .map((row) => row.amount)
    )
  };
}
export async function loadDashboard(schoolId: string, now: Date) {
  return db.transaction(
    "r",
    db.students,
    db.payments,
    db.serverPayments,
    db.outbox,
    db.syncState,
    async () => {
      const [students, payments, confirmed, queue, sync] = await Promise.all([
        db.students.where("schoolId").equals(schoolId).toArray(),
        db.payments.where("schoolId").equals(schoolId).toArray(),
        db.serverPayments.where("schoolId").equals(schoolId).toArray(),
        db.outbox.where("schoolId").equals(schoolId).toArray(),
        db.syncState.get(getOrCreateDeviceId())
      ]);
      return { ...summarize(schoolId, students, payments, confirmed, queue, now), sync };
    }
  );
}
