import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { KeralaParcelSelection } from "@/lib/types";

const KERALA_EMAPS_BASE = "https://emaps.kerala.gov.in/bhunaksha";
const KERALA_STATE_CODE = "32" as const;

type PlotAtCoordinateResponse = {
  vsrno?: string;
  gis_code?: string;
  plot_no?: string;
  gisinfo?: string;
  id?: string;
  attrs?: string;
};

type PlotInfoResponse = {
  the_geom?: string;
  map_area?: number;
  plotid?: string;
  info?: string;
  infoLinks?: string;
  plotno?: string;
  area?: number;
  formatedArea?: string;
  gisinfo?: string;
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  giscode?: string;
};

type PlotExtentResponse = {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  giscode?: string;
};

type KeralaLevelOption = {
  code: string;
  value: string;
  extraParms?: {
    hasData?: boolean;
    extentError?: string;
    village_type?: string | null;
  } | null;
};

type KeralaViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type KeralaVillageExtent = {
  districtCode: string;
  districtName: string;
  talukCode: string;
  talukName: string;
  villageCode: string;
  villageName: string;
  villageType: string | null;
  vsrNo: string;
  gisCode: string;
  extent: KeralaViewportBounds;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function webMercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat =
    (180 / Math.PI) *
    (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lng, lat];
}

function trimHtmlBreaks(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").trim();
}

