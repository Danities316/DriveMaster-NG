import { useState, type FormEvent } from "react";
import type { StudentWithBalance } from "@drivemaster/shared";
import { isValidStoredMoney, isValidDate } from "@drivemaster/shared";
import { StudentApiError } from "./studentApi";
import { createStudentOffline, updateStudentOffline } from "./studentService";

interface StudentFormPageProps {
  schoolId: string;
  /** Present when editing an existing student; absent when creating a new one. */
  existingStudent?: StudentWithBalance;
  onSaved: (student: StudentWithBalance, queued: boolean) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  phone: string;
  licenseNumber: string;
  enrollmentDate: string;
  totalTuition: string;
}

function toFormState(student?: StudentWithBalance): FormState {
  return {
    name: student?.name ?? "",
    phone: student?.phone ?? "",
    licenseNumber: student?.licenseNumber ?? "",
    enrollmentDate: student?.enrollmentDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    totalTuition: student?.totalTuition ?? ""
  };
}

/**
 * One form for both create and edit — same fields, same order. Phone is
 * the second field (right after name, before anything else) and there is
 * no email field anywhere, matching this unit's "phone prominent, email
 * never mandatory" requirement. Kept to the minimum number of fields the
 * PRD's domain model actually defines for Student (§9): no extra
 * "nice to have" inputs.
 */
export function StudentFormPage({
  schoolId,
  existingStudent,
  onSaved,
  onCancel
}: StudentFormPageProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(existingStudent));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = existingStudent !== undefined;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Please enter the student's name.");
      return;
    }
    if (form.phone.trim().length < 7 || form.phone.trim().length > 20) {
      setError("Please enter a phone number.");
      return;
    }
    if (!isValidStoredMoney(form.totalTuition.trim())) {
      setError("Please enter a valid tuition amount, e.g. 150000 or 150000.00");
      return;
    }

    if (!isValidDate(form.enrollmentDate)) {
      setError("Please enter a valid enrollment date.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing) {
        const result = await updateStudentOffline(existingStudent.id, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          licenseNumber: form.licenseNumber.trim() || null,
          enrollmentDate: form.enrollmentDate,
          totalTuition: form.totalTuition.trim()
        });
        onSaved(result.student, result.queued);
      } else {
        const result = await createStudentOffline(
          {
            name: form.name.trim(),
            phone: form.phone.trim(),
            licenseNumber: form.licenseNumber.trim() || null,
            enrollmentDate: form.enrollmentDate,
            totalTuition: form.totalTuition.trim()
          },
          schoolId
        );
        onSaved(result.student, result.queued);
      }
    } catch (err) {
      setError(
        err instanceof StudentApiError
          ? err.message
          : "Something went wrong saving this student. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="student-page student-form-page">
      <div className="student-page-heading">
        <div>
          <p className="dm-eyebrow">STUDENT RECORD</p>
          <h1>{isEditing ? "Edit student" : "Add student"}</h1>
          <p>
            {isEditing
              ? "Update the student’s basic details and agreed fee."
              : "Keep the student’s contact and payment details together."}
          </p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="dm-panel student-form-card">
        <div className="flex flex-col gap-1">
          <label htmlFor="student-name" className="text-base font-medium text-slate-900">
            Full name
          </label>
          <input
            id="student-name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
            className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="student-phone" className="text-base font-medium text-slate-900">
            Phone number
          </label>
          <input
            id="student-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="e.g. 08012345678"
            required
            className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="student-license" className="text-base font-medium text-slate-900">
            License number <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="student-license"
            value={form.licenseNumber}
            onChange={(event) => updateField("licenseNumber", event.target.value)}
            className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="student-enrollment-date" className="text-base font-medium text-slate-900">
            Enrollment date
          </label>
          <input
            id="student-enrollment-date"
            type="date"
            value={form.enrollmentDate}
            onChange={(event) => updateField("enrollmentDate", event.target.value)}
            required
            className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="student-tuition" className="text-base font-medium text-slate-900">
            Total tuition (₦)
          </label>
          <input
            id="student-tuition"
            type="text"
            inputMode="decimal"
            value={form.totalTuition}
            onChange={(event) => updateField("totalTuition", event.target.value)}
            placeholder="e.g. 150000"
            required
            className="min-h-[48px] rounded-lg border border-slate-300 px-4 text-lg"
          />
        </div>

        {error ? (
          <p role="alert" className="text-base text-rose-600">
            {error}
          </p>
        ) : null}

        <div className="student-form-actions">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] flex-1 rounded-lg border border-slate-300 px-6 py-3 text-lg font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[48px] flex-1 rounded-lg bg-brand px-6 py-3 text-lg font-medium text-brand-ink transition hover:bg-brand-hover disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
