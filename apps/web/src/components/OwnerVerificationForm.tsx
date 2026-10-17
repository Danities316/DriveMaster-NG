import { useEffect, useState, type FormEvent } from "react";
import type { AuthenticatedUser, OwnerVerificationStatus } from "@drivemaster/shared";
import {
  AuthError,
  confirmVerification,
  fetchVerificationStatus,
  resendVerification
} from "../lib/auth";

export function OwnerVerificationForm({
  initialStatus,
  onSuccess,
  onSignOut
}: {
  initialStatus: OwnerVerificationStatus;
  onSuccess: (user: AuthenticatedUser) => void;
  onSignOut: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let cancelled = false;
    void fetchVerificationStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Connect to the internet to continue. If your verification session expired, sign in again."
          );
      });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const wait = status.resendAt
    ? Math.max(0, Math.ceil((Date.parse(status.resendAt) - now) / 1000))
    : 0;
  const expired = status.expiresAt !== null && Date.parse(status.expiresAt) <= now;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : "Could not reach the server. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      onSuccess(await confirmVerification(code));
    });
  }
  function send() {
    void run(async () => {
      const next = await resendVerification(changing ? phone : undefined);
      setStatus(next);
      setCode("");
      setChanging(false);
    });
  }
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Verify your phone number</h1>
      <p>Your school details are saved. Verify your number to open your workspace.</p>
      <p role="status">
        {expired && status.delivery === "sent"
          ? "Your code expired. Send another code to continue."
          : status.delivery === "sent"
            ? `A six-digit code was sent to ${status.maskedPhone}. It expires in 10 minutes.`
            : status.delivery === "failed"
              ? `We could not send the code to ${status.maskedPhone}. Your account is saved. Try sending again.`
              : `Send a code to ${status.maskedPhone} to continue.`}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="verification-code">Six-digit code</label>
        <input
          id="verification-code"
          className="min-h-[48px] rounded-lg border px-4"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
        <button
          className="min-h-[48px] rounded-lg bg-brand px-4 text-brand-ink"
          disabled={busy || status.delivery !== "sent" || expired}
        >
          {busy ? "Please wait…" : "Verify and continue"}
        </button>
      </form>
      {changing && (
        <label className="flex flex-col gap-2">
          Correct phone number
          <input
            className="min-h-[48px] rounded-lg border px-4"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
      )}
      <button
        className="dm-secondary min-h-[48px]"
        disabled={busy || wait > 0 || (changing && !phone.trim())}
        onClick={send}
      >
        {wait > 0
          ? `Send again in ${wait}s`
          : changing
            ? "Send to this number"
            : "Send another code"}
      </button>
      <button className="min-h-[48px]" disabled={busy} onClick={() => setChanging(!changing)}>
        {changing ? "Keep current number" : "Change number"}
      </button>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}
        </p>
      )}
      <button className="min-h-[48px]" disabled={busy} onClick={onSignOut}>
        Back to sign in
      </button>
    </div>
  );
}
