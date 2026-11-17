import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Check } from "lucide-react";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { db } from "../../db/db";
import { trainingSetupReadiness } from "../training/setupReadiness";
import type { TrainingDestination } from "./SchoolDay";

export function FirstDayOnboarding({
  user,
  studentCount,
  paymentCount,
  onSetup,
  onAddStudent,
  onRecordPayment,
  onTraining
}: {
  user: AuthenticatedUser;
  studentCount: number;
  paymentCount: number;
  onSetup: () => void;
  onAddStudent: () => void;
  onRecordPayment: () => void;
  onTraining: (destination: TrainingDestination) => void;
}) {
  const result = useLiveQuery(
    async () => ({ cache: await db.trainingCache.get(user.id) }),
    [user.id]
  );
  if (user.role !== "OWNER") return null;
  if (!result) return null;
  const cache = result.cache;
  const snapshot =
    cache?.schoolId === user.schoolId &&
    cache.snapshot.userId === user.id &&
    cache.snapshot.viewerRole === user.role
      ? cache.snapshot
      : undefined;
  if (!snapshot) {
    return (
      <section className="dm-panel first-day first-day-compact" aria-labelledby="first-day-title">
        <div>
          <p className="dm-eyebrow">FIRST DAY</p>
          <h2 id="first-day-title">Launch your school</h2>
          <p>Set up the essentials for your first lesson.</p>
        </div>
        <div>
          <strong className="readiness-label readiness-needs-setup">Needs setup</strong>
          <button className="dm-primary" onClick={onSetup}>
            Set up my school <ArrowRight size={16} />
          </button>
        </div>
      </section>
    );
  }

  const ready = trainingSetupReadiness(snapshot);
  if (ready.firstBooking) return null;
  const hasStudent = ready.students || studentCount > 0;
  const steps = [
    {
      label: "Add first instructor",
      done: ready.instructors,
      action: onSetup,
      next: "Add instructor"
    },
    { label: "Add first vehicle", done: ready.vehicles, action: onSetup, next: "Add vehicle" },
    {
      label: "Add first student",
      done: hasStudent,
      action: onAddStudent,
      next: "Add first student"
    },
    {
      label: "Assign student package",
      done: ready.enrollments,
      action: onSetup,
      next: "Assign package"
    },
    {
      label: "Book first lesson",
      done: ready.firstBooking,
      action: () => onTraining({ tab: "outings", filter: "today" }),
      next: "Book first lesson"
    }
  ];
  const next = steps.find((step) => !step.done);
  return (
    <section className="dm-panel first-day" aria-labelledby="first-day-title">
      <div className="first-day-heading">
        <div>
          <p className="dm-eyebrow">FIRST DAY</p>
          <h2 id="first-day-title">Launch your school</h2>
          <p>Complete the essentials for your first lesson.</p>
        </div>
        <button
          className="dm-primary"
          onClick={next ? next.action : () => onTraining({ tab: "outings", filter: "today" })}
        >
          {next?.next ?? "Book first lesson"} <ArrowRight size={16} />
        </button>
      </div>
      <h3>What you need before your first lesson</h3>
      <ol className="first-day-steps">
        {steps.map((step) => (
          <li className={step.done ? "is-ready" : ""} key={step.label}>
            <span>{step.done ? <Check size={16} /> : null}</span>
            <span className="first-day-step-label">{step.label}</span>
            <small
              className={`readiness-label ${step.done ? "readiness-ready" : "readiness-needs-setup"}`}
            >
              {step.done ? "Ready" : "Needs setup"}
            </small>
          </li>
        ))}
      </ol>
      <div className="first-day-optional">
        <span>
          <strong className="readiness-label readiness-later">Complete later</strong> — school
          details and other admin can wait until after your first lesson.
        </span>
        <details className="first-day-more-actions">
          <summary>Other actions</summary>
          <div>
            <button className="text-button" onClick={onSetup}>
              Review setup
            </button>
            {hasStudent && !paymentCount && (
              <button className="text-button" onClick={onRecordPayment}>
                Record payment
              </button>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
