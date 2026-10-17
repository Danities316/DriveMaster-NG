import { prepareLocalSchool } from "../../lib/localSession";
import { db } from "../../db/db";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PaymentAdjustment } from "./PaymentAdjustment";
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => [{ id: "student", name: "Ada", phone: "08011111111" }]
}));
vi.mock("../../sync/queue", () => ({ requestSync: vi.fn() }));
const payment = {
  id: "payment",
  schoolId: "school",
  studentId: "student",
  amount: "100.00",
  currency: "NGN" as const,
  method: "CASH" as const,
  paymentDate: "2026-10-15T12:00:00Z",
  createdAt: "2026-10-15T12:00:00Z",
  reference: null
};
const review = {
  payment,
  revision: 2,
  refundable: "100.00",
  reversed: false,
  refunded: false,
  undone: false,
  history: []
};
beforeEach(async () => {
  await db.pendingAdjustments.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Owner financial adjustment", () => {
  it("keeps the identical request on uncertain retries and requests sync after success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => review })
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payments: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await screen.findByText(/Online owner review/);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Returned to student" } });
    fireEvent.click(screen.getByText("Save audited adjustment"));
    await screen.findByText(/Connection lost/);
    expect(screen.getByLabelText("Reason")).toBeDisabled();
    fireEvent.click(screen.getByText("Retry same adjustment"));
    await screen.findByText(/Saved at school/);
    expect(fetchMock.mock.calls[1]?.[1].body).toBe(fetchMock.mock.calls[2]?.[1].body);
    const body = JSON.parse(fetchMock.mock.calls[1]?.[1].body);
    expect(body).toMatchObject({
      action: "REFUND",
      revision: 2,
      amount: "100.00",
      reason: "Returned to student"
    });
    expect(body.id).toBeTruthy();
  });
  it("shows closed payments without offering another adjustment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...review, reversed: true }) })
    );
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await screen.findByText(/already been reversed/);
    expect(screen.queryByText("Save audited adjustment")).not.toBeInTheDocument();
  });
  it("reports authorization failures without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Sign in as an active school owner." } })
      })
    );
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Sign in as an active school owner.")
    );
    expect(screen.queryByText(/Saved at school/)).not.toBeInTheDocument();
  });
  it.each([false, true])(
    "restores the exact uncertain request after remount even when closed=%s",
    async (closed) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => review })
        .mockRejectedValueOnce(new Error("Connection lost"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...review, revision: 3, refundable: "80.00", reversed: closed })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ payments: [] }) });
      vi.stubGlobal("fetch", fetchMock);
      const first = render(
        <PaymentAdjustment payment={payment} schoolId="school" userId="owner" />
      );
      fireEvent.click(screen.getByText("Review / adjust payment"));
      await screen.findByText(/Online owner review/);
      fireEvent.change(screen.getByLabelText("Amount (NGN)"), { target: { value: "20.00" } });
      fireEvent.change(screen.getByLabelText("Reason"), {
        target: { value: "Returned to student" }
      });
      fireEvent.click(screen.getByText("Save audited adjustment"));
      await screen.findByText(/Connection lost/);
      const original = fetchMock.mock.calls[1]?.[1].body;
      expect(await db.pendingAdjustments.count()).toBe(1);
      first.unmount();
      render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
      fireEvent.click(screen.getByText("Review / adjust payment"));
      await screen.findByText("Retry same adjustment");
      expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("20.00");
      expect(screen.getByLabelText("Reason")).toBeDisabled();
      fireEvent.click(screen.getByText("Retry same adjustment"));
      await screen.findByText(/Saved at school/);
      expect(fetchMock.mock.calls[3]?.[1].body).toBe(original);
      expect(await db.pendingAdjustments.count()).toBe(0);
    }
  );
  it("does not send if the request cannot be saved durably", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => review });
    vi.stubGlobal("fetch", fetchMock);
    const failure = vi
      .spyOn(db.pendingAdjustments, "add")
      .mockRejectedValueOnce(new Error("Device storage full"));
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await screen.findByText(/Online owner review/);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Returned to student" } });
    fireEvent.click(screen.getByText("Save audited adjustment"));
    await screen.findByText(/Device storage full/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    failure.mockRestore();
  });
  it("blocks a different owner from replacing a saved unresolved request", async () => {
    await db.pendingAdjustments.put({
      key: JSON.stringify(["school", "payment"]),
      schoolId: "school",
      userId: "other",
      paymentId: "payment",
      body: { id: "prior" }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await screen.findByText(/Sign in as that owner/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await db.pendingAdjustments.toArray())[0]?.body.id).toBe("prior");
  });
  it("preserves an unresolved request after an account-change response", async () => {
    const body = {
      id: "prior",
      revision: 2,
      action: "REFUND",
      amount: "20.00",
      reason: "Returned to student"
    };
    await db.pendingAdjustments.put({
      key: JSON.stringify(["school", "payment"]),
      schoolId: "school",
      userId: "owner",
      paymentId: "payment",
      body
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => review })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: "ACCOUNT_CHANGED", message: "The signed-in owner changed." }
        })
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<PaymentAdjustment payment={payment} schoolId="school" userId="owner" />);
    fireEvent.click(screen.getByText("Review / adjust payment"));
    await screen.findByText("Retry same adjustment");
    fireEvent.click(screen.getByText("Retry same adjustment"));
    await screen.findByText("The signed-in owner changed.");
    expect((await db.pendingAdjustments.toArray())[0]?.body).toEqual(body);
    expect(fetchMock.mock.calls[1]?.[1].headers["X-Adjustment-User"]).toBe("owner");
  });
  it("keeps unresolved adjustments when a user tries to switch schools", async () => {
    await db.pendingAdjustments.put({
      key: "pending",
      schoolId: "school",
      userId: "owner",
      paymentId: "payment",
      body: { id: "prior" }
    });
    await expect(
      prepareLocalSchool({
        id: "new-owner",
        schoolId: "another-school",
        role: "OWNER",
        name: "Ada",
        phone: "08012345678"
      })
    ).rejects.toThrow("pending payment adjustments");
    expect(await db.pendingAdjustments.count()).toBe(1);
  });
});
