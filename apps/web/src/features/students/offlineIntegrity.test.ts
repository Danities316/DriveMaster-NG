import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import {
  createStudentOffline,
  updateStudentOffline,
  refreshStudentsFromServer
} from "./studentService";
import { recordStudentPaymentOffline } from "./paymentService";
import { getLocalStudentPaymentHistory } from "./paymentLocalStore";
import { queryLocalStudents } from "./studentLocalStore";

const input = {
  name: "Ada",
  phone: "08012345678",
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00"
};
const student = {
  ...input,
  id: "s",
  schoolId: "school",
  licenseNumber: null,
  amountPaid: "40000.00",
  balanceRemaining: "60000.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline data integrity", () => {
  it("rolls back student storage if its queue write fails", async () => {
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("quota"));
    await expect(createStudentOffline(input, "school")).rejects.toThrow("quota");
    expect(await db.students.count()).toBe(0);
  });
  it.each([401, 408, 429, 500, 503])("preserves a student mutation on HTTP %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) })
    );
    expect((await createStudentOffline(input, "school")).queued).toBe(true);
    expect(await db.students.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });
  it("does not overwrite queued edits during server refresh", async () => {
    await db.students.put(student);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await updateStudentOffline("s", { name: "Ada Updated" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ students: [student], total: 1 }) })
    );
    await refreshStudentsFromServer();
    expect((await db.students.get("s"))?.name).toBe("Ada Updated");
  });
  it("queues an edit behind an offline creation without sending a premature PATCH", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const created = await createStudentOffline(input, "school");
    expect((await updateStudentOffline(created.student.id, { name: "Updated" })).queued).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(2);
  });
  it("preserves confirmed totals when history is incomplete and adds pending payments in both views", async () => {
    await db.students.put(student);
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("40000.00");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );
    const result = await recordStudentPaymentOffline("s", {
      id: "p",
      amount: "10000.00",
      paymentDate: "2026-01-01",
      method: "CASH"
    });
    expect(result.queued).toBe(true);
    expect((await getLocalStudentPaymentHistory("s"))?.totalPaid).toBe("50000.00");
    expect((await queryLocalStudents("school"))[0]?.balanceRemaining).toBe("50000.00");
    expect(await db.outbox.count()).toBe(1);
  });
  it("rejects invalid values before offline persistence", async () => {
    await expect(
      createStudentOffline({ ...input, totalTuition: "-1" }, "school")
    ).rejects.toThrow();
    await expect(
      createStudentOffline({ ...input, enrollmentDate: "2026-02-30" }, "school")
    ).rejects.toThrow();
    expect(await db.students.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
