import {
  assessFuelConsumption,
  isValidStoredMoney,
  sumMoney,
  type FuelLog,
  type FuelConsumptionInterval,
  type Vehicle
} from "@drivemaster/shared";
import { naira } from "../dashboard/dashboardData";

export function FuelUsageCards({
  vehicles,
  cycles,
  flaggedOnly,
  fuel,
  unconfirmedIds
}: {
  vehicles: Vehicle[];
  cycles: FuelConsumptionInterval[];
  flaggedOnly: boolean;
  fuel: FuelLog[];
  unconfirmedIds: ReadonlySet<string>;
}) {
  const identities = [
    ...vehicles,
    ...[...new Set(cycles.map((c) => c.vehicleId))]
      .filter((id) => !vehicles.some((v) => v.id === id))
      .map((id) => ({
        id,
        model: "Vehicle details unavailable",
        plateNumber: "Unknown vehicle",
        fuelBenchmark: undefined
      }))
  ];
  const groups = identities.map((vehicle) => ({
    vehicle,
    rows: cycles
      .filter((c) => c.vehicleId === vehicle.id)
      .map((cycle) => ({
        ...cycle,
        assessment: assessFuelConsumption(cycle, vehicle.fuelBenchmark)
      }))
  }));
  groups.sort(
    (a, b) =>
      Number(b.rows.some((r) => r.assessment.status === "above_limit")) -
      Number(a.rows.some((r) => r.assessment.status === "above_limit"))
  );
  const visible = flaggedOnly
    ? groups.filter((g) => g.rows.some((r) => r.assessment.status === "above_limit"))
    : groups;
  return (
    <div className="fuel-usage-cards">
      {!visible.length && (
        <p>
          {flaggedOnly
            ? "No completed records show fuel usage above the saved limit."
            : "No mileage or fuel records yet"}
        </p>
      )}
      {visible.map(({ vehicle, rows }) => (
        <article
          className="fuel-usage-vehicle"
          key={vehicle.id}
          aria-label={`Fuel usage for ${vehicle.plateNumber}`}
        >
          <h3>
            {vehicle.model} · {vehicle.plateNumber}
          </h3>
          {!rows.length && (
            <>
              <strong>Not enough information yet</strong>
              <p>
                Record two full-tank fills at different mileage readings and every purchase between
                them. Records must be sent and free of issues before fuel usage can be calculated.
              </p>
            </>
          )}
          {rows
            .filter((r) => !flaggedOnly || r.assessment.status === "above_limit")
            .map((r, index) => (
              <section
                key={r.endId}
                className={`fuel-usage-cycle ${r.assessment.status === "above_limit" ? "fuel-usage-attention" : ""}`}
                aria-label={`Fuel usage ending ${r.endDate}`}
              >
                <p>
                  {index === 0 && !flaggedOnly ? "Latest completed period · " : ""}
                  {new Date(r.startDate).toLocaleDateString("en-NG", {
                    timeZone: "Africa/Lagos"
                  })}{" "}
                  – {new Date(r.endDate).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" })}
                </p>
                <h4>
                  {
                    {
                      above_limit: "Fuel usage is higher than expected",
                      within_limit: "Fuel usage looks normal",
                      below_range: "Fuel usage is lower than expected",
                      not_configured: "Not enough information yet"
                    }[r.assessment.status]
                  }
                </h4>
                {r.assessment.status === "not_configured" && (
                  <p>
                    Consumption can be calculated, but a fuel limit has not been set. The owner can
                    select this vehicle and set its expected fuel use.
                  </p>
                )}
                {r.assessment.status === "above_limit" && (
                  <p>
                    Check mileage, purchases and driving conditions. This reading does not establish
                    why fuel use is high.
                  </p>
                )}
                {r.assessment.status === "below_range" && (
                  <p>
                    Check that every purchase was recorded and the saved fuel limit suits this
                    vehicle.
                  </p>
                )}
                <dl className="fuel-practical-values">
                  <div>
                    <dt>Distance recorded</dt>
                    <dd>{r.distanceKm.toLocaleString()} km</dd>
                  </div>
                  <div>
                    <dt>Fuel spent in this period</dt>
                    <dd>{naira(r.refillCost)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>See calculation</summary>
                  <p>
                    Fuel counted: {r.litres} L · {r.fillCount} refill(s).
                  </p>
                  <dl className="fuel-practical-values">
                    <div>
                      <dt>L/100 km</dt>
                      <dd>{r.litresPer100Km.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>km/L</dt>
                      <dd>{r.kmPerLitre.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>Refill cost/km</dt>
                      <dd>{naira(r.refillCostPerKm.toFixed(2))}</dd>
                    </div>
                  </dl>
                  {r.assessment.limit != null && (
                    <p>
                      {r.litresPer100Km.toFixed(4)} L/100 km measured;{" "}
                      {r.assessment.limit.toFixed(4)} limit.
                    </p>
                  )}
                  {r.assessment.status === "above_limit" && (
                    <p>
                      {r.assessment.excessPercent!.toFixed(2)}% over limit ·{" "}
                      {r.assessment.excessLitres!.toFixed(2)} L above allowance for{" "}
                      {r.distanceKm.toLocaleString()} km.
                    </p>
                  )}
                  <p>
                    The first full tank is the starting point. Fuel bought after it, including
                    partial fills and the next full fill, is counted. Refill cost per km is that
                    spending divided by distance. These figures cover this period, not all fuel
                    purchases.
                  </p>
                </details>
              </section>
            ))}
          <p>
            Fuel purchases recorded (all time, accepted records):{" "}
            <strong>
              {fuel.filter((f) => f.vehicleId === vehicle.id && !unconfirmedIds.has(f.id)).length
                ? fuel
                    .filter((f) => f.vehicleId === vehicle.id && !unconfirmedIds.has(f.id))
                    .every((f) => isValidStoredMoney(f.cost))
                  ? naira(
                      sumMoney(
                        fuel
                          .filter((f) => f.vehicleId === vehicle.id && !unconfirmedIds.has(f.id))
                          .map((f) => f.cost)
                      )
                    )
                  : "Spending information incomplete"
                : "No accepted purchases yet"}
            </strong>
          </p>
        </article>
      ))}
    </div>
  );
}
