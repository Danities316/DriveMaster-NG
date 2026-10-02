import type { TrainingDestination } from "./features/dashboard/SchoolDay";
import { TrainingPage } from "./features/training/TrainingPage";
import { startTrainingSync } from "./features/training/trainingLocal";
import { FleetPage } from "./features/fleet/FleetPage";
import { useEffect, useRef, useState } from "react";
import { AppShell, type Section } from "./components/AppShell";
import { Dashboard } from "./features/dashboard/Dashboard";
import type { AuthenticatedUser, StudentWithBalance } from "@drivemaster/shared";
import { LoginForm } from "./components/LoginForm";
import { fetchCurrentUser, getCachedUser, logout } from "./lib/auth";
import { StudentListPage } from "./features/students/StudentListPage";
import { StudentDetailPage } from "./features/students/StudentDetailPage";
import { StudentFormPage } from "./features/students/StudentFormPage";
import { EditStudentPage } from "./features/students/EditStudentPage";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { startSync } from "./sync/controller";
import { HomePage } from "./features/home/HomePage";
import { PublicEnrollmentPage } from "./features/training/PublicEnrollmentPage";
import { MorePage } from "./components/MorePage";

type AuthState =
  { status: "loading" } | { status: "loggedOut" } | { status: "loggedIn"; user: AuthenticatedUser };

type View =
  | { screen: "dashboard" | "payments" | "sync" | "fleet" | "more" }
  | ({ screen: "training"; studentId?: string; fromMore?: boolean } & TrainingDestination)
  | { screen: "list" }
  | { screen: "detail"; studentId: string }
  | { screen: "create" }
  | { screen: "edit"; studentId: string };

/**
 * App shell (Unit 3): wires together auth (Unit 2) and Student Management
 * (Unit 3) into a single, working, mobile-first app.
 *
 * No routing library is used — there is no URL-based navigation, only
 * in-memory view state. This is a deliberate choice, not an oversight:
 * adding react-router (or similar) would be a new dependency for an
 * internal staff tool with no deep-linking requirement, which this
 * unit's "do not introduce new technologies" instruction rules out
 * without a concrete need for it.
 *
 * OFFLINE SESSION RECOGNITION: initializes optimistically from the
 * non-sensitive cached identity (see lib/auth.ts) so a returning user
 * sees the app immediately, even offline, then reconciles with the
 * server in the background via fetchCurrentUser().
 */
