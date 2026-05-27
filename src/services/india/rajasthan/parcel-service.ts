import { resolveOverlayByViewportSampling } from "@/services/india/shared/overlay-sampling";
import { postPublicBhuNakshaFormJson } from "@/services/india/shared/bhunaksha-public";
import {
  boundsCenter,
  intersectionArea,
} from "@/services/india/shared/geometry";
import {
  decodePortalText,
  inferUtmZoneFromLongitude,
  normalizeExtent4326,
  parsePortalHref,
  parseUtmWktGeometry,
  splitFixedWidthCodes,
  trimPortalBreaks,
} from "@/services/india/shared/bhunaksha-portal";
import type {
  IndiaOverlayVillage,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";
import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";

const { baseUrl: RAJASTHAN_BHUNAKSHA_BASE, stateCode: RAJASTHAN_STATE_CODE } =
  INDIA_STATE_ENDPOINTS.rajasthan;
const RAJASTHAN_COVERAGE = {
  west: 69.2,
  south: 23.0,
  east: 78.6,
  north: 30.95,
} as const;
const RAJASTHAN_GIS_SEGMENTS = [2, 3, 4, 5, 5, 3] as const;
const RAJASTHAN_OVERLAY_REUSE_MARGIN = 1.2 as const;
const rajasthanOverlayVillageCache = new Map<string, IndiaOverlayVillage>();
const rajasthanOverlayVillagePromiseCache = new Map<
  string,
  Promise<IndiaOverlayVillage | null>
>();

type RajasthanPlotAtXYResponse = {
  vsrno?: string;
  gis_code?: string;
  plot_no?: string;
  gisinfo?: string;
  id?: string;
};

type RajasthanPlotInfoResponse = {
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

type RajasthanExtentResponse = {
  xmin?: number | null;
  ymin?: number | null;
  xmax?: number | null;
  ymax?: number | null;
  gisCode?: string;
  giscode?: string;
  attribution?: string | null;
  plotid?: string | null;
};

function parseLocationParts(gisInfo?: string | null) {
  const normalized = decodePortalText(gisInfo) || gisInfo || "";

  const districtMatch =
    normalized.match(/(?:District|जिला)\s*:\s*([^,\n]+)/i) || null;
  const tehsilMatch =
    normalized.match(/(?:Tehsil|तहसील)\s*:\s*([^,\n]+)/i) || null;
  const riMatch = normalized.match(/RI\s*:\s*([^,\n]+)/i) || null;
  const halkaMatch =
    normalized.match(/(?:Halkas|Halka|हल्का|हल्कास)\s*:\s*([^,\n]+)/i) || null;
  const villageMatch =
    normalized.match(/(?:Village|गाँव|गांव)\s*:\s*([^,\n]+)/i) || null;
  const sheetMatch =
    normalized.match(/(?:Sheet\s*No|Sheet No|शीट)\s*:\s*([^,\n]+)/i) || null;

  return {
    districtName: districtMatch?.[1]?.trim() || null,
    subdistrictName: tehsilMatch?.[1]?.trim() || null,
    riName: riMatch?.[1]?.trim() || null,
    halkaName: halkaMatch?.[1]?.trim() || null,
    villageName: villageMatch?.[1]?.trim() || null,
    sheetName: sheetMatch?.[1]?.trim() || null,
  };
}

function parseOwnersAndFields(info?: string | null) {
  const text = trimPortalBreaks(info);
  const owners = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\)/.test(line))
    .map((line) => line.replace(/^\d+\.\)\s*/, "").trim());

  const khataMatch =
    text.match(/(?:खाता संख्या|Khata\s*Number|Khata)\s*:?\s*([^\n]+)/i) || null;
  const areaMatch =
    text.match(/(?:क्षेत्रफल|Area)\s*:?\s*([^\n]+)/i) || null;

  return {
    text,
    owners,
    khataNo: khataMatch?.[1]?.trim() || null,
    areaLabel: areaMatch?.[1]?.trim() || null,
  };
}

function buildSelectedLevelsFromGisCode(gisCode: string) {
  const parts = splitFixedWidthCodes(gisCode, [...RAJASTHAN_GIS_SEGMENTS]);
  return parts ? `${parts.join(",")},` : null;
}

function expandBounds(
  bounds: IndiaViewportBounds,
  factor: number,
): IndiaViewportBounds {
  const lngPad = (bounds.east - bounds.west) * factor;
  const latPad = (bounds.north - bounds.south) * factor;

  return {
    west: Math.max(RAJASTHAN_COVERAGE.west, bounds.west - lngPad),
    south: Math.max(RAJASTHAN_COVERAGE.south, bounds.south - latPad),
    east: Math.min(RAJASTHAN_COVERAGE.east, bounds.east + lngPad),
    north: Math.min(RAJASTHAN_COVERAGE.north, bounds.north + latPad),
  };
}

