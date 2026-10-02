import { useState, type FormEvent } from "react";

export function StudentConfirmation({
  minutes,
  disabled,
  onSave
}: {
  minutes: number;
  disabled: boolean;
  onSave: (payload: { attended: boolean; reason: string }) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled || !answer) return;
    if (answer === "no" && !reason.trim()) {
      setError("Tell the school what went wrong.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({ attended: answer === "yes", reason: answer === "no" ? reason.trim() : "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="training-form" onSubmit={(e) => void submit(e)}>
      <fieldset>
        <legend>Did you attend this lesson?</legend>
        <p>Your instructor recorded {minutes} driving minutes.</p>
        <label className="training-check">
          <input
            type="radio"
            name="attendance"
            value="yes"
            checked={answer === "yes"}
            disabled={minutes < 30 || disabled}
            onChange={() => setAnswer("yes")}
          />
          Yes, I attended
        </label>
        <label className="training-check">
          <input
            type="radio"
            name="attendance"
            value="no"
            checked={answer === "no"}
            disabled={disabled}
            onChange={() => setAnswer("no")}
          />
          Report a problem
        </label>
        {answer === "yes" && <p>You are confirming that you drove for at least 30 minutes.</p>}
        {minutes < 30 && (
          <p>
            A full lesson needs 30 minutes. Report a problem so the school can review this shorter
            lesson.
          </p>
        )}
        {answer === "no" && (
          <label>
            What went wrong?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={500}
              placeholder="For example: the lesson did not take place, or I drove for less time."
            />
          </label>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="fleet-error">
          {error}
        </p>
      )}
      <button className="dm-primary" disabled={disabled || busy || !answer}>
        {busy ? "Saving…" : "Send my response"}
      </button>
    </form>
  );
}
