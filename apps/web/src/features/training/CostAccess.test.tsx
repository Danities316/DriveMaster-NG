import { beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthenticatedUser, TrainingSnapshot } from "@drivemaster/shared";
import { db } from "../../db/db";
import { TrainingPage } from "./TrainingPage";

beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
it.each(["OWNER", "RECEPTIONIST", "INSTRUCTOR", "STUDENT"] as const)(
  "keeps the costs tab owner-only for %s, including direct tab entry",
  async (role) => {
    const user: AuthenticatedUser = {
      id: "viewer",
      schoolId: "school",
      name: "Viewer",
      phone: "test",
      role
    };
    const snapshot: TrainingSnapshot = {
      viewerRole: role,
      userId: user.id,
      schoolId: user.schoolId,
      packages: [],
      settings: null,
      salaries: [],
      enrollments: [],
      expenses: [],
      outings: [],
      lessons: [],
      summaries: [],
      students: [],
      instructors: [],
      vehicles: []
    };
    await db.trainingCache.put({
      userId: user.id,
      schoolId: user.schoolId,
      snapshot,
      loadedAt: new Date().toISOString()
    });
    render(<TrainingPage user={user} initialTab="costs" />);
    if (role === "OWNER") {
      expect(await screen.findByRole("heading", { name: "Costs and expenses" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Costs and expenses" })).toBeVisible();
      expect(screen.getByText("Add expense", { selector: "summary" })).toBeVisible();
    } else {
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: "Costs and expenses" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Costs and expenses" })).toBeNull();
      expect(screen.queryByText("Add expense", { selector: "summary" })).toBeNull();
    }
  }
);
