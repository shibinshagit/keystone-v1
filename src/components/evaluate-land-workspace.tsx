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
import { useEvaluateLandAnalysis } from "@/hooks/use-evaluate-land-analysis";
import { useToast } from "@/hooks/use-toast";
import {
  BuildingIntendedUse,
  LandPlotType,
  LandProximity,
  LandZoningPreference,
  type EvaluateLandInput,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const PLOT_TYPE_OPTIONS = Object.values(LandPlotType);
const PROXIMITY_OPTIONS = Object.values(LandProximity);
const ZONING_OPTIONS = Object.values(LandZoningPreference);
const INTENDED_USE_OPTIONS = Object.values(BuildingIntendedUse);
const DEFAULT_SIDEBAR_WIDTH = 380;
const ANALYSIS_SIDEBAR_WIDTH = 500;

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

const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
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
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    resetAnalysis();
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
      const evaluateLandInput: EvaluateLandInput = {
        projectName: values.projectName.trim(),
        location: values.location.trim(),
        landSize: Number(values.landSize),
        intendedUse: values.intendedUse,
        priceRange: values.priceRange.trim(),
        plotType: values.plotType,
        zoningPreference: values.zoningPreference,
        proximity: values.proximity,
      };

      const result = await actions.startProjectFromEvaluateLand(
        evaluateLandInput,
        plots,
        selectedPlot.id,
      );

      if (!result?.project) return;

      toast({
        title: "Project started",
        description:
          "The selected land inputs and plot have been moved into the project editor.",
      });

      router.push(`/dashboard/project/${result.project.id}`);
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

  const analysisCoordinates = getAnalysisCoordinates();
  const watchedLandSize = form.watch("landSize");
  const watchedIntendedUse = form.watch("intendedUse");
  const {
    isRunningScore,
    scoreError,
    scoreData,
    bhuvanData,
    matchedRegulation,
    regulationMatch,
    buildVerdict,
    analysisTarget,
    sellableAreaBreakdown,
    runAnalysis,
    resetAnalysis,
  } = useEvaluateLandAnalysis({
    selectedPlot,
    plots,
    typedLandSize: watchedLandSize,
    intendedUse: watchedIntendedUse,
    getAnalysisCoordinates,
    getInputValues: () => {
      const values = getValues();
      return {
        location: values.location,
        landSize: values.landSize,
        intendedUse: values.intendedUse,
        zoningPreference: values.zoningPreference,
      };
    },
    validateRequired: () =>
      trigger([
        "projectName",
        "location",
        "landSize",
        "intendedUse",
        "priceRange",
        "plotType",
        "zoningPreference",
      ]),
  });

  useEffect(() => {
    resetAnalysis();
  }, [resetAnalysis]);

  const plotForAnalysis = selectedPlot || plots[0] || null;
  const currentPlotDiffersFromAnalysis =
    analysisTarget != null &&
    plotForAnalysis != null &&
    analysisTarget.plotId !== plotForAnalysis.id;
  const verdictConfidenceTone =
    buildVerdict?.confidence === "high"
      ? "border-emerald-500/40 text-emerald-600"
      : buildVerdict?.confidence === "medium"
        ? "border-amber-500/40 text-amber-600"
        : "border-border text-muted-foreground";
  const verdictSourceLabel =
    regulationMatch?.source === "specific-id"
      ? "Specific regulation"
      : regulationMatch?.source === "generic-id"
        ? "Direct location/use match"
        : regulationMatch?.source === "location-query"
          ? "Location fallback match"
          : regulationMatch?.source === "national-fallback"
            ? "National (NBC) fallback"
            : "No zoning match";

  const handleRunDevelopabilityScore = useCallback(async () => {
    const didRun = await runAnalysis();
    setActivePanelTab("analysis");
    if (didRun) {
      setSidebarWidth((currentWidth) =>
        Math.max(currentWidth, ANALYSIS_SIDEBAR_WIDTH),
      );
    }
  }, [runAnalysis]);

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
                    Land Intelligence
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
                        ) : scoreData || buildVerdict ? (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        ) : (
                          <TrendingUp className="mr-2 h-4 w-4" />
                        )}
                        {isRunningScore
                          ? "Running..."
                          : scoreData || buildVerdict
                            ? "Re-run Analysis"
                            : "Run Analysis"}
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
                        Fill the inputs, draw a plot, then run the site
                        analysis.
                      </p>
                    </div>
                  ) : null}

                  {scoreData ? (
                    <div className="space-y-4">
                      {analysisTarget ? (
                        <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-bold">
                                Intelligence Target
                              </h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                The Developability Score was generated for this
                                plot snapshot.
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-medium"
                            >
                              {analysisTarget.usedFallbackPlot
                                ? "Fallback Plot"
                                : "Selected Plot"}
                            </Badge>
                          </div>

                          <div className="mt-4 grid gap-2 rounded-lg border border-border/50 bg-background/70 p-3">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Plot name
                              </span>
                              <span className="font-semibold">
                                {analysisTarget.plotName}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Plot area
                              </span>
                              <span className="font-semibold tabular-nums">
                                {formatNumber(analysisTarget.plotAreaSqm)} sqm
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Analysis point
                              </span>
                              <span className="font-semibold tabular-nums">
                                [{analysisTarget.coordinates[0].toFixed(4)},{" "}
                                {analysisTarget.coordinates[1].toFixed(4)}]
                              </span>
                            </div>
                          </div>

                          {currentPlotDiffersFromAnalysis ? (
                            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
                              The currently selected plot is different from the
                              plot used for this score. Re-run analysis to score
                              the new selection.
                            </div>
                          ) : null}
                        </div>
                      ) : null}

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
                          {
                            key: "regulation",
                            label: "Regulation",
                            icon: CheckCircle2,
                          },
                          {
                            key: "googlePlaces",
                            label: "Google Places",
                            icon: MapPin,
                          },
                          {
                            key: "googleRoads",
                            label: "Google Roads",
                            icon: MapPin,
                          },
                          {
                            key: "proposedInfrastructure",
                            label: "Proposed Infra",
                            icon: TrendingUp,
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

                  {buildVerdict ? (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="mt-1 text-sm font-bold">
                            Can / Cannot Build Verdict
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px] font-semibold",
                              buildVerdict.status === "can-build" &&
                                "border-emerald-500/40 text-emerald-600",
                              buildVerdict.status === "conditional" &&
                                "border-amber-500/40 text-amber-600",
                              buildVerdict.status === "cannot-build" &&
                                "border-destructive/40 text-destructive",
                            )}
                          >
                            {buildVerdict.title}
                          </Badge>
                        </div>

                        <div className="mt-4 rounded-lg border border-border/50 bg-muted/10 p-3">
                          <div className="flex items-start gap-2">
                            {buildVerdict.status === "can-build" ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                            ) : buildVerdict.status === "conditional" ? (
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            ) : (
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            )}
                            <div>
                              <p className="text-sm font-semibold">
                                {buildVerdict.summary}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {buildVerdict.suggestedAction}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] font-medium",
                                    verdictConfidenceTone,
                                  )}
                                >
                                  {buildVerdict.confidence.toUpperCase()} confidence
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-medium"
                                >
                                  {verdictSourceLabel}
                                </Badge>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {buildVerdict.confidenceSummary}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 rounded-lg border border-border/50 bg-background/70 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Intended use
                            </span>
                            <span className="font-semibold">
                              {getValues("intendedUse")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Zoning preference
                            </span>
                            <span className="font-semibold">
                              {getValues("zoningPreference")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Bhuvan land use
                            </span>
                            <span className="text-right font-semibold">
                              {bhuvanData?.primaryLandUse || "Unavailable"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Matched zoning rule
                            </span>
                            <span className="text-right font-semibold">
                              {matchedRegulation
                                ? `${matchedRegulation.location} - ${matchedRegulation.type}`
                                : "Unavailable"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Rule source
                            </span>
                            <span className="text-right font-semibold">
                              {regulationMatch?.matchedLocation
                                ? `${verdictSourceLabel} (${regulationMatch.matchedLocation})`
                                : verdictSourceLabel}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Reasons
                          </p>
                          <div className="mt-2 space-y-2">
                            {buildVerdict.reasons.map((reason) => (
                              <div
                                key={reason}
                                className="flex items-start gap-2 text-xs text-muted-foreground"
                              >
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                <span>{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Signals Checked
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {buildVerdict.signals.map((signal) => (
                              <Badge
                                key={signal}
                                variant="outline"
                                className="text-[10px] font-medium"
                              >
                                {signal}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {scoreData || buildVerdict ? (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div>
                          <h3 className="mt-1 text-sm font-bold">
                            Sellable Area Breakdown
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Max GFA from FAR, adjusted for setbacks, with
                            estimated sellable area.
                          </p>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {[
                            {
                              label: "Plot Size",
                              value:
                                sellableAreaBreakdown.plotArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.plotArea)} sqm`
                                  : "Unavailable",
                              formula: "Drawn plot area or intake land size",
                            },
                            {
                              label: "Permissible FAR",
                              value:
                                sellableAreaBreakdown.far != null
                                  ? formatNumber(sellableAreaBreakdown.far, 2)
                                  : "Unavailable",
                              formula: "Matched regulation FAR / FSI",
                            },
                            {
                              label: "Gross Max GFA",
                              value:
                                sellableAreaBreakdown.grossMaxGfa > 0
                                  ? `${formatNumber(sellableAreaBreakdown.grossMaxGfa)} sqm`
                                  : "Unavailable",
                              formula:
                                sellableAreaBreakdown.far != null &&
                                sellableAreaBreakdown.plotArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.far, 2)} x ${formatNumber(sellableAreaBreakdown.plotArea)}`
                                  : "FAR x plot size",
                            },
                            {
                              label: "Net Buildable Area",
                              value:
                                sellableAreaBreakdown.netBuildableArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.netBuildableArea)} sqm`
                                  : sellableAreaBreakdown.hasPlotGeometry
                                    ? "0 sqm"
                                    : "Needs drawn plot",
                              formula: sellableAreaBreakdown.usedSetbackMethod,
                            },
                            {
                              label: "Area Lost to Setbacks",
                              value:
                                sellableAreaBreakdown.plotArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.areaLostToSetbacks)} sqm`
                                  : "Unavailable",
                              formula: "Plot size - net buildable area",
                            },
                            {
                              label: "Setback-Adjusted Max GFA",
                              value:
                                sellableAreaBreakdown.setbackAdjustedMaxGfa > 0
                                  ? `${formatNumber(sellableAreaBreakdown.setbackAdjustedMaxGfa)} sqm`
                                  : "Unavailable",
                              formula:
                                sellableAreaBreakdown.far != null &&
                                sellableAreaBreakdown.netBuildableArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.far, 2)} x ${formatNumber(sellableAreaBreakdown.netBuildableArea)}`
                                  : "FAR x net buildable area",
                            },
                            {
                              label: "Estimated Sellable Area",
                              value:
                                sellableAreaBreakdown.estimatedSellableArea > 0
                                  ? `${formatNumber(sellableAreaBreakdown.estimatedSellableArea)} sqm`
                                  : "Unavailable",
                              formula:
                                sellableAreaBreakdown.setbackAdjustedMaxGfa > 0
                                  ? `${formatNumber(sellableAreaBreakdown.setbackAdjustedMaxGfa)} x ${formatNumber(sellableAreaBreakdown.estimatedSellableRatio * 100, 0)}%`
                                  : "Setback-adjusted max GFA x sellable ratio",
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="rounded-lg border border-border/50 bg-background/70 p-3"
                            >
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                {item.label}
                              </p>
                              <p className="mt-2 text-base font-bold tabular-nums">
                                {item.value}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {item.formula}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Setback Inputs Used
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Uniform setback
                              </span>
                              <span className="font-semibold">
                                {sellableAreaBreakdown.uniformSetback != null
                                  ? `${formatNumber(sellableAreaBreakdown.uniformSetback, 1)} m`
                                  : "Not specified"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Front setback
                              </span>
                              <span className="font-semibold">
                                {sellableAreaBreakdown.frontSetback != null
                                  ? `${formatNumber(sellableAreaBreakdown.frontSetback, 1)} m`
                                  : "Not specified"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Rear setback
                              </span>
                              <span className="font-semibold">
                                {sellableAreaBreakdown.rearSetback != null
                                  ? `${formatNumber(sellableAreaBreakdown.rearSetback, 1)} m`
                                  : "Not specified"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                Side setback
                              </span>
                              <span className="font-semibold">
                                {sellableAreaBreakdown.sideSetback != null
                                  ? `${formatNumber(sellableAreaBreakdown.sideSetback, 1)} m`
                                  : "Not specified"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Sellable Ratio Used
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              {sellableAreaBreakdown.sellableRatioSource}
                            </span>
                            <span className="font-semibold">
                              {formatNumber(sellableAreaBreakdown.estimatedSellableRatio * 100, 0)}%
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
                          {!sellableAreaBreakdown.hasRegulationMatch ? (
                            <p className="mt-2 text-xs text-amber-600">
                              Regulation match is unavailable, so FAR / setback
                              values may be incomplete until zoning rules are
                              found.
                            </p>
                          ) : null}
                          {!sellableAreaBreakdown.hasPlotGeometry ? (
                            <p className="mt-2 text-xs text-amber-600">
                              Draw a plot to compute the true buildable area
                              after setbacks from actual geometry.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </ScrollArea>

            <CardContent className="border-t border-border/40 bg-gradient-to-t from-background to-background/90 px-4 py-3">
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="ghost"
                  onClick={handleResetForm}
                  className="h-10 rounded-lg border border-border/50 bg-background/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRunDevelopabilityScore}
                  disabled={isRunningScore}
                  className="h-10 rounded-lg border-primary/30 bg-primary/5 font-semibold hover:bg-primary/10"
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
                  className="h-10 rounded-lg font-semibold shadow-sm"
                >
                  {isStartingProject ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Start Project
                </Button>
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
