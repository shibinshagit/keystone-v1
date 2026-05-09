import {
  boundsCenter,
  containsPoint,
  distanceToBounds,
  intersectionArea,
  isFiniteNumber,
  rectArea,
} from "@/services/india/shared/geometry";
import type {
  IndiaOverlayVillage,
  IndiaParcelAdminLevel,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";

const PUNJAB_BHUNAKSHA_BASE = "https://gisbhunaksha.punjab.gov.in";
const PUNJAB_STATE_CODE = "03" as const;
const PUNJAB_COVERAGE = {
  west: 73.8,
  south: 29.5,
  east: 76.95,
  north: 32.55,
} as const;

type PunjabLevelOption = {
  code: string;
  value: string;
  extraParms?: {
    hasData?: boolean;
  } | null;
};

type PunjabExtentResponse = {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  gisCode?: string;
  giscode?: string;
  attribution?: string;
};

type PunjabPlotAtXYResponse = {
  id?: string;
  kide?: string;
  gis_code?: string;
  giscode?: string;
  gisCode?: string;
  plot_no?: string;
  gisinfo?: string;
};

type PunjabScalarPlotResponse = {
  has_data?: string;
  ID?: string;
  plotNo?: string;
  PNIU?: string;
  info?: string;
  plotInfoLinks?: string;
  gisCode?: string;
  center_x?: number | null;
  center_y?: number | null;
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
};

type PunjabLayerRecord = {
  id?: string;
  autoShowLayer?: string;
  layerDescription?: string;
};

type PunjabVillageRecord = IndiaOverlayVillage & {
  selectedLevels: string;
};

const districtVillageCache = new Map<string, Promise<PunjabVillageRecord[]>>();
let districtExtentsPromise: Promise<PunjabVillageRecord[]> | null = null;
const overlayCodesCache = new Map<string, Promise<string | null>>();

function trimHtmlBreaks(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/gi, " ").trim();
}

function parseHref(value?: string | null) {
  const hrefMatch = value?.match(/href="([^"]+)"/i);
  if (!hrefMatch?.[1]) return null;
  const href = hrefMatch[1];
  return href.startsWith("http")
    ? href
    : `${PUNJAB_BHUNAKSHA_BASE}/${href.replace(/^\.\.\//, "")}`;
}

function normalizeExtent4326(
  extent: Pick<PunjabExtentResponse, "xmin" | "ymin" | "xmax" | "ymax"> | null | undefined,
): IndiaViewportBounds | null {
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

async function postForm<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });

  const response = await fetch(`${PUNJAB_BHUNAKSHA_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Punjab BhuNaksha request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

async function getScalarJson<T>(
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    search.set(key, String(value));
  });

  const response = await fetch(
    `${PUNJAB_BHUNAKSHA_BASE}/ScalarDatahandler?${search.toString()}`,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Punjab ScalarDatahandler failed (${response.status})`);
  }

  return (await response.json()) as T;
}

async function getLevelsAfter(
  level: number,
  codes: string,
): Promise<PunjabLevelOption[][]> {
  return postForm<PunjabLevelOption[][]>("rest/Levels/ListsAfterLevel", {
    state: PUNJAB_STATE_CODE,
    level,
    codes,
    hasmap: true,
  });
}

async function getExtentForLevels(selectedLevels: string) {
  return postForm<PunjabExtentResponse>("rest/MapInfo/getVVVVExtentGeoref", {
    state: PUNJAB_STATE_CODE,
    gisLevels: selectedLevels,
    srs: "4326",
  });
}

async function getLevelsFromGisCode(gisCode: string): Promise<string[]> {
  return postForm<string[]>("rest/Levels/levelsFromGiscode", {
    state: PUNJAB_STATE_CODE,
    giscode: gisCode,
  });
}

async function getPlotAtXYGeoref(coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return postForm<PunjabPlotAtXYResponse>("rest/MapInfo/getPlotAtXYGeoref", {
    state: PUNJAB_STATE_CODE,
    srs: "4326",
    x: lng,
    y: lat,
  });
}

