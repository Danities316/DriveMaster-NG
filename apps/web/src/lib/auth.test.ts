import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPassword,
  signOutEverywhere,
  fetchCurrentUser,
  getCachedUser,
  login,
  logout,
  registerOwner,
  confirmVerification,
  getPendingVerification,
  VerificationRequiredError
} from "./auth";
import { prepareLocalSchool } from "./localSession";
import { db } from "../db/db";

const user = { id: "u", schoolId: "a", name: "Ada", phone: "08012345678", role: "OWNER" as const };
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  for (const table of db.tables) await table.clear();
});
afterEach(() => vi.unstubAllGlobals());
describe("session reconciliation", () => {
  it("preserves offline queues while a password reset removes the cached identity", async () => {
    await prepareLocalSchool(user);
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    await db.outbox.put({
      mutationId: "reset-preserved",
      deviceId: "d",
      entity: "student",
      action: "CREATE",
      payload: {},
      status: "PENDING",
      retryCount: 0,
      createdAt: new Date().toISOString()
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );
    await resetPassword("reference", "123456", "NewPassword123");
    expect(getCachedUser()).toBeNull();
    expect(await db.outbox.count()).toBe(1);
    await signOutEverywhere();
    expect(await db.outbox.count()).toBe(1);
  });
  const pending = {
    verificationRequired: true,
    maskedPhone: "+234******5678",
    resendAt: null,
    expiresAt: null,
    delivery: "sent"
  };
  it("clears pending metadata when a reload discovers verification already succeeded", async () => {
    sessionStorage.setItem("drivemaster:ownerVerification", JSON.stringify(pending));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ user }) })
    );
    expect(await fetchCurrentUser()).toEqual({ user, source: "network" });
    expect(getPendingVerification()).toBeNull();
    expect(getCachedUser()).toEqual(user);
  });
  it("stores pending registration without exposing a cached workspace identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => pending }));
    await registerOwner({
      ownerName: "Ada",
      phone: "08012345678",
      password: "Password123",
      schoolName: "School",
      schoolAddress: "Lagos",
      cacNumber: "",
      frscNumber: "",
      acceptedTerms: true
    });
    expect(getPendingVerification()).toEqual(pending);
    expect(getCachedUser()).toBeNull();
  });
  it("routes unverified password login to verification rather than the workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => pending }));
    await expect(login(user.phone, "Password123")).rejects.toBeInstanceOf(
      VerificationRequiredError
    );
    expect(getCachedUser()).toBeNull();
  });
  it("resumes from a restricted server cookie in a new tab without local metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: true, json: async () => pending })
    );
    expect(await fetchCurrentUser()).toEqual({
      user: null,
      source: "network",
      verification: pending
    });
  });
  it("retains existing unsent work when verification grants access to the same school", async () => {
    await prepareLocalSchool(user);
    await db.outbox.put({
      mutationId: "preserved",
      deviceId: "d",
      entity: "student",
      action: "CREATE",
      payload: {},
      status: "PENDING",
      retryCount: 0,
      createdAt: new Date().toISOString()
    });
    sessionStorage.setItem("drivemaster:ownerVerification", JSON.stringify(pending));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user }) }));
    expect(await confirmVerification("123456")).toEqual(user);
    expect(await db.outbox.count()).toBe(1);
    expect(getPendingVerification()).toBeNull();
  });
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
  it("removes another account's cached identity when a new sign-in fails", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: "Phone number or password is incorrect." } })
      })
    );
    await expect(login("08000000000", "wrong-password")).rejects.toThrow(
      "Phone number or password is incorrect."
    );
    expect(getCachedUser()).toBeNull();
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
  it("never restores an older /me response after another tab starts a new session", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
    );
    const pending = fetchCurrentUser();
    const next = { ...user, id: "next", role: "RECEPTIONIST" };
    localStorage.setItem("drivemaster:authRevision", "new-session");
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(next));
    resolve({ ok: true, json: async () => ({ user }) });
    expect((await pending).user).toBeNull();
    expect(getCachedUser()?.id).toBe("next");
  });
  it("does not let an old login overwrite a newer account", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
    );
    const pending = login("08012345678", "password123");
    localStorage.setItem("drivemaster:authRevision", "new-session");
    localStorage.removeItem("drivemaster:signedOut");
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify({ ...user, id: "next" }));
    resolve({ ok: true, json: async () => ({ user }) });
    await expect(pending).rejects.toThrow("another tab");
    expect(getCachedUser()?.id).toBe("next");
  });
  it("fences an older session response after another request confirms rejection", async () => {
    let resolve!: (value: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(user));
    const older = fetchCurrentUser();
    await fetchCurrentUser();
    resolve({ ok: true, json: async () => ({ user }) });
    expect((await older).user).toBeNull();
    expect(getCachedUser()).toBeNull();
  });
});
