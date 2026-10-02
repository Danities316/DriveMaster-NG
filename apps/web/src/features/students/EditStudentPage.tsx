import { useLiveQuery } from "dexie-react-hooks";
import type { StudentWithBalance } from "@drivemaster/shared";
import { getLocalStudent } from "./studentLocalStore";
import { StudentFormPage } from "./StudentFormPage";

interface EditStudentPageProps {
  studentId: string;
  schoolId: string;
  onSaved: (student: StudentWithBalance, queued: boolean) => void;
  onCancel: () => void;
}

/**
 * Loads the existing student from the local Dexie cache (offline-capable,
 * no network required) before handing off to the shared create/edit form
 * in edit mode. Kept as its own file, separate from StudentFormPage,
 * because the form itself is presentational — this is where the
 * "which student am I editing" data-fetching concern lives.
 */
export function EditStudentPage({ studentId, schoolId, onSaved, onCancel }: EditStudentPageProps) {
  const student = useLiveQuery(() => getLocalStudent(studentId), [studentId]);

  if (student === undefined) {
    return <p className="p-4 text-center text-slate-500">Loading...</p>;
  }

  if (student === null) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <p className="text-slate-600">This student could not be found on this device.</p>
        <button type="button" onClick={onCancel} className="text-brand-link underline">
          Back
        </button>
      </div>
    );
  }

  return (
    <StudentFormPage
      schoolId={schoolId}
      existingStudent={student}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}
