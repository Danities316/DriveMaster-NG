import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  AuthenticatedUser,
  StudentTrainingSummary,
  TrainingSnapshot
} from "@drivemaster/shared";
import { StudentProgressSummary } from "./StudentProgressSummary";
import { EligibilityCard } from "./EligibilityCard";
import { TrainingPage } from "./TrainingPage";
import { db } from "../../db/db";
const summary: StudentTrainingSummary = {
  studentId: "s",
  name: "Ada",
  packageName: "Basic",
  sessions: 15,
  confirmed: 8,
  awaiting: 2,
  disputed: 1,
  remaining: 4,
  booked: 2,
  fee: "150000",
  paid: "100000",
  balance: "50000",
  schoolTargetDays: 20,
  qualifyingDays: 6,
  schoolTargetMet: false,
  dsspMinimumMet: false
};
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
it("keeps completion, pending, disputes and entitlement distinct with accessible details", () => {
  render(<StudentProgressSummary summary={summary} />);
  expect(screen.getByText("8 of 15 lessons completed")).toBeVisible();
  expect(screen.getByText("1 lesson needs checking")).toBeVisible();
  expect(screen.getByText("2 lessons are waiting for student confirmation")).toBeVisible();
  expect(screen.getByText("Remaining lesson entitlement")).not.toBeVisible();
  fireEvent.click(screen.getByText("View lesson details"));
  expect(screen.getByText("Remaining lesson entitlement")).toBeVisible();
  expect(screen.getByText("4")).toBeVisible();
  expect(document.querySelector("table")).toBeNull();
});
it("shows distinct training days, school target and secondary DSSP reference", () => {
  render(
    <EligibilityCard
      summary={{ ...summary, qualifyingDays: 20, schoolTargetMet: true }}
      owner={false}
      pending={false}
      studentVersion={0}
      onSave={async () => {}}
    />
  );
  expect(screen.getByText("20 training days completed")).toBeVisible();
  expect(screen.getByText("School target: 20 days")).toBeVisible();
  expect(screen.getByText("DSSP reference: 26 training days")).toBeVisible();
  expect(screen.getByText("Training-day minimum not yet met")).toBeVisible();
  expect(screen.getByText(/does not issue a licence/)).toBeInTheDocument();
});
it("does not show missing training days as zero", () => {
  render(
    <EligibilityCard
      summary={{ ...summary, qualifyingDays: undefined }}
      owner={false}
      pending={false}
      studentVersion={0}
      onSave={async () => {}}
    />
  );
  expect(screen.getByText("Training-day progress unavailable")).toBeVisible();
  expect(screen.queryByText("0 training days completed")).not.toBeInTheDocument();
});
it.each(["OWNER", "RECEPTIONIST", "INSTRUCTOR", "STUDENT"] as const)(
  "preserves the %s progress permissions",
  async (role) => {
    const user: AuthenticatedUser = {
      id: "viewer",
      schoolId: "school",
      name: "Viewer",
      phone: "test",
      role
    };
    const snapshot: TrainingSnapshot = {
      userId: user.id,
      schoolId: user.schoolId,
      viewerRole: role,
      settings: null,
      salaries: [],
      packages: [],
      enrollments: [],
      outings: [],
      lessons: [],
      summaries:
        role === "INSTRUCTOR"
          ? []
          : [
              {
                ...summary,
                ...(role === "OWNER"
                  ? { fuelCost: "10", instructorCost: "20", costSoFar: "30" }
                  : {})
              }
            ],
      students:
        role === "STUDENT" || role === "INSTRUCTOR"
          ? []
          : [{ id: "s", name: "Ada", totalTuition: "150000" }],
      vehicles: [],
      instructors: []
    };
    await db.trainingCache.put({
      userId: user.id,
      schoolId: user.schoolId,
      snapshot,
      loadedAt: "2026-01-02"
    });
    render(<TrainingPage user={user} initialTab="students" />);
    if (role === "INSTRUCTOR") {
      await screen.findByText("No training booked today");
      expect(screen.queryByText("Agreed fee")).not.toBeInTheDocument();
      expect(screen.queryByText("8 of 15 lessons completed")).not.toBeInTheDocument();
    } else {
      expect(await screen.findByText("8 of 15 lessons completed")).toBeVisible();
      expect(screen.getByText("Still to pay")).toBeVisible();
      expect(screen.queryByText("View training costs") !== null).toBe(role === "OWNER");
      expect(screen.getByText("DSSP reference: 26 training days")).not.toBeVisible();
      fireEvent.click(screen.getByText("Training days and school target"));
      expect(screen.getByText("DSSP reference: 26 training days")).toBeVisible();
    }
  }
);
