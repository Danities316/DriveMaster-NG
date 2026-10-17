import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudentCsvImport } from "./StudentCsvImport";
import { importStudentRow } from "./studentImport";
vi.mock("./studentImport", async (original) => ({
  ...(await original<typeof import("./studentImport")>()),
  importStudentRow: vi.fn()
}));
afterEach(() => vi.clearAllMocks());
it("removes successful rows immediately and retries only rows left after failure", async () => {
  vi.mocked(importStudentRow)
    .mockResolvedValueOnce({} as Awaited<ReturnType<typeof importStudentRow>>)
    .mockRejectedValueOnce(new Error("Storage full"));
  render(<StudentCsvImport schoolId="school" />);
  const file = {
    text: async () =>
      "name,phone,licenseNumber,enrollmentDate,totalTuition\nAda,08012345678,,2026-01-01,100\nTunde,08012345679,,2026-01-01,100"
  };
  fireEvent.change(screen.getByLabelText("Choose CSV file"), { target: { files: [file] } });
  await screen.findByText(/2 ready/);
  fireEvent.click(screen.getByText("Add ready students"));
  await screen.findByText(/Import paused/);
  expect(screen.queryByText(/Ada ·/)).not.toBeInTheDocument();
  vi.mocked(importStudentRow).mockResolvedValueOnce(
    {} as Awaited<ReturnType<typeof importStudentRow>>
  );
  fireEvent.click(screen.getByText("Add ready students"));
  await waitFor(() => expect(importStudentRow).toHaveBeenCalledTimes(3));
  expect(vi.mocked(importStudentRow).mock.calls[2]?.[1].name).toBe("Tunde");
});
