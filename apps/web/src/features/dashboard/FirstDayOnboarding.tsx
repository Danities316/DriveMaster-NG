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
    if (studentCount || paymentCount) return null;
    return (
      <section className="dm-panel first-day first-day-compact" aria-labelledby="first-day-title">
        <div>
          <p className="dm-eyebrow">FIRST DAY</p>
          <h2 id="first-day-title">Get DriveMaster ready</h2>
          <p>Complete the basics before your first training.</p>
        </div>
        <button className="dm-primary" onClick={onSetup}>
          Open School setup <ArrowRight size={16} />
        </button>
      </section>
    );
  }

  const ready = trainingSetupReadiness(snapshot);
  if (ready.firstBooking || studentCount > 1 || paymentCount > 0) return null;
  const hasStudent = ready.students || studentCount > 0;
  const steps = [
    {
      label: "Training package",
      done: ready.packages,
      action: onSetup,
      next: "Add training package"
    },
    { label: "Instructor", done: ready.instructors, action: onSetup, next: "Add instructor" },
    { label: "Training vehicle", done: ready.vehicles, action: onSetup, next: "Add vehicle" },
    { label: "First student", done: hasStudent, action: onAddStudent, next: "Add first student" },
    {
      label: "Student package",
      done: ready.enrollments,
      action: onSetup,
      next: "Assign student package"
    },
    {
      label: "Monthly instructor pay",
      done: ready.instructorPay,
      action: onSetup,
      next: "Set instructor pay"
    }
  ];
  const next = steps.find((step) => !step.done);
  return (
    <section className="dm-panel first-day" aria-labelledby="first-day-title">
      <div className="first-day-heading">
        <div>
          <p className="dm-eyebrow">FIRST DAY</p>
          <h2 id="first-day-title">Get DriveMaster ready</h2>
          <p>Complete the basics before your first training.</p>
        </div>
        <button
          className="dm-primary"
          onClick={next ? next.action : () => onTraining({ tab: "outings", filter: "today" })}
        >
          {next?.next ?? "Book first training"} <ArrowRight size={16} />
        </button>
      </div>
      <h3>Required before training</h3>
      <ol className="first-day-steps">
        {steps.map((step) => (
          <li className={step.done ? "is-ready" : ""} key={step.label}>
            <span>{step.done ? <Check size={16} /> : null}</span>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="first-day-optional">
        <span>
          <strong>When useful</strong> — review school details and record a real payment only when a
          student has paid.
        </span>
        <div>
          <button className="text-button" onClick={onSetup}>
            Review school details
          </button>
          {hasStudent && !paymentCount && (
            <button className="text-button" onClick={onRecordPayment}>
              Record payment
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
