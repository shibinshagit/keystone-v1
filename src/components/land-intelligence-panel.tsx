"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as turf from "@turf/turf";
import {
  AlertTriangle,
  Crosshair,
  Globe,
  Layers,
  Loader2,
  Map,
  MapPin,
  RefreshCw,
  Satellite,
  TrendingUp,
} from "lucide-react";

import { useBuildingStore, useProjectData, useSelectedPlot } from "@/hooks/use-building-store";
import { inferRegulationGeography } from "@/lib/geography";
import type { EnvironmentalScreeningReport } from "@/lib/land-intelligence/environmental";
import { inferScoreQueryLocation } from "@/lib/land-intelligence/infer-score-query-location";
import type { LandUseSummary } from "@/lib/land-intelligence/land-use";
import type { DevelopabilityScore, PopulationMigrationAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useRegulations } from "@/hooks/use-regulations";
import { PopulationMigrationCard } from "./population-migration-card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { DevelopabilityScoreOverview } from "./developability-score-overview";

interface ScoreResult {
  score: DevelopabilityScore;
  environmentalScreening: EnvironmentalScreeningReport | null;
  populationMigration: PopulationMigrationAnalysis | null;
  nearbyAmenities: {
    transit: {
      label: string;
      count: number;
      nearestDistanceMeters: number | null;
      sampleNames: string[];
    };
    schools: {
      label: string;
      count: number;
      nearestDistanceMeters: number | null;
      sampleNames: string[];
    };
    hospitals: {
      label: string;
      count: number;
      nearestDistanceMeters: number | null;
      sampleNames: string[];
    };
    malls: {
      label: string;
      count: number;
      nearestDistanceMeters: number | null;
      sampleNames: string[];
    };
  };
  dataSources: {
    census: { count: number; available: boolean };
    populationMigration: { count: number; available: boolean };
    fdi: { count: number; available: boolean };
    sez: { count: number; available: boolean };
    satellite: { available: boolean; isMock: boolean };
    regulation: { available: boolean };
    googlePlaces: { count: number; available: boolean };
    googleRoads: { count: number; available: boolean };
    proposedInfrastructure: { count: number; available: boolean };
    environmental: { count: number; available: boolean };
  };
}

function ScoreGauge({ score, max, rating }: { score: number; max: number; rating: string }) {
  const pct = Math.round((score / max) * 100);
  const circumference = 2 * Math.PI * 58;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const color =
    pct >= 75 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle
            cx="64"
            cy="64"
            r="58"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-border/30"
          />
          <circle
            cx="64"
            cy="64"
            r="58"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black tabular-nums" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-muted-foreground">/ {max}</span>
        </div>
      </div>
      <Badge variant="outline" className="gap-1.5 text-sm font-semibold" style={{ borderColor: color, color }}>
        {rating}
      </Badge>
    </div>
  );
}

function getLandUseSourceTitle(landUseData: LandUseSummary | null) {
  return landUseData?.sourceLabel
    ? `Land Use / Cover (${landUseData.sourceLabel})`
    : "Land Use / Cover";
}

