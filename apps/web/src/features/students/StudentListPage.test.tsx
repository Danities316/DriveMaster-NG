import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { db } from "../../db/db";
import { StudentListPage } from "./StudentListPage";

const SCHOOL_ID = "school-1";

const ADA = {
  id: "student-ada",
  schoolId: SCHOOL_ID,
  name: "Ada Okafor",
  phone: "+2348011111111",
  licenseNumber: null,
  enrollmentDate: "2026-01-01",
  totalTuition: "100000.00",
  amountPaid: "100000.00",
  balanceRemaining: "0.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const BOLA = {
  ...ADA,
  id: "student-bola",
  name: "Bola Musa",
  phone: "+2348022222222",
  amountPaid: "0.00",
  balanceRemaining: "100000.00"
};

describe("StudentListPage", () => {
  beforeEach(async () => {
    await db.students.clear();
    await db.students.bulkAdd([ADA, BOLA]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ students: [], total: 0 }) })
    );
  });

  afterEach(async () => {
    await db.students.clear();
    vi.unstubAllGlobals();
  });

  it("shows students from the local cache immediately, sorted by name", async () => {
    render(
      <StudentListPage schoolId={SCHOOL_ID} onSelectStudent={() => {}} onAddStudent={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Ada Okafor")).toBeInTheDocument();
      expect(screen.getByText("Bola Musa")).toBeInTheDocument();
    });
  });

  it("filters the visible list as the search box is used", async () => {
    render(
      <StudentListPage schoolId={SCHOOL_ID} onSelectStudent={() => {}} onAddStudent={() => {}} />
    );

    await waitFor(() => expect(screen.getByText("Ada Okafor")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/search students/i), { target: { value: "bola" } });

    await waitFor(() => {
      expect(screen.queryByText("Ada Okafor")).not.toBeInTheDocument();
      expect(screen.getByText("Bola Musa")).toBeInTheDocument();
    });
  });

  it("calls onSelectStudent with the tapped student's id", async () => {
    const onSelectStudent = vi.fn();
    render(
      <StudentListPage
        schoolId={SCHOOL_ID}
        onSelectStudent={onSelectStudent}
        onAddStudent={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("Ada Okafor")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ada Okafor"));

    expect(onSelectStudent).toHaveBeenCalledWith("student-ada");
  });

  it("calls onAddStudent when the Add button is tapped", async () => {
    const onAddStudent = vi.fn();
    render(
      <StudentListPage
        schoolId={SCHOOL_ID}
        onSelectStudent={() => {}}
        onAddStudent={onAddStudent}
      />
    );

    await waitFor(() => expect(screen.getByText("Ada Okafor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add student/i }));

    expect(onAddStudent).toHaveBeenCalled();
  });

  it("shows an empty state when there are no students at all", async () => {
    await db.students.clear();
    const onAddStudent = vi.fn();
    render(
      <StudentListPage
        schoolId={SCHOOL_ID}
        onSelectStudent={() => {}}
        onAddStudent={onAddStudent}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No students yet" })).toBeInTheDocument();
    });
    expect(screen.getByText(/payments and training records together/)).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: /add student/i })[1]!);
    expect(onAddStudent).toHaveBeenCalledOnce();
  });
});