async function getOverlayCodesForGisCode(gisCode: string) {
  const cached = overlayCodesCache.get(gisCode);
  if (cached) return cached;

  const promise = postForm<PunjabLayerRecord[]>("rest/Layers/getLayers", {
    state: PUNJAB_STATE_CODE,
    layerType: "TABLE_LAYER_MASTER",
    giscode: gisCode,
  })
    .then((layers) =>
      layers
        .filter((layer) => layer.id && layer.autoShowLayer === "Y")
        .map((layer) => layer.id?.trim())
        .filter((value): value is string => Boolean(value))
        .join(",") || null,
    )
    .catch(() => null);

  overlayCodesCache.set(gisCode, promise);
  return promise;
}

async function buildDistrictExtents() {
  const root = await getLevelsAfter(0, "");
  const districts = (root[0] || []).filter((option) => option?.extraParms?.hasData !== false);

  const items = await Promise.all(
    districts.map(async (district) => {
      const selectedLevels = `${district.code},`;
      const extent = await getExtentForLevels(selectedLevels).catch(() => null);
      const normalizedExtent = normalizeExtent4326(extent);
      if (!normalizedExtent) return null;

      return {
        stateCode: PUNJAB_STATE_CODE,
        stateName: "Punjab",
        gisCode: extent?.gisCode || extent?.giscode || district.code,
        extent: normalizedExtent,
        selectedLevels,
        administrativeLevels: [
          { code: district.code, label: "District", value: district.value },
        ],
        districtName: district.value,
        subdistrictName: null,
        villageName: null,
      } satisfies PunjabVillageRecord;
    }),
  );

  return items.filter(Boolean) as PunjabVillageRecord[];
}

async function getDistrictExtents(): Promise<PunjabVillageRecord[]> {
  if (!districtExtentsPromise) {
    districtExtentsPromise = buildDistrictExtents().catch((error) => {
      districtExtentsPromise = null;
      throw error;
    });
  }

  return districtExtentsPromise as Promise<PunjabVillageRecord[]>;
}

async function buildVillagesForDistrict(district: PunjabVillageRecord) {
  const districtCode = district.administrativeLevels[0]?.code;
  if (!districtCode) return [];

  const tehsilResponse = await getLevelsAfter(1, district.selectedLevels).catch(() => []);
  const tehsils = (tehsilResponse[0] || []).filter((option) => option?.extraParms?.hasData !== false);
  const entries: PunjabVillageRecord[] = [];

  for (const tehsil of tehsils) {
    const tehsilLevels = `${districtCode},${tehsil.code},`;
    const kanungoResponse = await getLevelsAfter(2, tehsilLevels).catch(() => []);
    const kanungos = (kanungoResponse[0] || []).filter(
      (option) => option?.extraParms?.hasData !== false,
    );

    for (const kanungo of kanungos) {
      const kanungoLevels = `${districtCode},${tehsil.code},${kanungo.code},`;
      const patwarResponse = await getLevelsAfter(3, kanungoLevels).catch(() => []);
      const patwars = (patwarResponse[0] || []).filter(
        (option) => option?.extraParms?.hasData !== false,
      );

      for (const patwar of patwars) {
        const patwarLevels = `${districtCode},${tehsil.code},${kanungo.code},${patwar.code},`;
        const villageResponse = await getLevelsAfter(4, patwarLevels).catch(() => []);
        const villages = (villageResponse[0] || []).filter(
          (option) => option?.extraParms?.hasData !== false,
        );

        const extentResults = await Promise.all(
          villages.map(async (village) => {
            const selectedLevels = `${districtCode},${tehsil.code},${kanungo.code},${patwar.code},${village.code},`;
            const extent = await getExtentForLevels(selectedLevels).catch(() => null);
            const normalizedExtent = normalizeExtent4326(extent);
            if (!normalizedExtent) return null;

            const gisCode = extent?.gisCode || extent?.giscode || village.code;
            const overlayCodes = await getOverlayCodesForGisCode(gisCode);

            return {
              stateCode: PUNJAB_STATE_CODE,
              stateName: "Punjab",
              gisCode,
              overlayCodes,
              extent: normalizedExtent,
              selectedLevels,
              administrativeLevels: [
                { code: districtCode, label: "District", value: district.districtName || districtCode },
                { code: tehsil.code, label: "Tehsil", value: tehsil.value },
                { code: kanungo.code, label: "Kanungo", value: kanungo.value },
                { code: patwar.code, label: "Patwar", value: patwar.value },
                { code: village.code, label: "Village", value: village.value },
              ],
              districtName: district.districtName,
              subdistrictName: tehsil.value,
              villageName: village.value,
            } satisfies PunjabVillageRecord;
          }),
        );

        entries.push(...(extentResults.filter(Boolean) as PunjabVillageRecord[]));
      }
    }
  }

  return entries;
}

