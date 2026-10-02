import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { db } from "../../db/db";
import { StudentFormPage } from "./StudentFormPage";

const SCHOOL_ID = "school-1";

describe("StudentFormPage", () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.outbox.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts phone right after name, and never shows an email field", () => {
    render(<StudentFormPage schoolId={SCHOOL_ID} onSaved={() => {}} onCancel={() => {}} />);

    const labels = screen.getAllByText(
      /full name|phone number|license number|enrollment date|total tuition/i
    );
    expect(labels[0]).toHaveTextContent(/full name/i);
    expect(labels[1]).toHaveTextContent(/phone number/i);
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("uses a phone-friendly input and a decimal-friendly tuition input", () => {
    render(<StudentFormPage schoolId={SCHOOL_ID} onSaved={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText(/phone number/i)).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText(/total tuition/i)).toHaveAttribute("inputMode", "decimal");
  });

  it("rejects submission with an invalid tuition amount before hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<StudentFormPage schoolId={SCHOOL_ID} onSaved={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ada Okafor" } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/total tuition/i), {
      target: { value: "not-a-number" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/valid tuition amount/i);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves successfully offline (network unreachable) and reports it as queued", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const onSaved = vi.fn();

    render(<StudentFormPage schoolId={SCHOOL_ID} onSaved={onSaved} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ada Okafor" } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/total tuition/i), { target: { value: "150000" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [savedStudent, queued] = onSaved.mock.calls[0] as [{ name: string }, boolean];
    expect(savedStudent.name).toBe("Ada Okafor");
    expect(queued).toBe(true);
  });

  it("pre-fills fields and keeps phone in the second position when editing", () => {
    const existing = {
      id: "student-1",
      schoolId: SCHOOL_ID,
      name: "Ada Okafor",
      phone: "+2348012345678",
      licenseNumber: "LIC-001",
      enrollmentDate: "2026-01-15T00:00:00.000Z",
      totalTuition: "150000.00",
      amountPaid: "0.00",
      balanceRemaining: "150000.00",
      createdAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z"
    };

    render(
      <StudentFormPage
        schoolId={SCHOOL_ID}
        existingStudent={existing}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByRole("heading", { name: /edit student/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue("Ada Okafor");
    expect(screen.getByLabelText(/phone number/i)).toHaveValue("+2348012345678");
    expect(screen.getByLabelText(/total tuition/i)).toHaveValue("150000.00");
  });
});
