import { useCallback, useMemo, useState } from "react";

import {
  evaluateBuildabilityVerdict,
  type BuildabilityVerdict,
  type BhuvanLandUseSummary,
} from "@/lib/land-intelligence/buildability-verdict";
import { calculateSellableAreaBreakdown } from "@/lib/land-intelligence/calculate-sellable-area-breakdown";
import { inferScoreQueryLocation } from "@/lib/land-intelligence/infer-score-query-location";
import { lookupRegulationForLocationAndUse } from "@/lib/regulation-lookup";
import type {
  BuildingIntendedUse,
  DevelopabilityScore,
  LandZoningPreference,
  Plot,
  RegulationData,
} from "@/lib/types";

interface ScoreResult {
  score: DevelopabilityScore;
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

interface AnalysisTargetSnapshot {
  plotId: string;
  plotName: string;
  plotAreaSqm: number;
  usedFallbackPlot: boolean;
  coordinates: [number, number];
}

interface BhuvanAnalysisResponse {
  success: boolean;
  report: BhuvanLandUseSummary;
  error?: string;
}

export function useEvaluateLandAnalysis({
  selectedPlot,
  plots,
  typedLandSize,
  getAnalysisCoordinates,
  getInputValues,
  validateRequired,
}: {
  selectedPlot: Plot | null;
  plots: Plot[];
  typedLandSize: string;
  getAnalysisCoordinates: () => [number, number] | null;
  getInputValues: () => {
    location: string;
    landSize: string;
    intendedUse: BuildingIntendedUse;
    zoningPreference: LandZoningPreference;
  };
  validateRequired: () => Promise<boolean>;
}) {
  const [isRunningScore, setIsRunningScore] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreData, setScoreData] = useState<ScoreResult | null>(null);
  const [bhuvanData, setBhuvanData] = useState<BhuvanLandUseSummary | null>(null);
  const [matchedRegulation, setMatchedRegulation] =
    useState<RegulationData | null>(null);
  const [buildVerdict, setBuildVerdict] = useState<BuildabilityVerdict | null>(null);
  const [analysisTarget, setAnalysisTarget] =
    useState<AnalysisTargetSnapshot | null>(null);

  const clearAnalysisResults = useCallback(() => {
    setScoreData(null);
    setBhuvanData(null);
    setMatchedRegulation(null);
    setBuildVerdict(null);
    setAnalysisTarget(null);
  }, []);

  const resetAnalysis = useCallback(() => {
    clearAnalysisResults();
    setScoreError(null);
  }, [clearAnalysisResults]);

  const runAnalysis = useCallback(async () => {
    const formValid = await validateRequired();
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
    const plotForAnalysis = selectedPlot || plots[0] || null;

    if (!plotForAnalysis) {
      setScoreError(
        "Draw or select a plot before running the developability score.",
      );
      clearAnalysisResults();
      return false;
    }

    setIsRunningScore(true);
    setScoreError(null);
    setAnalysisTarget({
      plotId: plotForAnalysis.id,
      plotName: plotForAnalysis.name,
      plotAreaSqm: plotForAnalysis.area,
      usedFallbackPlot: selectedPlot == null,
      coordinates: coords,
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
            plotGeometry: plotForAnalysis.geometry,
            roadAccessSides: plotForAnalysis.roadAccessSides,
            landSizeSqm: Number(values.landSize),
            intendedUse: values.intendedUse,
          }),
        }).then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to run developability score.");
          }
          return payload as ScoreResult;
        }),
        fetch("/api/land-intelligence/bhuvan-landuse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: coords,
            location: values.location.trim(),
          }),
        }).then(async (response) => {
          const payload = (await response.json()) as BhuvanAnalysisResponse;
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to fetch Bhuvan land use.");
          }
          return payload.report;
        }),
        lookupRegulationForLocationAndUse({
          location: values.location.trim(),
          intendedUse: values.intendedUse,
        }),
      ]);

      const errors: string[] = [];

      if (scoreRes.status === "fulfilled") {
        setScoreData(scoreRes.value);
      } else {
        setScoreData(null);
        errors.push(scoreRes.reason?.message || "Developability score unavailable.");
      }

      const nextBhuvan = bhuvanRes.status === "fulfilled" ? bhuvanRes.value : null;
      const nextRegulation =
        regulationRes.status === "fulfilled" ? regulationRes.value.regulation : null;

      setBhuvanData(nextBhuvan);
      setMatchedRegulation(nextRegulation);

      if (!nextBhuvan) {
        errors.push(
          bhuvanRes.status === "rejected"
            ? bhuvanRes.reason?.message || "Bhuvan land use unavailable."
            : "Bhuvan land use unavailable.",
        );
      }

      if (nextBhuvan || nextRegulation) {
        setBuildVerdict(
          evaluateBuildabilityVerdict({
            intendedUse: values.intendedUse,
            zoningPreference: values.zoningPreference,
            bhuvan: nextBhuvan,
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
      clearAnalysisResults();
      setScoreError(error?.message || "Failed to run developability score.");
      return false;
    } finally {
      setIsRunningScore(false);
    }
  }, [
    clearAnalysisResults,
    getAnalysisCoordinates,
    getInputValues,
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
      }),
    [matchedRegulation, plots, selectedPlot, typedLandSize],
  );

  return {
    isRunningScore,
    scoreError,
    scoreData,
    bhuvanData,
    matchedRegulation,
    buildVerdict,
    analysisTarget,
    sellableAreaBreakdown,
    runAnalysis,
    resetAnalysis,
    clearAnalysisResults,
  };
}
