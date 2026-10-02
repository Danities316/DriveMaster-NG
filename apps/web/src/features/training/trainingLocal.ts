import type { AuthenticatedUser, TrainingCommand, TrainingSnapshot } from "@drivemaster/shared";
import { multiplyTrainingMoney } from "@drivemaster/shared";
import { db } from "../../db/db";
import { getCachedUser } from "../../lib/auth";

export interface QueuedTraining extends TrainingCommand {
  userId: string;
  schoolId: string;
  role: string;
  createdAt: number;
  status: "PENDING" | "FAILED";
  attempts: number;
  nextAttemptAt: number;
  error?: string;
}
const base = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
const wake = "drivemaster:training-send";
export const trainingSyncEvent = "drivemaster:training-status";
export interface TrainingSendResult {
  kind: "sent" | "waiting" | "blocked" | "busy" | "offline" | "account" | "superseded";
  message: string;
}
export type TrainingSyncNotice = TrainingSendResult & {
  userId: string;
  schoolId: string;
  role: string;
};
const latestStatus = new Map<string, TrainingSyncNotice>();
const statusKey = (user: AuthenticatedUser) => JSON.stringify([user.id, user.schoolId, user.role]);
export const lastTrainingStatus = (user: AuthenticatedUser) => latestStatus.get(statusKey(user));
function announce(user: AuthenticatedUser, result: TrainingSendResult) {
  const detail = { ...result, userId: user.id, schoolId: user.schoolId, role: user.role };
  latestStatus.set(statusKey(user), detail);
  window.dispatchEvent(new CustomEvent(trainingSyncEvent, { detail }));
  return result;
}
export function findQueuedPay(queue: QueuedTraining[], instructorId: string, month: string) {
  return queue
    .filter((q) => {
      const data = q.data as { instructorId?: string; month?: string };
      return q.action === "SALARY" && data.instructorId === instructorId && data.month === month;
    })
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}
export async function trainingRequest(path: string, data?: unknown) {
  const response = await fetch(`${base}/training/${path}`, {
    method: data === undefined ? "GET" : "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Training-User": getCachedUser()?.id ?? "",
      "X-Training-School": getCachedUser()?.schoolId ?? ""
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(20000)
  }).catch(() => {
    throw new Error(
      "Cannot reach the school server. Your records are still saved on this device. If you are testing locally, keep the API terminal running."
    );
  });
  const result = await response.json().catch(() => {
    throw Object.assign(
      new Error(
        "The school server did not return a valid response. Keep the API running and try again."
      ),
      { status: response.status }
    );
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 401
          ? "Your sign-in has expired. Sign out and sign in again with the same account. Saved records will stay on this device."
          : (result?.error?.message ?? "Unable to send. Please try again.")
      ),
      {
        status: response.status
      }
    );
  return result;
}
export async function queueTraining(user: AuthenticatedUser, command: Omit<TrainingCommand, "id">) {
  await db.transaction("rw", db.trainingQueue, db.trainingCache, async () => {
    const cached = await db.trainingCache.get(user.id);
    if (!cached || cached.schoolId !== user.schoolId || cached.snapshot.viewerRole !== user.role)
      throw new Error("Load your training records before saving offline.");
    const ownQueue = (await db.trainingQueue.where("userId").equals(user.id).toArray()).filter(
      (q) => q.schoolId === user.schoolId && q.role === user.role
    );
    if (command.action === "SALARY") {
      const input = command.data as { instructorId: string; month: string };
      if (findQueuedPay(ownQueue, input.instructorId, input.month))
        throw new Error(
          "Pay for this instructor and month is already saved on this device. Send or review that entry before adding it again."
        );
    }
    const pending = ownQueue.filter((q) => q.targetId === command.targetId);
    if (
      pending.length &&
      !(
        command.action === "FINISH" &&
        pending.length === 1 &&
        pending[0]?.action === "START" &&
        pending[0].status === "PENDING"
      )
    )
      throw new Error("Send or check the earlier change to this record first.");
    await db.trainingQueue.add({
      ...command,
      id: crypto.randomUUID(),
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
      createdAt: Math.max(
        Date.now(),
        ...(await db.trainingQueue.toArray()).map((q) => q.createdAt + 1)
      ),
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: 0
    });
  });
  window.dispatchEvent(new Event(wake));
}
export function projectedTraining(
  snapshot: TrainingSnapshot,
  queue: QueuedTraining[]
): TrainingSnapshot {
  const result = structuredClone(snapshot);
  for (const change of [...queue].sort((a, b) => a.createdAt - b.createdAt)) {
    if (change.status !== "PENDING" || change.action !== "START") continue;
    const outing = result.outings.find((o) => o.id === change.targetId);
    if (!outing || outing.data.status !== "BOOKED") continue;
    const input = change.data as { startedAt: string; odometer: number; present: string[] };
    outing.version++;
    outing.data.status = "STARTED";
    outing.data.startedAt = input.startedAt;
    outing.data.startOdometer = input.odometer;
    outing.data.fuelIssued = multiplyTrainingMoney(
      outing.data.fuelPerStudent,
      input.present.length
    );
    outing.data.members.forEach((m) => {
      m.status = input.present.includes(m.studentId) ? "DRIVING" : "MISSED";
    });
  }
  return result;
}
export async function sendTraining(
  user: AuthenticatedUser,
  options: { force?: boolean; recoverLease?: boolean } = {}
): Promise<TrainingSendResult> {
  try {
    const result = await performTrainingSend(user, options);
    return result.kind === "superseded" ? result : announce(user, result);
  } catch (error) {
    announce(user, {
      kind: "blocked",
      message:
        error instanceof Error
          ? error.message
          : "Unable to update training records. Your saved changes have been kept."
    });
    throw error;
  }
}
async function performTrainingSend(
  user: AuthenticatedUser,
  options: { force?: boolean; recoverLease?: boolean }
): Promise<TrainingSendResult> {
  if (navigator.onLine === false)
    return {
      kind: "offline",
      message: "No internet connection. Records remain saved on this device."
    };
  const current = () => {
    const cached = getCachedUser();
    return cached?.id === user.id && cached.schoolId === user.schoolId && cached.role === user.role;
  };
  if (!current())
    return {
      kind: "account",
      message:
        "Your saved sign-in does not match this screen. Reload and sign in with the same account to send these records."
    };
  const owner = crypto.randomUUID();
  const acquired = await db.transaction("rw", db.syncLease, async () => {
    const existing = await db.syncLease.get("training");
    if (existing && existing.expiresAt > Date.now() && !options.recoverLease) return false;
    await db.syncLease.put({ key: "training", owner, expiresAt: Date.now() + 120000 });
    return true;
  });
  if (!acquired)
    return {
      kind: "busy",
      message:
        "Another request or tab is sending training records. If the list is not moving, select Restart sending to safely take over. Your saved records will be kept."
    };
  try {
    const superseded: TrainingSendResult = {
      kind: "superseded",
      message: "A newer request has taken over sending these records."
    };
    const queue = (await db.trainingQueue.where("userId").equals(user.id).toArray())
      .filter((q) => q.schoolId === user.schoolId && q.role === user.role)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of queue) {
      if ((await db.syncLease.get("training"))?.owner !== owner) return superseded;
      if (!current())
        return {
          kind: "account",
          message: "The signed-in account changed. Your unsent records have been kept."
        };
      if (
        entry.schoolId !== user.schoolId ||
        entry.role !== user.role ||
        entry.status === "FAILED" ||
        (!options.force && entry.nextAttemptAt > Date.now())
      )
        break;
      try {
        const { id, action, targetId, expectedVersion, data } = entry;
        await trainingRequest("commands", { id, action, targetId, expectedVersion, data });
        if (!current())
          return {
            kind: "account",
            message: "The signed-in account changed. Your unsent records have been kept."
          };
        const acknowledged = await db.transaction(
          "rw",
          db.syncLease,
          db.trainingQueue,
          async () => {
            if ((await db.syncLease.get("training"))?.owner !== owner) return false;
            await db.trainingQueue.delete(id);
            await db.syncLease.update("training", { expiresAt: Date.now() + 120000 });
            return true;
          }
        );
        if (!acknowledged) return superseded;
      } catch (reason) {
        if (!current())
          return {
            kind: "account",
            message: "The signed-in account changed. Your unsent records have been kept."
          };
        const status = (reason as { status?: number }).status;
        const attempts = entry.attempts + 1;
        const recorded = await db.transaction("rw", db.syncLease, db.trainingQueue, async () => {
          if ((await db.syncLease.get("training"))?.owner !== owner) return false;
          await db.trainingQueue.update(entry.id, {
            attempts,
            status:
              status && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)
                ? "FAILED"
                : "PENDING",
            nextAttemptAt: Date.now() + Math.min(300000, 5000 * 2 ** Math.min(attempts, 6)),
            error: reason instanceof Error ? reason.message : "Unable to send this change."
          });
          return true;
        });
        if (!recorded) return superseded;
        break;
      }
    }
    if ((await db.syncLease.get("training"))?.owner !== owner) return superseded;
    let snapshot: TrainingSnapshot;
    try {
      snapshot = (await trainingRequest("snapshot")) as TrainingSnapshot;
    } catch (error) {
      if ((await db.syncLease.get("training"))?.owner !== owner) return superseded;
      throw error;
    }
    if (!current())
      return {
        kind: "account",
        message: "The signed-in account changed. Your unsent records have been kept."
      };
    if (
      snapshot.userId !== user.id ||
      snapshot.schoolId !== user.schoolId ||
      snapshot.viewerRole !== user.role
    )
      throw new Error("The response belongs to a different account.");
    const cached = await db.transaction("rw", db.syncLease, db.trainingCache, async () => {
      if ((await db.syncLease.get("training"))?.owner !== owner) return false;
      await db.trainingCache.put({
        userId: user.id,
        schoolId: user.schoolId,
        snapshot,
        loadedAt: new Date().toISOString()
      });
      return true;
    });
    if (!cached) return superseded;
    const remaining = (await db.trainingQueue.where("userId").equals(user.id).toArray())
      .filter((q) => q.schoolId === user.schoolId && q.role === user.role)
      .sort((a, b) => a.createdAt - b.createdAt);
    const first = remaining[0];
    if (first)
      return {
        kind: first.status === "FAILED" ? "blocked" : "waiting",
        message: `${remaining.length} saved record${remaining.length === 1 ? " is" : "s are"} still waiting. ${first.status === "FAILED" ? "The first record needs attention before later records can be sent." : "Sending is paused while the first record is tried again."} ${first.error ?? "Select Send saved records to try now."}`
      };
    return {
      kind: "sent",
      message: "Training records are up to date. All saved changes for this account have been sent."
    };
  } finally {
    await db.transaction("rw", db.syncLease, async () => {
      if ((await db.syncLease.get("training"))?.owner === owner)
        await db.syncLease.delete("training");
    });
  }
}
export function startTrainingSync(user: AuthenticatedUser) {
  const send = () => {
    void sendTraining(user).catch(() => {});
  };
  send();
  const timer = window.setInterval(send, 20000);
  window.addEventListener("online", send);
  window.addEventListener(wake, send);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", send);
    window.removeEventListener(wake, send);
  };
}
export async function discardTraining(user: AuthenticatedUser, id: string) {
  await db.transaction("rw", db.trainingQueue, async () => {
    const row = await db.trainingQueue.get(id);
    if (!row || row.userId !== user.id || row.schoolId !== user.schoolId || row.status !== "FAILED")
      throw new Error("Only your failed saved changes can be removed.");
    const dependents = (await db.trainingQueue.where("userId").equals(user.id).toArray()).filter(
      (q) => q.targetId === row.targetId && q.createdAt >= row.createdAt
    );
    await db.trainingQueue.bulkDelete(dependents.map((q) => q.id));
  });
  window.dispatchEvent(new Event(wake));
}
