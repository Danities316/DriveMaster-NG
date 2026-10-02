import type { TrainingSnapshot } from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

export type SetupArea = "profile" | "training" | "people" | "vehicles" | "registration" | "costs";

export function SchoolSetupHome({
  snapshot,
  owner,
  onOpen
}: {
  snapshot: TrainingSnapshot;
  owner: boolean;
  onOpen: (area: SetupArea) => void;
}) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  const payReady =
    snapshot.instructors.length > 0 &&
    snapshot.instructors.every((instructor) =>
      snapshot.salaries.some(
        (salary) => salary.data.instructorId === instructor.id && salary.data.month === month
      )
    );
  const areas = [
    {
      id: "profile",
      title: "School profile",
      description: "School registration and identity details",
      status: "Review your school details",
      ownerOnly: true
    },
    {
      id: "training",
      title: "Training",
      description: "Packages, lesson numbers and student package assignment",
      status: snapshot.packages.length
        ? `${snapshot.packages.length} training package${snapshot.packages.length === 1 ? "" : "s"} set up`
        : "Training package needed",
      attention: !snapshot.packages.length
    },
    {
      id: "people",
      title: "People",
      description: "Instructors, staff access and monthly instructor pay",
      status: !snapshot.instructors.length
        ? "Instructor needed"
        : payReady
          ? `${snapshot.instructors.length} instructor${snapshot.instructors.length === 1 ? "" : "s"} with pay set for this month`
          : "Monthly instructor pay needs attention",
      attention: !snapshot.instructors.length || !payReady,
      ownerOnly: true
    },
    {
      id: "vehicles",
      title: "Vehicles",
      description: "Training vehicles, insurance and roadworthiness dates",
      status: snapshot.vehicles.length
        ? `${snapshot.vehicles.length} vehicle${snapshot.vehicles.length === 1 ? "" : "s"} added`
        : "Training vehicle needed",
      attention: !snapshot.vehicles.length
    },
    {
      id: "registration",
      title: "Registration",
      description: "How new students register and when training can begin",
      status: "Review student registration settings",
      ownerOnly: true
    },
    {
      id: "costs",
      title: "Costs & rules",
      description: "Fuel money, school training target and document rules",
      status: `Fuel money: ${naira(snapshot.settings?.data.fuelPerStudent ?? "1500.00")} per attending student`,
      ownerOnly: true
    }
  ] satisfies Array<{
    id: SetupArea;
    title: string;
    description: string;
    status: string;
    attention?: boolean;
    ownerOnly?: boolean;
  }>;
  return (
    <section className="school-setup-home" aria-labelledby="school-setup-title">
      <div className="dm-panel training-panel">
        <h2 id="school-setup-title">School setup</h2>
        <p>Set up the people, vehicles and rules DriveMaster needs to run your school.</p>
      </div>
      <div className="school-setup-grid">
        {areas
          .filter((area) => owner || !area.ownerOnly)
          .map((area) => (
            <article className="dm-panel school-setup-card" key={area.id}>
              <h3>{area.title}</h3>
              <p>{area.description}</p>
              <strong>{area.attention ? `Needs attention: ${area.status}` : area.status}</strong>
              <button className="dm-secondary" type="button" onClick={() => onOpen(area.id)}>
                Open {area.title}
              </button>
            </article>
          ))}
      </div>
    </section>
  );
}
