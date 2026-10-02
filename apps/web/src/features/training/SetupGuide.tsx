import type { TrainingSnapshot } from "@drivemaster/shared";
import { trainingSetupReadiness } from "./setupReadiness";

export function SetupGuide({
  snapshot,
  owner,
  onStep,
  onStudent,
  onVehicle
}: {
  snapshot: TrainingSnapshot;
  owner: boolean;
  onStep: (target: string) => void;
  onStudent?: () => void;
  onVehicle?: () => void;
}) {
  const ready = trainingSetupReadiness(snapshot);
  const steps = [
    {
      title: "Add your training packages",
      detail: "Enter the fee and number of lessons you sell.",
      done: ready.packages,
      action: () => onStep("setup-packages"),
      allowed: owner
    },
    {
      title: "Add your instructors",
      detail: "Create a login so each instructor can record their own lessons.",
      done: ready.instructors,
      action: () => onStep("setup-accounts"),
      allowed: owner
    },
    {
      title: "Add a training vehicle",
      detail: "Use the vehicle’s number plate so everyone picks the right car.",
      done: ready.vehicles,
      action: onVehicle,
      allowed: !!onVehicle
    },
    {
      title: "Enter monthly instructor pay",
      detail:
        "This lets us estimate each student’s training cost. Add pay and planned teaching hours for this month.",
      done: ready.instructorPay,
      action: () => onStep("setup-pay"),
      allowed: owner
    },
    {
      title: "Add your first student",
      detail: "Enter their name, phone number and agreed fee.",
      done: ready.students,
      action: onStudent,
      allowed: !!onStudent
    },
    {
      title: "Choose the student’s package",
      detail: "Check the fee before assigning it. Existing payments are kept.",
      done: ready.enrollments,
      action: () => onStep("setup-enrollment"),
      allowed: true
    },
    {
      title: "Book the first lesson",
      detail: "Choose the students, instructor, vehicle and time.",
      done: ready.firstBooking,
      action: () => onStep("book-outing"),
      allowed: true
    }
  ];
  const actionable = steps.filter((s) => owner || s.title !== "Enter monthly instructor pay");
  return (
    <section className="dm-panel training-panel setup-guide" aria-labelledby="setup-guide-title">
      <h2 id="setup-guide-title">Get ready for your first training</h2>
      <p>
        These are the records DriveMaster needs before your school can book and complete training.
        Progress updates after records are sent.
      </p>
      {!owner && <p>The school owner sets up packages, instructor accounts and monthly pay.</p>}
      <h3>Required to operate</h3>
      <ol>
        {actionable.map((s) => (
          <li key={s.title}>
            <div>
              <strong>
                {s.done ? "✓ " : ""}
                {s.title}
              </strong>
              <p>{s.detail}</p>
            </div>
            {s.action && s.allowed ? (
              <button className="dm-secondary" onClick={s.action}>
                {s.done ? "Review" : "Set up"}
                <span className="sr-only"> {s.title}</span>
              </button>
            ) : (
              <span>{s.done ? "Ready" : "Ask the school owner"}</span>
            )}
          </li>
        ))}
      </ol>
      <h3>Useful configuration</h3>
      <p>
        Registration questions, document reminders and other school rules help you manage the
        school. They appear here as blockers only when an existing school rule requires them.
      </p>
    </section>
  );
}
