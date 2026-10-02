import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { AuthenticatedUser, SyncMutation, SyncResult } from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";
import { synchronize, resolveStudentConflict, retryFailed, startSync } from "./controller";
import { createStudentOffline, updateStudentOffline } from "../features/students/studentService";
import { recordStudentPaymentOffline } from "../features/students/paymentService";
import { getLocalStudentPaymentHistory } from "../features/students/paymentLocalStore";

const user: AuthenticatedUser = {
  id: "owner",
  schoolId: "school",
  name: "Owner",
  phone: "08012345678",
  role: "OWNER"
};
const input = {
  name: "Ada",
  phone: "08012345678",
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00"
};
const server = {
  ...input,
  id: "s",
  schoolId: user.schoolId,
  licenseNumber: null,
  version: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const empty = { changes: [], nextCursor: "0", hasMore: false };
const ack = (result: SyncResult) =>
  ok({
    success: true,
    processedIds: [result.mutationId],
    duplicateIds: [],
    results: [result],
    conflicts: [],
    failures: []
  });
let now = 1000000;
const run = () => synchronize(user, { now: () => now });
async function ready() {
  await db.syncState.put({
    deviceId: getOrCreateDeviceId(),
    schoolId: user.schoolId,
    lastPulledCursor: "0",
    lastSyncAt: null,
    bootstrapComplete: true,
    nextPullAt: now + 9999999
  });
}
async function seed() {
  await db.serverStudents.put(server);
  await db.students.put({ ...server, amountPaid: "0.00", balanceRemaining: server.totalTuition });
}
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  localStorage.clear();
  now = 1000000;
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await ready();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable synchronization", () => {
  it("requires another review when the server changes during conflict resolution", async () => {
    await seed();
    await updateStudentOffline("s", { name: "My edit" });
    const entry = (await db.outbox.toArray())[0]!;
    await db.outbox.update(entry.mutationId, {
      status: "CONFLICT",
      serverStudent: { ...server, name: "Reviewed", version: 1 }
    });
    await db.serverStudents.put({ ...server, name: "Not yet reviewed", version: 2 });
    await resolveStudentConflict(entry.mutationId, true, user.schoolId);
    expect(await db.outbox.get(entry.mutationId)).toMatchObject({
      status: "CONFLICT",
      serverStudent: { name: "Not yet reviewed", version: 2 }
    });
    await resolveStudentConflict(entry.mutationId, true, user.schoolId);
    expect(await db.outbox.get(entry.mutationId)).toBeUndefined();
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: "PENDING", expectedVersion: 2 });
  });
  it("uploads an offline creation, edits, and payment in dependency order, then pulls", async () => {
    const created = await createStudentOffline(input, user.schoolId);
    await updateStudentOffline(created.student.id, { name: "Updated" });
    await recordStudentPaymentOffline(created.student.id, {
      id: "p",
      amount: "25000",
      paymentDate: "2026-01-02",
      method: "CASH"
    });
    const sent: SyncMutation[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        if (!init?.body) return ok(empty);
        const mutation = (JSON.parse(init.body as string) as { mutations: SyncMutation[] })
          .mutations[0]!;
        sent.push(mutation);
        if (mutation.entity === "student")
          return ack({
            mutationId: mutation.mutationId,
            student: {
              ...server,
              id: created.student.id,
              ...(mutation.payload as object),
              version: mutation.action === "CREATE" ? 0 : 1
            }
          });
        return ack({
          mutationId: mutation.mutationId,
          payment: {
            id: "p",
            schoolId: user.schoolId,
            studentId: created.student.id,
            amount: "25000.00",
            paymentDate: "2026-01-02",
            method: "CASH",
            currency: "NGN",
            reference: null,
            createdAt: server.createdAt
          }
        });
      })
    );
    await run();
    expect(sent.map((item) => `${item.entity}:${item.action}`)).toEqual([
      "student:CREATE",
      "student:UPDATE",
      "payment:CREATE"
    ]);
    expect(sent[1]?.expectedVersion).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.students.get(created.student.id)).toMatchObject({
      name: "Updated",
      amountPaid: "25000.00",
      balanceRemaining: "75000.00",
      version: 1
    });
  });
  it("persists retry deadlines across runs and retains failures after five attempts", async () => {
    await createStudentOffline(input, user.schoolId);
    const fetchMock = vi.fn().mockRejectedValue(new Error("disconnected"));
    vi.stubGlobal("fetch", fetchMock);
    const delays = [5000, 30000, 120000, 600000];
    for (let attempt = 0; attempt < 5; attempt++) {
      await run();
      expect(fetchMock).toHaveBeenCalledTimes(attempt + 1);
      const entry = (await db.outbox.toArray())[0]!;
      expect(entry.retryCount).toBe(attempt + 1);
      if (attempt < 4) {
        expect(entry.nextAttemptAt).toBe(now + delays[attempt]!);
        await run();
        expect(fetchMock).toHaveBeenCalledTimes(attempt + 1);
        now += delays[attempt]!;
      }
    }
    expect((await db.outbox.toArray())[0]?.status).toBe("FAILED");
    expect(await db.students.count()).toBe(1);
    await retryFailed(user.schoolId);
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: "PENDING", retryCount: 0 });
  });
  it("replays the same mutation after a lost acknowledgement without double counting payment", async () => {
    await seed();
    await recordStudentPaymentOffline("s", {
      id: "p",
      amount: "25000",
      paymentDate: "2026-01-02",
      method: "CASH"
    });
    const sent: SyncMutation[] = [];
    const payment = {
      id: "p",
      schoolId: user.schoolId,
      studentId: "s",
      amount: "25000.00",
      paymentDate: "2026-01-02",
      method: "CASH" as const,
      currency: "NGN" as const,
      reference: null,
      createdAt: server.createdAt
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init?: RequestInit) => {
        if (!init?.body) return ok(empty);
        const mutation = JSON.parse(init.body as string).mutations[0] as SyncMutation;
        sent.push(mutation);
        if (sent.length === 1) throw new Error("response lost after commit");
        return ack({ mutationId: mutation.mutationId, payment });
      })
    );
    await run();
    // Another pull/tab can observe the committed payment before its receipt is replayed.
    await db.serverPayments.put(payment);
    await db.students.update("s", { amountPaid: "25000.00" });
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("25000.00");
    now += 5000;
    await run();
    expect(sent[0]).toEqual(sent[1]);
    expect(await db.payments.count()).toBe(1);
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("25000.00");
    expect(await db.outbox.count()).toBe(0);
  });
  it("recovers interrupted SYNCING entries once a crashed tab's lease expires", async () => {
    await createStudentOffline(input, user.schoolId);
    const entry = (await db.outbox.toArray())[0]!;
    await db.outbox.update(entry.mutationId, { status: "SYNCING" });
    await db.syncLease.put({ key: "sync", owner: "crashed", expiresAt: now + 1 });
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    now += 2;
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.outbox.get(entry.mutationId))?.status).toBe("PENDING");
  });
  it("prevents simultaneous tabs from sending the same queued item", async () => {
    await createStudentOffline(input, user.schoolId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      throw new Error("network");
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = run();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
  it.each([401, 403])("pauses HTTP %s without consuming retry budget", async (status) => {
    await createStudentOffline(input, user.schoolId);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal("fetch", fetchMock);
    await run();
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: "PENDING", retryCount: 0 });
    expect((await db.syncState.get(getOrCreateDeviceId()))?.authRequired).toBe(true);
  });
  it.each(["missing", "wrong-record", "foreign-school"])(
    "retains work on %s acknowledgement",
    async (kind) => {
      await createStudentOffline(input, user.schoolId);
      const entry = (await db.outbox.toArray())[0]!;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          kind === "missing"
            ? ok({ processedIds: [], results: [], conflicts: [], failures: [] })
            : ack({
                mutationId: entry.mutationId,
                student: {
                  ...server,
                  schoolId: kind === "foreign-school" ? "other" : user.schoolId
                }
              })
        )
      );
      await run();
      expect(await db.outbox.count()).toBe(1);
      expect(await db.serverStudents.count()).toBe(0);
    }
  );
  it.each([true, false])(
    "resolves student conflicts explicitly (keep local: %s)",
    async (keepLocal) => {
      await seed();
      await updateStudentOffline("s", { name: "My edit" });
      const entry = (await db.outbox.toArray())[0]!;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          ok({
            processedIds: [],
            results: [],
            failures: [],
            conflicts: [
              {
                mutationId: entry.mutationId,
                message: "Changed elsewhere",
                serverStudent: { ...server, name: "Remote edit", version: 2 }
              }
            ]
          })
        )
      );
      await run();
      expect((await db.outbox.get(entry.mutationId))?.status).toBe("CONFLICT");
      await resolveStudentConflict(entry.mutationId, keepLocal, user.schoolId);
      expect(await db.outbox.get(entry.mutationId)).toBeUndefined();
      expect((await db.students.get("s"))?.name).toBe(keepLocal ? "My edit" : "Remote edit");
      if (keepLocal)
        expect((await db.outbox.toArray())[0]).toMatchObject({
          status: "PENDING",
          expectedVersion: 2
        });
      else expect(await db.outbox.count()).toBe(0);
    }
  );
  it("keeps conflicting payment evidence without adding it to accepted totals", async () => {
    await seed();
    await recordStudentPaymentOffline("s", {
      id: "p",
      amount: "1000",
      paymentDate: "2026-01-01",
      method: "CASH"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          processedIds: [],
          results: [],
          failures: [],
          conflicts: [{ mutationId: "p", message: "Different payment uses this ID" }]
        })
      )
    );
    await run();
    expect(await db.payments.count()).toBe(1);
    expect((await db.outbox.get("p"))?.status).toBe("CONFLICT");
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("0.00");
  });
  it("bootstraps multiple pages atomically and resumes from the stored cursor", async () => {
    await db.syncState.clear();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          changes: [{ cursor: "1", entity: "student", action: "CREATE", record: server }],
          nextCursor: "1",
          hasMore: true
        })
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await run();
    expect((await db.syncState.get(getOrCreateDeviceId()))?.lastPulledCursor).toBe("1");
    expect((await db.syncState.get(getOrCreateDeviceId()))?.bootstrapComplete).toBe(false);
    now += 15000;
    fetchMock.mockResolvedValueOnce(ok({ changes: [], nextCursor: "1", hasMore: false }));
    await run();
    expect(fetchMock.mock.calls[2]?.[0]).toContain("cursor=1");
    expect((await db.syncState.get(getOrCreateDeviceId()))?.bootstrapComplete).toBe(true);
  });
  it("rolls back downloaded records and cursor together when local persistence fails", async () => {
    await db.syncState.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          changes: [{ cursor: "1", entity: "student", action: "CREATE", record: server }],
          nextCursor: "1",
          hasMore: false
        })
      )
    );
    vi.spyOn(db.students, "put").mockRejectedValueOnce(new Error("quota"));
    await run();
    expect(await db.serverStudents.count()).toBe(0);
    expect((await db.syncState.get(getOrCreateDeviceId()))?.lastPulledCursor).toBeNull();
  });
  it("rejects a foreign-school pull without advancing the cursor", async () => {
    await db.syncState.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          changes: [
            {
              cursor: "1",
              entity: "student",
              action: "CREATE",
              record: { ...server, schoolId: "other" }
            }
          ],
          nextCursor: "1",
          hasMore: false
        })
      )
    );
    await run();
    expect(await db.students.count()).toBe(0);
    expect((await db.syncState.get(getOrCreateDeviceId()))?.lastPulledCursor).toBeNull();
  });
  it("does not acknowledge an in-flight result after logout", async () => {
    await createStudentOffline(input, user.schoolId);
    let current = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        current = false;
        const entry = JSON.parse(init.body as string).mutations[0] as SyncMutation;
        return ack({
          mutationId: entry.mutationId,
          student: { ...server, ...(entry.payload as object) }
        });
      })
    );
    await synchronize(user, { now: () => now, isCurrent: () => current });
    expect(await db.outbox.count()).toBe(1);
    expect(await db.serverStudents.count()).toBe(0);
  });
  it("automatically wakes on reconnection and stops when disposed", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    await createStudentOffline(input, user.schoolId);
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const stop = startSync(user);
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(fetchMock).not.toHaveBeenCalled();
      online = true;
      window.dispatchEvent(new Event("online"));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () => expect(await db.syncLease.count()).toBe(0));
    } finally {
      stop();
    }
    window.dispatchEvent(new Event("online"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
