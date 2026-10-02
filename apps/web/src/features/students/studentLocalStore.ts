import type { StudentWithBalance } from "@drivemaster/shared";
import { db } from "../../db/db";
import { withPendingPayments } from "./localConsistency";

/**
 * Reads directly from Dexie — this is what makes the student list/detail
 * screens work fully offline (PRD §11: "Dexie/IndexedDB is the local
 * source of truth for immediate operations"). Intended to be called from
 * `useLiveQuery(() => queryLocalStudents(...), [schoolId, search])` so
 * the UI updates reactively whenever the underlying table changes.
 */
export async function queryLocalStudents(
  schoolId: string,
  search?: string
): Promise<StudentWithBalance[]> {
  const records = await db.students.where("schoolId").equals(schoolId).toArray();
  const all = await Promise.all(records.map(withPendingPayments));
  if (!search) {
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }
  const term = search.trim().toLowerCase();
  return all
    .filter((s) => s.name.toLowerCase().includes(term) || s.phone.includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLocalStudent(id: string): Promise<StudentWithBalance | null> {
  const student = await db.students.get(id);
  return student ?? null;
}
