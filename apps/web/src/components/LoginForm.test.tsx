import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./LoginForm";

const SAMPLE_USER = {
  id: "user-1",
  schoolId: "school-1",
  role: "OWNER" as const,
  name: "Ada Okafor",
  phone: "+2348012345678"
};

describe("LoginForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders phone and password fields with no email field anywhere", () => {
    render(<LoginForm onSuccess={() => {}} />);

    expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("uses a phone-friendly input type so mobile keyboards show the numeric/phone layout", () => {
    render(<LoginForm onSuccess={() => {}} />);

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).toHaveAttribute("type", "tel");
    expect(phoneInput).toHaveAttribute("inputMode", "tel");
  });

  it("calls onSuccess with the user after a successful login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: SAMPLE_USER }) })
    );

    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(SAMPLE_USER));
  });

  it("shows the server's exact plain-language error message on failed login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: "Phone number or password is incorrect." } })
      })
    );

    render(<LoginForm onSuccess={() => {}} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Phone number or password is incorrect.");
    });
  });

  it("shows a non-technical message when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));

    render(<LoginForm onSuccess={() => {}} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/check your connection/i);
    });
  });

  it("disables the submit button while a login request is in flight", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      )
    );

    render(<LoginForm onSuccess={() => {}} />);

    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "08012345678" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "correct-password" }
    });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(screen.getByRole("button")).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({ user: SAMPLE_USER }) });
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
  });
});
