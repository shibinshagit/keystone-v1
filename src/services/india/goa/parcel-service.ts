import { postPublicBhuNakshaFormJson } from "@/services/india/shared/bhunaksha-public";
import {
  inferUtmZoneFromLongitude,
  normalizeExtent4326,
  parseUtmWktGeometry,
  trimPortalBreaks,
} from "@/services/india/shared/bhunaksha-portal";
import {
  resolveOverlayByViewportSampling,
  pickBestOverlayVillage,
} from "@/services/india/shared/overlay-sampling";
import type {
  IndiaOverlayVillage,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";
import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";

const { baseUrl: GOA_BHUNAKSHA_BASE, stateCode: GOA_STATE_CODE } =
  INDIA_STATE_ENDPOINTS.goa;

type GoaPlotAtXYResponse = {
  vsrno?: string;
  gis_code?: string;
  plot_no?: string;
  gisinfo?: string;
  id?: string;
};

type GoaExtentResponse = {
  xmin?: number | null;
  ymin?: number | null;
  xmax?: number | null;
  ymax?: number | null;
  gisCode?: string;
  giscode?: string;
  attribution?: string | null;
  plotid?: string | null;
};

type GoaPlotInfoResponse = {
  area?: number;
  map_area?: number;
  formatedArea?: string;
  plotno?: string;
  plotid?: string;
  gisinfo?: string;
  giscode?: string;
  info?: string;
  infoLinks?: string | null;
  ownerplots?: string[];
  the_geom?: string | null;
};

type GoaLevelOption = {
  code: string;
  value: string;
  extraParms?: {
    hasData?: boolean;
  } | null;
};

function parseLocationParts(gisInfo?: string | null) {
  const normalized = trimPortalBreaks(gisInfo);
  const districtMatch = normalized.match(/District\s*:\s*([^,\n]+)/i);
  const talukaMatch = normalized.match(/Taluka\s*:\s*([^,\n]+)/i);
  const villageMatch = normalized.match(/Village\s*:\s*([^,\n]+)/i);
  const sheetMatch =
    normalized.match(/(?:Sheet\s*No|Sheet No)\s*:\s*([^,\n]+)/i);

  const cleanValue = (value?: string | null) =>
    value?.replace(/^\d+\s+/, "").trim() || null;

  return {
    districtName: cleanValue(districtMatch?.[1]),
    subdistrictName: cleanValue(talukaMatch?.[1]),
    villageName: cleanValue(villageMatch?.[1]),
    sheetName: cleanValue(sheetMatch?.[1]),
  };
}

function parsePlotInfo(info?: string | null) {
  const text = trimPortalBreaks(info);
  const owners = [
    text.match(/Occupants?\s+Names?\s*:\s*([^\n]+)/i)?.[1]?.trim() || null,
  ].filter((value): value is string => Boolean(value));

  const subdivisionMatch = text.match(/Subdiv\s*No\s*:\s*([^\n]+)/i);
  const areaMatch = text.match(/Total\s*Area\s*:\s*([^\n]+)/i);

  return {
    text,
    owners,
    subdivisionNo: subdivisionMatch?.[1]?.trim() || null,
    areaLabel: areaMatch?.[1]?.trim() || null,
  };
}

function buildAdministrativeFields(parts: ReturnType<typeof parseLocationParts>) {
  return [
    { label: "District", value: parts.districtName || "N/A" },
    { label: "Taluka", value: parts.subdistrictName || "N/A" },
    { label: "Village", value: parts.villageName || "N/A" },
    { label: "Sheet", value: parts.sheetName || "N/A" },
  ];
}

function buildParcelFields(
  hit: GoaPlotAtXYResponse,
  plot: GoaPlotInfoResponse,
  parsedInfo: ReturnType<typeof parsePlotInfo>,
): IndiaParcelField[] {
  const formattedArea =
    typeof plot.map_area === "number"
      ? `${Math.round((plot.map_area + Number.EPSILON) * 100) / 100} sqm`
      : typeof plot.area === "number"
        ? `${Math.round((plot.area + Number.EPSILON) * 100) / 100} sqm`
        : plot.formatedArea || parsedInfo.areaLabel || "N/A";

  return [
    { label: "Plot", value: plot.plotno || hit.plot_no || "N/A" },
    { label: "Plot ID", value: plot.plotid || hit.id || "N/A" },
    { label: "Subdivision", value: parsedInfo.subdivisionNo || "N/A" },
    { label: "Area", value: formattedArea },
  ];
}

function buildPlotReportUrl(gisCode: string, plotNo: string) {
  return `${GOA_BHUNAKSHA_BASE}/split/draftprintPreview.jsp?giscode=${encodeURIComponent(gisCode)}&plotno=${encodeURIComponent(plotNo)}&scale=0&state=${GOA_STATE_CODE}`;
}

async function postForm<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  return postPublicBhuNakshaFormJson<T>({
    baseUrl: GOA_BHUNAKSHA_BASE,
    path,
    params,
  });
}

