import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, User } from "lucide-react";
import { queryLocalStudents } from "./studentLocalStore";
import { refreshStudentsFromServer } from "./studentService";

interface StudentListPageProps {
  schoolId: string;
  onSelectStudent: (id: string) => void;
  onAddStudent: () => void;
}

/**
 * Mobile-first list: one search box, one "Add student" button, tappable
 * rows. Always reads from Dexie via useLiveQuery — works immediately
 * offline, and re-renders automatically once refreshStudentsFromServer()
 * (fired once on mount, best-effort) updates the local cache.
 */
export function StudentListPage({ schoolId, onSelectStudent, onAddStudent }: StudentListPageProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    void refreshStudentsFromServer();
  }, []);

  const students = useLiveQuery(
    () => queryLocalStudents(schoolId, search || undefined),
    [schoolId, search]
  );

  return (
    <div className="student-page student-list-page">
      <div className="student-page-heading">
        <div>
          <p className="dm-eyebrow">STUDENT RECORDS</p>
          <h1>Students</h1>
          <p>Find a student, check what they owe, or add a new record.</p>
        </div>
        <button
          type="button"
          onClick={onAddStudent}
          aria-label="Add student"
          className="dm-primary"
        >
          <Plus size={20} aria-hidden="true" />
          Add student
        </button>
      </div>

      <div className="student-search">
        <Search
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          inputMode="search"
          placeholder="Search by name or phone"
          aria-label="Search students by name or phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-h-[48px] w-full rounded-lg border border-slate-300 pl-10 pr-4 text-base"
        />
      </div>

      {students === undefined ? (
        <p className="text-center text-slate-500">Loading...</p>
      ) : students.length === 0 ? (
        search ? (
          <p className="text-center text-slate-500">No students match your search.</p>
        ) : (
          <section className="student-empty" aria-labelledby="student-empty-title">
            <User size={28} aria-hidden="true" />
            <h2 id="student-empty-title">No students yet</h2>
            <p>
              Add your first student to start keeping their payments and training records together.
            </p>
            <button type="button" className="dm-primary" onClick={onAddStudent}>
              <Plus size={18} aria-hidden="true" /> Add student
            </button>
          </section>
        )
      ) : (
        <ul className="student-list-cards">
          {students.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => onSelectStudent(student.id)}
                className="student-list-row"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <User size={20} aria-hidden="true" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-base font-medium text-slate-900">{student.name}</span>
                  <span className="text-sm text-slate-500">{student.phone}</span>
                </span>
                <span className="student-list-balance">
                  <span className="text-sm text-slate-500">Balance</span>
                  <span
                    className={
                      student.balanceRemaining === "0.00"
                        ? "text-sm font-medium text-brand-link"
                        : "text-sm font-medium text-rose-600"
                    }
                  >
                    ₦{student.balanceRemaining}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
