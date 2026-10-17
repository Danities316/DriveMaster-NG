import { useEffect, useState, type FormEvent } from "react";
import { AuthError, requestPasswordReset, resetPassword } from "../lib/auth";

export function PasswordResetForm({ onBack }: { onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function send() {
    setBusy(true);
    setError("");
    try {
      setRequestId(await requestPasswordReset(phone));
      setRemaining(60);
      setCode("");
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!requestId) {
      await send();
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await resetPassword(requestId, code, password);
      setPassword("");
      setConfirmation("");
      setCode("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4">
      <h2 className="text-xl font-semibold">Reset your password</h2>
      {done ? (
        <p role="status">
          Your password was reset. Sign in with your new password. Previous sessions have been
          signed out.
        </p>
      ) : (
        <>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              Account phone number
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                readOnly={!!requestId}
                onChange={(event) => setPhone(event.target.value)}
                className="min-h-[48px] rounded-lg border px-4"
                required
              />
            </label>
            {requestId && (
              <>
                <p role="status">
                  If an eligible account uses this number, a reset code will be sent. Codes expire
                  in 10 minutes. Internet is required.
                </p>
                <label className="flex flex-col gap-1">
                  Reset code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    className="min-h-[48px] rounded-lg border px-4"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1">
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-[48px] rounded-lg border px-4"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Repeat new password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="min-h-[48px] rounded-lg border px-4"
                    required
                  />
                </label>
              </>
            )}
            <button
              className="min-h-[48px] rounded-lg bg-brand px-4 text-brand-ink"
              disabled={busy}
            >
              {busy ? "Please wait…" : requestId ? "Reset password" : "Send reset code"}
            </button>
          </form>
          {requestId && (
            <>
              <button
                className="dm-secondary min-h-[48px]"
                disabled={busy || remaining > 0}
                onClick={() => void send()}
              >
                {remaining > 0 ? `Send again in ${remaining}s` : "Send another reset code"}
              </button>
              <button
                className="min-h-[48px]"
                disabled={busy}
                onClick={() => {
                  setRequestId(null);
                  setCode("");
                  setPassword("");
                  setConfirmation("");
                }}
              >
                Use another number
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="text-rose-700">
              {error}
            </p>
          )}
        </>
      )}
      <button className="min-h-[48px]" disabled={busy} onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}