function InfoCard({
  icon: Icon,
  title,
  children,
  color = "text-primary",
  loading = false,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-secondary/10">
      <div className="flex items-center gap-2 border-b border-border/30 bg-secondary/20 px-3 py-2">
        <Icon className={cn("h-4 w-4 shrink-0", color)} />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {loading ? <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="space-y-2 p-3 text-sm">{children}</div>
    </div>
  );
}

function DataRow({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", accent)}>{value}</span>
    </div>
  );
}

function CategoryBar({
  label,
  earned,
  max,
  color,
}: {
  label: string;
  earned: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (earned / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {earned}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border/30">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function LandIntelligencePanel() {
  const project = useProjectData();
  const selectedPlot = useSelectedPlot();
  const plots = useBuildingStore((state) => state.plots);
  const actions = useBuildingStore((state) => state.actions);
  const instantAnalysisTarget = useBuildingStore((state) => state.instantAnalysisTarget);
  const isInstantAnalysisMode = useBuildingStore(
    (state) => state.uiState.isInstantAnalysisMode,
  );
  const [loading, setLoading] = useState(false);
  const [scoreData, setScoreData] = useState<ScoreResult | null>(null);
  const [landUseData, setLandUseData] = useState<LandUseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);
  const autoRunRequestKeyRef = useRef<string | null>(null);
  const { regulations } = useRegulations(project);

  const instantTargetPlot = useMemo(() => {
    if (!instantAnalysisTarget?.plotId) return null;
    return plots.find((plot) => plot.id === instantAnalysisTarget.plotId) || null;
  }, [instantAnalysisTarget?.plotId, plots]);

  const getCoordinates = useCallback((): [number, number] | null => {
    if (instantAnalysisTarget?.coordinates) {
      return instantAnalysisTarget.coordinates;
    }

    if (selectedPlot?.geometry) {
      try {
        const centroid = turf.centroid(selectedPlot.geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [lng, lat];
      } catch {
        // Fall through to project-level location.
      }
    }

    if (project?.location && typeof project.location === "object") {
      const loc = project.location as { lat: number; lng: number };
      if (loc.lng && loc.lat) return [loc.lng, loc.lat];
    }

    if (project?.plots?.[0]?.geometry) {
      try {
        const centroid = turf.centroid(project.plots[0].geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [lng, lat];
      } catch {
        // No fallback left.
      }
    }

    return null;
  }, [instantAnalysisTarget?.coordinates, project, selectedPlot]);

  const getLocationName = useCallback((): string => {
    if (instantAnalysisTarget?.locationLabel?.trim()) {
      return instantAnalysisTarget.locationLabel;
    }

    if (typeof selectedPlot?.location === "string" && selectedPlot.location.trim()) {
      return selectedPlot.location;
    }

    if (project?.location) {
      if (typeof project.location === "string" && project.location.trim()) {
        return project.location;
      }

      if (typeof project.location === "object") {
        const namedLocation =
          (project.location as { name?: string; text?: string }).name ||
          (project.location as { name?: string; text?: string }).text;
        if (typeof namedLocation === "string" && namedLocation.trim()) {
          return namedLocation;
        }
      }
    }

    if (typeof regulations?.location === "string" && regulations.location.trim()) {
      return regulations.location;
    }

    return "Location unavailable";
  }, [instantAnalysisTarget?.locationLabel, project, regulations, selectedPlot]);

  const getPlotForAnalysis = useCallback(() => {
    if (instantTargetPlot) return instantTargetPlot;
    return selectedPlot || project?.plots?.[0] || null;
  }, [instantTargetPlot, project?.plots, selectedPlot]);

  const runAnalysis = useCallback(async () => {
    const coords = getCoordinates();
    if (!coords) {
      setError("No coordinates available. Enable map click mode or place a plot on the map first.");
      return;
    }

    const locationName = getLocationName();
    if (locationName === "Location unavailable") {
      setError(
        "No valid location name is available for this project yet. Search a place or click a map location before running Land Intelligence.",
      );
      return;
    }

    const { state, district } = inferScoreQueryLocation(locationName);
    const geography = inferRegulationGeography(locationName);
    const plotForAnalysis = getPlotForAnalysis();
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;

    setLoading(true);
    setError(null);
    setScoreData(null);
    setLandUseData(null);

    try {
      const [scoreRes, bhuvanRes] = await Promise.allSettled([
        fetch("/api/land-intelligence/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: state,
            district,
            coordinates: coords,
            plotGeometry: plotForAnalysis?.geometry,
            roadAccessSides: plotForAnalysis?.roadAccessSides,
            landSizeSqm: plotForAnalysis?.area,
            intendedUse: project?.intendedUse,
            underwriting: project?.underwriting,
            locationAmenities: project?.locationData?.amenities || [],
            market: project?.market || geography.market,
            countryCode: project?.countryCode || geography.countryCode,
          }),
        }).then((r) => r.json()),
        fetch("/api/land-intelligence/land-use", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: coords,
            location: locationName,
            market: project?.market || geography.market,
            countryCode: project?.countryCode || geography.countryCode,
          }),
        }).then((r) => r.json()),
      ]);

      if (latestRequestRef.current !== requestId) {
        return;
      }

      if (scoreRes.status === "fulfilled" && scoreRes.value.success) {
        setScoreData(scoreRes.value);
      } else {
        console.warn("[LandIntel] Score fetch issue:", scoreRes);
      }

      if (bhuvanRes.status === "fulfilled" && bhuvanRes.value.success) {
        setLandUseData(bhuvanRes.value.report);
      } else {
        console.warn("[LandIntel] Land-use fetch issue:", bhuvanRes);
      }
    } catch (err: any) {
      if (latestRequestRef.current === requestId) {
        setError(err.message || "Analysis failed");
      }
    } finally {
      if (latestRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [getCoordinates, getLocationName, getPlotForAnalysis, project]);

  useEffect(() => {
    const requestKey = instantAnalysisTarget?.requestKey;
    if (!requestKey) return;
    if (autoRunRequestKeyRef.current === requestKey) return;

    autoRunRequestKeyRef.current = requestKey;
    void runAnalysis();
  }, [instantAnalysisTarget?.requestKey, runAnalysis]);

  const coords = getCoordinates();
  const analysisModeLabel = instantAnalysisTarget
    ? instantAnalysisTarget.parcelAware
      ? `Clicked inside ${instantAnalysisTarget.plotName || "a plot"}`
      : "Point-only instant analysis"
    : selectedPlot
      ? `Using ${selectedPlot.name}`
      : "Using project location";

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold">Land Intelligence</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            AI-driven developability analysis using live government data, satellite imagery, and geospatial intelligence.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isInstantAnalysisMode ? "default" : "outline"}
            className="h-8 gap-1.5 text-xs"
            onClick={() => actions.setInstantAnalysisMode(!isInstantAnalysisMode)}
          >
            <Crosshair className="h-3.5 w-3.5" />
            {isInstantAnalysisMode ? "Click Mode On" : "Click Map to Analyze"}
          </Button>
          {instantAnalysisTarget ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-xs"
              onClick={() => actions.clearInstantAnalysisTarget()}
            >
              Clear Point
            </Button>
          ) : null}
        </div>

        {isInstantAnalysisMode ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            Click anywhere on the map to run instant land analysis. If the point falls inside a plot,
            the score will use parcel geometry; otherwise it will run as a point-based estimate.
          </div>
        ) : null}

        {instantAnalysisTarget ? (
          <div className="rounded-lg border border-border/40 bg-secondary/10 p-3">
            <div className="flex items-start gap-3">
              <Map className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    Instant Analysis
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {instantAnalysisTarget.parcelAware ? "Parcel-aware" : "Point-only"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-semibold">{instantAnalysisTarget.locationLabel}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {instantAnalysisTarget.coordinates[0].toFixed(5)}, {instantAnalysisTarget.coordinates[1].toFixed(5)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{analysisModeLabel}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 p-3">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Analysis Location</div>
            <div className="truncate text-sm font-semibold">
              {coords ? `[${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]` : "No coordinates"}
            </div>
            <div className="truncate text-xs text-muted-foreground">{getLocationName()}</div>
          </div>
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={runAnalysis}
            disabled={loading || !coords}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : scoreData ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Satellite className="h-3.5 w-3.5" />
            )}
            {loading ? "Analyzing..." : scoreData ? "Re-run" : "Run Analysis"}
          </Button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        ) : null}

        {scoreData ? (
          <>
            <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
              <div className="flex items-start gap-4">
                <ScoreGauge
                  score={scoreData.score.overallScore}
                  max={1000}
                  rating={scoreData.score.rating}
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold">Developability Score</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Based on {Object.values(scoreData.dataSources).filter((d) => d.available).length}/
                      {Object.values(scoreData.dataSources).length} live data sources
                    </p>
                  </div>
                  <div className="space-y-2">
                    <CategoryBar
                      label="Growth Potential"
                      earned={scoreData.score.categories.growthPotential.score}
                      max={scoreData.score.categories.growthPotential.maxScore}
                      color="#3b82f6"
                    />
                    <CategoryBar
                      label="Legal Risk"
                      earned={scoreData.score.categories.legalRegulatory.score}
                      max={scoreData.score.categories.legalRegulatory.maxScore}
                      color="#f59e0b"
                    />
                    <CategoryBar
                      label="Location & Connectivity"
                      earned={scoreData.score.categories.locationConnectivity.score}
                      max={scoreData.score.categories.locationConnectivity.maxScore}
                      color="#8b5cf6"
                    />
                    <CategoryBar
                      label="Market & Economics"
                      earned={scoreData.score.categories.marketEconomics.score}
                      max={scoreData.score.categories.marketEconomics.maxScore}
                      color="#10b981"
                    />
                  </div>
                </div>
              </div>
            </div>

            <PopulationMigrationCard analysis={scoreData.populationMigration} emphasized />

            <DevelopabilityScoreOverview
              score={scoreData.score}
              dataSources={scoreData.dataSources}
              nearbyAmenities={scoreData.nearbyAmenities}
            />

            {scoreData.environmentalScreening ? (
              <InfoCard
                icon={Globe}
                title="EPA Environmental Screening"
                color="text-emerald-500"
              >
                <DataRow
                  label="Wetland Risk"
                  value={scoreData.environmentalScreening.wetlandScreening.status}
                  accent={
                    scoreData.environmentalScreening.wetlandScreening.status === "high"
                      ? "text-red-400"
                      : scoreData.environmentalScreening.wetlandScreening.status === "moderate"
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }
                />
                <DataRow
                  label="Air Screening"
                  value={scoreData.environmentalScreening.airQuality.status}
                  accent={
                    scoreData.environmentalScreening.airQuality.status === "high"
                      ? "text-red-400"
                      : scoreData.environmentalScreening.airQuality.status === "moderate"
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }
                />
                <DataRow
                  label="Water Screening"
                  value={scoreData.environmentalScreening.waterQuality.status}
                  accent={
                    scoreData.environmentalScreening.waterQuality.status === "high"
                      ? "text-red-400"
                      : scoreData.environmentalScreening.waterQuality.status === "moderate"
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }
                />
                <DataRow
                  label="NEPA Review"
                  value={scoreData.environmentalScreening.nepa.status}
                  accent={
                    scoreData.environmentalScreening.nepa.status === "elevated-review"
                      ? "text-red-400"
                      : scoreData.environmentalScreening.nepa.status ===
                          "screening-recommended"
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }
                />

                <div className="mt-2 rounded border border-border/40 bg-secondary/20 p-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Summary
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {scoreData.environmentalScreening.nepa.summary}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="rounded border border-border/40 bg-secondary/20 p-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Wetlands / Land Cover
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scoreData.environmentalScreening.wetlandScreening.summary}
                    </p>
                  </div>
                  <div className="rounded border border-border/40 bg-secondary/20 p-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Air
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scoreData.environmentalScreening.airQuality.summary}
                    </p>
                  </div>
                  <div className="rounded border border-border/40 bg-secondary/20 p-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Water
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {scoreData.environmentalScreening.waterQuality.summary}
                    </p>
                  </div>
                </div>

                {scoreData.environmentalScreening.nepa.triggers.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Review Triggers
                    </div>
                    {scoreData.environmentalScreening.nepa.triggers.map((trigger, index) => (
                      <div
                        key={`${trigger}-${index}`}
                        className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
                      >
                        {trigger}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Due-Diligence Documents
                  </div>
                  {scoreData.environmentalScreening.nepa.recommendedDocuments.map((document, index) => (
                    <div
                      key={`${document}-${index}`}
                      className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
                    >
                      {document}
                    </div>
                  ))}
                </div>
              </InfoCard>
            ) : null}

            {scoreData.score.recommendation ? (
              <InfoCard icon={TrendingUp} title="AI Recommendation" color="text-emerald-500">
                <p className="text-xs leading-relaxed">{scoreData.score.recommendation}</p>
              </InfoCard>
            ) : null}
          </>
        ) : null}

        {landUseData ? (
          <InfoCard
            icon={Globe}
            title={getLandUseSourceTitle(landUseData)}
            color="text-blue-500"
          >
            <DataRow
              label="Primary Land Use"
              value={landUseData.primaryLandUse}
              accent="text-blue-400"
            />
            <DataRow
              label={landUseData.market === "USA" ? "Coverage" : "State Code"}
              value={landUseData.stateCode || "N/A"}
            />
            {landUseData.latestYear ? (
              <DataRow label="Latest Year" value={landUseData.latestYear} />
            ) : null}
            {landUseData.historicLandUseChange ? (
              <div className="mt-1 rounded border border-amber-500/20 bg-amber-500/5 p-2">
                <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <TrendingUp className="h-3 w-3" />
                  Historic Change Detected
                </div>
                <p className="text-xs text-muted-foreground">{landUseData.historicLandUseChange}</p>
              </div>
            ) : null}
            <div className="mt-2 space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Snapshots ({landUseData.layers.length})
              </div>
              {landUseData.layers.map((layer, index) => (
                <div
                  key={`${layer.layerLabel}-${layer.year || index}`}
                  className="flex items-center gap-2 rounded bg-secondary/30 px-2 py-1.5 text-xs"
                >
                  <Layers className="h-3 w-3 shrink-0 text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{layer.layerLabel}</div>
                    <div className="truncate text-muted-foreground">{layer.landUseType}</div>
                  </div>
                </div>
              ))}
            </div>
          </InfoCard>
        ) : null}

        {!scoreData && !landUseData && !loading && !error ? (
          <div className="space-y-3 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">No analysis yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use <strong>Click Map to Analyze</strong> for instant analysis, or run the score from the
                current plot or project location.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
