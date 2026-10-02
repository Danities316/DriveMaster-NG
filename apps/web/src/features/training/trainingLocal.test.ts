import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_SCHOOL_RULES,
  type AuthenticatedUser,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { db } from "../../db/db";
import { projectedTraining, queueTraining, sendTraining, trainingSyncEvent } from "./trainingLocal";
const user: AuthenticatedUser = {
  id: "instructor",
  schoolId: "school",
  role: "INSTRUCTOR",
  name: "Ada",
  phone: "test"
};
const snapshot: TrainingSnapshot = {
  viewerRole: user.role,
  userId: user.id,
  schoolId: user.schoolId,
  settings: null,
  packages: [],
  enrollments: [],
  salaries: [],
  students: [],
  instructors: [],
  vehicles: [],
  summaries: [],
  lessons: [],
  outings: [
    {
      id: "outing",
      version: 0,
      data: {
        vehicleId: "v",
        instructorId: user.id,
        plannedStart: "2026-01-02T10:00:00Z",
        plannedEnd: "2026-01-02T10:30:00Z",
        status: "BOOKED",
        fuelPerStudent: "1500.00",
        allowanceReason: "default",
        members: [{ studentId: "s", enrollmentId: "e", status: "BOOKED", minutes: 0 }]
      }
    }
  ]
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  localStorage.clear();
  localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
  await db.trainingCache.put({
    userId: user.id,
    schoolId: user.schoolId,
    snapshot,
    loadedAt: "2026-01-01"
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps owner rule changes offline until accepted without overwriting the cached rules", async () => {
  const owner = { ...user, role: "OWNER" as const };
  localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(owner));
  const cached = {
    ...snapshot,
    viewerRole: "OWNER",
    schoolRules: { id: "rules", version: 0, data: DEFAULT_SCHOOL_RULES }
  };
  await db.trainingCache.put({
    userId: owner.id,
    schoolId: owner.schoolId,
    snapshot: cached,
    loadedAt: "2026-09-28"
  });
  const revised = { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 32, reason: "Longer school target" };
  await queueTraining(owner, {
    action: "SCHOOL_RULES",
    targetId: "rules",
    expectedVersion: 0,
    data: revised
  });
  expect((await db.trainingCache.get(owner.id))?.snapshot.schoolRules?.data.schoolTargetDays).toBe(
    26
  );
  expect((await db.trainingQueue.toArray())[0]?.data).toEqual(revised);
  await expect(
    queueTraining(owner, {
      action: "SCHOOL_RULES",
      targetId: "rules",
      expectedVersion: 0,
      data: revised
    })
  ).rejects.toThrow(/earlier change/);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...cached, schoolRules: { id: "rules", version: 1, data: revised } })
    });
  vi.stubGlobal("fetch", fetcher);
  await sendTraining(owner, { force: true });
  expect(await db.trainingQueue.count()).toBe(0);
  expect((await db.trainingCache.get(owner.id))?.snapshot.schoolRules?.data.schoolTargetDays).toBe(
    32
  );
});
it("saves offline start and finish steps in order without claiming server confirmation", async () => {
  await queueTraining(user, {
    action: "START",
    targetId: "outing",
    expectedVersion: 0,
    data: { startedAt: "2026-01-02T10:00:00Z", odometer: 100, present: ["s"] }
  });
  const projected = projectedTraining(snapshot, await db.trainingQueue.toArray());
  expect(projected.outings[0]).toMatchObject({
    version: 1,
    data: { status: "STARTED", fuelIssued: "1500.00" }
  });
  expect(snapshot.outings[0]?.data.status).toBe("BOOKED");
  await queueTraining(user, {
    action: "FINISH",
    targetId: "outing",
    expectedVersion: 1,
    data: { endedAt: "2026-01-02T10:30:00Z" }
  });
  const actions: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      if (init.body) {
        actions.push(JSON.parse(init.body as string).action);
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => snapshot };
    })
  );
  await sendTraining(user);
  expect(actions).toEqual(["START", "FINISH"]);
  expect(await db.trainingQueue.count()).toBe(0);
});
it("keeps a failed start and its finish details for review", async () => {
  await queueTraining(user, { action: "START", targetId: "outing", expectedVersion: 0, data: {} });
  await queueTraining(user, {
    action: "FINISH",
    targetId: "outing",
    expectedVersion: 1,
    data: { note: "keep me" }
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) =>
      init.body
        ? { ok: false, status: 409, json: async () => ({ error: { message: "Vehicle busy" } }) }
        : { ok: true, json: async () => snapshot }
    )
  );
  await sendTraining(user);
  expect((await db.trainingQueue.toArray()).find((q) => q.action === "START")).toMatchObject({
    status: "FAILED",
    error: "Vehicle busy"
  });
  expect((await db.trainingQueue.toArray()).find((q) => q.action === "FINISH")?.data).toEqual({
    note: "keep me"
  });
});
it("never sends another user's saved commands and rejects a cross-account snapshot", async () => {
  await queueTraining(user, { action: "START", targetId: "outing", expectedVersion: 0, data: {} });
  localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify({ ...user, id: "other" }));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await sendTraining(user);
  expect(fetcher).not.toHaveBeenCalled();
  localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
  await db.trainingQueue.clear();
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, schoolId: "other" }) });
  await expect(sendTraining(user)).rejects.toThrow(/different account/);
  expect((await db.trainingCache.get(user.id))?.schoolId).toBe(user.schoolId);
});

