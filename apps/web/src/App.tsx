import type { TrainingDestination } from "./features/dashboard/SchoolDay";
import { startTrainingSync } from "./features/training/trainingLocal";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppShell, type Section } from "./components/AppShell";
import type {
  AuthenticatedUser,
  StudentWithBalance,
  OwnerVerificationStatus
} from "@drivemaster/shared";
import { LoginForm } from "./components/LoginForm";
import { OwnerRegistrationForm } from "./components/OwnerRegistrationForm";
import {
  AUTH_CHANGE_KEY,
  AUTH_STORAGE_KEYS,
  fetchCurrentUser,
  getCachedUser,
  getPendingVerification,
  logout
} from "./lib/auth";
import { OwnerVerificationForm } from "./components/OwnerVerificationForm";
import { AccountSecurity } from "./components/AccountSecurity";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { startSync } from "./sync/controller";

const TrainingPage = lazy(() =>
  import("./features/training/TrainingPage").then((module) => ({ default: module.TrainingPage }))
);
const FleetPage = lazy(() =>
  import("./features/fleet/FleetPage").then((module) => ({ default: module.FleetPage }))
);
const Dashboard = lazy(() =>
  import("./features/dashboard/Dashboard").then((module) => ({ default: module.Dashboard }))
);
const StudentListPage = lazy(() =>
  import("./features/students/StudentListPage").then((module) => ({
    default: module.StudentListPage
  }))
);
const StudentDetailPage = lazy(() =>
  import("./features/students/StudentDetailPage").then((module) => ({
    default: module.StudentDetailPage
  }))
);
const StudentFormPage = lazy(() =>
  import("./features/students/StudentFormPage").then((module) => ({
    default: module.StudentFormPage
  }))
);
const EditStudentPage = lazy(() =>
  import("./features/students/EditStudentPage").then((module) => ({
    default: module.EditStudentPage
  }))
);
const HomePage = lazy(() =>
  import("./features/home/HomePage").then((module) => ({ default: module.HomePage }))
);
const PublicEnrollmentPage = lazy(() =>
  import("./features/training/PublicEnrollmentPage").then((module) => ({
    default: module.PublicEnrollmentPage
  }))
);
const MorePage = lazy(() =>
  import("./components/MorePage").then((module) => ({ default: module.MorePage }))
);
const PlatformAdminPage = lazy(() =>
  import("./features/platform/PlatformAdminPage").then((module) => ({
    default: module.PlatformAdminPage
  }))
);

function PageLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-slate-500">Loading...</p>
    </main>
  );
}

type AuthState =
  | { status: "loading" }
  | { status: "loggedOut" }
  | { status: "verifying"; verification: OwnerVerificationStatus }
  | { status: "loggedIn"; user: AuthenticatedUser };

