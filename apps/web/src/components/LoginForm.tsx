import { useState, type FormEvent } from "react";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { login, AuthError } from "../lib/auth";

interface LoginFormProps {
  onSuccess: (user: AuthenticatedUser) => void;
}

/**
 * Minimal, functional login form for a mobile-first, non-technical
 * audience. Deliberately not visually elaborate — see the Unit 2 task:
 * "Do not build a visually elaborate login page in this unit.
 * Functionality comes first."
 *
 * Nigerian/mobile considerations applied here:
 *   - Phone number is the only identifier — no email field exists at all.
 *   - `type="tel"` + `inputMode="tel"` bring up the phone-friendly
 *     keyboard on Android/iOS instead of a full QWERTY keyboard.
 *   - Two fields, one button — the minimum possible number of steps.
 *   - 48px-minimum touch targets on both inputs and the submit button.
 *   - Errors are the exact plain-language string the API returns (e.g.
 *     "Phone number or password is incorrect."), never a technical one.
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await login(phone, password);
      onSuccess(user);
    } catch (err) {
      setError(
        err instanceof AuthError
          ? err.message
          : "Could not reach the server. Please check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="phone" className="text-base font-medium text-slate-900">
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="e.g. 08012345678"
          className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-base font-medium text-slate-900">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
        />
      </div>

      {error ? (
        <p role="alert" className="text-base text-rose-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-[48px] rounded-lg bg-brand px-6 py-3 text-lg font-medium text-brand-ink transition hover:bg-brand-hover disabled:opacity-60"
      >
        {isSubmitting ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
