import type { IndiaViewportBounds } from "./types";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function webMercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lng, lat];
}

export function lngLatToWebMercator(lng: number, lat: number): [number, number] {
  const x = (lng * 20037508.34) / 180;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y =
    Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) /
    (Math.PI / 180);
  return [x, (y * 20037508.34) / 180];
}

export function rectArea(bounds: IndiaViewportBounds) {
  return Math.max(0, bounds.east - bounds.west) * Math.max(0, bounds.north - bounds.south);
}

export function intersectionArea(a: IndiaViewportBounds, b: IndiaViewportBounds) {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return 0;
  return (east - west) * (north - south);
}

export function containsPoint(bounds: IndiaViewportBounds, coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return (
    lng >= bounds.west &&
    lng <= bounds.east &&
    lat >= bounds.south &&
    lat <= bounds.north
  );
}

export function distanceToBounds(
  bounds: IndiaViewportBounds,
  coordinates: [number, number],
) {
  const [lng, lat] = coordinates;
  const dx =
    lng < bounds.west ? bounds.west - lng : lng > bounds.east ? lng - bounds.east : 0;
  const dy =
    lat < bounds.south ? bounds.south - lat : lat > bounds.north ? lat - bounds.north : 0;
  return Math.hypot(dx, dy);
}

export function boundsCenter(bounds: IndiaViewportBounds): [number, number] {
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}
