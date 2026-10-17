import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_ENROLLMENT_SETTINGS,
  type PublicEnrollmentInfo,
  type TrainingSnapshot,
  type StudentTrainingSummary
} from "@drivemaster/shared";
import { PublicEnrollmentPage } from "./PublicEnrollmentPage";
import { EnrollmentSettings } from "./EnrollmentSettings";
import { EligibilityCard } from "./EligibilityCard";
import { registrationId } from "./registrationId";
import QRCode from "qrcode";
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,cXJjb2Rl") }
}));
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const info: PublicEnrollmentInfo = {
  school: { id: "school", name: "Ada Driving School", phone: "08012345678" },
  settings: {
    welcome: "Welcome",
    requiredFields: ["nin"],
    showBankTransfer: false,
    bankName: "",
    accountNumber: "",
    accountName: "",
    paymentInstructions: "",
    allowReceiptUpload: false
  },
  settingsVersion: 0,
  rulesVersion: -1,
  schoolTargetDays: 26,
  packages: [
    { id: "basic", version: 0, data: { name: "Basic", sessions: 26, minutes: 30, price: "50000" } }
  ]
};
const response = (data: unknown) => ({ ok: true, json: async () => data });
it("lets a student submit without login and safely retries the same registration after a lost response", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(info))
    .mockRejectedValueOnce(new Error("Connection lost. Try again."))
    .mockResolvedValueOnce(response({ received: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<PublicEnrollmentPage schoolId="school" />);
  expect(
    await screen.findByRole("heading", { name: "Start driving with Ada Driving School" })
  ).toBeInTheDocument();
  expect(screen.getByText("About 5 minutes")).toBeInTheDocument();
  expect(screen.getByText("Pay only after you register")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Bola" } });
  fireEvent.change(screen.getByLabelText("Surname *"), { target: { value: "Ade" } });
  fireEvent.change(screen.getByLabelText("Phone number *"), { target: { value: "08012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("NIN (11 digits) *"), {
    target: { value: "01234567890" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Choose your training package *"), {
    target: { value: "basic" }
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Submit my registration" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm");
  fireEvent.click(screen.getByRole("button", { name: "Submit my registration" }));
  expect(
    await screen.findByRole("heading", { name: "Your details have been received" })
  ).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(3);
  const first = JSON.parse(fetcher.mock.calls[1]![1].body),
    second = JSON.parse(fetcher.mock.calls[2]![1].body);
  expect(first).toEqual(second);
  expect(first.details.nin).toBe("01234567890");
  expect(fetcher.mock.calls[1]![1].credentials).toBe("omit");
  expect(screen.queryByLabelText("NIN (11 digits) *")).not.toBeInTheDocument();
});
it("explains a closed enrollment link without showing an unusable intake form", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "This enrollment link is not open." } })
    })
  );
  render(<PublicEnrollmentPage schoolId="closed" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("not accepting");
  expect(screen.queryByLabelText("First name *")).not.toBeInTheDocument();
});
it("shows the school's account after registration and keeps a transfer waiting for confirmation", async () => {
  const paymentInfo: PublicEnrollmentInfo = {
    ...info,
    settings: {
      ...info.settings,
      showBankTransfer: true,
      bankName: "Access Bank",
      accountNumber: "0123456789",
      accountName: "Ada Driving School Ltd",
      paymentInstructions: "Use the student's name.",
      allowReceiptUpload: true
    }
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(paymentInfo))
    .mockResolvedValueOnce(response({ received: true }))
    .mockResolvedValueOnce(response({ received: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<PublicEnrollmentPage schoolId="school" />);
  await screen.findByRole("heading", { name: /Start driving with/ });
  fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Bola" } });
  fireEvent.change(screen.getByLabelText("Surname *"), { target: { value: "Ade" } });
  fireEvent.change(screen.getByLabelText("Phone number *"), { target: { value: "08012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("NIN (11 digits) *"), {
    target: { value: "01234567890" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Choose your training package *"), {
    target: { value: "basic" }
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Submit my registration" }));
  expect(await screen.findByText("0123456789")).toBeVisible();
  fireEvent.click(screen.getByText("I have made payment"));
  fireEvent.change(screen.getByLabelText(/Amount transferred/), { target: { value: "25000" } });
  fireEvent.change(screen.getByLabelText("Transfer date"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText(/Name on the sender/), { target: { value: "Bola Ade" } });
  fireEvent.click(screen.getByRole("button", { name: "Send payment details" }));
  expect(await screen.findByText("Payment details sent")).toBeVisible();
  expect(screen.getByText(/waiting for confirmation/)).toBeVisible();
  const claim = JSON.parse(fetcher.mock.calls[2]![1].body);
  expect(claim).toMatchObject({ amount: "25000", senderName: "Bola Ade" });
});
it("generates a downloadable school-specific QR locally and warns about localhost", async () => {
  vi.mocked(QRCode.toDataURL).mockImplementation(() =>
    Promise.resolve("data:image/png;base64,cXJjb2Rl")
  );
  const snapshot = {
    schoolId: "school",
    packages: info.packages,
    enrollmentSettings: {
      id: "settings",
      version: 2,
      data: { ...DEFAULT_ENROLLMENT_SETTINGS, enabled: true, packageIds: ["basic"] }
    }
  } as unknown as TrainingSnapshot;
  render(<EnrollmentSettings snapshot={snapshot} pending={() => false} onSave={async () => {}} />);
  fireEvent.click(screen.getByText("QR enrollment: let students register themselves"));
  fireEvent.change(screen.getByLabelText("App address students can open"), {
    target: { value: "http://localhost:5173" }
  });
  expect(screen.getByText(/works only on this computer/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("App address students can open"), {
    target: { value: "https://school.example" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Create QR code" }));
  await waitFor(() =>
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      "https://school.example/#enroll/school",
      expect.objectContaining({ margin: 4 })
    )
  );
  expect(
    await screen.findByRole("link", { name: "Download QR code for printing" })
  ).toHaveAttribute("download");
});
it("does not confuse a lower school target with DSSP eligibility", () => {
  const summary = {
    schoolTargetDays: 20,
    qualifyingDays: 20,
    schoolTargetMet: true,
    dsspMinimumMet: false
  } as StudentTrainingSummary;
  render(
    <EligibilityCard
      summary={summary}
      owner={false}
      pending={false}
      studentVersion={0}
      onSave={async () => {}}
    />
  );
  expect(screen.getByText("School target met")).toBeInTheDocument();
  expect(screen.getByText("Training-day minimum not yet met")).toBeInTheDocument();
});
it("creates unique UUIDs without relying on secure-context randomUUID", () => {
  const first = registrationId(),
    second = registrationId();
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(first).not.toBe(second);
});

it("resumes a received registration after reload without storing applicant details", async () => {
  const access = { id: registrationId(), token: "a".repeat(64), paymentId: registrationId() };
  localStorage.setItem("drivemaster:enrollmentResume:school", JSON.stringify(access));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        received: true,
        reference: access.id,
        status: "PENDING_PAYMENT",
        paymentReport: null
      })
    )
    .mockResolvedValueOnce(
      response({ ...info, settings: { ...info.settings, showBankTransfer: true } })
    )
    .mockResolvedValueOnce(response({ received: true }));
  vi.stubGlobal("fetch", fetcher);
  render(<PublicEnrollmentPage schoolId="school" />);
  await screen.findByRole("heading", { name: "Your details have been received" });
  expect(screen.queryByLabelText("First name *")).toBeNull();
  expect(fetcher.mock.calls[0]![1].headers["X-Enrollment-Token"]).toBe(access.token);
  fireEvent.click(screen.getByText("I have made payment"));
  fireEvent.change(screen.getByLabelText(/Amount transferred/), { target: { value: "25000" } });
  fireEvent.change(screen.getByLabelText("Transfer date"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText(/Name on the sender/), { target: { value: "Bola Ade" } });
  fireEvent.click(screen.getByRole("button", { name: "Send payment details" }));
  await screen.findByText("Payment details sent");
  expect(JSON.parse(fetcher.mock.calls[2]![1].body).id).toBe(access.paymentId);
  expect(JSON.parse(localStorage.getItem("drivemaster:enrollmentResume:school")!)).toEqual(access);
});
it("checks an uncertain report after remount and displays its confirmed status without resubmitting", async () => {
  const access = { id: registrationId(), token: "b".repeat(64), paymentId: registrationId() };
  localStorage.setItem("drivemaster:enrollmentResume:school", JSON.stringify(access));
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        received: true,
        reference: access.id,
        status: "ACTIVE",
        paymentReport: { id: access.paymentId, status: "CONFIRMED" }
      })
    )
    .mockResolvedValueOnce(response(info));
  vi.stubGlobal("fetch", fetcher);
  render(<PublicEnrollmentPage schoolId="school" />);
  await screen.findByText("The school confirmed this payment report.");
  expect(screen.queryByText("Send payment details")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText("Clear this registration from this device"));
  expect(localStorage.getItem("drivemaster:enrollmentResume:school")).toBeNull();
  expect(await screen.findByLabelText("First name *")).toBeVisible();
});
it("does not expose a new intake form when saved access is rejected", async () => {
  localStorage.setItem(
    "drivemaster:enrollmentResume:school",
    JSON.stringify({ id: registrationId(), token: "c".repeat(64), paymentId: registrationId() })
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: "Registration access expired. Contact the school." }
        })
      })
  );
  render(<PublicEnrollmentPage schoolId="school" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(screen.queryByLabelText("First name *")).toBeNull();
});
