import { useState } from "react";
import {
  isValidStoredMoney,
  lagosDay,
  moneyCents,
  splitTrainingMoney,
  sumMoney,
  type TrainingSnapshot
} from "@drivemaster/shared";
import { EntryForm, Field } from "./TrainingFields";
import { naira } from "../dashboard/dashboardData";

export function ExpenseForm({
  snapshot,
  onSave
}: {
  snapshot: TrainingSnapshot;
  onSave: (action: string, target: string, data: unknown, version?: number) => Promise<void>;
}) {
  const [audience, setAudience] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState("EQUAL");
  const [amount, setAmount] = useState("");
  const [formKey, setFormKey] = useState(0);
  const ids = [...new Set(snapshot.enrollments.map((e) => e.data.studentId))];
  const name = (id: string) => snapshot.students.find((s) => s.id === id)?.name ?? "Student";
  const shares =
    mode === "EQUAL" && selected.length && isValidStoredMoney(amount, true)
      ? splitTrainingMoney(amount, selected.length)
      : [];
  return (
    <div className="expense-entry">
      <EntryForm
        key={formKey}
        title="Save expense"
        onSave={async (f) => {
          const value = String(f.get("amount") ?? "");
          if (!isValidStoredMoney(value, true))
            throw new Error(
              "Enter an amount greater than ₦0, with no more than two decimal places."
            );
          if (!audience || (audience !== "SCHOOL" && !selected.length))
            throw new Error("Choose who this expense was for.");
          if (audience === "SEVERAL" && selected.length < 2)
            throw new Error("Choose at least two students, or choose One student.");
          if (
            f.get("basis") === "RECORDED" &&
            String(f.get("date")) > lagosDay(new Date().toISOString())
          )
            throw new Error("Choose Estimate for a future expense.");
          if (mode === "CUSTOM") {
            const values = selected.map((id) => String(f.get(`share-${id}`) ?? ""));
            if (
              values.some((v) => !isValidStoredMoney(v)) ||
              moneyCents(sumMoney(values)) !== moneyCents(value)
            )
              throw new Error(`The student shares must add up to ${naira(value)}.`);
          }
          await onSave("EXPENSE", crypto.randomUUID(), {
            category: String(f.get("category") ?? ""),
            date: String(f.get("date") ?? ""),
            amount: value,
            basis: String(f.get("basis")),
            studentIds: selected,
            allocationMode: mode,
            ...(mode === "CUSTOM"
              ? {
                  allocations: selected.map((studentId) => ({
                    studentId,
                    amount: String(f.get(`share-${studentId}`) ?? "")
                  }))
                }
              : {}),
            reason: String(f.get("reason") ?? "")
          });
          setSelected([]);
          setMode("EQUAL");
          setAudience("");
          setAmount("");
          setFormKey((old) => old + 1);
        }}
      >
        <Field label="What was this expense for?" name="category" />
        <Field label="Description or reason" name="reason" />
        <label>
          Amount (₦)
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Recorded cost or estimate?
          <select name="basis">
            <option value="RECORDED">Recorded cost</option>
            <option value="ESTIMATE">Estimate</option>
          </select>
        </label>
        <p>Recorded cost: money already spent or recorded. Estimate: a cost you expect later.</p>
        <Field
          label="Expense date"
          name="date"
          type="date"
          initial={lagosDay(new Date().toISOString())}
        />
        <label>
          Who was this expense for?
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value);
              setSelected([]);
              setMode("EQUAL");
            }}
          >
            <option value="">Choose</option>
            <option value="SCHOOL">The whole school</option>
            <option value="ONE">One student</option>
            <option value="SEVERAL">Several students</option>
          </select>
        </label>
        {audience === "SCHOOL" && (
          <p>
            This stays as a whole-school expense. It will not reduce any student's expected money
            left.
          </p>
        )}
        {audience === "ONE" && (
          <label>
            Student
            <select
              value={selected[0] ?? ""}
              onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}
            >
              <option value="">Choose a student</option>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {audience === "SEVERAL" && (
          <fieldset>
            <legend>Choose students</legend>
            {ids.map((id) => (
              <label className="training-check" key={id}>
                <input
                  type="checkbox"
                  checked={selected.includes(id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, id] : old.filter((s) => s !== id)
                    )
                  }
                />
                {name(id)}
              </label>
            ))}
          </fieldset>
        )}
        {audience === "ONE" && selected.length === 1 && isValidStoredMoney(amount, true) && (
          <p role="status">
            {name(selected[0]!)}: {naira(amount)}.
          </p>
        )}
        {audience === "SEVERAL" && shares.length > 0 && (
          <div className="expense-sharing" role="status">
            <p>
              {naira(amount)} shared equally between {selected.length} students.
            </p>
            {shares.every((s) => s === shares[0]) ? (
              <p>{naira(shares[0]!)} each.</p>
            ) : (
              <ul>
                {selected.map((id, i) => (
                  <li key={id}>
                    {name(id)}: {naira(shares[i]!)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(audience === "ONE" || audience === "SEVERAL") && (
          <details>
            <summary>More options</summary>
            <label>
              How should the cost be shared?
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="EQUAL">Share equally</option>
                <option value="CUSTOM">Enter each student's amount</option>
              </select>
            </label>
          </details>
        )}
        {mode === "CUSTOM" && (
          <fieldset>
            <legend>Student shares</legend>
            <p>
              These amounts must add up to{" "}
              {isValidStoredMoney(amount) ? naira(amount) : "the expense amount"}.
            </p>
            {selected.map((id) => (
              <label key={id}>
                {name(id)}: share (₦)
                <input
                  name={`share-${id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="9999999999.99"
                  step="0.01"
                  required
                />
              </label>
            ))}
          </fieldset>
        )}
      </EntryForm>
    </div>
  );
}
