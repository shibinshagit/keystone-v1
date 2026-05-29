import type { Feature, MultiPolygon, Polygon } from "geojson";
import { requestHttp } from "@/services/india/shared/bhunaksha-session";
import {
  normalizeUtmExtentTo4326,
  parseUtmWktGeometry,
} from "@/services/india/shared/bhunaksha-portal";
import {
  boundsCenter,
  containsPoint,
  distanceToBounds,
  intersectionArea,
  isFiniteNumber,
  lngLatToUtm,
  rectArea,
} from "@/services/india/shared/geometry";
import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";
import type {
  IndiaOverlayVillage,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";
import assamVillageExtents from "./village-extents.generated.json";

const {
  baseUrl: ASSAM_BASE_URL,
  stateCode: ASSAM_STATE_CODE,
} = INDIA_STATE_ENDPOINTS.assam;
const ASSAM_UTM_ZONE = 46;
const ASSAM_OVERLAY_NEAREST_THRESHOLD = 0.05;

type AssamVillageExtentRecord = {
  stateCode: string;
  stateName: string;
  districtCode: string;
  districtName: string;
  subdivisionCode: string;
  subdivisionName: string;
  circleCode: string;
  circleName: string;
  mouzaCode: string;
  mouzaName: string;
  lotCode: string;
  lotName: string;
  villageCode: string;
  villageName: string;
  locationCode: string;
  extent: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
};

type AssamIndexedVillage = AssamVillageExtentRecord & {
  normalizedExtent: IndiaViewportBounds;
  districtDisplayName: string | null;
  subdivisionDisplayName: string | null;
  circleDisplayName: string | null;
  mouzaDisplayName: string | null;
  lotDisplayName: string | null;
  villageDisplayName: string | null;
};

type AssamAuthSession = {
  token: string;
  cookie: string;
  expiresAt: number;
};

type AssamClickInfoResponse = {
  area?: number | string | null;
  attributes?: Record<string, string | null | undefined> | null;
  id?: string | null;
  locationCode?: string | null;
  geom?: string | null;
  uniqueId?: string | null;
};

type AssamParcelInfoResponse = {
  responseCode?: string;
  execDt?: string;
  data?: Array<{
    id?: string | null;
    locationCode?: string | null;
    uniqueId?: string | null;
    geom?: string | null;
    attributes?: Record<string, string | null | undefined> | null;
    area?: number | string | null;
  }>;
};

const assamVillageIndex = (assamVillageExtents as AssamVillageExtentRecord[])
  .map((record) => {
    const normalizedExtent = normalizeUtmExtentTo4326(record.extent, ASSAM_UTM_ZONE);
    if (!normalizedExtent) {
      return null;
    }

    return {
      ...record,
      normalizedExtent,
      districtDisplayName: toDisplayName(record.districtName),
      subdivisionDisplayName: toDisplayName(record.subdivisionName),
      circleDisplayName: toDisplayName(record.circleName),
      mouzaDisplayName: toDisplayName(record.mouzaName),
      lotDisplayName: toDisplayName(record.lotName),
      villageDisplayName: toDisplayName(record.villageName),
    } satisfies AssamIndexedVillage;
  })
  .filter((record): record is AssamIndexedVillage => record !== null);

let assamAuthSession: AssamAuthSession | null = null;
let assamAuthSessionPromise: Promise<AssamAuthSession> | null = null;

function toDisplayName(value?: string | null) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const englishMatch = normalized.match(/\(\s*([^)]+?)\s*\)\s*$/);
  if (englishMatch?.[1] && englishMatch[1].toLowerCase() !== "null") {
    return englishMatch[1].trim();
  }

  return normalized.replace(/\s*\([^)]*\)\s*$/, "").trim() || normalized;
}

