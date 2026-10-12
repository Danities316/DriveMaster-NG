import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { db } from "../../db/db";
import { StudentFormPage } from "./StudentFormPage";

const SCHOOL_ID = "school-1";
const USER = {
  id: "owner-1",
  schoolId: SCHOOL_ID,
  name: "Owner",
  phone: "+2348012345678",
  role: "OWNER" as const
};
const PACKAGE = {
  id: "package-1",
  version: 3,
  data: { name: "Beginner", sessions: 20, minutes: 30, price: "150000.00" }
};

describe("StudentFormPage", () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.outbox.clear();
    await db.trainingQueue.clear();
    await db.trainingCache.clear();
    await db.trainingCache.put({
      userId: USER.id,
      schoolId: SCHOOL_ID,
      snapshot: {
        viewerRole: USER.role,
        userId: USER.id,
        schoolId: SCHOOL_ID,
        packages: [PACKAGE],
        enrollments: [],
        settings: null,
        salaries: [],
        outings: [],
        students: [],
        instructors: [],
        vehicles: [],
        summaries: [],
        lessons: []
      },
      loadedAt: "2026-10-12T08:00:00.000Z"
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts phone right after name, and never shows an email field", () => {
    render(<StudentFormPage user={USER} onSaved={() => {}} onCancel={() => {}} />);

    const fields = screen.getAllByRole("textbox");
    expect(fields[0]).toBe(screen.getByLabelText(/full name/i));
    expect(fields[1]).toBe(screen.getByLabelText(/phone number/i));
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("uses a phone-friendly input and derives tuition from a package", async () => {
    render(<StudentFormPage user={USER} onSaved={() => {}} onCancel={() => {}} />);

    expect(screen.getByLabelText(/phone number/i)).toHaveAttribute("type", "tel");
    expect(
      await screen.findByRole("option", { name: "Beginner · 20 lessons · ₦150,000.00" })
    ).toBeVisible();
    expect(screen.queryByLabelText(/total tuition/i)).toBeNull();
  });

  it("requires a package before saving", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<StudentFormPage user={USER} onSaved={() => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ada Okafor" } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/choose a training package/i);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queues the student and selected package together while offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const onSaved = vi.fn();

    render(<StudentFormPage user={USER} onSaved={onSaved} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ada Okafor" } });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(await screen.findByLabelText(/training package/i), {
      target: { value: PACKAGE.id }
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [savedStudent, queued] = onSaved.mock.calls[0] as [{ name: string }, boolean];
    expect(savedStudent.name).toBe("Ada Okafor");
    expect(queued).toBe(true);
    expect((await db.students.toArray())[0]?.totalTuition).toBe(PACKAGE.data.price);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.trainingQueue.toArray())[0]).toMatchObject({
      action: "ENROLL",
      data: { packageId: PACKAGE.id, packageVersion: PACKAGE.version, studentVersion: 0 }
    });
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
        user={USER}
        existingStudent={existing}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByRole("heading", { name: /edit student/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue("Ada Okafor");
    expect(screen.getByLabelText(/phone number/i)).toHaveValue("+2348012345678");
    expect(screen.getByText("₦150,000.00")).toBeVisible();
    expect(screen.queryByLabelText(/training package/i)).toBeNull();
  });
});
