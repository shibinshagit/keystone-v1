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
  const centerLng = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const lngQuarter = (bounds.east - bounds.west) / 4;
  const latQuarter = (bounds.north - bounds.south) / 4;

  return [
    [centerLng, centerLat],
    [centerLng - lngQuarter, centerLat],
    [centerLng + lngQuarter, centerLat],
    [centerLng, centerLat - latQuarter],
    [centerLng, centerLat + latQuarter],
    [centerLng - lngQuarter, centerLat - latQuarter],
    [centerLng + lngQuarter, centerLat - latQuarter],
    [centerLng - lngQuarter, centerLat + latQuarter],
    [centerLng + lngQuarter, centerLat + latQuarter],
  ];
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

    return a.distanceToCenter - b.distanceToCenter;
  });

  return overlapping[0]?.village || null;
}
