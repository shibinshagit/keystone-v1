import {
  boundsCenter,
  containsPoint,
  distanceToBounds,
  intersectionArea,
  rectArea,
} from "./geometry";
import type { IndiaOverlayVillage, IndiaViewportBounds } from "./types";

export function buildViewportSamplePoints(
  bounds: IndiaViewportBounds,
): [number, number][] {
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  const sampleFractions: Array<[number, number]> = [
    [0.5, 0.5],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0.25],
    [0.5, 0.75],
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
    [0.35, 0.35],
    [0.65, 0.35],
    [0.35, 0.65],
    [0.65, 0.65],
  ];

  return sampleFractions.map(([lngFraction, latFraction]) => [
    bounds.west + lngSpan * lngFraction,
    bounds.south + latSpan * latFraction,
  ]);
}

export function pickBestOverlayVillage<T extends IndiaOverlayVillage>(
  bounds: IndiaViewportBounds,
  villages: T[],
) {
  const center = boundsCenter(bounds);
  const viewportArea = rectArea(bounds);

  const overlapping = villages
    .map((village) => ({
      village,
      overlapArea: intersectionArea(bounds, village.extent),
      containsCenter: containsPoint(village.extent, center),
      distanceToCenter: distanceToBounds(village.extent, center),
    }))
    .filter((entry) => entry.overlapArea > 0);

  if (overlapping.length === 0) {
    return null;
  }

  overlapping.sort((a, b) => {
    if (a.containsCenter !== b.containsCenter) {
      return a.containsCenter ? -1 : 1;
    }

    const overlapRatioA = a.overlapArea / Math.max(viewportArea, 0.000001);
    const overlapRatioB = b.overlapArea / Math.max(viewportArea, 0.000001);
    if (Math.abs(overlapRatioB - overlapRatioA) > 0.000001) {
      return overlapRatioB - overlapRatioA;
    }

    const villageAreaA = rectArea(a.village.extent);
    const villageAreaB = rectArea(b.village.extent);
    if (Math.abs(villageAreaA - villageAreaB) > 0.000001) {
      return villageAreaA - villageAreaB;
    }

    return a.distanceToCenter - b.distanceToCenter;
  });

  return overlapping[0]?.village || null;
}

export async function resolveOverlayByViewportSampling<
  T extends IndiaOverlayVillage,
>(
  bounds: IndiaViewportBounds,
  resolveCandidateAtPoint: (point: [number, number]) => Promise<T | null>,
  pickCandidate?: (bounds: IndiaViewportBounds, candidates: T[]) => T | null,
) {
  const samplePoints = buildViewportSamplePoints(bounds);
  const candidates: T[] = [];
  const seenGisCodes = new Set<string>();

  for (const point of samplePoints) {
    const candidate = await resolveCandidateAtPoint(point).catch(() => null);
    if (!candidate?.gisCode || seenGisCodes.has(candidate.gisCode)) {
      continue;
    }

    seenGisCodes.add(candidate.gisCode);
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    pickCandidate?.(bounds, candidates) ||
    pickBestOverlayVillage(bounds, candidates) ||
    candidates[0] ||
    null
  );
}
