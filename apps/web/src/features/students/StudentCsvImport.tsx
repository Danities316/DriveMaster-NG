import { useState, type ChangeEvent } from "react";
import { isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import { createStudentOffline } from "./studentService";

type Row = {
  name: string;
  phone: string;
  licenseNumber: string;
  enrollmentDate: string;
  totalTuition: string;
};
type CheckedRow = Row & { error?: string };
const headers = ["name", "phone", "licenseNumber", "enrollmentDate", "totalTuition"] as const;

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
}
function downloadTemplate() {
  const blob = new Blob([`${headers.join(",")}\nAda Example,08012345678,,2026-10-06,0.00\n`], {
    type: "text/csv"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "drivemaster-students-template.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

export function StudentCsvImport({ schoolId }: { schoolId: string }) {
  const [rows, setRows] = useState<CheckedRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const lines = parseCsv(await file.text());
    const header = lines.shift()?.map((value) => value.toLowerCase());
    if (!header || headers.some((name) => !header.includes(name))) {
      setMessage("Use the DriveMaster template columns, then upload the file again.");
      return;
    }
    const checked = lines.map((cells): CheckedRow => {
      const row = Object.fromEntries(
        headers.map((name) => [name, cells[header.indexOf(name)] ?? ""])
      ) as Row;
      if (!row.name.trim()) return { ...row, error: "Name is missing" };
      if (row.phone.trim().length < 7)
        return { ...row, error: "Phone number is missing or too short" };
      if (!isValidDate(row.enrollmentDate)) return { ...row, error: "Use a date like 2026-10-06" };
      if (!isValidStoredMoney(row.totalTuition || "0.00"))
        return { ...row, error: "Tuition must be a number" };
      return { ...row, totalTuition: row.totalTuition || "0.00" };
    });
    setRows(checked);
    setMessage(null);
  }
  async function importRows() {
    setSaving(true);
    let added = 0;
    try {
      for (const row of rows.filter((item) => !item.error)) {
        await createStudentOffline(
          {
            ...row,
            totalTuition: row.totalTuition || "0.00",
            licenseNumber: row.licenseNumber || null
          },
          schoolId
        );
        added++;
      }
      setMessage(
        `${added} student${added === 1 ? "" : "s"} added. You can correct the remaining rows and upload them later.`
      );
      setRows((current) => current.filter((row) => row.error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="dm-panel student-import" aria-labelledby="student-import-title">
      <div className="student-page-heading">
        <div>
          <p className="dm-eyebrow">QUICK SETUP</p>
          <h2 id="student-import-title">Add many students at once</h2>
          <p>
            Use an Excel or Google Sheets file saved as CSV. Existing records are not overwritten.
          </p>
        </div>
        <button type="button" className="dm-secondary" onClick={downloadTemplate}>
          Download template
        </button>
      </div>
      <label className="dm-secondary student-import-file">
        Choose CSV file
        <input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event)} />
      </label>
      {message ? (
        <p role="status" className="student-import-message">
          {message}
        </p>
      ) : null}
      {rows.length ? (
        <>
          <p>
            {rows.filter((row) => !row.error).length} ready ·{" "}
            {rows.filter((row) => row.error).length} need correction
          </p>
          <ul className="student-import-preview">
            {rows.map((row, index) => (
              <li key={`${row.name}-${index}`}>
                <span>
                  {row.name || "Unnamed student"} · {row.phone}
                </span>
                <span className={row.error ? "text-rose-600" : "text-emerald-700"}>
                  {row.error ?? "Ready"}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="dm-primary"
            disabled={saving || !rows.some((row) => !row.error)}
            onClick={() => void importRows()}
          >
            {saving ? "Adding students..." : "Add ready students"}
          </button>
        </>
      ) : null}
    </section>
  );
}
