import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { App } from "./App";

const SAMPLE_USER = {
  id: "user-1",
  schoolId: "school-1",
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
    window.history.replaceState(null, "", "#login");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("offers a simple public school-owner registration route", async () => {
    window.history.replaceState(null, "", "#register");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Create your school account." })).toBeVisible();
    expect(screen.getByLabelText("Your full name")).toBeVisible();
    expect(screen.getByLabelText("Driving school name")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create my school account" })).toBeVisible();
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
      await screen.findByRole("heading", { name: "Today's training" }, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Money" })).not.toBeInTheDocument();
    expect(screen.queryByText("Received today")).not.toBeInTheDocument();
  });

  it("keeps the staff navigation hidden from a student", async () => {
    localStorage.setItem(
      "drivemaster:lastKnownUser",
      JSON.stringify({ ...SAMPLE_USER, role: "STUDENT" })
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "My lessons" }, { timeout: 5000 })
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Load your lessons" })).toBeVisible();
    expect(screen.queryByText(/record permitted lesson details/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
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
      await screen.findByRole("heading", { name: /Hello, Ada/i }, { timeout: 5000 })
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
      expect(screen.getByRole("heading", { name: /Hello, Ada/i })).toBeInTheDocument();
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
});
