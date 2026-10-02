import { ArrowRight, Car, RefreshCw, Settings } from "lucide-react";
import type { AuthenticatedUser } from "@drivemaster/shared";

export function MorePage({
  user,
  onSetup,
  onFleet,
  onSavedRecords
}: {
  user: AuthenticatedUser;
  onSetup: () => void;
  onFleet: () => void;
  onSavedRecords: () => void;
}) {
  if (user.role !== "OWNER" && user.role !== "RECEPTIONIST")
    return <p>You do not have access to school administration.</p>;
  const items = [
    {
      title: "School setup",
      description: "Packages, instructors, school rules and document details",
      icon: Settings,
      action: onSetup
    },
    {
      title: "Mileage & fuel",
      description: "Vehicle mileage, fuel purchases and consumption",
      icon: Car,
      action: onFleet
    },
    {
      title: "Saved records",
      description: "Work waiting to be sent or needing attention",
      icon: RefreshCw,
      action: onSavedRecords
    }
  ];
  return (
    <div className="dashboard-content more-page">
      <div className="dashboard-heading">
        <div>
          <p className="dm-eyebrow">SCHOOL TOOLS</p>
          <h1>More</h1>
          <p>Setup, vehicle records and saved work.</p>
        </div>
      </div>
      <section className="more-grid" aria-label="More school tools">
        {items.map(({ title, description, icon: Icon, action }) => (
          <button key={title} className="dm-panel more-card" onClick={action}>
            <span className="more-card-icon">
              <Icon size={22} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight size={18} />
          </button>
        ))}
      </section>
    </div>
  );
}
