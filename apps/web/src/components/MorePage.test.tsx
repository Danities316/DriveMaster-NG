import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MorePage } from "./MorePage";

const user = {
  id: "owner",
  schoolId: "school",
  role: "OWNER" as const,
  name: "Ada",
  phone: "0800"
};

it.each(["OWNER", "RECEPTIONIST"] as const)(
  "opens setup, mileage and saved records for %s through More",
  (role) => {
    const actions = { onSetup: vi.fn(), onFleet: vi.fn(), onSavedRecords: vi.fn() };
    render(<MorePage user={{ ...user, role }} {...actions} />);
    fireEvent.click(screen.getByRole("button", { name: /School setup/ }));
    fireEvent.click(screen.getByRole("button", { name: /Mileage & fuel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Saved records/ }));
    expect(actions.onSetup).toHaveBeenCalledOnce();
    expect(actions.onFleet).toHaveBeenCalledOnce();
    expect(actions.onSavedRecords).toHaveBeenCalledOnce();
  }
);

it.each(["INSTRUCTOR", "STUDENT"] as const)("does not expose More tools to %s", (role) => {
  render(
    <MorePage
      user={{ ...user, role }}
      onSetup={vi.fn()}
      onFleet={vi.fn()}
      onSavedRecords={vi.fn()}
    />
  );
  expect(screen.getByText(/do not have access/)).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});
