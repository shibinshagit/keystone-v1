"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import * as turf from "@turf/turf";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  DollarSign,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Satellite,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

import { DrawingToolbar } from "@/components/drawing-toolbar";
import { MapEditor } from "@/components/map-editor";
import { MapSearch } from "@/components/map-search";
import { DrawingStatus } from "@/components/drawing-status";
import { AnalysisMode } from "@/components/solar-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBuildingStore, useSelectedPlot } from "@/hooks/use-building-store";
import { useToast } from "@/hooks/use-toast";
import {
  BuildingIntendedUse,
  type DevelopabilityScore,
  LandPlotType,
  LandProximity,
  LandZoningPreference,
  type EvaluateLandInput,
  type Plot,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const PLOT_TYPE_OPTIONS = Object.values(LandPlotType);
const PROXIMITY_OPTIONS = Object.values(LandProximity);
const ZONING_OPTIONS = Object.values(LandZoningPreference);
const INTENDED_USE_OPTIONS = Object.values(BuildingIntendedUse);

// Schema
const evaluateLandFormSchema = z.object({
  projectName: z.string().trim().min(1, "Enter a project or opportunity name."),
  location: z.string().trim().min(1, "Enter or select a location."),
  landSize: z
    .string()
    .min(1, "Land size must be a positive number.")
    .refine((value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0;
    }, "Land size must be a positive number."),
  intendedUse: z.nativeEnum(BuildingIntendedUse, {
    errorMap: () => ({ message: "Select an intended use case." }),
  }),
  priceRange: z.string().trim().min(1, "Enter a price range or land value."),
  plotType: z.nativeEnum(LandPlotType, {
    errorMap: () => ({ message: "Select a plot type." }),
  }),
  zoningPreference: z.nativeEnum(LandZoningPreference, {
    errorMap: () => ({ message: "Select a zoning preference." }),
  }),
  proximity: z.array(z.nativeEnum(LandProximity)),
});

type EvaluateLandForm = z.infer<typeof evaluateLandFormSchema>;

interface ScoreResult {
  score: DevelopabilityScore;
  dataSources: {
    census: { count: number; available: boolean };
    fdi: { count: number; available: boolean };
    sez: { count: number; available: boolean };
    satellite: { available: boolean; isMock: boolean };
  };
}

// Default values
const createDefaultForm = (): EvaluateLandForm => ({
  projectName: "",
  location: "",
  landSize: "",
  intendedUse: BuildingIntendedUse.Residential,
  priceRange: "",
  plotType: LandPlotType.Vacant,
  zoningPreference: LandZoningPreference.BuiltUp,
  proximity: [],
});

// Keeps land size input numeric.
const normalizeNumericInput = (value: string) =>
  value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

// Normalizes the price field.
const normalizePriceRangeInput = (value: string) =>
  value.replace(/\s+/g, " ").trimStart();

const inferScoreQueryLocation = (location: string) => {
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^india$/i.test(part));

  const district = parts[0] || location.trim() || "Unknown";
  const state = parts.length > 1 ? parts[parts.length - 1] : district;

  return { state, district };
};

