import { useState } from "react";
import { trainingRequest } from "./trainingLocal";
interface StaffAccount {
  id: string;
  name: string;
  phone: string;
  role: "INSTRUCTOR" | "RECEPTIONIST";
  isActive: boolean;
  version: number;
}
export function StaffAccounts({ onChanged }: { onChanged: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<StaffAccount | null>(null);
  const [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  async function load(page = offset) {
    const result = await trainingRequest(`accounts?offset=${page}`);
    setSelected(null);
    setAccounts(result.accounts);
    setHasMore(result.hasMore);
    setOffset(page);
    setLoaded(true);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      if (navigator.onLine === false)
        throw new Error("Connect to the internet to manage staff access.");
      await action();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="dm-panel training-panel training-setting">
      <summary>Manage staff access</summary>
      <p>
        Only the owner can change access. Deactivation signs the staff member out on their next
        server check. Records and saved work are kept. Devices already offline cannot be remotely
        locked until they reconnect.
      </p>
      <button
        type="button"
        className="dm-secondary"
        disabled={busy}
        onClick={() => void run(() => load(0))}
      >
        {loaded ? "Reload staff accounts" : "Load staff accounts"}
      </button>
      {message && <p role="status">{message}</p>}
      {loaded && !accounts.length && <p>No instructor or receptionist accounts yet.</p>}
      <ul>
        {accounts.map((account) => (
          <li key={account.id} className="my-3">
            <strong>{account.name}</strong> ·{" "}
            {account.role === "RECEPTIONIST" ? "Receptionist" : "Instructor"} · {account.phone} ·{" "}
            {account.isActive ? "Active" : "Inactive"}
            <button
              type="button"
              className="dm-secondary ml-2"
              disabled={busy}
              onClick={() => {
                setSelected(account);
                setReason("");
                setMessage("");
              }}
            >
              {account.isActive ? "Deactivate" : "Reactivate"} {account.name}
            </button>
          </li>
        ))}
      </ul>
      {loaded && (
        <div className="fleet-actions">
          <button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => void run(() => load(offset - 100))}
          >
            Previous staff page
          </button>
          <button
            type="button"
            disabled={busy || !hasMore}
            onClick={() => void run(() => load(offset + 100))}
          >
            Next staff page
          </button>
        </div>
      )}
      {selected && (
        <form
          className="training-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await trainingRequest(`accounts/${selected.id}/access`, {
                isActive: !selected.isActive,
                expectedVersion: selected.version,
                reason
              });
              setSelected(null);
              setReason("");
              await load();
              await onChanged();
              setMessage(
                "Staff access updated. Previous sessions and reset codes have been invalidated."
              );
            });
          }}
        >
          <h3>
            {selected.isActive ? "Deactivate" : "Reactivate"} {selected.name}
          </h3>
          <p>
            {selected.isActive
              ? "They will lose server access. Finish or reassign their work as needed."
              : "They can sign in again with their existing password; old sessions stay invalid."}
          </p>
          <label>
            Reason for changing access
            <textarea
              required
              minLength={5}
              maxLength={500}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="dm-primary" disabled={busy} type="submit">
            Confirm {selected.isActive ? "deactivation" : "reactivation"}
          </button>
          <button type="button" disabled={busy} onClick={() => setSelected(null)}>
            Cancel access change
          </button>
        </form>
      )}
    </details>
  );
}