type View =
  | { screen: "dashboard" | "payments" | "sync" | "fleet" | "more" | "security" }
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
    const pending = getPendingVerification();
    if (pending) return { status: "verifying", verification: pending };
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
    let reconciling = false;
    const reconcile = () => {
      if (reconciling) return;
      reconciling = true;
      const generation = authGeneration.current;
      void fetchCurrentUser()
        .then((result) => {
          if (cancelled || generation !== authGeneration.current) return;
          if ("verification" in result) {
            setAuthState({ status: "verifying", verification: result.verification });
          } else if (!result.user && result.source === "none" && getPendingVerification()) {
            setAuthState({ status: "verifying", verification: getPendingVerification()! });
          } else if (result.user) {
            const next = result.user;
            setAuthState((prev) =>
              prev.status === "loggedIn" &&
              prev.user.id === next.id &&
              prev.user.schoolId === next.schoolId &&
              prev.user.role === next.role &&
              prev.user.name === next.name &&
              prev.user.phone === next.phone &&
              prev.user.schoolName === next.schoolName
                ? prev
                : { status: "loggedIn", user: next }
            );
          } else {
            // The server explicitly said "not authenticated" — trust that
            // over any stale cache.
            setAuthState({ status: "loggedOut" });
          }
          // source === "cache" or "none": leave the initial state as-is
          // (either already optimistically logged in, or already loggedOut/loading).
        })
        .catch(() => {
          if (cancelled || generation !== authGeneration.current) return;
          setAuthState((prev) => (prev.status === "loading" ? { status: "loggedOut" } : prev));
        })
        .finally(() => {
          reconciling = false;
        });
    };
    reconcile();
    const foreground = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) reconcile();
    };
    const timer = window.setInterval(foreground, 60000);
    window.addEventListener("focus", foreground);
    window.addEventListener("online", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
      cancelled = true;
    };
  }, []);

  const authStateRef = useRef(authState);
  authStateRef.current = authState;
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== null && !AUTH_STORAGE_KEYS.includes(event.key)) return;
      const cached = getCachedUser();
      const current = authStateRef.current;
      if (
        event.key !== AUTH_CHANGE_KEY &&
        event.key !== null &&
        current.status === "loggedIn" &&
        cached?.id === current.user.id &&
        cached.schoolId === current.user.schoolId &&
        cached.role === current.user.role
      )
        return;
      // Lock this tab only. Never log out the new account whose cookie another tab owns.
      authGeneration.current++;
      sessionStorage.removeItem("drivemaster:ownerVerification");
      setAuthState({ status: "loggedOut" });
      setView({ screen: "dashboard" });
      window.location.hash = "#login";
      setPublicRoute("#login");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
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

  useEffect(() => {
    const endSession = () => {
      void handleLogout();
    };
    window.addEventListener("drivemaster:session-ended", endSession);
    return () => window.removeEventListener("drivemaster:session-ended", endSession);
  });

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
    return (
      <Suspense fallback={<PageLoading />}>
        <PublicEnrollmentPage key={enrollmentRoute[1]!} schoolId={enrollmentRoute[1]!} />
      </Suspense>
    );
  if (publicRoute === "#platform-admin")
    return (
      <Suspense fallback={<PageLoading />}>
        <PlatformAdminPage />
      </Suspense>
    );
  if (authState.status === "verifying")
    return (
      <main className="home-login">
        <div className="home-login-card">
          <OwnerVerificationForm
            initialStatus={authState.verification}
            onSignOut={() => void handleLogout()}
            onSuccess={(user) => {
              authGeneration.current += 1;
              setAuthState({ status: "loggedIn", user });
              setView({ screen: "training", tab: "setup" });
              navigatePublic("#app");
            }}
          />
        </div>
      </main>
    );
  if (
    ["#home", "#benefits", "#walkthrough", "#questions", "#home-main", "#mileage-fuel"].includes(
      publicRoute
    ) ||
    (authState.status !== "loggedIn" &&
      publicRoute !== "#login" &&
      publicRoute !== "#register" &&
      publicRoute !== "#app")
  ) {
    return (
      <Suspense fallback={<PageLoading />}>
        <HomePage
          authenticated={authState.status === "loggedIn"}
          onSignIn={() => navigatePublic(authState.status === "loggedIn" ? "#app" : "#login")}
          onCreateAccount={() => navigatePublic("#register")}
        />
      </Suspense>
    );
  }

  if (authState.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  if (authState.status !== "loggedIn" && publicRoute === "#register") {
    return (
      <main className="home-login py-8">
        <div className="home-login-card max-w-xl">
          <a href="#login" className="home-text-link">
            ← Back to sign in
          </a>
          <p className="home-kicker">START YOUR SCHOOL WORKSPACE</p>
          <h1>Create your school account.</h1>
          <p>
            Add your school details and verify your phone by SMS. Your 14-day trial starts after
            verification. Then set up packages, instructors and vehicles.
          </p>
          <OwnerRegistrationForm
            onSuccess={(verification) => {
              authGeneration.current += 1;
              setAuthState({ status: "verifying", verification });
              navigatePublic("#verify");
            }}
          />
          <p className="home-login-help">
            Already registered? <a href="#login">Sign in</a>
          </p>
        </div>
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
            onVerification={(verification) => {
              authGeneration.current += 1;
              setAuthState({ status: "verifying", verification });
              navigatePublic("#verify");
            }}
            onSuccess={(user) => {
              authGeneration.current += 1;
              setAuthState({ status: "loggedIn", user });
              navigatePublic("#app");
            }}
          />
          <p className="home-login-help">
            New school? <a href="#register">Create your school account</a>.
          </p>
        </div>
      </main>
    );
  }

  const { user } = authState;
  if (user.role === "STUDENT" || user.role === "INSTRUCTOR")
    return (
      <AppShell
        onAccount={() => setView({ screen: "security" })}
        user={user}
        section={view.screen === "training" ? "training" : "home"}
        onNavigate={(section) =>
          setView(section === "training" ? { screen: "training" } : { screen: "dashboard" })
        }
        onLogout={() => void handleLogout()}
      >
        <Suspense fallback={<PageLoading />}>
          {view.screen === "security" ? (
            <AccountSecurity onSignedOut={() => void handleLogout()} />
          ) : (
            <TrainingPage key={`${user.id}-${view.screen}`} user={user} />
          )}
        </Suspense>
      </AppShell>
    );

  return (
    <AppShell
      onAccount={() => setView({ screen: "security" })}
      user={user}
      section={
        view.screen === "dashboard"
          ? "home"
          : view.screen === "payments"
            ? "money"
            : ["more", "sync", "fleet", "security"].includes(view.screen) ||
                (view.screen === "training" && view.fromMore)
              ? "more"
              : view.screen === "training"
                ? "training"
                : "students"
      }
      onNavigate={navigateSection}
      onLogout={() => void handleLogout()}
    >
      <Suspense fallback={<PageLoading />}>
        {view.screen === "security" && <AccountSecurity onSignedOut={() => void handleLogout()} />}
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
            initialBook={view.book}
            initialSetupArea={view.setupArea}
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
            onBookTraining={(studentId) =>
              setView({
                screen: "training",
                studentId,
                tab: "outings",
                filter: "today",
                book: true
              })
            }
          />
        ) : null}

        {view.screen === "create" ? (
          <StudentFormPage
            user={user}
            onSaved={handleSaved}
            onCancel={() => setView({ screen: "list" })}
          />
        ) : null}

        {view.screen === "edit" ? (
          <EditStudentPage
            studentId={view.studentId}
            user={user}
            onSaved={handleSaved}
            onCancel={() => setView({ screen: "detail", studentId: view.studentId })}
          />
        ) : null}
      </Suspense>
    </AppShell>
  );
}

export default App;
