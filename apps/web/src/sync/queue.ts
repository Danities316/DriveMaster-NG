import type { OutboxMutationRecord } from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";

export const SYNC_WAKE = "drivemaster:sync-request";
export function requestSync(): void {
  window.dispatchEvent(new Event(SYNC_WAKE));
}
export function studentIdOf(entry: OutboxMutationRecord): string | undefined {
  const data = entry.payload as { id?: string; studentId?: string } | null;
  return entry.entity === "student" ? data?.id : data?.studentId;
}
export function ordered(entries: OutboxMutationRecord[]): OutboxMutationRecord[] {
  return entries.sort(
    (a, b) => (a.sequence ?? Date.parse(a.createdAt)) - (b.sequence ?? Date.parse(b.createdAt))
  );
}
/** Called inside the same write transaction as the local business record. */
export async function enqueue(
  input: Pick<OutboxMutationRecord, "entity" | "action" | "payload"> & {
    schoolId: string;
    expectedVersion?: number;
    mutationId?: string;
  }
): Promise<OutboxMutationRecord> {
  const entries = ordered(await db.outbox.toArray());
  const data = input.payload as { id?: string; studentId?: string; vehicleId?: string };
  const studentId = input.entity === "student" ? data.id : data.studentId;
  const fleetPrevious = data.vehicleId
    ? entries
        .filter(
          (entry) =>
            entry.entity === "vehicle" &&
            entry.action === "CREATE" &&
            (entry.payload as { id?: string }).id === data.vehicleId
        )
        .at(-1)
    : undefined;
  const previous =
    fleetPrevious ??
    entries
      .filter((entry) => entry.entity === "student" && studentIdOf(entry) === studentId)
      .at(-1);
  const mutation: OutboxMutationRecord = {
    ...input,
    mutationId: input.mutationId ?? crypto.randomUUID(),
    deviceId: getOrCreateDeviceId(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "PENDING",
    sequence: Math.max(0, ...entries.map((entry) => entry.sequence ?? 0)) + 1,
    ...(previous ? { dependsOn: previous.mutationId } : {})
  };
  await db.outbox.add(mutation);
  return mutation;
}
