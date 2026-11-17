import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Notice } from "./Notice";

describe("design primitives", () => {
  it("uses 48px interactive targets and renders badge variants", () => {
    const onAction = vi.fn();
    render(
      <>
        <Button>Save</Button>
        <Notice actionLabel="Review" onAction={onAction}>
          Needs attention
        </Notice>
        <Badge variant="success">Complete</Badge>
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveStyle({
      minHeight: "48px",
    });
    const action = screen.getByRole("button", { name: "Review" });
    expect(action).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByText("Complete")).toHaveClass(
      "dm-badge",
      "dm-badge--success",
    );
  });
});
