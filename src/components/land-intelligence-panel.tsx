"use client";

import React, { useState, useCallback } from "react";
import { useProjectData, useSelectedPlot } from "@/hooks/use-building-store";
import { useRegulations } from "@/hooks/use-regulations";
import { inferScoreQueryLocation } from "@/lib/land-intelligence/infer-score-query-location";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import * as turf from "@turf/turf";
import {
  Loader2,
  TrendingUp,
  MapPin,
  Satellite,
  BarChart2,
  Building2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Globe,
  DollarSign,
  Users,
  Layers,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScoreResult {
  score: {
    overallScore: number;
    rating: string;
    categories: {
      growthPotential: { score: number; maxScore: number; details: string[] };
      legalRegulatory: { score: number; maxScore: number; details: string[] };
      locationConnectivity: { score: number; maxScore: number; details: string[] };
      marketEconomics: { score: number; maxScore: number; details: string[] };
    };
    recommendation: string;
    dataCompleteness: number;
    timestamp: string;
  };
  dataSources: {
    census: { count: number; available: boolean };
    fdi: { count: number; available: boolean };
    sez: { count: number; available: boolean };
    satellite: { available: boolean; isMock: boolean };
    regulation: { available: boolean };
    googlePlaces: { count: number; available: boolean };
    googleRoads: { count: number; available: boolean };
    proposedInfrastructure: { count: number; available: boolean };
  };
}

interface BhuvanLayer {
  layerLabel: string;
  landUseType: string;
  featureId: string;
  properties: Record<string, any>;
}

interface BhuvanReport {
  primaryLandUse: string;
  historicLandUseChange?: string;
  layers: BhuvanLayer[];
  stateCode: string;
}

// ── Helper Components ─────────────────────────────────────────────────────────

function ScoreGauge({ score, max, rating }: { score: number; max: number; rating: string }) {
  const pct = Math.round((score / max) * 100);
  const circumference = 2 * Math.PI * 58;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const color =
    pct >= 75 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#ef4444";

  const ratingEmoji =
    rating === "Excellent" ? "🏆" : rating === "Good" ? "✅" : rating === "Fair" ? "⚠️" : "❌";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
          <circle cx="64" cy="64" r="58" fill="none" stroke="currentColor" strokeWidth="6" className="text-border/30" />
          <circle
            cx="64" cy="64" r="58" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black tabular-nums" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/ {max}</span>
        </div>
      </div>
      <Badge variant="outline" className="text-sm font-semibold gap-1.5" style={{ borderColor: color, color }}>
        {ratingEmoji} {rating}
      </Badge>
    </div>
  );
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
    <div className="rounded-lg border border-border/40 bg-secondary/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-secondary/20">
        <Icon className={cn("h-4 w-4 shrink-0", color)} />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin ml-auto text-muted-foreground" />}
      </div>
      <div className="p-3 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function DataRow({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("font-semibold text-sm tabular-nums", accent)}>{value}</span>
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
      <div className="h-2 rounded-full bg-border/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function LandIntelligencePanel() {
  const project = useProjectData();
  const selectedPlot = useSelectedPlot();
  const [loading, setLoading] = useState(false);
  const [scoreData, setScoreData] = useState<ScoreResult | null>(null);
  const [bhuvanData, setBhuvanData] = useState<BhuvanReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing regulations from admin panel (Firestore)
  const { regulations } = useRegulations(project);

  // Get coordinates from the project or selected plot center
  const getCoordinates = useCallback((): [number, number] | null => {
    // Prefer the selected plot — compute centroid from its polygon geometry
    if (selectedPlot?.geometry) {
      try {
        const centroid = turf.centroid(selectedPlot.geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [lng, lat];
      } catch { /* fall through */ }
    }
    // Fall back to project location if it has coordinates
    if (project?.location && typeof project.location === "object") {
      const loc = project.location as { lat: number; lng: number };
      if (loc.lng && loc.lat) return [loc.lng, loc.lat];
    }
    // Fall back to first plot in project
    if (project?.plots?.[0]?.geometry) {
      try {
        const centroid = turf.centroid(project.plots[0].geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [lng, lat];
      } catch { /* fall through */ }
    }
    return null;
  }, [selectedPlot, project]);

  const getLocationName = useCallback((): string => {
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
    const regulationLocation = regulations.find((reg) => typeof reg.location === "string" && reg.location.trim())?.location;
    return regulationLocation || "Location unavailable";
  }, [project, regulations, selectedPlot]);

  const runAnalysis = useCallback(async () => {
    const coords = getCoordinates();
    if (!coords) {
      setError("No coordinates available. Please place a plot on the map first.");
      return;
    }

    const locationName = getLocationName();
    if (locationName === "Location unavailable") {
      setError("No valid location name is available for this project yet. Add a project or plot location before running Land Intelligence.");
      return;
    }

    const { state, district } = inferScoreQueryLocation(locationName);
    const plotForAnalysis = selectedPlot || project?.plots?.[0] || null;

    setLoading(true);
    setError(null);

    try {
      // Fire both requests in parallel
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
          }),
        }).then((r) => r.json()),
        fetch("/api/land-intelligence/bhuvan-landuse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: coords,
            location: getLocationName(),
          }),
        }).then((r) => r.json()),
      ]);

      if (scoreRes.status === "fulfilled" && scoreRes.value.success) {
        setScoreData(scoreRes.value);
      } else {
        console.warn("[LandIntel] Score fetch issue:", scoreRes);
      }

      if (bhuvanRes.status === "fulfilled" && bhuvanRes.value.success) {
        setBhuvanData(bhuvanRes.value.report);
      } else {
        console.warn("[LandIntel] Bhuvan fetch issue:", bhuvanRes);
      }
    } catch (err: any) {
      setError(err.message || "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [getCoordinates, getLocationName, project, selectedPlot]);

  const coords = getCoordinates();

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold">Land Intelligence</h2>
            {/* <Badge variant="outline" className="text-[10px] font-medium ml-auto">Phase 1.2</Badge> */}
          </div>
          <p className="text-xs text-muted-foreground">
            AI-driven developability analysis using live government data, satellite imagery, and geospatial intelligence.
          </p>
        </div>

        {/* Coordinates Info */}
        <div className="rounded-lg border border-border/40 bg-secondary/20 p-3 flex items-center gap-3">
          <MapPin className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Analysis Location</div>
            <div className="text-sm font-semibold truncate">
              {coords ? `[${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]` : "No coordinates"}
            </div>
            <div className="text-xs text-muted-foreground truncate">{getLocationName()}</div>
          </div>
          <Button
            size="sm"
            className="shrink-0 h-8 text-xs gap-1.5"
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

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Results */}
        {scoreData && (
          <>
            {/* ── Developability Score Hero ── */}
            <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4">
              <div className="flex items-start gap-4">
                <ScoreGauge
                  score={scoreData.score.overallScore}
                  max={1000}
                  rating={scoreData.score.rating}
                />
                <div className="flex-1 space-y-3 min-w-0">
                  <div>
                    <h3 className="text-sm font-bold">Developability Score</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
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

            {/* ── Data Sources Status ── */}
            <div className="flex flex-wrap gap-1.5">
              {[ 
                { key: "census", label: "Census", icon: Users },
                { key: "fdi", label: "FDI", icon: DollarSign },
                { key: "sez", label: "SEZ", icon: Building2 },
                { key: "satellite", label: "Satellite", icon: Satellite },
                { key: "regulation", label: "Regulation", icon: ShieldCheck },
                { key: "googlePlaces", label: "Google Places", icon: MapPin },
                { key: "googleRoads", label: "Google Roads", icon: MapPin },
                { key: "proposedInfrastructure", label: "Proposed Infra", icon: TrendingUp },
              ].map(({ key, label, icon: Icon }) => {
                const ds = scoreData.dataSources[key as keyof typeof scoreData.dataSources];
                const available = ds?.available;
                return (
                  <Badge
                    key={key}
                    variant="outline"
                    className={cn(
                      "text-[10px] gap-1 font-medium",
                      available ? "border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"
                    )}
                  >
                    {available ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {label}
                    {"count" in ds && ds.count > 0 && ` (${ds.count})`}
                  </Badge>
                );
              })}
            </div>

            {/* ── Recommendation ── */}
            {scoreData.score.recommendation && (
              <InfoCard icon={TrendingUp} title="AI Recommendation" color="text-emerald-500">
                <p className="text-xs leading-relaxed">{scoreData.score.recommendation}</p>
              </InfoCard>
            )}
          </>
        )}

        {/* ── Bhuvan Land Use ── */}
        {bhuvanData && (
          <InfoCard icon={Globe} title="Bhuvan Land Use (ISRO)" color="text-blue-500">
            <DataRow
              label="Primary Land Use"
              value={bhuvanData.primaryLandUse}
              accent="text-blue-400"
            />
            <DataRow label="State Code" value={bhuvanData.stateCode} />
            {bhuvanData.historicLandUseChange && (
              <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 mt-1">
                <div className="flex items-center gap-1.5 text-xs text-amber-500 font-semibold mb-0.5">
                  <TrendingUp className="h-3 w-3" />
                  Historic Change Detected
                </div>
                <p className="text-xs text-muted-foreground">{bhuvanData.historicLandUseChange}</p>
              </div>
            )}
            <div className="mt-2 space-y-1.5">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Layers ({bhuvanData.layers.length})
              </div>
              {bhuvanData.layers.map((layer, i) => (
                <div key={i} className="flex items-center gap-2 text-xs rounded bg-secondary/30 px-2 py-1.5">
                  <Layers className="h-3 w-3 text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{layer.layerLabel}</div>
                    <div className="text-muted-foreground truncate">{layer.landUseType}</div>
                  </div>
                </div>
              ))}
            </div>
          </InfoCard>
        )}

        {/* ── Regulatory Profile (Admin Panel) ── */}
        {/* <InfoCard
          icon={ShieldCheck}
          title="Regulatory Profile (Admin Panel)"
          color="text-amber-500"
          loading={regsLoading}
        >
          {regulations ? (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-500 font-medium">
                  <CheckCircle className="h-3 w-3" />
                  {regulations.location} — {regulations.type}
                </Badge>
              </div>
              <div className="space-y-0.5">
                {regulations.geometry?.floor_area_ratio?.value != null && (
                  <DataRow label="Max FAR / FSI" value={regulations.geometry.floor_area_ratio.value} accent="text-emerald-400" />
                )}
                {regulations.geometry?.max_height?.value != null && (
                  <DataRow label="Max Height" value={`${regulations.geometry.max_height.value}m`} accent="text-emerald-400" />
                )}
                {regulations.geometry?.max_ground_coverage?.value != null && (
                  <DataRow label="Max Coverage" value={`${regulations.geometry.max_ground_coverage.value}%`} accent="text-emerald-400" />
                )}
                {regulations.geometry?.setback?.value != null && (
                  <DataRow label="Min Setback" value={`${regulations.geometry.setback.value}m`} />
                )}
                {regulations.geometry?.land_use_zoning?.value != null && (
                  <DataRow label="Zoning" value={String(regulations.geometry.land_use_zoning.value)} accent="text-blue-400" />
                )}
                {regulations.geometry?.conversion_status?.value != null && (
                  <DataRow label="Conversion Status" value={String(regulations.geometry.conversion_status.value)} />
                )}
                {regulations.facilities?.parking?.value != null && (
                  <DataRow label="Parking Ratio" value={`${regulations.facilities.parking.value} ECS/unit`} />
                )}
                {regulations.sustainability?.rainwater_harvesting?.value != null && (
                  <DataRow label="Rainwater Harvesting" value={regulations.sustainability.rainwater_harvesting.value ? "Required" : "Not Required"} />
                )}
                {regulations.safety_and_services?.fire_safety?.value != null && (
                  <DataRow label="Fire Safety" value={String(regulations.safety_and_services.fire_safety.value)} />
                )}
              </div>
              <div className="mt-2 pt-2 border-t border-border/30">
                <div className="text-xs text-muted-foreground">
                  <FileCheck className="h-3 w-3 inline mr-1" />
                  {Object.values(regulations.geometry || {}).filter(v => v?.value != null).length +
                   Object.values(regulations.facilities || {}).filter(v => v?.value != null).length +
                   Object.values(regulations.sustainability || {}).filter(v => v?.value != null).length +
                   Object.values(regulations.safety_and_services || {}).filter(v => v?.value != null).length +
                   Object.values(regulations.administration || {}).filter(v => v?.value != null).length
                  } regulation fields loaded from admin panel
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-2">
              {regsLoading ? "Loading regulations..." : "No regulations found for this project location. Add them in the Admin Panel."}
            </div>
          )}
        </InfoCard> */}

        {/* ── Empty State ── */}
        {!scoreData && !bhuvanData && !loading && !error && (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">No analysis yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click <strong>Run Analysis</strong> to fetch live data from Bhuvan, Earth Engine, and Census.
              </p>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