async function getPlotAtXYGeoref(coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return postForm<GoaPlotAtXYResponse>("rest/MapInfo/getPlotAtXYGeoref", {
    state: GOA_STATE_CODE,
    srs: "4326",
    x: lng,
    y: lat,
  });
}

async function getLevelsFromGisCode(gisCode: string) {
  return postForm<string[]>("rest/Levels/levelsFromGiscode", {
    state: GOA_STATE_CODE,
    giscode: gisCode,
  });
}

async function getLevelsAfter(
  level: number,
  codes: string,
): Promise<GoaLevelOption[][]> {
  return postForm<GoaLevelOption[][]>("rest/Levels/ListsAfterLevel", {
    state: GOA_STATE_CODE,
    level,
    codes,
    hasmap: true,
  });
}

async function getVillageExtent4326(gisLevels: string) {
  return postForm<GoaExtentResponse>("rest/MapInfo/getVVVVExtentGeoref", {
    state: GOA_STATE_CODE,
    gisLevels,
    srs: "4326",
  });
}

async function getPlotInfo(gisCode: string, plotNo: string) {
  return postForm<GoaPlotInfoResponse>("rest/MapInfo/getPlotInfo", {
    state: GOA_STATE_CODE,
    giscode: gisCode,
    plotno: plotNo,
  });
}

async function getPlotExtent4326(gisCode: string, plotId: string) {
  return postForm<GoaExtentResponse>("rest/MapInfo/getExtentGeoref", {
    state: GOA_STATE_CODE,
    giscode: gisCode,
    plotid: plotId,
    srs: "4326",
  });
}

function isUsableLevelOption(option?: GoaLevelOption | null) {
  return Boolean(option?.code) && option?.extraParms?.hasData !== false;
}

function buildGoaOverlayVillage(args: {
  district: GoaLevelOption;
  subdistrict: GoaLevelOption;
  locality: GoaLevelOption;
  mapType: GoaLevelOption;
  extent: IndiaViewportBounds;
  gisCode: string;
}): IndiaOverlayVillage {
  return {
    stateCode: GOA_STATE_CODE,
    stateName: "Goa",
    gisCode: args.gisCode,
    overlayCodes: null,
    extent: args.extent,
    administrativeLevels: [
      { code: args.district.code, label: "District", value: args.district.value },
      { code: args.subdistrict.code, label: "Taluka", value: args.subdistrict.value },
      { code: args.locality.code, label: "Village", value: args.locality.value },
      { code: args.mapType.code, label: "Sheet", value: args.mapType.value || args.mapType.code },
    ],
    districtName: args.district.value,
    subdistrictName: args.subdistrict.value,
    villageName: args.locality.value,
  };
}

