import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getOrCreateDeviceId } from "../../lib/device";
import { db } from "../../db/db";
import { StudentDetailPage } from "./StudentDetailPage";
import type { AuthenticatedUser, TrainingSnapshot } from "@drivemaster/shared";

const STUDENT = {
  id: "student-1",
  schoolId: "school-a",
  name: "Ada Okafor",
  phone: "+2348012345678",
  licenseNumber: "LIC-001",
  enrollmentDate: "2026-01-15T00:00:00.000Z",
  totalTuition: "150000.00",
  amountPaid: "50000.00",
  balanceRemaining: "100000.00",
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z"
};

describe("StudentDetailPage payment actions", () => {
  beforeEach(async () => {
    for (const table of db.tables) await table.clear();
    await db.students.put(STUDENT);
  });

  it("shows the Record Payment action for owner/receptionist and hides it for instructor", async () => {
    const { rerender } = render(
      <StudentDetailPage
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        canRecordPayment={true}
      />
    );

    expect(await screen.findByRole("button", { name: /record payment/i })).toBeInTheDocument();

    rerender(
      <StudentDetailPage
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        canRecordPayment={false}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
    });
  });

  it("validates required reference for non-cash payments", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <StudentDetailPage
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        canRecordPayment={true}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /record payment/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "25000.00" } });
    fireEvent.change(screen.getByLabelText(/payment method/i), {
      target: { value: "BANK_TRANSFER" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^submit payment$/i }));

    await waitFor(() => {
      expect(screen.getByText(/reference is required/i)).toBeInTheDocument();
    });
  });

  it("previews the remaining balance using the current totals without saving a payment", async () => {
    render(
      <StudentDetailPage
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        canRecordPayment
      />
    );
    expect(await screen.findByText("₦150000.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "30000" } });
    expect(screen.getByText("₦70000.00")).toBeInTheDocument();
    expect(await db.outbox.count()).toBe(0);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "wrong" } });
    expect(screen.queryByText(/Balance after payment/)).not.toBeInTheDocument();
  });

  it("shows an offline payment as queued and keeps it in local history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(
      <StudentDetailPage
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        canRecordPayment={true}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: /record payment/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "25000.00" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit payment$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Payment saved on this device. Waiting to be sent."
    );
    await waitFor(() => {
      expect(screen.getByText("Waiting to be sent")).toBeInTheDocument();
      expect(screen.getByText("₦25000.00")).toBeInTheDocument();
      expect(screen.getAllByText("₦75000.00")).toHaveLength(2);
    });
    expect(screen.queryByText(/^Payment recorded/)).not.toBeInTheDocument();
    const payment = (await db.payments.toArray())[0]!;
    await db.transaction("rw", db.outbox, db.students, async () => {
      await db.outbox.delete(payment.id);
      await db.students.update(STUDENT.id, {
        amountPaid: "75000.00",
        balanceRemaining: "75000.00"
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Payment recorded Still to pay: ₦75000.00"
      )
    );
  });
});