it("prevents a second pay entry for the same instructor and month while the first is waiting", async () => {
  const data = { instructorId: "i", month: "2026-09", salary: "120000.00", teachingHours: 120 };
  await queueTraining(user, { action: "SALARY", targetId: "pay-one", data });
  await expect(
    queueTraining(user, { action: "SALARY", targetId: "pay-two", data })
  ).rejects.toThrow(/already saved on this device/);
  expect(await db.trainingQueue.count()).toBe(1);
  await queueTraining(user, {
    action: "SALARY",
    targetId: "pay-october",
    data: { ...data, month: "2026-10" }
  });
  expect(await db.trainingQueue.count()).toBe(2);
});

it("reports the oldest blocking record instead of claiming Refresh succeeded", async () => {
  await queueTraining(user, { action: "BOOK", targetId: "old", data: {} });
  await queueTraining(user, {
    action: "SALARY",
    targetId: "pay",
    data: { instructorId: "i", month: "2026-09" }
  });
  const first = (await db.trainingQueue.toArray()).find((q) => q.targetId === "old")!;
  await db.trainingQueue.update(first.id, { status: "FAILED", error: "Vehicle busy" });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
  vi.stubGlobal("fetch", fetcher);
  const result = await sendTraining(user, { force: true });
  expect(result).toMatchObject({ kind: "blocked" });
  expect(result.message).toContain("Vehicle busy");
  expect(await db.trainingQueue.count()).toBe(2);
  expect(fetcher).toHaveBeenCalledOnce(); // Snapshot only, no unsafe replay of a rejected record.
});

it("keeps retrying temporary failures beyond five attempts and lets a manual send bypass the delay", async () => {
  await queueTraining(user, {
    action: "SALARY",
    targetId: "pay",
    data: { instructorId: "i", month: "2026-09" }
  });
  const entry = (await db.trainingQueue.toArray())[0]!;
  await db.trainingQueue.update(entry.id, { attempts: 4 });
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) =>
    init.body
      ? {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "Server temporarily unavailable" } })
        }
      : { ok: true, json: async () => snapshot }
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await sendTraining(user)).kind).toBe("waiting");
  expect(await db.trainingQueue.get(entry.id)).toMatchObject({ status: "PENDING", attempts: 5 });
  fetcher.mockClear();
  await sendTraining(user);
  expect(fetcher).toHaveBeenCalledOnce(); // Automatic retry respects its delay.
  fetcher.mockImplementation(async () => ({ ok: true, json: async () => snapshot }));
  expect((await sendTraining(user, { force: true })).kind).toBe("sent");
  expect(await db.trainingQueue.count()).toBe(0);
});

it("exposes an active send lease and snapshot failures through user-scoped status events", async () => {
  const notices: string[] = [];
  const listener = (event: Event) => notices.push((event as CustomEvent).detail.kind);
  window.addEventListener(trainingSyncEvent, listener);
  try {
    await db.syncLease.put({
      key: "training",
      owner: "another-tab",
      expiresAt: Date.now() + 60000
    });
    expect((await sendTraining(user)).kind).toBe("busy");
    await db.syncLease.delete("training");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    await expect(sendTraining(user)).rejects.toThrow(/Cannot reach the school server/);
    expect(notices).toEqual(["busy", "blocked"]);
    expect(await db.syncLease.get("training")).toBeUndefined();
  } finally {
    window.removeEventListener(trainingSyncEvent, listener);
  }
});

it("safely takes over a stuck sender using the same request ID and ignores the old sender's late failure", async () => {
  await queueTraining(user, {
    action: "SALARY",
    targetId: "pay",
    data: { instructorId: "i", month: "2026-09" }
  });
  const ids: string[] = [];
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finishFirst!: (value: unknown) => void;
  const firstResponse = new Promise((resolve) => {
    finishFirst = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.body) {
        ids.push(JSON.parse(String(init.body)).id);
        if (ids.length === 1) {
          started();
          return firstResponse;
        }
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => snapshot };
    })
  );
  const original = sendTraining(user);
  await firstStarted;
  expect((await sendTraining(user, { force: true })).kind).toBe("busy");
  expect((await sendTraining(user, { force: true, recoverLease: true })).kind).toBe("sent");
  finishFirst({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: "Old request failed" } })
  });
  expect((await original).kind).toBe("superseded");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(await db.trainingQueue.count()).toBe(0);
  expect(await db.syncLease.get("training")).toBeUndefined();
});
