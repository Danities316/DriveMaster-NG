import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { App } from "./App";

const SAMPLE_USER = {
  id: "user-1",
  schoolId: "school-1",
  schoolName: "Ada Driving School",
  role: "OWNER" as const,
  name: "Ada Okafor",
  phone: "+2348012345678"
};

/**
 * Dispatches by URL rather than call order. StudentListPage fires its own
 * `refreshStudentsFromServer()` fetch as soon as the students screen
 * mounts, and React runs that child effect before App's own effect, so a
 * simple "queue of responses in call order" mock is fragile here — this
 * mock is robust to that ordering.
 */
function mockFetchByUrl(
  handlers: Record<string, () => { ok: boolean; status?: number; json: () => Promise<unknown> }>
) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, handler] of Object.entries(handlers)) {
      if (url.includes(match)) {
        return Promise.resolve(handler());
      }
    }
    return Promise.reject(new Error(`Unhandled fetch in test: ${url}`));
  });
}

describe("App", () => {
  it("shows login instead of loading forever when started offline without a cached identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    expect(await screen.findByLabelText(/phone number/i)).toBeInTheDocument();
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "#login");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers a simple public school-owner registration route", async () => {
    window.history.replaceState(null, "", "#register");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Create your school account." })
    ).toBeVisible();
    expect(screen.getByLabelText("Your full name")).toBeVisible();
    expect(screen.getByLabelText("Driving school name")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create my school account" })).toBeVisible();
  });

  it("keeps a new owner outside the workspace until SMS verification succeeds", async () => {
    window.history.replaceState(null, "", "#register");
    const pending = {
      verificationRequired: true,
      maskedPhone: "+234******5678",
      resendAt: null,
      expiresAt: null,
      delivery: "sent"
    };
    let registered = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/register-owner")) {
          registered = true;
          return { ok: true, status: 202, json: async () => pending };
        }
        if (url.endsWith("/owner-verification/confirm"))
          return { ok: true, status: 200, json: async () => ({ user: SAMPLE_USER }) };
        if (url.endsWith("/owner-verification") && registered)
          return { ok: true, status: 200, json: async () => pending };
        return { ok: false, status: 401, json: async () => ({}) };
      })
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Your full name"), {
      target: { value: "Ada Owner" }
    });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText("Driving school name"), {
      target: { value: "Ada School" }
    });
    fireEvent.change(screen.getByLabelText("School address"), { target: { value: "Lagos road" } });
    fireEvent.change(screen.getByLabelText(/^Create a password/), {
      target: { value: "Password123" }
    });
    fireEvent.change(screen.getByLabelText("Enter the password again"), {
      target: { value: "Password123" }
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create my school account" }));
    expect(await screen.findByRole("heading", { name: "Verify your phone number" })).toBeVisible();
    expect(localStorage.getItem("drivemaster:lastKnownUser")).toBeNull();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Six-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(window.location.hash).toBe("#app"));
    expect(JSON.parse(localStorage.getItem("drivemaster:lastKnownUser")!)).toEqual(SAMPLE_USER);
  });

  it("opens the public home page and provides a working sign-in route", async () => {
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /Know who has paid/ }, { timeout: 5000 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /School sign in/ })[0]!);
    expect(await screen.findByLabelText(/phone number/i)).toBeInTheDocument();
    expect(window.location.hash).toBe("#login");
  });

  it("keeps financial navigation hidden for an instructor", async () => {
    localStorage.setItem(
      "drivemaster:lastKnownUser",
      JSON.stringify({ ...SAMPLE_USER, role: "INSTRUCTOR" })
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Hello, Ada Okafor." }, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.getByText("ADA OKAFOR DRIVING LESSONS")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Money" })).not.toBeInTheDocument();
    expect(screen.queryByText("Received today")).not.toBeInTheDocument();
  });

  it("gives a student the shared shell without exposing staff areas", async () => {
    localStorage.setItem(
      "drivemaster:lastKnownUser",
      JSON.stringify({ ...SAMPLE_USER, role: "STUDENT" })
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Hello, Ada Okafor." }, { timeout: 5000 })
    ).toBeVisible();
    expect(screen.getByText("ADA OKAFOR DRIVING LESSONS")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Load your lessons" })).toBeVisible();
    expect(screen.queryByText(/record permitted lesson details/)).toBeNull();
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getByRole("button", { name: "Home" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "Training" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Money" })).toBeNull();
  });

  it("shows the login form when there is no session and no cached identity", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({
        "/auth/me": () => ({ ok: false, status: 401, json: async () => ({}) })
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    });
  });

  it("shows the dashboard immediately when a cached identity exists (offline recognition)", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(SAMPLE_USER));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<App />);

    // No network round trip needed to show this — it's the whole point
    // of the optimistic cache.
    expect(screen.getByText(SAMPLE_USER.name)).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Hello, Ada Driving School." }, { timeout: 5000 })
    ).toBeInTheDocument();

    // Let the background fetchCurrentUser() settle (it resolves from the
    // local cache since the network call rejects) before the test ends,
    // wrapped in act() since it triggers a state update.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("shows the dashboard after a successful login", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({
        "/auth/me": () => ({ ok: false, status: 401, json: async () => ({}) }),
        "/auth/login": () => ({ ok: true, json: async () => ({ user: SAMPLE_USER }) }),
        "/students": () => ({ ok: true, json: async () => ({ students: [], total: 0 }) })
      })
    );

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText(SAMPLE_USER.name)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Hello, Ada Driving School." })
      ).toBeInTheDocument();
    });
  });

  it("logging out returns to the login form", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(SAMPLE_USER));
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({
        "/auth/me": () => ({ ok: true, status: 200, json: async () => ({ user: SAMPLE_USER }) }),
        "/auth/logout": () => ({ ok: true, json: async () => ({ success: true }) }),
        "/students": () => ({ ok: true, json: async () => ({ students: [], total: 0 }) })
      })
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText(SAMPLE_USER.name)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    });
  });
  it("locks privileged views on another tab's logout without revoking its cookie", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(SAMPLE_USER));
    const fetchMock = mockFetchByUrl({
      "/auth/me": () => ({ ok: true, json: async () => ({ user: SAMPLE_USER }) })
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByRole("button", { name: "Log out" });
    await act(async () => {
      localStorage.setItem("drivemaster:signedOut", "true");
      localStorage.removeItem("drivemaster:lastKnownUser");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "drivemaster:signedOut",
          newValue: "true",
          storageArea: localStorage
        })
      );
    });
    expect(await screen.findByLabelText(/phone number/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/auth/logout"))).toBe(
      false
    );
  });
  it("locks an old owner tab when another tab changes account", async () => {
    localStorage.setItem("drivemaster:lastKnownUser", JSON.stringify(SAMPLE_USER));
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({
        "/auth/me": () => ({ ok: true, json: async () => ({ user: SAMPLE_USER }) })
      })
    );
    render(<App />);
    await screen.findByRole("button", { name: "Log out" });
    await act(async () => {
      localStorage.setItem(
        "drivemaster:lastKnownUser",
        JSON.stringify({ ...SAMPLE_USER, id: "reception", role: "RECEPTIONIST" })
      );
      localStorage.setItem("drivemaster:authRevision", "another-login");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "drivemaster:authRevision",
          newValue: "another-login",
          storageArea: localStorage
        })
      );
    });
    expect(await screen.findByLabelText(/phone number/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("drivemaster:lastKnownUser")!).id).toBe("reception");
  });
});