function buildAdministrativeFields(parts: ReturnType<typeof parseLocationParts>) {
  return [
    { label: "District", value: parts.districtName || "N/A" },
    { label: "Tehsil", value: parts.subdistrictName || "N/A" },
    { label: "RI", value: parts.riName || "N/A" },
    { label: "Halka", value: parts.halkaName || "N/A" },
    { label: "Village", value: parts.villageName || "N/A" },
    { label: "Sheet", value: parts.sheetName || "N/A" },
  ];
}

function buildParcelFields(
  hit: RajasthanPlotAtXYResponse,
  plot: RajasthanPlotInfoResponse,
  parsedInfo: ReturnType<typeof parseOwnersAndFields>,
  parts: ReturnType<typeof parseLocationParts>,
): IndiaParcelField[] {
  const formattedArea =
    typeof plot.map_area === "number"
      ? `${Math.round((plot.map_area + Number.EPSILON) * 100) / 100} sqm`
      : typeof plot.area === "number"
        ? `${Math.round((plot.area + Number.EPSILON) * 100) / 100} sqm`
        : plot.formatedArea || parsedInfo.areaLabel || "N/A";

  return [
    { label: "Khasra", value: plot.plotno || hit.plot_no || "N/A" },
    { label: "Plot ID", value: plot.plotid || hit.id || "N/A" },
    { label: "Khata", value: parsedInfo.khataNo || "N/A" },
    { label: "Area", value: formattedArea },
    { label: "Sheet", value: parts.sheetName || "N/A" },
  ];
}

async function postForm<T>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  return postPublicBhuNakshaFormJson<T>({
    baseUrl: RAJASTHAN_BHUNAKSHA_BASE,
    path,
    params,
  });
}

async function getPlotAtXYGeoref(coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return postForm<RajasthanPlotAtXYResponse>("rest/MapInfo/getPlotAtXYGeoref", {
    state: RAJASTHAN_STATE_CODE,
    srs: "4326",
    x: lng,
    y: lat,
  });
}

async function getVillageExtent4326(gisLevels: string) {
  return postForm<RajasthanExtentResponse>("rest/MapInfo/getVVVVExtentGeoref", {
    state: RAJASTHAN_STATE_CODE,
    gisLevels,
    srs: "4326",
  });
}

async function getPlotInfo(gisCode: string, plotNo: string) {
  return postForm<RajasthanPlotInfoResponse>("rest/MapInfo/getPlotInfo", {
    state: RAJASTHAN_STATE_CODE,
    giscode: gisCode,
    plotno: plotNo,
  });
}

async function getPlotExtent4326(gisCode: string, plotId: string) {
  return postForm<RajasthanExtentResponse>("rest/MapInfo/getExtentGeoref", {
    state: RAJASTHAN_STATE_CODE,
    giscode: gisCode,
    plotid: plotId,
    srs: "4326",
  });
}

function buildOverlayVillageFromContext(args: {
  gisCode: string;
  gisInfo?: string | null;
  attribution?: string | null;
  extent: IndiaViewportBounds;
}): IndiaOverlayVillage {
  const parts = parseLocationParts(args.gisInfo || args.attribution);
  const codes = splitFixedWidthCodes(args.gisCode, [...RAJASTHAN_GIS_SEGMENTS]);

  return {
    stateCode: RAJASTHAN_STATE_CODE,
    stateName: "Rajasthan",
    gisCode: args.gisCode,
    overlayCodes: "",
    extent: args.extent,
    administrativeLevels: [
      { code: codes?.[0] || "", label: "District", value: parts.districtName || "N/A" },
      { code: codes?.[1] || "", label: "Tehsil", value: parts.subdistrictName || "N/A" },
      { code: codes?.[2] || "", label: "RI", value: parts.riName || "N/A" },
      { code: codes?.[3] || "", label: "Halka", value: parts.halkaName || "N/A" },
      { code: codes?.[4] || "", label: "Village", value: parts.villageName || "N/A" },
      { code: codes?.[5] || "", label: "Sheet", value: parts.sheetName || "N/A" },
    ],
    districtName: parts.districtName,
    subdistrictName: parts.subdistrictName,
    villageName: parts.villageName,
  };
}

