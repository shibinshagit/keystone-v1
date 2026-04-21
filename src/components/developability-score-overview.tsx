"use client";

import type { ElementType } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  MapPin,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { DevelopabilityScore, DevelopabilityScoreItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DataSourceStatus {
  count?: number;
  available: boolean;
}

interface NearbyAmenitySummaryItem {
  label: string;
  count: number;
  nearestDistanceMeters: number | null;
  sampleNames: string[];
}

interface DevelopabilityOverviewProps {
  score: DevelopabilityScore;
  dataSources: {
    census: DataSourceStatus;
    fdi: DataSourceStatus;
    sez: DataSourceStatus;
    satellite: { available: boolean; isMock?: boolean };
    regulation: { available: boolean };
    googlePlaces: DataSourceStatus;
    googleRoads: DataSourceStatus;
    proposedInfrastructure: DataSourceStatus;
  };
  nearbyAmenities?: {
    transit: NearbyAmenitySummaryItem;
    schools: NearbyAmenitySummaryItem;
    hospitals: NearbyAmenitySummaryItem;
    malls: NearbyAmenitySummaryItem;
  };
  className?: string;
}

const CATEGORY_SECTIONS = [
  { id: "growthPotential", label: "Growth Potential", color: "#3b82f6", hint: "Infrastructure, growth, and future upside" },
  { id: "legalRegulatory", label: "Legal & Regulatory", color: "#f59e0b", hint: "Zoning, CLU, approvals, and legal viability" },
  { id: "locationConnectivity", label: "Location & Connectivity", color: "#8b5cf6", hint: "Access, roads, transit, airport, amenities" },
  { id: "marketEconomics", label: "Market & Economics", color: "#10b981", hint: "Demand, SEZ proximity, and economics" },
] as const;

const DATA_SOURCE_META = [
  { key: "census", label: "Census" },
  { key: "fdi", label: "FDI" },
  { key: "sez", label: "SEZ" },
  { key: "satellite", label: "Satellite" },
  { key: "regulation", label: "Regulation" },
  { key: "googlePlaces", label: "Google Places" },
  { key: "googleRoads", label: "Google Roads" },
  { key: "proposedInfrastructure", label: "Proposed Infra" },
] as const;

export function DevelopabilityScoreOverview({
  score,
  dataSources,
  nearbyAmenities,
  className,
}: DevelopabilityOverviewProps) {
  const sections = CATEGORY_SECTIONS.map((section) => ({
    ...section,
    category: score.categories[section.id],
  }));

  const defaultOpenSections = sections
    .filter(
      (section) =>
        section.category.items.some((item) => item.status === "fail") ||
        section.category.items.some((item) => item.status === "pending"),
    )
    .map((section) => section.id);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold">Score Drill-Down</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a category to see each pass, fail, and pending check.
            </p>
          </div>
          <Badge variant="outline" className="text-[11px] font-semibold">
            {Math.round(score.dataCompleteness * 100)}% complete
          </Badge>
        </div>

        <Accordion type="multiple" defaultValue={defaultOpenSections} className="mt-4 w-full">
          {sections.map((section) => {
            const passCount = section.category.items.filter((item) => item.status === "pass").length;
            const failCount = section.category.items.filter((item) => item.status === "fail").length;
            const pendingCount = section.category.items.filter((item) => item.status === "pending").length;

            return (
              <AccordionItem
                key={section.id}
                value={section.id}
                className="mb-3 rounded-lg border border-border/60 px-3 last:mb-0"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-4 text-left">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: section.color }}
                        />
                        <span className="text-sm font-semibold">{section.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{section.hint}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <StatusBadge status="pass" count={passCount} />
                        <StatusBadge status="fail" count={failCount} />
                        <StatusBadge status="pending" count={pendingCount} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums">
                        {section.category.score}/{section.category.maxScore}
                      </div>
                      <div className="text-[11px] text-muted-foreground">category score</div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pt-1">
                  {section.category.items.map((item) => (
                    <ScoreItemRow key={item.id} item={item} />
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      <Accordion type="multiple" className="w-full">
        <AccordionItem value="sources" className="rounded-lg border border-border/60 px-3">
          <AccordionTrigger className="py-3 hover:no-underline">
            <div className="flex items-center gap-2 text-left">
              <Database className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Data Sources</p>
                <p className="text-xs text-muted-foreground">
                  Current feeds contributing to the score
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-wrap gap-1.5">
              {DATA_SOURCE_META.map(({ key, label }) => {
                const ds = dataSources[key];
                const available = ds?.available;
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={cn(
                      "gap-1 text-[10px] font-medium",
                      available
                        ? "border-emerald-500/40 text-emerald-600"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {available ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {label}
                    {"count" in ds && typeof ds.count === "number" && ds.count > 0 ? ` (${ds.count})` : ""}
                  </Badge>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {nearbyAmenities ? (
          <AccordionItem value="amenities" className="mt-3 rounded-lg border border-border/60 px-3">
            <AccordionTrigger className="py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-left">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">Nearby Amenities</p>
                  <p className="text-xs text-muted-foreground">
                    Transit, schools, hospitals, and malls around the land
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  nearbyAmenities.transit,
                  nearbyAmenities.schools,
                  nearbyAmenities.hospitals,
                  nearbyAmenities.malls,
                ].map((amenity) => (
                  <div
                    key={amenity.label}
                    className="rounded-lg border border-border/50 bg-background/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{amenity.label}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {amenity.count} found
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Nearest:{" "}
                      <span className="font-semibold text-foreground">
                        {formatDistanceMeters(amenity.nearestDistanceMeters)}
                      </span>
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {amenity.sampleNames.length > 0
                        ? amenity.sampleNames.join(", ")
                        : "No nearby places returned in the current search radius."}
                    </p>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>
    </div>
  );
}

function ScoreItemRow({ item }: { item: DevelopabilityScoreItem }) {
  const statusMeta =
    item.status === "pass"
      ? {
          label: "Pass",
          className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
          icon: CheckCircle2,
        }
      : item.status === "fail"
        ? {
            label: "Fail",
            className: "border-red-500/40 bg-red-500/10 text-red-700",
            icon: ShieldAlert,
          }
        : {
            label: "Pending",
            className: "border-amber-500/40 bg-amber-500/10 text-amber-700",
            icon: Clock3,
          };

  const StatusIcon = statusMeta.icon;

  return (
    <div className="rounded-lg border border-border/50 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-sm font-medium">{item.title}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {item.detail || "No supporting detail is available for this item yet."}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Badge variant="outline" className={cn("gap-1 text-[10px] font-semibold", statusMeta.className)}>
            <StatusIcon className="h-3 w-3" />
            {statusMeta.label}
          </Badge>
          <div className="mt-2 text-xs font-semibold tabular-nums">
            {item.score}/{item.maxScore}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  count,
}: {
  status: "pass" | "fail" | "pending";
  count: number;
}) {
  const meta: {
    label: string;
    className: string;
    icon: ElementType;
  } =
    status === "pass"
      ? {
          label: `${count} pass`,
          className: "border-emerald-500/40 text-emerald-700",
          icon: CheckCircle2,
        }
      : status === "fail"
        ? {
            label: `${count} fail`,
            className: "border-red-500/40 text-red-700",
            icon: XCircle,
          }
        : {
            label: `${count} pending`,
            className: "border-amber-500/40 text-amber-700",
            icon: AlertCircle,
          };

  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px] font-medium", meta.className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function formatDistanceMeters(value: number | null) {
  if (value == null) return "Not found";
  if (value < 1000) return `${value.toLocaleString("en-IN")} m`;
  return `${(value / 1000).toLocaleString("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}