export function App() {
  const [publicRoute, setPublicRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const updateRoute = () => setPublicRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);
  function navigatePublic(route: string) {
    window.location.hash = route;
    setPublicRoute(route);
    window.scrollTo(0, 0);
  }
  const [authState, setAuthState] = useState<AuthState>(() => {
    const cached = getCachedUser();
    return cached ? { status: "loggedIn", user: cached } : { status: "loading" };
  });
  const [view, setView] = useState<View>({ screen: "dashboard" });
  const authGeneration = useRef(0);
  const syncUser = authState.status === "loggedIn" ? authState.user : null;
  useEffect(() => {
    if (syncUser) {
      const stopSync = startSync(syncUser);
      const stopTraining = startTrainingSync(syncUser);
      return () => {
        stopSync();
        stopTraining();
      };
    }
  }, [syncUser]);

  useEffect(() => {
    let cancelled = false;
    const generation = authGeneration.current;

    fetchCurrentUser()
      .then((result) => {
        if (cancelled || generation !== authGeneration.current) return;
        if (result.user) {
          setAuthState({ status: "loggedIn", user: result.user });
        } else {
          // The server explicitly said "not authenticated" — trust that
          // over any stale cache.
          setAuthState({ status: "loggedOut" });
        }
        // source === "cache" or "none": leave the initial state as-is
        // (either already optimistically logged in, or already loggedOut/loading).
      })
      .catch(() => {
        setAuthState((prev) => (prev.status === "loading" ? { status: "loggedOut" } : prev));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    navigatePublic("#login");
    authGeneration.current += 1;
    setAuthState({ status: "loggedOut" });
    setView({ screen: "dashboard" });
    await logout();
  }

  function handleSaved(student: StudentWithBalance): void {
    setView({ screen: "detail", studentId: student.id });
  }

  function navigateSection(section: Section): void {
    setView(
      section === "home"
        ? { screen: "dashboard" }
        : section === "students"
          ? { screen: "list" }
          : section === "training"
            ? { screen: "training" }
            : section === "money"
              ? { screen: "payments" }
              : { screen: "more" }
    );
  }

  const enrollmentRoute =
    /^#enroll\/([^/?#]+)$/.exec(publicRoute) ??
    /^\/enroll\/([^/?#]+)\/?$/.exec(window.location.pathname);
  if (enrollmentRoute)
    return <PublicEnrollmentPage key={enrollmentRoute[1]} schoolId={enrollmentRoute[1]!} />;
  if (
    ["#home", "#benefits", "#walkthrough", "#questions", "#home-main", "#mileage-fuel"].includes(
      publicRoute
    ) ||
    (authState.status !== "loggedIn" && publicRoute !== "#login" && publicRoute !== "#app")
  ) {
    return (
      <HomePage
        authenticated={authState.status === "loggedIn"}
        onSignIn={() => navigatePublic(authState.status === "loggedIn" ? "#app" : "#login")}
      />
    );
  }

  if (authState.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  if (authState.status === "loggedOut") {
    return (
      <main className="home-login">
        <div className="home-login-card">
          <a href="#home" className="home-text-link">
            ← Back to DriveMaster NG
          </a>
          <p className="home-kicker">YOUR SCHOOL WORKSPACE</p>
          <h1>Welcome back.</h1>
          <p>Sign in to your students, payments, and daily overview.</p>
          <LoginForm
            onSuccess={(user) => {
              authGeneration.current += 1;
              setAuthState({ status: "loggedIn", user });
              navigatePublic("#app");
            }}
          />
          <p className="home-login-help">Need an account? Contact your school administrator.</p>
        </div>
      </main>
    );
  }

  const { user } = authState;
  if (user.role === "STUDENT" || user.role === "INSTRUCTOR")
    return <TrainingPage key={user.id} user={user} onLogout={() => void handleLogout()} />;

  return (
    <AppShell
      user={user}
      section={
        view.screen === "dashboard"
          ? "home"
          : view.screen === "payments"
            ? "money"
            : ["more", "sync", "fleet"].includes(view.screen) ||
                (view.screen === "training" && view.fromMore)
              ? "more"
              : view.screen === "training"
                ? "training"
                : "students"
      }
      onNavigate={navigateSection}
      onLogout={() => void handleLogout()}
    >
      {view.screen === "dashboard" || view.screen === "payments" ? (
        <Dashboard
          key={view.screen}
          user={user}
          paymentsOnly={view.screen === "payments"}
          onAdd={() => setView({ screen: "create" })}
          onStudents={() => setView({ screen: "list" })}
          onStudent={(studentId) => setView({ screen: "detail", studentId })}
          onPayments={() => setView({ screen: "payments" })}
          onSync={() => setView({ screen: "sync" })}
          onTraining={(destination) => setView({ screen: "training", ...destination })}
          onFleet={() => setView({ screen: "fleet" })}
        />
      ) : null}
      {view.screen === "training" && (
        <TrainingPage
          user={user}
          initialStudentId={view.studentId}
          initialTab={view.tab}
          initialFilter={view.filter}
          onAddStudent={() => setView({ screen: "create" })}
          onVehicles={() => setView({ screen: "fleet" })}
        />
      )}
      {view.screen === "fleet" ? <FleetPage user={user} /> : null}
      {view.screen === "sync" ? (
        <div className="dashboard-content">
          <div className="dashboard-heading">
            <div>
              <p className="dm-eyebrow">YOUR SAVED WORK</p>
              <h1>Saved records</h1>
              <p>Records saved on this device that are waiting to be sent or need attention.</p>
            </div>
          </div>
          <div className="dm-panel sync-panel">
            <p>
              Student, payment and vehicle records are shown below. Training records stay in their
              existing ordered list so Start is always sent before Finish.
            </p>
            <button className="dm-secondary" onClick={() => setView({ screen: "training" })}>
              Check saved training records
            </button>
            <ConnectionStatus schoolId={user.schoolId} />
          </div>
        </div>
      ) : null}
      {view.screen === "more" ? (
        <MorePage
          user={user}
          onSetup={() => setView({ screen: "training", tab: "setup", fromMore: true })}
          onFleet={() => setView({ screen: "fleet" })}
          onSavedRecords={() => setView({ screen: "sync" })}
        />
      ) : null}
      {view.screen === "list" ? (
        <StudentListPage
          schoolId={user.schoolId}
          onSelectStudent={(studentId) => setView({ screen: "detail", studentId })}
          onAddStudent={() => setView({ screen: "create" })}
        />
      ) : null}

      {view.screen === "detail" ? (
        <StudentDetailPage
          viewer={user}
          studentId={view.studentId}
          onBack={() => setView({ screen: "list" })}
          onEdit={(studentId) => setView({ screen: "edit", studentId })}
          canRecordPayment={true}
          onTraining={(studentId) => setView({ screen: "training", studentId })}
        />
      ) : null}

      {view.screen === "create" ? (
        <StudentFormPage
          schoolId={user.schoolId}
          onSaved={handleSaved}
          onCancel={() => setView({ screen: "list" })}
        />
      ) : null}

      {view.screen === "edit" ? (
        <EditStudentPage
          studentId={view.studentId}
          schoolId={user.schoolId}
          onSaved={handleSaved}
          onCancel={() => setView({ screen: "detail", studentId: view.studentId })}
        />
      ) : null}
    </AppShell>
  );
}

export default App;
