import { normalizeMoney, type CreateStudentRequest } from "@drivemaster/shared";
import { createStudentOffline, validateStudent } from "./studentService";

export type ImportRow = Omit<CreateStudentRequest, "id">;
export function normalizeImportRow(row: ImportRow): ImportRow {
  validateStudent(row);
  return {
    name: row.name.trim(),
    phone: row.phone.trim(),
    licenseNumber: row.licenseNumber?.trim() || null,
    enrollmentDate: new Date(row.enrollmentDate).toISOString(),
    totalTuition: normalizeMoney(row.totalTuition)
  };
}
/** Content identity survives reloads/re-uploads and changes of device; it never rewrites existing students. */
export async function importStudentRow(schoolId: string, row: ImportRow) {
  const normalized = normalizeImportRow(row);
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(["drivemaster-csv-v1", schoolId, normalized]))
    )
  );
  // UUIDv8: application-defined, deterministic identity from the content digest.
  bytes[6] = (bytes[6]! & 15) | 128;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return createStudentOffline(normalized, schoolId, id);
}

/** Handles spreadsheet CSV quoting, escaped quotes, CRLF and embedded newlines. */
export function parseStudentCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (char !== ",") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error("A quoted CSV field is unfinished. Check the file and try again.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
