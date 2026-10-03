import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformAdminPage } from "./PlatformAdminPage";

const overview = {
  totals: { schools: 2, activeSchools: 1, trialSchools: 1, students: 24, sessions: 83 },
  schools: [
    {
      id: "one",
      name: "Ada Driving School",
      phone: "+2348012345678",
      status: "ACTIVE",
      trialEndsAt: null,
      createdAt: "2026-09-20T10:00:00Z",
      _count: { users: 3, students: 20 }
    },
    {
      id: "two",
      name: "Bola Motors",
      phone: "+2348098765432",
      status: "TRIAL",
      trialEndsAt: "2099-10-08T10:00:00Z",
      createdAt: "2026-10-01T10:00:00Z",
      _count: { users: 1, students: 4 }
    }
  ],
  recentActivity: [
    { id: "a", action: "SCHOOL_REGISTERED", schoolId: "two", timestamp: "2026-10-01T10:00:00Z" }
  ]
};

afterEach(() => vi.unstubAllGlobals());

it("uses an owner-style dashboard and navigates to searchable school management", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => overview })
  );
  render(<PlatformAdminPage />);
  expect(await screen.findByRole("heading", { name: "Hello, Super Admin." })).toBeVisible();
  expect(screen.getByText("Registered schools")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Schools/ }));
  expect(screen.getByRole("heading", { name: "Schools" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Search schools"), { target: { value: "Ada" } });
  expect(screen.getByText("Ada Driving School")).toBeVisible();
  expect(screen.queryByText("Bola Motors")).toBeNull();
});

it("changes school access only with a reason and refreshes the dashboard", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => overview })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ school: { id: "one", status: "SUSPENDED" } })
    })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => overview });
  vi.stubGlobal("fetch", fetchMock);
  render(<PlatformAdminPage />);
  await screen.findByRole("heading", { name: "Hello, Super Admin." });
  fireEvent.click(screen.getByRole("button", { name: /Schools/ }));
  fireEvent.click(screen.getAllByText("Manage school access")[0]!);
  fireEvent.change(screen.getAllByLabelText("Account status")[0]!, {
    target: { value: "SUSPENDED" }
  });
  fireEvent.change(screen.getAllByLabelText("Reason for this change")[0]!, {
    target: { value: "Account review required" }
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Save status" })[0]!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(fetchMock.mock.calls[1]?.[0]).toContain("/platform/schools/one/status");
});
