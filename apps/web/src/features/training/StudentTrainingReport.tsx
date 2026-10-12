import type { StudentLessonView, StudentTrainingSummary } from "@drivemaster/shared";
import { StudentProgressSummary } from "./StudentProgressSummary";

function dateText(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

const statusText: Record<StudentLessonView["status"], string> = {
  BOOKED: "Booked",
  DRIVING: "Training now",
  MISSED: "Rescheduled",
  PENDING: "Waiting for confirmation",
  CONFIRMED: "Completed",
  DISPUTED: "Needs attention",
  VOID: "Cancelled"
};

export function StudentTrainingReport({
  summary,
  lessons,
  showMoney = false,
  onPrint
}: {
  summary: StudentTrainingSummary;
  lessons: StudentLessonView[];
  showMoney?: boolean;
  onPrint?: () => void;
}) {
  return (
    <section className="student-training-report dm-panel" aria-label="Student training report">
      <div className="student-report-heading">
        <div>
          <p className="eyebrow">Student training report</p>
          <h3>{summary.name}</h3>
          <p>
            {summary.packageName} · {summary.confirmed} completed
          </p>
        </div>
        {onPrint ? (
          <button type="button" className="dm-secondary report-print-button" onClick={onPrint}>
            Print report
          </button>
        ) : null}
      </div>

      <StudentProgressSummary summary={summary} />

      {showMoney ? (
        <dl className="student-report-money">
          <div>
            <dt>Agreed fee</dt>
            <dd>₦{summary.fee}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>₦{summary.paid}</dd>
          </div>
          <div>
            <dt>Still to pay</dt>
            <dd>₦{summary.balance}</dd>
          </div>
        </dl>
      ) : null}

      <details className="student-report-lessons" open={lessons.length > 0}>
        <summary>Lesson history ({lessons.length})</summary>
        {!lessons.length ? (
          <p className="text-slate-600">No lessons recorded yet.</p>
        ) : (
          <ol>
            {lessons.map((lesson, index) => (
              <li key={`${lesson.outingId}-${index}`}>
                <div>
                  <strong>Lesson {index + 1}</strong>
                  <span>
                    {dateText(lesson.date)} · {lesson.minutes} minutes
                  </span>
                </div>
                <div>
                  <span>{statusText[lesson.status]}</span>
                  {lesson.topics ? <small>{lesson.topics}</small> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