function extractCookieHeader(
  headers: Record<string, string | string[] | undefined>,
  cookieName: string,
) {
  const values = headers["set-cookie"];
  const cookieHeaders = Array.isArray(values) ? values : values ? [values] : [];

  for (const header of cookieHeaders) {
    const match = header.match(new RegExp(`${cookieName}=([^;]+)`));
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
}

async function getAssamAuthSession() {
  if (assamAuthSession && assamAuthSession.expiresAt > Date.now()) {
    return assamAuthSession;
  }

  if (!assamAuthSessionPromise) {
    assamAuthSessionPromise = (async () => {
      const response = await requestHttp({
        url: `${ASSAM_BASE_URL}/v1/mapView/MapViewAjaxApiCall/loginBhunaksha`,
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          `Assam loginBhunaksha failed (${response.statusCode}).`,
        );
      }

      const payload = JSON.parse(response.body.toString("utf8")) as {
        token?: string;
      };
      if (!payload.token) {
        throw new Error("Assam loginBhunaksha did not return a token.");
      }

      const cookieParts = [
        extractCookieHeader(response.headers, "XSRF-TOKEN"),
        extractCookieHeader(response.headers, "JSESSIONID"),
      ].filter(Boolean);

      const session = {
        token: payload.token,
        cookie: cookieParts.join("; "),
        expiresAt: Date.now() + 30 * 60 * 1000,
      } satisfies AssamAuthSession;

      assamAuthSession = session;
      return session;
    })().finally(() => {
      assamAuthSessionPromise = null;
    });
  }

  return assamAuthSessionPromise;
}

async function assamGetText(path: string) {
  const session = await getAssamAuthSession();
  const response = await requestHttp({
    url: `${ASSAM_BASE_URL}${path}`,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      Authorization: `Bearer ${session.token}`,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Assam request failed (${response.statusCode}) for ${path}`);
  }

  return response.body.toString("utf8");
}

async function assamGetJson<T>(path: string): Promise<T> {
  return JSON.parse(await assamGetText(path)) as T;
}

function buildVillageOverlay(record: AssamIndexedVillage): IndiaOverlayVillage {
  return {
    stateCode: ASSAM_STATE_CODE,
    stateName: "Assam",
    gisCode: record.locationCode,
    overlayCodes: null,
    extent: record.normalizedExtent,
    administrativeLevels: [
      {
        code: record.districtCode,
        label: "District",
        value: record.districtDisplayName || "N/A",
      },
      {
        code: record.subdivisionCode,
        label: "Subdivision",
        value: record.subdivisionDisplayName || "N/A",
      },
      {
        code: record.circleCode,
        label: "Circle",
        value: record.circleDisplayName || "N/A",
      },
      {
        code: record.mouzaCode,
        label: "Mouza Pargona",
        value: record.mouzaDisplayName || "N/A",
      },
      {
        code: record.lotCode,
        label: "Lot Number",
        value: record.lotDisplayName || "N/A",
      },
      {
        code: record.villageCode,
        label: "Village",
        value: record.villageDisplayName || "N/A",
      },
    ],
    districtName: record.districtDisplayName,
    subdistrictName: record.subdivisionDisplayName,
    villageName: record.villageDisplayName,
  };
}

function findVillageByPoint(coordinates: [number, number]) {
  const containing = assamVillageIndex.filter((record) =>
    containsPoint(record.normalizedExtent, coordinates),
  );
  if (containing.length > 0) {
    containing.sort(
      (a, b) =>
        rectArea(a.normalizedExtent) - rectArea(b.normalizedExtent) ||
        distanceToBounds(a.normalizedExtent, coordinates) -
          distanceToBounds(b.normalizedExtent, coordinates),
    );
    return containing[0] || null;
  }

  const nearest = assamVillageIndex
    .map((record) => ({
      record,
      distance: distanceToBounds(record.normalizedExtent, coordinates),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (!nearest || nearest.distance > ASSAM_OVERLAY_NEAREST_THRESHOLD) {
    return null;
  }

  return nearest.record;
}

function findVillageForBounds(bounds: IndiaViewportBounds) {
  const center = boundsCenter(bounds);
  const viewportArea = rectArea(bounds);

  const overlapping = assamVillageIndex
    .map((record) => ({
      record,
      overlapArea: intersectionArea(bounds, record.normalizedExtent),
      containsCenter: containsPoint(record.normalizedExtent, center),
      distanceToCenter: distanceToBounds(record.normalizedExtent, center),
    }))
    .filter((entry) => entry.overlapArea > 0);

  if (overlapping.length > 0) {
    overlapping.sort((a, b) => {
      if (a.containsCenter !== b.containsCenter) {
        return a.containsCenter ? -1 : 1;
      }

      const overlapRatioA = a.overlapArea / Math.max(viewportArea, 0.000001);
      const overlapRatioB = b.overlapArea / Math.max(viewportArea, 0.000001);
      if (Math.abs(overlapRatioB - overlapRatioA) > 0.000001) {
        return overlapRatioB - overlapRatioA;
      }

      return (
        rectArea(a.record.normalizedExtent) - rectArea(b.record.normalizedExtent) ||
        a.distanceToCenter - b.distanceToCenter
      );
    });

    return overlapping[0]?.record || null;
  }

  const nearest = assamVillageIndex
    .map((record) => ({
      record,
      distanceToCenter: distanceToBounds(record.normalizedExtent, center),
    }))
    .sort((a, b) => a.distanceToCenter - b.distanceToCenter)[0];

  if (!nearest || nearest.distanceToCenter > ASSAM_OVERLAY_NEAREST_THRESHOLD) {
    return null;
  }

  return nearest.record;
}

function stripHtml(value?: string | null) {
  return (value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function parsePlotInfoHtml(infoHtml: string) {
  const rows = Array.from(
    infoHtml.matchAll(
      /<div class='row-container'[^>]*>\s*<div class='title'>([\s\S]*?)<\/div>\s*<div class='value'[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
    ),
  ).map(([, title, value]) => ({
    title: stripHtml(title).replace(/:\s*$/, "").trim(),
    value: stripHtml(value),
  }));

  const rowMap = new Map<string, string>();
  const looseOwnerValues: string[] = [];
  let ownerSectionSeen = false;

  for (const row of rows) {
    if (row.title) {
      rowMap.set(row.title, row.value);
      ownerSectionSeen = /owner information/i.test(row.title);
      continue;
    }

    if (ownerSectionSeen && row.value) {
      looseOwnerValues.push(row.value);
    }
  }

  const ownerMatches = Array.from(
    infoHtml.matchAll(
      /Name\s*:?\s*([^<\n]+)(?:[\s\S]*?Father'?s name\s*:?\s*([^<\n]+))?/gi,
    ),
  );
  const ownersFromPairs = ownerMatches
    .map((match) => {
      const name = stripHtml(match[1]);
      const fatherName = stripHtml(match[2]);
      if (!name) return null;
      return fatherName ? `${name} (Father: ${fatherName})` : name;
    })
    .filter((value): value is string => Boolean(value));

  const owners = ownersFromPairs.length > 0 ? ownersFromPairs : looseOwnerValues;

  return {
    rows,
    rowMap,
    owners,
    areaInChitha: rowMap.get("Area in chitha") || null,
    pattaNo: rowMap.get("Patta no.") || null,
    dagsUnderPatta: rowMap.get("Dags under Patta") || null,
    pattaType: rowMap.get("Patta Type") || null,
    landClass: rowMap.get("Land Class") || null,
  };
}

function buildGeometryExtent(
  geometry: Feature<Polygon | MultiPolygon> | null,
): IndiaViewportBounds | null {
  if (!geometry) return null;

  const positions: number[][] = [];
  if (geometry.geometry.type === "Polygon") {
    geometry.geometry.coordinates.forEach((ring) => positions.push(...ring));
  } else {
    geometry.geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => positions.push(...ring)),
    );
  }

  if (positions.length === 0) return null;

  const lngs = positions.map(([lng]) => lng);
  const lats = positions.map(([, lat]) => lat);

  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function buildParcelFields(args: {
  plotNo: string;
  areaSqm: number | null;
  parsedInfo: ReturnType<typeof parsePlotInfoHtml>;
}) {
  const areaSqmLabel =
    args.areaSqm != null
      ? `${Math.round((args.areaSqm + Number.EPSILON) * 100) / 100} sqm`
      : "N/A";

  return [
    { label: "Dag", value: args.plotNo || "N/A" },
    { label: "Patta No", value: args.parsedInfo.pattaNo || "N/A" },
    { label: "Area in Chitha", value: args.parsedInfo.areaInChitha || "N/A" },
    { label: "Area", value: areaSqmLabel },
    { label: "Patta Type", value: args.parsedInfo.pattaType || "N/A" },
    { label: "Land Class", value: args.parsedInfo.landClass || "N/A" },
  ] satisfies IndiaParcelField[];
}

function buildAdministrativeFields(village: AssamIndexedVillage) {
  return [
    { label: "District", value: village.districtDisplayName || "N/A" },
    { label: "Subdivision", value: village.subdivisionDisplayName || "N/A" },
    { label: "Circle", value: village.circleDisplayName || "N/A" },
    { label: "Mouza Pargona", value: village.mouzaDisplayName || "N/A" },
    { label: "Lot Number", value: village.lotDisplayName || "N/A" },
    { label: "Village", value: village.villageDisplayName || "N/A" },
  ] satisfies IndiaParcelField[];
}

async function getAssamClickInfo(
  village: AssamIndexedVillage,
  coordinates: [number, number],
) {
  const [x, y] = lngLatToUtm(coordinates[0], coordinates[1], ASSAM_UTM_ZONE);
  return assamGetJson<AssamClickInfoResponse>(
    `/v1/mapView/MapViewAjaxApiCall/click_info/${village.locationCode}?layer_code=ASSAM_PARCEL&attributes=${village.locationCode.slice(
      0,
      6,
    )}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}`,
  );
}

async function getAssamParcelInfo(
  locationCode: string,
  plotNo: string,
) {
  return assamGetJson<AssamParcelInfoResponse>(
    `/v1/mapView/MapViewAjaxApiCall/parcel_info_click/${locationCode}?layer_code=ASSAM_PARCEL&attributes=${encodeURIComponent(
      JSON.stringify({ TEXTPARCEL: plotNo }),
    )}`,
  );
}

async function getAssamPlotInfo(locationCode: string, plotNo: string) {
  return assamGetText(
    `/v1/mapView/MapViewAjaxApiCall/plot_info/${locationCode}?plotNo=${encodeURIComponent(
      plotNo,
    )}`,
  );
}

export const AssamParcelService = {
  stateCode: ASSAM_STATE_CODE,

  async resolveVillageOverlay(bounds: IndiaViewportBounds) {
    const village = findVillageForBounds(bounds);
    return village ? buildVillageOverlay(village) : null;
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<IndiaParcelSelection | null> {
    const village = findVillageByPoint(coordinates);
    if (!village) {
      return null;
    }

    const clickInfo = await getAssamClickInfo(village, coordinates).catch(() => null);
    const plotNo = clickInfo?.attributes?.TEXTPARCEL?.trim();
    if (!clickInfo?.id || !plotNo) {
      return null;
    }

    const [parcelInfo, plotInfoHtml] = await Promise.all([
      getAssamParcelInfo(village.locationCode, plotNo).catch(() => null),
      getAssamPlotInfo(village.locationCode, plotNo).catch(() => null),
    ]);

    const parcelRecord = parcelInfo?.data?.[0] || null;
    const geometry = parseUtmWktGeometry(
      parcelRecord?.geom || clickInfo.geom,
      ASSAM_UTM_ZONE,
    );
    const parsedInfo = parsePlotInfoHtml(plotInfoHtml || "");
    const areaSqm = isFiniteNumber(Number(clickInfo.area))
      ? Number(clickInfo.area)
      : parcelRecord?.area != null && isFiniteNumber(Number(parcelRecord.area))
        ? Number(parcelRecord.area)
        : null;

    return {
      stateCode: ASSAM_STATE_CODE,
      stateName: "Assam",
      sourceName: "Assam BhuNaksha",
      gisCode: village.locationCode,
      plotId: parcelRecord?.id || clickInfo.id,
      plotNo,
      parcelLabel: `Dag ${plotNo}`,
      locationLabel:
        [
          village.villageDisplayName,
          village.circleDisplayName,
          village.districtDisplayName,
        ]
          .filter(Boolean)
          .join(", ") || "Assam Parcel",
      districtName: village.districtDisplayName,
      subdistrictName: village.subdivisionDisplayName,
      villageName: village.villageDisplayName,
      gisInfo: [
        clickInfo.attributes?.DISTRICT,
        clickInfo.attributes?.CIRCLE,
        clickInfo.attributes?.MOUZA,
        clickInfo.attributes?.VILLAGE,
      ]
        .filter(Boolean)
        .join(", "),
      surveyNo: plotNo,
      areaSqm,
      areaLabel:
        areaSqm != null
          ? `${Math.round((areaSqm + Number.EPSILON) * 100) / 100} sqm`
          : parsedInfo.areaInChitha,
      owners: parsedInfo.owners,
      remarks: parsedInfo.dagsUnderPatta
        ? `Dags under Patta: ${parsedInfo.dagsUnderPatta}`
        : null,
      infoHtml: plotInfoHtml,
      infoLinksHtml: null,
      mapSketchUrl: null,
      geometry,
      extent: buildGeometryExtent(geometry),
      parcelFields: buildParcelFields({
        plotNo,
        areaSqm,
        parsedInfo,
      }),
      administrativeFields: buildAdministrativeFields(village),
      sourceBadge: "Official Revenue Assam",
      plotReportUrl: null,
      overlay: {
        highlightType: "geometry",
      },
    };
  },

  async fetchWmsImage(args: {
    locationCode: string;
    bbox: [number, number, number, number];
    width: number;
    height: number;
    layerCode?: string;
    mapType?: string;
    style?: string | null;
    transparent?: string;
    format?: string;
  }) {
    const session = await getAssamAuthSession();
    const target = new URL(
      `/v1/map/wms/${args.locationCode}`,
      ASSAM_BASE_URL,
    );
    target.searchParams.set("layer_code", args.layerCode || "ASSAM_PARCEL");
    target.searchParams.set("map_type", args.mapType || "GENERIC_MAP");
    target.searchParams.set("ignore_georef", "N");
    target.searchParams.set("srs", "32646");
    target.searchParams.set("VERSION", "1.1.1");
    target.searchParams.set("SERVICE", "WMS");
    target.searchParams.set("REQUEST", "GetMap");
    target.searchParams.set("FORMAT", args.format || "image/png");
    target.searchParams.set("WIDTH", String(args.width));
    target.searchParams.set("HEIGHT", String(args.height));
    target.searchParams.set("BBOX", args.bbox.join(","));
    target.searchParams.set("transparent", args.transparent || "true");
    target.searchParams.set("auth_key", session.token);
    if (args.style) {
      target.searchParams.set("style", args.style);
    }

    return requestHttp({
      url: target.toString(),
      headers: {
        Accept: "image/png,*/*",
        "User-Agent": "Mozilla/5.0",
        Authorization: `Bearer ${session.token}`,
        Referer: `${ASSAM_BASE_URL}/`,
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
    });
  },
};

export default AssamParcelService;
