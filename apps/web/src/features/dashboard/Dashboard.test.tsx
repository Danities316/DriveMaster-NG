import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { db } from "../../db/db";
import { Dashboard } from "./Dashboard";
const user = {
  id: "u",
  schoolId: "school",
  role: "OWNER" as const,
  name: "Ada Owner",
  phone: "08012345678"
};
const props = () => ({
  user,
  onAdd: vi.fn(),
  onStudents: vi.fn(),
  onStudent: vi.fn(),
  onPayments: vi.fn(),
  onSync: vi.fn(),
  onTraining: vi.fn(),
  onFleet: vi.fn()
});
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
describe("dashboard navigation", () => {
  it("includes this account's unsent training in the saved-record status", async () => {
    const command = {
      id: "pending-training",
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
      action: "BOOK",
      targetId: "outing",
      data: {},
      status: "PENDING" as const,
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: 0
    };
    await db.trainingQueue.bulkPut([
      command,
      { ...command, id: "other-account", userId: "other", status: "FAILED" }
    ]);
    render(<Dashboard {...props()} />);
    const waiting = (await screen.findByText("Records waiting to be sent")).closest("article")!;
    expect(waiting).toHaveTextContent("1 record");
    expect(screen.queryByText(/record needs attention/)).not.toBeInTheDocument();
  });
  it("shows accepted money received today and the total students still owe", async () => {
    const timestamp = new Date().toISOString();
    await db.students.put({
      id: "money-student",
      schoolId: user.schoolId,
      name: "Emeka Okon",
      phone: "08011111111",
      enrollmentDate: timestamp,
      totalTuition: "50000",
      amountPaid: "20000",
      balanceRemaining: "30000",
      licenseNumber: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await db.payments.put({
      id: "accepted-payment",
      studentId: "money-student",
      schoolId: user.schoolId,
      amount: "20000",
      method: "BANK_TRANSFER",
      currency: "NGN",
      reference: "REF-20",
      paymentDate: timestamp,
      createdAt: timestamp
    });
    render(<Dashboard {...props()} />);
    const received = (await screen.findByText("Received today")).closest("article")!;
    expect(received).toHaveTextContent("₦20,000.00");
    expect(received).toHaveTextContent("Accepted school records");
    const owing = screen.getByText("Students still owe").closest("article")!;
    expect(owing).toHaveTextContent("₦30,000.00");
    expect(screen.queryByText("Get DriveMaster ready")).toBeNull();
  });
  it("does not expose owner-only cost or margin information to receptionists", async () => {
    render(<Dashboard {...props()} user={{ ...user, role: "RECEPTIONIST" }} />);
    expect(await screen.findByText("Hello, Ada.")).toBeVisible();
    expect(screen.queryByText(/training cost/i)).toBeNull();
    expect(screen.queryByText(/profit|margin/i)).toBeNull();
  });
  it("puts owner cost and fuel accountability under Money but hides it from receptionists", async () => {
    const ownerCallbacks = props();
    const { rerender } = render(<Dashboard {...ownerCallbacks} paymentsOnly />);
    expect(await screen.findByRole("heading", { name: "Money" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Costs, expenses & fuel money/ }));
    expect(ownerCallbacks.onTraining).toHaveBeenCalledWith({ tab: "costs" });

    rerender(<Dashboard {...props()} user={{ ...user, role: "RECEPTIONIST" }} paymentsOnly />);
    expect(screen.queryByRole("button", { name: /Costs, expenses & fuel money/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Students still owing/ })).toBeVisible();
  });
  it("shows an honest empty state and connects quick actions", async () => {
    const callbacks = props();
    render(<Dashboard {...callbacks} />);
    expect(await screen.findByText("Get DriveMaster ready")).toBeVisible();
    expect(await screen.findByText("Your payment history starts here")).toBeInTheDocument();
    expect(screen.getByText(/Totals may be incomplete/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    expect(callbacks.onAdd).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(callbacks.onStudents).toHaveBeenCalledOnce();
  });
  it("filters the payment ledger and opens the student's record", async () => {
    const timestamp = new Date().toISOString();
    await db.students.put({
      id: "s",
      schoolId: "school",
      name: "Bola Ade",
      phone: "08012345678",
      enrollmentDate: timestamp,
      totalTuition: "10000",
      amountPaid: "5000",
      balanceRemaining: "5000",
      licenseNumber: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await db.payments.put({
      id: "p",
      studentId: "s",
      schoolId: "school",
      amount: "5000",
      method: "BANK_TRANSFER",
      currency: "NGN",
      reference: "REF123",
      paymentDate: timestamp,
      createdAt: timestamp
    });
    const callbacks = props();
    render(<Dashboard {...callbacks} paymentsOnly />);
    fireEvent.click(await screen.findByRole("button", { name: /Open Bola Ade/ }));
    expect(callbacks.onStudent).toHaveBeenCalledWith("s");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknown" } });
    expect(screen.getByText("No matching payments")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "REF123" } });
    expect(screen.getByText("Bola Ade")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "Pending" } });
    expect(screen.getByText("No matching payments")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Needs attention" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Conflict" })).toBeNull();
  });
});
