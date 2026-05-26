import type {
  Feature,
  Geometry,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import {
  isFiniteNumber,
  utmToLngLat,
} from "@/services/india/shared/geometry";
import type { IndiaViewportBounds } from "./types";

export function decodePortalText(value?: string | null) {
  if (!value) return null;
  if (/[\u0900-\u097F]/.test(value)) {
    return value;
  }
  if (!/(?:Ãƒ|Ã‚|Ã Â¤|Ã Â¥|à¤|à¥|Â)/.test(value)) {
    return value;
  }
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

export function trimPortalBreaks(value?: string | null) {
  return decodePortalText(value)
    ?.replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .trim() || "";
}

export function parsePortalHref(baseUrl: string, value?: string | null) {
  const hrefMatch = value?.match(/href="([^"]+)"/i);
  if (!hrefMatch?.[1]) return null;
  const href = hrefMatch[1];
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  return new URL(href.replace(/^\.\//, "").replace(/^\//, ""), `${baseUrl}/`)
    .toString();
}

export function inferUtmZoneFromLongitude(longitude: number) {
  return Math.max(1, Math.min(60, Math.floor((longitude + 180) / 6) + 1));
}

export function normalizeExtent4326(
  extent:
    | {
        xmin?: number | null;
        ymin?: number | null;
        xmax?: number | null;
        ymax?: number | null;
      }
    | null
    | undefined,
) {
  if (
    !extent ||
    !isFiniteNumber(extent.xmin) ||
    !isFiniteNumber(extent.ymin) ||
    !isFiniteNumber(extent.xmax) ||
    !isFiniteNumber(extent.ymax)
  ) {
    return null;
  }

  return {
    west: extent.xmin,
    south: extent.ymin,
    east: extent.xmax,
    north: extent.ymax,
  } satisfies IndiaViewportBounds;
}

export function normalizeUtmExtentTo4326(
  extent:
    | {
        xmin?: number | null;
        ymin?: number | null;
        xmax?: number | null;
        ymax?: number | null;
      }
    | null
    | undefined,
  zone: number,
) {
  if (
    !extent ||
    !isFiniteNumber(extent.xmin) ||
    !isFiniteNumber(extent.ymin) ||
    !isFiniteNumber(extent.xmax) ||
    !isFiniteNumber(extent.ymax)
  ) {
    return null;
  }

  const corners = [
    utmToLngLat(extent.xmin, extent.ymin, zone),
    utmToLngLat(extent.xmin, extent.ymax, zone),
    utmToLngLat(extent.xmax, extent.ymin, zone),
    utmToLngLat(extent.xmax, extent.ymax, zone),
  ];
  const lngs = corners.map(([lng]) => lng);
  const lats = corners.map(([, lat]) => lat);

  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  } satisfies IndiaViewportBounds;
}

export function parseUtmWktGeometry(
  wkt: string | null | undefined,
  zone: number,
): Feature<Polygon | MultiPolygon> | null {
  if (!wkt) return null;

  const normalized = wkt.trim();
  if (normalized.startsWith("MULTIPOLYGON")) {
    const body = normalized
      .replace(/^MULTIPOLYGON\s*\(\(\(/i, "")
      .replace(/\)\)\)\s*$/i, "");
    const polygonTexts = body.split(/\)\)\s*,\s*\(\(/);
    const coordinates = polygonTexts.map((polygonText) =>
      polygonText.split(/\)\s*,\s*\(/).map((ringText) =>
        ringText.split(",").map((pair) => {
          const [x, y] = pair.trim().split(/\s+/).map(Number);
          return utmToLngLat(x, y, zone);
        }),
      ),
    );

    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "MultiPolygon",
        coordinates,
      },
    };
  }

  if (normalized.startsWith("POLYGON")) {
    const body = normalized
      .replace(/^POLYGON\s*\(\(/i, "")
      .replace(/\)\)\s*$/i, "");
    const rings = body.split(/\)\s*,\s*\(/).map((ringText) =>
      ringText.split(",").map((pair) => {
        const [x, y] = pair.trim().split(/\s+/).map(Number);
        return utmToLngLat(x, y, zone);
      }),
    );

    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: rings,
      },
    };
  }

  return null;
}

export function splitFixedWidthCodes(value: string, segmentLengths: number[]) {
  const cleaned = value.replace(/\D/g, "");
  const parts: string[] = [];
  let cursor = 0;

  for (const segmentLength of segmentLengths) {
    const part = cleaned.slice(cursor, cursor + segmentLength);
    if (part.length !== segmentLength) {
      return null;
    }
    parts.push(part);
    cursor += segmentLength;
  }

  return cursor === cleaned.length ? parts : null;
}

export function shiftBounds(
  bounds: IndiaViewportBounds | null | undefined,
  offset: { lng: number; lat: number },
) {
  if (!bounds) return null;
  return {
    west: bounds.west + offset.lng,
    south: bounds.south + offset.lat,
    east: bounds.east + offset.lng,
    north: bounds.north + offset.lat,
  } satisfies IndiaViewportBounds;
}

function shiftPosition(
  coordinates: number[],
  offset: { lng: number; lat: number },
) {
  return [coordinates[0] + offset.lng, coordinates[1] + offset.lat];
}

function shiftGeometryCoordinates(
  geometry: Geometry,
  offset: { lng: number; lat: number },
): Geometry {
  switch (geometry.type) {
    case "Point":
      return {
        type: "Point",
        coordinates: shiftPosition(geometry.coordinates, offset),
      } satisfies Point;
    case "MultiPoint":
      return {
        type: "MultiPoint",
        coordinates: geometry.coordinates.map((coordinates) =>
          shiftPosition(coordinates, offset),
        ),
      } satisfies MultiPoint;
    case "LineString":
      return {
        type: "LineString",
        coordinates: geometry.coordinates.map((coordinates) =>
          shiftPosition(coordinates, offset),
        ),
      } satisfies LineString;
    case "MultiLineString":
      return {
        type: "MultiLineString",
        coordinates: geometry.coordinates.map((line) =>
          line.map((coordinates) => shiftPosition(coordinates, offset)),
        ),
      } satisfies MultiLineString;
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) =>
          ring.map((coordinates) => shiftPosition(coordinates, offset)),
        ),
      } satisfies Polygon;
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) =>
            ring.map((coordinates) => shiftPosition(coordinates, offset)),
          ),
        ),
      } satisfies MultiPolygon;
    default:
      return geometry;
  }
}

export function shiftFeatureGeometry<T extends Geometry>(
  feature: Feature<T> | null | undefined,
  offset: { lng: number; lat: number },
) {
  if (!feature) return null;
  return {
    ...feature,
    geometry: shiftGeometryCoordinates(feature.geometry, offset) as T,
  } satisfies Feature<T>;
}
