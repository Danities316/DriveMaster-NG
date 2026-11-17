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
      id: "people",
      title: "People",
      description: "Add an instructor before setting pay or staff access.",
      ready: snapshot.instructors.length > 0 && payReady,
      needed: !snapshot.instructors.length
        ? "Add your first instructor"
        : "Set monthly instructor pay",
      required: true,
      ownerOnly: true
    },
    {
      id: "vehicles",
      title: "Vehicles",
      description: "Add a vehicle for lessons and record its document dates.",
      ready: snapshot.vehicles.length > 0,
      needed: "Add a training vehicle",
      required: true
    },
    {
      id: "training",
      title: "Training",
      description: "Create a package and assign one to your first student.",
      ready: snapshot.packages.length > 0 && snapshot.enrollments.length > 0,
      needed: !snapshot.packages.length ? "Create a training package" : "Assign a student package",
      required: true
    },
    {
      id: "profile",
      title: "School profile",
      description: "School registration and identity details.",
      ready: false,
      needed: "Review your school details",
      required: false,
      ownerOnly: true
    },
    {
      id: "registration",
      title: "Registration",
      description: "How new students register and when training can begin.",
      ready: false,
      needed: "Review student registration settings",
      required: false,
      ownerOnly: true
    },
    {
      id: "costs",
      title: "Costs & rules",
      description: "Fuel money, school training target and document rules.",
      ready: false,
      needed: `Fuel money: ${naira(snapshot.settings?.data.fuelPerStudent ?? "1500.00")} per attending student`,
      required: false,
      ownerOnly: true
    }
  ] satisfies Array<{
    id: SetupArea;
    title: string;
    description: string;
    ready: boolean;
    needed: string;
    required: boolean;
    ownerOnly?: boolean;
  }>;
  const visibleAreas = areas.filter((area) => owner || !area.ownerOnly);
  const nextArea = visibleAreas.find((area) => area.required && !area.ready);
  const readyToTrain = areas.filter((area) => area.required).every((area) => area.ready);
  const otherAreas = visibleAreas.filter((area) => area !== nextArea);
  const statusLabel = (area: (typeof areas)[number]) =>
    area.required ? (area.ready ? "Ready to train" : "Needs setup") : "Complete later";
  const card = (area: (typeof areas)[number]) => (
    <article className="dm-panel school-setup-card" key={area.id}>
      <span
        className={`readiness-label ${
          area.required
            ? area.ready
              ? "readiness-ready"
              : "readiness-needs-setup"
            : "readiness-later"
        }`}
      >
        {statusLabel(area)}
      </span>
      <h3>{area.title}</h3>
      <p>{area.description}</p>
      <strong>{area.required && area.ready ? "Set up" : area.needed}</strong>
      <button
        className={area === nextArea ? "dm-primary" : "dm-secondary"}
        type="button"
        onClick={() => onOpen(area.id)}
      >
        Open {area.title}
      </button>
    </article>
  );
  return (
    <section className="school-setup-home" aria-labelledby="school-setup-title">
      <div className="dm-panel training-panel school-setup-intro">
        <p className="dm-eyebrow">YOUR NEXT STEP</p>
        <h2 id="school-setup-title">School setup</h2>
        <strong
          className={`readiness-label ${readyToTrain ? "readiness-ready" : "readiness-needs-setup"}`}
        >
          {readyToTrain ? "Ready to train" : "Needs setup"}
        </strong>
        <p>
          {nextArea
            ? "Start with the one setup item that moves your school closer to its first lesson."
            : "Your essential setup is in place. You can book a training lesson now."}
        </p>
      </div>
      {nextArea && <div className="school-setup-grid">{card(nextArea)}</div>}
      {!!otherAreas.length && (
        <details className="school-setup-more">
          <summary>
            Other setup areas ({otherAreas.length})
            {!readyToTrain && <span> · Complete required setup before booking</span>}
          </summary>
          <div className="school-setup-grid">{otherAreas.map(card)}</div>
        </details>
      )}
    </section>
  );
}
