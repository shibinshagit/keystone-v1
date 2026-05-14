import { useCallback, useMemo, useRef, useState } from "react";

import {
  evaluateBuildabilityVerdict,
  type BuildabilityVerdict,
} from "@/lib/land-intelligence/buildability-verdict";
import { calculateSellableAreaBreakdown } from "@/lib/land-intelligence/calculate-sellable-area-breakdown";
import type { EnvironmentalScreeningReport } from "@/lib/land-intelligence/environmental";
import type { TransportationScreeningReport } from "@/lib/land-intelligence/transportation";
import { inferScoreQueryLocation } from "@/lib/land-intelligence/infer-score-query-location";
import type { LandUseSummary } from "@/lib/land-intelligence/land-use";
import { inferRegulationGeography } from "@/lib/geography";
import { lookupRegulationForLocationAndUse } from "@/lib/regulation-lookup";
import type {
  BuildingIntendedUse,
  DevelopabilityScore,
  LandPlotType,
  LandZoningPreference,
  PopulationMigrationAnalysis,
  Plot,
  RegulationData,
  TerrainIntelligenceData,
} from "@/lib/types";

interface ScoreResult {
  score: DevelopabilityScore;
  isUS?: boolean;
  usMarketData?: {
    city: string;
    state: string;
    economy: { unemploymentRate: number; medianIncome: number; laborForce: number };
    population: { population: number; medianAge: number; growthTier: string };
    permits: { totalUnits: number; singleFamily: number; multiFamily: number; valuation: number };
    marketZone: { tier: string; permitGrowthIndicator: string };
    absorptionRate: number;
    demandDensity: { population: number; medianIncome: number; tier: string };
    buyabilityScore: number | null;
    developmentProspect: string | null;
    environmental?: {
      floodZone?: {
        zone: string;
        zoneDescription: string;
        isHighRisk: boolean;
        panelNumber: string;
      } | null;
    } | null;
    parcel?: {
      parcelId: string;
      lotAreaSqFt?: number;
      zoning?: {
        zoningCode: string;
        zoningDescription?: string;
        description?: string;
        jurisdiction?: string;
        floodZone?: string;
        allowedUses?: string[];
      } | null;
      title?: {
        ownerName: string;
        ownerType?: string;
        assessedValue: number;
        lastSaleDate: string;
        lastSalePrice: number;
      } | null;
      encumbrances?: { type: string; description: string; status?: string }[] | null;
      dueDiligence?: {
        altaSurveyStatus: string;
        relativePositionalPrecision: string;
        recognizedEnvironmentalConditions: string;
        titleCommitmentStatus: string;
      };
    } | null;
    aiSummary?: string | null;
  } | null;
  terrain: TerrainIntelligenceData | null;
  environmentalScreening: EnvironmentalScreeningReport | null;
  transportationScreening: TransportationScreeningReport | null;
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
    census: { count: number; available: boolean; source?: string };
    populationMigration: { count: number; available: boolean };
    fdi: { count: number; available: boolean };
    sez: { count: number; available: boolean };
    usEconomy?: { available: boolean; source: string };
    usPermits?: { available: boolean; source: string };
    terrain: { available: boolean; isMock: boolean; source?: string };
    satellite: { available: boolean; isMock: boolean };
    regulation: { available: boolean };
    googlePlaces: { count: number; available: boolean };
    googleRoads: { count: number; available: boolean };
    proposedInfrastructure: { count: number; available: boolean; source?: string };
    environmental: { count: number; available: boolean };
    transportation: { count: number; available: boolean };
  };
}

interface AnalysisTargetSnapshot {
  plotId: string | null;
  plotName: string;
  plotAreaSqm: number;
  usedFallbackPlot: boolean;
  coordinates: [number, number];
  mode: "plot" | "point" | "search";
  parcelAware: boolean;
}

interface RegulationMatchSnapshot {
  source:
    | "specific-id"
    | "generic-id"
    | "location-query"
    | "national-fallback"
    | "not-found";
  matchedLocation: string | null;
}

interface BhuvanAnalysisResponse {
  success: boolean;
  report: LandUseSummary;
  error?: string;
}