function ScoreSummary({
  score,
  max,
  rating,
}: {
  score: number;
  max: number;
  rating: string;
}) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const color =
    pct >= 75
      ? "#10b981"
      : pct >= 50
        ? "#f59e0b"
        : pct >= 25
          ? "#f97316"
          : "#ef4444";
  const toneClass =
    pct >= 75
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
      : pct >= 50
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
        : pct >= 25
          ? "border-orange-500/30 bg-orange-500/10 text-orange-700"
          : "border-red-500/30 bg-red-500/10 text-red-700";

  return (
    <div className={cn("rounded-xl border p-4", toneClass)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Overall Score
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span
              className="text-4xl font-black tabular-nums"
              style={{ color }}
            >
              {score}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">/ {max}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {pct}% of the current developability model
          </p>
        </div>
        <Badge variant="outline" className="text-[11px] font-semibold">
          {rating}
        </Badge>
      </div>
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px]">
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

// Evaluate Land flow before a project record exists.
export function EvaluateLandWorkspace() {
  const router = useRouter();
  const { toast } = useToast();
  const actions = useBuildingStore((state) => state.actions);
  const drawingState = useBuildingStore((state) => state.drawingState);
  const mapLocation = useBuildingStore((state) => state.mapLocation);
  const plots = useBuildingStore((state) => state.plots);
  const selectedPlot = useSelectedPlot();

  const [isMapReady, setIsMapReady] = useState(false);
  const [isSimulatorEnabled, setIsSimulatorEnabled] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("none");
  const [solarDate, setSolarDate] = useState<Date>(() => new Date());
  const [isStartingProject, setIsStartingProject] = useState(false);
  const [isRunningScore, setIsRunningScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreData, setScoreData] = useState<ScoreResult | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [activePanelTab, setActivePanelTab] = useState<"inputs" | "analysis">(
    "inputs",
  );
  const [hasAttemptedProjectStart, setHasAttemptedProjectStart] =
    useState(false);
  const [isLocationManuallyEdited, setIsLocationManuallyEdited] =
    useState(false);
  const isResizing = useRef(false);

  const form = useForm<EvaluateLandForm>({
    resolver: zodResolver(evaluateLandFormSchema),
    defaultValues: createDefaultForm(),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const { control, getValues, reset, setValue, trigger } = form;

  useEffect(() => {
    // Evaluate Land should always start from a clean workspace and a fresh form.
    useBuildingStore.getState().actions.resetWorkspace();
    reset(createDefaultForm());
    setHasAttemptedProjectStart(false);
    setIsLocationManuallyEdited(false);
    setScoreData(null);
    setScoreError(null);
    setActivePanelTab("inputs");
  }, []);

  useEffect(() => {
    if (!mapLocation) return;
    if (isLocationManuallyEdited) return;
    if (getValues("location") === mapLocation) return;
    // Keep following map search updates until the user takes over the field manually.
    setValue("location", mapLocation, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: hasAttemptedProjectStart,
    });
  }, [
    getValues,
    hasAttemptedProjectStart,
    isLocationManuallyEdited,
    mapLocation,
    setValue,
  ]);

  useEffect(() => {
    if (plots.length === 0) return;
    const nextLandSize = Math.round(
      plots.reduce((total, plot) => total + plot.area, 0),
    ).toString();
    if (getValues("landSize") === nextLandSize) return;
    // Use the total captured plot area so the intake stays accurate even if multiple plots are drawn.
    setValue("landSize", nextLandSize, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: hasAttemptedProjectStart,
    });
  }, [getValues, hasAttemptedProjectStart, plots, setValue]);

  useEffect(() => {
    // Keep the pre-project sidebar responsive without affecting map gestures.
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing.current) return;
      const nextWidth = Math.min(Math.max(340, event.clientX - 12), 560);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Clears the current intake draft and resets the panel to its default state.
  const handleResetForm = () => {
    // Treat reset as a full pre-project reset so the inputs and temporary plot stay in sync.
    actions.resetWorkspace();
    const nextForm = createDefaultForm();
    reset(nextForm);
    setHasAttemptedProjectStart(false);
    setIsLocationManuallyEdited(false);
    setScoreData(null);
    setScoreError(null);
    setActivePanelTab("inputs");
    toast({
      title: "Inputs reset",
      description: "The form and current plot selection have been cleared.",
    });
  };

  // Validates the intake form, creates a project, and hands the selected plot into the editor flow.
  const handleStartProject = async () => {
    setHasAttemptedProjectStart(true);

    const formValid = await trigger();

    if (!selectedPlot) {
      toast({
        variant: "destructive",
        title: "Plot required",
        description: "Draw or select a plot before starting a project.",
      });
      return;
    }

    if (!formValid) {
      toast({
        variant: "destructive",
        title: "Complete the form",
        description: "Fill all required inputs before starting a project.",
      });
      return;
    }

    setIsStartingProject(true);

    try {
      const values = getValues();
      const totalPlotArea = Number(values.landSize);
      const newProject = await actions.createProject(
        values.projectName.trim(),
        totalPlotArea,
        values.intendedUse,
        values.location.trim(),
        "",
        [],
        false,
      );

      if (!newProject) return;

      // Clone the temporary plots before handoff so the pre-project workspace stays disposable.
      const clonedPlots: Plot[] = plots.map((plot, index) => {
        const clonedPlot: Plot = JSON.parse(JSON.stringify(plot));
        clonedPlot.projectId = newProject.id;
        clonedPlot.name =
          clonedPlot.name ||
          (index === 0
            ? values.projectName.trim() || "Primary Plot"
            : `Plot ${index + 1}`);
        clonedPlot.location = values.location.trim();
        return clonedPlot;
      });

      const selectedClonedPlot =
        clonedPlots.find((plot) => plot.id === selectedPlot.id) ||
        clonedPlots[0];

      const evaluateLandInput: EvaluateLandInput = {
        projectName: values.projectName.trim(),
        location: values.location.trim(),
        landSize: totalPlotArea,
        intendedUse: values.intendedUse,
        priceRange: values.priceRange.trim(),
        plotType: values.plotType,
        zoningPreference: values.zoningPreference,
        proximity: values.proximity,
      };

      actions.loadPlotsIntoWorkspace(
        clonedPlots,
        selectedClonedPlot?.id ?? null,
      );
      actions.updateProject(newProject.id, {
        evaluateLandInput,
        lastModified: new Date().toISOString(),
      });
      await actions.saveCurrentProject();

      toast({
        title: "Project started",
        description:
          "The selected land inputs and plot have been moved into the project editor.",
      });

      router.push(`/dashboard/project/${newProject.id}`);
    } finally {
      setIsStartingProject(false);
    }
  };

  const getAnalysisCoordinates = useCallback((): [number, number] | null => {
    const plotForAnalysis = selectedPlot || plots[0];
    if (!plotForAnalysis?.geometry) return null;

    try {
      const centroid = turf.centroid(plotForAnalysis.geometry);
      const [lng, lat] = centroid.geometry.coordinates;
      return [lng, lat];
    } catch {
      return null;
    }
  }, [plots, selectedPlot]);

  const handleRunDevelopabilityScore = useCallback(async () => {
    const formValid = await trigger(["location", "landSize", "intendedUse"]);

    const coords = getAnalysisCoordinates();
    if (!coords) {
      setScoreError(
        "Draw or select a plot before running the developability score.",
      );
      setScoreData(null);
      return;
    }

    if (!formValid) {
      setScoreError(
        "Complete the required land inputs before running the score.",
      );
      setScoreData(null);
      return;
    }

    const values = getValues();
    const { state, district } = inferScoreQueryLocation(values.location);

    setIsRunningScore(true);
    setScoreError(null);

    try {
      const response = await fetch("/api/land-intelligence/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: state,
          district,
          coordinates: coords,
          landSizeSqm: Number(values.landSize),
          intendedUse: values.intendedUse,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.error || "Failed to run developability score.",
        );
      }

      // Jump to the review tab when analysis completes successfully.
      setScoreData(payload as ScoreResult);
      setActivePanelTab("analysis");
    } catch (error: any) {
      setScoreData(null);
      setScoreError(error?.message || "Failed to run developability score.");
      // Keep failures visible in the analysis tab instead of hiding them behind the form.
      setActivePanelTab("analysis");
    } finally {
      setIsRunningScore(false);
    }
  }, [getAnalysisCoordinates, getValues, trigger]);

  const analysisCoordinates = getAnalysisCoordinates();

  const startSidebarResize = (event: React.MouseEvent) => {
    event.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
  };

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-background text-foreground">
      <MapEditor
        onMapReady={() => setIsMapReady(true)}
        solarDate={solarDate}
        setSolarDate={setSolarDate}
        isSimulatorEnabled={isSimulatorEnabled}
        setIsSimulatorEnabled={setIsSimulatorEnabled}
        analysisMode={analysisMode}
        setAnalysisMode={setAnalysisMode}
      />
      <DrawingToolbar />

      {!isMapReady && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-xl border bg-background px-5 py-4 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-semibold">Preparing Evaluate Land</p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute left-3 top-3 right-3 flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-sm font-semibold">Evaluate a Land</h1>
          </div>

          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-md">
            <MapSearch />
          </div>
        </div>

        {isSidebarCollapsed ? (
          <div className="pointer-events-auto absolute left-3 top-16">
            <Button
              variant="secondary"
              size="icon"
              className="h-10 w-10 rounded-xl shadow-lg"
              onClick={() => setIsSidebarCollapsed(false)}
              title="Open land sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            "pointer-events-auto absolute left-3 top-16 bottom-3 transition-all duration-300",
            isSidebarCollapsed &&
              "-translate-x-[calc(100%+24px)] opacity-0 pointer-events-none",
          )}
          style={{ width: sidebarWidth }}
        >
          <Card className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {/* Drag from the right edge to resize the land workspace without covering the map. */}
            <div
              className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
              onMouseDown={startSidebarResize}
            />
            <CardHeader className="space-y-3 border-b border-border/40 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Land Inputs</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-lg text-muted-foreground"
                  onClick={() => setIsSidebarCollapsed(true)}
                  title="Collapse land sidebar"
                >
                  <PanelLeftClose className="h-6 w-6" />
                </Button>
              </div>

              <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Selected Plot
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {plots.length > 0
                    ? `${Math.round(
                        plots.reduce((total, plot) => total + plot.area, 0),
                      ).toLocaleString()} sqm captured`
                    : "Draw or select a plot"}
                </p>
                {hasAttemptedProjectStart && !selectedPlot ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Draw or select a plot on the map.</span>
                  </div>
                ) : null}
                {analysisCoordinates ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Analysis point: [{analysisCoordinates[0].toFixed(4)},{" "}
                      {analysisCoordinates[1].toFixed(4)}]
                    </span>
                  </div>
                ) : null}
              </div>
            </CardHeader>

            <div className="border-b border-border/40 px-4 py-3">
              {/* Keep intake and score review separate so the form stays easy to scan. */}
              <Tabs
                value={activePanelTab}
                onValueChange={(value) =>
                  setActivePanelTab(value as "inputs" | "analysis")
                }
              >
                <TabsList className="grid h-10 w-full grid-cols-2">
                  <TabsTrigger value="inputs">Inputs</TabsTrigger>
                  <TabsTrigger value="analysis" className="gap-2">
                    Analysis
                    {scoreData ? (
                      <Badge
                        variant="secondary"
                        className="h-5 px-1.5 text-[10px]"
                      >
                        Ready
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="flex-1">
              {activePanelTab === "inputs" ? (
                <Form {...form}>
                  <div className="space-y-5 p-4">
                    <FormField
                      control={control}
                      name="projectName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Name *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Search on the map or type city, district, or locality"
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setIsLocationManuallyEdited(true);
                                field.onChange(nextValue);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={control}
                        name="landSize"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Land Size *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode="decimal"
                                placeholder="e.g. 4800 sqm"
                                onChange={(event) =>
                                  field.onChange(
                                    normalizeNumericInput(event.target.value),
                                  )
                                }
                              />
                            </FormControl>
                            {selectedPlot ? (
                              <FormDescription>
                                Auto-filled from the captured plot area.
                              </FormDescription>
                            ) : null}
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name="intendedUse"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Intended Use Case *</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {INTENDED_USE_OPTIONS.map((intendedUse) => (
                                  <SelectItem
                                    key={intendedUse}
                                    value={intendedUse}
                                  >
                                    {intendedUse}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={control}
                      name="priceRange"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price Range / Value *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g. 6 Cr - 9 Cr or 18,000 per sqm"
                              onChange={(event) =>
                                field.onChange(
                                  normalizePriceRangeInput(event.target.value),
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Separator />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={control}
                        name="plotType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plot Type *</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {PLOT_TYPE_OPTIONS.map((plotType) => (
                                  <SelectItem key={plotType} value={plotType}>
                                    {plotType === LandPlotType.Vacant
                                      ? "Vacant"
                                      : plotType === LandPlotType.Redevelopment
                                        ? "Redevelopment"
                                        : "Both"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name="zoningPreference"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Zoning Preference *</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {ZONING_OPTIONS.map((zoningPreference) => (
                                  <SelectItem
                                    key={zoningPreference}
                                    value={zoningPreference}
                                  >
                                    {zoningPreference ===
                                    LandZoningPreference.BuiltUp
                                      ? "Built-up"
                                      : zoningPreference ===
                                          LandZoningPreference.Agricultural
                                        ? "Agricultural"
                                        : zoningPreference ===
                                            LandZoningPreference.Waste
                                          ? "Waste Land"
                                          : zoningPreference ===
                                              LandZoningPreference.MixedUse
                                            ? "Mixed-use"
                                            : "Industrial"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={control}
                      name="proximity"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Proximity</FormLabel>
                            <span className="text-xs text-muted-foreground">
                              Optional nearby infrastructure preferences
                            </span>
                          </div>
                          <div className="grid gap-2 rounded-lg border border-border/50 bg-muted/10 p-3">
                            {PROXIMITY_OPTIONS.map((proximity) => {
                              const isChecked = field.value.includes(proximity);
                              return (
                                <label
                                  key={proximity}
                                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => {
                                      const nextValues = isChecked
                                        ? field.value.filter(
                                            (item) => item !== proximity,
                                          )
                                        : [...field.value, proximity];
                                      field.onChange(nextValues);
                                    }}
                                  />
                                  <span>
                                    {proximity === LandProximity.Metro
                                      ? "Metro / Rail Transit"
                                      : proximity === LandProximity.Highway
                                        ? "Highway / Arterial Road"
                                        : proximity === LandProximity.Airport
                                          ? "Airport / Logistics Hub"
                                          : proximity === LandProximity.Schools
                                            ? "Schools / Colleges"
                                            : proximity ===
                                                LandProximity.Hospitals
                                              ? "Hospitals / Emergency Care"
                                              : proximity ===
                                                  LandProximity.Retail
                                                ? "Retail / High Street"
                                                : proximity ===
                                                    LandProximity.Employment
                                                  ? "Employment / Business District"
                                                  : "Utilities / Infrastructure Access"}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Form>
              ) : (
                <div className="space-y-4 p-4">
                  {/* The analysis tab becomes the review surface after a score run. */}
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="mt-1 text-sm font-semibold">
                        Developability Score
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="shrink-0"
                        onClick={handleRunDevelopabilityScore}
                        disabled={isRunningScore}
                      >
                        {isRunningScore ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : scoreData ? (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        ) : (
                          <TrendingUp className="mr-2 h-4 w-4" />
                        )}
                        {isRunningScore
                          ? "Running..."
                          : scoreData
                            ? "Re-run Score"
                            : "Run Score"}
                      </Button>
                    </div>
                  </div>

                  {scoreError ? (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{scoreError}</span>
                    </div>
                  ) : null}

                  {!scoreData && !scoreError ? (
                    <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-5 text-center">
                      <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="mt-3 text-sm font-semibold">
                        Analysis will appear here
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Fill the inputs, draw a plot, then run the
                        developability score.
                      </p>
                    </div>
                  ) : null}

                  {scoreData ? (
                    <div className="space-y-4">
                      <ScoreSummary
                        score={scoreData.score.overallScore}
                        max={1000}
                        rating={scoreData.score.rating}
                      />

                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div>
                          <h3 className="text-sm font-bold">
                            Category Breakdown
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Data completeness:{" "}
                            {Math.round(scoreData.score.dataCompleteness * 100)}
                            %
                          </p>
                        </div>
                        <div className="mt-4 space-y-2">
                          <CategoryBar
                            label="Growth Potential"
                            earned={
                              scoreData.score.categories.growthPotential.score
                            }
                            max={
                              scoreData.score.categories.growthPotential
                                .maxScore
                            }
                            color="#3b82f6"
                          />
                          <CategoryBar
                            label="Legal & Regulatory"
                            earned={
                              scoreData.score.categories.legalRegulatory.score
                            }
                            max={
                              scoreData.score.categories.legalRegulatory
                                .maxScore
                            }
                            color="#f59e0b"
                          />
                          <CategoryBar
                            label="Location & Connectivity"
                            earned={
                              scoreData.score.categories.locationConnectivity
                                .score
                            }
                            max={
                              scoreData.score.categories.locationConnectivity
                                .maxScore
                            }
                            color="#8b5cf6"
                          />
                          <CategoryBar
                            label="Market & Economics"
                            earned={
                              scoreData.score.categories.marketEconomics.score
                            }
                            max={
                              scoreData.score.categories.marketEconomics
                                .maxScore
                            }
                            color="#10b981"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { key: "census", label: "Census", icon: Users },
                          { key: "fdi", label: "FDI", icon: DollarSign },
                          { key: "sez", label: "SEZ", icon: Building2 },
                          {
                            key: "satellite",
                            label: "Satellite",
                            icon: Satellite,
                          },
                        ].map(({ key, label, icon: Icon }) => {
                          const ds =
                            scoreData.dataSources[
                              key as keyof typeof scoreData.dataSources
                            ];
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
                              {available ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              <Icon className="h-3 w-3" />
                              {label}
                              {"count" in ds && ds.count > 0
                                ? ` (${ds.count})`
                                : ""}
                            </Badge>
                          );
                        })}
                      </div>

                      <div className="rounded-lg border border-border/50 bg-background/70 p-3">
                        <div className="flex items-start gap-2">
                          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          <div>
                            <p className="text-sm font-semibold">
                              Recommendation
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {scoreData.score.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </ScrollArea>

            <CardContent className="border-t border-border/40 bg-background/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <Button variant="outline" onClick={handleResetForm}>
                  Reset
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={handleRunDevelopabilityScore}
                    disabled={isRunningScore}
                  >
                    {isRunningScore ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <TrendingUp className="mr-2 h-4 w-4" />
                    )}
                    Analyze
                  </Button>
                  <Button
                    onClick={handleStartProject}
                    disabled={isStartingProject}
                  >
                    {isStartingProject ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Start Project
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {drawingState.isDrawing && (
          <div className="pointer-events-auto">
            <DrawingStatus />
          </div>
        )}
      </div>
    </div>
  );
}
