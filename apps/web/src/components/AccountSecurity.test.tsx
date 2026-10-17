import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountSecurity } from "./AccountSecurity";
import { changePassword, signOutEverywhere, AuthError } from "../lib/auth";
vi.mock("../lib/auth", () => ({
  changePassword: vi.fn(),
  signOutEverywhere: vi.fn(),
  AuthError: class extends Error {}
}));
beforeEach(() => vi.resetAllMocks());
it("changes a password then signs out without clearing queued records", async () => {
  vi.mocked(changePassword).mockResolvedValue();
  const done = vi.fn();
  render(<AccountSecurity onSignedOut={done} />);
  expect(screen.getByText(/Saved work stays/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "OldPassword123" }
  });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword123" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "NewPassword123" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password and sign out" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(changePassword).toHaveBeenCalledWith("OldPassword123", "NewPassword123");
});
it("waits for the server before signing out all devices and retains failure feedback", async () => {
  vi.mocked(signOutEverywhere).mockRejectedValue(new AuthError("Try again later."));
  const done = vi.fn();
  render(<AccountSecurity onSignedOut={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again later");
  expect(done).not.toHaveBeenCalled();
});
