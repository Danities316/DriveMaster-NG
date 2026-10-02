import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_SCHOOL_RULES,
  type SchoolProfileResponse,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { ProfileSettings } from "./ProfileSettings";
import { SchoolRulesSettings } from "./SchoolRulesSettings";
import { trainingRequest } from "./trainingLocal";
vi.mock("./trainingLocal", () => ({ trainingRequest: vi.fn() }));
const response: SchoolProfileResponse = {
  school: {
    id: "school",
    name: "Test school",
    school_cac_rc: null,
    frsc_accreditation_number: null,
    profileVersion: 0
  },
  instructors: [
    {
      id: "instructor",
      name: "Mr Ade",
      nin: null,
      drivers_license_number: null,
      permitExpiryDate: null,
      profileVersion: 0
    }
  ]
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(trainingRequest).mockResolvedValue(response);
});
it("only loads private details on demand and sends validated identifiers to the online endpoint", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  render(<ProfileSettings onSaved={saved} />);
  expect(trainingRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("School and instructor details"));
  fireEvent.click(screen.getByRole("button", { name: "Load profiles" }));
  fireEvent.change(await screen.findByLabelText("Instructor to update"), {
    target: { value: "instructor" }
  });
  fireEvent.change(screen.getByLabelText("NIN (11 digits)"), { target: { value: "01234567890" } });
  fireEvent.change(screen.getByLabelText("Driver’s licence number"), {
    target: { value: "yen12801aa01" }
  });
  fireEvent.change(screen.getByLabelText("Reason for this instructor update"), {
    target: { value: "First entry" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save instructor details" }));
  await waitFor(() =>
    expect(trainingRequest).toHaveBeenCalledWith("profiles/instructor/instructor", {
      nin: "01234567890",
      drivers_license_number: "YEN12801AA01",
      permitExpiryDate: "",
      expectedVersion: 0,
      reason: "First entry"
    })
  );
  expect(await screen.findByText("Profile saved on the school server.")).toBeInTheDocument();
  await waitFor(() => expect(saved).toHaveBeenCalled());
});
it("keeps an invalid instructor NIN out of the server request", async () => {
  render(<ProfileSettings onSaved={async () => {}} />);
  fireEvent.click(screen.getByText("School and instructor details"));
  fireEvent.click(screen.getByRole("button", { name: "Load profiles" }));
  fireEvent.change(await screen.findByLabelText("Instructor to update"), {
    target: { value: "instructor" }
  });
  const nin = screen.getByLabelText("NIN (11 digits)");
  fireEvent.change(nin, { target: { value: "123" } });
  fireEvent.submit(nin.closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("exactly 11 digits");
  expect(trainingRequest).toHaveBeenCalledTimes(1);
});
const snapshot = {
  schoolId: "school",
  schoolRules: { id: "rules", version: 4, data: { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 20 } },
  enrollments: [
    {
      id: "enrollment",
      version: 3,
      data: {
        studentId: "student",
        rulesSnapshot: { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 30 }
      }
    }
  ],
  students: [{ id: "student", name: "Ada" }]
} as unknown as TrainingSnapshot;
it("warns about a lower school target and saves versioned rules without changing existing agreements", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SchoolRulesSettings snapshot={snapshot} pending={() => false} onSave={save} />);
  fireEvent.click(screen.getByText("School rules"));
  expect(screen.getByText(/below the recorded DSSP minimum/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("School target: separate training days"), {
    target: { value: "35" }
  });
  fireEvent.change(screen.getByLabelText("Reason for changing the rules"), {
    target: { value: "More practice" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save school rules" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "SCHOOL_RULES",
      "rules",
      { ...DEFAULT_SCHOOL_RULES, schoolTargetDays: 35, reason: "More practice" },
      4
    )
  );
  expect(snapshot.enrollments[0]?.data.rulesSnapshot?.schoolTargetDays).toBe(30);
});
it("requires an explicit student selection and reason to change an existing target", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SchoolRulesSettings snapshot={snapshot} pending={() => false} onSave={save} />);
  fireEvent.click(screen.getByText("School rules"));
  fireEvent.click(screen.getByText("Change one existing student’s target"));
  fireEvent.change(screen.getByLabelText("Student whose target will change"), {
    target: { value: "enrollment" }
  });
  fireEvent.change(screen.getByLabelText("New school target for this student"), {
    target: { value: "40" }
  });
  fireEvent.change(screen.getByLabelText("Reason for changing this student’s target"), {
    target: { value: "Agreed extra practice" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Update this student’s target" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "ENROLLMENT_RULES",
      "enrollment",
      { schoolTargetDays: 40, reason: "Agreed extra practice" },
      3
    )
  );
});