const parsePriceRangeValueToUsd = (value: string): number => {
  const numericValue = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;

  const normalizedValue = value.toLowerCase();
  if (/\bcr\b|crore|crores/.test(normalizedValue)) {
    return numericValue * 10000000;
  }
  if (/\bm\b|million|millions/.test(normalizedValue)) {
    return numericValue * 1000000;
  }

  return numericValue;
};

export function useEvaluateLandAnalysis({
  selectedPlot,
  plots,
  typedLandSize,
  intendedUse,
  getAnalysisCoordinates,
  getInputValues,
  validateRequired,
  pointTarget,
}: {
  selectedPlot: Plot | null;
  plots: Plot[];
  typedLandSize: string;
  intendedUse: BuildingIntendedUse;
  getAnalysisCoordinates: () => [number, number] | null;
  getInputValues: () => {
    location: string;
    landSize: string;
    intendedUse: BuildingIntendedUse;
    zoningPreference: LandZoningPreference;
    priceRange: string;
    plotType: LandPlotType;
  };
  validateRequired: () => Promise<boolean>;
  pointTarget?: {
    requestKey: string;
    label: string;
  } | null;
}) {
  const [isRunningScore, setIsRunningScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreData, setScoreData] = useState<ScoreResult | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isLoadingAiSummary, setIsLoadingAiSummary] = useState(false);
  const [analysisSteps, setAnalysisSteps] = useState<{
    id: string;
    label: string;
    status: 'pending' | 'loading' | 'done' | 'error';
  }[]>([]);
  const [landUseData, setLandUseData] = useState<LandUseSummary | null>(null);
  const [matchedRegulation, setMatchedRegulation] =
    useState<RegulationData | null>(null);
  const [buildVerdict, setBuildVerdict] = useState<BuildabilityVerdict | null>(null);
  const [analysisTarget, setAnalysisTarget] =
    useState<AnalysisTargetSnapshot | null>(null);
  const [regulationMatch, setRegulationMatch] =
    useState<RegulationMatchSnapshot | null>(null);
  const [recommendedParcels, setRecommendedParcels] = useState<any[]>([]);
  const [isSearchingParcels, setIsSearchingParcels] = useState(false);
  const latestRequestRef = useRef(0);

  const clearAnalysisResults = useCallback(() => {
    setScoreData(null);
    setAiSummary(null);
    setIsLoadingAiSummary(false);
    setAnalysisSteps([]);
    setLandUseData(null);
    setMatchedRegulation(null);
    setBuildVerdict(null);
    setAnalysisTarget(null);
    setRegulationMatch(null);
  }, []);

  const resetAnalysis = useCallback(() => {
    clearAnalysisResults();
    setScoreError(null);
  }, [clearAnalysisResults]);

  const runAnalysis = useCallback(async () => {
    const requiresFullValidation = !pointTarget;
    const formValid = requiresFullValidation ? await validateRequired() : true;
    const coords = getAnalysisCoordinates();

    if (!coords) {
      setScoreError(
        "Draw or select a plot before running the developability score.",
      );
      clearAnalysisResults();
      return false;
    }

    if (!formValid) {
      setScoreError("Complete the required land inputs before running the score.");
      clearAnalysisResults();
      return false;
    }

    const values = getInputValues();
    const { state, district, isUS } = inferScoreQueryLocation(values.location, coords);
    const geography = inferRegulationGeography(values.location);
    const plotForAnalysis = selectedPlot || plots[0] || null;

    // Allow analysis to proceed without a plot when we have coordinates
    // (e.g., from geocoded location or map click)
    if (!plotForAnalysis && !pointTarget && !coords) {
      setScoreError(
        "Draw or select a plot, or select a location from the search bar.",
      );
      clearAnalysisResults();
      return false;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setIsRunningScore(true);
    setScoreError(null);
    setScoreData(null);
    setAiSummary(null);
    setIsLoadingAiSummary(false);
    setRecommendedParcels([]);
    setIsSearchingParcels(false);
    setLandUseData(null);
    setMatchedRegulation(null);
    setBuildVerdict(null);
    setRegulationMatch(null);

    // Build initial step list — US gets parcel step, non-US gets Bhuvan
    const baseSteps = [
      { id: 'market', label: isUS ? 'Fetching US market data' : 'Fetching census & FDI data', status: 'loading' as const },
      { id: 'connectivity', label: 'Checking location, connectivity & terrain', status: 'pending' as const },
      { id: 'legal', label: isUS ? 'Running legal & zoning checks' : 'Matching regulations & zoning', status: 'pending' as const },
      ...(isUS && (Boolean(plotForAnalysis) || Boolean(pointTarget))
        ? [{ id: 'parcel', label: 'Fetching parcel data', status: 'pending' as const }]
        : []),
      { id: 'score', label: 'Computing developability score', status: 'pending' as const },
      { id: 'ai', label: 'Generating AI investment summary', status: 'pending' as const },
    ];
    setAnalysisSteps(baseSteps);
    setAnalysisTarget({
      plotId: plotForAnalysis?.id ?? null,
      plotName: plotForAnalysis?.name ?? pointTarget?.label ?? values.location?.split(',')[0] ?? "Selected location",
      plotAreaSqm: plotForAnalysis?.area ?? Number(values.landSize || 0),
      usedFallbackPlot: plotForAnalysis != null && selectedPlot == null,
      coordinates: coords,
      mode: plotForAnalysis ? "plot" : pointTarget ? "point" : "search",
      parcelAware: Boolean(plotForAnalysis),
    });

    try {
      const setStep = (id: string, status: 'loading' | 'done' | 'error') => {
        if (latestRequestRef.current !== requestId) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));
      };

      // Fire score + bhuvan + regulation in parallel, but show steps as they resolve
      setStep('market', 'loading');
      setStep('connectivity', 'loading');
      setStep('legal', 'loading');
      if (isUS && (Boolean(plotForAnalysis) || Boolean(pointTarget))) setStep('parcel', 'loading');

      const [scoreRes, bhuvanRes, regulationRes] = await Promise.allSettled([
        fetch("/api/land-intelligence/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawLocation: values.location,
            location: state,
            district,
            coordinates: coords,
            plotGeometry: plotForAnalysis?.geometry,
            roadAccessSides: plotForAnalysis?.roadAccessSides,
            landSizeSqm: Number(values.landSize),
            intendedUse: values.intendedUse,
            parcelAware: Boolean(plotForAnalysis) || Boolean(pointTarget),
            market: isUS ? "USA" : geography.market,
            countryCode: isUS ? "US" : geography.countryCode,
          }),
        }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to run developability score.");
          }
          return payload as ScoreResult;
        }),
        fetch("/api/land-intelligence/land-use", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: coords,
            location: values.location.trim(),
            market: geography.market,
            countryCode: geography.countryCode,
          }),
        }).then(async (response) => {
          const payload = (await response.json()) as BhuvanAnalysisResponse;
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to fetch land use.");
          }
          return payload.report;
        }),
        lookupRegulationForLocationAndUse({
          location: values.location.trim(),
          intendedUse: values.intendedUse,
          market: geography.market,
        }),
      ]);

      if (latestRequestRef.current !== requestId) return false;

      setStep('market', scoreRes.status === 'fulfilled' ? 'done' : 'error');
      setStep('connectivity', scoreRes.status === 'fulfilled' ? 'done' : 'error');
      setStep('legal', scoreRes.status === 'fulfilled' ? 'done' : 'error');
      setStep('parcel', scoreRes.status === 'fulfilled' ? 'done' : 'error');
      setStep('score', scoreRes.status === 'fulfilled' ? 'done' : 'error');

      const errors: string[] = [];

      if (scoreRes.status === "fulfilled") {
        setScoreData(scoreRes.value);
      } else {
        setScoreData(null);
        errors.push(scoreRes.reason?.message || "Developability score unavailable.");
      }

      const nextLandUse = bhuvanRes.status === "fulfilled" ? bhuvanRes.value : null;
      const nextRegulation =
        regulationRes.status === "fulfilled" ? regulationRes.value.regulation : null;

      setLandUseData(nextLandUse);
      setMatchedRegulation(nextRegulation);
      setRegulationMatch(
        regulationRes.status === "fulfilled"
          ? {
              source: regulationRes.value.source,
              matchedLocation: regulationRes.value.matchedLocation,
            }
          : null,
      );

      if (!nextLandUse && !scoreData) {
        errors.push(
          bhuvanRes.status === "rejected"
            ? bhuvanRes.reason?.message || "Land use unavailable."
            : "Land use unavailable.",
        );
      }

      if (nextLandUse || nextRegulation) {
        setBuildVerdict(
          evaluateBuildabilityVerdict({
            intendedUse: values.intendedUse,
            zoningPreference: values.zoningPreference,
            landUse: nextLandUse,
            regulation: nextRegulation,
            regulationSource:
              regulationRes.status === "fulfilled"
                ? regulationRes.value.source
                : null,
          }),
        );
      } else {
        setBuildVerdict(null);
      }

      setScoreError(scoreRes.status === "fulfilled" ? null : errors.length > 0 ? errors.join(" ") : null);

      // After score loads — fire AI summary separately (non-blocking)
      if (scoreRes.status === 'fulfilled' && isUS) {
        const scorePayload = scoreRes.value;
        setIsLoadingAiSummary(true);
        setStep('ai', 'loading');
        fetch('/api/land-intelligence/ai-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: values.location,
            marketData: {
              economy: scorePayload.usMarketData?.economy,
              population: scorePayload.usMarketData?.population,
              permits: scorePayload.usMarketData?.permits,
              marketZone: scorePayload.usMarketData?.marketZone,
            },
            parcelData: scorePayload.usMarketData?.parcel ?? null,
            isParcelAware: Boolean(plotForAnalysis) || Boolean(pointTarget),
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (latestRequestRef.current === requestId) {
              setAiSummary(data.summary ?? null);
              setStep('ai', 'done');
            }
          })
          .catch(() => {
            if (latestRequestRef.current === requestId) setStep('ai', 'error');
          })
          .finally(() => {
            if (latestRequestRef.current === requestId) setIsLoadingAiSummary(false);
          });
        // Fire parcel search ONLY if we are NOT analyzing a specific clicked parcel or drawn plot
        const isAnalyzingSpecificParcel = Boolean(plotForAnalysis) || Boolean(pointTarget);
        
        if (isAnalyzingSpecificParcel) {
          setIsSearchingParcels(false);
          // Keep the existing recommendations visible
        } else {
          setIsSearchingParcels(true);
          const landSizeSqft = Number(values.landSize) * 10.7639;
          const [minValue, maxValue] = (values.priceRange || '')
            .split('-')
            .map(parsePriceRangeValueToUsd);

          fetch('/api/us/parcel-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              location: values.location,
              coordinates: coords,
              intendedUse: values.intendedUse,
              zoningPreference: values.zoningPreference,
              plotType: values.plotType,
              priceRange: values.priceRange,
              minAreaSqft: Math.max(0, landSizeSqft * 0.8),
              maxAreaSqft: landSizeSqft * 1.5,
              targetAreaSqft: landSizeSqft,
              minValue: minValue > 0 ? minValue : undefined,
              maxValue: maxValue > 0 ? maxValue : undefined,
              maxResults: 10,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (latestRequestRef.current === requestId && data.success) {
                setRecommendedParcels(data.parcels || []);
              }
            })
            .catch(err => console.warn('[ParcelSearch] Failed:', err))
            .finally(() => {
              if (latestRequestRef.current === requestId) setIsSearchingParcels(false);
            });
        }
      } else {
        setStep('ai', 'done');
      }

      return true;
    } catch (error: any) {
      if (latestRequestRef.current === requestId) {
        clearAnalysisResults();
        setScoreError(error?.message || "Failed to run developability score.");
      }
      return false;
    } finally {
      if (latestRequestRef.current === requestId) {
        setIsRunningScore(false);
      }
    }
  }, [
    clearAnalysisResults,
    getAnalysisCoordinates,
    getInputValues,
    pointTarget,
    plots,
    selectedPlot,
    validateRequired,
  ]);

  const sellableAreaBreakdown = useMemo(
    () =>
      calculateSellableAreaBreakdown({
        selectedPlot,
        plots,
        matchedRegulation,
        typedLandSize,
        intendedUse,
      }),
    [intendedUse, matchedRegulation, plots, selectedPlot, typedLandSize],
  );

  return {
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
    clearAnalysisResults,
  };
}
