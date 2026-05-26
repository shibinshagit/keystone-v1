"use client";

import { Badge } from "@/components/ui/badge";
import type { TransportationScreeningReport } from "@/lib/land-intelligence/transportation";
import { cn } from "@/lib/utils";

function formatDistance(distanceMeters: number | null) {
  if (distanceMeters == null) return "N/A";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function StatusBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const normalized = value.toLowerCase();
  const className =
    normalized.includes("high") || normalized.includes("likely")
      ? "border-red-500/40 text-red-600"
      : normalized.includes("moderate") || normalized.includes("possible")
        ? "border-amber-500/40 text-amber-600"
        : normalized.includes("low") ||
            normalized.includes("strong") ||
            normalized.includes("unlikely")
          ? "border-emerald-500/40 text-emerald-600"
          : "border-border text-muted-foreground";

  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Badge variant="outline" className={cn("mt-2 text-[11px] capitalize", className)}>
        {value}
      </Badge>
    </div>
  );
}

export function TransportationScreeningCard({
  report,
  className,
}: {
  report: TransportationScreeningReport;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border/50 bg-background/70 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Transportation Screening</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {report.tia.summary}
          </p>
        </div>
        <Badge variant="outline" className="text-[11px] font-semibold">
          {report.city || report.stateCode || "USA"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <StatusBadge label="TIA Likelihood" value={report.tia.likelihood} />
        <StatusBadge label="Access Risk" value={report.accessManagement.status} />
        <StatusBadge label="Transit Access" value={report.transitAccess.status} />
        <StatusBadge label="Work-Zone Context" value={report.nearbyWorkZones.status} />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded border border-border/40 bg-secondary/20 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Roadway Context
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {report.roadwayContext.summary}
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>
              Access sides:{" "}
              <span className="font-semibold text-foreground">
                {report.roadwayContext.roadAccessSideCount}
              </span>
            </div>
            <div>
              Nearest snapped road:{" "}
              <span className="font-semibold text-foreground">
                {formatDistance(report.roadwayContext.centroidRoadDistanceMeters)}
              </span>
            </div>
            <div>
              Mapped road width:{" "}
              <span className="font-semibold text-foreground">
                {report.roadwayContext.roadWidthMeters != null
                  ? `${report.roadwayContext.roadWidthMeters} m`
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded border border-border/40 bg-secondary/20 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Transit & Work Zones
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {report.transitAccess.summary}
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>
              Nearest transit:{" "}
              <span className="font-semibold text-foreground">
                {formatDistance(report.transitAccess.nearestDistanceMeters)}
              </span>
            </div>
            <div>
              Active / pending work zones within 1 km:{" "}
              <span className="font-semibold text-foreground">
                {report.nearbyWorkZones.countWithin1Km}
              </span>
            </div>
            <div>
              Within 5 km:{" "}
              <span className="font-semibold text-foreground">
                {report.nearbyWorkZones.countWithin5Km}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded border border-border/40 bg-secondary/20 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            TIA / Approval Triggers
          </div>
          <div className="mt-2 space-y-1">
            {report.approvals.triggers.map((trigger, index) => (
              <div
                key={`${trigger}-${index}`}
                className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
              >
                {trigger}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-border/40 bg-secondary/20 p-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recommended Documents
          </div>
          <div className="mt-2 space-y-1">
            {report.approvals.recommendedDocuments.map((document, index) => (
              <div
                key={`${document}-${index}`}
                className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
              >
                {document}
              </div>
            ))}
          </div>
        </div>

        {report.nearbyWorkZones.sampleWorkZones.length > 0 ? (
          <div className="rounded border border-border/40 bg-secondary/20 p-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Nearest Work-Zone Signals
            </div>
            <div className="mt-2 space-y-1">
              {report.nearbyWorkZones.sampleWorkZones.slice(0, 3).map((workZone) => (
                <div
                  key={workZone.id}
                  className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {workZone.roadNames[0] || workZone.name}
                  </span>
                  {` • ${formatDistance(workZone.distanceMeters)}`}
                  {workZone.vehicleImpact ? ` • ${workZone.vehicleImpact}` : ""}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TransportationScreeningCard;
