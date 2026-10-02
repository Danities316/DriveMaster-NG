import type { StudentTrainingSummary } from "@drivemaster/shared";

/** Presentation only: all counts come from the existing training summary. */
export function StudentProgressSummary({ summary: s }: { summary: StudentTrainingSummary }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg font-semibold">
        {s.confirmed} of {s.sessions} lessons completed
      </p>
      {s.activationStatus === "PENDING_PAYMENT" && (
        <p className="text-amber-800">
          Waiting for payment or office activation. Training cannot be booked yet.
        </p>
      )}
      {s.booked > 0 && <p>{s.booked} booked or training now</p>}
      {s.disputed > 0 && (
        <p className="text-amber-800">
          {s.disputed} {s.disputed === 1 ? "lesson needs" : "lessons need"} checking
        </p>
      )}
      {s.awaiting > 0 && (
        <p>
          {s.awaiting} {s.awaiting === 1 ? "lesson is" : "lessons are"} waiting for student
          confirmation
        </p>
      )}
      <details>
        <summary className="min-h-[48px] cursor-pointer py-3">View lesson details</summary>
        <dl className="flex flex-col gap-2">
          <div>
            <dt>Confirmed lessons</dt>
            <dd>{s.confirmed}</dd>
          </div>
          <div>
            <dt>Awaiting confirmation</dt>
            <dd>{s.awaiting}</dd>
          </div>
          <div>
            <dt>Disputed lessons</dt>
            <dd>{s.disputed}</dd>
          </div>
          <div>
            <dt>Remaining lesson entitlement</dt>
            <dd>{s.remaining}</dd>
          </div>
          <div>
            <dt>Booked or started</dt>
            <dd>{s.booked}</dd>
          </div>
        </dl>
        <p>
          Completed means confirmed. Lessons awaiting confirmation or under review still count
          against the package until resolved. Remaining entitlement is not a count of completed
          lessons. A full lesson requires at least 30 minutes of driving.
        </p>
      </details>
    </div>
  );
}
