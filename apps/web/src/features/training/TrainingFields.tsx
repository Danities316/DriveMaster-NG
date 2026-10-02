import { useState, type FormEvent, type ReactNode } from "react";
export function EntryForm({
  title,
  onSave,
  children,
  disabled = false
}: {
  title: string;
  onSave: (form: FormData) => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await onSave(new FormData(form));
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="training-form" onSubmit={(event) => void save(event)}>
      <h3>{title}</h3>
      {children}
      {error && (
        <p className="fleet-error" role="alert">
          {error}
        </p>
      )}
      <button className="dm-primary" type="submit" disabled={disabled || busy}>
        {busy ? "Saving…" : title}
      </button>
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  initial,
  min,
  max,
  step,
  required = true
}: {
  label: string;
  name: string;
  type?: string;
  initial?: string | number;
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={initial}
        required={required}
        min={min}
        max={max}
        step={step}
        maxLength={type === "password" ? 128 : 500}
      />
    </label>
  );
}
