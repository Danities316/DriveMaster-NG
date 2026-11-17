import { StaffAccounts } from "./StaffAccounts";
import { StudentTrainingReport } from "./StudentTrainingReport";
import { EntryForm, Field } from "./TrainingFields";
import { ProfileSettings } from "./ProfileSettings";
import { DocumentReminders } from "./DocumentReminders";
import { VehicleDocumentsSettings } from "./VehicleDocumentsSettings";
import { CostReport } from "./CostReport";
import { EnrollmentSettings } from "./EnrollmentSettings";
import { EnrollmentReview } from "./EnrollmentReview";
import { EligibilityCard } from "./EligibilityCard";
import { SchoolRulesSettings } from "./SchoolRulesSettings";
import { CurriculumSettings } from "./CurriculumSettings";
import { BookTrainingForm, type BookingRequirement } from "./BookTrainingForm";
import { StudentConfirmation } from "./StudentConfirmation";
import { TrainingTripCard } from "./TrainingTripCard";
import { SetupGuide } from "./SetupGuide";
import { SchoolSetupHome, type SetupArea } from "./SchoolSetupHome";
import { matchesTrainingView, trainingGroups, type TrainingView } from "./trainingViews";
import { Fragment, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { AuthenticatedUser, TrainingCommand } from "@drivemaster/shared";
import { db } from "../../db/db";
import { naira } from "../dashboard/dashboardData";
import {
  discardTraining,
  projectedTraining,
  queueTraining,
  sendTraining,
  trainingRequest,
  trainingSyncEvent,
  lastTrainingStatus,
  type TrainingSyncNotice
} from "./trainingLocal";
import "./training.css";

const nowLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const value = (form: FormData, key: string) => String(form.get(key) ?? "");
const statuses: Record<string, string> = {
  BOOKED: "Booked",
  STARTED: "Training in progress",
  COMPLETED: "Training finished",
  CANCELLED: "Cancelled — no lesson deducted",
  DRIVING: "Lesson started",
  MISSED: "Absent — book another date",
  PENDING: "Waiting for student confirmation",
  CONFIRMED: "Lesson confirmed",
  DISPUTED: "Student reported a problem",
  VOID: "This lesson was not deducted"
};
const trainingSendError = (error?: string) => {
  const text = error?.toLowerCase() ?? "";
  if (/401|auth|session|sign.?in/.test(text)) return "Sign in again to send this record.";
  if (/version|conflict|changed/.test(text))
    return "The school record changed before this update could be accepted. Review it before trying again.";
  return "DriveMaster could not send this record yet. Try again later.";
};

export function TrainingPage({
  user,
  onLogout,
  initialStudentId = "",
  initialTab,
  initialFilter = "today",
  initialBook = false,
  initialSetupArea = "",
  onAddStudent,
  onVehicles
}: {
  user: AuthenticatedUser;
  onLogout?: () => void;
  initialStudentId?: string;
  initialTab?: "outings" | "students" | "setup" | "costs";
  initialFilter?: TrainingView;
  initialBook?: boolean;
  initialSetupArea?: SetupArea | "";
  onAddStudent?: () => void;
  onVehicles?: () => void;
}) {
  const data = useLiveQuery(
    async () => ({
      cached: await db.trainingCache.get(user.id),
      queue: (await db.trainingQueue.where("userId").equals(user.id).toArray())
        .filter((q) => q.schoolId === user.schoolId && q.role === user.role)
        .sort((a, b) => a.createdAt - b.createdAt)
    }),
    [user.id, user.schoolId, user.role]
  );
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [senderBusy, setSenderBusy] = useState(false);
  useEffect(() => {
    const show = (notice?: TrainingSyncNotice) => {
      if (
        !notice ||
        notice.userId !== user.id ||
        notice.schoolId !== user.schoolId ||
        notice.role !== user.role
      )
        return;
      setSenderBusy(notice.kind === "busy");
      if (notice.kind === "sent") {
        setError("");
        setMessage(notice.message);
      } else {
        setMessage("");
        setError(notice.message);
      }
    };
    const listener = (event: Event) => show((event as CustomEvent<TrainingSyncNotice>).detail);
    window.addEventListener(trainingSyncEvent, listener);
    show(lastTrainingStatus(user));
    return () => window.removeEventListener(trainingSyncEvent, listener);
  }, [user]);
  const [tab, setTab] = useState<"outings" | "students" | "setup" | "registrations" | "costs">(
      initialTab ?? (initialBook ? "outings" : initialStudentId ? "students" : "outings")
    ),
    [studentFilter, setStudentFilter] = useState(initialStudentId);
  const [moreViewsOpen, setMoreViewsOpen] = useState(
    initialTab === "costs" || initialTab === "setup"
  );
  const [outingFilter, setOutingFilter] = useState<TrainingView>(initialFilter);
  const [scheduleNow, setScheduleNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setScheduleNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const [setupTarget, setSetupTarget] = useState(initialBook ? "book-outing" : "");
  const [setupArea, setSetupArea] = useState<SetupArea | "">(initialSetupArea);
  const [accountRole, setAccountRole] = useState("STUDENT");
  useEffect(() => {
    if (!setupTarget) return;
    const target = document.getElementById(setupTarget);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target?.focus();
    setSetupTarget("");
  }, [setupTarget, tab, data?.cached]);
  const openSetup = (target: string) => {
    setTab(target === "book-outing" ? "outings" : "setup");
    if (target === "setup-packages" || target === "setup-enrollment") setSetupArea("training");
    if (target === "setup-accounts" || target === "setup-pay") setSetupArea("people");
    if (target === "setup-accounts") setAccountRole("INSTRUCTOR");
    setSetupTarget(target);
  };
  const resolveBookingRequirement = (requirement: BookingRequirement) => {
    if (requirement === "students") return onAddStudent?.();
    if (requirement === "vehicles") return onVehicles?.();
    if (requirement === "instructors") return openSetup("setup-accounts");
    openSetup(requirement === "packages" ? "setup-packages" : "setup-enrollment");
  };
  const owner = user.role === "OWNER",
    office = owner || user.role === "RECEPTIONIST",
    student = user.role === "STUDENT";
  async function refresh(recoverLease = false) {
    if (sending) return;
    setError("");
    if (navigator.onLine === false) {
      setMessage("No internet. Your records stay saved on this device.");
      return;
    }
    setSending(true);
    try {
      await sendTraining(user, { force: true, recoverLease });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect to the internet and try again.");
    } finally {
      setSending(false);
    }
  }
  async function command(
    action: string,
    targetId: string,
    payload: unknown,
    expectedVersion?: number
  ) {
    const entry: Omit<TrainingCommand, "id"> = { action, targetId, data: payload, expectedVersion };
    await queueTraining(user, entry);
    setMessage(
      action === "START"
        ? "Training start saved on this device. Waiting to be sent."
        : action === "FINISH"
          ? "Training finish saved on this device. Waiting to be sent."
          : action === "RETURN_FUEL"
            ? "Return saved on this device. Waiting to be sent."
            : "Saved on this device. Waiting to be sent. DriveMaster will try to send it when possible."
    );
  }
  const raw =
    data?.cached?.schoolId === user.schoolId &&
    data.cached.snapshot.viewerRole === user.role &&
    data.cached.snapshot.userId === user.id
      ? data.cached.snapshot
      : undefined;
  const snapshot = raw ? projectedTraining(raw, data?.queue ?? []) : undefined;
  const scheduleGroups = trainingGroups(
    snapshot?.outings ?? [],
    outingFilter,
    new Set(
      (data?.queue ?? [])
        .filter((q) => q.status === "FAILED" || q.status === "CONFLICT")
        .map((q) => q.targetId)
    ),
    scheduleNow
  );
  const pending = (id: string) => (data?.queue ?? []).filter((q) => q.targetId === id);
  const savedTrainingRecords = [...(data?.queue ?? [])].sort(
    (a, b) =>
      Number(b.status !== "PENDING") - Number(a.status !== "PENDING") || a.createdAt - b.createdAt
  );
  const name = (id: string) => snapshot?.students.find((s) => s.id === id)?.name ?? "Student";
  const dateText = (date: string) =>
    new Date(date).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="dashboard-content training-page">
      <div className="dashboard-heading">
        <div>
          <p className="dm-eyebrow">
            {student
              ? `${user.name.toUpperCase()} DRIVING LESSONS`
              : office
                ? "TRAINING AND COSTS"
                : `${user.name.toUpperCase()} DRIVING LESSONS`}
          </p>
          <h1>
            {student || user.role === "INSTRUCTOR"
              ? `Hello, ${user.name}.`
              : tab === "outings" && outingFilter === "today"
                ? "Today's training"
                : "Training"}
          </h1>
          {!student && (tab === "outings" || user.role === "INSTRUCTOR") && (
            <p>
              {scheduleNow.toLocaleDateString("en-NG", {
                timeZone: "Africa/Lagos",
                weekday: "long",
                day: "numeric",
                month: "long"
              })}
            </p>
          )}
          <p>
            {student
              ? "See what you have completed, what comes next and confirm each lesson in one place."
              : office
                ? "Book lessons, start training and follow each student’s progress."
                : "See today's lessons, mark attendance and record each result with fewer steps."}
          </p>
        </div>
        <div className="fleet-actions">
          <button className="dm-secondary" disabled={sending} onClick={() => void refresh()}>
            {sending ? "Sending…" : "Refresh"}
          </button>
          {onLogout && (
            <button className="dm-secondary" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className="fleet-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="fleet-error" role="alert">
          {error}
        </p>
      )}
      {senderBusy && (
        <div className="dm-notice">
          <p>
            If sending is stuck, restart it here. Existing records are kept and accepted requests
            are not created twice.
          </p>
          <button className="dm-primary" disabled={sending} onClick={() => void refresh(true)}>
            {sending ? "Restarting…" : "Restart sending"}
          </button>
        </div>
      )}
      {!!data?.queue.length && (
        <section className="dm-panel training-panel">
          <h2>Saved training records</h2>
          <p>These records are saved on this device. They are not yet accepted school records.</p>
          <p>
            Records are sent in the order you saved them. If the first one needs attention, later
            records wait behind it.
          </p>
          <button className="dm-primary" disabled={sending} onClick={() => void refresh()}>
            {sending ? "Sending…" : "Send saved records"}
          </button>
          <div className="saved-training-cards">
            {savedTrainingRecords.map((q, index) => (
              <Fragment key={q.id}>
                {(index === 0 || savedTrainingRecords[index - 1]?.status !== q.status) && (
                  <h3>{q.status === "PENDING" ? "Waiting to be sent" : "Needs attention"}</h3>
                )}
                <details
                  className={
                    q.status !== "PENDING"
                      ? "saved-training-card saved-record-attention"
                      : "saved-training-card"
                  }
                  open={q.id === data.queue[0]?.id && q.status !== "PENDING" ? true : undefined}
                >
                  <summary>
                    {(
                      {
                        PACKAGE: "Training package",
                        ENROLL: "Student package",
                        SETTINGS: "Fuel money setting",
                        SCHOOL_RULES: "School rules",
                        ENROLLMENT_RULES: "Student training target",
                        ENROLLMENT_SETTINGS: "QR enrollment settings",
                        EXTRA_LESSONS: "Extra student lessons",
                        COMPLETE_SCHOOL: "School training completion",
                        SALARY: "Monthly instructor pay",
                        VEHICLE_DOCUMENTS: "Vehicle document dates",
                        EXPENSE: "School expense",
                        VOID_EXPENSE: "Cancelled expense",
                        RETURN_FUEL: "Fuel money returned",
                        BOOK: "Lesson booking",
                        START: "Training in progress",
                        FINISH: "Completed lessons",
                        RESPOND: "Student response",
                        RESOLVE: "Owner’s review",
                        RESCHEDULE: "Booking moved",
                        CANCEL: "Booking cancelled",
                        ALLOWANCE: "Training trip fuel money"
                      } as Record<string, string>
                    )[q.action] ?? "Training record"}{" "}
                    — {q.status === "PENDING" ? "Waiting to be sent" : "Needs attention"}
                  </summary>
                  <p>
                    Saved{" "}
                    {new Date(q.createdAt).toLocaleString("en-NG", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Africa/Lagos"
                    })}
                  </p>
                  {q.status === "CONFLICT" ? (
                    <p role="alert">
                      {q.error} Edit the booking or cancel this saved change below. It will not be
                      retried automatically.
                    </p>
                  ) : (
                    q.status === "FAILED" && <p>{trainingSendError(q.error)}</p>
                  )}
                  {q.error && (
                    <details>
                      <summary>Technical details</summary>
                      <p>{q.error}</p>
                    </details>
                  )}
                  <dl className="training-pending-details">
                    {Object.entries(q.data as Record<string, unknown>)
                      .filter(
                        ([key]) =>
                          !["packageVersion", "studentVersion", "rulesVersion"].includes(key)
                      )
                      .map(([key, content]) => {
                        const labels: Record<string, string> = {
                          name: "Name",
                          enabled: "Registration open",
                          welcome: "Welcome message",
                          packageIds: "Available packages",
                          requiredFields: "Details required now",
                          allowUnpaidStart: "Allow activation before payment",
                          fee: "Extra fee (naira)",
                          schoolTargetDays: "School target (separate days)",
                          requireInstructorNin: "Require instructor NIN",
                          requireInstructorLicence: "Require instructor licence",
                          permitExpiryAction: "Expired or missing permit action",
                          permitReminderDays: "Permit reminder days",
                          sessions: "Lessons",
                          minutes: "Driving minutes",
                          price: "Fee (naira)",
                          fuelPerStudent: "Fuel money per student (naira)",
                          reason: "Reason",
                          startedAt: "Start time",
                          endedAt: "Finish time",
                          plannedStart: "Booked time",
                          odometer: "Mileage (km)",
                          fuelOdometer: "Fuel purchase mileage",
                          fuelDate: "Fuel purchase time",
                          litres: "Litres",
                          receiptReference: "Receipt",
                          fullTank: "Full tank",
                          salary: "Monthly pay (naira)",
                          teachingHours: "Planned teaching hours",
                          month: "Month",
                          attended: "Attended",
                          credit: "Count as completed",
                          instructorId: "Instructor",
                          vehicleId: "Vehicle",
                          studentId: "Student",
                          studentIds: "Students",
                          present: "Students present",
                          packageId: "Package",
                          lessons: "Lesson notes"
                        };
                        const display =
                          key === "permitExpiryAction" || key === "vehicleExpiryAction"
                            ? content === "BLOCK"
                              ? "Stop booking and starting training"
                              : "Warn and allow training"
                            : key === "lessons" && Array.isArray(content)
                              ? content
                                  .map((l) => {
                                    const row = l as {
                                      studentId: string;
                                      minutes: number;
                                      topics: string;
                                      note: string;
                                    };
                                    return (
                                      name(row.studentId) +
                                      ": " +
                                      row.minutes +
                                      " minutes; " +
                                      row.topics +
                                      "; " +
                                      row.note
                                    );
                                  })
                                  .join(" | ")
                              : ["present", "studentIds"].includes(key) && Array.isArray(content)
                                ? content.map((id) => name(String(id))).join(", ")
                                : key === "studentId"
                                  ? name(String(content))
                                  : key === "instructorId"
                                    ? (snapshot?.instructors.find((i) => i.id === content)?.name ??
                                      "Assigned instructor")
                                    : key === "vehicleId"
                                      ? (snapshot?.vehicles.find((v) => v.id === content)
                                          ?.plateNumber ?? "Assigned vehicle")
                                      : key === "packageId"
                                        ? (snapshot?.packages.find((p) => p.id === content)?.data
                                            .name ?? "Chosen package")
                                        : typeof content === "boolean"
                                          ? content
                                            ? "Yes"
                                            : "No"
                                          : String(content);
                        return (
                          <div key={key}>
                            <dt>{labels[key] ?? key}</dt>
                            <dd>{display}</dd>
                          </div>
                        );
                      })}
                  </dl>
                  {q.status !== "PENDING" && (
                    <div className="fleet-actions">
                      {q.status === "FAILED" && (
                        <button
                          className="dm-secondary"
                          onClick={() =>
                            void db.trainingQueue
                              .update(q.id, { status: "PENDING", attempts: 0, nextAttemptAt: 0 })
                              .then(() => refresh())
                          }
                        >
                          Try again
                        </button>
                      )}
                      <button
                        className="dm-secondary"
                        onClick={() =>
                          void discardTraining(user, q.id).catch((e: Error) => setError(e.message))
                        }
                      >
                        {q.status === "CONFLICT"
                          ? "Cancel this saved change and later steps for this record"
                          : "Remove this unsent change and later steps for this record"}
                      </button>
                    </div>
                  )}
                </details>
              </Fragment>
            ))}
          </div>
        </section>
      )}
      {!snapshot ? (
        <div className="dashboard-empty">
          <h2>{student ? "Load your lessons" : "Load your training records"}</h2>
          <p>
            {student
              ? "Connect to the internet and select Refresh. After loading, you can view your lessons and confirm whether they took place."
              : user.role === "INSTRUCTOR"
                ? "Connect to the internet and select Refresh. After loading, you can record permitted lesson details on this device without internet."
                : "Connect to the internet and select Refresh. After loading, you can manage bookings and training records on this device without internet."}
          </p>
        </div>
      ) : (
        <>
          <p className="training-help">
            Last loaded: {dateText(data!.cached!.loadedAt)}. Waiting changes do not count as
            confirmed lessons or bookings.
          </p>
          {office && (
            <nav className="training-tabs" aria-label="Training views">
              {(
                [
                  ["outings", "Today’s lessons"],
                  ["students", "Student progress"]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "dm-primary" : "dm-secondary"}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => {
                    setTab(id);
                    setMoreViewsOpen(false);
                    if (id === "outings") setOutingFilter("today");
                  }}
                >
                  {label}
                </button>
              ))}
              <details
                className="training-more-views"
                open={moreViewsOpen}
                onToggle={(event) => setMoreViewsOpen(event.currentTarget.open)}
              >
                <summary>
                  {tab === "costs"
                    ? "More views · Costs and expenses"
                    : tab === "registrations"
                      ? "More views · Registrations"
                      : tab === "setup"
                        ? "More views · School setup"
                        : "More views"}
                </summary>
                <div>
                  {(
                    [
                      ...(owner ? [["costs", "Costs and expenses"] as const] : []),
                      ["registrations", "Registrations"],
                      ["setup", "School setup"]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={tab === id ? "dm-primary" : "dm-secondary"}
                      aria-current={tab === id ? "page" : undefined}
                      onClick={() => {
                        setTab(id);
                        setMoreViewsOpen(true);
                        if (id === "setup") setSetupArea("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </details>
            </nav>
          )}
          {!student && (
            <DocumentReminders
              snapshot={snapshot}
              loadedAt={data!.cached!.loadedAt}
              onSettings={
                owner
                  ? (area) => {
                      setTab("setup");
                      setSetupArea(area);
                    }
                  : undefined
              }
            />
          )}
          {owner && tab === "costs" && (
            <CostReport
              snapshot={raw!}
              changes={data?.queue ?? []}
              pending={(id) => !!pending(id).length}
              onSave={command}
            />
          )}
          {office && tab === "setup" && !setupArea && (
            <SchoolSetupHome snapshot={snapshot} owner={owner} onOpen={setSetupArea} />
          )}
          {office && tab === "setup" && !setupArea && (
            <SetupGuide
              snapshot={snapshot}
              owner={owner}
              onStep={openSetup}
              onStudent={onAddStudent}
              onVehicle={onVehicles}
            />
          )}
          {(student || (office && tab === "students")) && (
            <section className="dm-panel training-panel">
              <h2>{student ? "My training package" : "Student progress"}</h2>
              {!student && (
                <label>
                  Student
                  <select value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
                    <option value="">All students</option>
                    {snapshot.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!snapshot.summaries.length && <p>No training package assigned yet.</p>}
              {snapshot.summaries
                .filter((s) => !studentFilter || s.studentId === studentFilter)
                .map((s) => (
                  <article className="training-summary" key={s.studentId}>
                    <h3>
                      {s.name} · {s.packageName}
                    </h3>
                    <StudentTrainingReport
                      summary={s}
                      lessons={snapshot.lessons.filter((lesson) =>
                        snapshot.outings.some(
                          (outing) =>
                            outing.id === lesson.outingId &&
                            outing.data.members.some((member) => member.studentId === s.studentId)
                        )
                      )}
                      showMoney={office || student}
                      onPrint={student ? () => window.print() : undefined}
                    />
                    <details>
                      <summary className="min-h-[48px] cursor-pointer py-3">
                        Training days and school target
                      </summary>
                      <EligibilityCard
                        summary={s}
                        owner={owner}
                        enrollment={snapshot.enrollments.find(
                          (e) => e.data.studentId === s.studentId
                        )}
                        studentVersion={
                          snapshot.students.find((p) => p.id === s.studentId)?.version ?? 0
                        }
                        pending={
                          !!pending(
                            snapshot.enrollments.find((e) => e.data.studentId === s.studentId)
                              ?.id ?? ""
                          ).length
                        }
                        onSave={command}
                      />
                    </details>
                    {owner && (
                      <details className="student-cost-details">
                        <summary>View training costs</summary>
                        <dl>
                          <div>
                            <dt>Fuel spent for this student</dt>
                            <dd>{naira(s.fuelCost!)}</dd>
                          </div>
                          <div>
                            <dt>Instructor’s pay counted for this student</dt>
                            <dd>{naira(s.instructorCost!)}</dd>
                          </div>
                          <div>
                            <dt>Recorded costs so far</dt>
                            <dd>{naira(s.costSoFar!)}</dd>
                          </div>
                          <div>
                            <dt>Estimated cost of remaining lessons</dt>
                            <dd>
                              {s.estimatedRemainingCost
                                ? naira(s.estimatedRemainingCost)
                                : "Add this month’s instructor pay in School setup"}
                            </dd>
                          </div>
                          <div>
                            <dt>Estimated money left after training</dt>
                            <dd>
                              {s.expectedMargin
                                ? naira(s.expectedMargin)
                                : "Not enough cost information"}
                            </dd>
                          </div>
                        </dl>
                        <p>
                          Includes other expenses assigned to this student under Costs and expenses.
                          Unallocated school expenses are excluded. This estimate is not final
                          business profit.
                        </p>
                      </details>
                    )}
                  </article>
                ))}
              {owner && (
                <details className="training-help">
                  <summary>How are training costs worked out?</summary>
                  <p>
                    Fuel spending and the instructor’s share of monthly pay are added when a trip
                    finishes. Fuel issued for unfinished trips stays in the remaining-cost estimate.
                    Other expenses count when assigned to this student. Remaining lessons use
                    today’s fuel allowance and this month’s instructor pay, with 30 minutes per
                    lesson. A disputed lesson keeps its spending record. Unallocated school expenses
                    are excluded.
                  </p>
                </details>
              )}
            </section>
          )}
          {student && (
            <section className="dm-panel training-panel">
              <h2>My lesson history</h2>
              {!snapshot.lessons.length && (
                <p>No lessons booked yet. Contact your school office.</p>
              )}
              {snapshot.lessons
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((lesson) => (
                  <article className="training-outing" key={lesson.outingId}>
                    <h3>{dateText(lesson.date)}</h3>
                    <p>
                      {lesson.instructor} · {lesson.vehicle} · {lesson.minutes} driving minutes
                      recorded
                    </p>
                    <strong>{statuses[lesson.status]}</strong>
                    <p>{lesson.topics}</p>
                    <p>{lesson.note}</p>
                    {lesson.response && <p>Your response: {lesson.response}</p>}
                    {lesson.reviewReason && <p>Owner's decision: {lesson.reviewReason}</p>}
                    {lesson.status === "PENDING" && (
                      <StudentConfirmation
                        minutes={lesson.minutes}
                        disabled={!!pending(lesson.outingId).length}
                        onSave={(payload) =>
                          command("RESPOND", lesson.outingId, payload, lesson.version)
                        }
                      />
                    )}
                  </article>
                ))}
            </section>
          )}
          {(office && tab === "outings") || user.role === "INSTRUCTOR" ? (
            <>
              {office && (
                <details id="book-outing" tabIndex={-1} className="dm-panel training-panel">
                  <summary className="book-training-action">Book training</summary>
                  <p>
                    One instructor, one vehicle, up to three students. Each student gets 30 minutes.
                    The booking reserves one lesson for each student.
                  </p>
                  <BookTrainingForm
                    snapshot={snapshot}
                    initialStudentId={initialBook ? initialStudentId : ""}
                    onResolveMissing={resolveBookingRequirement}
                    onSave={async (payload) => {
                      await command("BOOK", crypto.randomUUID(), payload);
                      setOutingFilter("all");
                      const panel = document.getElementById("book-outing");
                      if (panel instanceof HTMLDetailsElement) panel.open = false;
                    }}
                  />
                </details>
              )}
              {outingFilter !== "active" &&
                snapshot.outings.some(
                  (o) =>
                    o.data.status === "STARTED" &&
                    !matchesTrainingView(o.data, outingFilter, scheduleNow)
                ) && (
                  <div className="dm-notice">
                    <span>Training from another date is still in progress.</span>
                    <button className="dm-secondary" onClick={() => setOutingFilter("active")}>
                      View training in progress
                    </button>
                  </div>
                )}
              <details
                className="training-schedule-filters"
                open={outingFilter !== "today" || undefined}
              >
                <summary>More training views</summary>
                <label className="outing-filter">
                  Show training
                  <select
                    value={outingFilter}
                    onChange={(e) => setOutingFilter(e.target.value as TrainingView)}
                  >
                    <option value="all">All dates</option>
                    <option value="active">Training in progress</option>
                    <option value="today">Today</option>
                    <option value="waiting">Awaiting student confirmation</option>
                    <option value="problems">Reported with a problem</option>
                  </select>
                </label>
              </details>
              {!scheduleGroups.length && (
                <div className="dashboard-empty">
                  <h2>
                    {outingFilter === "today"
                      ? "No training booked today"
                      : "No training trips in this view"}
                  </h2>
                  <p>
                    {outingFilter === "today"
                      ? office
                        ? "Book a lesson when a student is ready to train."
                        : "There are no lessons scheduled for today."
                      : "Choose All dates to see other bookings."}
                  </p>
                  {office && outingFilter === "today" && (
                    <button className="dm-primary" onClick={() => openSetup("book-outing")}>
                      Book training
                    </button>
                  )}
                </div>
              )}
              {scheduleGroups.map((group) => (
                <section
                  key={group.id}
                  aria-labelledby={`schedule-${group.id}`}
                  className="training-schedule-group"
                >
                  <h2 id={`schedule-${group.id}`}>{group.title}</h2>
                  {group.rows.map((record) => (
                    <TrainingTripCard
                      key={record.id}
                      record={record}
                      snapshot={snapshot}
                      owner={owner}
                      office={office}
                      changes={pending(record.id)}
                      payChanges={(data?.queue ?? []).filter((q) => q.action === "SALARY")}
                      onSave={(action, payload) =>
                        command(action, record.id, payload, record.version)
                      }
                      onSetup={() => openSetup("setup-pay")}
                    />
                  ))}
                </section>
              ))}
            </>
          ) : null}
          {office && tab === "setup" && (
            <section className="training-setup">
              {setupArea && (
                <div className="school-setup-area-heading">
                  <button className="dm-secondary" type="button" onClick={() => setSetupArea("")}>
                    Back to School setup
                  </button>
                  <h2>
                    {setupArea === "costs"
                      ? "Costs & rules"
                      : setupArea[0]!.toUpperCase() + setupArea.slice(1)}
                  </h2>
                </div>
              )}
              {setupArea === "people" && !!snapshot.instructorDocumentWarnings?.length && (
                <div className="dm-notice">
                  <strong>Instructor documents to check</strong>
                  <ul>
                    {snapshot.instructorDocumentWarnings.map((warning, index) => (
                      <li key={`${warning.instructorId}-${index}`}>
                        {snapshot.instructors.find((i) => i.id === warning.instructorId)?.name ??
                          "Instructor"}
                        : {warning.message}{" "}
                        {warning.blocked
                          ? "Training is blocked by your school rules."
                          : "Your school rules allow training."}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {owner && setupArea === "profile" && <ProfileSettings onSaved={() => refresh()} />}
              {setupArea === "vehicles" && (
                <section className="dm-panel training-panel">
                  <h3>Training vehicles</h3>
                  <p>
                    {snapshot.vehicles.length
                      ? `${snapshot.vehicles.length} vehicle(s) added.`
                      : "No training vehicles yet. Add a vehicle before booking training."}
                  </p>
                  {onVehicles && (
                    <button className="dm-primary" type="button" onClick={onVehicles}>
                      Manage vehicles
                    </button>
                  )}
                </section>
              )}
              {owner && setupArea === "vehicles" && (
                <VehicleDocumentsSettings
                  snapshot={snapshot}
                  pending={(id) => !!pending(id).length}
                  onSave={command}
                />
              )}
              {owner && setupArea === "registration" && (
                <EnrollmentSettings
                  snapshot={snapshot}
                  pending={(id) => !!pending(id).length}
                  onSave={command}
                />
              )}
              {owner && setupArea === "costs" && (
                <SchoolRulesSettings
                  snapshot={snapshot}
                  pending={(id) => !!pending(id).length}
                  onSave={command}
                />
              )}
              {owner && setupArea === "training" && (
                <CurriculumSettings
                  key={`${snapshot.curriculum?.id ?? "starter"}-${snapshot.curriculum?.version ?? 0}`}
                  snapshot={snapshot}
                  pending={(id) => !!pending(id).length}
                  onSave={command}
                />
              )}
              <details
                id="setup-packages"
                tabIndex={-1}
                className="dm-panel training-panel training-setting"
                hidden={setupArea !== "training"}
              >
                <summary>Training packages</summary>
                <p>Each lesson gives a student 30 minutes of driving.</p>
                {snapshot.packages.length ? (
                  <div className="setup-package-cards">
                    {snapshot.packages.map((p) => (
                      <article key={p.id}>
                        <h3>{p.data.name}</h3>
                        <p>{p.data.sessions} lessons</p>
                        <strong>{naira(p.data.price)}</strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty">
                    <h3>No training packages yet</h3>
                    <p>Add the packages your school offers.</p>
                  </div>
                )}
                {owner && (
                  <EntryForm
                    title="Create package"
                    onSave={async (f) =>
                      command("PACKAGE", crypto.randomUUID(), {
                        name: value(f, "name"),
                        sessions: Number(f.get("sessions")),
                        minutes: 30,
                        price: value(f, "price")
                      })
                    }
                  >
                    <Field label="Package name" name="name" />
                    <Field
                      label="Number of lessons"
                      name="sessions"
                      type="number"
                      min="1"
                      max="200"
                      step="1"
                    />
                    <Field label="Package fee (₦)" name="price" type="number" min="0" step="0.01" />
                  </EntryForm>
                )}
              </details>
              <details
                id="setup-enrollment"
                tabIndex={-1}
                className="dm-panel training-panel training-setting"
                hidden={setupArea !== "training"}
              >
                <summary>Choose a student’s training package</summary>
                <p>
                  This sets the student's agreed tuition fee to the package price. Existing payments
                  stay unchanged. Later package changes do not change this agreement.
                </p>
                <EntryForm
                  title="Save student’s package"
                  onSave={async (f) =>
                    command("ENROLL", crypto.randomUUID(), {
                      studentId: value(f, "studentId"),
                      rulesVersion: snapshot.schoolRules?.version ?? -1,
                      packageId: value(f, "packageId"),
                      packageVersion: snapshot.packages.find((p) => p.id === value(f, "packageId"))
                        ?.version,
                      studentVersion:
                        snapshot.students.find((s) => s.id === value(f, "studentId"))?.version ?? 0
                    })
                  }
                >
                  <label>
                    Student
                    <select name="studentId" required>
                      <option value="">Choose student</option>
                      {snapshot.students
                        .filter((s) => !snapshot.enrollments.some((e) => e.data.studentId === s.id))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · current fee {naira(s.totalTuition)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Package
                    <select name="packageId" required>
                      <option value="">Choose package</option>
                      {snapshot.packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.data.name} · {naira(p.data.price)}
                        </option>
                      ))}
                    </select>
                  </label>
                </EntryForm>
              </details>
              {owner && (
                <>
                  <details
                    className="dm-panel training-panel training-setting"
                    hidden={setupArea !== "costs"}
                  >
                    <summary>Fuel money for each attending student</summary>
                    <p>
                      Current default: {naira(snapshot.settings?.data.fuelPerStudent ?? "1500.00")}{" "}
                      for each attending student. DriveMaster uses this to calculate fuel money when
                      training starts. A change applies to new bookings. Existing training trips
                      keep their saved fuel amount.
                    </p>
                    <EntryForm
                      title="Save fuel money per student"
                      disabled={
                        !!pending(snapshot.settings?.id ?? `training-settings-${user.schoolId}`)
                          .length
                      }
                      onSave={async (f) =>
                        command(
                          "SETTINGS",
                          snapshot.settings?.id ?? `training-settings-${user.schoolId}`,
                          {
                            fuelPerStudent: value(f, "fuelPerStudent"),
                            reason: value(f, "reason")
                          },
                          snapshot.settings?.version
                        )
                      }
                    >
                      <Field
                        label="Fuel money for each attending student (₦)"
                        name="fuelPerStudent"
                        type="number"
                        min="0.01"
                        step="0.01"
                        initial={snapshot.settings?.data.fuelPerStudent ?? "1500.00"}
                      />
                      <Field label="Reason for this amount" name="reason" />
                    </EntryForm>
                  </details>
                  <details
                    id="setup-pay"
                    tabIndex={-1}
                    className="dm-panel training-panel training-setting"
                    hidden={setupArea !== "people" || !snapshot.instructors.length}
                  >
                    <summary>Monthly instructor pay</summary>
                    <p>
                      Enter the instructor’s monthly pay and the hours they will spend teaching. We
                      use these to estimate each student’s training cost. This is not an extra wage
                      payment. Training trips already started keep their saved rate. Enter pay for
                      each month before training starts.
                    </p>
                    <ul>
                      {snapshot.salaries.map((s) => (
                        <li key={s.id}>
                          {snapshot.instructors.find((i) => i.id === s.data.instructorId)?.name} ·{" "}
                          {s.data.month} · {naira(s.data.salary)} / {s.data.teachingHours} planned
                          hours
                        </li>
                      ))}
                      {(data?.queue ?? [])
                        .filter((q) => q.action === "SALARY")
                        .map((q) => {
                          const pay = q.data as {
                            instructorId: string;
                            month: string;
                            salary: string;
                            teachingHours: number;
                          };
                          return (
                            <li key={q.id}>
                              {snapshot.instructors.find((i) => i.id === pay.instructorId)?.name ??
                                "Instructor"}{" "}
                              · {pay.month} · {naira(pay.salary)} / {pay.teachingHours} planned
                              hours —{" "}
                              <strong>
                                {q.status === "FAILED"
                                  ? "saved change needs attention"
                                  : "saved on this device, waiting to be sent"}
                              </strong>
                            </li>
                          );
                        })}
                    </ul>
                    <EntryForm
                      title="Save monthly pay"
                      onSave={async (f) => {
                        const instructorId = value(f, "instructorId"),
                          month = value(f, "month"),
                          old = snapshot.salaries.find(
                            (s) => s.data.instructorId === instructorId && s.data.month === month
                          );
                        await command(
                          "SALARY",
                          old?.id ?? crypto.randomUUID(),
                          {
                            instructorId,
                            month,
                            salary: value(f, "salary"),
                            teachingHours: Number(f.get("teachingHours"))
                          },
                          old?.version
                        );
                      }}
                    >
                      <label>
                        Instructor
                        <select name="instructorId" required>
                          <option value="">Choose instructor</option>
                          {snapshot.instructors.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label="Month"
                        name="month"
                        type="month"
                        initial={nowLocal().slice(0, 7)}
                      />
                      <Field
                        label="Monthly salary (₦)"
                        name="salary"
                        type="number"
                        min="0"
                        step="0.01"
                      />
                      <Field
                        label="Planned teaching hours this month"
                        name="teachingHours"
                        type="number"
                        min="1"
                        max="744"
                        step="1"
                      />
                      <p>
                        For example, 4 hours of teaching each day for 20 days means 80 hours this
                        month. Count teaching hours, not all hours spent at the school.
                      </p>
                    </EntryForm>
                  </details>
                  {!snapshot.instructors.length && (
                    <section
                      className="dm-panel training-panel training-setting"
                      aria-labelledby="setup-pay-locked-title"
                      hidden={setupArea !== "people"}
                    >
                      <h3 id="setup-pay-locked-title">Monthly instructor pay</h3>
                      <p>Add your first instructor to unlock monthly pay setup.</p>
                    </section>
                  )}
                  <details
                    id="setup-accounts"
                    tabIndex={-1}
                    className="dm-panel training-panel training-setting"
                    hidden={setupArea !== "people"}
                  >
                    <summary>Create instructor, receptionist or student access</summary>
                    <p>
                      Internet is required. Give the password privately to the account holder.
                      Students can only see their own lessons and fees; instructors cannot confirm
                      on a student's behalf.
                    </p>
                    <EntryForm
                      title="Create login account"
                      onSave={async (f) => {
                        const role = value(f, "role");
                        await trainingRequest(
                          "accounts",
                          role === "STUDENT"
                            ? {
                                role,
                                studentId: value(f, "studentId"),
                                password: value(f, "password")
                              }
                            : {
                                role,
                                name: value(f, "name"),
                                phone: value(f, "phone"),
                                password: value(f, "password"),
                                ...(role === "INSTRUCTOR"
                                  ? { permitExpiryDate: value(f, "permitExpiryDate") }
                                  : {})
                              }
                        );
                        setMessage(
                          "Account created. The account holder can sign in with their phone number and password."
                        );
                        await refresh();
                      }}
                    >
                      <label>
                        Account type
                        <select
                          name="role"
                          value={accountRole}
                          onChange={(e) => setAccountRole(e.target.value)}
                        >
                          <option value="STUDENT">Student</option>
                          <option value="INSTRUCTOR">Instructor</option>
                          <option value="RECEPTIONIST">Receptionist</option>
                        </select>
                      </label>
                      {accountRole === "STUDENT" && (
                        <label>
                          Student record (for student accounts)
                          <select name="studentId" required>
                            <option value="">Choose student</option>
                            {snapshot.students
                              .filter((s) => !s.hasAccount)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                  {s.phone ? ` · ${s.phone}` : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      {accountRole === "STUDENT" && snapshot.students.length === 0 && (
                        <p>Register a student before creating student access.</p>
                      )}
                      {accountRole === "STUDENT" &&
                        snapshot.students.length > 0 &&
                        snapshot.students.every((student) => student.hasAccount) && (
                          <p>Every registered student already has an account.</p>
                        )}
                      {accountRole !== "STUDENT" && (
                        <>
                          <Field label="Name" name="name" />
                          <Field label="Phone number" name="phone" type="tel" />
                        </>
                      )}
                      {accountRole === "INSTRUCTOR" && (
                        <>
                          <Field
                            label="Instructor permit expiry date (optional)"
                            name="permitExpiryDate"
                            type="date"
                            required={false}
                          />
                          <p>
                            Add the date now if available. You can update it later in instructor
                            details.
                          </p>
                        </>
                      )}
                      <label>
                        Starting password (at least 10 characters)
                        <input
                          name="password"
                          type="password"
                          minLength={10}
                          maxLength={128}
                          required
                          autoComplete="new-password"
                        />
                      </label>
                    </EntryForm>
                  </details>
                  {setupArea === "people" &&
                    (snapshot.instructors.length ? (
                      <StaffAccounts onChanged={() => refresh()} />
                    ) : (
                      <section
                        className="dm-panel training-panel training-setting"
                        aria-labelledby="setup-staff-locked-title"
                      >
                        <h3 id="setup-staff-locked-title">Manage staff access</h3>
                        <p>Add your first instructor to unlock staff access management.</p>
                      </section>
                    ))}
                </>
              )}
            </section>
          )}
          {office && tab === "registrations" && (
            <EnrollmentReview owner={owner} onSaved={() => refresh()} />
          )}
        </>
      )}
      {(student || user.role === "INSTRUCTOR") && (
        <details className="dm-panel training-panel">
          <summary>Change my password</summary>
          <EntryForm
            title="Change password"
            onSave={async (f) => {
              await trainingRequest("password", {
                currentPassword: value(f, "currentPassword"),
                password: value(f, "password")
              });
              window.dispatchEvent(new Event("drivemaster:session-ended"));
            }}
          >
            <Field label="Current password" name="currentPassword" type="password" />
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
          </EntryForm>
        </details>
      )}
    </div>
  );
}
