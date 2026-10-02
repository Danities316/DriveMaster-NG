import type { AuthenticatedUser } from "@drivemaster/shared";
import { db } from "../db/db";

const SCHOOL_KEY = "drivemaster:localSchool";

/** Preserve unsent work: switching accounts must never silently discard the outbox. */
export async function prepareLocalSchool(user: AuthenticatedUser): Promise<void> {
  const previous = localStorage.getItem(SCHOOL_KEY);
  await db.transaction("rw", db.tables, async () => {
    const records = (
      await Promise.all([
        db.students.toArray(),
        db.payments.toArray(),
        db.vehicles.toArray(),
        db.fuelLogs.toArray(),
        db.mileageLogs.toArray(),
        db.sessionBookings.toArray(),
        db.trainingCache.toArray(),
        db.trainingQueue.toArray()
      ])
    ).flat();
    const foreignData = records.some((record) => record.schoolId !== user.schoolId);
    if ((previous && previous !== user.schoolId) || foreignData) {
      if ((await db.outbox.count()) || (await db.trainingQueue.count())) {
        throw new Error(
          "This device has saved work waiting for another school. Sign in to that school and send its saved records before switching."
        );
      }
      for (const table of db.tables) await table.clear();
    }
  });
  localStorage.setItem(SCHOOL_KEY, user.schoolId);
}
