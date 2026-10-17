import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OwnerVerificationForm } from "./OwnerVerificationForm";
import {
  confirmVerification,
  fetchVerificationStatus,
  resendVerification,
  AuthError
} from "../lib/auth";
import type { OwnerVerificationStatus } from "@drivemaster/shared";
vi.mock("../lib/auth", () => ({
  confirmVerification: vi.fn(),
  fetchVerificationStatus: vi.fn(),
  resendVerification: vi.fn(),
  AuthError: class extends Error {}
}));
const status: OwnerVerificationStatus = {
  verificationRequired: true,
  maskedPhone: "+234******5678",
  resendAt: null,
  expiresAt: null,
  delivery: "sent"
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchVerificationStatus).mockResolvedValue(status);
});
it("accepts a pasted code and opens the workspace only after server verification", async () => {
  const onSuccess = vi.fn();
  const user = {
    id: "owner",
    schoolId: "school",
    name: "Ada",
    phone: "+2348012345678",
    role: "OWNER" as const
  };
  vi.mocked(confirmVerification).mockResolvedValue(user);
  render(
    <OwnerVerificationForm initialStatus={status} onSuccess={onSuccess} onSignOut={vi.fn()} />
  );
  const input = screen.getByLabelText("Six-digit code");
  expect(input).toHaveAttribute("autocomplete", "one-time-code");
  fireEvent.change(input, { target: { value: "123 456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(user));
  expect(confirmVerification).toHaveBeenCalledWith("123456");
});
it("preserves code entries after server rejection and explains the failure", async () => {
  vi.mocked(confirmVerification).mockRejectedValue(new AuthError("The code is incorrect."));
  const onSuccess = vi.fn();
  render(
    <OwnerVerificationForm initialStatus={status} onSuccess={onSuccess} onSignOut={vi.fn()} />
  );
  fireEvent.change(screen.getByLabelText("Six-digit code"), { target: { value: "999999" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("incorrect");
  expect(screen.getByLabelText("Six-digit code")).toHaveValue("999999");
  expect(onSuccess).not.toHaveBeenCalled();
});
it("supports correcting a phone after delivery failure without repeating registration", async () => {
  const failed = { ...status, delivery: "failed" as const };
  vi.mocked(fetchVerificationStatus).mockResolvedValue(failed);
  vi.mocked(resendVerification).mockResolvedValue(status);
  render(<OwnerVerificationForm initialStatus={failed} onSuccess={vi.fn()} onSignOut={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("account is saved");
  fireEvent.click(screen.getByRole("button", { name: "Change number" }));
  fireEvent.change(screen.getByLabelText("Correct phone number"), {
    target: { value: "08098765432" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to this number" }));
  await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("08098765432"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("A six-digit code was sent")
  );
});
it("disables resend during the server cooldown", async () => {
  const cooling = { ...status, resendAt: new Date(Date.now() + 60000).toISOString() };
  vi.mocked(fetchVerificationStatus).mockResolvedValue(cooling);
  render(<OwnerVerificationForm initialStatus={cooling} onSuccess={vi.fn()} onSignOut={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Send again in/ })).toBeDisabled();
});

it("explains expiry and disables confirmation until a replacement code is sent", async () => {
  const expired = { ...status, expiresAt: new Date(Date.now() - 1000).toISOString() };
  vi.mocked(fetchVerificationStatus).mockResolvedValue(expired);
  render(<OwnerVerificationForm initialStatus={expired} onSuccess={vi.fn()} onSignOut={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("code expired");
  expect(screen.getByRole("button", { name: "Verify and continue" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send another code" })).toBeEnabled();
});
