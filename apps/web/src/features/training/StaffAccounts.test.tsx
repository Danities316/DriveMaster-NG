import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StaffAccounts } from "./StaffAccounts";
import { trainingRequest } from "./trainingLocal";
vi.mock("./trainingLocal", () => ({ trainingRequest: vi.fn() }));
const active = {
  id: "office",
  name: "Ada Office",
  phone: "08012345678",
  role: "RECEPTIONIST",
  isActive: true,
  version: 2
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
it("loads staff on demand and confirms a versioned access change with a reason", async () => {
  vi.mocked(trainingRequest)
    .mockResolvedValueOnce({ accounts: [active], hasMore: false })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({
      accounts: [{ ...active, isActive: false, version: 3 }],
      hasMore: false
    });
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<StaffAccounts onChanged={changed} />);
  expect(trainingRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Manage staff access"));
  fireEvent.click(screen.getByText("Load staff accounts"));
  fireEvent.click(await screen.findByText("Deactivate Ada Office"));
  fireEvent.change(screen.getByLabelText("Reason for changing access"), {
    target: { value: "Employee has left" }
  });
  fireEvent.click(screen.getByText("Confirm deactivation"));
  await screen.findByText(/Staff access updated/);
  expect(trainingRequest).toHaveBeenCalledWith("accounts/office/access", {
    isActive: false,
    expectedVersion: 2,
    reason: "Employee has left"
  });
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByText("Reactivate Ada Office")).toBeVisible();
});
it("shows a stale-edit error and reloads the account before another change", async () => {
  vi.mocked(trainingRequest)
    .mockResolvedValueOnce({ accounts: [active], hasMore: false })
    .mockRejectedValueOnce(
      new Error("This account changed. Reload staff accounts before changing access.")
    )
    .mockResolvedValueOnce({
      accounts: [{ ...active, isActive: false, version: 3 }],
      hasMore: false
    });
  render(<StaffAccounts onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Manage staff access"));
  fireEvent.click(screen.getByText("Load staff accounts"));
  fireEvent.click(await screen.findByText("Deactivate Ada Office"));
  fireEvent.change(screen.getByLabelText("Reason for changing access"), {
    target: { value: "Employee has left" }
  });
  fireEvent.click(screen.getByText("Confirm deactivation"));
  await screen.findByText(/This account changed/);
  fireEvent.click(screen.getByText("Reload staff accounts"));
  await screen.findByText("Reactivate Ada Office");
  expect(screen.queryByText("Confirm deactivation")).toBeNull();
});
it("keeps access changes online only", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  render(<StaffAccounts onChanged={vi.fn()} />);
  fireEvent.click(screen.getByText("Manage staff access"));
  fireEvent.click(screen.getByText("Load staff accounts"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Connect to the internet")
  );
  expect(trainingRequest).not.toHaveBeenCalled();
});
