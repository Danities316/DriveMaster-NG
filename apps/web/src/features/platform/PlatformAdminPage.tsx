import { useEffect, useState, type FormEvent } from "react";

const API = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
type Overview = {
  totals: {
    schools: number;
    activeSchools: number;
    trialSchools: number;
    students: number;
    sessions: number;
  };
  schools: Array<{
    id: string;
    name: string;
    phone: string;
    status: string;
    trialEndsAt: string | null;
    createdAt: string;
    _count: { users: number; students: number };
  }>;
  recentActivity: Array<{ id: string; action: string; schoolId: string | null; timestamp: string }>;
};

async function message(response: Response) {
  const body = (await response.json()) as { error?: { message?: string } };
  return body.error?.message ?? "The request could not be completed.";
}

export function PlatformAdminPage() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch(`${API}/platform/overview`, { credentials: "include" });
    if (response.ok) setOverview((await response.json()) as Overview);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API}/platform/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    if (!response.ok) {
      setError(await message(response));
      return;
    }
    await load();
  }

  if (loading)
    return (
      <main className="home-login">
        <p>Loading platform administration…</p>
      </main>
    );
  if (!overview)
    return (
      <main className="home-login">
        <div className="home-login-card">
          <p className="home-kicker">DRIVEMASTER PLATFORM</p>
          <h1>Super Admin</h1>
          <p>This private area is for authorised DriveMaster platform administrators.</p>
          <form className="flex flex-col gap-4" onSubmit={(event) => void login(event)}>
            <label className="flex flex-col gap-1">
              Email
              <input
                className="min-h-[48px] rounded-lg border px-4"
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              Password
              <input
                className="min-h-[48px] rounded-lg border px-4"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="text-rose-700">
                {error}
              </p>
            )}
            <button className="dm-primary min-h-[48px]">Sign in securely</button>
          </form>
        </div>
      </main>
    );

  return (
    <main className="dashboard-content">
      <div className="dashboard-heading">
        <div>
          <p className="dm-eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>DriveMaster schools</h1>
          <p>
            Monitor school accounts and platform activity without exposing private student details.
          </p>
        </div>
      </div>
      <section className="dashboard-metrics" aria-label="Platform totals">
        <div className="dm-panel">
          <span>All schools</span>
          <strong>{overview.totals.schools}</strong>
        </div>
        <div className="dm-panel">
          <span>Active</span>
          <strong>{overview.totals.activeSchools}</strong>
        </div>
        <div className="dm-panel">
          <span>On trial</span>
          <strong>{overview.totals.trialSchools}</strong>
        </div>
        <div className="dm-panel">
          <span>Students</span>
          <strong>{overview.totals.students}</strong>
        </div>
        <div className="dm-panel">
          <span>Training bookings</span>
          <strong>{overview.totals.sessions}</strong>
        </div>
      </section>
      <section className="dm-panel">
        <h2>Registered schools</h2>
        <div className="table-scroll">
          <table className="dm-table">
            <thead>
              <tr>
                <th>School</th>
                <th>Status</th>
                <th>Students</th>
                <th>Staff accounts</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {overview.schools.map((school) => (
                <tr key={school.id}>
                  <td>
                    {school.name}
                    <small className="block">{school.phone}</small>
                  </td>
                  <td>{school.status}</td>
                  <td>{school._count.students}</td>
                  <td>{school._count.users}</td>
                  <td>{new Date(school.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="dm-panel">
        <h2>Recent platform activity</h2>
        {!overview.recentActivity.length ? (
          <p>No platform activity yet.</p>
        ) : (
          <ul>
            {overview.recentActivity.map((item) => (
              <li key={item.id}>
                <strong>{item.action.replaceAll("_", " ")}</strong> ·{" "}
                {new Date(item.timestamp).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
