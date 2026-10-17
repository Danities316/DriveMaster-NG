import { useState, type ChangeEvent } from "react";
import { normalizeImportRow, importStudentRow, parseStudentCsv } from "./studentImport";

type Row = {
  name: string;
  phone: string;
  licenseNumber: string;
  enrollmentDate: string;
  totalTuition: string;
};
type CheckedRow = Row & { error?: string };
const headers = ["name", "phone", "licenseNumber", "enrollmentDate", "totalTuition"] as const;

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
    setRows([]);
    let lines: string[][];
    try {
      lines = parseStudentCsv(await file.text());
    } catch (e) {
      setMessage((e as Error).message);
      setRows([]);
      return;
    }
    const header = lines.shift()?.map((value) => value.toLowerCase());
    if (!header || headers.some((name) => !header.includes(name.toLowerCase()))) {
      setMessage("Use the DriveMaster template columns, then upload the file again.");
      return;
    }
    const checked = lines.map((cells): CheckedRow => {
      const row = Object.fromEntries(
        headers.map((name) => [name, cells[header.indexOf(name.toLowerCase())] ?? ""])
      ) as Row;
      try {
        normalizeImportRow({ ...row, totalTuition: row.totalTuition || "0.00" });
        return { ...row, totalTuition: row.totalTuition || "0.00" };
      } catch (e) {
        return { ...row, error: (e as Error).message };
      }
    });
    setRows(checked);
    setMessage(null);
  }
  async function importRows() {
    setSaving(true);
    let added = 0;
    try {
      for (const row of rows.filter((item) => !item.error)) {
        await importStudentRow(schoolId, row);
        setRows((current) => current.filter((item) => item !== row));
        added++;
      }
      setMessage(
        `${added} row${added === 1 ? "" : "s"} processed. Identical previously imported rows are kept without duplicates. You can correct the remaining rows and upload them later.`
      );
      setRows((current) => current.filter((row) => row.error));
    } catch (e) {
      setMessage(
        `${added} rows processed. Import paused: ${(e as Error).message} Retry the remaining rows or re-upload the file; saved rows will not be duplicated.`
      );
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
            Use an Excel or Google Sheets file saved as CSV. Re-uploading identical rows is safe. To
            change an existing student, edit their record instead.
          </p>
        </div>
        <button type="button" className="dm-secondary" onClick={downloadTemplate}>
          Download template
        </button>
      </div>
      <label className="dm-secondary student-import-file">
        Choose CSV file
        <input
          type="file"
          disabled={saving}
          accept=".csv,text/csv"
          onChange={(event) => void readFile(event)}
        />
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
