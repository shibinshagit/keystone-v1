import type { IndiaViewportBounds } from "./types";

const WGS84_SEMIMAJOR_AXIS = 6378137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_ECC_SQ = WGS84_FLATTENING * (2 - WGS84_FLATTENING);
const WGS84_ECC_PRIME_SQ = WGS84_ECC_SQ / (1 - WGS84_ECC_SQ);
const UTM_SCALE_FACTOR = 0.9996;

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function utmCentralMeridian(zone: number) {
  return degreesToRadians(zone * 6 - 183);
}

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

export function lngLatToUtm(
  lng: number,
  lat: number,
  zone: number,
): [number, number] {
  const latRad = degreesToRadians(lat);
  const lngRad = degreesToRadians(lng);
  const centralMeridian = utmCentralMeridian(zone);

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const n =
    WGS84_SEMIMAJOR_AXIS / Math.sqrt(1 - WGS84_ECC_SQ * sinLat * sinLat);
  const t = tanLat * tanLat;
  const c = WGS84_ECC_PRIME_SQ * cosLat * cosLat;
  const a = cosLat * (lngRad - centralMeridian);

  const m =
    WGS84_SEMIMAJOR_AXIS *
    ((1 -
      WGS84_ECC_SQ / 4 -
      (3 * WGS84_ECC_SQ * WGS84_ECC_SQ) / 64 -
      (5 * WGS84_ECC_SQ * WGS84_ECC_SQ * WGS84_ECC_SQ) / 256) *
      latRad -
      ((3 * WGS84_ECC_SQ) / 8 +
        (3 * WGS84_ECC_SQ * WGS84_ECC_SQ) / 32 +
        (45 * WGS84_ECC_SQ * WGS84_ECC_SQ * WGS84_ECC_SQ) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * WGS84_ECC_SQ * WGS84_ECC_SQ) / 256 +
        (45 * WGS84_ECC_SQ * WGS84_ECC_SQ * WGS84_ECC_SQ) / 1024) *
        Math.sin(4 * latRad) -
      ((35 * WGS84_ECC_SQ * WGS84_ECC_SQ * WGS84_ECC_SQ) / 3072) *
        Math.sin(6 * latRad));

  const easting =
    UTM_SCALE_FACTOR *
      n *
      (a +
        ((1 - t + c) * Math.pow(a, 3)) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_ECC_PRIME_SQ) *
          Math.pow(a, 5)) /
          120) +
    500000;

  let northing =
    UTM_SCALE_FACTOR *
    (m +
      n *
        tanLat *
        ((a * a) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * Math.pow(a, 4)) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_ECC_PRIME_SQ) *
            Math.pow(a, 6)) /
            720));

  if (lat < 0) {
    northing += 10000000;
  }

  return [easting, northing];
}

export function utmToLngLat(
  easting: number,
  northing: number,
  zone: number,
  northernHemisphere = true,
): [number, number] {
  const x = easting - 500000;
  const y = northernHemisphere ? northing : northing - 10000000;
  const centralMeridian = utmCentralMeridian(zone);

  const m = y / UTM_SCALE_FACTOR;
  const mu =
    m /
    (WGS84_SEMIMAJOR_AXIS *
      (1 -
        WGS84_ECC_SQ / 4 -
        (3 * WGS84_ECC_SQ * WGS84_ECC_SQ) / 64 -
        (5 * WGS84_ECC_SQ * WGS84_ECC_SQ * WGS84_ECC_SQ) / 256));

  const e1 =
    (1 - Math.sqrt(1 - WGS84_ECC_SQ)) / (1 + Math.sqrt(1 - WGS84_ECC_SQ));
  const j1 = (3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32;
  const j2 = (21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32;
  const j3 = (151 * Math.pow(e1, 3)) / 96;
  const j4 = (1097 * Math.pow(e1, 4)) / 512;

  const fp =
    mu +
    j1 * Math.sin(2 * mu) +
    j2 * Math.sin(4 * mu) +
    j3 * Math.sin(6 * mu) +
    j4 * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);

  const c1 = WGS84_ECC_PRIME_SQ * cosFp * cosFp;
  const t1 = tanFp * tanFp;
  const n1 =
    WGS84_SEMIMAJOR_AXIS / Math.sqrt(1 - WGS84_ECC_SQ * sinFp * sinFp);
  const r1 =
    (WGS84_SEMIMAJOR_AXIS * (1 - WGS84_ECC_SQ)) /
    Math.pow(1 - WGS84_ECC_SQ * sinFp * sinFp, 1.5);
  const d = x / (n1 * UTM_SCALE_FACTOR);

  const lat =
    fp -
    (n1 * tanFp * ((d * d) / 2 -
      ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_ECC_PRIME_SQ) *
        Math.pow(d, 4)) /
        24 +
      ((61 +
        90 * t1 +
        298 * c1 +
        45 * t1 * t1 -
        252 * WGS84_ECC_PRIME_SQ -
        3 * c1 * c1) *
        Math.pow(d, 6)) /
        720)) /
      r1;

  const lng =
    centralMeridian +
    (d -
      ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
      ((5 -
        2 * c1 +
        28 * t1 -
        3 * c1 * c1 +
        8 * WGS84_ECC_PRIME_SQ +
        24 * t1 * t1) *
        Math.pow(d, 5)) /
        120) /
      cosFp;

  return [radiansToDegrees(lng), radiansToDegrees(lat)];
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
