import { SchoolDay, type TrainingDestination } from "./SchoolDay";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Plus,
  Search,
  Users,
  Wallet,
  Clock3,
  ReceiptText
} from "lucide-react";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { loadDashboard, naira } from "./dashboardData";
import { db } from "../../db/db";
import { FirstDayOnboarding } from "./FirstDayOnboarding";

interface Props {
  user: AuthenticatedUser;
  paymentsOnly?: boolean;
  onAdd: () => void;
  onStudents: () => void;
  onStudent: (id: string) => void;
  onPayments: () => void;
  onSync: () => void;
  onTraining?: (destination: TrainingDestination) => void;
  onFleet?: () => void;
}
export function Dashboard({
  user,
  paymentsOnly = false,
  onAdd,
  onStudents,
  onStudent,
  onPayments,
  onSync,
  onTraining
}: Props) {
  const [minute, setMinute] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setMinute(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const result = useLiveQuery(async () => {
    try {
      const [data, training] = await Promise.all([
        loadDashboard(user.schoolId, new Date(minute)),
        db.trainingQueue.where("userId").equals(user.id).toArray()
      ]);
      const ownTraining = training.filter(
        (row) => row.schoolId === user.schoolId && row.role === user.role
      );
      return {
        data: {
          ...data,
          pending: data.pending + ownTraining.filter((row) => row.status !== "FAILED").length,
          review: data.review + ownTraining.filter((row) => row.status === "FAILED").length
        },
        error: false
      };
    } catch {
      return { data: null, error: true };
    }
  }, [user.id, user.schoolId, user.role, minute]);
  const data = result?.data;
  if (result?.error)
    return (
      <div className="dashboard-empty" role="alert">
        <CircleAlert />
        <h1>We couldn’t load your dashboard</h1>
        <p>Your saved records have not been changed.</p>
        <button className="dm-primary" onClick={() => setMinute(Date.now())}>
          Try again
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="dashboard-loading" role="status">
        Loading your school overview…
      </div>
    );
  const rows = data.paymentRows.filter(
    (row) =>
      (status === "All statuses" ||
        row.status === status ||
        (status === "Needs attention" && ["Needs review", "Conflict"].includes(row.status))) &&
      `${row.studentName} ${row.reference ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );
  const lastPage = Math.max(0, Math.ceil(rows.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const greeting =
    user.role === "OWNER" ? "Your school, at a glance." : "Ready for a productive day.";
  return (
    <div className="dashboard-content">
      <div className="dashboard-heading">
        <div>
          <p className="dm-eyebrow">{paymentsOnly ? "SCHOOL MONEY" : "SCHOOL OVERVIEW"}</p>
          <h1>{paymentsOnly ? "Money" : `Hello, ${user.name.split(" ")[0]}.`}</h1>
          <p>
            {paymentsOnly
              ? "See who has paid, who still owes and where training money goes."
              : greeting}
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="dm-secondary" onClick={onStudents}>
            <Wallet size={17} />
            Record payment
          </button>
          <button className="dm-primary" onClick={onAdd}>
            <Plus size={18} />
            Add student
          </button>
        </div>
      </div>
      {!paymentsOnly && onTraining && (
        <FirstDayOnboarding
          user={user}
          studentCount={data.students.length}
          paymentCount={data.paymentRows.length}
          onSetup={() => onTraining({ tab: "setup" })}
          onAddStudent={onAdd}
          onRecordPayment={onStudents}
          onTraining={onTraining}
        />
      )}
      {!paymentsOnly && onTraining && (
        <SchoolDay
          user={user}
          attention={{
            recordsNeedAttention: data.review,
            recordsWaiting: data.pending,
            studentsOwing: data.owing.length
          }}
          onTraining={onTraining}
          onSavedRecords={onSync}
          onStudents={onStudents}
        />
      )}
      {!data.sync?.bootstrapComplete && (
        <div className="dm-notice">
          <Clock3 size={18} />
          <span>
            Showing saved records. Totals may be incomplete until the first update finishes.
          </span>
          <button onClick={onSync}>
            View saved records <ArrowRight size={14} />
          </button>
        </div>
      )}
      {paymentsOnly && (
        <section className="money-links" aria-label="Money areas">
          <button className="dm-panel money-link-card" onClick={onStudents}>
            <span>
              <strong>Students still owing</strong>
              <small>See each student&rsquo;s fee and balance</small>
            </span>
            <ArrowRight size={17} />
          </button>
          {user.role === "OWNER" && onTraining && (
            <button
              className="dm-panel money-link-card"
              onClick={() => onTraining({ tab: "costs" })}
            >
              <span>
                <strong>Costs, expenses &amp; fuel money</strong>
                <small>See where training money is going</small>
              </span>
              <ArrowRight size={17} />
            </button>
          )}
        </section>
      )}
      <p className="training-help">
        Payment totals come from records entered by your school. “Record sent” means saved to the
        school account; it does not verify a bank transfer.
      </p>
      <div className={`dashboard-stats ${paymentsOnly ? "" : "dashboard-money"}`}>
        {paymentsOnly && (
          <article className="stat-card">
            <div className="stat-label">
              Registered students <Users size={19} />
            </div>
            <strong>{data.students.length.toLocaleString()}</strong>
            <button onClick={onStudents}>
              View students <ArrowUpRight size={14} />
            </button>
          </article>
        )}
        <article className="stat-card stat-featured">
          <div className="stat-label">
            Received today <ArrowDownLeft size={20} />
          </div>
          <strong>{naira(data.todayPaid)}</strong>
          <span>Accepted school records · Lagos time</span>
        </article>
        <article className="stat-card">
          <div className="stat-label">
            Students still owe <Wallet size={19} />
          </div>
          <strong>{naira(data.outstanding)}</strong>
          <span>{data.owing.length} students with a balance · saved tuition</span>
        </article>
        <article className="stat-card">
          <div className="stat-label">
            Records waiting to be sent <Clock3 size={19} />
          </div>
          <strong>
            {data.pending}
            <small> records</small>
          </strong>
          <button onClick={onSync}>
            {data.review ? `${data.review} need attention` : "View saved records"}{" "}
            <ArrowUpRight size={14} />
          </button>
        </article>
      </div>
      <section className="dm-panel">
        <div className="panel-heading">
          <div>
            <h2>{paymentsOnly ? "Payment history" : "Recent payments"}</h2>
            <p>
              {paymentsOnly
                ? "Search by student or payment reference"
                : "A clear view of the latest money received"}
            </p>
          </div>
          {!paymentsOnly && (
            <button className="text-button" onClick={onPayments}>
              View all <ArrowRight size={15} />
            </button>
          )}
        </div>
        {paymentsOnly && (
          <div className="ledger-filters">
            <label className="dm-search">
              <Search size={18} />
              <input
                type="search"
                aria-label="Search payments"
                placeholder="Search student or reference…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <select
              aria-label="Payment status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              {["All statuses", "Confirmed", "Pending", "Needs attention"].map((value) => (
                <option key={value} value={value}>
                  {value === "Confirmed"
                    ? "Record sent"
                    : value === "Pending"
                      ? "Waiting to be sent"
                      : value}
                </option>
              ))}
            </select>
          </div>
        )}
        {rows.length ? (
          <div className="table-scroll">
            <table className="dm-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Open student</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(paymentsOnly
                  ? rows.slice(currentPage * 25, (currentPage + 1) * 25)
                  : rows.slice(0, 5)
                ).map((row) => (
                  <tr key={row.id}>
                    <td data-label="Student">
                      <button className="student-link" onClick={() => onStudent(row.studentId)}>
                        <span className="student-avatar">
                          {row.studentName.slice(0, 2).toUpperCase()}
                        </span>
                        <span>
                          {row.studentName}
                          <small>{row.reference || "No reference"}</small>
                        </span>
                      </button>
                    </td>
                    <td data-label="Date">
                      {new Date(row.paymentDate).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "Africa/Lagos"
                      })}
                    </td>
                    <td data-label="Method">
                      {{ CASH: "Cash", BANK_TRANSFER: "Bank transfer", POS: "POS" }[row.method]}
                    </td>
                    <td data-label="Amount" className="amount-cell">
                      {naira(row.amount)}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`payment-badge ${row.status === "Confirmed" ? "confirmed" : "pending"}`}
                      >
                        <span />
                        {row.status === "Confirmed"
                          ? "Record sent"
                          : row.status === "Pending"
                            ? "Waiting to be sent"
                            : ["Needs review", "Conflict"].includes(row.status)
                              ? "Needs attention"
                              : row.status}
                      </span>
                    </td>
                    <td className="payment-open-cell">
                      <button
                        className="row-open"
                        aria-label={`Open ${row.studentName}'s record`}
                        onClick={() => onStudent(row.studentId)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dashboard-empty">
            <ReceiptText size={28} />
            <h3>
              {search || status !== "All statuses"
                ? "No matching payments"
                : "Your payment history starts here"}
            </h3>
            <p>
              {search || status !== "All statuses"
                ? "Try another name, reference, or status."
                : "Choose a student to record their first payment."}
            </p>
            {!search && status === "All statuses" && (
              <button className="dm-secondary" onClick={onStudents}>
                Find a student <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
        {paymentsOnly && rows.length > 25 && (
          <div className="ledger-pagination">
            <span>
              Page {currentPage + 1} of {lastPage + 1} · {rows.length} payments
            </span>
            <div>
              <button
                className="dm-secondary"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <button
                className="dm-secondary"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
      <footer className="dashboard-footer">
        <span>DriveMaster NG · Built for the way your school works.</span>
        <span>
          {data.sync?.lastSyncAt
            ? `Last updated ${new Date(data.sync.lastSyncAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}`
            : "Waiting for first update"}
        </span>
      </footer>
    </div>
  );
}
