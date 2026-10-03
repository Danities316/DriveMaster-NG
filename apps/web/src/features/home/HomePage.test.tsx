import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

describe("home page", () => {
  it("demonstrates a pending payment without making a network request", () => {
    const fetchMock = vi.spyOn(window, "fetch");
    render(<HomePage onSignIn={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Record a payment/ }));
    const example = within(screen.getByRole("tabpanel"));
    expect(example.getByText("₦75,000.00")).toBeInTheDocument();
    fireEvent.click(example.getByRole("button", { name: /Try recording/ }));
    expect(example.getByText("₦65,000.00")).toBeInTheDocument();
    expect(example.getByText(/waiting to be sent to your school/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
  it("supports keyboard workflow navigation and a real sign-in action", () => {
    const signIn = vi.fn();
    render(<HomePage onSignIn={signIn} />);
    const first = screen.getByRole("tab", { name: /Find your student/ });
    fireEvent.keyDown(first, { key: "End" });
    expect(screen.getByRole("tab", { name: /Check if it was sent/ })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /Check if it was sent/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    fireEvent.click(
      within(screen.getByRole("tabpanel")).getByRole("button", { name: /School sign in/ })
    );
    expect(signIn).toHaveBeenCalledOnce();
  });
  it("opens and closes mobile navigation and discloses current product scope", () => {
    render(<HomePage onSignIn={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    fireEvent.click(screen.getByRole("link", { name: "FAQs" }));
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(
      screen.getByText(/create your school account and follow the setup guide/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/sample names and figures/)).toBeInTheDocument();
  });
  it("provides a clear Super Admin sign-in route", () => {
    render(<HomePage onSignIn={() => {}} />);
    expect(screen.getByRole("link", { name: "Super Admin sign in" })).toHaveAttribute(
      "href",
      "#platform-admin"
    );
  });
});
