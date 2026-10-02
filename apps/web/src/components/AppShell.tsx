import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LayoutDashboard,
  Users,
  Wallet,
  LogOut,
  Search,
  Route,
  Wifi,
  WifiOff,
  Menu
} from "lucide-react";
import type { AuthenticatedUser } from "@drivemaster/shared";
import { db } from "../db/db";
import { getOrCreateDeviceId } from "../lib/device";

export type Section = "home" | "students" | "training" | "money" | "more";
const items = [
  { key: "home", label: "Home", icon: LayoutDashboard },
  { key: "students", label: "Students", icon: Users },
  { key: "training", label: "Training", icon: Route },
  { key: "money", label: "Money", icon: Wallet },
  { key: "more", label: "More", icon: Menu }
] as const;
export function AppShell({
  user,
  section,
  onNavigate,
  onLogout,
  children
}: {
  user: AuthenticatedUser;
  section: Section;
  onNavigate: (section: Section) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [online, setOnline] = useState(navigator.onLine);
  const sync = useLiveQuery(() => db.syncState.get(getOrCreateDeviceId()), []);
  const savedCounts = useLiveQuery(async () => {
    const [records, training] = await Promise.all([
      db.outbox.where("schoolId").equals(user.schoolId).toArray(),
      db.trainingQueue.where("userId").equals(user.id).toArray()
    ]);
    const ownTraining = training.filter(
      (entry) => entry.schoolId === user.schoolId && entry.role === user.role
    );
    return {
      attention:
        records.filter((entry) => ["FAILED", "CONFLICT"].includes(entry.status)).length +
        ownTraining.filter((entry) => entry.status === "FAILED").length,
      waiting:
        records.filter((entry) => !["FAILED", "CONFLICT"].includes(entry.status)).length +
        ownTraining.filter((entry) => entry.status !== "FAILED").length
    };
  }, [user.id, user.schoolId, user.role]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div className="dm-app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="dm-sidebar">
        <a
          className="dm-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("home");
          }}
          aria-label="DriveMaster home"
        >
          <span className="brand-symbol">
            <Route size={24} />
          </span>
          <span>
            DriveMaster<span className="brand-ng">NG</span>
            <small>YOUR SCHOOL. IN CONTROL.</small>
          </span>
        </a>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {items
            .filter(
              (item) =>
                user.role !== "STUDENT" &&
                (user.role !== "INSTRUCTOR" || item.key === "home" || item.key === "training")
            )
            .map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                aria-current={section === key ? "page" : undefined}
                className={section === key ? "nav-active" : ""}
                onClick={() => onNavigate(key)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {section === key && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">
            <span className="workspace-icon">NG</span>
            <span>
              School workspace<small>Nigeria · NGN</small>
            </span>
          </div>
          <div className="profile-line">
            <span className="profile-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.role === "OWNER"
                  ? "School owner"
                  : user.role === "RECEPTIONIST"
                    ? "Receptionist"
                    : "Instructor"}
              </small>
            </span>
          </div>
        </div>
      </aside>
      <div className="dm-workspace">
        <header className="dm-topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{items.find((item) => item.key === section)?.label}</strong>
          </div>
          <div className="topbar-tools">
            {["OWNER", "RECEPTIONIST"].includes(user.role) && (
              <button className="header-search" onClick={() => onNavigate("students")}>
                <Search size={17} />
                <span>Find a student</span>
              </button>
            )}
            <span className={`network-pill ${online ? "" : "network-offline"}`} role="status">
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>
                {savedCounts?.attention
                  ? `${savedCounts.attention} record${savedCounts.attention === 1 ? " needs" : "s need"} attention`
                  : !online
                    ? "Offline · work can still be saved"
                    : savedCounts?.waiting
                      ? `${savedCounts.waiting} record${savedCounts.waiting === 1 ? "" : "s"} waiting to be sent`
                      : sync?.lastError
                        ? "Some records need attention"
                        : "Online"}
              </span>
            </span>
            <button className="header-logout" type="button" onClick={onLogout}>
              <LogOut size={18} aria-hidden="true" />
              <span>Log out</span>
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
