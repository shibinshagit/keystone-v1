import * as turf from "@turf/turf";

import { applyVariableSetbacks } from "@/lib/generators/setback-utils";
import type { Plot, RegulationData, RegulationValue } from "@/lib/types";

export interface SellableAreaBreakdown {
  plotArea: number;
  far: number | undefined;
  uniformSetback: number | undefined;
  frontSetback: number | undefined;
  rearSetback: number | undefined;
  sideSetback: number | undefined;
  grossMaxGfa: number;
  netBuildableArea: number;
  areaLostToSetbacks: number;
  setbackAdjustedMaxGfa: number;
  estimatedSellableArea: number;
  usedSetbackMethod: string;
  hasPlotGeometry: boolean;
  hasRegulationMatch: boolean;
}

function getNumericRegulationValue(
  regulation: RegulationData | null,
  keys: string[],
) {
  if (!regulation) return undefined;

  for (const key of keys) {
    const candidate = regulation.geometry?.[key] as RegulationValue | undefined;
    const rawValue = candidate?.value;
    const numericValue =
      typeof rawValue === "number" ? rawValue : Number(rawValue);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  return undefined;
}

export function calculateSellableAreaBreakdown({
  selectedPlot,
  plots,
  matchedRegulation,
  typedLandSize,
}: {
  selectedPlot: Plot | null;
  plots: Plot[];
  matchedRegulation: RegulationData | null;
  typedLandSize: string;
}): SellableAreaBreakdown {
  const plotForAnalysis = selectedPlot || plots[0] || null;
  const numericLandSize = Number(typedLandSize);
  const plotArea =
    plotForAnalysis?.area && plotForAnalysis.area > 0
      ? plotForAnalysis.area
      : Number.isFinite(numericLandSize) && numericLandSize > 0
        ? numericLandSize
        : 0;

  const far =
    getNumericRegulationValue(matchedRegulation, [
      "floor_area_ratio",
      "max_far",
      "fsi",
    ]) ?? plotForAnalysis?.far;

  const uniformSetback =
    getNumericRegulationValue(matchedRegulation, [
      "setback",
      "min_setback",
      "building_setback",
    ]) ?? plotForAnalysis?.setback;

  const frontSetback =
    getNumericRegulationValue(matchedRegulation, ["front_setback"]) ??
    uniformSetback;
  const rearSetback =
    getNumericRegulationValue(matchedRegulation, ["rear_setback"]) ??
    uniformSetback;
  const sideSetback =
    getNumericRegulationValue(matchedRegulation, ["side_setback"]) ??
    uniformSetback;

  const grossMaxGfa = far && plotArea > 0 ? far * plotArea : 0;
  const hasSetbackInputs =
    (frontSetback ?? 0) > 0 ||
    (rearSetback ?? 0) > 0 ||
    (sideSetback ?? 0) > 0 ||
    (uniformSetback ?? 0) > 0;

  let netBuildableArea = plotArea;
  let usedSetbackMethod = "No setback deduction applied.";

  if (plotForAnalysis?.geometry && plotArea > 0 && hasSetbackInputs) {
    try {
      const shrunkGeometry = applyVariableSetbacks(plotForAnalysis.geometry as any, {
        setback:
          uniformSetback ??
          Math.max(frontSetback ?? 0, rearSetback ?? 0, sideSetback ?? 0),
        frontSetback,
        rearSetback,
        sideSetback,
        roadAccessSides: plotForAnalysis.roadAccessSides || [],
      } as any);

      if (shrunkGeometry) {
        netBuildableArea = Math.max(0, turf.area(shrunkGeometry));
        usedSetbackMethod =
          plotForAnalysis.roadAccessSides &&
          plotForAnalysis.roadAccessSides.length > 0 &&
          (frontSetback !== undefined ||
            rearSetback !== undefined ||
            sideSetback !== undefined)
            ? "Directional setbacks applied to actual plot geometry."
            : "Uniform setback applied to actual plot geometry.";
      } else {
        netBuildableArea = 0;
        usedSetbackMethod =
          "Setback deduction consumed the full plot area for this geometry.";
      }
    } catch {
      const fallbackSetback =
        uniformSetback ??
        Math.max(frontSetback ?? 0, rearSetback ?? 0, sideSetback ?? 0);

      if (fallbackSetback > 0) {
        const buffered = turf.buffer(plotForAnalysis.geometry as any, -fallbackSetback, {
          units: "meters",
        });
        netBuildableArea = buffered ? Math.max(0, turf.area(buffered)) : 0;
        usedSetbackMethod =
          "Uniform setback fallback applied after directional setback calculation failed.";
      }
    }
  } else if (hasSetbackInputs) {
    usedSetbackMethod =
      "Setbacks available, but exact buildable area needs a drawn plot geometry.";
  }

  const areaLostToSetbacks =
    plotArea > 0 ? Math.max(0, plotArea - netBuildableArea) : 0;
  const setbackAdjustedMaxGfa =
    far && netBuildableArea > 0 ? far * netBuildableArea : 0;
  const estimatedSellableArea =
    setbackAdjustedMaxGfa > 0 ? setbackAdjustedMaxGfa * 0.7 : 0;

  return {
    plotArea,
    far,
    uniformSetback,
    frontSetback,
    rearSetback,
    sideSetback,
    grossMaxGfa,
    netBuildableArea,
    areaLostToSetbacks,
    setbackAdjustedMaxGfa,
    estimatedSellableArea,
    usedSetbackMethod,
    hasPlotGeometry: Boolean(plotForAnalysis?.geometry),
    hasRegulationMatch: Boolean(matchedRegulation),
  };
}