async function getVillagesForDistrict(district: PunjabVillageRecord) {
  const districtCode = district.administrativeLevels[0]?.code || district.gisCode;
  const cached = districtVillageCache.get(districtCode);
  if (cached) return cached;

  const promise = buildVillagesForDistrict(district).catch((error) => {
    districtVillageCache.delete(districtCode);
    throw error;
  });
  districtVillageCache.set(districtCode, promise);
  return promise;
}

function pickBestOverlayVillage(
  bounds: IndiaViewportBounds,
  villages: PunjabVillageRecord[],
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

    return overlapping[0]?.village || null;
  }

  return null;
}

function parsePunjabInfo(info?: string | null) {
  const text = trimHtmlBreaks(info || "");
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const owners: string[] = [];
  for (const line of lines) {
    if (/owner|owner name|khatedar/i.test(line)) {
      owners.push(line.replace(/^.*?:\s*/, "").trim());
    }
  }

  const pniuMatch = text.match(/PNIU\s*:?\s*([^\n]+)/i);
  const areaMatch = text.match(/(?:Area|Square\s*Metre|Sq\.?\s*M)\s*:?\s*([^\n]+)/i);

  return {
    text,
    owners: owners.filter(Boolean),
    pniu: pniuMatch?.[1]?.trim() || null,
    areaLabel: areaMatch?.[1]?.trim() || null,
  };
}

function buildPunjabParcelFields(
  plot: PunjabScalarPlotResponse,
  hit: PunjabPlotAtXYResponse,
  parsedInfo: ReturnType<typeof parsePunjabInfo>,
): IndiaParcelField[] {
  return [
    { label: "Plot", value: plot.plotNo || hit.kide || hit.plot_no || "N/A" },
    { label: "Plot ID", value: plot.ID || hit.id || "N/A" },
    { label: "PNIU", value: plot.PNIU || parsedInfo.pniu || "N/A" },
    { label: "Area", value: parsedInfo.areaLabel || "N/A" },
  ];
}

function buildPlotReportUrl(plotLinksHtml?: string | null) {
  return parseHref(plotLinksHtml);
}

