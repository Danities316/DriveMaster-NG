import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PasswordResetForm } from "./PasswordResetForm";
import { requestPasswordReset, resetPassword, AuthError } from "../lib/auth";
vi.mock("../lib/auth", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  AuthError: class extends Error {}
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requestPasswordReset).mockResolvedValue("reference");
});
async function requestCode() {
  fireEvent.change(screen.getByLabelText("Account phone number"), {
    target: { value: "08012345678" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
  await screen.findByLabelText("Reset code");
}
it("uses the same neutral message and returns to sign-in only after reset succeeds", async () => {
  vi.mocked(resetPassword).mockResolvedValue();
  const back = vi.fn();
  render(<PasswordResetForm onBack={back} />);
  await requestCode();
  expect(screen.getByRole("status")).toHaveTextContent("If an eligible account");
  expect(screen.getByRole("button", { name: /Send again in/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reset code"), { target: { value: "654 321" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword123" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "NewPassword123" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Your password was reset")
  );
  expect(resetPassword).toHaveBeenCalledWith("reference", "654321", "NewPassword123");
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(back).toHaveBeenCalled();
});
it("keeps the reset form after a rejected code and does not claim success", async () => {
  vi.mocked(resetPassword).mockRejectedValue(new AuthError("The reset code expired."));
  render(<PasswordResetForm onBack={vi.fn()} />);
  await requestCode();
  fireEvent.change(screen.getByLabelText("Reset code"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword123" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "NewPassword123" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.getByLabelText("Reset code")).toBeVisible();
});
it("does not submit mismatched passwords", async () => {
  render(<PasswordResetForm onBack={vi.fn()} />);
  await requestCode();
  fireEvent.change(screen.getByLabelText("Reset code"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword123" } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), {
    target: { value: "DifferentPassword123" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("do not match"));
  expect(resetPassword).not.toHaveBeenCalled();
});
