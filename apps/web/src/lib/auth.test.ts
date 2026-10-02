import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentUser, getCachedUser, logout } from "./auth";
import { prepareLocalSchool } from "./localSession";
import { db } from "../db/db";

const user = { id: "u", schoolId: "a", name: "Ada", phone: "08012345678", role: "OWNER" as const };
beforeEach(async () => {
  localStorage.clear();
  for (const table of db.tables) await table.clear();
});
afterEach(() => vi.unstubAllGlobals());
describe("session reconciliation", () => {
  it("clears expired cached identity even when the 401 response is not JSON", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));
    expect(await fetchCurrentUser()).toEqual({ user: null, source: "network" });
    expect(getCachedUser()).toBeNull();
  });
  it("retains offline identity on a connection failure", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchCurrentUser()).toEqual({ user, source: "cache" });
  });
  it("stays locally signed out after offline logout and restart", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await logout();
    expect(getCachedUser()).toBeNull();
    expect(await fetchCurrentUser()).toEqual({ user: null, source: "network" });
  });
  it("blocks school switching while unsent work exists, then clears old data after acknowledgement", async () => {
    await prepareLocalSchool(user);
    await db.outbox.put({
      mutationId: "m",
      deviceId: "d",
      entity: "student",
      action: "CREATE",
      payload: {},
      status: "PENDING",
      retryCount: 0,
      createdAt: new Date().toISOString()
    });
    await expect(prepareLocalSchool({ ...user, schoolId: "b" })).rejects.toThrow(
      /saved work waiting/
    );
    expect(await db.outbox.count()).toBe(1);
    await db.outbox.clear();
    await db.syncState.put({ deviceId: "d", lastPulledCursor: "old-school", lastSyncAt: null });
    await prepareLocalSchool({ ...user, schoolId: "b" });
    expect(await db.syncState.count()).toBe(0);
  });
});
