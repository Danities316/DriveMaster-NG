import type {
  AuthenticatedUser,
  OutboxMutationRecord,
  SyncBatchResponse,
  SyncMutation,
  SyncPullResponse,
  SyncState
} from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";
import { getCachedUser } from "../lib/auth";
import { ordered, studentIdOf, SYNC_WAKE, requestSync } from "./queue";
import { projectStudent, rebaseDependents, storeChange, storeResult } from "./projection";

const API = `${import.meta.env["VITE_API_BASE_URL"] ?? "/api"}/v1/sync`;
export const RETRY_DELAYS = [5000, 30000, 120000, 600000] as const;
class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Sign in again to send your saved work."
        : status === 403
          ? "Your current account cannot send this school's saved changes."
          : "The server is unavailable. Your changes remain on this device."
    );
  }
}
async function json<T>(path: string, init: RequestInit, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  try {
    if (parent?.aborted) controller.abort();
    const response = await fetch(`${API}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal
    });
    if (!response.ok) throw new SyncHttpError(response.status);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  }
}

/** A durable, fenced lease coordinates tabs and recovers after crashes; no reliance on in-memory flags. */
export async function synchronize(
  user: AuthenticatedUser,
  options: { now?: () => number; signal?: AbortSignal; isCurrent?: () => boolean } = {}
): Promise<void> {
  if (!["OWNER", "RECEPTIONIST"].includes(user.role) || navigator.onLine === false) return;
  const now = options.now ?? Date.now;
  const active = () => !options.signal?.aborted && (options.isCurrent?.() ?? true);
  if (!active()) return;
  const owner = crypto.randomUUID();
  const deviceId = getOrCreateDeviceId();
  const acquired = await db.transaction("rw", db.syncLease, db.outbox, async () => {
    const lease = await db.syncLease.get("sync");
    if (lease && lease.expiresAt > now()) return false;
    await db.syncLease.put({ key: "sync", owner, expiresAt: now() + 60000 });
    for (const entry of await db.outbox.toArray()) {
      if (entry.schoolId === user.schoolId && entry.status === "SYNCING")
        await db.outbox.update(entry.mutationId, { status: "PENDING" });
    }
    return true;
  });
  if (!acquired) return;
  async function locked<T>(work: () => Promise<T>): Promise<T> {
    return db.transaction("rw", db.tables, async () => {
      if (!active() || (await db.syncLease.get("sync"))?.owner !== owner)
        throw new Error("Synchronization session changed.");
      await db.syncLease.update("sync", { expiresAt: now() + 60000 });
      return work();
    });
  }
  let state: SyncState = (await db.syncState.get(deviceId)) ?? {
    deviceId,
    schoolId: user.schoolId,
    lastPulledCursor: null,
    lastSyncAt: null
  };
  async function saveState(patch: Partial<SyncState>): Promise<void> {
    const stored = await db.syncState.get(deviceId);
    await db.syncState.put({ ...state, ...stored, ...patch, schoolId: user.schoolId });
  }
  async function pull(): Promise<boolean> {
    for (let page = 0; page < 50; page++) {
      const cursor = state.lastPulledCursor ?? "0";
      await locked(() => saveState({ nextPullAt: now() + 15000 }));
      const response = await json<SyncPullResponse>(
        `/changes?schoolId=${encodeURIComponent(user.schoolId)}&cursor=${cursor}&limit=100`,
        {},
        options.signal
      );
      if (
        !Array.isArray(response.changes) ||
        !/^\d+$/.test(response.nextCursor) ||
        typeof response.hasMore !== "boolean"
      )
        throw new Error("Invalid synchronization response. Your cursor was preserved.");
      let previous = BigInt(cursor);
      for (const change of response.changes) {
        if (
          !/^\d+$/.test(change.cursor) ||
          BigInt(change.cursor) <= previous ||
          change.record?.schoolId !== user.schoolId ||
          !["student", "payment", "vehicle", "fuel_log", "mileage_log"].includes(change.entity) ||
          !["CREATE", "UPDATE", "DELETE"].includes(change.action) ||
          typeof change.record.id !== "string"
        )
          throw new Error("Invalid change response. No data was applied.");
        previous = BigInt(change.cursor);
      }
      if (
        previous !== BigInt(response.nextCursor) ||
        (response.hasMore && !response.changes.length)
      )
        throw new Error("Invalid synchronization cursor.");
      await locked(async () => {
        for (const change of response.changes) await storeChange(change);
        const complete = state.bootstrapComplete || !response.hasMore;
        await saveState({
          lastPulledCursor: response.nextCursor,
          bootstrapComplete: complete,
          lastError: undefined,
          authRequired: false,
          ...(!response.hasMore ? { lastSyncAt: new Date(now()).toISOString() } : {})
        });
        const ids = new Set(
          response.changes
            .filter((change) => change.entity === "student" || change.entity === "payment")
            .map((change) =>
              change.entity === "student"
                ? change.record.id
                : change.entity === "payment"
                  ? change.record.studentId
                  : ""
            )
        );
        if (!response.hasMore)
          for (const student of await db.students.where("schoolId").equals(user.schoolId).toArray())
            ids.add(student.id);
        for (const id of ids) await projectStudent(id, Boolean(complete));
      });
      state = (await db.syncState.get(deviceId)) ?? state;
      if (!response.hasMore) return true;
    }
    return false; // Resume this cursor on the next tick; never monopolize a tab indefinitely.
  }
  try {
    if (state.schoolId && state.schoolId !== user.schoolId)
      throw new Error("Local synchronization belongs to another school.");
    if (state.authRequired) return;
    // First installation/bootstrap restores complete financial history before processing queued work.
    if (!state.bootstrapComplete) {
      if ((state.nextPullAt ?? 0) > now() || !(await pull())) return;
    }
    let didPush = false;
    for (let count = 0; count < 100 && active(); count++) {
      const entry = await locked(async () => {
        const all = ordered(await db.outbox.toArray());
        const ids = new Set(all.map((mutation) => mutation.mutationId));
        const next = all.find(
          (mutation) =>
            mutation.schoolId === user.schoolId &&
            mutation.status === "PENDING" &&
            (mutation.nextAttemptAt ?? 0) <= now() &&
            (!mutation.dependsOn || !ids.has(mutation.dependsOn))
        );
        if (!next) return undefined;
        if (next.retryCount >= 5) {
          await db.outbox.update(next.mutationId, { status: "FAILED" });
          return undefined;
        }
        await db.outbox.update(next.mutationId, {
          status: "SYNCING",
          retryCount: next.retryCount + 1
        });
        return next;
      });
      if (!entry) break;
      try {
        const mutation: SyncMutation = {
          mutationId: entry.mutationId,
          deviceId: entry.deviceId,
          schoolId: user.schoolId,
          entity: entry.entity,
          action: entry.action,
          payload: entry.payload,
          ...(entry.expectedVersion !== undefined ? { expectedVersion: entry.expectedVersion } : {})
        };
        const response = await json<SyncBatchResponse>(
          "/batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mutations: [mutation] })
          },
          options.signal
        );
        if (
          !Array.isArray(response.processedIds) ||
          !Array.isArray(response.results) ||
          !Array.isArray(response.conflicts) ||
          !Array.isArray(response.failures)
        )
          throw new Error("The server did not acknowledge this change.");
        const result = response.results.find((item) => item.mutationId === entry.mutationId);
        const conflict = response.conflicts.find((item) => item.mutationId === entry.mutationId);
        const failure = response.failures.find((item) => item.mutationId === entry.mutationId);
        const acknowledged = response.processedIds.includes(entry.mutationId) && result;
        if (
          Number(Boolean(acknowledged)) + Number(Boolean(conflict)) + Number(Boolean(failure)) !==
          1
        )
          throw new Error("The server did not acknowledge this change unambiguously.");
        if (
          result &&
          ((result.student?.schoolId && result.student.schoolId !== user.schoolId) ||
            (result.payment?.schoolId && result.payment.schoolId !== user.schoolId) ||
            (result.vehicle && result.vehicle.schoolId !== user.schoolId) ||
            (result.fuelLog && result.fuelLog.schoolId !== user.schoolId) ||
            (result.mileageLog && result.mileageLog.schoolId !== user.schoolId))
        )
          throw new Error("The acknowledgement belongs to another school.");
        await locked(async () => {
          if (acknowledged && result) {
            if (
              entry.entity === "student"
                ? result.student?.id !== studentIdOf(entry)
                : (entry.entity === "vehicle"
                    ? result.vehicle?.id
                    : entry.entity === "fuel_log"
                      ? result.fuelLog?.id
                      : entry.entity === "mileage_log"
                        ? result.mileageLog?.id
                        : result.payment?.id) !== (entry.payload as { id?: string }).id
            )
              throw new Error("Invalid record acknowledgement.");
            await storeResult(result);
            await rebaseDependents(entry, result);
            await db.outbox.delete(entry.mutationId);
            didPush = true;
          } else if (conflict) {
            await db.outbox.update(entry.mutationId, {
              status: "CONFLICT",
              lastError: conflict.message,
              serverStudent:
                conflict.serverStudent?.schoolId === user.schoolId
                  ? conflict.serverStudent
                  : undefined
            });
          } else if (failure)
            await db.outbox.update(entry.mutationId, {
              status: "FAILED",
              lastError: failure.message
            });
          const id = studentIdOf(entry);
          if (id) await projectStudent(id, true);
          await saveState({ lastError: undefined });
        });
      } catch (error) {
        if (!active()) return;
        await locked(async () => {
          const auth = error instanceof SyncHttpError && [401, 403].includes(error.status);
          const attempts = entry.retryCount + 1;
          const permanent =
            error instanceof SyncHttpError &&
            error.status >= 400 &&
            error.status < 500 &&
            ![401, 403, 408, 429].includes(error.status);
          const message = error instanceof Error ? error.message : "Unable to synchronize.";
          await db.outbox.update(entry.mutationId, {
            status: !auth && (permanent || attempts >= 5) ? "FAILED" : "PENDING",
            retryCount: auth ? entry.retryCount : attempts,
            nextAttemptAt: now() + (RETRY_DELAYS[Math.min(attempts - 1, 3)] ?? 600000),
            lastError: message
          });
          await saveState({ lastError: message, authRequired: auth });
        });
        return;
      }
    }
    if (didPush || (state.nextPullAt ?? 0) <= now()) await pull();
  } catch (error) {
    if (active()) {
      try {
        await locked(() =>
          saveState({
            lastError: error instanceof Error ? error.message : "Unable to synchronize.",
            nextPullAt: now() + 15000,
            authRequired: error instanceof SyncHttpError && [401, 403].includes(error.status)
          })
        );
      } catch {
        /* Lost lease/session; next owner recovers. */
      }
    }
  } finally {
    await db.transaction("rw", db.syncLease, async () => {
      if ((await db.syncLease.get("sync"))?.owner === owner) await db.syncLease.delete("sync");
    });
  }
}

export function startSync(user: AuthenticatedUser): () => void {
  if (!["OWNER", "RECEPTIONIST"].includes(user.role)) return () => {};
  let stopped = false;
  let running = false;
  const abort = new AbortController();
  const isCurrent = () => {
    const current = getCachedUser();
    return (
      !stopped &&
      current?.id === user.id &&
      current.schoolId === user.schoolId &&
      current.role === user.role
    );
  };
  const run = () => {
    if (running || !isCurrent()) return;
    running = true;
    void synchronize(user, { signal: abort.signal, isCurrent })
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  };
  void db.syncState
    .update(getOrCreateDeviceId(), { authRequired: false })
    .then(run)
    .catch(() => {});
  const timer = setInterval(run, 15000);
  // A 1s wake checks persisted deadlines; attempts still follow the defined backoff schedule.
  const retryTimer = setInterval(() => {
    void db.outbox
      .where("status")
      .equals("PENDING")
      .count()
      .then((count) => {
        if (count) run();
      })
      .catch(() => {});
  }, 1000);
  window.addEventListener("online", run);
  window.addEventListener(SYNC_WAKE, run);
  document.addEventListener("visibilitychange", run);
  return () => {
    stopped = true;
    abort.abort();
    clearInterval(timer);
    clearInterval(retryTimer);
    window.removeEventListener("online", run);
    window.removeEventListener(SYNC_WAKE, run);
    document.removeEventListener("visibilitychange", run);
  };
}

export async function retryFailed(schoolId: string): Promise<void> {
  await db.transaction("rw", db.outbox, db.syncState, async () => {
    for (const entry of await db.outbox.where("schoolId").equals(schoolId).toArray())
      if (["FAILED", "PENDING"].includes(entry.status))
        await db.outbox.update(entry.mutationId, {
          status: "PENDING",
          retryCount: entry.status === "FAILED" ? 0 : entry.retryCount,
          nextAttemptAt: 0,
          lastError: undefined
        });
    await db.syncState.update(getOrCreateDeviceId(), {
      authRequired: false,
      lastError: undefined,
      nextPullAt: 0
    });
  });
  requestSync();
}

export async function resolveStudentConflict(
  id: string,
  keepLocal: boolean,
  schoolId: string
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const entry = await db.outbox.get(id);
    if (
      entry?.schoolId !== schoolId ||
      entry.status !== "CONFLICT" ||
      entry.entity !== "student" ||
      entry.action !== "UPDATE" ||
      !entry.serverStudent
    )
      return;
    const remote = await db.serverStudents.get(entry.serverStudent.id);
    const server =
      remote && (remote.version ?? 0) >= (entry.serverStudent.version ?? 0)
        ? remote
        : entry.serverStudent;
    if (keepLocal && server.version !== entry.serverStudent.version) {
      await db.outbox.update(id, {
        serverStudent: server,
        lastError: "The server record changed again. Review the updated details before choosing."
      });
      return;
    }
    await db.serverStudents.put(server);
    if (keepLocal) {
      // A reviewed replacement gets a new idempotency key; the old request is never rewritten and replayed.
      const replacement: OutboxMutationRecord = {
        ...entry,
        mutationId: crypto.randomUUID(),
        expectedVersion: server.version,
        status: "PENDING",
        retryCount: 0,
        nextAttemptAt: 0,
        lastError: undefined,
        serverStudent: undefined
      };
      await db.outbox.add(replacement);
      for (const dependent of await db.outbox.toArray())
        if (dependent.dependsOn === id)
          await db.outbox.update(dependent.mutationId, { dependsOn: replacement.mutationId });
    } else await rebaseDependents(entry, { mutationId: id, student: server });
    await db.outbox.delete(id);
    await projectStudent(server.id, true);
  });
  requestSync();
}
