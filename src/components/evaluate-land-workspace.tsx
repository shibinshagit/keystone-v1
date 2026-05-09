"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import * as turf from "@turf/turf";
import ReactMarkdown from 'react-markdown';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  DollarSign,
  Loader2,
  Crosshair,
  Globe,
  MapPin,
  RefreshCw,
  Satellite,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  Users,
  XCircle,
  Brain,
  ShieldCheck,
  Banknote,
  Landmark,
  FileText,
} from "lucide-react";

import { DrawingToolbar } from "@/components/drawing-toolbar";
import { MapEditor } from "@/components/map-editor";
import { MapSearch } from "@/components/map-search";
import { PopulationMigrationCard } from "@/components/population-migration-card";
import { DevelopabilityScoreOverview } from "@/components/developability-score-overview";
import { DrawingStatus } from "@/components/drawing-status";
import { TransportationScreeningCard } from "@/components/transportation-screening-card";
import {
  TerrainIntelligenceCard,
  TerrainIntelligenceStateCard,
} from "@/components/terrain-intelligence-card";
import { IndiaParcelDetailsCard } from "@/components/india-parcel-details-card";
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
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import {
  BuildingIntendedUse,
  LandPlotType,
  LandProximity,
  LandZoningPreference,
  type EvaluateLandInput,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { checkZoningSuitability, checkAreaSuitability } from "@/lib/land-intelligence/us-zoning-suitability";

const PLOT_TYPE_OPTIONS = Object.values(LandPlotType);
const PROXIMITY_OPTIONS = Object.values(LandProximity);
const ZONING_OPTIONS = Object.values(LandZoningPreference);
const INTENDED_USE_OPTIONS = [
  BuildingIntendedUse.Residential,
  BuildingIntendedUse.Commercial,
  BuildingIntendedUse.Industrial,
  BuildingIntendedUse.MixedUse,
] as const;
const DEFAULT_SIDEBAR_WIDTH = 380;
const ANALYSIS_SIDEBAR_WIDTH = 500;
const MAPBOX_GEOCODING_API = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';

interface GeocodingSuggestion {
  id: string;
  place_name: string;
  center: [number, number];
}

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
  intendedUse: z.enum(INTENDED_USE_OPTIONS, {
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

// Evaluate Land flow before a project record exists.
export function EvaluateLandWorkspace() {
  const router = useRouter();
  const { toast } = useToast();
  const actions = useBuildingStore((state) => state.actions);
  const drawingState = useBuildingStore((state) => state.drawingState);
  const mapLocation = useBuildingStore((state) => state.mapLocation);
  const plots = useBuildingStore((state) => state.plots);
  const instantAnalysisTarget = useBuildingStore(
    (state) => state.instantAnalysisTarget,
  );
  const isInstantAnalysisMode = useBuildingStore(
    (state) => state.uiState.isInstantAnalysisMode,
  );
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
  const autoRunRequestKeyRef = useRef<string | null>(null);
  const geocodedCoordsRef = useRef<[number, number] | null>(null);

  const form = useForm<EvaluateLandForm>({
    resolver: zodResolver(evaluateLandFormSchema),
    defaultValues: createDefaultForm(),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const { control, getValues, reset, setValue, trigger, watch } = form;

  const [locationSuggestions, setLocationSuggestions] = useState<GeocodingSuggestion[]>([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const locationDropdownRef = useRef<HTMLDivElement>(null);
  const locationSearchTerm = form.watch('location');
  const debouncedLocationSearch = useDebounce(locationSearchTerm, 350);

  const isUSLocation = useCallback((location?: string, coords?: [number, number] | null) => {
    // Coordinate-based detection (contiguous US bounding box)
    if (coords) {
      const [lng, lat] = coords;
      if (lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66) return true;
    }
    // Text-based detection
    if (location) {
      const loc = location.toLowerCase();
      return /united states|usa|u\.s\.a/.test(loc)
        || loc.includes(', tx') || loc.includes(', az') || loc.includes(', wa')
        || loc.includes(', ca') || loc.includes(', ny') || loc.includes(', fl')
        || loc.includes('texas') || loc.includes('arizona') || loc.includes('washington')
        || loc.includes('california') || loc.includes('new york') || loc.includes('florida')
        || loc.includes('austin') || loc.includes('phoenix') || loc.includes('seattle');
    }
    return false;
  }, []);


  useEffect(() => {
    if (!isLocationManuallyEdited) return;
    if (!debouncedLocationSearch || debouncedLocationSearch.length < 3) {
      setLocationSuggestions([]);
      return;
    }
    let cancelled = false;
    const fetchSuggestions = async () => {
      setIsLocationSearching(true);
      try {
        const response = await fetch(
          `${MAPBOX_GEOCODING_API}${encodeURIComponent(debouncedLocationSearch)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}&autocomplete=true&limit=5`
        );
        const data = await response.json();
        if (!cancelled) {
          setLocationSuggestions(data.features || []);
          setShowLocationDropdown(true);
        }
      } catch (error) {
        console.error('Location geocoding error:', error);
      } finally {
        if (!cancelled) setIsLocationSearching(false);
      }
    };
    fetchSuggestions();
    return () => { cancelled = true; };
  }, [debouncedLocationSearch, isLocationManuallyEdited]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (locationDropdownRef.current && !locationDropdownRef.current.contains(e.target as Node)) {
        setShowLocationDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectLocationSuggestion = useCallback((feature: GeocodingSuggestion) => {
    setValue('location', feature.place_name, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    setLocationSuggestions([]);
    setShowLocationDropdown(false);
    setIsLocationManuallyEdited(false); 
    actions.setMapLocation(feature.place_name);
    // Store geocoded coordinates so analysis can run without drawing a plot
    geocodedCoordsRef.current = [feature.center[0], feature.center[1]];
    window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: feature.center } }));
  }, [setValue, actions]);

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
    if (!instantAnalysisTarget?.locationLabel) return;
    setValue("location", instantAnalysisTarget.locationLabel, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: hasAttemptedProjectStart,
    });
  }, [hasAttemptedProjectStart, instantAnalysisTarget?.locationLabel, setValue]);

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
    if (instantAnalysisTarget?.coordinates) {
      return instantAnalysisTarget.coordinates;
    }
    const plotForAnalysis = selectedPlot || plots[0];
    if (plotForAnalysis?.geometry) {
      try {
        const centroid = turf.centroid(plotForAnalysis.geometry);
        const [lng, lat] = centroid.geometry.coordinates;
        return [lng, lat];
      } catch {
        // fall through to geocoded fallback
      }
    }
    // Fallback: use coordinates from geocoded location selection
    if (geocodedCoordsRef.current) {
      return geocodedCoordsRef.current;
    }
    return null;
  }, [instantAnalysisTarget?.coordinates, plots, selectedPlot]);

  const analysisCoordinates = getAnalysisCoordinates();
  const watchedLandSize = form.watch("landSize");
  const watchedIntendedUse = form.watch("intendedUse");
  const {
    isRunningScore,
    scoreError,
    scoreData,
    aiSummary,
    isLoadingAiSummary,
    analysisSteps,
    landUseData,
    matchedRegulation,
    regulationMatch,
    buildVerdict,
    analysisTarget,
    sellableAreaBreakdown,
    recommendedParcels,
    isSearchingParcels,
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
        priceRange: values.priceRange,
        plotType: values.plotType,
      };
    },
    validateRequired: () =>
      trigger([
        "location",
        "landSize",
        "intendedUse",
        "plotType",
        "zoningPreference",
      ]),
    pointTarget: instantAnalysisTarget
      ? {
          requestKey: instantAnalysisTarget.requestKey,
          label: instantAnalysisTarget.locationLabel,
        }
      : null,
  });

  useEffect(() => {
    resetAnalysis();
  }, [resetAnalysis]);

  useEffect(() => {
    if (!instantAnalysisTarget?.requestKey) return;
    if (autoRunRequestKeyRef.current === instantAnalysisTarget.requestKey) {
      return;
    }
    autoRunRequestKeyRef.current = instantAnalysisTarget.requestKey;
    setActivePanelTab("analysis");
    void runAnalysis();
  }, [instantAnalysisTarget?.requestKey, runAnalysis]);

  const plotForAnalysis = selectedPlot || plots[0] || null;
  const currentPlotDiffersFromAnalysis =
    analysisTarget != null &&
    plotForAnalysis != null &&
    analysisTarget.plotId != null &&
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
        <div className="absolute left-3 top-3 right-3 flex items-center gap-3">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-sm font-semibold">Evaluate a Land</h1>
          </div>

          <div className="pointer-events-auto hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-md">
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
                            <Input
                              {...field}
                              placeholder="e.g. East Austin Mixed-Use Opportunity"
                            />
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
                          <div className="relative" ref={locationDropdownRef}>
                            <FormControl>
                              <div className="relative">
                                <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  {...field}
                                  className="pl-8 pr-8"
                                  placeholder="Type a city, address, or locality..."
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setIsLocationManuallyEdited(true);
                                    field.onChange(nextValue);
                                  }}
                                  onFocus={() => locationSuggestions.length > 0 && setShowLocationDropdown(true)}
                                  autoComplete="off"
                                />
                                {isLocationSearching && (
                                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                              </div>
                            </FormControl>
                            {showLocationDropdown && locationSuggestions.length > 0 && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 overflow-hidden">
                                {locationSuggestions.map((feature) => (
                                  <button
                                    key={feature.id}
                                    type="button"
                                    onClick={() => handleSelectLocationSuggestion(feature)}
                                    className="w-full text-left px-3 py-2.5 text-xs hover:bg-accent flex items-center gap-2 transition-colors border-b border-border/20 last:border-0"
                                  >
                                    <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{feature.place_name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <FormMessage />
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[10px] text-muted-foreground shrink-0">US Cities:</span>
                            {([
                              { label: 'Austin, TX', fullName: 'Austin, Texas, United States', center: [-97.7431, 30.2672] as [number, number] },
                              { label: 'Seattle, WA', fullName: 'Seattle, Washington, United States', center: [-122.3321, 47.6062] as [number, number] },
                              { label: 'Phoenix, AZ', fullName: 'Phoenix, Arizona, United States', center: [-112.0740, 33.4484] as [number, number] },
                            ]).map((city) => (
                              <button
                                key={city.label}
                                type="button"
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                                  field.value === city.fullName
                                    ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                                    : "bg-secondary/40 border-border/40 text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                                )}
                                onClick={() => {
                                  setValue('location', city.fullName, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                                  setIsLocationManuallyEdited(false);
                                  setLocationSuggestions([]);
                                  setShowLocationDropdown(false);
                                  actions.setMapLocation(city.fullName);
                                  geocodedCoordsRef.current = city.center;
                                  useBuildingStore.setState({ mapCommand: { type: 'flyTo', center: city.center } });
                                  window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: city.center } }));
                                }}
                              >
                                {city.label}
                              </button>
                            ))}
                          </div>
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

                    {/* Area Suitability Warning Block */}
                    {(() => {
                      const currentUse = watch('intendedUse');
                      const currentSizeStr = watch('landSize');
                      const currentSize = parseFloat(currentSizeStr || '0');
                      if (!currentUse || currentSize <= 0) return null;

                      const areaWarnings = checkAreaSuitability(currentUse, currentSize);
                      if (areaWarnings.length === 0) return null;

                      return (
                        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                          {areaWarnings.map((w, i) => (
                            <div
                              key={i}
                              className={`flex items-start gap-1.5 text-[11px] leading-tight px-2.5 py-2 rounded-lg border ${
                                w.level === 'error'
                                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              }`}
                            >
                              {w.level === 'error' ? (
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              )}
                              <span>{w.message}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

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
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <FormLabel>Proximity</FormLabel>
                              <span className="text-[10px] text-muted-foreground hidden sm:inline-block">
                                Optional nearby infrastructure preferences
                              </span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              onClick={() => {
                                if (field.value.length === PROXIMITY_OPTIONS.length) {
                                  field.onChange([]);
                                } else {
                                  field.onChange([...PROXIMITY_OPTIONS]);
                                }
                              }}
                            >
                              {field.value.length === PROXIMITY_OPTIONS.length ? "Deselect All" : "Select All"}
                            </Button>
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
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={isInstantAnalysisMode ? "default" : "outline"}
                      className="gap-2"
                      onClick={() =>
                        actions.setInstantAnalysisMode(!isInstantAnalysisMode)
                      }
                    >
                      <Crosshair className="h-4 w-4" />
                      {isInstantAnalysisMode
                        ? "Click Mode On"
                        : "Click Map to Analyze"}
                    </Button>
                    {instantAnalysisTarget ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => actions.clearInstantAnalysisTarget()}
                      >
                        Clear Point
                      </Button>
                    ) : null}
                  </div>

                  {isInstantAnalysisMode ? (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                      Click anywhere on the map to run instant analysis. Parcel
                      geometry is used automatically when the clicked point falls
                      inside a drawn plot.
                    </div>
                  ) : null}

                  {instantAnalysisTarget?.indiaParcel ? (
                    <IndiaParcelDetailsCard
                      parcel={instantAnalysisTarget.indiaParcel}
                      title={`${instantAnalysisTarget.indiaParcel.stateName} Parcel Matched`}
                    />
                  ) : null}

                  {false && instantAnalysisTarget?.keralaParcel ? (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-emerald-700">
                            Kerala Parcel Matched
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {instantAnalysisTarget?.keralaParcel?.gisInfo ||
                              instantAnalysisTarget?.locationLabel}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          Official eMaps
                        </Badge>
                      </div>
                      <div className="mt-3 rounded-md border bg-background/70 p-2 text-xs">
                        <div className="text-muted-foreground">
                          Parcel reference
                        </div>
                        <div className="mt-1 font-medium break-words">
                          {[
                            instantAnalysisTarget?.keralaParcel?.blockNo
                              ? `Block ${instantAnalysisTarget?.keralaParcel?.blockNo}`
                              : null,
                            instantAnalysisTarget?.keralaParcel?.surveyNo
                              ? `Survey ${instantAnalysisTarget?.keralaParcel?.surveyNo}`
                              : null,
                            instantAnalysisTarget?.keralaParcel?.subdivisionNo
                              ? `Subdiv ${instantAnalysisTarget?.keralaParcel?.subdivisionNo}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "N/A"}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md border bg-background/80 p-2">
                          <div className="text-muted-foreground">Block</div>
                          <div className="font-semibold">
                            {instantAnalysisTarget?.keralaParcel?.blockNo || "N/A"}
                          </div>
                        </div>
                        <div className="rounded-md border bg-background/80 p-2">
                          <div className="text-muted-foreground">Survey</div>
                          <div className="font-semibold">
                            {instantAnalysisTarget?.keralaParcel?.surveyNo || "N/A"}
                          </div>
                        </div>
                        <div className="rounded-md border bg-background/80 p-2">
                          <div className="text-muted-foreground">Subdivision</div>
                          <div className="font-semibold">
                            {instantAnalysisTarget?.keralaParcel?.subdivisionNo || "N/A"}
                          </div>
                        </div>
                        <div className="rounded-md border bg-background/80 p-2">
                          <div className="text-muted-foreground">Area</div>
                          <div className="font-semibold">
                            {instantAnalysisTarget?.keralaParcel?.areaSqm != null
                              ? `${formatNumber(
                                  instantAnalysisTarget?.keralaParcel?.areaSqm ?? 0,
                                  0,
                                )} sqm`
                              : instantAnalysisTarget?.keralaParcel?.areaLabel || "N/A"}
                          </div>
                        </div>
                      </div>
                      {instantAnalysisTarget?.keralaParcel?.owners?.length ? (
                        <div className="mt-3 rounded-md border bg-background/70 p-2 text-xs">
                          <div className="font-medium text-muted-foreground">
                            Owners
                          </div>
                          <div className="mt-1 space-y-1">
                            {instantAnalysisTarget?.keralaParcel?.owners
                              ?.slice(0, 2)
                              ?.map((owner) => (
                                <p key={owner} className="break-words">
                                  {owner}
                                </p>
                              ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {instantAnalysisTarget?.keralaParcel?.mapSketchUrl ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={instantAnalysisTarget?.keralaParcel?.mapSketchUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open Official Map Sketch
                            </Link>
                          </Button>
                        ) : null}
                        {instantAnalysisTarget?.keralaParcel?.remarks ? (
                          <div className="rounded-md border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground">
                            {instantAnalysisTarget?.keralaParcel?.remarks}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          Land Intelligence
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {isUSLocation(getValues('location'), analysisCoordinates)
                            ? 'Development Score + US Plot Intelligence'
                            : 'Development Score + Regulation Check'}
                        </p>
                      </div>
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
                          ? "Analyzing..."
                          : scoreData || buildVerdict
                            ? "Re-run"
                            : "Run Analysis"}
                      </Button>
                    </div>
                  </div>

                  {scoreError ? (
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-md p-3 text-xs",
                        scoreData
                          ? "border border-amber-500/30 bg-amber-500/5 text-amber-300"
                          : "border border-destructive/30 bg-destructive/5 text-destructive",
                      )}
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {scoreData && /timeout|aborted/i.test(scoreError)
                          ? `Some supplemental checks timed out, but the main land-intelligence score still loaded. ${scoreError}`
                          : scoreError}
                      </span>
                    </div>
                  ) : null}

                  {!scoreData && !scoreError && !isRunningScore ? (
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

                  {/* Progressive Loading State */}
                  {isRunningScore && analysisSteps.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <h3 className="text-sm font-bold mb-3">Running Analysis</h3>
                      <div className="space-y-3">
                        {analysisSteps.map((step) => (
                          <div key={step.id} className="flex items-center gap-3">
                            <div className="shrink-0">
                              {step.status === 'done' ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : step.status === 'error' ? (
                                <XCircle className="h-4 w-4 text-destructive" />
                              ) : step.status === 'loading' ? (
                                <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-muted" />
                              )}
                            </div>
                            <span className={cn(
                              "text-xs",
                              step.status === 'loading' ? "text-foreground font-medium" : 
                              step.status === 'done' ? "text-muted-foreground" :
                              step.status === 'error' ? "text-destructive" :
                              "text-muted-foreground/50"
                            )}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {scoreData && !isRunningScore ? (
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
                              {analysisTarget.mode === "search"
                                ? "Location Search"
                                : analysisTarget.mode === "point"
                                ? "Map Click"
                                : analysisTarget.usedFallbackPlot
                                  ? "Fallback Plot"
                                  : "Selected Plot"}
                            </Badge>
                          </div>

                          <div className="mt-4 grid gap-2 rounded-lg border border-border/50 bg-background/70 p-3">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                {analysisTarget.mode === "point" || analysisTarget.mode === "search"
                                  ? "Target"
                                  : "Plot name"}
                              </span>
                              <span className="font-semibold">
                                {analysisTarget.plotName}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-muted-foreground">
                                {analysisTarget.mode === "point" || analysisTarget.mode === "search"
                                  ? "Reference area"
                                  : "Plot area"}
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

                          {analysisTarget.mode === "point" || analysisTarget.mode === "search" ? (
                            <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-700">
                              This score was triggered from a {analysisTarget.mode === "search" ? "location search" : "map click"}. If you
                              want a parcel-aware score, draw a plot or click
                              inside one before running again.
                            </div>
                          ) : null}

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

                      {/* Population Migration â€” India only (Census 2011 data) */}
                      {!scoreData.isUS && (
                        <PopulationMigrationCard analysis={scoreData.populationMigration} emphasized />
                      )}

                      <DevelopabilityScoreOverview
                        score={scoreData.score}
                        dataSources={scoreData.dataSources}
                        nearbyAmenities={scoreData.nearbyAmenities}
                      />

                      {/* -- US Market Intelligence */}
                      {scoreData.isUS && scoreData.usMarketData && (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" aria-label="US Flag">{"\uD83C\uDDFA\uD83C\uDDF8"}</span>
                            <p className="text-sm font-semibold text-blue-400">US Market Intelligence</p>
                            <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400 ml-auto">
                              {scoreData.usMarketData.marketZone.tier}
                            </Badge>
                          </div>

                          {/* Economy row */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Unemployment</p>
                              <p className="text-sm font-bold text-emerald-400">
                                {scoreData.usMarketData.economy.unemploymentRate}%
                              </p>
                            </div>
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Median Income</p>
                              <p className="text-sm font-bold text-blue-400">
                                ${(scoreData.usMarketData.economy.medianIncome / 1000).toFixed(0)}K
                              </p>
                            </div>
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Labor Force</p>
                              <p className="text-sm font-bold text-foreground">
                                {(scoreData.usMarketData.economy.laborForce / 1000).toFixed(0)}K
                              </p>
                            </div>
                          </div>

                          {/* Population row */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Population</p>
                              <p className="text-sm font-bold text-foreground">
                                {(scoreData.usMarketData.population.population / 1000).toFixed(0)}K
                              </p>
                            </div>
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Median Age</p>
                              <p className="text-sm font-bold text-foreground">
                                {scoreData.usMarketData.population.medianAge}
                              </p>
                            </div>
                            <div className="rounded-md bg-background/60 p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">Market Tier</p>
                              <p className="text-[11px] font-bold text-amber-400 truncate">
                                {scoreData.usMarketData.population.growthTier}
                              </p>
                            </div>
                          </div>

                          {/* Permits row */}
                          <div className="rounded-md bg-background/60 p-2">
                            <p className="text-[10px] text-muted-foreground mb-1">Building Permits (Annual)</p>
                            <div className="grid grid-cols-3 gap-1 text-center">
                              <div>
                                <p className="text-xs font-bold">{scoreData.usMarketData.permits.totalUnits.toLocaleString()}</p>
                                <p className="text-[9px] text-muted-foreground">Total Units</p>
                              </div>
                              <div>
                                <p className="text-xs font-bold">{scoreData.usMarketData.permits.singleFamily.toLocaleString()}</p>
                                <p className="text-[9px] text-muted-foreground">Single Family</p>
                              </div>
                              <div>
                                <p className="text-xs font-bold">{scoreData.usMarketData.permits.multiFamily.toLocaleString()}</p>
                                <p className="text-[9px] text-muted-foreground">Multi Family</p>
                              </div>
                            </div>
                          </div>

                          {/* Market signal */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <TrendingUp className="h-3 w-3 text-emerald-500 shrink-0" />
                            <span>
                              {scoreData.usMarketData.marketZone.permitGrowthIndicator} ·{" "}
                              Absorption rate {scoreData.usMarketData.absorptionRate} units/1K pop
                            </span>
                          </div>
                          <p className="text-[9px] text-muted-foreground">Sources: US Census ACS · Bureau of Labor Statistics · Census BPS</p>
                        </div>
                      )}

                      {scoreData.terrain ? (
                        <TerrainIntelligenceCard terrain={scoreData.terrain} />
                      ) : (
                        <TerrainIntelligenceStateCard
                          available={scoreData.dataSources.terrain.available}
                          message={
                            scoreData.dataSources.terrain.available
                              ? "Terrain data source was available for this run, but the detailed terrain metrics were not attached to the current response."
                              : "SRTM terrain metrics were not returned for this run. The chip in Data Sources is still listed for consistency, but the gray x state means terrain did not contribute to this result."
                          }
                        />
                      )}

                      {scoreData.environmentalScreening ? (
                        <div className="rounded-lg border border-border/50 bg-background/70 p-3">
                          <div className="flex items-start gap-2">
                            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                            <div>
                              <p className="text-sm font-semibold">
                                EPA Environmental Screening
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {scoreData.environmentalScreening.nepa.summary}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <div className="text-xs text-muted-foreground">Wetland Risk</div>
                              <div
                                className={cn(
                                  "text-sm font-semibold capitalize",
                                  scoreData.environmentalScreening.wetlandScreening.status === "high"
                                    ? "text-red-400"
                                    : scoreData.environmentalScreening.wetlandScreening.status === "moderate"
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                                )}
                              >
                                {scoreData.environmentalScreening.wetlandScreening.status}
                              </div>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <div className="text-xs text-muted-foreground">Air Screening</div>
                              <div
                                className={cn(
                                  "text-sm font-semibold capitalize",
                                  scoreData.environmentalScreening.airQuality.status === "high"
                                    ? "text-red-400"
                                    : scoreData.environmentalScreening.airQuality.status === "moderate"
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                                )}
                              >
                                {scoreData.environmentalScreening.airQuality.status}
                              </div>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <div className="text-xs text-muted-foreground">Water Screening</div>
                              <div
                                className={cn(
                                  "text-sm font-semibold capitalize",
                                  scoreData.environmentalScreening.waterQuality.status === "high"
                                    ? "text-red-400"
                                    : scoreData.environmentalScreening.waterQuality.status === "moderate"
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                                )}
                              >
                                {scoreData.environmentalScreening.waterQuality.status}
                              </div>
                            </div>
                            <div className="rounded border border-border/40 bg-secondary/20 p-2">
                              <div className="text-xs text-muted-foreground">NEPA Review</div>
                              <div
                                className={cn(
                                  "text-sm font-semibold",
                                  scoreData.environmentalScreening.nepa.status === "elevated-review"
                                    ? "text-red-400"
                                    : scoreData.environmentalScreening.nepa.status === "screening-recommended"
                                      ? "text-amber-400"
                                      : "text-emerald-400",
                                )}
                              >
                                {scoreData.environmentalScreening.nepa.status}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
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
                            <div className="mt-3 space-y-1">
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

                          <div className="mt-3 space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Due-Diligence Documents
                            </div>
                            {scoreData.environmentalScreening.nepa.recommendedDocuments.map(
                              (document, index) => (
                                <div
                                  key={`${document}-${index}`}
                                  className="rounded bg-secondary/30 px-2 py-1.5 text-xs text-muted-foreground"
                                >
                                  {document}
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}

                      {scoreData.transportationScreening ? (
                        <TransportationScreeningCard report={scoreData.transportationScreening} />
                      ) : null}

                      <div className="rounded-lg border border-border/50 bg-background/70 p-3">
                        <div className="flex items-start gap-2">
                          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          <div>
                            <p className="text-sm font-semibold">
                              System Verdict
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {scoreData.score.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                  ) : null}

                  {/* ========== UNIFIED US INTELLIGENCE (from score route) ========== */}
                  {scoreData?.isUS && scoreData.usMarketData?.buyabilityScore != null && (
                    <div className="space-y-3">
                      <Separator />
                      <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-blue-500" />
                        <h3 className="text-sm font-bold">US Buyability &amp; Parcel</h3>
                      </div>

                      {/* Buyability Score */}
                      <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Buyability Score
                            </p>
                            <div className="mt-2 flex items-end gap-2">
                              <span
                                className="text-4xl font-black tabular-nums"
                                style={{
                                  color: scoreData.usMarketData.buyabilityScore >= 75 ? '#10b981'
                                    : scoreData.usMarketData.buyabilityScore >= 50 ? '#f59e0b'
                                    : '#ef4444'
                                }}
                              >
                                {scoreData.usMarketData.buyabilityScore}
                              </span>
                              <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[11px] font-semibold',
                              scoreData.usMarketData.developmentProspect === 'Excellent' && 'border-emerald-500/40 text-emerald-600',
                              scoreData.usMarketData.developmentProspect === 'Good' && 'border-blue-500/40 text-blue-600',
                              scoreData.usMarketData.developmentProspect === 'Moderate' && 'border-amber-500/40 text-amber-600',
                              scoreData.usMarketData.developmentProspect === 'Risky' && 'border-red-500/40 text-red-600',
                            )}
                          >
                            {scoreData.usMarketData.developmentProspect}
                          </Badge>
                        </div>
                      </div>

                      {/* Parcel Info */}
                      {scoreData.usMarketData.parcel && (() => {
                        const p = scoreData.usMarketData.parcel!;
                        return (
                          <div className="rounded-xl border border-border/60 bg-background/80 overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <Landmark className="h-3.5 w-3.5 text-blue-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Parcel Record</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono">{p.parcelId}</span>
                            </div>

                            <div className="p-3 space-y-3">
                              {/* Zoning block */}
                              {p.zoning && (
                                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5 space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Zoning</p>
                                  <div className="flex items-center gap-2">
                                    <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-bold text-blue-400">{p.zoning.zoningCode}</span>
                                    <span className="text-xs text-muted-foreground">{p.zoning.zoningDescription}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Jurisdiction: </span>
                                      <span className="font-medium">{p.zoning.jurisdiction}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Flood Zone: </span>
                                      <span className={cn("font-bold", p.zoning.floodZone === 'X' || p.zoning.floodZone === 'C' ? "text-emerald-500" : "text-amber-500")}>
                                        {p.zoning.floodZone}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Suitability Warning for clicked parcel */}
                              {p.zoning && (() => {
                                const currentUse = getValues('intendedUse') || '';
                                const parcelArea = p.lotAreaSqFt ? Math.round(p.lotAreaSqFt / 10.7639) : Number(getValues('landSize') || 0);
                                if (!currentUse) return null;
                                const suit = checkZoningSuitability(
                                  p.zoning.zoningCode || '',
                                  p.zoning.zoningDescription || p.zoning.description || '',
                                  currentUse,
                                  parcelArea,
                                );
                                const nonInfoWarnings = suit.warnings.filter(w => w.level !== 'info');
                                if (nonInfoWarnings.length === 0) return null;
                                return (
                                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">⚠ Suitability Check</p>
                                    {nonInfoWarnings.map((w, wi) => (
                                      <div
                                        key={wi}
                                        className={`flex items-start gap-1.5 text-[10px] leading-tight px-2 py-1.5 rounded ${
                                          w.level === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                                        }`}
                                      >
                                        {w.level === 'error' ? (
                                          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                                        ) : (
                                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                        )}
                                        <span>{w.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}

                              {/* Title / Ownership */}
                              {p.title && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title &amp; Ownership</p>
                                  <div className="rounded-lg border border-border/40 bg-background/60 p-2.5 space-y-1.5">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">Owner</span>
                                      <span className="font-semibold">{p.title.ownerName}</span>
                                    </div>
                                    {p.title.ownerType && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Owner Type</span>
                                        <span className="font-medium">{p.title.ownerType}</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">Assessed Value</span>
                                      <span className="font-bold text-emerald-400">${p.title.assessedValue?.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">Last Sale Price</span>
                                      <span className="font-semibold tabular-nums">${p.title.lastSalePrice?.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                      <span className="text-muted-foreground">Last Sale Date</span>
                                      <span className="font-medium tabular-nums">{p.title.lastSaleDate}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Encumbrances */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Encumbrances &amp; Liens</p>
                                  <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5",
                                    (p.encumbrances?.length ?? 0) === 0
                                      ? "bg-emerald-500/15 text-emerald-500"
                                      : "bg-amber-500/15 text-amber-500"
                                  )}>
                                    {(p.encumbrances?.length ?? 0) === 0 ? "Clear" : `${p.encumbrances!.length} on record`}
                                  </span>
                                </div>
                                {(p.encumbrances?.length ?? 0) > 0 ? (
                                  <div className="space-y-1.5">
                                    {p.encumbrances!.map((enc, i) => (
                                      <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">{enc.type}</span>
                                          <span className={cn("text-[10px] font-medium", enc.status === 'Active' ? "text-amber-400" : "text-muted-foreground")}>{enc.status}</span>
                                        </div>
                                        <p className="text-muted-foreground leading-relaxed">{enc.description}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No encumbrances, easements, or liens on record.</p>
                                )}
                              </div>

                              {/* Due Diligence & Site Acquisition */}
                              {p.dueDiligence && (
                                <div className="space-y-1.5 mt-4">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Diligence &amp; Site Acquisition</p>
                                  <div className="rounded-lg border border-border/40 bg-background/60 p-2.5 space-y-2.5">
                                    <div className="flex justify-between items-center text-xs">
                                      <span className="text-muted-foreground">ALTA/NSPS Survey</span>
                                      <span className={cn("font-medium", p.dueDiligence.altaSurveyStatus === 'Available' ? "text-emerald-400" : p.dueDiligence.altaSurveyStatus === 'In Progress' ? "text-amber-400" : "text-muted-foreground")}>
                                        {p.dueDiligence.altaSurveyStatus}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-start gap-4 text-xs">
                                      <span className="text-muted-foreground shrink-0" title="Relative Positional Precision">RPP Limit</span>
                                      <span className="font-medium text-right text-muted-foreground leading-tight">{p.dueDiligence.relativePositionalPrecision}</span>
                                    </div>
                                    <div className="flex justify-between items-start gap-4 text-xs">
                                      <span className="text-muted-foreground shrink-0" title="Recognized Environmental Conditions">Environmental RECs</span>
                                      <span className={cn("font-medium text-right leading-tight", p.dueDiligence.recognizedEnvironmentalConditions === 'Clear' ? "text-emerald-400" : "text-amber-400")}>{p.dueDiligence.recognizedEnvironmentalConditions}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs pt-1 border-t border-border/30">
                                      <span className="text-muted-foreground">Title Commitment</span>
                                      <span className={cn("font-medium", p.dueDiligence.titleCommitmentStatus === 'Issued' ? "text-emerald-400" : p.dueDiligence.titleCommitmentStatus === 'Pending' ? "text-amber-400" : "text-destructive")}>{p.dueDiligence.titleCommitmentStatus}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* US AI Summary */}
                  {scoreData?.isUS && (aiSummary || isLoadingAiSummary) && (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 mt-3 overflow-hidden relative">
                      <div className="flex items-center gap-2 mb-3">
                        {isLoadingAiSummary ? (
                          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-blue-500" />
                        )}
                        <p className="text-[11px] font-bold uppercase tracking-wider text-blue-500">
                          {isLoadingAiSummary ? "Generating Investment Summary..." : "AI Investment Summary"}
                        </p>
                      </div>
                      
                      {aiSummary && !isLoadingAiSummary ? (
                        <div className="us-ai-summary">
                          <ReactMarkdown
                            components={{
                              h2: ({ children }) => (
                                <h4 className="text-xs font-bold text-foreground mt-3 mb-1.5 first:mt-0 border-b border-border/30 pb-1">{children}</h4>
                              ),
                              h3: ({ children }) => (
                                <h5 className="text-xs font-semibold text-foreground mt-2 mb-1">{children}</h5>
                              ),
                              p: ({ children }) => (
                                <p className="text-xs leading-relaxed text-muted-foreground mb-2">{children}</p>
                              ),
                              ul: ({ children }) => (
                                <ul className="space-y-1 mb-2 ml-1">{children}</ul>
                              ),
                              li: ({ children }) => (
                                <li className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                                  <span>{children}</span>
                                </li>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-foreground">{children}</strong>
                              ),
                            }}
                          >
                            {aiSummary}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="space-y-2 opacity-50 animate-pulse">
                          <div className="h-2 w-3/4 bg-blue-500/20 rounded"></div>
                          <div className="h-2 w-full bg-blue-500/20 rounded"></div>
                          <div className="h-2 w-5/6 bg-blue-500/20 rounded"></div>
                          <div className="h-2 w-1/2 bg-blue-500/20 rounded mt-4"></div>
                          <div className="h-2 w-2/3 bg-blue-500/20 rounded"></div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recommended Parcels */}
                  {scoreData?.isUS && (recommendedParcels.length > 0 || isSearchingParcels) && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 mt-3">
                      <div className="flex items-center gap-2 mb-3">
                        {isSearchingParcels ? (
                          <Loader2 className="h-3.5 w-3.5 text-emerald-500 animate-spin" />
                        ) : (
                          <MapPin className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-500">
                          {isSearchingParcels ? 'Scanning nearby parcels...' : `${recommendedParcels.length} Matching Parcels`}
                        </p>
                      </div>

                      {!isSearchingParcels && recommendedParcels.length > 0 && (
                        <div className="space-y-2">
                          {recommendedParcels.map((parcel: any, idx: number) => {
                            // ── Suitability check per parcel ──
                            const currentIntendedUse = getValues('intendedUse') || '';
                            const parcelAreaSqm = parcel.areaSqm || Math.round((parcel.areaSqft || 0) / 10.7639);
                            const suitability = parcel.zoning
                              ? checkZoningSuitability(
                                  parcel.zoning,
                                  parcel.zoningDescription || '',
                                  currentIntendedUse,
                                  parcelAreaSqm,
                                )
                              : null;
                            const hasErrors = suitability?.warnings.some(w => w.level === 'error');
                            const hasWarnings = suitability?.warnings.some(w => w.level === 'warning');
                            const borderColor = hasErrors
                              ? 'border-red-500/40 hover:border-red-500/60'
                              : hasWarnings
                                ? 'border-amber-500/40 hover:border-amber-500/60'
                                : 'border-border/40 hover:border-emerald-500/40';

                            return (
                              <div
                                key={parcel.apn || idx}
                                className={`rounded-lg border ${borderColor} bg-background/60 transition-all cursor-pointer group`}
                                onClick={() => {
                                  const c = parcel.centroid;
                                  if (c) {
                                    // 1. Fly map to parcel
                                    window.dispatchEvent(new CustomEvent('flyTo', {
                                      detail: { center: c, zoom: 18 },
                                    }));

                                    // 2. Highlight the parcel polygon on map
                                    if (parcel.geometry) {
                                      window.dispatchEvent(new CustomEvent('highlightParcel', {
                                        detail: { geometry: parcel.geometry, apn: parcel.apn },
                                      }));
                                    }

                                    // 3. Update form with parcel's actual area so analysis uses correct data
                                    if (parcel.areaSqm > 0 || parcel.areaSqft > 0) {
                                      const areaSqm = parcel.areaSqm || Math.round(parcel.areaSqft / 10.7639);
                                      setValue('landSize', String(areaSqm), { shouldDirty: true, shouldValidate: true });
                                    }

                                    // 4. Enable click-to-analyze mode + trigger analysis
                                    actions.setInstantAnalysisMode(true);
                                    actions.setInstantAnalysisTarget({
                                      coordinates: c,
                                      locationLabel: parcel.address && parcel.address !== 'Unknown' && parcel.address !== '' 
                                        ? `${parcel.address}, ${getValues().location.split(',')[0]}, ${parcel.county}` 
                                        : `Parcel ${parcel.apn}, ${getValues().location.split(',')[0]}, ${parcel.county}`,
                                      district: parcel.county,
                                      stateCode: "US",
                                      stateName: "",
                                      plotId: null,
                                      plotName: null,
                                      parcelAware: true,
                                      source: "map-click",
                                      requestKey: `${c[0].toFixed(6)}:${c[1].toFixed(6)}:${Date.now()}`,
                                      capturedAt: new Date().toISOString(),
                                    });
                                  }
                                }}
                              >
                                <div className="flex items-start gap-3 p-2.5">
                                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                                    hasErrors ? 'bg-red-500/10 text-red-500' : hasWarnings ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'
                                  }`}>
                                    {idx + 1}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-semibold text-foreground truncate">
                                        {parcel.address && parcel.address !== 'Unknown' && parcel.address !== '' ? parcel.address : `Parcel ${parcel.apn}`}
                                      </p>
                                      {parcel.assessedValue > 0 && (
                                        <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                                          ${(parcel.assessedValue / 1000).toFixed(0)}K
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1">
                                      {parcel.areaSqft > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                                          {parcel.areaSqft.toLocaleString()} sqft · {parcel.areaSqm?.toLocaleString() || Math.round(parcel.areaSqft / 10.7639).toLocaleString()} sqm
                                        </span>
                                      )}
                                      {parcel.zoning && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                          hasErrors ? 'bg-red-500/10 text-red-400' : hasWarnings ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                                        }`}>
                                          {parcel.zoning}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-muted-foreground">{parcel.county}</span>
                                      {parcel.apn && <span className="text-[10px] text-muted-foreground">APN: {parcel.apn}</span>}
                                    </div>

                                    {/* ── Suitability Warnings ── */}
                                    {suitability && suitability.warnings.filter(w => w.level !== 'info').length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {suitability.warnings.filter(w => w.level !== 'info').map((w, wi) => (
                                          <div
                                            key={wi}
                                            className={`flex items-start gap-1.5 text-[10px] leading-tight px-2 py-1.5 rounded ${
                                              w.level === 'error'
                                                ? 'bg-red-500/10 text-red-400'
                                                : 'bg-amber-500/10 text-amber-400'
                                            }`}
                                          >
                                            {w.level === 'error' ? (
                                              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                                            ) : (
                                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                                            )}
                                            <span>{w.message}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-0.5">
                                    <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                                    <span className="text-[8px] text-emerald-400">View</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isSearchingParcels && (
                        <div className="space-y-2 opacity-50 animate-pulse">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="h-16 bg-emerald-500/10 rounded-lg"></div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* US location hint when no analysis has been run yet */}
                  {isUSLocation(getValues('location'), analysisCoordinates) && !scoreData && !isRunningScore ? (
                    <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Brain className="h-3.5 w-3.5" />
                        <span className="font-semibold">US location detected</span>
                      </div>
                      Run the analysis to get Development Score + US Market Intelligence + Parcel Data in one report.
                    </div>
                  ) : null}


                  {/* Build Verdict — only for non-US locations (Bhuvan is India-only) */}
                  {buildVerdict && !scoreData?.isUS ? (
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
                              Land use / cover
                            </span>
                            <span className="text-right font-semibold">
                              {landUseData?.primaryLandUse || "Unavailable"}
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
