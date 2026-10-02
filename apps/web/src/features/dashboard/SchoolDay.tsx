import { useLiveQuery } from "dexie-react-hooks";
import { schoolDocumentReminders, type AuthenticatedUser } from "@drivemaster/shared";
import { ArrowRight, CircleAlert, Clock3, Wallet } from "lucide-react";
import { db } from "../../db/db";
import { DocumentReminders } from "../training/DocumentReminders";
import { matchesTrainingView, type TrainingView } from "../training/trainingViews";

export type TrainingDestination = {
  tab?: "outings" | "setup" | "students" | "costs";
  filter?: TrainingView;
};
export interface DashboardAttention {
  recordsNeedAttention: number;
  recordsWaiting: number;
  studentsOwing: number;
}

export function SchoolDay({
  user,
  attention,
  onTraining,
  onSavedRecords,
  onStudents
}: {
  user: AuthenticatedUser;
  attention: DashboardAttention;
  onTraining: (destination: TrainingDestination) => void;
  onSavedRecords: () => void;
  onStudents: () => void;
}) {
  const cache = useLiveQuery(() => db.trainingCache.get(user.id), [user.id]);
  const snapshot =
    cache?.schoolId === user.schoolId &&
    cache.snapshot.viewerRole === user.role &&
    cache.snapshot.userId === user.id
      ? cache.snapshot
      : undefined;

  if (!snapshot)
    return (
      <>
        <section className="dm-panel school-day">
          <h2>Today&rsquo;s training</h2>
          <p>Open Training to load today&rsquo;s lessons on this device.</p>
          <button
            className="dm-primary"
            onClick={() => onTraining({ tab: "outings", filter: "today" })}
          >
            Open Training
          </button>
        </section>
        <Attention attention={attention} onSavedRecords={onSavedRecords} onStudents={onStudents} />
      </>
    );

  const today = snapshot.outings.filter((outing) => matchesTrainingView(outing.data, "today"));
  const counts = {
    coming: today.filter((outing) => outing.data.status === "BOOKED").length,
    active: today.filter((outing) => outing.data.status === "STARTED").length,
    completed: today.filter((outing) => outing.data.status === "COMPLETED").length
  };
  const confirmations = snapshot.outings
    .flatMap((outing) => outing.data.members)
    .filter((member) => member.status === "PENDING").length;
  const disputes = snapshot.outings
    .flatMap((outing) => outing.data.members)
    .filter((member) => member.status === "DISPUTED").length;
  const reminders = schoolDocumentReminders(snapshot, new Date());

  return (
    <>
      <section className="dm-panel school-day" aria-labelledby="school-day-title">
        <div className="panel-heading">
          <div>
            <p className="dm-eyebrow">TODAY</p>
            <h2 id="school-day-title">Today&rsquo;s training</h2>
          </div>
          <button
            className="dm-primary"
            onClick={() => onTraining({ tab: "outings", filter: "today" })}
          >
            Open Training <ArrowRight size={16} />
          </button>
        </div>
        <div className="today-training-grid">
          <button onClick={() => onTraining({ tab: "outings", filter: "today" })}>
            <strong>{counts.coming}</strong>
            <span>Coming up</span>
          </button>
          <button onClick={() => onTraining({ tab: "outings", filter: "today" })}>
            <strong>{counts.active}</strong>
            <span>Training now</span>
          </button>
          <button onClick={() => onTraining({ tab: "outings", filter: "today" })}>
            <strong>{counts.completed}</strong>
            <span>Completed</span>
          </button>
        </div>
        <p className="dashboard-data-time">
          Based on training records loaded{" "}
          {new Date(cache!.loadedAt).toLocaleString("en-NG", {
            timeZone: "Africa/Lagos",
            dateStyle: "medium",
            timeStyle: "short"
          })}
          .
        </p>
      </section>
      <Attention
        attention={attention}
        confirmations={confirmations}
        disputes={disputes}
        onSavedRecords={onSavedRecords}
        onStudents={onStudents}
        onTraining={onTraining}
      >
        {!!reminders.length && (
          <DocumentReminders
            snapshot={snapshot}
          loadedAt={cache!.loadedAt}
            onSettings={user.role === "OWNER" ? () => onTraining({ tab: "setup" }) : undefined}
          />
        )}
      </Attention>
    </>
  );
}

function Attention({
  attention,
  confirmations = 0,
  disputes = 0,
  onSavedRecords,
  onStudents,
  onTraining,
  children
}: {
  attention: DashboardAttention;
  confirmations?: number;
  disputes?: number;
  onSavedRecords: () => void;
  onStudents: () => void;
  onTraining?: (destination: TrainingDestination) => void;
  children?: React.ReactNode;
}) {
  const issueCount =
    attention.recordsNeedAttention +
    (attention.studentsOwing ? 1 : 0) +
    (confirmations ? 1 : 0) +
    (disputes ? 1 : 0) +
    (children ? 1 : 0);
  return (
    <section className="attention-panel dashboard-attention" aria-labelledby="attention-title">
      <div className="panel-heading">
        <div>
          <p className="dm-eyebrow">CHECK THESE NEXT</p>
          <h2 id="attention-title">What needs your attention?</h2>
        </div>
        <CircleAlert size={22} />
      </div>
      {!issueCount && <p className="attention-clear">Nothing needs your attention right now.</p>}
      {!!attention.recordsNeedAttention && (
        <button className="attention-item" onClick={onSavedRecords}>
          <span className="attention-icon">
            <CircleAlert size={18} />
          </span>
          <span>
            <strong>
              {attention.recordsNeedAttention} record
              {attention.recordsNeedAttention === 1 ? " needs" : "s need"} attention
            </strong>
            <small>Open the record to see what to do</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {!!disputes && onTraining && (
        <button
          className="attention-item"
          onClick={() => onTraining({ tab: "outings", filter: "problems" })}
        >
          <span className="attention-icon">
            <CircleAlert size={18} />
          </span>
          <span>
            <strong>
              {disputes} lesson{disputes === 1 ? " was" : "s were"} reported with a problem
            </strong>
            <small>Review the student response</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {!!confirmations && onTraining && (
        <button
          className="attention-item"
          onClick={() => onTraining({ tab: "outings", filter: "waiting" })}
        >
          <span className="attention-icon">
            <Clock3 size={18} />
          </span>
          <span>
            <strong>
              {confirmations} lesson{confirmations === 1 ? " is" : "s are"} waiting for student
              confirmation
            </strong>
            <small>See who has not replied</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {!!attention.studentsOwing && (
        <button className="attention-item" onClick={onStudents}>
          <span className="attention-icon">
            <Wallet size={18} />
          </span>
          <span>
            <strong>
              {attention.studentsOwing} student
              {attention.studentsOwing === 1 ? " still owes" : "s still owe"} fees
            </strong>
            <small>Open Students to follow up</small>
          </span>
          <ArrowRight size={17} />
        </button>
      )}
      {children}
    </section>
  );
}
