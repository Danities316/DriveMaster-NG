import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/db";
import { importStudentRow, normalizeImportRow, parseStudentCsv } from "./studentImport";
const row = {
  name: "Ada",
  phone: "08012345678",
  licenseNumber: "",
  enrollmentDate: "2026-01-01",
  totalTuition: "100000"
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("resumable CSV import", () => {
  it("rejects invalid phone lengths before saving any rows", () => {
    expect(() => normalizeImportRow({ ...row, phone: "1".repeat(21) })).toThrow();
  });
  it("resumes a partial failure and safely re-uploads an already processed file", async () => {
    const second = { ...row, name: "Tunde", phone: "08012345679" };
    const first = await importStudentRow("school", row);
    const fail = vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("Device storage full"));
    await expect(importStudentRow("school", second)).rejects.toThrow("Device storage full");
    fail.mockRestore();
    expect(await db.students.count()).toBe(1);
    const replay = await importStudentRow("school", row);
    await importStudentRow("school", second);
    expect(replay.student.id).toBe(first.student.id);
    expect(await db.students.count()).toBe(2);
    expect(await db.outbox.count()).toBe(2);
    await importStudentRow("school", row);
    expect(await db.outbox.count()).toBe(2);
  });
  it("deduplicates competing tabs and preserves subsequent student edits", async () => {
    const results = await Promise.all([
      importStudentRow("school", row),
      importStudentRow("school", { ...row, totalTuition: "100000.00" })
    ]);
    expect(results[0]?.student.id).toBe(results[1]?.student.id);
    expect(await db.outbox.count()).toBe(1);
    await db.students.update(results[0]!.student.id, { name: "Ada corrected" });
    expect((await importStudentRow("school", row)).student.name).toBe("Ada corrected");
    expect(await db.students.count()).toBe(1);
  });
  it("keeps row identities scoped to their school", async () => {
    const a = await importStudentRow("a", row),
      b = await importStudentRow("b", row);
    expect(a.student.id).not.toBe(b.student.id);
  });
  it("reads spreadsheet quoted cells, escaped quotes and embedded newlines", () => {
    expect(
      parseStudentCsv(
        '\uFEFFname,phone\r\n"Ojo, Tunde",08012345678\r\n"Ada ""A""\nExample",08012345679'
      )
    ).toEqual([
      ["name", "phone"],
      ["Ojo, Tunde", "08012345678"],
      ['Ada "A"\nExample', "08012345679"]
    ]);
    expect(() => parseStudentCsv('name\n"unfinished')).toThrow("unfinished");
  });
});
