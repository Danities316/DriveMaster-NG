import { type FormEvent, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Pencil } from "lucide-react";
import { isValidStoredMoney, subtractMoney, type AuthenticatedUser } from "@drivemaster/shared";
import { StudentProgressSummary } from "../training/StudentProgressSummary";
import { db } from "../../db/db";
import { StudentApiError } from "./studentApi";
import { requestSync } from "../../sync/queue";
import { getOrCreateDeviceId } from "../../lib/device";
import { getLocalStudent } from "./studentLocalStore";
import { getLocalStudentPaymentHistory } from "./paymentLocalStore";
import { recordStudentPaymentOffline, refreshLocalStudent } from "./paymentService";

interface StudentDetailPageProps {
  studentId: string;
  viewer?: AuthenticatedUser;
  onBack: () => void;
  onEdit: (studentId: string) => void;
  canRecordPayment?: boolean;
  onTraining?: (studentId: string) => void;
}

interface PaymentFormState {
  amount: string;
  method: "CASH" | "BANK_TRANSFER" | "POS";
  reference: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-NG", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return iso;
  }
}

function emptyPaymentForm(): PaymentFormState {
  return {
    amount: "",
    method: "CASH",
    reference: ""
  };
}

function paymentSendError(message: string): string {
  if (/401|403|unauthor|forbidden|sign.?in|session|token/i.test(message))
    return "Sign in again to send saved payments.";
  if (/conflict|version|already|changed/i.test(message))
    return "A school record changed. Review the saved payment before trying again.";
  return "DriveMaster could not send a saved record yet. Your work is still on this device.";
}

/**
 * Read-only detail view — enrollment/tuition info plus the required
 * financial visibility (total tuition, amount paid, balance remaining).
 * Reads from Dexie via useLiveQuery, so it renders instantly offline and
 * updates automatically the moment a create/edit or background refresh
 * changes the underlying record.
 */
