import type { Feature, FeatureCollection, Polygon } from "geojson";
import * as turf from "@turf/turf";
import {
  containsPoint,
  distanceToBounds,
  isFiniteNumber,
  lngLatToUtm,
  utmToLngLat,
} from "@/services/india/shared/geometry";
import { pickBestOverlayVillage } from "@/services/india/shared/overlay-sampling";
import { requestHttp } from "@/services/india/shared/bhunaksha-session";
import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";
import type {
  IndiaOverlayVillage,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";
import villageExtentRecords from "./village-extents.generated.json";

const {
  apiBaseUrl: HARYANA_API_BASE,
  referer: HARYANA_REFERER,
  stateCode: HARYANA_STATE_CODE,
} = INDIA_STATE_ENDPOINTS.haryana;
const HARYANA_UTM_ZONE = 43 as const;
const HARYANA_SAMPLE_CONCURRENCY = 18;

type HaryanaVillageExtentRecord = {
  stateCode: string;
  stateName: string;
  districtCode: string;
  districtName: string;
  subdistrictCode: string;
  subdistrictName: string;
  villageCode: string;
  villageName: string;
  mapTypeCode: string;
  mapTypeName: string;
  gisCode: string;
  attribution?: string | null;
  extent: IndiaViewportBounds;
};

type HaryanaPlotHitResponse = {
  id?: string;
  kide?: string;
  minx?: number;
  miny?: number;
  maxx?: number;
  maxy?: number;
  bhucode?: string;
};

type HaryanaPlotByNumberResponse = HaryanaPlotHitResponse;

const HARYANA_VILLAGE_RECORDS =
  villageExtentRecords as HaryanaVillageExtentRecord[];
const HARYANA_OVERLAY_VILLAGES = HARYANA_VILLAGE_RECORDS.map(buildVillageOverlay);

function normalizePortalText(value?: string | null) {
  if (!value) return null;
  if (/[\u0900-\u097F]/.test(value)) {
    return value;
  }
  if (!/(?:Ã|Â)/.test(value)) {
    return value;
  }
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

function trimPortalText(value?: string | null) {
  return normalizePortalText(value)?.replace(/\s+/g, " ").trim() || null;
}

function buildVillageOverlay(
  record: HaryanaVillageExtentRecord,
): IndiaOverlayVillage {
  return {
    stateCode: HARYANA_STATE_CODE,
    stateName: "Haryana",
    gisCode: record.gisCode,
    overlayCodes: null,
    extent: record.extent,
    administrativeLevels: [
      { code: record.districtCode, label: "District", value: record.districtName },
      {
        code: record.subdistrictCode,
        label: "Tehsil",
        value: record.subdistrictName,
      },
      { code: record.villageCode, label: "Village", value: record.villageName },
      { code: record.mapTypeCode, label: "Map Type", value: record.mapTypeName },
    ],
    districtName: record.districtName,
    subdistrictName: record.subdistrictName,
    villageName: record.villageName,
  };
}

function parsePlotInfoText(value?: string | null) {
  const text = trimPortalText(value) || "";
  const totalAreaMatch = text.match(/Total\s+Area\s*:\s*([\s\S]*?)(?=Owners\s*:|$)/i);
  const ownersMatch = text.match(/Owners\s*:\s*([\s\S]+)$/i);
  const ownerText = ownersMatch?.[1]?.trim() || null;

  return {
    text: text || null,
    areaLabel: totalAreaMatch?.[1]?.trim() || null,
    owners: ownerText ? [ownerText] : [],
  };
}

function buildParcelFields(
  plotNo: string,
  plotId: string,
  parsedInfo: ReturnType<typeof parsePlotInfoText>,
): IndiaParcelField[] {
  return [
    { label: "Khasra", value: plotNo },
    { label: "Plot ID", value: plotId },
    { label: "Area", value: parsedInfo.areaLabel || "N/A" },
    { label: "Owners", value: parsedInfo.owners[0] || "N/A" },
  ];
}

function buildParcelExtent(hit: HaryanaPlotHitResponse) {
  if (
    !isFiniteNumber(hit.minx) ||
    !isFiniteNumber(hit.miny) ||
    !isFiniteNumber(hit.maxx) ||
    !isFiniteNumber(hit.maxy)
  ) {
    return null;
  }

  const corners = [
    utmToLngLat(hit.minx, hit.miny, HARYANA_UTM_ZONE),
    utmToLngLat(hit.minx, hit.maxy, HARYANA_UTM_ZONE),
    utmToLngLat(hit.maxx, hit.miny, HARYANA_UTM_ZONE),
    utmToLngLat(hit.maxx, hit.maxy, HARYANA_UTM_ZONE),
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

function buildExtentPolygon(
  extent: IndiaViewportBounds,
  properties: Record<string, string>,
): Feature<Polygon> {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [extent.west, extent.south],
        [extent.east, extent.south],
        [extent.east, extent.north],
        [extent.west, extent.north],
        [extent.west, extent.south],
      ]],
    },
  };
}