function parsePunjabGisInfo(gisInfo?: string | null) {
  if (!gisInfo) {
    return {
      districtName: null,
      subdistrictName: null,
      villageName: null,
    };
  }

  const districtMatch = gisInfo.match(/District\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const tehsilMatch = gisInfo.match(/Tehsil\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const villageMatch = gisInfo.match(/Village\s*:\s*[^,]*\s(.+?)(?:,|$)/i);

  return {
    districtName: districtMatch?.[1]?.trim() || null,
    subdistrictName: tehsilMatch?.[1]?.trim() || null,
    villageName: villageMatch?.[1]?.trim() || null,
  };
}

function buildViewportSamplePoints(bounds: IndiaViewportBounds): [number, number][] {
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

export const PunjabParcelService = {
  stateCode: PUNJAB_STATE_CODE,

  isPunjabCoordinate(lng: number, lat: number) {
    return (
      lng >= PUNJAB_COVERAGE.west &&
      lng <= PUNJAB_COVERAGE.east &&
      lat >= PUNJAB_COVERAGE.south &&
      lat <= PUNJAB_COVERAGE.north
    );
  },

  looksLikePunjabLocation(location?: string | null) {
    return /\bpunjab\b/i.test(location || "");
  },

  async resolveVillageOverlay(bounds: IndiaViewportBounds): Promise<IndiaOverlayVillage | null> {
    const samplePoints = buildViewportSamplePoints(bounds);

    for (const point of samplePoints) {
      const hit = await getPlotAtXYGeoref(point).catch(() => null);
      if (!hit?.gis_code) continue;

      const levels = await getLevelsFromGisCode(hit.gis_code).catch(() => null);
      if (!levels?.length) continue;

      const selectedLevels = `${levels.join(",")},`;
      const extent = await getExtentForLevels(selectedLevels).catch(() => null);
      const normalizedExtent = normalizeExtent4326(extent);
      if (!normalizedExtent) continue;

      const overlayCodes = await getOverlayCodesForGisCode(hit.gis_code);
      const parsedInfo = parsePunjabGisInfo(hit.gisinfo);

      return {
        stateCode: PUNJAB_STATE_CODE,
        stateName: "Punjab",
        gisCode: hit.gis_code,
        overlayCodes,
        extent: normalizedExtent,
        administrativeLevels: [
          { code: levels[0] || "", label: "District", value: parsedInfo.districtName || "N/A" },
          { code: levels[1] || "", label: "Tehsil", value: parsedInfo.subdistrictName || "N/A" },
          { code: levels[4] || "", label: "Village", value: parsedInfo.villageName || "N/A" },
        ],
        districtName: parsedInfo.districtName,
        subdistrictName: parsedInfo.subdistrictName,
        villageName: parsedInfo.villageName,
      };
    }

    return null;
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<IndiaParcelSelection | null> {
    const hit = await getPlotAtXYGeoref(coordinates).catch(() => null);

    if (!hit?.id || !hit.gis_code) return null;

    const levels = await getLevelsFromGisCode(hit.gis_code).catch(() => null);
    if (!levels?.length) return null;

    const selectedLevels = `${levels.join(",")},`;
    const extent = await getExtentForLevels(selectedLevels).catch(() => null);
    const normalizedExtent = normalizeExtent4326(extent);
    const parsedGisInfo = parsePunjabGisInfo(hit.gisinfo);
    const overlayCodes = await getOverlayCodesForGisCode(hit.gis_code);

    const plot = await getScalarJson<PunjabScalarPlotResponse>({
      OP: 5,
      state: PUNJAB_STATE_CODE,
      levels: selectedLevels,
      plotno: hit.plot_no || hit.kide || "",
    }).catch(() => null);

    if (!plot?.ID && !plot?.plotNo) return null;

    const parsedInfo = parsePunjabInfo(plot.info);
    const plotReportUrl = buildPlotReportUrl(plot.plotInfoLinks);
    const parcelLabel = plot.plotNo || hit.kide || hit.plot_no || "Punjab Parcel";

    return {
      stateCode: PUNJAB_STATE_CODE,
      stateName: "Punjab",
      sourceName: "Punjab BhuNaksha",
      gisCode: plot.gisCode || hit.giscode || hit.gisCode || hit.gis_code,
      plotId: plot.ID || hit.id || "",
      plotNo: plot.plotNo || hit.kide || hit.plot_no || null,
      parcelLabel,
      locationLabel:
        [parsedGisInfo.villageName, parsedGisInfo.subdistrictName, parsedGisInfo.districtName]
          .filter(Boolean)
          .join(", ") || "Punjab Parcel",
      districtName: parsedGisInfo.districtName || null,
      subdistrictName: parsedGisInfo.subdistrictName || null,
      villageName: parsedGisInfo.villageName || null,
      gisInfo: hit.gisinfo || parsedInfo.text || null,
      pniu: plot.PNIU || parsedInfo.pniu || null,
      areaLabel: parsedInfo.areaLabel,
      owners: parsedInfo.owners,
      remarks: null,
      infoHtml: plot.info || null,
      infoLinksHtml: plot.plotInfoLinks || null,
      mapSketchUrl: plotReportUrl,
      plotReportUrl,
      geometry: null,
      extent: normalizedExtent,
      parcelFields: buildPunjabParcelFields(plot, hit, parsedInfo),
      administrativeFields: [
        { label: "District", value: parsedGisInfo.districtName || "N/A" },
        { label: "Tehsil", value: parsedGisInfo.subdistrictName || "N/A" },
        { label: "Village", value: parsedGisInfo.villageName || "N/A" },
      ],
      sourceBadge: "Official BhuNaksha",
      overlay: {
        highlightType: "wms",
        wmsPath: "/api/in/punjab/parcels/wms",
        overlayCodes,
        plotId: plot.ID || hit.id || undefined,
      },
    };
  },
};

export default PunjabParcelService;
