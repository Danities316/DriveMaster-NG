import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/db";
import { useState } from "react";
import type { Payment } from "@drivemaster/shared";
import { requestSync } from "../../sync/queue";
const base: string = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
interface Review {
  payment: Payment;
  revision: number;
  refundable: string;
  reversed: boolean;
  refunded: boolean;
  undone: boolean;
  history: Payment[];
}
export function PaymentAdjustment({
  payment,
  schoolId,
  userId
}: {
  payment: Payment;
  schoolId: string;
  userId: string;
}) {
  const students = useLiveQuery(
    () => db.students.where("schoolId").equals(schoolId).sortBy("name"),
    [schoolId]
  );
  const [review, setReview] = useState<Review | null>(null);
  const [action, setAction] = useState("REFUND");
  const [amount, setAmount] = useState(payment.amount);
  const [studentId, setStudentId] = useState(payment.studentId);
  const [method, setMethod] = useState(payment.method);
  const [reference, setReference] = useState(payment.reference ?? "");
  const [date, setDate] = useState(payment.paymentDate.slice(0, 10));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [saved, setSaved] = useState(false);
  const pendingKey = JSON.stringify([schoolId, payment.id]);
  const path = `${base}/students/${payment.studentId}/payments/${payment.id}`;
  async function call(url: string, body?: Record<string, unknown>) {
    if (!navigator.onLine) throw new Error("Connect to the internet to review or adjust payments.");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      credentials: "include",
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Adjustment-User": userId },
            body: JSON.stringify(body)
          }
        : {})
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error?.message ?? "Could not save adjustment."), {
        status: response.status,
        code: data.error?.code
      });
    return data;
  }
  function restore(body: Record<string, unknown>) {
    setPending(body);
    setAction(String(body.action));
    setAmount(String(body.amount ?? payment.amount));
    setReason(String(body.reason ?? ""));
    setStudentId(String(body.studentId ?? payment.studentId));
    setMethod((body.method ?? payment.method) as Payment["method"]);
    setReference(String(body.reference ?? payment.reference ?? ""));
    setDate(String(body.paymentDate ?? payment.paymentDate).slice(0, 10));
  }
  async function clearPending(id: unknown) {
    await db.transaction("rw", db.pendingAdjustments, async () => {
      const stored = await db.pendingAdjustments.get(pendingKey);
      if (stored?.userId === userId && stored.body.id === id)
        await db.pendingAdjustments.delete(pendingKey);
    });
    setPending(null);
  }
  async function open() {
    setBusy(true);
    setMessage("");
    try {
      const stored = await db.pendingAdjustments.get(pendingKey);
      if (stored && stored.userId !== userId)
        throw new Error(
          "Another owner has an unresolved adjustment on this device. Sign in as that owner to check its outcome first."
        );
      if (stored) {
        restore(stored.body);
        setMessage(
          "A saved adjustment needs checking. Retry it to confirm the outcome; the same request will be used."
        );
      }
      setReview(await call(`${path}/review`));
      if (!stored) setAction(payment.entryType === "REFUND" ? "UNDO_REFUND" : "REFUND");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!review || busy) return;
    const body = pending ?? {
      id: crypto.randomUUID(),
      revision: review.revision,
      action,
      reason,
      ...(action === "CORRECT" || action === "REFUND" ? { amount } : {}),
      ...(action === "CORRECT"
        ? { studentId, method, reference, paymentDate: new Date(`${date}T12:00:00Z`).toISOString() }
        : {})
    };
    setBusy(true);
    setMessage("");
    try {
      // Reserve before HTTP; IndexedDB serializes competing tabs on this payment.
      const reserved = await db.transaction("rw", db.pendingAdjustments, async () => {
        const existing = await db.pendingAdjustments.get(pendingKey);
        if (existing) return existing;
        const entry = { key: pendingKey, schoolId, userId, paymentId: payment.id, body };
        await db.pendingAdjustments.add(entry);
        return entry;
      });
      if (reserved.userId !== userId)
        throw new Error("Another owner has an unresolved adjustment. Sign in as that owner first.");
      restore(reserved.body);
      if (reserved.body.id !== body.id) {
        setMessage(
          "An earlier adjustment was saved in another tab. Retry that saved request before making a new adjustment."
        );
        return;
      }
      await call(`${path}/adjustments`, reserved.body);
      await clearPending(reserved.body.id);
      setSaved(true);
      setReview(null);
      setMessage("Saved at school. This device’s balance will update after sync.");
      requestSync();
    } catch (e) {
      const { status, code } = e as { status?: number; code?: string };
      if (status === 400 || (status === 409 && code === "PAYMENT_ADJUSTMENT_ERROR"))
        await clearPending(body.id);
      setMessage(
        `${(e as Error).message}${!status || status >= 500 ? " Retry this same request to check the outcome safely." : ""}`
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 text-sm" data-school={schoolId}>
      {!review && !saved && (
        <button type="button" disabled={busy} onClick={open} className="min-h-[44px] underline">
          Review / adjust payment
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {review && (
        <form onSubmit={submit} className="grid gap-3 rounded border p-3">
          <p>
            Online owner review. Original: ₦{review.payment.amount}. Refundable: ₦
            {review.refundable}. {review.history.length} linked entries.
          </p>
          <p>Refunds record money already returned. These actions do not transfer money.</p>
          {(review.reversed || review.undone) && !pending ? (
            <p>This entry has already been reversed. Review its replacement where applicable.</p>
          ) : (
            <>
              <fieldset disabled={busy || !!pending} className="grid gap-3">
                <label>
                  Action{" "}
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    {payment.entryType === "REFUND" ? (
                      <option value="UNDO_REFUND">Undo mistaken refund record</option>
                    ) : (
                      <>
                        <option value="REFUND">Record refund already paid</option>
                        <option value="REVERSE" disabled={review.refunded}>
                          Reverse mistaken payment record
                        </option>
                        <option value="CORRECT" disabled={review.refunded}>
                          Correct payment details
                        </option>
                      </>
                    )}
                  </select>
                </label>
                {["REFUND", "CORRECT"].includes(action) && (
                  <label>
                    Amount (NGN){" "}
                    <input
                      required
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                )}
                {action === "CORRECT" && (
                  <>
                    <label>
                      Student{" "}
                      <select
                        required
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                      >
                        {students?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ? {s.phone}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payment date{" "}
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <label>
                      Method{" "}
                      <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value as Payment["method"])}
                      >
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="POS">POS</option>
                      </select>
                    </label>
                    {method !== "CASH" && (
                      <label>
                        Reference{" "}
                        <input
                          required
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </label>
                    )}
                  </>
                )}
                <label>
                  Reason{" "}
                  <textarea
                    required
                    minLength={5}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </fieldset>
              <button disabled={busy} type="submit" className="min-h-[44px] rounded border">
                {busy ? "Saving…" : pending ? "Retry same adjustment" : "Save audited adjustment"}
              </button>
            </>
          )}
          {!pending && (
            <button type="button" disabled={busy} onClick={() => setReview(null)}>
              Close review
            </button>
          )}
        </form>
      )}
    </div>
  );
}
