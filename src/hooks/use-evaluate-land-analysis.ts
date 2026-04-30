import { useCallback, useMemo, useRef, useState } from "react";

import {
  evaluateBuildabilityVerdict,
  type BuildabilityVerdict,
} from "@/lib/land-intelligence/buildability-verdict";
import { calculateSellableAreaBreakdown } from "@/lib/land-intelligence/calculate-sellable-area-breakdown";
import type { EnvironmentalScreeningReport } from "@/lib/land-intelligence/environmental";
import { inferScoreQueryLocation } from "@/lib/land-intelligence/infer-score-query-location";
import type { LandUseSummary } from "@/lib/land-intelligence/land-use";
import { inferRegulationGeography } from "@/lib/geography";
import { lookupRegulationForLocationAndUse } from "@/lib/regulation-lookup";
import type {
  BuildingIntendedUse,
  DevelopabilityScore,
  LandZoningPreference,
  PopulationMigrationAnalysis,
  Plot,
  RegulationData,
} from "@/lib/types";

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

interface AnalysisTargetSnapshot {
  plotId: string | null;
  plotName: string;
  plotAreaSqm: number;
  usedFallbackPlot: boolean;
  coordinates: [number, number];
  mode: "plot" | "point";
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
  const [landUseData, setLandUseData] = useState<LandUseSummary | null>(null);
  const [matchedRegulation, setMatchedRegulation] =
    useState<RegulationData | null>(null);
  const [buildVerdict, setBuildVerdict] = useState<BuildabilityVerdict | null>(null);
  const [analysisTarget, setAnalysisTarget] =
    useState<AnalysisTargetSnapshot | null>(null);
  const [regulationMatch, setRegulationMatch] =
    useState<RegulationMatchSnapshot | null>(null);
  const latestRequestRef = useRef(0);

  const clearAnalysisResults = useCallback(() => {
    setScoreData(null);
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
    const { state, district } = inferScoreQueryLocation(values.location);
    const geography = inferRegulationGeography(values.location);
    const plotForAnalysis = selectedPlot || plots[0] || null;

    if (!plotForAnalysis && !pointTarget) {
      setScoreError(
        "Draw or select a plot before running the developability score.",
      );
      clearAnalysisResults();
      return false;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setIsRunningScore(true);
    setScoreError(null);
    setScoreData(null);
    setLandUseData(null);
    setMatchedRegulation(null);
    setBuildVerdict(null);
    setRegulationMatch(null);
    setAnalysisTarget({
      plotId: plotForAnalysis?.id ?? null,
      plotName: plotForAnalysis?.name ?? pointTarget?.label ?? "Clicked location",
      plotAreaSqm: plotForAnalysis?.area ?? Number(values.landSize || 0),
      usedFallbackPlot: plotForAnalysis != null && selectedPlot == null,
      coordinates: coords,
      mode: plotForAnalysis ? "plot" : "point",
      parcelAware: Boolean(plotForAnalysis),
    });

    try {
      const [scoreRes, bhuvanRes, regulationRes] = await Promise.allSettled([
        fetch("/api/land-intelligence/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: state,
            district,
            coordinates: coords,
            plotGeometry: plotForAnalysis?.geometry,
            roadAccessSides: plotForAnalysis?.roadAccessSides,
            landSizeSqm: Number(values.landSize),
            intendedUse: values.intendedUse,
            market: geography.market,
            countryCode: geography.countryCode,
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

      if (latestRequestRef.current !== requestId) {
        return false;
      }

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

      if (!nextLandUse) {
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

      setScoreError(errors.length > 0 ? errors.join(" ") : null);
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
    landUseData,
    matchedRegulation,
    regulationMatch,
    buildVerdict,
    analysisTarget,
    sellableAreaBreakdown,
    runAnalysis,
    resetAnalysis,
    clearAnalysisResults,
  };
}