export function StudentDetailPage({
  studentId,
  viewer,
  onBack,
  onEdit,
  onTraining,
  canRecordPayment = false
}: StudentDetailPageProps) {
  const student = useLiveQuery(() => getLocalStudent(studentId), [studentId]);
  const training = useLiveQuery(async () => {
    if (!viewer || !["OWNER", "RECEPTIONIST"].includes(viewer.role)) return null;
    const cached = await db.trainingCache.get(viewer.id).catch(() => undefined);
    return cached &&
      cached.userId === viewer.id &&
      cached.schoolId === viewer.schoolId &&
      cached.snapshot.userId === viewer.id &&
      cached.snapshot.schoolId === viewer.schoolId &&
      cached.snapshot.viewerRole === viewer.role
      ? cached
      : null;
  }, [viewer?.id, viewer?.schoolId, viewer?.role]);
  const [savedPaymentId, setSavedPaymentId] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(() => emptyPaymentForm());
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const localPaymentHistory = useLiveQuery(
    () => getLocalStudentPaymentHistory(studentId),
    [studentId]
  );
  const syncState = useLiveQuery(() => db.syncState.get(getOrCreateDeviceId()), []);
  const isLoadingPayments = localPaymentHistory === undefined;
  const [paymentHistoryError, setPaymentHistoryError] = useState<string | null>(null);

  useEffect(() => {
    requestSync();
  }, [studentId]);

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPaymentError(null);

    const amount = paymentForm.amount.trim();
    if (!isValidStoredMoney(amount, true)) {
      setPaymentError("Enter a valid payment amount greater than 0.");
      return;
    }

    if (paymentForm.method !== "CASH" && !paymentForm.reference.trim()) {
      setPaymentError("Reference is required for BANK_TRANSFER and POS payments.");
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const result = await recordStudentPaymentOffline(studentId, {
        id: crypto.randomUUID(),
        amount,
        paymentDate: new Date().toISOString(),
        method: paymentForm.method,
        currency: "NGN",
        reference: paymentForm.method === "CASH" ? null : paymentForm.reference.trim() || null
      });
      await refreshLocalStudent(studentId);
      setSavedPaymentId(result.payment.id);
      setPaymentForm(emptyPaymentForm());
      setShowPaymentForm(false);
      if (result.queued) {
        setPaymentHistoryError("Payment saved on this device. Waiting to be sent.");
      }
    } catch (error) {
      setPaymentError(
        error instanceof StudentApiError
          ? error.message
          : "Something went wrong recording the payment. Please try again."
      );
    } finally {
      setIsSubmittingPayment(false);
    }
  }

  if (student === undefined) {
    return <p className="p-4 text-center text-slate-500">Loading...</p>;
  }

  if (student === null || student === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-8">
        <p className="text-slate-600">This student could not be found on this device.</p>
        <button type="button" onClick={onBack} className="text-brand-link underline">
          Back to students
        </button>
      </div>
    );
  }

  const payments = localPaymentHistory?.payments ?? null;
  const displayedTotalPaid = localPaymentHistory?.totalPaid ?? student.amountPaid;
  const displayedOutstandingBalance =
    localPaymentHistory?.outstandingBalance ?? student.balanceRemaining;
  const isSettled = displayedOutstandingBalance === "0.00";
  const trainingSummary =
    training?.schoolId === student.schoolId
      ? training.snapshot.summaries.find((s) => s.studentId === studentId)
      : undefined;
  const savedPayment = localPaymentHistory?.payments.find((p) => p.id === savedPaymentId);
  const savedPending =
    !!savedPaymentId && !!localPaymentHistory?.queuedPaymentIds.includes(savedPaymentId);
  const savedConflict =
    !!savedPaymentId && !!localPaymentHistory?.conflictPaymentIds.includes(savedPaymentId);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to students"
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(student.id)}
          className="flex min-h-[48px] items-center gap-1 rounded-lg border border-slate-300 px-4 text-slate-700 hover:bg-slate-50"
        >
          <Pencil size={16} aria-hidden="true" />
          Edit
        </button>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{student.name}</h1>
        <p className="text-base text-slate-600">{student.phone}</p>
      </div>

      <section
        aria-labelledby="student-money-heading"
        className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4"
      >
        <h2 id="student-money-heading" className="text-base font-medium text-slate-900">
          Money
        </h2>
        <div className="flex justify-between text-base">
          <span className="text-slate-500">Agreed fee</span>
          <span className="text-slate-900">₦{student.totalTuition}</span>
        </div>
        <div className="flex justify-between text-base">
          <span className="text-slate-500">Paid</span>
          <span className="font-medium text-brand-link">₦{displayedTotalPaid}</span>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-medium">
          <span className="text-slate-700">Still to pay</span>
          <span className={isSettled ? "text-brand-link" : "text-rose-600"}>
            ₦{displayedOutstandingBalance}
          </span>
        </div>
        {!!localPaymentHistory?.queuedPaymentIds.length && (
          <p className="text-sm text-amber-800">
            Saved on this device: {localPaymentHistory.queuedPaymentIds.length} payment(s) waiting
            to be sent. These totals include local payments except those needing attention; they are
            not all confirmed school records.
          </p>
        )}
        {savedPayment && (
          <p role="status">
            {savedConflict
              ? "This payment needs attention. It is not included in the balance."
              : savedPending
                ? "Payment saved on this device. Waiting to be sent."
                : "Payment recorded"}{" "}
            {savedPending ? "Still to pay on this device" : "Still to pay"}: ₦
            {displayedOutstandingBalance}
          </p>
        )}
        {syncState?.lastError ? (
          <div role="alert" className="pt-1 text-sm text-rose-600">
            <p>{paymentSendError(syncState.lastError)}</p>
            <p>Showing saved totals and payments waiting to be sent.</p>
            <details>
              <summary>Technical details</summary>
              <p>{syncState.lastError}</p>
            </details>
          </div>
        ) : null}
      </section>

      {onTraining && (
        <section className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
          <h2 className="text-base font-medium">Training</h2>
          {trainingSummary ? (
            <>
              <StudentProgressSummary summary={trainingSummary} />
              <p className="text-sm text-slate-600">
                Accepted training records, last loaded {formatDate(training!.loadedAt)}. Open
                training to refresh.
              </p>
            </>
          ) : (
            <p>
              {training === undefined
                ? "Loading saved training information…"
                : "Training information is unavailable here. Open training to check the latest package and progress."}
            </p>
          )}
          <button className="dm-secondary min-h-[48px]" onClick={() => onTraining(studentId)}>
            View training
          </button>
        </section>
      )}

      {canRecordPayment ? (
        <div className="rounded-lg border border-slate-200 p-4">
          {!showPaymentForm ? (
            <button
              type="button"
              onClick={() => setShowPaymentForm(true)}
              className="min-h-[48px] w-full rounded-lg bg-brand px-4 text-base font-medium text-brand-ink transition hover:bg-brand-hover"
            >
              Record Payment
            </button>
          ) : (
            <form
              aria-describedby={paymentError ? "student-payment-error" : undefined}
              onSubmit={handlePaymentSubmit}
              className="flex flex-col gap-3"
            >
              <h3 className="text-base font-medium text-slate-900">Record payment</h3>
              {isValidStoredMoney(paymentForm.amount.trim(), true) && (
                <p className="rounded-lg bg-slate-50 p-3" aria-live="polite">
                  Payment: ₦{paymentForm.amount.trim()}
                  <br />
                  Balance after payment:{" "}
                  <strong>
                    ₦{subtractMoney(displayedOutstandingBalance, paymentForm.amount.trim())}
                  </strong>
                  {!!localPaymentHistory?.queuedPaymentIds.length && (
                    <span> (includes payments saved on this device)</span>
                  )}
                </p>
              )}

              <div className="flex flex-col gap-1">
                <label htmlFor="payment-amount" className="text-sm font-medium text-slate-700">
                  Amount
                </label>
                <input
                  id="payment-amount"
                  type="text"
                  inputMode="decimal"
                  value={paymentForm.amount}
                  onChange={(event) =>
                    setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  placeholder="e.g. 25000.00"
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-base"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="payment-method" className="text-sm font-medium text-slate-700">
                  Payment method
                </label>
                <select
                  id="payment-method"
                  value={paymentForm.method}
                  onChange={(event) =>
                    setPaymentForm((prev) => ({
                      ...prev,
                      method: event.target.value as PaymentFormState["method"]
                    }))
                  }
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-base"
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="POS">POS</option>
                </select>
              </div>

              {paymentForm.method !== "CASH" ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="payment-reference" className="text-sm font-medium text-slate-700">
                    Reference
                  </label>
                  <input
                    id="payment-reference"
                    type="text"
                    value={paymentForm.reference}
                    onChange={(event) =>
                      setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))
                    }
                    placeholder="e.g. Transfer ID or POS batch"
                    className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-base"
                  />
                </div>
              ) : null}

              {paymentError ? (
                <p id="student-payment-error" role="alert" className="text-sm text-rose-600">
                  {paymentError}
                </p>
              ) : null}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPaymentForm(false);
                    setPaymentError(null);
                    setPaymentForm(emptyPaymentForm());
                  }}
                  className="min-h-[48px] flex-1 rounded-lg border border-slate-300 px-4 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment}
                  className="min-h-[48px] flex-1 rounded-lg bg-brand px-4 text-base font-medium text-brand-ink disabled:opacity-60"
                >
                  {isSubmittingPayment ? "Submitting..." : "Submit payment"}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-slate-900">Payment history</h2>
          {payments ? (
            <span className="text-sm text-slate-500">{payments.length} recorded</span>
          ) : null}
        </div>
        {!savedPayment &&
        paymentHistoryError &&
        Boolean(localPaymentHistory?.queuedPaymentIds.length) ? (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            {paymentHistoryError}
          </p>
        ) : null}

        {isLoadingPayments && !localPaymentHistory ? (
          <p className="rounded-lg border border-slate-200 p-4 text-center text-slate-500">
            Loading payment history...
          </p>
        ) : paymentHistoryError && !payments?.length ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Payment history is unavailable right now. The rest of the student details remain
            available.
          </p>
        ) : payments?.length === 0 ? (
          <p className="rounded-lg border border-slate-200 p-4 text-center text-slate-500">
            {syncState?.bootstrapComplete
              ? "No payments recorded"
              : "Payment records are still loading. Showing the last saved totals."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200">
            {payments?.map((payment) => (
              <li key={payment.id} className="flex flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    {formatDate(payment.paymentDate)}
                    {localPaymentHistory?.queuedPaymentIds.includes(payment.id) ? (
                      <span className="ml-2 text-amber-700">
                        {localPaymentHistory.conflictPaymentIds.includes(payment.id)
                          ? "Needs attention — not included in balance"
                          : "Waiting to be sent"}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-medium text-brand-link">₦{payment.amount}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                  <span>
                    {payment.method === "BANK_TRANSFER"
                      ? "Bank transfer"
                      : payment.method === "POS"
                        ? "POS"
                        : "Cash"}
                  </span>
                  {payment.reference ? <span>Reference: {payment.reference}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="rounded-lg border border-slate-200 p-4">
        <summary className="min-h-[48px] cursor-pointer py-3">Student details</summary>
        <dl className="grid grid-cols-2 gap-y-3 text-base">
          <dt className="text-slate-500">License number</dt>
          <dd className="text-right text-slate-900">{student.licenseNumber ?? "—"}</dd>

          <dt className="text-slate-500">Enrolled</dt>
          <dd className="text-right text-slate-900">{formatDate(student.enrollmentDate)}</dd>
        </dl>
      </details>
    </div>
  );
}