function decodeMaybeBase64Json<T>(value?: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function parseLocationParts(gisInfo?: string | null) {
  if (!gisInfo) {
    return {
      districtName: null,
      talukName: null,
      villageName: null,
    };
  }

  const districtMatch = gisInfo.match(/District\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const talukMatch = gisInfo.match(/Taluk\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const villageMatch = gisInfo.match(/Village\s*:\s*[^,]*\s(.+?)(?:,|$)/i);

  return {
    districtName: districtMatch?.[1]?.trim() || null,
    talukName: talukMatch?.[1]?.trim() || null,
    villageName: villageMatch?.[1]?.trim() || null,
  };
}

function parseInfoSections(info?: string | null) {
  const text = trimHtmlBreaks(info || "");
  const owners: string[] = [];

  const ownerSectionMatch = text.match(
    /Owner details:\s*([\s\S]*?)(?:Remarks\s*:|$)/i,
  );
  if (ownerSectionMatch?.[1]) {
    const ownerSection = ownerSectionMatch[1]
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    let current = "";
    for (const line of ownerSection) {
      if (/^\d+\s*:/.test(line)) {
        if (current) owners.push(current.trim());
        current = line.replace(/^\d+\s*:\s*/, "").trim();
      } else if (current) {
        current += ` ${line}`;
      }
    }
    if (current) owners.push(current.trim());
  }

  const remarksMatch = text.match(/Remarks\s*:\s*([\s\S]*?)$/i);
  const blockSurveyMatch = text.match(
    /Block No\.\s*([^\s,]+),\s*Survey No\.\s*([^\s,]+)/i,
  );
  const subDivMatch = text.match(/Sub Div No\.\s*([^\n]*)/i);
  const areaMatch = text.match(
    /Square Metre\s*:\s*([\d.]+)/i,
  );

  return {
    owners,
    remarks: remarksMatch?.[1]?.trim() || null,
    blockNo: blockSurveyMatch?.[1]?.trim() || null,
    surveyNo: blockSurveyMatch?.[2]?.trim() || null,
    subdivisionNo: subDivMatch?.[1]?.trim() || null,
    areaSqmFromInfo: areaMatch?.[1] ? Number(areaMatch[1]) : null,
  };
}

function parseInfoLinksHtml(infoLinks?: string | null) {
  const hrefMatch = infoLinks?.match(/href="([^"]+)"/i);
  if (!hrefMatch?.[1]) return null;
  const href = hrefMatch[1];
  return href.startsWith("http")
    ? href
    : `${KERALA_EMAPS_BASE}/${href.replace(/^\.\.\//, "")}`;
}

function parseWktGeometry(wkt?: string | null): Feature<Polygon | MultiPolygon> | null {
  if (!wkt) return null;

  const normalized = wkt.trim();
  if (normalized.startsWith("MULTIPOLYGON")) {
    const body = normalized.replace(/^MULTIPOLYGON\s*\(\(\(/i, "").replace(/\)\)\)\s*$/i, "");
    const polygonTexts = body.split(/\)\)\s*,\s*\(\(/);
    const coordinates = polygonTexts.map((polygonText) =>
      polygonText
        .split(/\)\s*,\s*\(/)
        .map((ringText) =>
          ringText.split(",").map((pair) => {
            const [x, y] = pair.trim().split(/\s+/).map(Number);
            return webMercatorToLngLat(x, y);
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
    const body = normalized.replace(/^POLYGON\s*\(\(/i, "").replace(/\)\)\s*$/i, "");
    const rings = body.split(/\)\s*,\s*\(/).map((ringText) =>
      ringText.split(",").map((pair) => {
        const [x, y] = pair.trim().split(/\s+/).map(Number);
        return webMercatorToLngLat(x, y);
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

async function postForm<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });

  const response = await fetch(`${KERALA_EMAPS_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kerala eMaps request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

function normalizeExtent(extent: PlotExtentResponse | null | undefined) {
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
  };
}

function hasValidExtent(
  extent: PlotExtentResponse | null | undefined,
): extent is PlotExtentResponse & {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
} {
  return Boolean(
    extent &&
      isFiniteNumber(extent.xmin) &&
      isFiniteNumber(extent.ymin) &&
      isFiniteNumber(extent.xmax) &&
      isFiniteNumber(extent.ymax),
  );
}

function rectArea(bounds: KeralaViewportBounds) {
  return Math.max(0, bounds.east - bounds.west) * Math.max(0, bounds.north - bounds.south);
}

function intersectionArea(a: KeralaViewportBounds, b: KeralaViewportBounds) {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return 0;
  return (east - west) * (north - south);
}

function containsPoint(bounds: KeralaViewportBounds, coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return (
    lng >= bounds.west &&
    lng <= bounds.east &&
    lat >= bounds.south &&
    lat <= bounds.north
  );
}

function distanceToBounds(bounds: KeralaViewportBounds, coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  const dx =
    lng < bounds.west ? bounds.west - lng : lng > bounds.east ? lng - bounds.east : 0;
  const dy =
    lat < bounds.south ? bounds.south - lat : lat > bounds.north ? lat - bounds.north : 0;
  return Math.hypot(dx, dy);
}

function boundsCenter(bounds: KeralaViewportBounds): [number, number] {
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

let villageExtentsPromise: Promise<KeralaVillageExtent[]> | null = null;

async function getLevelsAfter(
  level: number,
  codes: string,
): Promise<KeralaLevelOption[][]> {
  return postForm<KeralaLevelOption[][]>("rest/Levels/ListsAfterLevel", {
    state: KERALA_STATE_CODE,
    level,
    codes,
    hasmap: true,
  });
}

async function buildVillageExtentsIndex(): Promise<KeralaVillageExtent[]> {
  const root = await getLevelsAfter(0, "");
  const districts = (root[0] || []).filter((option) => option?.extraParms?.hasData !== false);
  const entries: KeralaVillageExtent[] = [];

  for (const district of districts) {
    const talukResponse = await getLevelsAfter(1, `${district.code},`).catch(() => []);
    const taluks = (talukResponse[0] || []).filter(
      (option) => option?.extraParms?.hasData !== false,
    );

    for (const taluk of taluks) {
      const villageResponse = await getLevelsAfter(2, `${district.code},${taluk.code},`).catch(
        () => [],
      );
      const villages = (villageResponse[0] || []).filter(
        (option) => option?.extraParms?.hasData !== false,
      );

      const extentResults = await Promise.all(
        villages.map(async (village) => {
          const vsrNo = `${district.code}${taluk.code}${village.code}`;
          const extent = await postForm<PlotExtentResponse>(
            "rest/MapInfo/getVVVVExtentGeoref",
            {
              state: KERALA_STATE_CODE,
              vsrno: vsrNo,
              srs: "4326",
            },
          ).catch(() => null);

          if (!hasValidExtent(extent)) {
            return null;
          }

          return {
            districtCode: district.code,
            districtName: district.value,
            talukCode: taluk.code,
            talukName: taluk.value,
            villageCode: village.code,
            villageName: village.value,
            villageType: village.extraParms?.village_type || null,
            vsrNo,
            gisCode: extent.giscode || vsrNo,
            extent: {
              west: extent.xmin,
              south: extent.ymin,
              east: extent.xmax,
              north: extent.ymax,
            },
          } satisfies KeralaVillageExtent;
        }),
      );

      entries.push(
        ...extentResults.filter((entry): entry is KeralaVillageExtent => Boolean(entry)),
      );
    }
  }

  return entries;
}

async function getVillageExtentsIndex() {
  if (!villageExtentsPromise) {
    villageExtentsPromise = buildVillageExtentsIndex().catch((error) => {
      villageExtentsPromise = null;
      throw error;
    });
  }

  return villageExtentsPromise;
}

export const KeralaParcelService = {
  stateCode: KERALA_STATE_CODE,

  isKeralaCoordinate(lng: number, lat: number) {
    return lng >= 74.8 && lng <= 77.7 && lat >= 8.0 && lat <= 12.9;
  },

  looksLikeKeralaLocation(location?: string | null) {
    return /\bkerala\b/i.test(location || "");
  },

  async resolveVillageOverlay(bounds: KeralaViewportBounds) {
    const villages = await getVillageExtentsIndex();
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

        return a.distanceToCenter - b.distanceToCenter;
      });

      return overlapping[0].village;
    }

    const nearest = villages
      .map((village) => ({
        village,
        distanceToCenter: distanceToBounds(village.extent, center),
      }))
      .sort((a, b) => a.distanceToCenter - b.distanceToCenter)[0];

    if (!nearest || nearest.distanceToCenter > 0.015) {
      return null;
    }

    return nearest.village;
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<KeralaParcelSelection | null> {
    const [lng, lat] = coordinates;
    const hit = await postForm<PlotAtCoordinateResponse>(
      "rest/MapInfo/getPlotAtXYGeoref",
      {
        state: KERALA_STATE_CODE,
        srs: "4326",
        x: lng,
        y: lat,
      },
    );

    if (!hit?.id || !hit.gis_code) {
      return null;
    }

    const attrs = decodeMaybeBase64Json<{ vsno?: string; bcode?: string }>(hit.attrs);
    const plotInfo = await postForm<PlotInfoResponse>(
      "rest/MapInfo/getPlotInfo",
      {
        state: KERALA_STATE_CODE,
        giscode: hit.gis_code,
        plotid: hit.id,
        attrs: attrs?.bcode || "",
      },
    );

    const extent = await postForm<PlotExtentResponse>(
      "rest/MapInfo/getExtentGeoref",
      {
        state: KERALA_STATE_CODE,
        giscode: hit.gis_code,
        plotid: hit.id,
        srs: "4326",
      },
    ).catch(() => null);

    const parsedInfo = parseInfoSections(plotInfo?.info);
    const parsedLocation = parseLocationParts(plotInfo?.gisinfo || hit.gisinfo);

    return {
      stateCode: KERALA_STATE_CODE,
      gisCode: hit.gis_code,
      vsrNo: hit.vsrno || hit.gis_code,
      plotId: hit.id,
      plotNo: plotInfo?.plotno || hit.plot_no || null,
      blockNo: parsedInfo.blockNo || attrs?.bcode || null,
      surveyNo: parsedInfo.surveyNo || attrs?.vsno || null,
      subdivisionNo:
        parsedInfo.subdivisionNo && parsedInfo.subdivisionNo !== "null"
          ? parsedInfo.subdivisionNo
          : null,
      areaSqm:
        isFiniteNumber(plotInfo?.area)
          ? plotInfo.area
          : parsedInfo.areaSqmFromInfo,
      areaLabel: plotInfo?.formatedArea || null,
      districtName: parsedLocation.districtName,
      talukName: parsedLocation.talukName,
      villageName: parsedLocation.villageName,
      gisInfo: plotInfo?.gisinfo || hit.gisinfo || null,
      remarks: parsedInfo.remarks,
      owners: parsedInfo.owners,
      infoHtml: plotInfo?.info || null,
      infoLinksHtml: plotInfo?.infoLinks || null,
      mapSketchUrl: parseInfoLinksHtml(plotInfo?.infoLinks),
      geometry: parseWktGeometry(plotInfo?.the_geom),
      extent: normalizeExtent(extent),
    };
  },
};

export default KeralaParcelService;