function buildCellPolygon(
  bounds: IndiaViewportBounds,
  properties: Record<string, string>,
): Feature<Polygon> {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bounds.west, bounds.south],
        [bounds.east, bounds.south],
        [bounds.east, bounds.north],
        [bounds.west, bounds.north],
        [bounds.west, bounds.south],
      ]],
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

async function postFormJson<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    body.set(key, String(value));
  });

  const response = await requestHttp({
    url: `${HARYANA_API_BASE}/${path}`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      Referer: HARYANA_REFERER,
    },
    body: body.toString(),
    rejectUnauthorized: false,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Haryana BhuNaksha request failed (${response.statusCode}) for ${path}`,
    );
  }

  return JSON.parse(response.body.toString("utf8")) as T;
}

async function postJsonText(
  path: string,
  payload: Record<string, string | number | boolean | null | undefined>,
) {
  const response = await requestHttp({
    url: `${HARYANA_API_BASE}/${path}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/plain, application/json, */*",
      "User-Agent": "Mozilla/5.0",
      Referer: HARYANA_REFERER,
    },
    body: JSON.stringify(payload),
    rejectUnauthorized: false,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Haryana BhuNaksha request failed (${response.statusCode}) for ${path}`,
    );
  }

  return response.body.toString("utf8");
}

async function samplePlotHit(
  gisCode: string,
  coordinates: [number, number],
) {
  const [x, y] = lngLatToUtm(
    coordinates[0],
    coordinates[1],
    HARYANA_UTM_ZONE,
  );

  return postFormJson<HaryanaPlotHitResponse>("MapInfo/getPlotAtXY", {
    giscode: gisCode,
    x,
    y,
    plotno: "",
  }).catch(() => null);
}

async function approximatePlotGeometry(
  gisCode: string,
  plotId: string,
  plotNo: string,
  extent: IndiaViewportBounds,
) {
  const columns = 10;
  const rows = 10;
  const stepLng = (extent.east - extent.west) / columns;
  const stepLat = (extent.north - extent.south) / rows;
  const cells = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cellBounds = {
      west: extent.west + stepLng * column,
      east: extent.west + stepLng * (column + 1),
      south: extent.south + stepLat * row,
      north: extent.south + stepLat * (row + 1),
    } satisfies IndiaViewportBounds;
    const samplePoint: [number, number] = [
      (cellBounds.west + cellBounds.east) / 2,
      (cellBounds.south + cellBounds.north) / 2,
    ];
    return { cellBounds, samplePoint };
  });

  const sampled = await mapWithConcurrency(
    cells,
    HARYANA_SAMPLE_CONCURRENCY,
    async ({ cellBounds, samplePoint }) => {
      const hit = await samplePlotHit(gisCode, samplePoint);
      if (!hit?.id || hit.id !== plotId) return null;
      return buildCellPolygon(cellBounds, { plotId, plotNo });
    },
  );

  const occupied = sampled.filter(
    (feature): feature is Feature<Polygon> => Boolean(feature),
  );
  if (occupied.length === 0) {
    return null;
  }

  const dissolved = turf.dissolve(
    turf.featureCollection(occupied as Array<Feature<Polygon>>),
    { propertyName: "plotId" },
  ) as FeatureCollection<Polygon>;
  return dissolved.features[0] || null;
}

function findVillageRecordsByCoordinates(coordinates: [number, number]) {
  const containing = HARYANA_VILLAGE_RECORDS
    .filter((record) => containsPoint(record.extent, coordinates))
    .sort(
      (a, b) =>
        distanceToBounds(a.extent, coordinates) -
        distanceToBounds(b.extent, coordinates),
    );

  if (containing.length > 0) {
    return containing;
  }

  const nearest = HARYANA_VILLAGE_RECORDS
    .map((record) => ({
      record,
      distance: distanceToBounds(record.extent, coordinates),
    }))
    .sort((a, b) => a.distance - b.distance)
    .filter((entry) => entry.distance <= 0.02)
    .slice(0, 4)
    .map((entry) => entry.record);

  return nearest;
}

export const HaryanaParcelService = {
  stateCode: HARYANA_STATE_CODE,

  async resolveVillageOverlay(
    bounds: IndiaViewportBounds,
  ): Promise<IndiaOverlayVillage | null> {
    const village = pickBestOverlayVillage(bounds, HARYANA_OVERLAY_VILLAGES);
    return village || null;
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<IndiaParcelSelection | null> {
    const villageCandidates = findVillageRecordsByCoordinates(coordinates);
    if (villageCandidates.length === 0) {
      return null;
    }

    const [easting, northing] = lngLatToUtm(
      coordinates[0],
      coordinates[1],
      HARYANA_UTM_ZONE,
    );

    let villageRecord: HaryanaVillageExtentRecord | null = null;
    let hit: HaryanaPlotHitResponse | null = null;

    for (const candidate of villageCandidates) {
      const response = await postFormJson<HaryanaPlotHitResponse>("MapInfo/getPlotAtXY", {
        giscode: candidate.gisCode,
        x: easting,
        y: northing,
        plotno: "",
      }).catch(() => null);

      if (response?.id && response.kide) {
        villageRecord = candidate;
        hit = response;
        break;
      }
    }

    if (!villageRecord || !hit?.id || !hit.kide) {
      return null;
    }

    const [infoText, plotByNumber] = await Promise.all([
      postJsonText("MapInfo/getPlotInfo", {
        gisCode: villageRecord.gisCode,
        plotNo: hit.kide,
      }).catch(() => ""),
      postFormJson<HaryanaPlotByNumberResponse>("MapInfo/getPlotByPlotNo", {
        giscode: villageRecord.gisCode,
        plotno: hit.kide,
      }).catch(() => null),
    ]);

    const parsedInfo = parsePlotInfoText(infoText);
    const resolvedPlot = plotByNumber?.id ? plotByNumber : hit;
    const parcelExtent = buildParcelExtent(resolvedPlot);
    const plotId = plotByNumber?.id || hit.id;
    const parcelGeometry = parcelExtent
      ? await approximatePlotGeometry(
          villageRecord.gisCode,
          plotId,
          hit.kide,
          parcelExtent,
        ).catch(() => null)
      : null;

    return {
      stateCode: HARYANA_STATE_CODE,
      stateName: "Haryana",
      sourceName: "Haryana Revenue BhuNaksha",
      gisCode: villageRecord.gisCode,
      plotId,
      plotNo: hit.kide,
      parcelLabel: `Khasra ${hit.kide}`,
      locationLabel: [
        villageRecord.villageName,
        villageRecord.subdistrictName,
        villageRecord.districtName,
      ]
        .filter(Boolean)
        .join(", "),
      districtName: villageRecord.districtName,
      subdistrictName: villageRecord.subdistrictName,
      villageName: villageRecord.villageName,
      gisInfo: villageRecord.attribution || null,
      areaLabel: parsedInfo.areaLabel,
      owners: parsedInfo.owners,
      remarks: null,
      infoHtml: parsedInfo.text,
      infoLinksHtml: null,
      mapSketchUrl: null,
      geometry:
        parcelGeometry ||
        (parcelExtent
          ? buildExtentPolygon(parcelExtent, {
              plotId,
              plotNo: hit.kide,
            })
          : null),
      extent: parcelExtent,
      parcelFields: buildParcelFields(hit.kide, plotId, parsedInfo),
      administrativeFields: [
        { label: "District", value: villageRecord.districtName },
        { label: "Tehsil", value: villageRecord.subdistrictName },
        { label: "Village", value: villageRecord.villageName },
        { label: "Map Type", value: villageRecord.mapTypeName },
      ],
      sourceBadge: "Official Revenue Haryana",
      overlay: {
        highlightType: "geometry",
      },
    };
  },

  async buildParcelOverlay(
    bounds: IndiaViewportBounds,
    gisCode: string,
  ): Promise<FeatureCollection<Polygon>> {
    const villageRecord = HARYANA_VILLAGE_RECORDS.find(
      (record) => record.gisCode === gisCode,
    );
    if (!villageRecord) {
      return { type: "FeatureCollection", features: [] };
    }

    const west = Math.max(bounds.west, villageRecord.extent.west);
    const south = Math.max(bounds.south, villageRecord.extent.south);
    const east = Math.min(bounds.east, villageRecord.extent.east);
    const north = Math.min(bounds.north, villageRecord.extent.north);

    if (west >= east || south >= north) {
      return { type: "FeatureCollection", features: [] };
    }

    const aspectRatio = Math.max(
      1,
      (east - west) / Math.max(north - south, 0.000001),
    );
    const sampleRows = 18;
    const sampleColumns = Math.max(
      18,
      Math.min(30, Math.round(sampleRows * aspectRatio)),
    );

    const stepLng = (east - west) / sampleColumns;
    const stepLat = (north - south) / sampleRows;
    const cells = Array.from({ length: sampleRows * sampleColumns }, (_, index) => {
      const row = Math.floor(index / sampleColumns);
      const column = index % sampleColumns;
      const cellBounds = {
        west: west + stepLng * column,
        east: west + stepLng * (column + 1),
        south: south + stepLat * row,
        north: south + stepLat * (row + 1),
      } satisfies IndiaViewportBounds;
      const samplePoint: [number, number] = [
        (cellBounds.west + cellBounds.east) / 2,
        (cellBounds.south + cellBounds.north) / 2,
      ];
      return { cellBounds, samplePoint };
    });

    const sampledCells = await mapWithConcurrency(
      cells,
      HARYANA_SAMPLE_CONCURRENCY,
      async ({ cellBounds, samplePoint }) => {
        const hit = await samplePlotHit(gisCode, samplePoint);
        if (!hit?.id || !hit.kide) return null;
        return buildCellPolygon(cellBounds, {
          plotId: hit.id,
          plotNo: hit.kide,
        });
      },
    );

    const occupiedCells = sampledCells.filter(
      (feature): feature is Feature<Polygon> => Boolean(feature),
    );
    if (occupiedCells.length === 0) {
      return { type: "FeatureCollection", features: [] };
    }

    const metadataByPlotId = new Map<string, { plotNo: string }>();
    occupiedCells.forEach((feature) => {
      const plotId = feature.properties?.plotId;
      const plotNo = feature.properties?.plotNo;
      if (plotId && plotNo && !metadataByPlotId.has(plotId)) {
        metadataByPlotId.set(plotId, { plotNo });
      }
    });

    const dissolved = turf.dissolve(
      turf.featureCollection(occupiedCells as Array<Feature<Polygon>>),
      { propertyName: "plotId" },
    ) as FeatureCollection<Polygon>;

    const features = dissolved.features.map((feature) => {
      const plotId = String(feature.properties?.plotId || "");
      const metadata = metadataByPlotId.get(plotId);
      return {
        ...feature,
        properties: {
          plotId,
          plotNo: metadata?.plotNo || "",
        },
      };
    });

    return {
      type: "FeatureCollection",
      features,
    };
  },
};

export default HaryanaParcelService;
