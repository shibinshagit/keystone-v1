"use client";
import React, { useState, useMemo } from "react";
import { calculateVastuScore } from "@/lib/engines/vastu-engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import {
  useBuildingStore,
  useSelectedBuilding,
  useProjectData,
  useSelectedPlot,
} from "@/hooks/use-building-store";
import { useGreenScorecardStore } from "@/hooks/use-green-scorecard-store";
import { Progress } from "@/components/ui/progress";
import {
  AreaChart,
  Scale,
  Building,
  Car,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  DollarSign,
  LocateFixed,
  ChevronUp,
  ChevronDown,
  Compass,
  DoorOpen,
  Clock,
  TrendingUp,
  BarChart2,
  Zap,
  Settings2,
  Maximize2,
  Minimize2,
  Calculator,
  Star,
} from "lucide-react";
import { useDevelopmentMetrics } from "@/hooks/use-development-metrics";
import { useRegulations } from "@/hooks/use-regulations";
import { useProjectEstimates } from "@/hooks/use-project-estimates";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { generateVastuGates } from "@/lib/vastu-gate-generator";
import * as turf from "@turf/turf";
import { calculateBuildingCoreAndCirculation } from "@/lib/generators/building-core-calc";
import {
  SimHistogram,
  SimCDF,
  SimTornado,
  SimSCurveBand,
  SimGanttUncertainty,
  PhaseBreakdownChart,
  UtilityCostsTable,
  DelayFactorsDisplay,
  DeliveryPhasesChart,
  StandardTimelineChart,
  SimBoxPlot,
  SimScatterCostTime,
  CriticalPathProbabilityChart,
} from "./simulation-charts";
import { generateDeliveryPhases } from "@/lib/cost-time-simulation";
import { ProjectEstimates } from "@/lib/types";
import { FeasibilityReport } from "./feasibility-report";
import { UnderwritingReport } from "./underwriting-report";
import { ProjectUnderwritingForm } from "./project-underwriting-form";

