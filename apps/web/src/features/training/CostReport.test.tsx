import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  trainingSummary,
  type TrainingExpense,
  type TrainingOuting,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { CostReport } from "./CostReport";

const enrollment = {
  studentId: "s",
  packageId: "p",
  name: "Beginner",
  sessions: 2,
  minutes: 30,
  price: "150000"
};
const expenses: TrainingExpense[] = [
  {
    category: "Books",
    date: "2026-01-01",
    amount: "3000",
    basis: "RECORDED",
    allocations: [{ studentId: "s", amount: "3000" }],
    reason: "Books supplied"
  },
  {
    category: "Materials",
    date: "2026-01-01",
    amount: "1000",
    basis: "ESTIMATE",
    allocations: [{ studentId: "s", amount: "1000" }],
    reason: "Expected materials"
  },
  {
    category: "Rent",
    date: "2026-01-01",
    amount: "50000",
    basis: "RECORDED",
    allocations: [],
    reason: "School rent"
  },
  {
    category: "Duplicate",
    date: "2026-01-01",
    amount: "9000",
    basis: "RECORDED",
    allocations: [{ studentId: "s", amount: "9000" }],
    reason: "Original",
    voidReason: "Entered twice"
  }
];
const outings = [
  {
    status: "COMPLETED",
    members: [
      {
        studentId: "s",
        status: "CONFIRMED",
        minutes: 30,
        fuelCost: "12000",
        instructorCost: "18000"
      }
    ]
  }
] as TrainingOuting[];
const summary = trainingSummary(
  enrollment,
  "Emeka Okon",
  "100000",
  outings,
  "1500",
  "500",
  expenses
);
const snapshot: TrainingSnapshot = {
  viewerRole: "OWNER",
  userId: "owner",
  schoolId: "school",
  packages: [],
  settings: null,
  salaries: [],
  outings: [],
  lessons: [],
  vehicles: [],
  instructors: [],
  students: [
    { id: "s", name: "Emeka Okon", totalTuition: "150000" },
    { id: "g", name: "Grace James", totalTuition: "150000" },
    { id: "a", name: "Ada", totalTuition: "150000" }
  ],
  enrollments: ["s", "g", "a"].map((id) => ({
    id: `e-${id}`,
    version: 0,
    data: { ...enrollment, studentId: id }
  })),
  summaries: [summary],
  expenses: expenses.map((data, i) => ({ id: `expense-${i}`, version: 2, data }))
};
function show(data = snapshot, save = vi.fn().mockResolvedValue(undefined)) {
  render(<CostReport snapshot={data} pending={() => false} onSave={save} />);
  return save;
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function enterExpense(basis = "RECORDED") {
  fireEvent.click(screen.getByText("Add expense", { selector: "summary" }));
  change("What was this expense for?", "Books");
  change("Description or reason", "Workbooks");
  change("Amount (₦)", "6000");
  change("Recorded cost or estimate?", basis);
}
it("shows the trusted student money and costs before calculation mechanics, without a table", () => {
  show();
  const card = screen.getByRole("article", { name: "Costs for Emeka Okon" });
  expect(card.querySelector("table")).toBeNull();
  const metric = (label: string, value: string) =>
    expect(within(card).getByText(label).parentElement).toHaveTextContent(value);
  metric("Agreed fee", "₦150,000.00");
  metric("Money received", "₦100,000.00");
  metric("Still to pay", "₦50,000.00");
  metric("Recorded costs so far", "₦33,000.00");
  metric("Estimated remaining costs", "₦3,000.00");
  metric("Expected money left", "₦114,000.00");
  expect(within(card).getByText("Fuel spent")).toBeVisible();
  fireEvent.click(within(card).getByText("View breakdown"));
  metric("Fuel spent", "₦12,000.00");
  metric("Instructor cost", "₦18,000.00");
  metric("Other recorded costs", "₦3,000.00");
  metric("Estimated remaining lessons", "₦2,000.00");
  metric("Other estimates", "₦1,000.00");
  fireEvent.click(within(card).getByText("See how this was calculated"));
  expect(within(card).getByText(/Money received does not change this calculation/)).toBeVisible();
  expect(within(card).getByText(/does not confirm that the salary has been paid/)).toBeVisible();
  expect(
    [...card.querySelectorAll("dt,h3,h4,.cost-expected span")].some((e) =>
      /profit|bank balance|cash balance/i.test(e.textContent ?? "")
    )
  ).toBe(false);
});
it("keeps zero expected money left visible while zero estimate categories stay in the breakdown", () => {
  show({
    ...snapshot,
    summaries: [
      {
        ...summary,
        expectedMargin: "0.00",
        estimatedRemainingCost: "0.00",
        otherEstimatedCost: "0.00",
        otherRecordedCost: "0.00"
      }
    ]
  });
  expect(screen.getByText("Expected money left").parentElement).toHaveTextContent("₦0.00");
  expect(screen.queryByText("Estimated remaining costs")).toBeNull();
  expect(screen.getByText("Other recorded costs")).not.toBeVisible();
  fireEvent.click(screen.getByText("View breakdown"));
  expect(screen.getByText("Other recorded costs").parentElement).toHaveTextContent("₦0.00");
});
it("never substitutes zero for missing cost information", () => {
  show({
    ...snapshot,
    summaries: [
      {
        ...summary,
        expectedMargin: undefined,
        estimatedRemainingCost: undefined,
        instructorCost: undefined,
        costSoFar: undefined
      }
    ]
  });
  expect(screen.getByText("Cost estimate is incomplete")).toBeVisible();
  expect(screen.getByText(/Check this month's instructor pay/)).toBeVisible();
  expect(screen.getByText("Recorded costs so far").parentElement).toHaveTextContent(
    "Not available"
  );
  fireEvent.click(screen.getByText("View breakdown"));
  expect(screen.getByText("Instructor cost").parentElement).toHaveTextContent("Not available");
});
it("keeps school-only and cancelled expenses out of student costs and preserves history", () => {
  show();
  expect(summary.costSoFar).toBe("33000.00");
  expect(summary.expectedMargin).toBe("114000.00");
  fireEvent.click(screen.getByText("Whole-school costs"));
  expect(screen.getByText(/Recorded costs:.*50,000/)).toBeVisible();
  fireEvent.click(screen.getByText("Expense history (4)"));
  expect(screen.getByText("Cancelled: Entered twice")).toBeVisible();
  expect(screen.getByText(/Duplicate.*9,000/)).toBeVisible();
});
it.each(["RECORDED", "ESTIMATE"])(
  "saves a %s expense for one student through the existing contract",
  async (basis) => {
    const save = show();
    enterExpense(basis);
    change("Who was this expense for?", "ONE");
    change("Student", "s");
    expect(screen.getByRole("status")).toHaveTextContent("Emeka Okon: ₦6,000.00");
    fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        "EXPENSE",
        expect.any(String),
        expect.objectContaining({
          amount: "6000",
          basis,
          studentIds: ["s"],
          allocationMode: "EQUAL"
        })
      )
    );
  }
);
it("previews equal sharing using the trusted split, including uneven kobo", async () => {
  const save = show();
  enterExpense();
  change("Who was this expense for?", "SEVERAL");
  for (const name of ["Emeka Okon", "Grace James", "Ada"])
    fireEvent.click(screen.getByLabelText(name));
  expect(screen.getByRole("status")).toHaveTextContent("₦2,000.00 each");
  change("Amount (₦)", "100");
  expect(screen.getByRole("status")).toHaveTextContent("Emeka Okon: ₦33.34");
  expect(screen.getByRole("status")).toHaveTextContent("Grace James: ₦33.33");
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "EXPENSE",
      expect.any(String),
      expect.objectContaining({
        amount: "100",
        studentIds: ["s", "g", "a"],
        allocationMode: "EQUAL"
      })
    )
  );
});
it("retains custom sharing behind More options and requires the exact total", async () => {
  const save = show();
  enterExpense();
  change("Who was this expense for?", "SEVERAL");
  fireEvent.click(screen.getByLabelText("Emeka Okon"));
  fireEvent.click(screen.getByLabelText("Grace James"));
  expect(screen.getByLabelText("How should the cost be shared?")).not.toBeVisible();
  fireEvent.click(screen.getByText("More options"));
  change("How should the cost be shared?", "CUSTOM");
  change("Emeka Okon: share (₦)", "2000");
  change("Grace James: share (₦)", "3000");
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The student shares must add up to ₦6,000.00"
  );
  expect(save).not.toHaveBeenCalled();
  change("Grace James: share (₦)", "4000");
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "EXPENSE",
      expect.any(String),
      expect.objectContaining({
        allocationMode: "CUSTOM",
        allocations: [
          { studentId: "s", amount: "2000" },
          { studentId: "g", amount: "4000" }
        ]
      })
    )
  );
});
it("clears student shares when switching to a whole-school expense", async () => {
  const save = show();
  enterExpense();
  change("Who was this expense for?", "ONE");
  change("Student", "s");
  change("Who was this expense for?", "SCHOOL");
  expect(screen.getByText(/will not reduce any student's expected money left/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "EXPENSE",
      expect.any(String),
      expect.objectContaining({ studentIds: [], allocationMode: "EQUAL" })
    )
  );
});
it("requires an explicit recipient and rejects a future recorded expense", async () => {
  const save = show();
  enterExpense();
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose who this expense was for");
  change("Who was this expense for?", "SCHOOL");
  change("Expense date", "2099-01-01");
  fireEvent.click(screen.getByRole("button", { name: "Save expense" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose Estimate for a future expense"
  );
  expect(save).not.toHaveBeenCalled();
});
it("cancels with a reason and version without deleting the original record", async () => {
  const save = show({ ...snapshot, expenses: [snapshot.expenses![0]!] });
  fireEvent.click(screen.getByText("Expense history (1)"));
  fireEvent.click(screen.getByText("Cancel expense", { selector: "summary" }));
  expect(screen.getByLabelText("Tell us why this record is being cancelled")).toBeRequired();
  change("Tell us why this record is being cancelled", "Wrong amount");
  fireEvent.click(screen.getByRole("button", { name: "Cancel expense" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith("VOID_EXPENSE", "expense-0", { reason: "Wrong amount" }, 2)
  );
  expect(screen.getByText(/Books.*3,000/)).toBeVisible();
});
it.each(["RECEPTIONIST", "INSTRUCTOR", "STUDENT"])(
  "does not expose costs even if a %s snapshot contains private data",
  (viewerRole) => {
    const { container } = render(
      <CostReport snapshot={{ ...snapshot, viewerRole }} pending={() => false} onSave={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  }
);
it("gives useful empty and stale-record states", () => {
  const { rerender } = render(
    <CostReport
      snapshot={{ ...snapshot, summaries: [], expenses: [] }}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText("No other expenses recorded")).toBeVisible();
  expect(screen.getByText("Add expense", { selector: "summary" })).toBeVisible();
  rerender(
    <CostReport
      snapshot={{ ...snapshot, expenses: undefined }}
      pending={() => false}
      onSave={vi.fn()}
    />
  );
  expect(screen.getByText(/Refresh training records/)).toBeVisible();
  expect(screen.queryByText("Expected money left")).toBeNull();
});