async function buildOverlayVillageFromHit(
  hit: RajasthanPlotAtXYResponse,
): Promise<IndiaOverlayVillage | null> {
  if (!hit.gis_code) return null;

  const gisCode = hit.gis_code;
  const cachedPromise = rajasthanOverlayVillagePromiseCache.get(gisCode);
  if (cachedPromise) {
    return cachedPromise;
  }

  const promise = (async () => {
    const selectedLevels = buildSelectedLevelsFromGisCode(gisCode);
    if (!selectedLevels) return null;

    const extent = await getVillageExtent4326(selectedLevels).catch(() => null);
    const normalizedExtent = normalizeExtent4326(extent);
    if (!normalizedExtent) return null;
    const village = buildOverlayVillageFromContext({
      gisCode,
      gisInfo: hit.gisinfo,
      attribution: extent?.attribution,
      extent: normalizedExtent,
    });
    rajasthanOverlayVillageCache.set(gisCode, village);
    return village;
  })()
    .catch((error) => {
      rajasthanOverlayVillageCache.delete(gisCode);
      throw error;
    })
    .finally(() => {
      rajasthanOverlayVillagePromiseCache.delete(gisCode);
    });

  rajasthanOverlayVillagePromiseCache.set(gisCode, promise);
  return promise;
}

export const RajasthanParcelService = {
  stateCode: RAJASTHAN_STATE_CODE,

  async resolveVillageOverlay(
    bounds: IndiaViewportBounds,
  ): Promise<IndiaOverlayVillage | null> {
    const centerHit = await getPlotAtXYGeoref(boundsCenter(bounds)).catch(() => null);
    if (centerHit?.gis_code) {
      const cachedVillage = rajasthanOverlayVillageCache.get(centerHit.gis_code);
      if (cachedVillage && intersectionArea(bounds, cachedVillage.extent) > 0) {
        return cachedVillage;
      }

      void buildOverlayVillageFromHit(centerHit).catch(() => null);

      return buildOverlayVillageFromContext({
        gisCode: centerHit.gis_code,
        gisInfo: centerHit.gisinfo,
        extent: expandBounds(bounds, RAJASTHAN_OVERLAY_REUSE_MARGIN),
      });
    }

    return resolveOverlayByViewportSampling(bounds, async (point) => {
      const hit = await getPlotAtXYGeoref(point).catch(() => null);
      if (!hit?.gis_code) return null;
      return buildOverlayVillageFromHit(hit);
    });
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
    const utmZone = inferUtmZoneFromLongitude(coordinates[0]);

    const [plot, extent] = await Promise.all([
      getPlotInfo(gisCode, plotNo).catch(() => null),
      getPlotExtent4326(gisCode, plotId).catch(() => null),
    ]);

    if (!plot) {
      return null;
    }

    const parsedInfo = parseOwnersAndFields(plot.info);
    const parts = parseLocationParts(plot.gisinfo || hit.gisinfo);
    const plotReportUrl = parsePortalHref(
      RAJASTHAN_BHUNAKSHA_BASE,
      plot.infoLinks,
    );
    const geometry = parseUtmWktGeometry(plot.the_geom, utmZone);
    const normalizedExtent = normalizeExtent4326(extent);

    return {
      stateCode: RAJASTHAN_STATE_CODE,
      stateName: "Rajasthan",
      sourceName: "Rajasthan BhuNaksha",
      gisCode,
      plotId: plot.plotid || plotId,
      plotNo,
      parcelLabel: `Khasra ${plotNo}`,
      locationLabel:
        [parts.villageName, parts.subdistrictName, parts.districtName]
          .filter(Boolean)
          .join(", ") || "Rajasthan Parcel",
      districtName: parts.districtName,
      subdistrictName: parts.subdistrictName,
      villageName: parts.villageName,
      gisInfo: decodePortalText(plot.gisinfo || hit.gisinfo) || null,
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
      infoHtml: decodePortalText(plot.info) || plot.info || null,
      infoLinksHtml: plot.infoLinks || null,
      mapSketchUrl: plotReportUrl,
      plotReportUrl,
      geometry,
      extent: normalizedExtent,
      parcelFields: buildParcelFields(hit, plot, parsedInfo, parts),
      administrativeFields: buildAdministrativeFields(parts),
      sourceBadge: "Official BhuNaksha",
      overlay: {
        highlightType: "wms",
        wmsPath: "/api/in/rajasthan/parcels/wms",
        wmsParams: {
          layers: "PLOT_LIST",
          styles: "PLOT_SELECTION",
          state: RAJASTHAN_STATE_CODE,
          gis_code: gisCode,
          plot_id: plot.plotid || plotId,
          overlay_codes: "",
          crs: "",
        },
      },
    };
  },
};

export default RajasthanParcelService;