describe("Student Detail trusted training summary", () => {
  const viewer: AuthenticatedUser = {
    id: "owner",
    schoolId: "school-a",
    role: "OWNER",
    name: "Owner",
    phone: "test"
  };
  const summary = {
    studentId: STUDENT.id,
    name: STUDENT.name,
    packageName: "Basic",
    sessions: 15,
    confirmed: 8,
    awaiting: 0,
    disputed: 0,
    remaining: 7,
    booked: 2,
    fee: "150000.00",
    paid: "50000.00",
    balance: "100000.00"
  };
  const snapshot = {
    userId: viewer.id,
    schoolId: viewer.schoolId,
    viewerRole: viewer.role,
    summaries: [summary]
  } as TrainingSnapshot;
  beforeEach(async () => {
    for (const table of db.tables) await table.clear();
    await db.students.put(STUDENT);
  });
  it("shows cached accepted counts and the existing navigation without promoting zero exceptions", async () => {
    await db.trainingCache.put({
      userId: viewer.id,
      schoolId: viewer.schoolId,
      loadedAt: "2026-01-02",
      snapshot
    });
    const navigate = vi.fn();
    render(
      <StudentDetailPage
        viewer={viewer}
        studentId={STUDENT.id}
        onBack={() => {}}
        onEdit={() => {}}
        onTraining={navigate}
      />
    );
    expect(await screen.findByText("8 of 15 lessons completed")).toBeVisible();
    expect(screen.getByText("2 booked or training now")).toBeVisible();
    expect(screen.getByText("Disputed lessons")).not.toBeVisible();
    expect(screen.queryByText(/0 lessons need checking/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View training" }));
    expect(navigate).toHaveBeenCalledWith(STUDENT.id);
    expect(document.querySelector("table")).toBeNull();
  });
  it.each(["missing", "other-school", "other-user", "other-role", "instructor"])(
    "does not use %s training information",
    async (mode) => {
      if (mode !== "missing")
        await db.trainingCache.put({
          userId: viewer.id,
          schoolId: viewer.schoolId,
          loadedAt: "2026-01-02",
          snapshot: {
            ...snapshot,
            schoolId: mode === "other-school" ? "other" : viewer.schoolId,
            userId: mode === "other-user" ? "other" : viewer.id,
            viewerRole: mode === "other-role" ? "RECEPTIONIST" : "OWNER"
          }
        });
      render(
        <StudentDetailPage
          viewer={mode === "instructor" ? { ...viewer, role: "INSTRUCTOR" } : viewer}
          studentId={STUDENT.id}
          onBack={() => {}}
          onEdit={() => {}}
          onTraining={() => {}}
        />
      );
      expect(
        await screen.findByText(/Training information is unavailable here/)
      ).toBeInTheDocument();
      expect(screen.queryByText("8 of 15 lessons completed")).not.toBeInTheDocument();
      expect(screen.queryByText("0 of 15 lessons completed")).not.toBeInTheDocument();
    }
  );
});

const PAYMENT_HISTORY = {
  totalPaid: "75000.00",
  outstandingBalance: "75000.00",
  payments: [
    {
      id: "payment-new",
      schoolId: "school-a",
      studentId: STUDENT.id,
      amount: "25000.00",
      paymentDate: "2026-03-15T00:00:00.000Z",
      method: "BANK_TRANSFER" as const,
      currency: "NGN" as const,
      reference: "TRX-NEW",
      createdAt: "2026-03-15T00:00:00.000Z"
    },
    {
      id: "payment-old",
      schoolId: "school-a",
      studentId: STUDENT.id,
      amount: "50000.00",
      paymentDate: "2026-02-15T00:00:00.000Z",
      method: "CASH" as const,
      currency: "NGN" as const,
      reference: null,
      createdAt: "2026-02-15T00:00:00.000Z"
    }
  ]
};

describe("StudentDetailPage financial summary and payment history", () => {
  beforeEach(async () => {
    for (const table of db.tables) await table.clear();
    await db.students.put(STUDENT);
    await db.payments.bulkPut(PAYMENT_HISTORY.payments);
    await db.students.update(STUDENT.id, { amountPaid: "75000.00", balanceRemaining: "75000.00" });
    await db.syncState.put({
      deviceId: getOrCreateDeviceId(),
      lastPulledCursor: "1",
      lastSyncAt: null,
      bootstrapComplete: true
    });
  });

  it("renders the backend financial totals and newest payments with details", async () => {
    render(<StudentDetailPage studentId={STUDENT.id} onBack={() => {}} onEdit={() => {}} />);

    expect((await screen.findAllByText("₦75000.00")).length).toBe(2);
    expect(screen.getByText("Agreed fee")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Still to pay")).toBeInTheDocument();
    expect(await screen.findByText("Bank transfer")).toBeInTheDocument();
    expect(screen.getByText("Reference: TRX-NEW")).toBeInTheDocument();

    const payments = screen.getAllByRole("listitem");
    expect(payments[0]).toHaveTextContent("TRX-NEW");
    expect(payments[1]).toHaveTextContent("Cash");
  });

  it("shows the empty payment state", async () => {
    await db.payments.clear();
    await db.students.update(STUDENT.id, {
      amountPaid: "0.00",
      balanceRemaining: STUDENT.totalTuition
    });

    render(<StudentDetailPage studentId={STUDENT.id} onBack={() => {}} onEdit={() => {}} />);

    expect(await screen.findByText("No payments recorded")).toBeInTheDocument();
  });

  it("shows a payment history error without hiding student details", async () => {
    await db.syncState.update(getOrCreateDeviceId(), { lastError: "Payments service unavailable" });

    render(<StudentDetailPage studentId={STUDENT.id} onBack={() => {}} onEdit={() => {}} />);

    expect(await screen.findByText(/Payments service unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ada Okafor" })).toBeInTheDocument();
    expect(screen.getByText(/Payments service unavailable/)).toBeInTheDocument();
  });
});
