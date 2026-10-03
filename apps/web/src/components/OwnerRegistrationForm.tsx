import { useState, type FormEvent } from "react";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { AuthError, registerOwner } from "../lib/auth";

export function OwnerRegistrationForm({
  onSuccess
}: {
  onSuccess: (user: AuthenticatedUser) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirmPassword")) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      onSuccess(
        await registerOwner({
          ownerName: String(form.get("ownerName") ?? ""),
          phone: String(form.get("phone") ?? ""),
          password: String(form.get("password") ?? ""),
          schoolName: String(form.get("schoolName") ?? ""),
          schoolAddress: String(form.get("schoolAddress") ?? ""),
          cacNumber: String(form.get("cacNumber") ?? ""),
          frscNumber: String(form.get("frscNumber") ?? ""),
          acceptedTerms: form.get("acceptedTerms") === "on"
        })
      );
    } catch (cause) {
      setError(
        cause instanceof AuthError ? cause.message : "Could not create the account. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4"
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">Your full name</span>
        <input
          className="min-h-[48px] rounded-lg border border-slate-300 px-4"
          name="ownerName"
          autoComplete="name"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Phone number</span>
        <input
          className="min-h-[48px] rounded-lg border border-slate-300 px-4"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="08012345678"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Driving school name</span>
        <input
          className="min-h-[48px] rounded-lg border border-slate-300 px-4"
          name="schoolName"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">School address</span>
        <textarea
          className="min-h-[88px] rounded-lg border border-slate-300 px-4 py-3"
          name="schoolAddress"
          required
        />
      </label>
      <details>
        <summary>Registration numbers (you can complete these later)</summary>
        <div className="mt-3 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-medium">CAC registration number</span>
            <input
              className="min-h-[48px] rounded-lg border border-slate-300 px-4"
              name="cacNumber"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">FRSC accreditation number</span>
            <input
              className="min-h-[48px] rounded-lg border border-slate-300 px-4"
              name="frscNumber"
            />
          </label>
        </div>
      </details>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Create a password</span>
        <input
          className="min-h-[48px] rounded-lg border border-slate-300 px-4"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <small>
          Use at least 8 characters, including a capital letter, small letter and number.
        </small>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Enter the password again</span>
        <input
          className="min-h-[48px] rounded-lg border border-slate-300 px-4"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </label>
      <label className="flex items-start gap-3">
        <input className="mt-1 h-5 w-5" name="acceptedTerms" type="checkbox" required />
        <span>
          I agree that DriveMaster may store these details to create and operate my school account.
        </span>
      </label>
      {error && (
        <p className="text-rose-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="min-h-[48px] rounded-lg bg-brand px-6 py-3 text-lg font-medium text-brand-ink disabled:opacity-60"
        disabled={busy}
      >
        {busy ? "Creating your school…" : "Create my school account"}
      </button>
    </form>
  );
}
