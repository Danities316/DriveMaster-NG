import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Users
} from "lucide-react";
import "./platform.css";

const API = import.meta.env["VITE_API_BASE_URL"] ?? "/api";
type Section = "overview" | "schools" | "activity";
type School = {
  id: string;
  name: string;
  phone: string;
  status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  trialEndsAt: string | null;
  createdAt: string;
  _count: { users: number; students: number };
};
type AuditItem = { id: string; action: string; schoolId: string | null; timestamp: string };
type Overview = {
  totals: {
    schools: number;
    activeSchools: number;
    trialSchools: number;
    students: number;
    sessions: number;
  };
  schools: School[];
  recentActivity: AuditItem[];
};
const navigation = [
  { key: "overview", label: "Home", icon: LayoutDashboard },
  { key: "schools", label: "Schools", icon: Building2 },
  { key: "activity", label: "Activity", icon: Activity }
] as const;
const statusLabel = {
  TRIAL: "On trial",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CLOSED: "Closed"
};
const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
async function responseMessage(response: Response) {
  const body = (await response.json()) as { error?: { message?: string } };
  return body.error?.message ?? "The request could not be completed.";
}

export function PlatformAdminPage() {
  const [overview, setOverview] = useState<Overview>();
  const [section, setSection] = useState<Section>("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [changing, setChanging] = useState<string>();
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/platform/overview`, { credentials: "include" });
      if (response.ok) setOverview((await response.json()) as Overview);
      else if (response.status !== 401) setError(await responseMessage(response));
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API}/platform/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      await load();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    }
  }
  async function logout() {
    await fetch(`${API}/platform/auth/logout`, { method: "POST", credentials: "include" }).catch(
      () => undefined
    );
    setOverview(undefined);
    setSection("overview");
  }
  async function changeStatus(event: FormEvent<HTMLFormElement>, schoolId: string) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setChanging(schoolId);
    try {
      const response = await fetch(`${API}/platform/schools/${schoolId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: form.get("status"), reason: form.get("reason") })
      });
      if (!response.ok) {
        setError(await responseMessage(response));
        return;
      }
      await load();
    } catch {
      setError("The status was not changed. Check your connection and try again.");
    } finally {
      setChanging(undefined);
    }
  }
  const schools = useMemo(
    () =>
      overview?.schools.filter(
        (school) =>
          (status === "ALL" || school.status === status) &&
          `${school.name} ${school.phone}`.toLowerCase().includes(search.toLowerCase())
      ) ?? [],
    [overview, search, status]
  );
  const expiringTrials =
    overview?.schools.filter(
      (school) =>
        school.status === "TRIAL" &&
        school.trialEndsAt &&
        (new Date(school.trialEndsAt).getTime() - Date.now()) / 86400000 <= 7
    ) ?? [];
  const suspended = overview?.schools.filter((school) => school.status === "SUSPENDED") ?? [];

  if (loading && !overview)
    return (
      <main className="platform-loading" role="status">
        <Route />
        <p>Loading DriveMaster administration…</p>
      </main>
    );
  if (!overview)
    return (
      <main className="platform-login">
        <section className="platform-login-card">
          <div className="platform-login-brand">
            <span>
              <Route size={25} />
            </span>
            DriveMaster<strong>NG</strong>
          </div>
          <p className="dm-eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>Welcome back.</h1>
          <p>Sign in to monitor schools and platform activity.</p>
          <form onSubmit={(event) => void login(event)}>
            <label>
              Email address
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && (
              <p role="alert" className="platform-error">
                {error}
              </p>
            )}
            <button className="dm-primary">Sign in securely</button>
          </form>
          <p className="platform-private">
            <ShieldCheck size={16} />
            Private access for authorised DriveMaster administrators.
          </p>
        </section>
      </main>
    );

  return (
    <div className="dm-app platform-shell">
      <a className="skip-link" href="#platform-main">
        Skip to content
      </a>
      <aside className="dm-sidebar">
        <button className="dm-brand platform-brand-button" onClick={() => setSection("overview")}>
          <span className="brand-symbol">
            <Route size={24} />
          </span>
          <span>
            DriveMaster<span className="brand-ng">NG</span>
            <small>PLATFORM CONTROL</small>
          </span>
        </button>
        <p className="nav-caption">SUPER ADMIN</p>
        <nav aria-label="Super Admin navigation">
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={section === key ? "nav-active" : ""}
              aria-current={section === key ? "page" : undefined}
              onClick={() => setSection(key)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {section === key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">
            <span className="workspace-icon">SA</span>
            <span>
              Platform workspace<small>All DriveMaster schools</small>
            </span>
          </div>
          <div className="profile-line">
            <span className="profile-avatar">SA</span>
            <span>
              <strong>Super Admin</strong>
              <small>Platform administrator</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="dm-workspace">
        <header className="dm-topbar">
          <div className="breadcrumb">
            Platform <span>/</span>
            <strong>{navigation.find((item) => item.key === section)?.label}</strong>
          </div>
          <div className="topbar-tools">
            <span className="network-pill">
              <ShieldCheck size={14} />
              <span>Secure admin session</span>
            </span>
            <button className="header-logout" onClick={() => void logout()}>
              <LogOut size={18} />
              <span>Log out</span>
            </button>
          </div>
        </header>
        <main id="platform-main" tabIndex={-1}>
          <div className="dashboard-content">
            {error && (
              <div className="dm-notice platform-error-banner" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button onClick={() => void load()}>Try again</button>
              </div>
            )}
            {section === "overview" && (
              <>
                <div className="dashboard-heading">
                  <div>
                    <p className="dm-eyebrow">PLATFORM OVERVIEW</p>
                    <h1>Hello, Super Admin.</h1>
                    <p>See how DriveMaster schools are doing and what needs your attention.</p>
                  </div>
                  <div className="dashboard-actions">
                    <button className="dm-secondary" onClick={() => void load()}>
                      <RefreshCw size={17} />
                      Refresh
                    </button>
                    <button className="dm-primary" onClick={() => setSection("schools")}>
                      <Building2 size={18} />
                      View schools
                    </button>
                  </div>
                </div>
                <section className="dashboard-stats platform-stats" aria-label="Platform totals">
                  <article className="stat-card stat-featured">
                    <div className="stat-label">
                      Registered schools <Building2 size={19} />
                    </div>
                    <strong>{overview.totals.schools}</strong>
                    <span>
                      {overview.totals.activeSchools} active · {overview.totals.trialSchools} on
                      trial
                    </span>
                  </article>
                  <article className="stat-card">
                    <div className="stat-label">
                      Students managed <Users size={19} />
                    </div>
                    <strong>{overview.totals.students.toLocaleString()}</strong>
                    <span>Across all registered schools</span>
                  </article>
                  <article className="stat-card">
                    <div className="stat-label">
                      Training bookings <Route size={19} />
                    </div>
                    <strong>{overview.totals.sessions.toLocaleString()}</strong>
                    <span>Recorded across the platform</span>
                  </article>
                  <article className="stat-card">
                    <div className="stat-label">
                      Needs attention <CircleAlert size={19} />
                    </div>
                    <strong>{expiringTrials.length + suspended.length}</strong>
                    <button onClick={() => setSection("schools")}>Check schools</button>
                  </article>
                </section>
                <section className="platform-attention">
                  <div className="panel-heading">
                    <div>
                      <h2>What needs your attention?</h2>
                      <p>Only schools that may need an action are shown here.</p>
                    </div>
                  </div>
                  {!expiringTrials.length && !suspended.length ? (
                    <div className="platform-clear">
                      <CheckCircle2 />
                      <div>
                        <strong>Nothing urgent right now</strong>
                        <p>No suspended schools or trials ending within seven days.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="platform-attention-grid">
                      {!!expiringTrials.length && (
                        <button
                          className="dm-panel"
                          onClick={() => {
                            setStatus("TRIAL");
                            setSection("schools");
                          }}
                        >
                          <Clock3 />
                          <span>
                            <strong>
                              {expiringTrials.length} trial{expiringTrials.length === 1 ? "" : "s"}{" "}
                              ending soon
                            </strong>
                            <small>Review these schools before access is affected.</small>
                          </span>
                        </button>
                      )}
                      {!!suspended.length && (
                        <button
                          className="dm-panel"
                          onClick={() => {
                            setStatus("SUSPENDED");
                            setSection("schools");
                          }}
                        >
                          <CircleAlert />
                          <span>
                            <strong>
                              {suspended.length} suspended school{suspended.length === 1 ? "" : "s"}
                            </strong>
                            <small>Check the reason and decide the next step.</small>
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </section>
                <SchoolList
                  schools={overview.schools.slice(0, 5)}
                  compact
                  onChangeStatus={changeStatus}
                  changing={changing}
                />
                <ActivityList
                  items={overview.recentActivity.slice(0, 6)}
                  schools={overview.schools}
                />
              </>
            )}
            {section === "schools" && (
              <>
                <div className="dashboard-heading">
                  <div>
                    <p className="dm-eyebrow">SCHOOL ACCOUNTS</p>
                    <h1>Schools</h1>
                    <p>Find a school, check its usage and manage its access.</p>
                  </div>
                  <button className="dm-secondary" onClick={() => void load()}>
                    <RefreshCw size={17} />
                    Refresh
                  </button>
                </div>
                <div className="ledger-filters platform-filters">
                  <label className="dm-search">
                    <Search size={18} />
                    <input
                      type="search"
                      aria-label="Search schools"
                      placeholder="Search school or phone number…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <select
                    aria-label="School status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="ALL">All statuses</option>
                    {Object.entries(statusLabel).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <SchoolList schools={schools} onChangeStatus={changeStatus} changing={changing} />
              </>
            )}
            {section === "activity" && (
              <>
                <div className="dashboard-heading">
                  <div>
                    <p className="dm-eyebrow">AUDIT TRAIL</p>
                    <h1>Platform activity</h1>
                    <p>See important actions recorded across DriveMaster administration.</p>
                  </div>
                  <button className="dm-secondary" onClick={() => void load()}>
                    <RefreshCw size={17} />
                    Refresh
                  </button>
                </div>
                <ActivityList items={overview.recentActivity} schools={overview.schools} full />
              </>
            )}
            <footer className="dashboard-footer">
              <span>DriveMaster NG · Platform administration</span>
              <span>Private operational information</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function SchoolList({
  schools,
  compact = false,
  onChangeStatus,
  changing
}: {
  schools: School[];
  compact?: boolean;
  onChangeStatus: (event: FormEvent<HTMLFormElement>, schoolId: string) => Promise<void>;
  changing?: string;
}) {
  return (
    <section className="dm-panel platform-school-panel">
      <div className="panel-heading">
        <div>
          <h2>
            {compact
              ? "Recently registered schools"
              : `${schools.length} school${schools.length === 1 ? "" : "s"}`}
          </h2>
          <p>
            {compact
              ? "The newest schools using DriveMaster"
              : "Open a school to review or change its access"}
          </p>
        </div>
      </div>
      {!schools.length ? (
        <div className="dashboard-empty">
          <Building2 />
          <h3>No schools found</h3>
          <p>Try another school name, phone number or status.</p>
        </div>
      ) : (
        <div className="platform-school-list">
          {schools.map((school) => (
            <article className="platform-school-card" key={school.id}>
              <div className="platform-school-main">
                <span className="student-avatar">{school.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <h3>{school.name}</h3>
                  <p>
                    {school.phone} · Joined {formatDate(school.createdAt)}
                  </p>
                </div>
                <span className={`platform-status status-${school.status.toLowerCase()}`}>
                  {statusLabel[school.status]}
                </span>
              </div>
              <div className="platform-school-numbers">
                <span>
                  <strong>{school._count.students}</strong> students
                </span>
                <span>
                  <strong>{school._count.users}</strong> accounts
                </span>
                {school.status === "TRIAL" && school.trialEndsAt && (
                  <span>
                    Trial ends <strong>{formatDate(school.trialEndsAt)}</strong>
                  </span>
                )}
              </div>
              {!compact && (
                <details className="platform-school-actions">
                  <summary>Manage school access</summary>
                  <form onSubmit={(event) => void onChangeStatus(event, school.id)}>
                    <label>
                      Account status
                      <select name="status" defaultValue={school.status}>
                        {Object.entries(statusLabel).map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reason for this change
                      <textarea
                        name="reason"
                        required
                        minLength={5}
                        placeholder="Explain why you are changing this school’s access"
                      />
                    </label>
                    <button className="dm-primary" disabled={changing === school.id}>
                      {changing === school.id ? "Saving…" : "Save status"}
                    </button>
                  </form>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityList({
  items,
  schools,
  full = false
}: {
  items: AuditItem[];
  schools: School[];
  full?: boolean;
}) {
  const schoolName = (id: string | null) =>
    schools.find((school) => school.id === id)?.name ?? "DriveMaster platform";
  return (
    <section className="dm-panel platform-activity">
      <div className="panel-heading">
        <div>
          <h2>{full ? "Recorded activity" : "Recent activity"}</h2>
          <p>Important platform actions with their date and school</p>
        </div>
      </div>
      {!items.length ? (
        <div className="dashboard-empty">
          <Activity />
          <h3>No activity recorded yet</h3>
          <p>New school registrations and Super Admin actions will appear here.</p>
        </div>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <span className="platform-activity-icon">
                <Activity size={17} />
              </span>
              <span>
                <strong>{item.action.replaceAll("_", " ").toLowerCase()}</strong>
                <small>{schoolName(item.schoolId)}</small>
              </span>
              <time>
                {new Date(item.timestamp).toLocaleString("en-NG", {
                  dateStyle: "medium",
                  timeStyle: "short"
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
