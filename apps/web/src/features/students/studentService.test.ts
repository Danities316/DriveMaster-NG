import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import {
  createStudentOffline,
  updateStudentOffline,
  refreshStudentsFromServer
} from "./studentService";
import { SYNC_WAKE } from "../../sync/queue";
const input = {
  name: "Ada",
  phone: "08012345678",
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00"
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("local student commands", () => {
  it("atomically saves and queues online work for the background controller", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { student, queued } = await createStudentOffline(input, "school");
    expect(queued).toBe(true);
    expect(await db.students.get(student.id)).toEqual(student);
    expect((await db.outbox.toArray())[0]).toMatchObject({
      schoolId: "school",
      entity: "student",
      action: "CREATE",
      status: "PENDING",
      retryCount: 0,
      payload: { ...input, id: student.id }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("orders edits after the preceding local student mutation", async () => {
    const { student } = await createStudentOffline(input, "school");
    const original = (await db.outbox.toArray())[0]!;
    await updateStudentOffline(student.id, { name: "Updated" });
    const edit = (await db.outbox.toArray()).find((item) => item.action === "UPDATE")!;
    expect(edit.dependsOn).toBe(original.mutationId);
    expect(edit.sequence).toBeGreaterThan(original.sequence!);
    expect((await db.students.get(student.id))?.name).toBe("Updated");
  });
  it("captures the confirmed version for conflict detection", async () => {
    const { student } = await createStudentOffline(input, "school");
    await db.outbox.clear();
    await db.serverStudents.put({ ...student, version: 4 });
    await updateStudentOffline(student.id, { totalTuition: "120000" });
    expect((await db.outbox.toArray())[0]?.expectedVersion).toBe(4);
    expect((await db.students.get(student.id))?.balanceRemaining).toBe("120000.00");
  });
  it("rejects invalid local data without creating a mutation", async () => {
    await expect(
      createStudentOffline({ ...input, totalTuition: "-1" }, "school")
    ).rejects.toThrow();
    await expect(
      createStudentOffline({ ...input, enrollmentDate: "2026-02-30" }, "school")
    ).rejects.toThrow();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.students.count()).toBe(0);
  });
  it("rolls back an edit if enqueue fails", async () => {
    const { student } = await createStudentOffline(input, "school");
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("quota"));
    await expect(updateStudentOffline(student.id, { name: "Lost" })).rejects.toThrow("quota");
    expect((await db.students.get(student.id))?.name).toBe(input.name);
  });
  it("refresh wakes the shared controller", async () => {
    const listener = vi.fn();
    window.addEventListener(SYNC_WAKE, listener);
    try {
      await refreshStudentsFromServer();
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(SYNC_WAKE, listener);
    }
  });
});
