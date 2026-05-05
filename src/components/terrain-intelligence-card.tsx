"use client";

import { Mountain, TriangleAlert, Waves } from "lucide-react";

import type { TerrainIntelligenceData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

function formatMeters(value: number | null, digits: number = 1) {
  return value == null ? "N/A" : `${value.toFixed(digits)} m`;
}

function formatDegrees(value: number | null, digits: number = 1) {
  return value == null ? "N/A" : `${value.toFixed(digits)} deg`;
}

function toneForRisk(level: string) {
  if (level === "low") return "text-emerald-400";
  if (level === "moderate") return "text-amber-400";
  return "text-red-400";
}

function borderForRisk(level: string) {
  if (level === "low") return "border-emerald-500/30 text-emerald-400";
  if (level === "moderate") return "border-amber-500/30 text-amber-400";
  return "border-red-500/30 text-red-400";
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-border/40 bg-secondary/20 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold", tone)}>{value}</div>
    </div>
  );
}

export function TerrainIntelligenceCard({
  terrain,
  className,
}: {
  terrain: TerrainIntelligenceData | null;
  className?: string;
}) {
  if (!terrain) return null;

  return (
    <div className={cn("rounded-lg border border-border/50 bg-background/70 p-3", className)}>
      <div className="flex items-start gap-2">
        <Mountain className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">SRTM Terrain Intelligence</p>
            <Badge variant="outline" className="text-[10px]">
              {terrain.geometryMode === "plot" ? "Parcel-aware" : "Point buffer"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {terrain.dataset}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {terrain.summary}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Mean Elevation" value={formatMeters(terrain.elevationMeters.mean)} />
        <Metric label="Relief" value={formatMeters(terrain.elevationMeters.relief)} />
        <Metric label="Mean Slope" value={formatDegrees(terrain.slopeDegrees.mean)} />
        <Metric
          label="Aspect"
          value={
            terrain.aspectDirection
              ? `${terrain.aspectDirection} ${formatDegrees(terrain.aspectDegrees)}`
              : "N/A"
          }
        />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <Metric label="Terrain Class" value={terrain.terrainClass} />
        <Metric
          label="Runoff Risk"
          value={terrain.runoffRisk}
          tone={toneForRisk(terrain.runoffRisk)}
        />
        <Metric
          label="Foundation Risk"
          value={terrain.foundationRisk}
          tone={toneForRisk(terrain.foundationRisk)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className={borderForRisk(terrain.buildability === "favorable" ? "low" : terrain.buildability === "conditional" ? "moderate" : "high")}>
          Buildability: {terrain.buildability}
        </Badge>
        <Badge variant="outline" className={borderForRisk(terrain.runoffRisk)}>
          <Waves className="mr-1 h-3 w-3" />
          Runoff: {terrain.runoffRisk}
        </Badge>
        <Badge variant="outline" className={borderForRisk(terrain.foundationRisk)}>
          <TriangleAlert className="mr-1 h-3 w-3" />
          Foundations: {terrain.foundationRisk}
        </Badge>
      </div>

      <div className="mt-3 rounded border border-border/40 bg-secondary/20 p-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Drainage Note
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {terrain.drainageNote}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Resolution: ~{terrain.resolutionMeters} m DEM. Source: {terrain.source}.
        </p>
      </div>
    </div>
  );
}

export function TerrainIntelligenceStateCard({
  available,
  message,
  className,
}: {
  available: boolean;
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        available
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border/60 bg-background/70",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Mountain
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            available ? "text-amber-500" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">SRTM Terrain Intelligence</p>
            <Badge variant="outline" className="text-[10px]">
              {available ? "Source connected" : "Not returned in this run"}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