function pickBestGoaOverlayVillage(
  bounds: IndiaViewportBounds,
  candidates: IndiaOverlayVillage[],
) {
  const exactVillageMatch =
    pickBestOverlayVillage(
      bounds,
      candidates.filter((candidate) => /VILLAGE$/i.test(candidate.gisCode)),
    ) || null;

  if (exactVillageMatch) {
    return exactVillageMatch;
  }

  return pickBestOverlayVillage(bounds, candidates) || null;
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
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

async function buildGoaOverlayCandidateAtPoint(
  point: [number, number],
): Promise<IndiaOverlayVillage | null> {
  const hit = await getPlotAtXYGeoref(point).catch(() => null);
  if (!hit?.gis_code) {
    return null;
  }

  const levels = await getLevelsFromGisCode(hit.gis_code).catch(() => null);
  if (!levels?.length) {
    return null;
  }

  const selectedLevels = `${levels.join(",")},`;
  const extent = await getVillageExtent4326(selectedLevels).catch(() => null);
  const normalizedExtent = normalizeExtent4326(extent);
  if (!normalizedExtent) {
    return null;
  }

  const parts = parseLocationParts(hit.gisinfo || extent?.attribution);

  return {
    stateCode: GOA_STATE_CODE,
    stateName: "Goa",
    gisCode: extent?.gisCode || extent?.giscode || hit.gis_code,
    overlayCodes: null,
    extent: normalizedExtent,
    administrativeLevels: [
      { code: levels[0] || "", label: "District", value: parts.districtName || "N/A" },
      { code: levels[1] || "", label: "Taluka", value: parts.subdistrictName || "N/A" },
      { code: levels[2] || "", label: "Village", value: parts.villageName || "N/A" },
      { code: levels[3] || "", label: "Sheet", value: parts.sheetName || levels[3] || "N/A" },
    ],
    districtName: parts.districtName,
    subdistrictName: parts.subdistrictName,
    villageName: parts.villageName,
  };
}

let goaOverlayIndex: IndiaOverlayVillage[] | null = null;
let goaOverlayIndexPromise: Promise<IndiaOverlayVillage[]> | null = null;

async function buildGoaOverlayIndex(): Promise<IndiaOverlayVillage[]> {
  const root = await getLevelsAfter(0, "");
  const districts = (root[0] || []).filter(isUsableLevelOption);
  const entries: IndiaOverlayVillage[] = [];

  for (const district of districts) {
    const subdistrictResponse = await getLevelsAfter(1, `${district.code},`).catch(
      () => [],
    );
    const subdistricts = (subdistrictResponse[0] || []).filter(isUsableLevelOption);

    for (const subdistrict of subdistricts) {
      const localityResponse = await getLevelsAfter(
        2,
        `${district.code},${subdistrict.code},`,
      ).catch(() => []);
      const localities = (localityResponse[0] || []).filter(isUsableLevelOption);

      const localityEntries = await mapWithConcurrency(
        localities,
        10,
        async (locality) => {
          const selectedPrefix = `${district.code},${subdistrict.code},${locality.code},`;
          const mapTypeResponse = await getLevelsAfter(3, selectedPrefix).catch(() => []);
          const mapTypes = (mapTypeResponse[0] || []).filter(
            (option) =>
              isUsableLevelOption(option) &&
              !/plot$/i.test(option.code),
          );

          const resolvedEntries: Array<IndiaOverlayVillage | null> = await Promise.all(
            mapTypes.map(async (mapType) => {
              const selectedLevels = `${selectedPrefix}${mapType.code},`;
              const extent = await getVillageExtent4326(selectedLevels).catch(() => null);
              const normalizedExtent = normalizeExtent4326(extent);
              if (!normalizedExtent) {
                return null;
              }

              return buildGoaOverlayVillage({
                district,
                subdistrict,
                locality,
                mapType,
                extent: normalizedExtent,
                gisCode:
                  extent?.gisCode ||
                  extent?.giscode ||
                  `${district.code}${subdistrict.code}${locality.code}${mapType.code}`,
              });
            }),
          );

          return resolvedEntries.filter(
            (entry): entry is IndiaOverlayVillage => entry !== null,
          );
        },
      );

      entries.push(...localityEntries.flat());
    }
  }

  return entries;
}

async function getGoaOverlayIndex() {
  if (goaOverlayIndex) {
    return goaOverlayIndex;
  }

  if (!goaOverlayIndexPromise) {
    goaOverlayIndexPromise = buildGoaOverlayIndex()
      .then((entries) => {
        goaOverlayIndex = entries;
        goaOverlayIndexPromise = null;
        return entries;
      })
      .catch((error) => {
        goaOverlayIndexPromise = null;
        throw error;
      });
  }

  return goaOverlayIndexPromise;
}

export const GoaParcelService = {
  stateCode: GOA_STATE_CODE,

  async resolveVillageOverlay(
    bounds: IndiaViewportBounds,
  ): Promise<IndiaOverlayVillage | null> {
    if (goaOverlayIndex) {
      return pickBestGoaOverlayVillage(bounds, goaOverlayIndex);
    }

    void getGoaOverlayIndex().catch(() => null);

    return resolveOverlayByViewportSampling(
      bounds,
      buildGoaOverlayCandidateAtPoint,
      pickBestGoaOverlayVillage,
    );
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<IndiaParcelSelection | null> {
    const hit = await getPlotAtXYGeoref(coordinates).catch(() => null);
    if (!hit?.plot_no?.trim() || !hit.gis_code?.trim() || !hit.id?.trim()) {
      return null;
    }

    const plotNo = hit.plot_no.trim();
    const gisCode = hit.gis_code.trim();
    const plotId = hit.id.trim();

    const [plot, extent] = await Promise.all([
      getPlotInfo(gisCode, plotNo).catch(() => null),
      getPlotExtent4326(gisCode, plotId).catch(() => null),
    ]);

    if (!plot) {
      return null;
    }

    const parsedInfo = parsePlotInfo(plot.info);
    const parts = parseLocationParts(plot.gisinfo || hit.gisinfo);
    const geometry = parseUtmWktGeometry(
      plot.the_geom,
      inferUtmZoneFromLongitude(coordinates[0]),
    );
    const normalizedExtent = normalizeExtent4326(extent);
    const plotReportUrl = buildPlotReportUrl(gisCode, plotNo);

    return {
      stateCode: GOA_STATE_CODE,
      stateName: "Goa",
      sourceName: "Goa BhuNaksha",
      gisCode,
      plotId: plot.plotid || plotId,
      plotNo,
      parcelLabel: `Plot ${plotNo}`,
      locationLabel:
        [parts.villageName, parts.subdistrictName, parts.districtName]
          .filter(Boolean)
          .join(", ") || "Goa Parcel",
      districtName: parts.districtName,
      subdistrictName: parts.subdistrictName,
      villageName: parts.villageName,
      gisInfo: trimPortalBreaks(plot.gisinfo || hit.gisinfo),
      subdivisionNo: parsedInfo.subdivisionNo,
      areaSqm:
        typeof plot.map_area === "number"
          ? plot.map_area
          : typeof plot.area === "number"
            ? plot.area
            : null,
      areaLabel:
        typeof plot.map_area === "number"
          ? `${Math.round((plot.map_area + Number.EPSILON) * 100) / 100} sqm`
          : plot.formatedArea || parsedInfo.areaLabel || null,
      owners: parsedInfo.owners,
      remarks: parts.sheetName ? `Sheet ${parts.sheetName}` : null,
      infoHtml: parsedInfo.text,
      infoLinksHtml: plot.infoLinks || null,
      mapSketchUrl: plotReportUrl,
      plotReportUrl,
      geometry,
      extent: normalizedExtent,
      parcelFields: buildParcelFields(hit, plot, parsedInfo),
      administrativeFields: buildAdministrativeFields(parts),
      sourceBadge: "Official BhuNaksha",
      overlay: {
        highlightType: "wms",
        wmsPath: "/api/in/goa/parcels/wms",
        wmsParams: {
          layers: "PLOT_LIST",
          styles: "PLOT_SELECTION",
          state: GOA_STATE_CODE,
          gis_code: gisCode,
          plot_id: plot.plotid || plotId,
        },
      },
    };
  },
};

export default GoaParcelService;