function MetricsTab() {
  const activeProject = useProjectData();
  const metrics = useDevelopmentMetrics(activeProject || null);
  const plots = useBuildingStore((state) => state.plots);
  const selectedPlot = useSelectedPlot();
  const [expandedBuildings, setExpandedBuildings] = useState<
    Record<string, boolean>
  >({});
  const [useMaxCapacity, setUseMaxCapacity] = useState(false);

  const toggleBuilding = (id: string) =>
    setExpandedBuildings((prev) => ({ ...prev, [id]: !prev[id] }));

  // If a plot is selected, show metrics for that plot only; otherwise aggregate across all plots
  const buildingsForMetrics = useMemo(() => {
    if (selectedPlot)
      return (selectedPlot.buildings || []).filter((b) => b.visible !== false);
    if (!plots || plots.length === 0) return [];
    return plots.flatMap((p) => p.buildings.filter((b) => b.visible !== false));
  }, [plots, selectedPlot]);

  const allUtilityAreas = useMemo(() => {
    if (selectedPlot) return selectedPlot.utilityAreas || [];
    if (!plots) return [];
    return plots.flatMap((p) => p.utilityAreas || []);
  }, [plots, selectedPlot]);

  const allParkingAreas = useMemo(() => {
    if (selectedPlot) return selectedPlot.parkingAreas || [];
    if (!plots) return [];
    return plots.flatMap((p) => p.parkingAreas || []);
  }, [plots, selectedPlot]);

  const allGreenAreas = useMemo(() => {
    if (selectedPlot) return selectedPlot.greenAreas || [];
    if (!plots) return [];
    return plots.flatMap((p) => p.greenAreas || []);
  }, [plots, selectedPlot]);

  if (!activeProject || !metrics || buildingsForMetrics.length === 0)
    return (
      <div className="p-6 text-center text-muted-foreground text-base">
        No metrics available — generate buildings first.
      </div>
    );

  const totalPlotArea =
    activeProject.totalPlotArea || plots.reduce((s, p) => s + (p.area || 0), 0);
  // Use consumedBuildableArea to exactly match the Project Constraints panel FAR calculation
  const gfa =
    activeProject.consumedBuildableArea || metrics.totalBuiltUpArea || 1;
  const totalFootprint = buildingsForMetrics.filter((b) => !b.id.includes('-tower')).reduce((s, b) => s + b.area, 0);
  const totalGreenArea = allGreenAreas.reduce(
    (s, g) => s + (g.visible ? g.area : 0),
    0,
  );

  // Gather global unit/core/parking totals
  const allUnits = buildingsForMetrics.flatMap((b) => b.units || []);
  const allCores = buildingsForMetrics.flatMap((b) => b.cores || []);
  const allParkingFloors = buildingsForMetrics.flatMap((b) =>
    (b.floors || []).filter((f) => f.type === "Parking"),
  );
  const totalParkingSpaces =
    allParkingAreas.reduce((s, p) => s + (p.capacity || 0), 0) +
    allParkingFloors.reduce((s, f) => s + (f.parkingCapacity || 0), 0);

  // Building & Unit summaries
  const totalBuildings = buildingsForMetrics.filter((b) => !b.id.includes('-tower')).length;

  // Aggregate unit types (e.g., '1BHK', '2BHK') across all buildings
  const unitBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    allUnits.forEach((u: any) => {
      // Try multiple fields for unit type: u.type, u.name, u.config, fallback to 'Unit'
      const raw = (u.type || u.name || u.config || "Unit") as string;
      // Normalize common patterns: '1BHK', '2 BHK', '2bhk' -> '2BHK'
      const m = String(raw).toUpperCase().replace(/\s+/g, "");
      const normalized = m
        .replace(/(\d)BHK|BHK(\d)/, (s) => s)
        .replace(/BHK\s*/, "BHK");
      const key = normalized;
      map[key] = (map[key] || 0) + 1;
    });
    // Sort keys numerically by leading digit when possible (1BHK,2BHK,3BHK)
    const entries = Object.entries(map).sort((a, b) => {
      const na = Number(a[0].match(/^\d+/)?.[0] || 0);
      const nb = Number(b[0].match(/^\d+/)?.[0] || 0);
      if (na === nb) return a[0].localeCompare(b[0]);
      return na - nb;
    });
    return entries;
  }, [allUnits]);
  // Compute total units with robust fallbacks: prefer explicit units array, then unitCount fields, then project maps
  const project = useProjectData();
  const projectBuildings = (project?.plots || []).flatMap(
    (p: any) => p.buildings || [],
  );
  const projectUnitsLookup: Record<string, number> = {};
  projectBuildings.forEach((pb: any) => {
    const id = pb.id || pb.buildingId || pb.building_id || null;
    const names = [pb.name, pb.buildingName, pb.building_name]
      .filter(Boolean)
      .map((v: any) => String(v).toLowerCase().trim());
    const units = pb.units?.length ?? pb.unitCount ?? pb.unit_count ?? 0;
    if (id) projectUnitsLookup[id] = units;
    names.forEach((n: string) => (projectUnitsLookup[n] = units));
  });

  let totalUnitsCount = 0;
  if (allUnits.length > 0) {
    totalUnitsCount = allUnits.length;
  } else if (buildingsForMetrics.length > 0) {
    // Sum per building using unitCount/units fields
    totalUnitsCount = buildingsForMetrics.reduce((s: number, b: any) => {
      const est =
        b.units?.length ??
        b.unitCount ??
        b.unit_count ??
        b.properties?.units?.length ??
        null;
      if (typeof est === "number") return s + est;
      const bid = b.id || b.buildingId || b.building_id || null;
      if (bid && projectUnitsLookup[bid] != null)
        return s + projectUnitsLookup[bid];
      const lname = (b.name || b.buildingName || b.buildingname || "")
        .toString()
        .toLowerCase();
      if (lname && projectUnitsLookup[lname] != null)
        return s + projectUnitsLookup[lname];
      return s;
    }, 0);
  }

  // ─── Helper Components (bigger fonts) ───
  const Section = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div className="space-y-2.5">
      <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground border-b border-border/40 pb-1.5">
        {title}
      </div>
      {children}
    </div>
  );

  const Row = ({
    label,
    value,
    unit,
    accent,
    formula,
  }: {
    label: string;
    value: string | number;
    unit?: string;
    accent?: string;
    formula?: string;
  }) => (
    <div>
      <div className="flex items-center justify-between text-sm py-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-bold tabular-nums ${accent || ""}`}>
          {value}
          {unit && (
            <span className="text-muted-foreground font-normal ml-1 text-xs">
              {unit}
            </span>
          )}
        </span>
      </div>
      {formula && (
        <div className="text-xs text-muted-foreground/70 italic pl-2">
          = {formula}
        </div>
      )}
    </div>
  );

  const sellable = gfa * 0.7;
  const coreArea = gfa * 0.1;
  const circArea = gfa * 0.15;
  const servArea = gfa * 0.05;

  return (
    <div className="space-y-5 pb-6">
      {/* ══════════ AREA METRICS ══════════ */}
      <Section title="📐 Area Metrics">
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              label: "Plot Area",
              val: Math.round(totalPlotArea).toLocaleString(),
              unit: "m²",
              formula: "Σ plot geometries",
            },
            {
              label: "GFA (Built-up)",
              val: Math.round(gfa).toLocaleString(),
              unit: "m²",
              accent: "text-blue-400",
              formula: `Σ (footprint × floors) = ${Math.round(totalFootprint)}m² × avg floors`,
            },
            {
              label: "Sellable (70%)",
              val: Math.round(sellable).toLocaleString(),
              unit: "m²",
              accent: "text-emerald-400",
              formula: `GFA × 0.70 = ${Math.round(gfa)} × 0.70`,
            },
            {
              label: "Core Area (10%)",
              val: Math.round(coreArea).toLocaleString(),
              unit: "m²",
              formula: `GFA × 0.10`,
            },
            {
              label: "Circulation (15%)",
              val: Math.round(circArea).toLocaleString(),
              unit: "m²",
              formula: `GFA × 0.15`,
            },
            {
              label: "Services (5%)",
              val: Math.round(servArea).toLocaleString(),
              unit: "m²",
              formula: `GFA × 0.05`,
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-border/40 bg-secondary/20 p-3"
            >
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                {k.label}
              </div>
              <div className={`text-lg font-bold ${k.accent || ""}`}>
                {k.val}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {k.unit}
                </span>
              </div>
              {k.formula && (
                <div className="text-[11px] text-muted-foreground/60 italic mt-0.5">
                  = {k.formula}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Area bar */}
        <div className="space-y-1.5">
          <div className="flex h-4 rounded-full overflow-hidden gap-[1px]">
            {[
              ["#10b981", sellable],
              ["#3b82f6", coreArea],
              ["#8b5cf6", circArea],
              ["#f59e0b", servArea],
            ].map(([c, v]) => (
              <div
                key={c as string}
                className="h-full transition-all duration-500"
                style={{
                  width: `${((v as number) / gfa) * 100}%`,
                  backgroundColor: c as string,
                }}
              />
            ))}
          </div>
          <div className="flex gap-4 flex-wrap">
            {[
              ["#10b981", "Sellable 70%"],
              ["#3b82f6", "Core 10%"],
              ["#8b5cf6", "Circulation 15%"],
              ["#f59e0b", "Services 5%"],
            ].map(([c, l]) => (
              <div
                key={l as string}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: c as string }}
                />
                {l}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ─── BUILDING & UNIT SUMMARY ───────────────────────────────── */}
      <Section title="🏢 Buildings & Units">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase">
              Total Buildings
            </div>
            <div className="font-bold text-lg">{totalBuildings}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase">
              Total Units
            </div>
            <div className="font-bold text-lg">{totalUnitsCount}</div>
          </div>
        </div>

        {unitBreakdown.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {unitBreakdown.map(([type, cnt]) => (
              <div
                key={type}
                className="text-[13px] px-2 py-1 rounded-md bg-secondary/10 border border-border/20"
              >
                <span className="mr-2">🏠</span>
                <span className="font-medium">{type}</span>
                <span className="text-muted-foreground ml-2">{cnt}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ══════════ SITE UTILIZATION ══════════ */}
      <Section title="📊 Site Utilization">
        <Row
          label="Achieved FAR"
          value={metrics.achievedFAR.toFixed(2)}
          accent={metrics.achievedFAR > 3 ? "text-red-400" : "text-blue-400"}
          formula={`GFA ÷ Plot Area = ${Math.round(gfa)} ÷ ${Math.round(totalPlotArea)}`}
        />
        <Row
          label="Ground Coverage"
          value={metrics.groundCoveragePct.toFixed(1)}
          unit="%"
          formula={`(Footprint ÷ Plot Area) × 100 = (${Math.round(totalFootprint)} ÷ ${Math.round(totalPlotArea)}) × 100`}
        />
        <Row
          label="Open Space"
          value={Math.round(metrics.openSpace).toLocaleString()}
          unit="m²"
          formula={`Plot Area − Footprint = ${Math.round(totalPlotArea)} − ${Math.round(totalFootprint)}`}
        />
        <Row
          label="Green Cover"
          value={metrics.greenArea.percentage.toFixed(1)}
          unit="%"
          accent="text-green-400"
          formula={`(Green Area ÷ Plot Area) × 100 = (${Math.round(totalGreenArea)} ÷ ${Math.round(totalPlotArea)}) × 100`}
        />
        <Row
          label="Green Area"
          value={Math.round(totalGreenArea).toLocaleString()}
          unit="m²"
        />
        <Row
          label="Total Footprint"
          value={Math.round(totalFootprint).toLocaleString()}
          unit="m²"
          formula="Σ building footprints"
        />
      </Section>

      {/* ══════════ AMENITIES ══════════ */}
      {(() => {
        const closedAmenity = buildingsForMetrics.reduce(
          (s: number, b: any) => s + (b.groundFloorRemovedArea || 0),
          0,
        );
        const openSpace = totalPlotArea - totalFootprint;
        const openAmenity = Math.max(0, totalGreenArea + Math.max(0, openSpace - totalGreenArea) * 0.3);

        return (
          <Section title="🏋️ Amenities">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Closed Amenity
                </div>
                <div className="text-lg font-bold text-violet-400">
                  {Math.round(closedAmenity).toLocaleString()}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    m²
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground/60 italic mt-0.5">
                  = Σ ground floor removed unit area
                </div>
              </div>
              <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">
                  Open Amenity
                </div>
                <div className="text-lg font-bold text-emerald-400">
                  {Math.round(openAmenity).toLocaleString()}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    m²
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground/60 italic mt-0.5">
                  = Green + 30% remaining open
                </div>
              </div>
            </div>
          </Section>
        );
      })()}

      {/* ══════════ PER-BUILDING BREAKDOWN ══════════ */}
      <Section title={`🏢 Buildings (${totalBuildings} total)`}>
        <div className="space-y-4">
          {(() => {
            const groups: { key: string; label: string; buildings: typeof buildingsForMetrics }[] = [];
            const used = new Set<string>();
            buildingsForMetrics.forEach((b: any) => {
              if (used.has(b.id)) return;
              const baseId = b.id.replace(/-podium$/, '').replace(/-tower$/, '');
              const podium = buildingsForMetrics.find((x: any) => x.id === `${baseId}-podium`);
              const tower = buildingsForMetrics.find((x: any) => x.id === `${baseId}-tower`);
              if (podium && tower) {
                const label = typeof podium.name === "string" ? podium.name.replace(/\s*\(Podium\)\s*$/i, '').trim() : "Building";
                groups.push({ key: baseId, label, buildings: [podium, tower] });
                used.add(podium.id);
                used.add(tower.id);
              } else {
                groups.push({ key: b.id, label: b.name || 'Building', buildings: [b] });
                used.add(b.id);
              }
            });
            return groups;
          })().map((group, groupIdx) => (
            <div key={group.key} className="space-y-2">
              {/* Group Header for Podium + Tower combinations */}
              {group.buildings.length > 1 && (
                <div className="text-sm font-bold text-muted-foreground pt-1 border-b border-border/30 pb-1.5 flex items-center gap-2">
                  <Building className="h-4 w-4" /> {group.label}
                </div>
              )}
              {group.buildings.map((b: any, subIdx: number) => {
                const bFloors = b.floors || [];
                const occFloors = bFloors.filter((f: any) => f.type !== "Parking" && f.type !== "Utility");
                const parkFloors = bFloors.filter((f: any) => f.type === "Parking");
                const utilFloors = bFloors.filter((f: any) => f.type === "Utility");
                const bUnits = b.units || [];
                const bCores = b.cores || [];
                const bInternals = b.internalUtilities || [];
                // Defensive normalization for display values
                let displayBName = typeof b.name === "string" ? b.name : typeof b.buildingName === "string" ? b.buildingName : String(b.id || `Building ${groupIdx + 1}`);
                if (group.buildings.length > 1) {
                  displayBName = b.id.endsWith('-podium') ? 'Podium' : b.id.endsWith('-tower') ? 'Tower' : displayBName;
                }
                const displayIntendedUse = typeof b.intendedUse === "string" ? b.intendedUse : b.intendedUse && typeof b.intendedUse === "object" ? b.intendedUse.type || b.intendedUse.name || String(b.intendedUse.id) : String(b.intendedUse || "");
                const bHeight = b.height || b.numFloors * (b.typicalFloorHeight || 3.5);
                const isExpanded = expandedBuildings[b.id] ?? groupIdx < 3;

            // Unit breakdown (normalize unit type/name to safe string)
            const unitBD: Record<string, number> = {};
            bUnits.forEach((u: any) => {
              const rawType = u?.type ?? u?.name ?? u?.config ?? "Unit";
              const unitType =
                typeof rawType === "string"
                  ? rawType
                  : rawType && typeof rawType === "object"
                    ? rawType.type ||
                      rawType.name ||
                      String(rawType.id || "Unit")
                    : String(rawType);
              unitBD[unitType] = (unitBD[unitType] || 0) + 1;
            });

            // Core breakdown (normalize core type)
            const coreBD: Record<string, number> = {};
            bCores.forEach((c: any) => {
              const rawCoreType = c?.type ?? c?.name ?? "Core";
              const coreType =
                typeof rawCoreType === "string"
                  ? rawCoreType
                  : rawCoreType && typeof rawCoreType === "object"
                    ? rawCoreType.type ||
                      rawCoreType.name ||
                      String(rawCoreType.id || "Core")
                    : String(rawCoreType);
              coreBD[coreType] = (coreBD[coreType] || 0) + 1;
            });

            return (
              <div
                key={b.id}
                className="rounded-lg border border-border/50 bg-secondary/15 overflow-hidden"
              >
                {/* Header */}
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors"
                  onClick={() => toggleBuilding(b.id)}
                >
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold">{displayBName}</span>
                    <Badge variant="outline" className="text-xs">
                      {displayIntendedUse}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-blue-400">
                      {bHeight.toFixed(1)}m
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {b.numFloors}F
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-border/30">
                    {/* Quick Stats */}
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <div className="text-center p-2 rounded bg-secondary/30">
                        <div className="text-xs text-muted-foreground">
                          Footprint
                        </div>
                        <div className="text-base font-bold">
                          {Math.round(b.area)}m²
                        </div>
                      </div>
                      <div className="text-center p-2 rounded bg-secondary/30">
                        <div className="text-xs text-muted-foreground">
                          Height
                        </div>
                        <div className="text-base font-bold">
                          {bHeight.toFixed(1)}m
                        </div>
                        <div className="text-[11px] text-muted-foreground/70 italic">
                          {b.groundFloorHeight && b.groundFloorHeight !== b.typicalFloorHeight 
                             ? `${b.groundFloorHeight}m GF + ${occFloors.length - 1} × ${b.typicalFloorHeight || 3.5}m`
                             : `= ${occFloors.length} × ${b.typicalFloorHeight || 3.5}m`}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded bg-secondary/30">
                        <div className="text-xs text-muted-foreground">GFA</div>
                        <div className="text-base font-bold">
                          {Math.round(b.area * occFloors.length)}m²
                        </div>
                        <div className="text-[11px] text-muted-foreground/70 italic">
                          = {Math.round(b.area)} × {occFloors.length}F
                        </div>
                      </div>
                    </div>

                    {/* Floor Efficiency Check */}
                    {bUnits.length > 0 && (
                      <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-2 mb-3">
                        <div className="text-xs font-bold text-indigo-400 mb-2 border-b border-indigo-500/20 pb-1 flex items-center gap-1.5">
                          <Calculator className="w-3 h-3" /> Area Balance (Per
                          Floor)
                        </div>
                        <div className="grid grid-cols-[1fr_auto_80px] text-[11px] gap-y-1.5 items-center">
                          <span className="text-muted-foreground">
                            Total physical floor area
                          </span>
                          <span className="text-muted-foreground/50 mx-2"></span>
                          <span className="text-right font-medium">
                            {Math.round(b.area)} m²
                          </span>

                          <span className="text-muted-foreground pl-2 text-[10px] italic">
                            − Minus total core area
                          </span>
                          <span className="text-muted-foreground/50 mx-2 border-b border-dashed border-muted-foreground/30 w-full inline-block mb-1"></span>
                          {(() => {
                            let coreArea = bCores.reduce(
                              (s: number, c: any) =>
                                s + (turf.area(c.geometry) || 0),
                              0,
                            );
                            // If this is a podium, the tower's core passes through it!
                            if (b.id.endsWith("-podium")) {
                              const siblingTower = buildingsForMetrics.find(
                                (x: any) => x.id === b.id.replace("-podium", "-tower")
                              );
                              if (siblingTower && siblingTower.cores) {
                                coreArea += siblingTower.cores.reduce(
                                  (s: number, c: any) =>
                                    s + (turf.area(c.geometry) || 0),
                                  0
                                );
                              }
                            }
                            return (
                              <>
                                <span className="text-right text-red-400/80">
                                  −
                                  {Math.round(coreArea)}{" "}
                                  m²
                                </span>

                                <span className="font-semibold text-indigo-300 pt-1 border-t border-indigo-500/20">
                                  Available leasable area
                                </span>
                                <span className="text-muted-foreground/50 mx-2 pt-1 border-t border-indigo-500/20"></span>
                                <span className="text-right font-bold text-indigo-300 pt-1 border-t border-indigo-500/20">
                                  {Math.round(b.area - coreArea)} m²
                                </span>
                              </>
                            );
                          })()}

                          <span className="text-muted-foreground pl-2 text-[10px] mt-1 italic">
                            Generated unit target area
                          </span>
                          <span className="text-muted-foreground/50 mx-2 mt-1"></span>
                          <span className="text-right text-emerald-400 mt-1">
                            {Math.round(
                              bUnits.reduce(
                                (s: number, u: any) => s + (u.targetArea || 0),
                                0,
                              ),
                            )}{" "}
                            m²
                          </span>
                        </div>
                        <div className="mt-2 text-[10px] text-muted-foreground/60 italic text-center">
                          (Generated units will never mathematically exceed
                          Available leasable space)
                        </div>
                      </div>
                    )}

                    {/* Floors */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        Floors ({bFloors.length} total: {occFloors.length}{" "}
                        occupiable, {parkFloors.length} parking,{" "}
                        {utilFloors.length} utility)
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {bFloors.map((f: any, fi: number) => {
                          // Defensive normalization: some floor fields may be objects
                          const rawFType = f?.type;
                          const rawUtilType = f?.utilityType;
                          const fType =
                            typeof rawFType === "string"
                              ? rawFType
                              : rawFType && typeof rawFType === "object"
                                ? (rawFType as any).type ||
                                  (rawFType as any).name ||
                                  String((rawFType as any).id)
                                : String(rawFType || "");
                          const utilType =
                            typeof rawUtilType === "string"
                              ? rawUtilType
                              : rawUtilType && typeof rawUtilType === "object"
                                ? (rawUtilType as any).utilityType ||
                                  (rawUtilType as any).type ||
                                  (rawUtilType as any).name ||
                                  String((rawUtilType as any).id)
                                : String(rawUtilType || "");

                          const bg =
                            fType === "Parking"
                              ? "bg-amber-500/30 border-amber-500/40"
                              : fType === "Utility"
                                ? "bg-orange-500/30 border-orange-500/40"
                                : "bg-blue-500/20 border-blue-500/30";
                          const label =
                            fType === "Parking"
                              ? `P${f.level !== undefined ? f.level : fi}`
                              : fType === "Utility"
                                ? utilType || "Util"
                                : `F${f.level !== undefined ? f.level : fi}`;
                          const heightStr =
                            typeof f.height === "number" ||
                            typeof f.height === "string"
                              ? `${f.height}`
                              : f.height && typeof f.height === "object"
                                ? String(
                                    f.height.value ??
                                      f.height.height ??
                                      JSON.stringify(f.height),
                                  )
                                : "";
                          return (
                            <span
                              key={f.id || fi}
                              className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${bg}`}
                              title={`${fType} | Height: ${heightStr}m | Level: ${f.level}`}
                            >
                              {label}
                              <span className="ml-1 text-muted-foreground text-[10px]">
                                {heightStr}m
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Units */}
                    <div>
                      <div className="text-xs font-bold text-muted-foreground mb-2">
                        Units & Sellable Area ({bUnits.length}) — Dual
                        Calculation
                      </div>
                      {bUnits.length === 0 ? (
                        <div className="text-xs text-muted-foreground/60 italic">
                          No units
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Method A: Actual Geometry */}
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                              📐 Method A — Actual Geometry (turf.area)
                            </div>
                            <div className="text-xs text-muted-foreground/80 italic mb-1.5">
                              Area computed from generated unit polygons
                            </div>
                            <div className="space-y-1">
                              {(() => {
                                // Calculate actual area per type from polygons
                                const typeRealAreas: Record<
                                  string,
                                  { count: number; area: number }
                                > = {};
                                let totalRealArea = 0;

                                bUnits.forEach((u: any) => {
                                  const typ = u.type || "Unit";
                                  if (!typeRealAreas[typ])
                                    typeRealAreas[typ] = { count: 0, area: 0 };
                                  typeRealAreas[typ].count++;

                                  try {
                                    const a =
                                      u.targetArea || turf.area(u.geometry);
                                    typeRealAreas[typ].area += a;
                                    totalRealArea += a;
                                  } catch (e) {
                                    /* ignore */
                                  }
                                });

                                const bGfa = Math.round(
                                  b.area * occFloors.length,
                                );

                                return (
                                  <>
                                    {Object.entries(typeRealAreas)
                                      .sort((a, b) => b[1].count - a[1].count)
                                      .map(([type, data]) => {
                                        const avgUnit =
                                          data.count > 0
                                            ? Math.round(data.area / data.count)
                                            : 0;
                                        const perFloorCount = Math.max(
                                          1,
                                          Math.round(
                                            data.count / occFloors.length,
                                          ),
                                        );
                                        return (
                                          <div
                                            key={type}
                                            className="flex items-center justify-between text-sm"
                                          >
                                            <span>
                                              {data.count} × {type}{" "}
                                              <span className="text-xs text-muted-foreground italic">
                                                ({perFloorCount}/fl @ ~{avgUnit}
                                                m²)
                                              </span>
                                            </span>
                                            <span className="font-bold text-emerald-500 flex items-center gap-2">
                                              {Math.round(data.area)} m²
                                            </span>
                                          </div>
                                        );
                                      })}
                                    <div className="flex items-center justify-between text-sm font-bold border-t border-emerald-500/20 pt-1 mt-1">
                                      <span>Total Unit Area (All Floors)</span>
                                      <span className="text-emerald-500">
                                        {Math.round(totalRealArea)} m² (
                                        {bGfa > 0
                                          ? Math.round(
                                              (totalRealArea / bGfa) * 100,
                                            )
                                          : 0}
                                        % of GFA)
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                      <span>Average per floor</span>
                                      <span>
                                        {Math.round(
                                          totalRealArea /
                                            Math.max(1, occFloors.length),
                                        )}{" "}
                                        m²
                                      </span>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </div>

                          {/* Method B: Theoretical Typology Sizing */}
                          <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2.5">
                            <div className="text-xs font-bold text-teal-600 dark:text-teal-400 mb-1">
                              📋 Method B — Theoretical Typology Estimation
                            </div>
                            <div className="text-xs text-muted-foreground/80 italic mb-1.5">
                              Based on nominal unit sizes given per typology
                            </div>
                            <div className="space-y-1.5">
                              {Object.entries(unitBD)
                                .sort((a, b) => b[1] - a[1])
                                .map(([type, count]) => {
                                  // Find the exact target size for this typology from the building's unitMix
                                  const mixEntry = (
                                    (b as any).unitMix || []
                                  ).find((m: any) => m.name === type);

                                  // Use exact size if found (Method B theoretical), otherwise compute actual average from generated
                                  let targetSqm = 0;
                                  if (mixEntry && mixEntry.area > 0) {
                                    targetSqm = mixEntry.area;
                                  } else {
                                    const matchingUnits = bUnits.filter(
                                      (u: any) => u.type === type,
                                    );
                                    targetSqm =
                                      matchingUnits.length > 0
                                        ? Math.round(
                                            matchingUnits.reduce(
                                              (sum: number, u: any) =>
                                                sum + (u.targetArea || 0),
                                              0,
                                            ) / matchingUnits.length,
                                          )
                                        : 0;
                                  }

                                  const typeGfa = Math.round(count * targetSqm);
                                  const sqft = Math.round(targetSqm * 10.7639);
                                  const perFloorCount = Math.max(
                                    1,
                                    Math.round(count / occFloors.length),
                                  );

                                  return (
                                    <div
                                      key={type}
                                      className="rounded bg-teal-500/10 px-2 py-1"
                                    >
                                      <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium">
                                          {count} × {type}{" "}
                                          <span className="font-normal text-xs text-muted-foreground italic">
                                            ({perFloorCount}/fl)
                                          </span>
                                        </span>
                                        <span className="font-bold text-teal-600 dark:text-teal-400">
                                          {typeGfa} m²
                                        </span>
                                      </div>
                                      <div className="text-xs text-muted-foreground/80 italic mt-0.5">
                                        = {count} units × {targetSqm} m² ({sqft}{" "}
                                        sqft)
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Cores — Full Breakdown: Geometry + Formula + % Methods */}
                    <div>
                      {(() => {
                        // ═══ METHOD A: Actual Geometry Area ═══
                        const coreGeomAreas: any[] = [];
                        
                        const processCoreArr = (coresArr: any[], suffix: string = "") => {
                          coresArr.forEach((c: any) => {
                            const rawCoreType = c?.type;
                            const displayCoreType =
                              typeof rawCoreType === "string"
                                ? rawCoreType
                                : rawCoreType && typeof rawCoreType === "object"
                                  ? (rawCoreType as any).type ||
                                    (rawCoreType as any).name ||
                                    (rawCoreType as any).utilityType ||
                                    String((rawCoreType as any).id || "Core")
                                  : String(rawCoreType || "Core");
                            try {
                              coreGeomAreas.push({
                                type: displayCoreType + suffix,
                                area: Math.round(turf.area(c.geometry)),
                              });
                            } catch {
                              coreGeomAreas.push({ type: displayCoreType + suffix, area: 0 });
                            }
                          });
                        };

                        processCoreArr(bCores);

                        // If this is a podium, append the sibling tower's cores passing through
                        if (b.id.endsWith("-podium")) {
                          const siblingTower = buildingsForMetrics.find(
                            (x: any) => x.id === b.id.replace("-podium", "-tower")
                          );
                          if (siblingTower && siblingTower.cores) {
                             processCoreArr(siblingTower.cores, " (Tower shaft)");
                          }
                        }

                        const totalGeomArea = coreGeomAreas.reduce(
                          (s: number, c: any) => s + c.area,
                          0,
                        );

                        // ═══ METHOD B: NBC Formula (layout-generator.ts) ═══
                        const floorArea = b.area;
                        const floors = b.numFloors || occFloors.length || 1;
                        const floorH = b.typicalFloorHeight || 3.5;
                        const bldgH = floors * floorH;
                        const use = String(b.intendedUse || "Residential");
                        const isRes = use === "Residential";
                        const isComm =
                          use === "Commercial" ||
                          use === "Office" ||
                          use === "Industrial";
                        const isInst =
                          use === "Institutional" ||
                          use === "Public" ||
                          use === "Utility";

                        const estUnitSize = 140;
                        const unitsPerFloor = isRes
                          ? Math.max(
                              1,
                              Math.floor((floorArea * 0.75) / estUnitSize),
                            )
                          : 0;
                        const popPerFloor = isRes
                          ? unitsPerFloor * 5
                          : isComm
                            ? Math.round(floorArea / 10)
                            : isInst
                              ? Math.round(floorArea / 6)
                              : Math.round(floorArea / 10);

                        // ═══ METHOD B: NBC Formula (building-core-calc.ts) ═══

                        let useType:
                          | "Residential"
                          | "Commercial"
                          | "Institutional" = "Residential";
                        if (use === "Commercial") useType = "Commercial";
                        else if (
                          use === "Hospitality" ||
                          use === "Institutional"
                        )
                          useType = "Institutional";

                        const coreBreakdown =
                          calculateBuildingCoreAndCirculation({
                            footprintArea: floorArea,
                            numFloors: floors,
                            avgUnitArea: 140, // assume avg 2BHK size for estimation
                            intendedUse: useType,
                          });

                        const nbcTotal = Math.round(
                          coreBreakdown.totalCoreAreaPerFloor +
                            coreBreakdown.totalCirculationAreaPerFloor,
                        );

                        // ═══ METHOD C: Flat % (development-calc.ts) ═══
                        const bGfa = Math.round(floorArea * floors);
                        const coreFactor = 0.15;
                        const circFactor = 0.12;
                        const pctCoreArea = Math.round(bGfa * coreFactor);
                        const pctCircArea = Math.round(bGfa * circFactor);
                        const pctTotal = pctCoreArea + pctCircArea;

                        let liftsEqParts = [];
                        if (coreBreakdown.passLiftCount > 0)
                          liftsEqParts.push(
                            `${coreBreakdown.passLiftCount} Pass`,
                          );
                        if (coreBreakdown.fireLiftCount > 0)
                          liftsEqParts.push(
                            `${coreBreakdown.fireLiftCount} Fire`,
                          );
                        if (coreBreakdown.serviceLiftCount > 0)
                          liftsEqParts.push(
                            `${coreBreakdown.serviceLiftCount} Service`,
                          );
                        if (coreBreakdown.stretcherLiftCount > 0)
                          liftsEqParts.push(
                            `${coreBreakdown.stretcherLiftCount} Stretcher`,
                          );

                        let shaftsEqParts = ["Plumb", "Elec", "Fire"];
                        if (coreBreakdown.garbageShaftArea > 0)
                          shaftsEqParts.push("Garbage");
                        if (coreBreakdown.hvacShaftArea > 0)
                          shaftsEqParts.push("HVAC");
                        if (coreBreakdown.medicalGasShaftArea > 0)
                          shaftsEqParts.push("MedGas");

                        const nbcItems = [
                          {
                            label: "🛗 Lifts",
                            val: coreBreakdown.liftArea.toFixed(1),
                            eq: `${coreBreakdown.liftCount} total: ${liftsEqParts.join(", ")}`,
                          },
                          {
                            label: "🪜 Stairs",
                            val: `${coreBreakdown.stairArea}`,
                            eq: `${coreBreakdown.stairCount} stairs × ${Math.round(coreBreakdown.stairArea / coreBreakdown.stairCount)}m²`,
                          },
                          {
                            label: "🚪 Lobby",
                            val: `${coreBreakdown.liftLobbyArea}`,
                            eq: `${coreBreakdown.liftCount} lifts × ${Math.round(coreBreakdown.liftLobbyArea / coreBreakdown.liftCount)}m²`,
                          },
                          {
                            label: "🚶 Corridor",
                            val: `${coreBreakdown.corridorArea}`,
                            eq: `Circulation logic based on unit count`,
                          },
                          {
                            label: "🔧 Shafts",
                            val: `${coreBreakdown.totalShaftArea.toFixed(1)}`,
                            eq: shaftsEqParts.join(" + "),
                          },
                        ];
                        if (coreBreakdown.fireCheckLobbyArea > 0) {
                          nbcItems.push({
                            label: "🔥 Fire Lobby",
                            val: `${coreBreakdown.fireCheckLobbyArea}`,
                            eq: `Required > 24m height`,
                          });
                        }
                        if (
                          coreBreakdown.refugeAreaPerFloor &&
                          coreBreakdown.refugeAreaPerFloor > 0
                        ) {
                          nbcItems.push({
                            label: "🛡️ Refuge Area",
                            val: coreBreakdown.refugeAreaPerFloor.toFixed(1),
                            eq: `Avg distributed per floor`,
                          });
                        }

                        return (
                          <>
                            <div className="text-xs font-bold text-muted-foreground mb-2">
                              Core & Circulation — Dual Calculation
                            </div>

                            {/* Method A: Actual Geometry */}
                            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5 mb-2">
                              <div className="text-xs font-bold text-cyan-400 mb-1">
                                📐 Method A — Actual Geometry (turf.area)
                              </div>
                              <div className="text-xs text-muted-foreground/80 italic mb-1.5">
                                Area computed from generated core polygon(s)
                              </div>
                              {coreGeomAreas.length === 0 ? (
                                <div className="text-xs text-muted-foreground/60 italic">
                                  No core geometry
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {coreGeomAreas.map((c: any, ci: number) => (
                                    <div
                                      key={ci}
                                      className="flex items-center justify-between text-sm"
                                    >
                                      <span>
                                        Core {ci + 1} ({c.type})
                                      </span>
                                      <span className="font-bold text-cyan-400">
                                        {c.area} m²
                                      </span>
                                    </div>
                                  ))}
                                  <div className="flex items-center justify-between text-sm font-bold border-t border-cyan-500/20 pt-1">
                                    <span>Per Floor (geometry)</span>
                                    <span className="text-cyan-400">
                                      {totalGeomArea} m² (
                                      {floorArea > 0
                                        ? Math.round(
                                            (totalGeomArea / floorArea) * 100,
                                          )
                                        : 0}
                                      % of {Math.round(floorArea)}m²)
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground/70 italic">
                                    All {floors} floors ={" "}
                                    {totalGeomArea * floors} m² total core
                                    geometry
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Method B: NBC Formula */}
                            <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5 mb-2">
                              <div className="text-xs font-bold text-purple-400 mb-1">
                                📋 Method B — NBC Formula (layout-generator)
                              </div>
                              <div className="text-xs text-muted-foreground/80 italic mb-1.5">
                                Component-by-component per NBC norms: pop/floor
                                = {popPerFloor}
                              </div>
                              <div className="space-y-1">
                                {nbcItems.map((item, ii) => (
                                  <div
                                    key={ii}
                                    className="rounded bg-purple-500/10 px-2 py-1"
                                  >
                                    <div className="flex items-center justify-between text-sm">
                                      <span>{item.label}</span>
                                      <span className="font-bold text-purple-400">
                                        {item.val} m²
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground/60 italic">
                                      = {item.eq}
                                    </div>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between text-sm font-bold border-t border-purple-500/20 pt-1">
                                  <span>Per Floor (NBC)</span>
                                  <span className="text-purple-400">
                                    {nbcTotal} m² (
                                    {floorArea > 0
                                      ? Math.round((nbcTotal / floorArea) * 100)
                                      : 0}
                                    %)
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Method C: Flat % (development-calc) */}
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 mb-2">
                              <div className="text-xs font-bold text-amber-400 mb-1">
                                📊 Method C — Flat % (development-calc.ts)
                              </div>
                              <div className="text-xs text-muted-foreground/80 italic mb-1.5">
                                Used by feasibility stats: GFA × fixed factors
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                  <span>Core (lifts, stairs, shafts)</span>
                                  <span className="font-bold text-amber-400">
                                    {pctCoreArea} m²
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground/60 italic">
                                  = {bGfa} m² GFA × {coreFactor * 100}% ={" "}
                                  {pctCoreArea} m²
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span>Circulation (corridors, lobbies)</span>
                                  <span className="font-bold text-amber-400">
                                    {pctCircArea} m²
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground/60 italic">
                                  = {bGfa} m² GFA × {circFactor * 100}% ={" "}
                                  {pctCircArea} m²
                                </div>
                                <div className="flex items-center justify-between text-sm font-bold border-t border-amber-500/20 pt-1">
                                  <span>Combined (core+circ)</span>
                                  <span className="text-amber-400">
                                    {pctTotal} m² (27% GFA)
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Comparison */}
                            <div className="rounded-lg border border-border/50 bg-secondary/10 p-2 text-xs">
                              <div className="font-bold mb-1">
                                ⚖️ Comparison (per floor):
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                  <span className="text-cyan-400 font-bold">
                                    {totalGeomArea}
                                  </span>{" "}
                                  m²
                                  <br />
                                  <span className="text-muted-foreground">
                                    Geometry
                                  </span>
                                </div>
                                <div>
                                  <span className="text-purple-400 font-bold">
                                    {nbcTotal}
                                  </span>{" "}
                                  m²
                                  <br />
                                  <span className="text-muted-foreground">
                                    NBC Formula
                                  </span>
                                </div>
                                <div>
                                  <span className="text-amber-400 font-bold">
                                    {Math.round(pctTotal / floors)}
                                  </span>{" "}
                                  m²
                                  <br />
                                  <span className="text-muted-foreground">
                                    Flat 27%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Internal Utilities */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                        Internal Utilities ({bInternals.length})
                      </div>
                      {bInternals.length === 0 ? (
                        <div className="text-xs text-muted-foreground/60 italic">
                          None
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {bInternals.map((u: any, ui: number) => {
                            const iuArea = Math.round(
                              u.targetArea || u.area || 0,
                            );
                            const bFloorGfa = Math.round(b.area);
                            // Normalize internal utility name/type to safe strings
                            const rawIUType = u?.type;
                            const rawIUName = u?.name;
                            const displayIUType =
                              typeof rawIUType === "string"
                                ? rawIUType
                                : rawIUType && typeof rawIUType === "object"
                                  ? (rawIUType as any).utilityType ||
                                    (rawIUType as any).type ||
                                    (rawIUType as any).name ||
                                    String((rawIUType as any).id)
                                  : "";
                            const displayIUName =
                              typeof rawIUName === "string"
                                ? rawIUName
                                : displayIUType || String(u?.id || "Utility");
                            const iuType = (
                              displayIUType ||
                              displayIUName ||
                              ""
                            ).toLowerCase();
                            let iuNote = "";
                            if (
                              iuType.includes("hvac") ||
                              iuType.includes("ahu")
                            ) {
                              iuNote = `${bFloorGfa} m² floor × 3% mechanical ratio = ${Math.round(bFloorGfa * 0.03)} m²`;
                            } else if (
                              iuType.includes("elec") ||
                              iuType.includes("panel") ||
                              iuType.includes("db")
                            ) {
                              iuNote = `${bFloorGfa} m² floor × 1.5% electrical ratio = ${Math.round(bFloorGfa * 0.015)} m²`;
                            } else if (
                              iuType.includes("pump") ||
                              iuType.includes("water")
                            ) {
                              iuNote = `1 pump room per ${occFloors.length} floors (~${Math.round(bFloorGfa * 0.01)} m²)`;
                            } else if (
                              iuType.includes("fire") ||
                              iuType.includes("sprinkler")
                            ) {
                              iuNote = `Fire service room: NBC min 12 m² per ${occFloors.length} floors`;
                            } else if (
                              iuType.includes("solar") ||
                              iuType.includes("pv")
                            ) {
                              iuNote = `${bFloorGfa} m² rooftop → ${Math.round(bFloorGfa / 10)} kWp capacity`;
                            } else {
                              iuNote = `${iuArea} m² = ~${bFloorGfa > 0 ? Math.round((iuArea / bFloorGfa) * 100) : 0}% of floor area`;
                            }
                            return (
                              <div
                                key={ui}
                                className="rounded-md bg-secondary/30 px-2.5 py-1.5 border border-border/30"
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <span className="font-medium">
                                    {displayIUName}
                                  </span>
                                  <span className="font-bold">
                                    {iuArea}{" "}
                                    <span className="text-xs font-normal text-muted-foreground">
                                      m²
                                    </span>
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground/70 italic mt-0.5">
                                  = {iuNote}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Parking in building */}
                    {parkFloors.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1">
                          Parking Floors ({parkFloors.length})
                        </div>
                        <div className="space-y-1">
                          {parkFloors.map((pf: any, pi: number) => (
                            <div
                              key={pi}
                              className="flex items-center justify-between text-xs bg-amber-500/10 rounded px-2 py-1 border border-amber-500/20"
                            >
                              <span>
                                {pf.parkingType || "Parking"} (L{pf.level})
                              </span>
                              <div className="flex gap-3">
                                <span>{pf.parkingCapacity || "?"} spaces</span>
                                {(pf.evStations || 0) > 0 && (
                                  <span className="text-cyan-400">
                                    ⚡ {pf.evStations} EV
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))}
        </div>
      </Section>

      {/* ══════════ SITE UTILITIES ══════════ */}
      <Section title={`⚡ Site Utilities (${allUtilityAreas.length} zones)`}>
        {allUtilityAreas.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No utilities placed
          </div>
        ) : (
          <div className="space-y-2">
            {allUtilityAreas.map((u, i) => {
              // Determine formula/rationale per type — with actual values
              // u.type or u.name may sometimes be objects (from different data sources).
              // Normalize to safe display strings to avoid rendering objects as React children.
              const rawType = u?.type;
              const rawName = u?.name;
              const displayType =
                typeof rawType === "string"
                  ? rawType
                  : rawType && typeof rawType === "object"
                    ? (rawType as any).utilityType ||
                      (rawType as any).type ||
                      String(rawType)
                    : "";
              const displayName =
                typeof rawName === "string"
                  ? rawName
                  : displayType || String(u?.id || "Utility");
              const uType = (displayType || "").toLowerCase();
              const uArea = Math.round(u.targetArea || u.area || 0);
              const totalOccupants = Math.round(
                (allUnits.length || metrics.totalUnits) * 4,
              ); // avg 4 per unit
              const totalGfa = Math.round(gfa);
              const totalFootprintVal = Math.round(totalFootprint);
              const totalRooftop = Math.round(
                buildingsForMetrics.reduce(
                  (s: number, b: any) => s + (b.area || 0),
                  0,
                ),
              );
              const kva = Math.round((totalGfa * 10) / 1000); // 10 W/m²
              const dgKva = Math.round(kva * 0.375); // ~37.5% average of 25-50%
              const dailyWaterKL =
                Math.round(((totalOccupants * 50) / 1000) * 10) / 10; // 50L/person in kL
              const stpKLD = Math.round(dailyWaterKL * 0.8 * 10) / 10; // 80% of water
              const kWp = Math.round((totalRooftop / 10) * 10) / 10;
              const rwh = Math.round(totalPlotArea * 0.8); // 80% runoff coefficient approx
              let calcNote = "";
              if (
                uType.includes("ugt") ||
                (uType.includes("water") &&
                  !uType.includes("wtp") &&
                  !uType.includes("rainwater"))
              ) {
                calcNote = `~50L × ${totalOccupants} persons ÷ 1000 = ${dailyWaterKL} kL/day → ${uArea} m² tank`;
              } else if (uType.includes("rwh") || uType.includes("rainwater")) {
                calcNote = `${Math.round(totalPlotArea)} m² plot × 0.8 runoff = ${rwh} m³ catchment → ${uArea} m²`;
              } else if (uType.includes("stp") || uType.includes("sewage")) {
                calcNote = `${dailyWaterKL} kL/day × 80% = ${stpKLD} kLD sewage → ${uArea} m² plant`;
              } else if (uType.includes("wtp")) {
                calcNote = `${dailyWaterKL} kL/day demand → WTP sized → ${uArea} m²`;
              } else if (
                uType.includes("transformer") ||
                uType.includes("electrical")
              ) {
                calcNote = `${totalGfa} m² GFA × 10 W/m² ÷ 1000 = ${kva} kVA → ${uArea} m² yard`;
              } else if (uType.includes("dg") || uType.includes("generator")) {
                calcNote = `${kva} kVA transformer × 37.5% backup = ${dgKva} kVA DG → ${uArea} m²`;
              } else if (uType.includes("solar") || uType.includes("pv")) {
                calcNote = `${totalRooftop} m² rooftop ÷ 10 = ${kWp} kWp capacity → ${uArea} m²`;
              } else if (uType.includes("fire")) {
                calcNote = `NBC min 50,000L + ${Math.round(totalGfa / 1000) * 1000} m² GFA-based → ${uArea} m² tank`;
              } else if (uType.includes("hvac")) {
                calcNote = `${totalGfa} m² GFA × 0.1 m²/m² (mech room ratio) → ${uArea} m²`;
              } else if (
                uType.includes("road") ||
                uType.includes("peripheral")
              ) {
                calcNote = `Road width × perimeter length = ${Math.round(Math.sqrt(totalPlotArea) * 5)} m² (est.) → ${uArea} m²`;
              } else {
                calcNote = `${uArea} m² placed on plot`;
              }
              return (
                <div
                  key={u.id || i}
                  className="rounded-md bg-secondary/20 px-3 py-2 border border-border/30"
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                      <span className="font-medium">{displayName}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold">
                        {uArea}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          m²
                        </span>
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {displayType || "—"}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground/70 italic pl-6 mt-0.5">
                    = {calcNote}
                  </div>
                </div>
              );
            })}
            <div className="border-t border-border/30 pt-2">
              <Row
                label="Total Utility Area"
                value={Math.round(
                  allUtilityAreas.reduce(
                    (s: number, u: any) => s + (u.targetArea || u.area || 0),
                    0,
                  ),
                ).toLocaleString()}
                unit="m²"
                formula={`Σ all utility zones: ${allUtilityAreas.map((u: any) => Math.round(u.targetArea || u.area || 0) + "m²").join(" + ")}`}
              />
            </div>
          </div>
        )}

        {/* ══════════ SUSTAINABILITY & INFRA (building-calc.tsx integration) ══════════ */}
        <div className="mt-4 border-t border-border/50 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Infrastructure Requirements (NBC/IS Standards)
            </div>
          </div>
          {(() => {
            // We use a local component state for the toggle scoped to this render iteration

            // For max FAR, we don't have metrics.maxFAR. But we can derive it from project constraints if it exists, or assume a default like 5.0 (which is the default in building-calc and properties-panel). Let's use 5.0 as a robust default maxFAR if not explicitly set.
            const maxFAR =
              (activeProject as any)?.feasibilityParams?.maxFAR || 5.0;
            const maxGFA = totalPlotArea * maxFAR;
            // Estimate max units based on avg unit size of current drawn units, or fallback
            const avgUnitSize =
              allUnits.length > 0 ? totalFootprint / allUnits.length : 100; // rough generic fallback
            const maxUnits = Math.round(maxGFA / avgUnitSize);
            const maxOccupants = Math.round(maxUnits * 4);
            // Estimate roof area at max capacity (assuming same ground coverage ratio roughly, or just max permissible coverage)
            const maxGroundCoverage = totalPlotArea * 0.5; // 50% max coverage typical

            const activeGfaTotal = useMaxCapacity ? maxGFA : Math.round(gfa);
            const activeNumUnits = useMaxCapacity
              ? maxUnits
              : allUnits.length || metrics.totalUnits || 1;
            const activeTotalOccupants = useMaxCapacity
              ? maxOccupants
              : Math.round((allUnits.length || metrics.totalUnits) * 4);
            const activeRoofArea = useMaxCapacity
              ? maxGroundCoverage
              : Math.round(
                  buildingsForMetrics.reduce(
                    (s: number, b: any) => s + (b.area || 0),
                    0,
                  ),
                );
            const avgFloors =
              buildingsForMetrics.length > 0
                ? Math.round(
                    buildingsForMetrics.reduce(
                      (s: number, b: any) => s + (b.numFloors || 1),
                      0,
                    ) / buildingsForMetrics.length,
                  )
                : 1;

            // Base calculations from building-calc.tsx
            const waterPerCapita = 135;
            const sewagePerCapita = 120;
            const dailyWaterDemand =
              (activeTotalOccupants * waterPerCapita) / 1000; // kL/day
            const stpCapacity =
              (activeTotalOccupants * sewagePerCapita * 1.2) / 1000; // kL/day
            const wtpCapacity = dailyWaterDemand * 1.2;

            // Area requirements
            const stpAreaReq = Math.round(stpCapacity * 8); // 8 m²/KLD
            const wtpAreaReq = Math.round(wtpCapacity * 6); // 6 m²/KLD
            const ugTankAreaReq = Math.round(dailyWaterDemand * 0.4); // depth 2.5m
            const ohTankAreaReq = Math.round(dailyWaterDemand * 0.33 * 0.5); // 8hrs storage, depth 2m

            // Fire (NBC Part 4)
            const hydrantCount = Math.ceil(avgFloors / 5) * 2;
            const fireTankVol =
              (Math.max(hydrantCount * 40, (((300 * 5) / 1000) * 1000) / 60) *
                30) /
              1000; // 30 min storage
            const fireTankAreaReq = Math.max(20, Math.ceil(fireTankVol / 3.0)); // depth 3m (matches layout-generator)

            // Electrical
            const totalLoadKW = activeTotalOccupants * 0.8 * 0.7; // 0.8kW/person, 0.7 diversity
            const essentialLoad = totalLoadKW * 0.4;
            const dgCapacity = essentialLoad * 1.25; // 25% margin
            const dgAreaReq = Math.round((dgCapacity / 500) * 25); // 25m² per 500kVA
            const subAreaReq =
              Math.max(25, Math.ceil(40 + (activeNumUnits / 100) * 15)) +
              Math.max(20, Math.ceil(20 + (activeNumUnits / 100) * 8)); // Substation + Transformer

            // Waste & Other
            const owcCapacity = activeTotalOccupants * 0.3; // kg/day
            const owcAreaReq = Math.round(owcCapacity * 0.5 + 10);

            // RWH
            const annualRainfall = 1200; // mm
            const rwhRunoff = activeRoofArea * (annualRainfall / 1000) * 0.85;
            const rwhDemandCap = (activeTotalOccupants * 30 * 30) / 1000; // 30L/person for 30 days
            const rwhStorage = Math.min(rwhRunoff * 0.15, rwhDemandCap); // 15% of annual runoff or 30 days demand
            const rwhAreaReq = Math.round(rwhStorage * 0.4); // depth 2.5m (1/2.5 = 0.4)

            // Solar PV
            const solarCapacity = totalLoadKW * 0.25; // 25% of peak load
            const solarAreaReq = Math.round(solarCapacity * 10); // 10 sqm/kW

            // Helper to sum provided areas by simple keyword match
            // Prefer targetArea (intended formula size) over area (clipped geometry)
            const getProvided = (keywords: string[]) =>
              Math.round(
                allUtilityAreas
                  .filter((u) =>
                    keywords.some(
                      (kw) =>
                        (u.type || "").toLowerCase().includes(kw) ||
                        (u.name || "").toLowerCase().includes(kw),
                    ),
                  )
                  .reduce((s, u) => s + (u.targetArea || u.area || 0), 0),
              );

            const reqData = [
              {
                label: "STP (Sewage Trtmt)",
                req: stpAreaReq,
                prov: getProvided(["stp", "sewage"]),
                formula: `Pop ${activeTotalOccupants} × ${sewagePerCapita}L × 1.2 = ${stpCapacity.toFixed(0)}m³/d × 8m²/KLD = ${stpAreaReq}m²`,
              },
              {
                label: "WTP (Water Trtmt)",
                req: wtpAreaReq,
                prov: getProvided(["wtp", "water tr"]),
                formula: `Pop ${activeTotalOccupants} × ${waterPerCapita}L × 1.2 = ${wtpCapacity.toFixed(0)}m³/d × 6m²/KLD = ${wtpAreaReq}m²`,
              },
              {
                label: "UG Water Tank",
                req: ugTankAreaReq,
                prov: getProvided(["ugt", "underground"]),
                formula: `Daily Demand ${dailyWaterDemand.toFixed(0)}m³ ÷ 2.5m depth = ${ugTankAreaReq}m²`,
              },
              {
                label: "Fire Tank + Pump",
                req: fireTankAreaReq + 30,
                prov: getProvided(["fire"]),
                formula: `[Vol ${fireTankVol.toFixed(0)}m³ ÷ 3m] + 30m² Pump Room = ${fireTankAreaReq + 30}m²`,
              },
              {
                label: "DG Room",
                req: dgAreaReq,
                prov: getProvided(["dg", "generator"]),
                formula: `Load ${essentialLoad.toFixed(0)}kW × 1.25 = ${dgCapacity.toFixed(0)}kVA → 25m²/500kVA = ${dgAreaReq}m²`,
              },
              {
                label: "Substation/Transf.",
                req: subAreaReq,
                prov: getProvided(["substation", "transformer", "electrical"]),
                formula: `Base 40m² + (${activeNumUnits} units ÷ 100 × 15) = ${subAreaReq}m²`,
              },
              {
                label: "Organic Waste (OWC)",
                req: owcAreaReq,
                prov: getProvided(["owc", "organic", "waste", "garbage"]),
                formula: `${owcCapacity.toFixed(0)}kg/day × 0.5m²/kg + 10m² = ${owcAreaReq}m²`,
              },
              {
                label: "RWH Storage Tank",
                req: rwhAreaReq,
                prov: getProvided(["rwh", "rainwater", "harvest"]),
                formula: `min(Runoff ${rwhRunoff.toFixed(0)}m³ × 15%, Demand ${rwhDemandCap.toFixed(0)}m³) = ${rwhStorage.toFixed(0)}m³ ÷ 2.5m depth = ${rwhAreaReq}m²`,
              },
            ];

            const totalReq = reqData.reduce((s, d) => s + d.req, 0);

            return (
              <div className="space-y-4">
                {/* Base inputs from plot/buildings */}
                <div className="rounded border border-border/50 bg-secondary/10 p-2 text-xs relative overflow-hidden">
                  {/* <div className="absolute top-0 right-0 p-1.5 flex items-center gap-2 bg-yellow-400/10 border-b border-l border-yellow-400/20 rounded-bl z-10">
                    <Switch
                      checked={useMaxCapacity}
                      onCheckedChange={setUseMaxCapacity}
                    />
                    <span className="text-[10px] font-bold text-yellow-600 dark:text-yellow-500 uppercase">
                      Max Permissible Capacity
                    </span>
                  </div> */}

                  <div className="font-bold text-muted-foreground mb-1.5 border-b border-border/40 pb-1 w-[200px]">
                    ⚙️ Calculation Parameters
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-3 text-[11px] relative z-0 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Units:</span>{" "}
                      <span className="font-bold">{activeNumUnits}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">
                        Avg Occupancy:
                      </span>{" "}
                      <span className="font-bold">4 / unit</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Total Pop:</span>{" "}
                      <span className="font-bold">
                        {activeTotalOccupants} pax
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Avg Floors:</span>{" "}
                      <span className="font-bold">{avgFloors} F</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Site Area:</span>{" "}
                      <span className="font-bold">
                        {Math.round(totalPlotArea).toLocaleString()} m²
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">
                        Built-up (GFA):
                      </span>{" "}
                      <span
                        className={cn(
                          "font-bold",
                          useMaxCapacity && "text-yellow-600",
                        )}
                      >
                        {activeGfaTotal.toLocaleString()} m²
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">
                        Roof/Grnd Cvg:
                      </span>{" "}
                      <span className="font-bold">
                        {activeRoofArea.toLocaleString()} m²
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">
                        Annual Rain:
                      </span>{" "}
                      <span className="font-bold">{annualRainfall} mm</span>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 text-xs">
                  <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                    <div className="font-bold text-emerald-600 mb-1.5 flex items-center justify-between">
                      <span>☀️ Solar PV Potential</span>
                      <span>{solarCapacity.toFixed(1)} kWp</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>Panel Area Req:</span>
                      <span className="font-semibold text-foreground">
                        {solarAreaReq} m²
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>Avail Roof Area:</span>
                      <span className="font-semibold text-foreground">
                        {activeRoofArea} m²
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 italic mt-1 border-t border-emerald-500/10 pt-1">
                      Target: 25% of {totalLoadKW.toFixed(0)}kW peak load
                    </div>
                  </div>
                  <div className="rounded border border-blue-500/20 bg-blue-500/5 p-2.5">
                    <div className="font-bold text-blue-600 mb-1.5 flex items-center justify-between">
                      <span>💧 Water Balance</span>
                      <span>{dailyWaterDemand.toFixed(0)} kL/day</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>STP Treated Reuse:</span>
                      <span className="font-semibold text-foreground">
                        {(stpCapacity * 0.8).toFixed(0)} kL/day
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>RWH Annual Harvest:</span>
                      <span className="font-semibold text-foreground">
                        {rwhRunoff.toFixed(0)} m³
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 italic mt-1 border-t border-blue-500/10 pt-1">
                      Pop {activeTotalOccupants} × 135 L/person/day
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-12 text-xs font-bold text-muted-foreground pb-1 border-b border-border/40 px-2">
                    <div className="col-span-5">System</div>
                    <div className="col-span-3 text-right">Required</div>
                    <div className="col-span-4 text-right pr-2">
                      Provided / Status
                    </div>
                  </div>

                  {reqData.map((d, i) => {
                    const isMet = d.prov >= d.req;
                    return (
                      <div key={i} className="group relative">
                        <div className="grid grid-cols-12 text-sm items-center py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                          <div className="col-span-5 font-medium">
                            {d.label}
                          </div>
                          <div className="col-span-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                            {d.req} m²
                          </div>
                          <div className="col-span-4 text-right flex items-center justify-end gap-2 pr-2">
                            <span
                              className={`font-bold ${d.prov === 0 ? "text-muted-foreground/50" : isMet ? "text-blue-500" : "text-amber-500"}`}
                            >
                              {d.prov} m²
                            </span>
                            {d.prov > 0 ? (
                              isMet ? (
                                <CheckCircle className="h-3.5 w-3.5 text-blue-500" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              )
                            ) : (
                              <span className="h-3.5 w-3.5" />
                            )}
                          </div>
                        </div>
                        {/* Tooltip formula on hover */}
                        <div className="hidden group-hover:block absolute z-10 left-4 top-full mt-1 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border whitespace-nowrap">
                          <strong>Calculation:</strong> {d.formula}
                        </div>
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-12 text-sm items-center py-2 px-2 mt-1 border-t border-border/40 font-bold bg-muted/30 rounded">
                    <div className="col-span-5">Total Utility Ground Area</div>
                    <div className="col-span-3 text-right text-emerald-600 dark:text-emerald-400">
                      {totalReq} m²
                    </div>
                    <div className="col-span-4 text-right opacity-70">
                      {Math.round((totalReq / totalPlotArea) * 100)}% of Site
                    </div>
                  </div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-xs p-2.5 rounded flex items-start gap-2 border border-amber-200 dark:border-amber-900/50">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    Hover over any row to see the exact formula from NBC/IS
                    standards. Note that some utilities (UG tanks, fire tanks,
                    pump rooms) are typically placed in basements, reducing the
                    surface land area requirement.
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      </Section>

      {/* ══════════ PARKING ══════════ */}
      <Section title="🅿️ Parking Summary">
        {(() => {
          const parkBase = Math.ceil((allUnits.length || metrics.totalUnits) * 1.5);
          const parkGuest = Math.ceil(parkBase * 0.1);
          const parkTotal = parkBase + parkGuest;
          return (
            <>
              <Row
                label="Total Spaces"
                value={totalParkingSpaces}
                accent="text-primary"
                formula={`Surface (${allParkingAreas.reduce((s, p) => s + (p.capacity || 0), 0)}) + Building floors (${allParkingFloors.reduce((s, f) => s + (f.parkingCapacity || 0), 0)})`}
              />
              <Row
                label="Required (1.5 ECS)"
                value={parkBase}
                formula={`Total Units (${allUnits.length || metrics.totalUnits}) × 1.5 ECS/unit`}
              />
              <Row
                label="Guest (10%)"
                value={parkGuest}
                formula={`${parkBase} × 10% guest parking`}
              />
              <Row
                label="Total Required"
                value={parkTotal}
                accent="text-amber-400"
                formula={`${parkBase} base + ${parkGuest} guest`}
              />
              <Row
                label="Status"
                value={totalParkingSpaces >= parkTotal ? "✓ Compliant" : "✗ Deficit"}
                accent={totalParkingSpaces >= parkTotal ? "text-green-400" : "text-red-400"}
              />
              <Row label="Basement" value={metrics.parking.breakdown.basement} />
              <Row label="Stilt" value={metrics.parking.breakdown.stilt} />
              <Row label="Surface" value={metrics.parking.breakdown.surface} />
              {allParkingFloors.reduce((s, f) => s + (f.evStations || 0), 0) > 0 && (
                <Row
                  label="EV Charging Points"
                  value={allParkingFloors.reduce((s, f) => s + (f.evStations || 0), 0)}
                  accent="text-cyan-400"
                  formula="Units × 1.5 × 0.2 (split across basements)"
                />
              )}
            </>
          );
        })()}
      </Section>

      {/* ══════════ EFFICIENCY ══════════ */}
      <Section title="📈 Efficiency">
        <Row
          label="Net/Gross Efficiency"
          value={`${(metrics.efficiency * 100).toFixed(1)}%`}
          accent="text-blue-400"
          formula={`(GFA − Core − Circulation − Services − Amenities) ÷ GFA`}
        />
        <Row
          label="Total Units"
          value={allUnits.length > 0 ? allUnits.length : metrics.totalUnits}
          formula={
            allUnits.length > 0
              ? "Σ actual units from all buildings"
              : `GFA ÷ 100 = ${Math.round(gfa)} ÷ 100`
          }
        />
        <Row label="Total Cores" value={allCores.length} />
        <Row
          label="Green Area / Capita"
          value={metrics.greenArea.perCapita.toFixed(1)}
          unit="m²/person"
        />
        {metrics.roadArea > 0 && (
          <Row
            label="Road Area"
            value={Math.round(metrics.roadArea).toLocaleString()}
            unit="m²"
          />
        )}
      </Section>
    </div>
  );
}

// ─── COST SIMULATOR ──────────────────────────────────────────────────────────
interface SimulatorTabProps {
  estimates: any | null;
  isLoading: boolean;
}
function CostSimulatorTab({ estimates, isLoading }: SimulatorTabProps) {
  if (isLoading)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">
        Running cost simulation...
      </div>
    );
  if (!estimates)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Configure Admin Parameters to run cost simulation
      </div>
    );
  if (!estimates.simulation)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Building simulation data... Please wait or generate building to
        calculate cost simulation
      </div>
    );

  const sim = estimates.simulation;
  const bd = estimates.cost_breakdown;
  const totalCost = estimates.total_construction_cost;
  const totalRev = estimates.total_revenue;
  const profit = estimates.potential_profit;
  const roi = estimates.roi_percentage;

  const fmtCr = (v: number) => `₹${(v / 10000000).toFixed(1)} Cr`;


  // ----- New: Additional Site Cost Components (Road, Parking, Boundary Wall) -----
  // We'll read plot/metric data directly so these values auto-update with project changes.
  const project = useProjectData();
  const metrics = useDevelopmentMetrics(project || null);

  // Areas and perimeter (safely handle missing geometry)
  const roadArea = metrics?.roadArea || 0; // m² (engine provides roadArea when utilityAreas include Roads)
  const parkingArea = (project?.plots || [])
    .flatMap((p) => p.parkingAreas || [])
    .reduce((s, pa) => s + (pa.area || 0), 0);
  const totalPerimeter = (project?.plots || []).reduce((s, p) => {
    try {
      // Ensure we compute the polygon outer ring length (meters) reliably
      const coords = (p.geometry as any)?.geometry?.coordinates?.[0];
      if (!coords || coords.length === 0) return s;
      const line = turf.lineString(coords);
      const len = turf.length(line as any, { units: "meters" }) || 0;
      return s + len;
    } catch (e) {
      return s;
    }
  }, 0);

  // Rate state (user-adjustable within required ranges)
  const [roadRate, setRoadRate] = React.useState<number>(7000); // ₹/m² (5k-10k)
  const [parkingRate, setParkingRate] = React.useState<number>(7000); // ₹/m² (5k-10k)
  const [boundaryRate, setBoundaryRate] = React.useState<number>(10000); // ₹/m (9k-12k)

  // Clear display variables to avoid accidental binding mixups
  const displayRoadArea = Math.round(roadArea || 0);
  const displayParkingArea = Math.round(parkingArea || 0);
  const displayPerimeter = Math.round(totalPerimeter || 0);

  // Clamp helper to avoid out-of-range values
  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  // ─── Land Cost state (editable, persisted to project.underwriting) ───
  const [landCostInput, setLandCostInput] = React.useState<string>('');
  const landCostInitRef = React.useRef(false);

  React.useEffect(() => {
    if (project?.underwriting?.actualLandPurchaseCost && !landCostInitRef.current) {
      setLandCostInput(String(project.underwriting.actualLandPurchaseCost));
      landCostInitRef.current = true;
    }
  }, [project?.underwriting?.actualLandPurchaseCost]);

  const landCostValue = parseFloat(landCostInput) || 0;
  const landCostWithStamp = landCostValue * 1.065; // +6.5% stamp/registration/legal

  // Save land cost to project underwriting on change
  React.useEffect(() => {
    if (landCostValue > 0 && project?.id) {
      const timer = setTimeout(() => {
        const uw = project.underwriting || {};
        useBuildingStore.getState().actions.updateProject(project.id, {
          underwriting: { ...uw, actualLandPurchaseCost: landCostValue },
        });
        useBuildingStore.getState().actions.saveCurrentProject();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [landCostValue, project?.id]);

  // Calculations (reactive)
  const roadMin = Math.round(5000 * roadArea);
  const roadMax = Math.round(10000 * roadArea);

  const parkingMin = Math.round(5000 * parkingArea);
  const parkingMax = Math.round(10000 * parkingArea);

  const boundaryMin = Math.round(9000 * totalPerimeter);
  const boundaryMax = Math.round(12000 * totalPerimeter);

  const formatToCr = (value: number) => {
    return `${(value / 10000000).toFixed(2)} Cr`;
  };

  // Adjust simulated totals to include these site-level costs for display
  const adj_cost_p10 = sim
    ? sim.cost_p10 + roadMin + parkingMin + boundaryMin
    : 0;
  const adj_cost_p50 = sim
    ? sim.cost_p50 + roadMin + parkingMin + boundaryMin
    : 0;
  const adj_cost_p90 = sim
    ? sim.cost_p90 + roadMin + parkingMin + boundaryMin
    : 0;

  // Calculate revenue and profit ranges based on cost ranges (including land)
  // Revenue is typically fixed; profit varies inversely with cost
  const totalCostWithLand_p10 = adj_cost_p10 + landCostWithStamp;
  const totalCostWithLand_p90 = adj_cost_p90 + landCostWithStamp;

  const profit_p10 = totalRev - totalCostWithLand_p90; // Lowest profit (highest cost)
  const profit_p90 = totalRev - totalCostWithLand_p10; // Highest profit (lowest cost)

  // Calculate ROI ranges: ROI = (Profit / Total Cost incl. Land) × 100
  const roi_p10 = totalCostWithLand_p90 > 0 ? (profit_p10 / totalCostWithLand_p90) * 100 : 0;
  const roi_p90 = totalCostWithLand_p10 > 0 ? (profit_p90 / totalCostWithLand_p10) * 100 : 0;

  return (
    <div className="space-y-4 pb-4">
      {/* Summary Hero — Range-based */}
      <div className="grid grid-cols-4 gap-2">
        <div className="p-2.5 rounded-lg border bg-slate-500/10 border-slate-500/20 text-center flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Project Cost (P10–P90)
          </div>
          <div className="text-base font-bold">
            {fmtCr(totalCostWithLand_p10)} – {fmtCr(totalCostWithLand_p90)}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-center flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Profit (P10–P90)
          </div>
          <div className="text-base font-bold text-emerald-400">
            {fmtCr(profit_p10)} – {fmtCr(profit_p90)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Est. Revenue: {fmtCr(totalRev)}
          </div>
        </div>
        <div
          className={cn(
            "p-2.5 rounded-lg border text-center flex flex-col justify-center",
            profit > 0
              ? "bg-blue-500/10 border-blue-500/20"
              : "bg-red-500/10 border-red-500/20",
          )}
        >
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            ROI (P10–P90)
          </div>
          <div
            className={cn(
              "text-base font-bold",
              profit > 0 ? "text-blue-400" : "text-red-400",
            )}
          >
            {roi_p10.toFixed(1)}% – {roi_p90.toFixed(1)}%
          </div>
        </div>
        
        {/* Land Cost Input Card */}
        <div className="p-2.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-center flex flex-col justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-center gap-1 mb-0.5 whitespace-nowrap">
            Land Cost
            {landCostValue > 0 && (
              <span className="text-[9px] normal-case opacity-70">
                (w/ stamp: {fmtCr(landCostWithStamp)})
              </span>
            )}
          </div>
          <input
            type="number"
            className="w-full flex-1 min-w-0 bg-transparent text-center text-base font-bold text-amber-500 placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-amber-500/50 rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="Enter Land Cost (₹)"
            value={landCostInput}
            onChange={(e) => setLandCostInput(e.target.value)}
          />
        </div>
      </div>

      {/* Cost Histogram */}
      {sim && (
        <SimHistogram
          data={sim.cost_histogram}
          p10={sim.cost_p10}
          p50={sim.cost_p50}
          p90={sim.cost_p90}
          formatFn={fmtCr}
          title="Cost Distribution (Monte Carlo)"
          color="#3b82f6"
        />
      )}

      {/* Cost CDF */}
      {sim && (
        <SimCDF
          data={sim.cost_cdf}
          p50={sim.cost_p50}
          p90={sim.cost_p90}
          formatFn={fmtCr}
          title="Cost Probability (CDF)"
        />
      )}

      {/* Cost Sensitivity */}
      {sim && sim.cost_sensitivity.length > 0 && (
        <SimTornado
          data={sim.cost_sensitivity}
          formatFn={fmtCr}
          title="Cost Sensitivity (Tornado)"
        />
      )}

      {/* Cost Component Box Plot */}
      {sim && sim.cost_components_raw && (
        <SimBoxPlot data={sim.cost_components_raw} />
      )}

      {/* Cost vs Time Scatter Plot */}
      {sim && sim.cost_raw && sim.time_raw && (
        <SimScatterCostTime costData={sim.cost_raw} timeData={sim.time_raw} />
      )}

      {/* Cost Breakdown with ranges */}
      <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          Cost Breakdown
        </div>
        {(() => {
          const costCategories = [
            { label: "Earthwork", value: bd.earthwork, color: "#f59e0b" },
            { label: "Structure", value: bd.structure, color: "#3b82f6" },
            { label: "Finishing", value: bd.finishing, color: "#8b5cf6" },
            { label: "Services", value: bd.services, color: "#10b981" },
            { label: "Contingency", value: bd.contingency, color: "#ef4444" },
          ];
          const totalParts =
            costCategories.reduce((s, c) => s + c.value, 0) || 1;
          return (
            <>
              <div className="flex h-3 rounded-full overflow-hidden gap-[1px] mb-2">
                {costCategories.map((c) => (
                  <div
                    key={c.label}
                    className="transition-all duration-700"
                    style={{
                      width: `${(c.value / totalParts) * 100}%`,
                      backgroundColor: c.color,
                    }}
                    title={`${c.label}: ₹${(c.value / 10000000).toFixed(2)} Cr`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {costCategories.map((c) => (
                  <div
                    key={c.label}
                    className="flex items-center gap-1.5 text-[10px]"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="ml-auto font-medium">
                      {(c.value / 10000000).toFixed(2)} Cr
                    </span>
                  </div>
                ))}
              </div>
              {/* Total Construction Cost */}
              <div className="flex items-center gap-1.5 text-[10px] p-2 rounded bg-secondary/30 border border-border/20">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0 bg-slate-400" />
                <span className="font-semibold text-foreground">
                  Construction Total
                </span>
                <span className="ml-auto font-bold text-blue-400">
                  {(totalParts / 10000000).toFixed(2)} Cr
                </span>
              </div>
            </>
          );
        })()}
      </div>

      {/* New: Site-Level Additional Costs */}

      <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          Site-level Costs
        </div>

        <div className="grid grid-cols-3 gap-5 text-xs">
          {/* Road */}
          <div className="col-span-3 md:col-span-1 flex flex-col gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">
                Road Cost (Range)
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold" data-qa="road-value">
                  {displayRoadArea.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">m²</span>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground italic mt-1">
                Unit: ₹/m² (5,000–10,000)
              </div>
            </div>

            <div className="rounded p-2 bg-secondary/20 border border-border/20">
              <div className="text-xs text-muted-foreground">Road Cost</div>
              <div className="font-bold">
                {formatToCr(roadMin)} – {formatToCr(roadMax)}
              </div>
            </div>
          </div>

          {/* Parking */}
          <div className="col-span-3 md:col-span-1 flex flex-col gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">
                Parking Cost (Range)
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold" data-qa="parking-value">
                  {displayParkingArea.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">m²</span>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground italic mt-1">
                Unit: ₹/m² (5,000–10,000)
              </div>
            </div>

            <div className="rounded p-2 bg-secondary/20 border border-border/20">
              <div className="text-xs text-muted-foreground">Parking Cost</div>
              <div className="font-bold">
                {formatToCr(parkingMin)} – {formatToCr(parkingMax)}
              </div>
            </div>
          </div>

          {/* Boundary */}
          <div className="col-span-3 md:col-span-1 flex flex-col gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">
                Boundary Wall (Range)
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold" data-qa="boundary-value">
                  {displayPerimeter.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">m</span>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground italic mt-1">
                Unit: ₹/m (9,000–12,000)
              </div>
            </div>

            <div className="rounded p-2 bg-secondary/20 border border-border/20">
              <div className="text-xs text-muted-foreground">Boundary Wall</div>
              <div className="font-bold">
                {formatToCr(boundaryMin)} – {formatToCr(boundaryMax)}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* S-Curve Cash-Flow Band */}
      {sim && (
        <SimSCurveBand
          p10={sim.scurve_p10}
          p50={sim.scurve_p50}
          p90={sim.scurve_p90}
          totalMonths={sim.time_p50}
          revenueTarget={totalRev}
          title="Cash-Flow S-Curve (Uncertainty Band)"
        />
      )}

      {/* Phase Breakdown — Cost */}
      {sim && sim.phases.length > 0 && (
        <PhaseBreakdownChart
          phases={sim.phases}
          title={`Phase-wise Cost Breakdown (${sim.numPhases} Phases)`}
          mode="cost"
        />
      )}

      {/* Utility Costs */}
      {sim && sim.utility_costs.length > 0 && (
        <UtilityCostsTable
          items={sim.utility_costs}
          total={sim.total_utility_cost}
          totalMin={sim.total_utility_cost_min}
          totalMax={sim.total_utility_cost_max}
        />
      )}

      {/* Total Project Cost */}
      {sim && (
        <div className="rounded-lg border p-3 bg-gradient-to-r from-slate-700/20 to-slate-600/20 border-slate-500/30">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Total Project Cost
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 rounded bg-slate-600/20 border border-slate-500/20 text-center">
              <div className="text-[10px] text-muted-foreground">
                P10 (Optimistic)
              </div>
              <div className="text-sm font-bold text-slate-300">
                {fmtCr(adj_cost_p10 || sim.cost_p10)}
              </div>
            </div>
            <div className="p-2 rounded bg-slate-600/20 border border-slate-500/20 text-center">
              <div className="text-[10px] text-muted-foreground">
                P50 (Expected)
              </div>
              <div className="text-sm font-bold text-slate-300">
                {fmtCr(adj_cost_p50 || sim.cost_p50)}
              </div>
            </div>
            <div className="p-2 rounded bg-slate-600/20 border border-slate-500/20 text-center">
              <div className="text-[10px] text-muted-foreground">
                P90 (Pessimistic)
              </div>
              <div className="text-sm font-bold text-slate-300">
                {fmtCr(adj_cost_p90 || sim.cost_p90)}
              </div>
            </div>
          </div>

          {/* Show added infra cost breakdown */}
          <div className="mt-3 text-[11px] text-muted-foreground border-t border-border/10 pt-2">
            <div className="flex justify-between">
              <span>Additional Site Costs</span>
              {/* <span className="font-bold">₹{additionalInfraCost.toLocaleString()}</span> */}
            </div>
            <div className="text-[11px] text-muted-foreground/70 italic mt-1">
              Includes Road, Parking & Boundary Wall estimates (user-adjustable
              rates)
            </div>
          </div>
        </div>
      )}

      {/* Per-Building Table */}
      {estimates.breakdown && estimates.breakdown.length > 0 && (
        <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
          <div className="flex items-center gap-1.5 mb-2">
            <Building className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Per-Building Cost
            </span>
          </div>
          <div className="space-y-1.5">
            {estimates.breakdown.map((b: any, i: number) => {
              const pct = (b.cost.total / totalCost) * 100;
              const costDisplay = `${(b.cost.total / 10000000).toFixed(2)} Cr`;
              return (
                <div key={i} className="text-[10px]">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-muted-foreground truncate mr-2">
                      {b.buildingName}
                    </span>
                    <span className="font-semibold shrink-0">
                      {costDisplay}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-400/70 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TIME SIMULATOR ───────────────────────────────────────────────────────────
function TimeSimulatorTab({ estimates, isLoading }: SimulatorTabProps) {
  const [numDeliveryPhases, setNumDeliveryPhases] = React.useState(3);

  if (isLoading)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">
        Running time simulation...
      </div>
    );
  if (!estimates)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Configure Admin Parameters to run time simulation
      </div>
    );
  if (!estimates.simulation)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Building simulation data... Please wait or generate building to
        calculate time simulation
      </div>
    );

  const sim = estimates.simulation;
  const phases = estimates.timeline?.phases;
  const totalMonths = estimates.timeline?.total_months || 0;

  // Generate delivery phases from building breakdown with current phase count
  const deliveryPhases =
    estimates.breakdown && estimates.breakdown.length > 0
      ? generateDeliveryPhases(
          estimates.breakdown as any, // The breakdown has the right shape
          numDeliveryPhases,
        )
      : sim?.delivery_phases || [];

  const fmtMo = (v: number) => `${v.toFixed(1)} mo`;

  return (
    <div className="space-y-4 pb-4">
      {/* Summary — Range-based */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg border bg-blue-500/10 border-blue-500/20 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Duration (P10–P90)
          </div>
          <div className="text-xl font-bold text-blue-400">
            {sim
              ? `${sim.time_p10.toFixed(1)} – ${sim.time_p90.toFixed(1)} months`
              : "months (Critical Path)"}
          </div>
          {sim && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Median: {sim.time_p50.toFixed(1)} months
            </div>
          )}
        </div>
        <div className="p-2.5 rounded-lg border bg-purple-500/10 border-purple-500/20 text-center flex flex-col items-center justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Efficiency
          </div>
          <div
            className={cn(
              "text-xl font-bold",
              estimates.efficiency_metrics.status === "Optimal"
                ? "text-green-400"
                : estimates.efficiency_metrics.status === "Inefficient"
                  ? "text-red-400"
                  : "text-yellow-400",
            )}
          >
            {((estimates.efficiency_metrics?.achieved || 0) * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Time Histogram */}
      {sim && (
        <SimHistogram
          data={sim.time_histogram}
          p10={sim.time_p10}
          p50={sim.time_p50}
          p90={sim.time_p90}
          formatFn={fmtMo}
          title="Duration Distribution (Monte Carlo)"
          color="#8b5cf6"
        />
      )}

      {/* Time CDF */}
      {sim && (
        <SimCDF
          data={sim.time_cdf}
          p50={sim.time_p50}
          p90={sim.time_p90}
          formatFn={fmtMo}
          title="Completion Probability (CDF)"
        />
      )}

      {/* Time Sensitivity */}
      {sim && sim.time_sensitivity.length > 0 && (
        <SimTornado
          data={sim.time_sensitivity}
          formatFn={fmtMo}
          title="Schedule Sensitivity (Tornado)"
        />
      )}

      {/* Critical Path Probability */}
      {sim &&
        sim.critical_path_probability &&
        sim.critical_path_probability.length > 0 && (
          <CriticalPathProbabilityChart data={sim.critical_path_probability} />
        )}

      {/* Gantt with Uncertainty */}
      {sim && sim.gantt.length > 0 && (
        <SimGanttUncertainty
          data={sim.gantt}
          title="Construction Timeline (Uncertainty Bands)"
        />
      )}

      {/* Phase Breakdown — Time */}
      {sim && sim.phases.length > 0 && (
        <PhaseBreakdownChart
          phases={sim.phases}
          title={`Phase-wise Timeline (${sim.numPhases} Phases)`}
          mode="time"
        />
      )}

      {/* Standard Time Delays */}
      {sim && sim.delay_breakdown && sim.delay_breakdown.length > 0 && (
        <DelayFactorsDisplay delays={sim.delay_breakdown} />
      )}

      {/* ─── DELIVERY PHASES ─────────────────────────────────────────── */}
      {deliveryPhases.length > 0 && (
        <DeliveryPhasesChart
          phases={deliveryPhases}
          numPhases={numDeliveryPhases}
          onNumPhasesChange={setNumDeliveryPhases}
          title="Project Delivery Phases"
        />
      )}

      {/* ─── STANDARD AREA-BASED TIMELINE ─────────────────────────── */}
      {estimates.standardTimeEstimates && (
        <StandardTimelineChart data={estimates.standardTimeEstimates} />
      )}

      {/* Per-Building Timeline */}
      {estimates.breakdown && estimates.breakdown.length > 0 && (
        <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
          <div className="flex items-center gap-1.5 mb-2">
            <Building className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Per-Building Timeline
            </span>
          </div>
          <div className="space-y-2">
            {(() => {
              const maxBuildingMonths =
                estimates.breakdown?.reduce(
                  (m: number, b: any) =>
                    Math.max(
                      m,
                      (b.timeline.startOffset || 0) + b.timeline.total,
                    ),
                  0,
                ) || totalMonths;
              return estimates.breakdown.map((b: any, i: number) => {
                const offsetPct =
                  ((b.timeline.startOffset || 0) / maxBuildingMonths) * 100;
                const excPct = Math.max(
                  (b.timeline.excavation || 0) > 0 ? 1.5 : 0,
                  ((b.timeline.excavation || 0) / maxBuildingMonths) * 100,
                );
                const fndPct = Math.max(
                  (b.timeline.foundation || 0) > 0 ? 1.5 : 0,
                  ((b.timeline.foundation || 0) / maxBuildingMonths) * 100,
                );
                const bsmtPct = Math.max(
                  (b.timeline.basement || 0) > 0 ? 1.5 : 0,
                  ((b.timeline.basement || 0) / maxBuildingMonths) * 100,
                );
                const structPct =
                  (b.timeline.structure / maxBuildingMonths) * 100;
                const finPct = (b.timeline.finishing / maxBuildingMonths) * 100;
                const contPct = Math.max(
                  (b.timeline.contingency || 0) > 0 ? 1.5 : 0,
                  ((b.timeline.contingency || 0) / maxBuildingMonths) * 100,
                );

                return (
                  <div key={i} className="text-[10px]">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-muted-foreground truncate mr-2">
                        {b.buildingName}
                      </span>
                      <span className="font-semibold shrink-0">
                        {(
                          (b.timeline.startOffset || 0) + b.timeline.total
                        ).toFixed(1)}{" "}
                        mo
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-secondary/40 overflow-hidden flex">
                      {offsetPct > 0 && (
                        <div style={{ width: `${offsetPct}%` }} />
                      )}
                      {excPct > 0 && (
                        <div
                          className="h-full transition-all duration-700 cursor-pointer"
                          style={{
                            width: `${excPct}%`,
                            backgroundColor: "#adfd00",
                            opacity: 0.7,
                          }}
                          title={`Earthwork & Excavation: ${(b.timeline.excavation || 0).toFixed(1)} months`}
                        />
                      )}
                      {fndPct > 0 && (
                        <div
                          className="h-full transition-all duration-700 cursor-pointer"
                          style={{
                            width: `${fndPct}%`,
                            backgroundColor: "#3b82f6",
                            opacity: 0.7,
                          }}
                          title={`Foundation: ${(b.timeline.foundation || 0).toFixed(1)} months`}
                        />
                      )}
                      {bsmtPct > 0 && (
                        <div
                          className="h-full transition-all duration-700 cursor-pointer"
                          style={{
                            width: `${bsmtPct}%`,
                            backgroundColor: "#f97316",
                            opacity: 0.7,
                          }}
                          title={`Basement Levels: ${(b.timeline.basement || 0).toFixed(1)} months`}
                        />
                      )}
                      <div
                        className="h-full transition-all duration-700 cursor-pointer"
                        style={{
                          width: `${structPct}%`,
                          backgroundColor: "#10b981",
                          opacity: 0.7,
                        }}
                        title={`Superstructure: ${b.timeline.structure.toFixed(1)} months`}
                      />
                      <div
                        className="h-full transition-all duration-700 cursor-pointer"
                        style={{
                          width: `${finPct}%`,
                          backgroundColor: "#f59e0b",
                          opacity: 0.7,
                        }}
                        title={`Finishes & MEP: ${b.timeline.finishing.toFixed(1)} months`}
                      />
                      {contPct > 0 && (
                        <div
                          className="h-full transition-all duration-700 cursor-pointer"
                          style={{
                            width: `${contPct}%`,
                            backgroundColor: "#ef4444",
                            opacity: 0.7,
                          }}
                          title={`Risk & Weather Buffer: ${(b.timeline.contingency || 0).toFixed(1)} months`}
                        />
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {[
              ["#adfd00", "Earthwork & Excavation"],
              ["#3b82f6", "Foundation"],
              ["#f97316", "Basement Levels"],
              ["#10b981", "Superstructure"],
              ["#f59e0b", "Finishes & MEP"],
              ["#ef4444", "Risk & Weather Buffer"],
            ].map(([c, l]) => (
              <div
                key={l as string}
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: c as string }}
                />
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MULTI-BUILDING BUDGET TAB ────────────────────────────────────────────────
interface MultiBuildingTabProps {
  estimates: ProjectEstimates;
  isLoading: boolean;
}

function MultiBuildingBudgetTab({
  estimates,
  isLoading,
}: MultiBuildingTabProps) {
  if (isLoading)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">
        Running cost simulation...
      </div>
    );
  if (!estimates)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No estimates available
      </div>
    );
  if (!estimates.breakdown || estimates.breakdown.length === 0)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No buildings to display
      </div>
    );

  const fmtCr = (v: number) => `₹${(v / 10000000).toFixed(1)} Cr`;
  const selectedPlot = useSelectedPlot();
  const estimateBreakdown = estimates.breakdown || [];
  const totalCost = estimates.total_construction_cost;
  const totalRev = estimates.total_revenue;
  const totalUtilities = estimates.simulation?.total_utility_cost || 0;
  const sim = estimates.simulation;

  // ─── Land Cost (must match Budget tab calculation exactly) ───
  // NOTE: landCostRaw/landCostWithStamp are calculated below after `project` is declared
  const normalizeLookup = (value: any) =>
    value == null ? "" : String(value).toLowerCase().trim();
  const getBuildingDisplayName = (building: any, index: number) => {
    const rawName =
      building?.buildingName ??
      building?.name ??
      building?.building_name ??
      building?.properties?.buildingName;

    if (typeof rawName === "string" && rawName.trim().length > 0) {
      return rawName;
    }

    if (rawName && typeof rawName === "object") {
      return (
        rawName.name ||
        rawName.label ||
        rawName.type ||
        rawName.utilityType ||
        String(rawName.id || `Building ${index + 1}`)
      );
    }

    return `Building ${index + 1}`;
  };
  const getBuildingLookupKeys = (building: any, index = 0) => {
    const displayName = getBuildingDisplayName(building, index);

    return [
      building?.id,
      building?.buildingId,
      building?.building_id,
      building?.buildingRef,
      displayName,
      building?.name,
      building?.buildingName,
      building?.building_name,
      building?.properties?.buildingName,
    ]
      .filter(Boolean)
      .map(normalizeLookup)
      .filter(Boolean);
  };

  const getBuildingFloorCount = (building: any) => {
    if (Array.isArray(building?.floors)) {
      return building.floors.length;
    }

    if (typeof building?.floors === "number") {
      return building.floors;
    }

    if (typeof building?.numFloors === "number") {
      return building.numFloors;
    }

    return 0;
  };
  const getBuildingUnitCount = (building: any) => {
    const directCount =
      building?.unitCount ??
      building?.units?.length ??
      building?.unit_count ??
      building?.properties?.units?.length;

    if (typeof directCount === "number" && directCount > 0) {
      return directCount;
    }

    if (Array.isArray(building?.floors)) {
      return building.floors.reduce(
        (sum: number, floor: any) => sum + (floor?.units?.length || 0),
        0,
      );
    }

    return 0;
  };

  // Prefer authoritative unit counts from the project data (plots/buildings).
  const project = useProjectData();

  // ─── Land Cost (must match Budget tab calculation exactly) ───
  const landCostRaw = project?.underwriting?.actualLandPurchaseCost || 0;
  const landCostWithStamp = landCostRaw * 1.065; // +6.5% stamp/registration/legal (same as Budget tab)

  const projectBuildings = (project?.plots || []).flatMap(
    (p: any) => p.buildings || [],
  );
  const projectUnitsMap: Record<string, number> = {};
  const projectNameMap: Record<string, number> = {};
  projectBuildings.forEach((pb: any) => {
    const id = pb.id || pb.buildingId || pb.building_id || null;
    const possibleNames = [
      pb.name,
      pb.buildingName,
      pb.building_name,
      pb.properties?.buildingName,
      pb.properties?.buildingNameRaw,
    ]
      .filter(Boolean)
      .map((v: any) => String(v).toLowerCase().trim());
    const unitsCount =
      (pb.units?.length ??
        (pb.floors
          ? pb.floors.reduce(
              (s: number, f: any) => s + (f.units?.length || 0),
              0,
            )
          : (pb.unitCount ?? pb.unit_count ?? 0))) ||
      0;
    if (id) projectUnitsMap[id] = unitsCount;
    possibleNames.forEach((n: string) => {
      if (n) projectNameMap[n] = unitsCount;
    });
  });

  const selectedPlotBuildings = selectedPlot?.buildings || [];
  const estimateBreakdownByKey = new Map<string, any>();
  estimateBreakdown.forEach((building: any, index: number) => {
    getBuildingLookupKeys(building, index).forEach((key) => {
      if (key && !estimateBreakdownByKey.has(key)) {
        estimateBreakdownByKey.set(key, building);
      }
    });
  });

  const matchedPlotEstimates =
    selectedPlotBuildings.length > 0
      ? selectedPlotBuildings
          .map((building: any, index: number) => {
            const keys = getBuildingLookupKeys(building, index);
            return keys
              .map((key) => estimateBreakdownByKey.get(key))
              .find(Boolean);
          })
          .filter(Boolean)
      : [];

  const usingPlotScope = selectedPlotBuildings.length > 0;
  const usingEstimateRows = !usingPlotScope || matchedPlotEstimates.length > 0;
  const rawBuildings = usingPlotScope
    ? usingEstimateRows
      ? matchedPlotEstimates
      : selectedPlotBuildings
    : estimateBreakdown;

  // Group podium/tower buildings for display/averages so we treat them as one single building
  const buildings = (() => {
    const groups: any[] = [];
    const used = new Set<string>();
    rawBuildings.forEach((b: any) => {
        const id = b?.id || b?.buildingId || '';
        if (!id || used.has(id)) {
           if (!used.has(id)) groups.push(b);
           return;
        }
        const baseId = id.replace(/-podium$/, '').replace(/-tower$/, '');
        const podium = rawBuildings.find((x: any) => (x.id || x.buildingId) === `${baseId}-podium`);
        const tower = rawBuildings.find((x: any) => (x.id || x.buildingId) === `${baseId}-tower`);
        
        if (podium && tower) {
           used.add(podium.id || podium.buildingId);
           used.add(tower.id || tower.buildingId);
           
           const pName = typeof podium.name === "string" ? podium.name : podium.buildingName || "Building";
           const cleanName = pName.replace(/\s*\(Podium\)\s*$/i, '').trim();

           groups.push({
               ...podium,
               id: baseId,
               buildingId: baseId,
               buildingName: cleanName,
               name: cleanName,
               cost: {
                   ...podium.cost,
                   total: (podium.cost?.total || 0) + (tower.cost?.total || 0),
                   ratePerSqm: ((podium.cost?.total || 0) + (tower.cost?.total || 0)) / ((podium.gfa || 1) + (tower.gfa || 0))
               },
               utilityCost: (podium.utilityCost || 0) + (tower.utilityCost || 0),
               gfa: (podium.gfa || 0) + (tower.gfa || 0),
               unitCount: getBuildingUnitCount(podium) + getBuildingUnitCount(tower)
           });
        } else {
           used.add(id);
           groups.push(b);
        }
    });
    return groups;
  })();

  // building?.cost?.total lacks the 5% contingency that totalCost has. Multiply by 1.05 so the ratio is exactly 1.0 if all buildings are selected.
  const scopedConstructionCost = usingPlotScope
    ? matchedPlotEstimates.reduce(
        (sum: number, building: any) => sum + (building?.cost?.total || 0),
        0,
      ) * 1.05
    : totalCost;
  const scopedUtilityCost = usingPlotScope
    ? matchedPlotEstimates.reduce(
        (sum: number, building: any) => sum + (building?.utilityCost || 0),
        0,
      )
    : totalUtilities;
  
  const scopedCostShare = totalCost > 0 ? scopedConstructionCost / totalCost : 1;
  const scopedUtilityShare = totalUtilities > 0 ? scopedUtilityCost / totalUtilities : 1;

  // Scale the total cost (construction P10/P90 + land) by the share percentage
  const scopedCostP10 = ((sim?.cost_p10 || 0) + landCostWithStamp) * (usingPlotScope ? scopedCostShare : 1);
  const scopedCostP90 = ((sim?.cost_p90 || 0) + landCostWithStamp) * (usingPlotScope ? scopedCostShare : 1);

  // Utility cost range from simulation scaled by the utility share
  const scopedUtilityCostMin = sim?.total_utility_cost_min ? sim.total_utility_cost_min * scopedUtilityShare : scopedUtilityCost;
  const scopedUtilityCostMax = sim?.total_utility_cost_max ? sim.total_utility_cost_max * scopedUtilityShare : scopedUtilityCost;

  const totalUnitsAcross = usingPlotScope
    ? selectedPlotBuildings.reduce(
        (sum: number, building: any) => sum + getBuildingUnitCount(building),
        0,
      )
    : projectBuildings.length > 0
      ? projectBuildings.reduce(
          (s: number, b: any) => s + getBuildingUnitCount(b),
          0,
        )
      : buildings.reduce(
          (sum: number, b: any) => sum + getBuildingUnitCount(b),
          0,
        );

  // (fallback already handled above) — single totalUnitsAcross variable used

  // Calculate budget metrics only when we are rendering estimate-derived buildings
  const usingEstimates = usingEstimateRows;
  let largestBuilding: any = null;
  let costVariance = 0;
  let avgCostPerBuilding = 0;
  let infrastructureShare = 0;
  if (usingEstimates) {
    largestBuilding = buildings.reduce((max: any, b: any) =>
      b.cost.total > max.cost.total ? b : max,
    );
    costVariance =
      Math.max(...buildings.map((b: any) => b.cost.total)) -
      Math.min(...buildings.map((b: any) => b.cost.total));
    avgCostPerBuilding = scopedConstructionCost / buildings.length;
    infrastructureShare =
      scopedUtilityCost > 0
        ? (scopedUtilityCost / (scopedConstructionCost + scopedUtilityCost)) * 100
        : 0;
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Summary Overview */}
      <div className="grid grid-cols-4 gap-2">
        <div className="p-2.5 rounded-lg border bg-slate-500/10 border-slate-500/20 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Total Buildings
          </div>
          <div className="text-xl font-bold text-slate-300">
            {buildings.length}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Total Units
          </div>
          <div className="text-xl font-bold text-emerald-300">
            {totalUnitsAcross}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border bg-blue-500/10 border-blue-500/20 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Project Cost (P10–P90)
          </div>
          <div className="text-base font-bold text-blue-400">
            {sim
              ? `${fmtCr(scopedCostP10)} - ${fmtCr(scopedCostP90)}`
              : `~${fmtCr(scopedConstructionCost + landCostWithStamp)} (est.)`}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border bg-purple-500/10 border-purple-500/20 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
            Utility Cost (P10–P90)
          </div>
          <div className="text-base font-bold text-purple-400">
            {sim
              ? `${fmtCr(scopedUtilityCostMin)} - ${fmtCr(scopedUtilityCostMax)}`
              : `~${fmtCr(scopedUtilityCost)} (est.)`}
          </div>
        </div>
      </div>

      {/* Building-wise Cost Breakdown */}
      <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          Building-wise Cost Breakdown
        </div>

        {/* Grid Header */}
        <div className="grid gap-2">
          <div className="grid grid-cols-7 gap-2 text-[11px] font-bold text-muted-foreground mb-2">
            <div>Building</div>
            <div className="text-right">~Cost (₹ Cr)</div>
            <div className="text-right">~Utility (₹ Cr)</div>
            <div className="text-right">% of Total</div>
            <div className="text-right">GFA (sqm)</div>
            <div className="text-right">Floors</div>
            <div className="text-right">Units</div>
          </div>

          {/* Building Rows */}
          {buildings.map((b: any, i: number) => {
            const pct =
              usingEstimates && scopedConstructionCost > 0
                ? (b.cost.total / scopedConstructionCost) * 100
                : 0;
            const costCr = usingEstimates ? b.cost.total / 10000000 : 0;
            const utilityCr = usingEstimates
              ? (b.utilityCost || 0) / 10000000
              : 0;
            const floorCount = getBuildingFloorCount(b);
            const buildingDisplayName = getBuildingDisplayName(b, i);
            return (
              <div
                key={i}
                className="grid grid-cols-7 gap-2 text-[10px] p-2 rounded bg-secondary/20 border border-border/20 hover:bg-secondary/30 transition"
              >
                <div className="font-semibold truncate">
                  {buildingDisplayName}
                </div>
                <div className="text-right font-bold text-emerald-400">
                  {usingEstimates ? `~${costCr.toFixed(1)}` : "N/A"}
                </div>
                <div className="text-right font-bold text-amber-400">
                  {usingEstimates ? `~${utilityCr.toFixed(2)}` : "N/A"}
                </div>
                <div className="text-right text-amber-400">
                  {usingEstimates ? `${pct.toFixed(1)}%` : "N/A"}
                </div>
                <div className="text-right text-blue-400">
                  {(b.gfa || 0).toFixed(0)}
                </div>
                <div className="text-right text-purple-400">
                  {floorCount}
                </div>
                <div className="text-right text-slate-300">
                  {(() => {
                    // Robust matching helper to handle multiple estimate/project shapes
                    const normalize = (v: any) =>
                      v == null ? "" : String(v).toLowerCase().trim();

                    const estVal =
                      b.unitCount ??
                      b.units?.length ??
                      b.unit_count ??
                      b.properties?.units?.length ??
                      null;
                    if (typeof estVal === "number" && estVal > 0) return estVal;

                    const candidateIds = [
                      b.buildingId,
                      b.building_id,
                      b.id,
                      b.buildingRef,
                    ].filter(Boolean);
                    for (const cid of candidateIds) {
                      if (cid && projectUnitsMap[cid] != null)
                        return projectUnitsMap[cid];
                    }

                    const lname = normalize(
                      b.buildingName ||
                        b.buildingname ||
                        b.name ||
                        b.building_name ||
                        b.properties?.buildingName,
                    );
                    if (lname && projectNameMap[lname] != null)
                      return projectNameMap[lname];

                    // Try fuzzy substring matching: find any project name key that is contained in lname or vice-versa
                    if (lname) {
                      for (const key of Object.keys(projectNameMap)) {
                        if (!key) continue;
                        if (lname.includes(key) || key.includes(lname))
                          return projectNameMap[key];
                      }
                    }

                    // As a last resort, try total units per building from projectBuildings by matching index-ish keys
                    return 0;
                  })()}
                </div>
              </div>
            );
          })}

          {/* Total Row */}
          <div className="grid grid-cols-7 gap-2 text-[10px] p-2 rounded bg-slate-600/20 border border-slate-500/30 font-bold mt-1">
            <div>TOTAL</div>
            <div className="text-right text-slate-300">
              ~{fmtCr(scopedConstructionCost)}
            </div>
            <div className="text-right text-slate-300">
              {sim
                ? `${fmtCr(scopedUtilityCostMin)} – ${fmtCr(scopedUtilityCostMax)}`
                : `~${fmtCr(scopedUtilityCost)}`}
            </div>
            <div className="text-right text-slate-300">100%</div>
            <div className="text-right text-slate-300">
              {buildings
                .reduce((s: number, b: any) => s + (b.gfa || 0), 0)
                .toFixed(0)}
            </div>
            <div className="text-right text-slate-300">
              {buildings.reduce(
                (s: number, b: any) => s + getBuildingFloorCount(b),
                0,
              )}
            </div>
            <div className="text-right text-slate-300">{totalUnitsAcross}</div>
          </div>
        </div>
      </div>

      {/* Cost Distribution Chart (Construction + Utility) */}
      <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          Cost Distribution (Incl. Utilities)
        </div>
        <div className="space-y-2">
          {(() => {
            const grandTotal = scopedConstructionCost + scopedUtilityCost;
            return buildings.map((b: any, i: number) => {
              const bTotal = usingEstimates
                ? b.cost.total + (b.utilityCost || 0)
                : 0;
              const pct =
                usingEstimates && grandTotal > 0
                  ? (bTotal / grandTotal) * 100
                  : 0;
              const colors = [
                "#3b82f6",
                "#8b5cf6",
                "#10b981",
                "#f59e0b",
                "#ef4444",
                "#06b6d4",
                "#ec4899",
              ];
              const color = colors[i % colors.length];
              return (
                <div key={i}>
                  <div className="flex justify-between mb-1 text-[10px]">
                    <span className="text-muted-foreground truncate">
                      {getBuildingDisplayName(b, i)}
                    </span>
                    <span className="font-semibold" style={{ color }}>
                      {usingEstimates ? `${pct.toFixed(1)}%` : "N/A"}
                    </span>
                  </div>
                  <div className="h-2 bg-secondary/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Utilities Summary */}
      {totalUtilities > 0 && (
        <div className="rounded-lg border p-3 bg-amber-500/10 border-amber-500/20">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-400 mb-2">
            Utilities Included
          </div>
          <div className="text-sm font-bold text-amber-300 mb-2">
            {sim
              ? `${fmtCr(scopedUtilityCostMin)} – ${fmtCr(scopedUtilityCostMax)}`
              : `~${fmtCr(scopedUtilityCost)}`}
          </div>
          {estimates.simulation?.utility_costs &&
            estimates.simulation.utility_costs.length > 0 && (
              <div className="space-y-1 text-[10px] text-amber-200">
                {estimates.simulation.utility_costs.map((u: any, i: number) => {
                  const rawUnit = u.unit;
                  const displayUnit =
                    typeof rawUnit === "string"
                      ? rawUnit
                      : rawUnit && typeof rawUnit === "object"
                        ? (rawUnit as any).utilityType ||
                          (rawUnit as any).type ||
                          (rawUnit as any).name ||
                          String((rawUnit as any).id)
                        : String(rawUnit || "");
                  return (
                    <div key={i} className="flex justify-between">
                      <span>
                        {u.label} {displayUnit ? `(${displayUnit})` : ""}
                      </span>
                      <span className="font-semibold">
                        {u.minAmount != null && u.maxAmount != null
                          ? `${(u.minAmount / 10000000).toFixed(2)} – ${(u.maxAmount / 10000000).toFixed(2)} Cr`
                          : `~${(u.amount / 10000000).toFixed(2)} Cr`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {/* Budget Impact & Overlap Info */}
      <div className="rounded-lg border p-3 bg-cyan-500/10 border-cyan-500/20">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-cyan-400 mb-2">
          Budget Decision Tips
        </div>
        {usingEstimates ? (
          <div className="space-y-1 text-[10px] text-cyan-200">
            <div>
              • Largest building:{" "}
              <span className="font-bold">{largestBuilding?.buildingName}</span>{" "}
              (~
              {(largestBuilding?.cost?.total ?? 0 / 10000000).toFixed(1)} Cr)
            </div>
            <div>
              • Average per building:{" "}
              <span className="font-bold">
                ~{(avgCostPerBuilding / 10000000).toFixed(1)} Cr
              </span>
            </div>
            <div>
              • Cost variance:{" "}
              <span className="font-bold">
                ~{(costVariance / 10000000).toFixed(1)} Cr
              </span>
            </div>
            <div>
              • Infrastructure share:{" "}
              <span className="font-bold">
                {infrastructureShare.toFixed(1)}%
              </span>{" "}
              of total
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-cyan-200">
            Estimates unavailable for the selected plot — cost metrics shown
            only when building estimates exist.
          </div>
        )}
      </div>
    </div>
  );
}

interface FeasibilityTabProps {
  estimates: any;
  isLoadingEstimates: boolean;
}

function FeasibilityTab({ estimates, isLoadingEstimates }: FeasibilityTabProps) {
  const activeProject = useProjectData();
  const greenScorecard = useGreenScorecardStore();

  const metrics = useDevelopmentMetrics(activeProject);
  const { regulations, greenStandards, vastuRules } =
    useRegulations(activeProject);

  const uiState = useBuildingStore((state) => state.uiState);
  const toggleVastuCompass = useBuildingStore(
    (state) => state.actions.toggleVastuCompass,
  );
  const plots = useBuildingStore((state) => state.plots);
  const actions = useBuildingStore((state) => state.actions);
  const generationParams = useBuildingStore((state) => state.generationParams);
  const selectedPlot = useSelectedPlot();
  const [isGeneratingGates, setIsGeneratingGates] = useState(false);
  const [gatesGenerated, setGatesGenerated] = useState(false);
  // Vastu incremental loading state (UI-only)
  const [vastuVisibleCount, setVastuVisibleCount] = useState(10);

  const handleSuggestVastuGates = () => {
    if (!plots || plots.length === 0) return;
    setIsGeneratingGates(true);
    try {
      plots.forEach((plot) => {
        if (!plot.geometry) return;
        const bbox = turf.bbox(plot.geometry);
        const center: [number, number] = [
          (bbox[0] + bbox[2]) / 2,
          (bbox[1] + bbox[3]) / 2,
        ];
        const newGates = generateVastuGates(
          plot.geometry,
          center,
          plot.roadAccessSides || [],
        );
        if (newGates.length > 0) {
          const existingEntries = (plot.entries || []).filter(
            (e) => !e.name?.toLowerCase().includes("gate"),
          );
          actions.updatePlot(plot.id, {
            entries: [...existingEntries, ...newGates],
          });
        }
      });
      setGatesGenerated(true);
    } finally {
      setIsGeneratingGates(false);
    }
  };

  // Totals for building breakdown used in headers (prefer selected plot)
  const totalBuildings = selectedPlot
    ? (selectedPlot.buildings || []).filter((b) => !b.id.includes('-tower')).length
    : (estimates?.breakdown?.filter((b: any) => !(b.buildingId || b.id || '').includes('-tower')).length ?? 0);
  // Robust total units: prefer explicit units arrays, then unitCount fields, then project building data
  const project = useProjectData();
  const projectBuildingList = (project?.plots || []).flatMap(
    (p: any) => p.buildings || [],
  );
  const projectUnitsById: Record<string, number> = {};
  projectBuildingList.forEach((pb: any) => {
    const id = pb.id || pb.buildingId || pb.building_id || null;
    const units = pb.units?.length ?? pb.unitCount ?? pb.unit_count ?? 0;
    if (id) projectUnitsById[id] = units;
  });

  const totalUnitsCount = selectedPlot
    ? (selectedPlot.buildings || []).reduce(
        (s: number, b: any) =>
          s + (b.unitCount ?? b.units?.length ?? b.unit_count ?? 0),
        0,
      )
    : estimates?.breakdown
      ? estimates.breakdown.reduce((s: number, b: any) => {
          const est =
            b.unitCount ??
            b.units?.length ??
            b.unit_count ??
            b.properties?.units?.length ??
            null;
          if (typeof est === "number") return s + est;
          const bid = b.buildingId || b.id || b.building_id || null;
          if (bid && projectUnitsById[bid] != null)
            return s + projectUnitsById[bid];
          return s;
        }, 0)
      : 0;

  if (!metrics)
    return (
      <div className="p-4 text-center text-muted-foreground">
        Calculations pending...
      </div>
    );

  const maxFAR =
    regulations?.geometry?.floor_area_ratio?.value ||
    activeProject?.feasibilityParams?.efficiencyTarget ||
    2.5;
  const minGreenCover = greenStandards?.constraints?.minGreenCover
    ? greenStandards.constraints.minGreenCover * 100
    : 15;
  const minOpenSpace = greenStandards?.constraints?.minOpenSpace
    ? greenStandards.constraints.minOpenSpace * 100
    : 30;
  // Compute selected certification and its recommended max ground coverage (percent)
  const selectedCertRaw = activeProject?.greenCertification?.[0];
  const certLabel = selectedCertRaw
    ? selectedCertRaw.toLowerCase().includes("griha")
      ? "GRIHA"
      : selectedCertRaw.toLowerCase().includes("leed")
        ? "LEED"
        : selectedCertRaw.toLowerCase().includes("igbc")
          ? "IGBC"
          : selectedCertRaw
    : null;

  let certMaxCoverage: number | null = null;
  if (certLabel && greenStandards?.constraints) {
    if (greenStandards.constraints.maxGroundCoverage)
      certMaxCoverage = greenStandards.constraints.maxGroundCoverage * 100;
    else if (greenStandards.constraints.minOpenSpace)
      certMaxCoverage = (1 - greenStandards.constraints.minOpenSpace) * 100;
  }
  // Fallback sensible defaults when no constraints present
  if (certMaxCoverage == null && certLabel) {
    if (certLabel === "LEED") certMaxCoverage = 70;
    else if (certLabel === "GRIHA") certMaxCoverage = 75;
    else if (certLabel === "IGBC") certMaxCoverage = 80;
  }
  const maxHeight = regulations?.geometry?.max_height?.value;
  const maxCoverage = regulations?.geometry?.max_ground_coverage?.value;

  const complianceCards = [
    {
      label: "Bylaw Compliance",
      score: metrics.compliance.bylaws,
      summary: metrics.compliance.bylawScoreSummary,
      icon: ShieldCheck,
      items: (metrics.compliance.bylawItems || []).filter(
        (i: any) => i.status !== "na",
      ),
    },
    {
      label: greenScorecard.certificateType 
         ? `Green Building (${greenScorecard.certificateType})`
         : "Green Building",
      score: greenScorecard.certificateType ? greenScorecard.totalScore : (metrics.compliance.greenScoreSummary?.percentage || metrics.compliance.green),
      summary: greenScorecard.certificateType ? { maxScore: greenScorecard.maxScore } : metrics.compliance.greenScoreSummary,
      icon: CheckCircle,
      items: greenScorecard.certificateType ? greenScorecard.items : (metrics.compliance.greenItems || []).filter(
        (i: any) => i.status !== "na",
      ),
    },
    ...(activeProject?.vastuCompliant
      ? [
          {
            label: "Vastu (Shakti Chakra)",
            // UI: use the summary percentage for display when available
            score:
              metrics.compliance.vastuScoreSummary &&
              typeof metrics.compliance.vastuScoreSummary.percentage ===
                "number"
                ? metrics.compliance.vastuScoreSummary.percentage
                : metrics.compliance.vastu,
            summary: metrics.compliance.vastuScoreSummary,
            icon: Compass,
            // Include full vastu scorecard (show 'na' items too) so admin can see full diagnostics
            items: metrics.compliance.vastuItems || [],
            control: (
              <div className="space-y-2 mt-2 pt-2 border-t border-border/50">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="vastu-compass"
                    checked={uiState.showVastuCompass}
                    onCheckedChange={toggleVastuCompass}
                  />
                  <Label htmlFor="vastu-compass" className="text-xs">
                    Show Shakti Chakra Overlay
                  </Label>
                </div>
              </div>
            ),
          },
        ]
      : []),
    ...((metrics as any).greenAnalysis
      ? [
          {
            label: "Green Simulation (Beta)",
            score: (metrics as any).greenAnalysis.overall,
            icon: CheckCircle,
            items: (metrics as any).greenAnalysis.categories.flatMap(
              (cat: any) =>
                (cat.items || []).map((it: any) => ({
                  label: it.title,
                  status:
                    it.status === "pass"
                      ? "pass"
                      : it.status === "fail"
                        ? "fail"
                        : "warn",
                  detail:
                    it.feedback ||
                    (it.value != null && it.threshold != null
                      ? `${it.value} / ${it.threshold}`
                      : undefined),
                })),
            ),
          },
        ]
      : []),
  ];

  const getTrafficLight = (score: number) => {
    if (score >= 80)
      return "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]";
    if (score >= 50)
      return "bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)]";
    return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]";
  };

  /** Returns border, background-tint, icon-color per card section */
  const getCardTheme = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes("bylaw"))
      return {
        border: "border-blue-500/40",
        bg: "bg-blue-950/30",
        iconColor: "text-blue-400",
        headerBg: "bg-blue-900/20",
        accentText: "text-blue-300",
      };
    if (l.includes("green"))
      return {
        border: "border-emerald-500/40",
        bg: "bg-emerald-950/30",
        iconColor: "text-emerald-400",
        headerBg: "bg-emerald-900/20",
        accentText: "text-emerald-300",
      };
    if (l.includes("vastu"))
      return {
        border: "border-amber-500/40",
        bg: "bg-amber-950/30",
        iconColor: "text-amber-400",
        headerBg: "bg-amber-900/20",
        accentText: "text-amber-300",
      };
    // default / simulation beta
    return {
      border: "border-border/50",
      bg: "bg-secondary/20",
      iconColor: "text-muted-foreground",
      headerBg: "",
      accentText: "text-muted-foreground",
    };
  };

  const getCertLabelForScore = (score: number, cert?: string) => {
    if (!cert) return null;
    const s = Math.round(score || 0);
    const c = cert.toLowerCase();
    if (c.includes("griha")) return null; // GRIHA handled as stars
    // IGBC / LEED mapping
    if (s < 40) return "Not Certified";
    if (s < 50) return "Certified";
    if (s < 60) return "Silver";
    if (s < 80) return "Gold";
    return "Platinum";
  };

  const getGrihaStars = (score: number) => {
    const s = Math.round(score || 0);
    if (s <= 60) return "★";
    if (s <= 70) return "★★";
    if (s <= 80) return "★★★";
    if (s <= 90) return "★★★★";
    return "★★★★★";
  };

  const getVastuGrade = (score: number) => {
    const s = Math.round(score || 0);
    if (s < 50) return "Poor";
    if (s < 70) return "Average";
    if (s < 85) return "Good";
    return "Excellent";
  };

  // NOTE: Acceptance mapping removed to enforce icon-only display

  const getLabelColorClass = (label: string, type: "cert" | "vastu") => {
    if (type === "cert") {
      const l = (label || "").toLowerCase();
      if (l.includes("not")) return "text-red-500";
      if (l.includes("cert") && !l.includes("silver")) return "text-yellow-500";
      if (l.includes("silver")) return "text-emerald-500";
      if (l.includes("gold")) return "text-blue-500";
      if (l.includes("platinum")) return "text-purple-600";
      return "text-muted-foreground";
    }
    // vastu
    const v = (label || "").toLowerCase();
    if (v.includes("poor")) return "text-red-500";
    if (v.includes("average")) return "text-yellow-500";
    if (v.includes("good")) return "text-emerald-500";
    if (v.includes("excellent")) return "text-blue-500";
    return "text-muted-foreground";
  };

  const getStatusIcon = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s.includes("pass") || s.includes("achieved") || s.includes("success"))
      return <CheckCircle className="h-3 w-3 text-green-500" />;
    if (s.includes("fail") || s.includes("failed") || s.includes("reject"))
      return <XCircle className="h-3 w-3 text-red-500" />;
    return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
  };

  const sim = estimates?.simulation;

  // Calculate ROI ranges based on cost ranges (including land cost and site costs)
  const dashRoadArea = metrics?.roadArea || 0;
  const dashParkingArea = (activeProject?.plots || [])
    .flatMap((p) => p.parkingAreas || [])
    .reduce((s, pa) => s + (pa.area || 0), 0);
  const dashTotalPerimeter = (activeProject?.plots || []).reduce((s, p) => {
    try {
      const coords = (p.geometry as any)?.geometry?.coordinates?.[0];
      if (!coords || coords.length === 0) return s;
      const line = turf.lineString(coords);
      const len = turf.length(line as any, { units: "meters" }) || 0;
      return s + len;
    } catch (e) {
      return s;
    }
  }, 0);

  const dashRoadMin = Math.round(5000 * dashRoadArea);
  const dashParkingMin = Math.round(5000 * dashParkingArea);
  const dashBoundaryMin = Math.round(9000 * dashTotalPerimeter);

  const dashAdjCostP10 = sim ? sim.cost_p10 + dashRoadMin + dashParkingMin + dashBoundaryMin : 0;
  const dashAdjCostP90 = sim ? sim.cost_p90 + dashRoadMin + dashParkingMin + dashBoundaryMin : 0;

  const totalRev = estimates?.total_revenue || 0;
  const dashLandCost = (activeProject?.underwriting?.actualLandPurchaseCost || 0) * 1.065;
  
  const dashTotalCostWithLand_p10 = dashAdjCostP10 + dashLandCost;
  const dashTotalCostWithLand_p90 = dashAdjCostP90 + dashLandCost;

  const dashProfit_p10 = totalRev - dashTotalCostWithLand_p90;
  const dashProfit_p90 = totalRev - dashTotalCostWithLand_p10;

  const roi_p10 = dashTotalCostWithLand_p90 > 0
    ? (dashProfit_p10 / dashTotalCostWithLand_p90) * 100
    : 0;
  const roi_p90 = dashTotalCostWithLand_p10 > 0
    ? (dashProfit_p90 / dashTotalCostWithLand_p10) * 100
    : 0;

  const dashEstTotalCost = (estimates?.total_construction_cost || 0) + dashRoadMin + dashParkingMin + dashBoundaryMin + dashLandCost;
  const dashEstProfit = (estimates?.potential_profit || 0) - dashRoadMin - dashParkingMin - dashBoundaryMin - dashLandCost;
  const dashRoiEst = dashEstTotalCost > 0 ? (dashEstProfit / dashEstTotalCost) * 100 : (estimates?.roi_percentage || 0);

  return (
    <div className="space-y-4 pb-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-secondary/30 rounded border text-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            Green Cover
          </div>
          <div className="font-bold text-xl text-green-600">
            {metrics.greenArea.percentage.toFixed(1)}%
          </div>
        </div>
        <div className="p-3 bg-secondary/30 rounded border text-center">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">
            Road Area
          </div>
          <div className="font-bold text-xl text-slate-500">
            {(
              (metrics.roadArea / Math.max(1, metrics.totalPlotArea)) *
              100
            ).toFixed(1)}
            %
          </div>
        </div>
      </div>

      {/* Setbacks Used */}
      {generationParams?.setback != null && (
        <div className="rounded-lg border p-3 bg-secondary/20 border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Maximize2 className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold">
              Site Setbacks (Applied)
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                Front
              </div>
              <div className="font-bold text-lg">
                {generationParams.frontSetback ?? generationParams.setback}m
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                Rear
              </div>
              <div className="font-bold text-lg">
                {generationParams.rearSetback ?? generationParams.setback}m
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                Left
              </div>
              <div className="font-bold text-lg">
                {generationParams.sideSetback ?? generationParams.setback}m
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                Right
              </div>
              <div className="font-bold text-lg">
                {generationParams.sideSetback ?? generationParams.setback}m
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {complianceCards.map((card, idx) => {
          const theme = getCardTheme(card.label);
          return (
          <Card key={idx} className={cn(theme.bg, theme.border)}>
            <CardHeader className={cn("p-3 pb-2 flex flex-row items-center justify-between space-y-0 rounded-t-lg", theme.headerBg)}>
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <card.icon className={cn("h-4 w-4", theme.iconColor)} /> <span className={theme.accentText}>{card.label}</span>
                </CardTitle>

                {/* Render certification / GRIHA stars or Vastu grade beneath the header title */}
                <div className="mt-1">
                  {(() => {
                    const lbl = String(card.label || "").toLowerCase();

                    // GREEN BUILDING card -> show cert label or GRIHA stars
                    if (lbl.includes("green")) {
                      const cert = selectedCertRaw;
                      if (!cert) return null;
                      const isGriha = cert.toLowerCase().includes("griha");
                      if (isGriha) {
                        const stars = getGrihaStars(card.score || 0);
                        return (
                          <div
                            className={cn(
                              "text-sm font-medium",
                              getLabelColorClass(String(stars), "cert"),
                            )}
                          >
                            {stars}
                          </div>
                        );
                      }

                      const certLabel = getCertLabelForScore(
                        card.score || 0,
                        cert,
                      );
                      if (!certLabel) return null;
                      return (
                        <div
                          className={cn(
                            "text-sm font-medium",
                            getLabelColorClass(certLabel, "cert"),
                          )}
                        >
                          {certLabel}
                        </div>
                      );
                    }

                    // VASTU card -> show grade
                    if (lbl.includes("vastu")) {
                      const grade = getVastuGrade(card.score || 0);
                      return (
                        <div
                          className={cn(
                            "text-sm font-medium",
                            getLabelColorClass(grade, "vastu"),
                          )}
                        >
                          {grade}
                        </div>
                      );
                    }

                    return null;
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-sm text-muted-foreground text-right">
                  <div className="font-semibold text-lg">
                    {Math.round(card.score ?? 0)}{" "}
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div className="text-sm font-medium ml-2">
                  {/* subtle status dot (single indicator) */}
                  <div
                    className={`h-3 w-3 rounded-full ${getTrafficLight(card.score)}`}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="space-y-1">
                {/* Render a flat list for all card items. Each item shows label, status/value text, and status icon only. */}
                {/* Responsive tabular layout for readability */}
                <div className="overflow-x-auto mt-2">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="border-b border-border/20 text-[10px] text-muted-foreground uppercase text-right">
                        <th className="w-[35%] py-1.5 pr-2 font-medium text-left truncate">Requirement</th>
                        <th className="w-[45%] py-1.5 px-2 font-medium text-left">Observation</th>
                        <th className="w-[12%] py-1.5 px-2 text-right font-medium">Score</th>
                        <th className="w-[8%] py-1.5 pl-2 font-medium text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/10">
                      {(() => {
                        const raw = card.items || [];
                        const flat: any[] = [];
                        raw.forEach((ri: any) => {
                          if (!ri) return;
                          if (Array.isArray(ri)) ri.forEach((x) => flat.push(x));
                          else if (ri.items && Array.isArray(ri.items))
                            ri.items.forEach((x: any) => flat.push(x));
                          else flat.push(ri);
                        });
                        return flat.map((item: any, i: number) => {
                          const rawLabel = String(item.label || item.code || item.title || "");
                          const m = rawLabel.match(/^([A-Z0-9]+)\s+(.*)$/);
                          const code = m ? m[1] : item.code || null;
                          const title = m ? m[2] : item.title || item.label || rawLabel;

                          // Determine status text: prefer an explicit value field otherwise fallback to status
                          const statusText =
                            item.value !== undefined
                              ? String(item.value)
                              : item.status === "na"
                                ? "Not evaluated"
                                : item.status;

                          return (
                            <tr key={i} className="hover:bg-slate-500/5 transition-colors group">
                              {/* 1. Metric Title + Detail */}
                              <td className="py-2.5 pr-2 align-top w-full whitespace-normal">
                                <div className="flex items-start gap-2">
                                  {code && (
                                    <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 mt-0.5 whitespace-nowrap">
                                      {code}
                                    </Badge>
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium leading-5">
                                      {title}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* 2. Observation (Value / Detail) */}
                              <td className="py-2.5 px-3 align-top text-left text-[13px] text-muted-foreground whitespace-normal break-words">
                                <div className="space-y-1">
                                  {(() => {
                                    const isBylaw = card.label.toLowerCase().includes("bylaw");
                                    const isVastu = card.label.toLowerCase().includes("vastu");

                                    // Display structured score/value if present
                                    let structuredValue: React.ReactNode = null;
                                    if (isVastu && item.score != null && item.maxScore != null) {
                                      structuredValue = <div className="font-medium text-slate-300">{`${item.score} / ${item.maxScore}`}</div>;
                                    } else if (isBylaw && item.value != null && (item.limit != null || item.limitValue != null || item.threshold != null)) {
                                      const limit = item.limit ?? item.limitValue ?? item.threshold;
                                      structuredValue = <div className="font-medium text-slate-300">{`${item.value} / ${limit}`}</div>;
                                    } else if (typeof item.value === "string" && item.value.trim().length > 0) {
                                      structuredValue = <div className="font-medium text-slate-300">{item.value}</div>;
                                    } else if (typeof item.statusText === "string" && item.statusText.trim().length > 0) {
                                      structuredValue = <div className="font-medium text-slate-300">{item.statusText}</div>;
                                    } else if (typeof item.compliance === "boolean") {
                                      structuredValue = <div className="font-medium text-slate-300">{item.compliance ? "Provided" : "Not provided"}</div>;
                                    }

                                    return (
                                      <>
                                        {structuredValue}
                                        {item.detail && (
                                          <div className="text-xs leading-5 max-w-[320px]" title={item.detail}>
                                            {item.detail}
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>

                              {/* 3. Score / Contribution */}
                              <td className="py-2.5 px-3 align-top text-right min-w-[120px]">
                                {(() => {
                                  const achievedScore = (item as any).achievedScore ?? item.score ?? null;
                                  const achievedPoints = (item as any).achievedPoints ?? null;
                                  const itemMax = item.maxScore ?? (item as any).weight ?? null;
                                  const cardSummaryMax = (card as any).summary?.maxScore ?? null;
                                  
                                  let totalMax = cardSummaryMax;
                                  if (totalMax == null) {
                                    try {
                                      totalMax = (card.items || []).reduce((s: number, it: any) => s + (it.maxScore ?? it.weight ?? 0), 0) || null;
                                    } catch { totalMax = null; }
                                  }

                                  let numericAchieved: number | null = null;
                                  if (typeof achievedScore === "number") numericAchieved = achievedScore;
                                  else if (typeof achievedPoints === "number" && typeof itemMax === "number")
                                    numericAchieved = Math.round(achievedPoints * itemMax * 100) / 100;

                                  // Special Middle logic from old code (Vastu exact display)
                                  const isVastu = card.label.toLowerCase().includes("vastu");
                                  if (isVastu && item.score != null && item.maxScore != null) {
                                    return (
                                      <div className="text-[13px] font-semibold tabular-nums text-muted-foreground">
                                        {item.score} / {item.maxScore}
                                      </div>
                                    );
                                  }

                                  if (typeof numericAchieved === "number" && typeof itemMax === "number") {
                                    return (
                                      <div>
                                        <div className="text-[13px] font-medium text-muted-foreground">{`${Math.round(numericAchieved)} / ${Math.round(itemMax)}`}</div>
                                        {typeof totalMax === "number" && totalMax > 0 && (
                                          <div className="text-[10px] text-muted-foreground mt-0.5">{`Contribution: +${((numericAchieved / totalMax) * 100).toFixed(1)}%`}</div>
                                        )}
                                      </div>
                                    );
                                  }
                                  
                                  if (typeof achievedPoints === "number" && typeof totalMax === "number" && totalMax > 0) {
                                    const achievedValue = typeof itemMax === "number" ? achievedPoints * itemMax : achievedPoints;
                                    const contrib = (achievedValue / totalMax) * 100;
                                    return (
                                      <div>
                                        <div className="text-[13px] text-muted-foreground">{`${(achievedPoints * 100).toFixed(0)}%`}</div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5">{`Contribution: +${contrib.toFixed(1)}%`}</div>
                                      </div>
                                    );
                                  }
                                  
                                  const legacyPts = (item as any).points;
                                  if (legacyPts != null) {
                                    const achievedValue = typeof legacyPts === "number" ? legacyPts : parseFloat(String(legacyPts)) || 0;
                                    if (typeof totalMax === "number" && totalMax > 0) {
                                      return (
                                        <div>
                                          <div className="text-[13px] text-muted-foreground">{`${legacyPts} Pts`}</div>
                                          <div className="text-[10px] text-muted-foreground mt-0.5">{`Contribution: +${((achievedValue / totalMax) * 100).toFixed(1)}%`}</div>
                                        </div>
                                      );
                                    }
                                    return <div className="text-[13px] text-muted-foreground">{`${legacyPts} Pts`}</div>;
                                  }

                                  return null;
                                })()}
                              </td>

                              {/* 4. Status Icon */}
                              <td className="py-2.5 pl-2 align-top text-center">
                                <div className="mx-auto flex h-full justify-center pt-0.5" aria-hidden>
                                  {getStatusIcon(item.status || statusText)}
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
                {/* Vastu Load More button */}
                {card.label.toLowerCase().includes("vastu") && (
                  <div className="pt-2 text-center">
                    {/* If more local items exist, incrementally reveal; otherwise load full checklist */}
                    {(card.items || []).length > (vastuVisibleCount || 0) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setVastuVisibleCount((c) => (c || 0) + 10)
                        }
                      >
                        Load More
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => actions.loadUltimateVastuChecklist()}
                      >
                        Load More
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {card.control}
            </CardContent>
          </Card>
          );})}
      </div>

      {/* Project Estimates Section — Range-based */}
      {estimates ? (
        <div className="space-y-3">
          <div className="rounded-lg border p-3 bg-slate-50/5 border-slate-200/20">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold">
                Financial Estimates {estimates.isPotential && "(Potential)"}
              </span>
              <Badge
                variant={
                  (sim ? roi_p10 : dashRoiEst) > 15 ? "default" : "secondary"
                }
                className="ml-auto text-xs"
              >
                {sim
                  ? `ROI: ${roi_p10.toFixed(1)}% – ${roi_p90.toFixed(1)}%`
                  : `ROI: ~${dashRoiEst.toFixed(1)}% (est.)`}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {sim ? "Project Cost (P10–P90)" : "Project Cost (est.)"}
                </div>
                <div className="text-lg font-bold">
                  {sim
                    ? `₹${(dashTotalCostWithLand_p10 / 10000000).toFixed(1)} – ${(dashTotalCostWithLand_p90 / 10000000).toFixed(1)} Cr`
                    : `~₹${(dashEstTotalCost / 10000000).toFixed(2)} Cr`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {sim
                    ? `Median: ₹${((sim.cost_p50 + dashRoadMin + dashParkingMin + dashBoundaryMin + dashLandCost) / 10000000).toFixed(2)} Cr`
                    : "Run simulation for range"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  {sim ? "Profit (P10–P90)" : "Profit (est.)"}
                </div>
                <div className="text-lg font-bold text-emerald-500">
                  {sim
                    ? `₹${(dashProfit_p10 / 10000000).toFixed(1)} – ${(dashProfit_p90 / 10000000).toFixed(1)} Cr`
                    : `~₹${(dashEstProfit / 10000000).toFixed(2)} Cr`}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Est. Revenue: ₹
                  {((estimates.total_revenue || 0) / 10000000).toFixed(2)} Cr
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-blue-50/5 border-blue-200/20">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-semibold">
                Timeline & Efficiency
              </span>
              <Badge variant="outline" className="ml-auto text-xs">
                {sim
                  ? `${sim.time_p10.toFixed(1)} – ${sim.time_p90.toFixed(1)} Months`
                  : `~${(estimates.timeline?.total_months || 0).toFixed(1)} Months (est.)`}
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground mb-2 text-center">
              {sim
                ? `Median (P50): ${sim.time_p50.toFixed(1)} months`
                : "Run simulation for range"}
            </div>
            <div className="text-[10px] text-muted-foreground mb-1 italic">
              Critical-path baseline (est.):
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Excavation:</span>
                <span>
                  ~{(estimates.timeline?.phases?.excavation || 0).toFixed(1)} mo
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Foundation:</span>
                <span>
                  ~{(estimates.timeline?.phases?.foundation || 0).toFixed(1)} mo
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Superstructure:</span>
                <span>
                  ~{(estimates.timeline?.phases?.structure || 0).toFixed(1)} mo
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Finishing:</span>
                <span>
                  ~{(estimates.timeline?.phases?.finishing || 0).toFixed(1)} mo
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contingency:</span>
                <span>
                  ~{(estimates.timeline?.phases?.contingency || 2).toFixed(1)} mo
                </span>
              </div>
              <div className="pt-2 col-span-2 border-t border-border/10 flex justify-between items-center">
                <span className="text-muted-foreground">
                  Efficiency Target:
                </span>
                <div>
                  <span
                    className={cn(
                      "font-bold",
                      estimates.efficiency_metrics.status === "Optimal"
                        ? "text-green-500"
                        : estimates.efficiency_metrics.status === "Inefficient"
                          ? "text-red-500"
                          : "text-yellow-500",
                    )}
                  >
                    ~
                    {(
                      (estimates.efficiency_metrics?.achieved || 0) * 100
                    ).toFixed(0)}
                    %
                  </span>
                  {/* <span className="text-muted-foreground ml-1">
                                        / {((estimates.efficiency_metrics?.target || 0) * 100).toFixed(0)}%
                                    </span> */}
                </div>
              </div>
            </div>
          </div>

          {/* Per-Building Breakdown */}
          {estimates.breakdown && estimates.breakdown.length > 0 && (
            <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
              <div className="flex items-center gap-2 mb-2">
                <Building className="h-4 w-4 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">
                    Building Breakdown
                  </span>
                  <div className="text-[11px] text-muted-foreground">
                     {totalBuildings} buildings • {totalUnitsCount} units
                  </div>
                </div>
              </div>
              <div className="space-y-2 max-h-[150px] overflow-y-auto scrollbar-thin pr-1">
                {(() => {
                  // Use estimates.breakdown as the source of truth for cost/time.
                  // Filter to selected plot if active.
                  let baseList: any[] = estimates.breakdown || [];
                  if (selectedPlot && selectedPlot.buildings) {
                     const pBids = selectedPlot.buildings.map((x: any) => x.id);
                     baseList = baseList.filter((eb: any) => pBids.includes(eb.buildingId) || pBids.includes(eb.id));
                  }

                  const groups: any[] = [];
                  const used = new Set<string>();
                  baseList.forEach((b: any) => {
                      const id = b?.id || b?.buildingId || '';
                      if (!id || used.has(id)) {
                         if (!used.has(id)) groups.push(b);
                         return;
                      }
                      const baseId = id.replace(/-podium$/, '').replace(/-tower$/, '');
                      const podium = baseList.find((x: any) => (x.id || x.buildingId) === `${baseId}-podium`);
                      const tower = baseList.find((x: any) => (x.id || x.buildingId) === `${baseId}-tower`);
                      
                      if (podium && tower) {
                         used.add(podium.id || podium.buildingId);
                         used.add(tower.id || tower.buildingId);
                         const pName = typeof podium.buildingName === "string" ? podium.buildingName : podium.name || "Building";
                         const cleanName = pName.replace(/\s*\(Podium\)\s*$/i, '').trim();
                         groups.push({
                             ...podium,
                             id: baseId,
                             buildingId: baseId,
                             buildingName: cleanName,
                             cost: {
                                 ...podium.cost,
                                 total: (podium.cost?.total || 0) + (tower.cost?.total || 0),
                             },
                             timeline: {
                                 ...podium.timeline,
                                 total: Math.max(
                                     (podium.timeline?.startOffset || 0) + (podium.timeline?.total || 0),
                                     (tower.timeline?.startOffset || 0) + (tower.timeline?.total || 0)
                                 ) - Math.min(podium.timeline?.startOffset || 0, tower.timeline?.startOffset || 0)
                             }
                         } as any);
                      } else {
                         used.add(id);
                         groups.push(b);
                      }
                  });
                  return groups;
                })().map(
                  (b: any, idx: number) => {
                    const rawCostTotal = b && b.cost && typeof b.cost.total === "number" ? b.cost.total : 0;
                    const bCost = rawCostTotal / 10000000;
                    const costLo = sim ? (bCost * (sim.cost_p10 / sim.cost_p50)).toFixed(2) : null;
                    const costHi = sim ? (bCost * (sim.cost_p90 / sim.cost_p50)).toFixed(2) : null;
                    const bTime = b && b.timeline && typeof b.timeline.total === "number" ? b.timeline.total : 0;
                    const timeLo = sim && bTime > 0 ? (bTime * (sim.time_p10 / sim.time_p50)).toFixed(0) : null;
                    const timeHi = sim && bTime > 0 ? (bTime * (sim.time_p90 / sim.time_p50)).toFixed(0) : null;
                    
                    return (
                      <div
                        key={idx}
                        className="text-xs border-b border-border/10 pb-2 last:border-0 last:pb-0"
                      >
                        <div className="flex justify-between font-medium mb-1">
                          <span>{b.buildingName || b.name || `Building ${idx+1}`}</span>
                          <span className="text-emerald-500">
                            {sim
                              ? `₹${costLo} – ${costHi} Cr`
                              : `~₹${bCost.toFixed(2)} Cr`}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>
                            {sim
                              ? `${timeLo} – ${timeHi} mo`
                              : `~${bTime.toFixed(0)} mo`}
                          </span>
                          <span>{sim ? "" : "(est.)"}</span>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border p-4 bg-secondary/10 text-center text-xs text-muted-foreground">
          {isLoadingEstimates
            ? "Calculating estimates..."
            : "Configure Admin Parameters to see estimates"}
        </div>
      )}
    </div>
  );
}
export function FeasibilityDashboard() {
  const { uiState, projects, activeProjectId } = useBuildingStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reportType, setReportType] = useState<"feasibility" | "underwriting">(
    "feasibility",
  );
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [plannedReportType, setPlannedReportType] = useState<
    "feasibility" | "underwriting"
  >("feasibility");
  const isOpen = uiState.isFeasibilityPanelOpen ?? true;
  const plots = useBuildingStore((state) => state.plots);
  const selectedPlot = useSelectedPlot();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const setOpen = useBuildingStore(
    (state) => state.actions.setFeasibilityPanelOpen,
  );
  const generationParams = useBuildingStore((state) => state.generationParams);

  const activeProjectData = useProjectData();
  const metricsForSim = useDevelopmentMetrics(activeProjectData);
  const { estimates: simEstimates, isLoading: simLoading } =
    useProjectEstimates(activeProjectData, metricsForSim);

  // ─── Site Costs logic from Dashboard lifted for the Report ───
  const roadArea = metricsForSim?.roadArea || 0;
  const parkingArea = (activeProjectData?.plots || [])
    .flatMap((p) => p.parkingAreas || [])
    .reduce((s, pa) => s + (pa.area || 0), 0);
  const totalPerimeter = (activeProjectData?.plots || []).reduce((s, p) => {
    try {
      const coords = (p.geometry as any)?.geometry?.coordinates?.[0];
      if (!coords || coords.length === 0) return s;
      const line = turf.lineString(coords);
      const len = turf.length(line as any, { units: "meters" }) || 0;
      return s + len;
    } catch {
      return s;
    }
  }, 0);

  // demo
  const plot = plots[0];

  const buildings = plots.flatMap((p) => (p as any).buildings || []);

  const vastuResult = plot ? calculateVastuScore(plot, buildings) : null;

  const vastuScore = vastuResult?.overallScore ?? 0;

  <div className="text-sm font-medium">Vastu Score: {vastuScore}</div>;
  //end demo

  const handleExportData = () => {
    if (!activeProjectData || !metricsForSim) return;

    const exportData = {
      project: {
        id: activeProjectData.id,
        name: activeProjectData.name,
        plotArea: activeProjectData.totalPlotArea,
      },
      metrics: {
        gfa: metricsForSim.totalBuiltUpArea,
        far: metricsForSim.achievedFAR,
        groundCoveragePct: metricsForSim.groundCoveragePct,
        openSpace: metricsForSim.openSpace,
        greenAreaPct: metricsForSim.greenArea.percentage,
        parking: metricsForSim.parking,
      },
      buildings: plots.flatMap((p) =>
        p.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          footprint: b.area,
          height: b.height,
          floors: b.numFloors,
          unitCount: b.units?.length || 0,
          coreCount: b.cores?.length || 0,
        })),
      ),
      simulationEstimates: simEstimates,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProjectData.name.replace(/\s+/g, "_")}_feasibility_data.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!activeProject) return null;

  if (plots.length === 0) {
    return (
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 z-40 overflow-hidden print:overflow-visible transition-all duration-300 ease-in-out",
          isOpen ? "h-[150px]" : "h-[50px] hover:h-[60px]",
        )}
      >
        <Card className="bg-background/95 backdrop-blur-md border border-border shadow-2xl w-full h-full rounded-none border-x-0 border-b-0 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-2 h-[50px] shrink-0 border-b border-border/10">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-bold">
                {activeProject.name} Feasibility
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-muted"
              onClick={() => setOpen(!isOpen)}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </CardHeader>
          {isOpen && (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              <div className="flex flex-col items-center gap-2">
                <LocateFixed className="h-6 w-6 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Create a plot on the map to see feasibility metrics &
                  simulations.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const cardClasses =
    "bg-background/95 backdrop-blur-md border border-border shadow-2xl";

  return (
    <div
      className={cn(
        "overflow-hidden print:overflow-visible print:h-auto print:static transition-all duration-300 ease-in-out",
        isFullscreen && isOpen
          ? "fixed inset-0 top-[64px] z-[60]"
          : "absolute bottom-0 left-0 right-0 z-40",
        !isFullscreen && (isOpen ? "h-[45vh]" : "h-[50px] hover:h-[60px]"),
      )}
    >
      <Card
        className={`${cardClasses} w-full h-full rounded-none border-x-0 border-b-0 flex flex-col print:hidden`}
      >
        <CardHeader className="flex flex-row items-center justify-between p-3 pb-2 h-[50px] shrink-0 border-b border-border/10">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-bold">
              {activeProject.name} Feasibility
            </CardTitle>
            <Badge variant="secondary" className="text-xs font-normal">
              KPIs & Regulations
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {/* <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={handleExportData}>
                            Download Data
                        </Button> */}
            {isOpen && (
              <>
                <Button
                  variant={reportType === "feasibility" ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-2 text-xs print:hidden"
                  onClick={() => {
                    setPlannedReportType("feasibility");
                    setIsExportModalOpen(true);
                  }}
                >
                  Feasibility Report
                </Button>
                <Button
                  variant={
                    reportType === "underwriting" ? "default" : "outline"
                  }
                  size="sm"
                  className="h-8 px-2 text-xs print:hidden"
                  onClick={() => {
                    setPlannedReportType("underwriting");
                    setIsExportModalOpen(true);
                  }}
                >
                  Underwriting Report
                </Button>
              </>
            )}
            {isOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-muted"
                onClick={() => setIsFullscreen(!isFullscreen)}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-muted"
              onClick={() => {
                if (isFullscreen && isOpen) setIsFullscreen(false);
                setOpen(!isOpen);
              }}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>

        {/* Content Area*/}
        <div
          className={cn(
            "flex-1 min-h-0 w-full transition-opacity duration-300",
            isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          {isOpen && (
            <CardContent className="p-0 h-full">
              <Tabs
                defaultValue="feasibility"
                className="flex flex-col h-full w-full"
              >
                <div className="px-4 pt-2 shrink-0">
                  <TabsList
                    className="grid w-full gap-1"
                    style={{
                      gridTemplateColumns: `repeat(${simEstimates?.breakdown && simEstimates.breakdown.length > 1 ? 5 : 4}, 1fr)`,
                    }}
                  >
                    <TabsTrigger value="feasibility" className="text-[11px]">
                      Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="metrics" className="text-[11px]">
                      KPIs
                    </TabsTrigger>
                    <TabsTrigger value="cost" className="text-[11px]">
                      Budget
                    </TabsTrigger>
                    <TabsTrigger value="time" className="text-[11px]">
                      Timeline
                    </TabsTrigger>
                    {simEstimates?.breakdown &&
                      simEstimates.breakdown.length > 1 && (
                        <TabsTrigger value="buildings" className="text-[11px]">
                          Buildings
                        </TabsTrigger>
                      )}
                  </TabsList>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden relative">
                  <TabsContent
                    value="feasibility"
                    className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin"
                  >
                    <FeasibilityTab estimates={simEstimates} isLoadingEstimates={simLoading} />
                  </TabsContent>
                  <TabsContent
                    value="metrics"
                    className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin"
                  >
                    <MetricsTab />
                  </TabsContent>
                  <TabsContent
                    value="cost"
                    className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin"
                  >
                    <CostSimulatorTab
                      estimates={simEstimates}
                      isLoading={simLoading}
                    />
                  </TabsContent>
                  <TabsContent
                    value="time"
                    className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin"
                  >
                    <TimeSimulatorTab
                      estimates={simEstimates}
                      isLoading={simLoading}
                    />
                  </TabsContent>
                  {simEstimates?.breakdown &&
                    simEstimates.breakdown.length > 1 && (
                      <TabsContent
                        value="buildings"
                        className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin"
                      >
                        <MultiBuildingBudgetTab
                          estimates={simEstimates}
                          isLoading={simLoading}
                        />
                      </TabsContent>
                    )}
                </div>
              </Tabs>
            </CardContent>
          )}
        </div>
      </Card>
      {/* Print-only Report Wrapper */}
      <div
        id="report-print-container"
        className="hidden print:block absolute inset-0 z-[9999] bg-white print:overflow-visible print:h-auto print:static"
      >
        {activeProject && selectedPlot && reportType === "feasibility" && (
          <FeasibilityReport
            project={activeProject}
            plot={selectedPlot}
            metrics={metricsForSim}
            estimates={simEstimates}
            generationParams={generationParams}
            siteCosts={{
              totalPerimeter: Math.round(totalPerimeter),
              roadArea: Math.round(roadArea),
              parkingArea: Math.round(parkingArea),
            }}
          />
        )}
        {activeProject && selectedPlot && reportType === "underwriting" && (
          <UnderwritingReport
            project={activeProject}
            plot={selectedPlot}
            metrics={metricsForSim}
            estimates={simEstimates}
            generationParams={generationParams}
          />
        )}
      </div>

      {/* Underwriting Form Modal */}
      {activeProject && (
        <ProjectUnderwritingForm
          project={activeProject}
          isOpen={isExportModalOpen}
          reportType={plannedReportType}
          onClose={() => setIsExportModalOpen(false)}
          onSave={(data) => {
            useBuildingStore
              .getState()
              .actions.updateProject(activeProject.id, { underwriting: data });
          }}
          onContinueToPrint={() => {
            // 1. Close modal
            setIsExportModalOpen(false);
            // 2. Set the report type so the report component mounts
            setReportType(plannedReportType);
            // 3. Wait for report to render, then open in new tab
            setTimeout(() => {
              const reportEl = document.getElementById(
                "report-print-container",
              );
              if (!reportEl) return;

              const reportName =
                plannedReportType === "feasibility"
                  ? "Feasibility Report"
                  : "Underwriting Report";
              const title = `${activeProject.name || "Keystone"} - ${reportName}`;

              // Open new tab
              const printWindow = window.open("", "_blank");
              if (!printWindow) return;

              // Copy all stylesheets from the main page
              const styles = Array.from(
                document.querySelectorAll('link[rel="stylesheet"], style'),
              )
                .map((el) => el.outerHTML)
                .join("\n");

              printWindow.document.write(`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <title>${title}</title>
                                    ${styles}
                                    <style>
                                        body { background: white !important; margin: 0; }
                                        @media print {
                                            body { background: white !important; }
                                        }
                                    </style>
                                </head>
                                <body>
                                    ${reportEl.innerHTML}
                                </body>
                                </html>
                            `);
              printWindow.document.close();

              // Wait for styles to load then print
              printWindow.onload = () => {
                setTimeout(() => printWindow.print(), 500);
              };
              // Fallback if onload already fired
              setTimeout(() => printWindow.print(), 2000);
            }, 1500);
          }}
        />
      )}
    </div>
  );
}
