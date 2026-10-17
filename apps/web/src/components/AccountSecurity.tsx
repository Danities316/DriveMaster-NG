import { useState, type FormEvent } from "react";
import { AuthError, changePassword, signOutEverywhere } from "../lib/auth";

export function AccountSecurity({ onSignedOut }: { onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onSignedOut();
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirmation")) {
      setError("The two passwords do not match.");
      return;
    }
    void run(() =>
      changePassword(String(data.get("currentPassword")), String(data.get("password")))
    );
  }
  return (
    <div className="dashboard-content">
      <section className="dm-panel flex max-w-lg flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p>
          Changing your password signs out every device. Saved work stays on each device until you
          sign in again and send it.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              className="min-h-[48px] rounded-lg border px-4"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              className="min-h-[48px] rounded-lg border px-4"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            Repeat new password
            <input
              name="confirmation"
              type="password"
              autoComplete="new-password"
              className="min-h-[48px] rounded-lg border px-4"
              required
            />
          </label>
          <button className="dm-primary min-h-[48px]" disabled={busy}>
            Change password and sign out
          </button>
        </form>
        <button
          className="dm-secondary min-h-[48px]"
          disabled={busy}
          onClick={() => void run(signOutEverywhere)}
        >
          Sign out all devices
        </button>
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
