import { isFiniteNumber } from "@/services/india/shared/geometry";
import {
  getBhuNakshaBinary,
  postBhuNakshaFormJson,
} from "@/services/india/shared/bhunaksha-session";
import { buildViewportSamplePoints } from "@/services/india/shared/overlay-sampling";
import type {
  IndiaOverlayVillage,
  IndiaParcelField,
  IndiaParcelSelection,
  IndiaViewportBounds,
} from "@/services/india/shared/types";

const MAHARASHTRA_BHUNAKSHA_BASE = "https://mahabhunakasha.mahabhumi.gov.in";
const MAHARASHTRA_LANDING_PATH = "/27/index.html";
const MAHARASHTRA_STATE_CODE = "27" as const;
const MAHARASHTRA_COVERAGE = {
  west: 72.55,
  south: 15.6,
  east: 80.95,
  north: 22.1,
} as const;

type MaharashtraExtentResponse = {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  gisCode?: string;
  giscode?: string;
  attribution?: string;
};

type MaharashtraPlotAtXYResponse = {
  vsrno?: string;
  gis_code?: string;
  plot_no?: string;
  gisinfo?: string;
  id?: string;
};

type MaharashtraPlotInfoResponse = {
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
};

type MaharashtraPlotExtentResponse = {
  xmin?: number;
  ymin?: number;
  xmax?: number;
  ymax?: number;
  plotid?: string;
  giscode?: string;
};

function normalizeExtent4326(
  extent:
    | Pick<MaharashtraExtentResponse, "xmin" | "ymin" | "xmax" | "ymax">
    | null
    | undefined,
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
  return postBhuNakshaFormJson<T>({
    baseUrl: MAHARASHTRA_BHUNAKSHA_BASE,
    landingPath: MAHARASHTRA_LANDING_PATH,
    path,
    params,
  });
}

async function getVillageExtent(gisCode: string) {
  return postForm<MaharashtraExtentResponse>("rest/MapInfo/getVVVVExtentGeoref", {
    state: MAHARASHTRA_STATE_CODE,
    giscode: gisCode,
    srs: "4326",
  });
}

async function getPlotAtXYGeoref(coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return postForm<MaharashtraPlotAtXYResponse>("rest/MapInfo/getPlotAtXYGeoref", {
    state: MAHARASHTRA_STATE_CODE,
    srs: "4326",
    x: lng,
    y: lat,
  });
}

async function getPlotInfo(gisCode: string, plotNo: string) {
  return postForm<MaharashtraPlotInfoResponse>("rest/MapInfo/getPlotInfo", {
    state: MAHARASHTRA_STATE_CODE,
    giscode: gisCode,
    plotno: plotNo,
    srs: "4326",
  });
}

async function getPlotExtent(gisCode: string, plotId: string) {
  return postForm<MaharashtraPlotExtentResponse>("rest/MapInfo/getExtentGeoref", {
    state: MAHARASHTRA_STATE_CODE,
    giscode: gisCode,
    plotid: plotId,
    srs: "4326",
  });
}

function trimHtmlBreaks(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/&nbsp;/gi, " ").trim();
}

function decodePortalText(value?: string | null) {
  if (!value) return null;
  if (/[\u0900-\u097F]/.test(value)) {
    return value;
  }
  if (!/(?:à¤|à¥|Ã|Â)/.test(value)) {
    return value;
  }
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

function parseLocationParts(gisInfo?: string | null) {
  const info = decodePortalText(gisInfo) || gisInfo || "";
  const districtMatch = info.match(/District\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const talukaMatch = info.match(/Taluka\s*:\s*[^,]*\s(.+?)(?:,|$)/i);
  const villageMatch = info.match(/Village\s*:\s*[^,]*\s(.+?)(?:,|$)/i);

  return {
    districtName: districtMatch?.[1]?.trim() || null,
    subdistrictName: talukaMatch?.[1]?.trim() || null,
    villageName: villageMatch?.[1]?.trim() || null,
  };
}

function parsePlotInfo(info?: string | null) {
  const text = decodePortalText(trimHtmlBreaks(info || "")) || trimHtmlBreaks(info || "");
  const sections = text
    .split(/-+\s*/g)
    .map((section) => section.trim())
    .filter(Boolean);

  const owners: string[] = [];
  const khataNos: string[] = [];
  const totalAreaValues: string[] = [];
  const potKharabaValues: string[] = [];

  for (const section of sections) {
    const ownerMatch = section.match(/Owner Name\s*:\s*([^\n]+)/i);
    if (ownerMatch?.[1]) {
      owners.push(ownerMatch[1].trim());
    }

    const khataMatch = section.match(/Khata No\.\s*:\s*([^\n]+)/i);
    if (khataMatch?.[1]) {
      khataNos.push(khataMatch[1].trim());
    }

    const totalAreaMatch = section.match(/Total Area\s*:\s*([^\n]+)/i);
    if (totalAreaMatch?.[1]) {
      totalAreaValues.push(totalAreaMatch[1].trim());
    }

    const potKharabaMatch = section.match(/Pot kharaba\s*:\s*([^\n]+)/i);
    if (potKharabaMatch?.[1]) {
      potKharabaValues.push(potKharabaMatch[1].trim());
    }
  }

  const surveyMatch = text.match(/Survey No\.\s*:\s*([^\n]+)/i);

  return {
    text,
    owners,
    khataNos,
    totalAreaLabel: totalAreaValues[0] || null,
    potKharabaLabel: potKharabaValues[0] || null,
    surveyNo: surveyMatch?.[1]?.trim() || null,
  };
}

function buildPlotReportUrl(gisCode: string, plotNo: string) {
  return `${MAHARASHTRA_BHUNAKSHA_BASE}/signplotreportpublic.jsp?state=${MAHARASHTRA_STATE_CODE}&giscode=${encodeURIComponent(gisCode)}&plotno=${encodeURIComponent(plotNo)}`;
}

function buildAdministrativeFields(parts: ReturnType<typeof parseLocationParts>) {
  return [
    { label: "District", value: parts.districtName || "N/A" },
    { label: "Taluka", value: parts.subdistrictName || "N/A" },
    { label: "Village", value: parts.villageName || "N/A" },
  ];
}

function buildParcelFields(
  hit: MaharashtraPlotAtXYResponse,
  plot: MaharashtraPlotInfoResponse,
  parsedInfo: ReturnType<typeof parsePlotInfo>,
): IndiaParcelField[] {
  const plotNumber = plot.plotno || hit.plot_no || "N/A";
  const areaValue =
    isFiniteNumber(plot.area) || isFiniteNumber(plot.map_area)
      ? `${Math.round((plot.area || plot.map_area || 0) * 100) / 100} sqm`
      : plot.formatedArea || parsedInfo.totalAreaLabel || "N/A";

  return [
    { label: "Plot", value: plotNumber },
    { label: "Survey", value: parsedInfo.surveyNo || plotNumber },
    { label: "Khata", value: parsedInfo.khataNos[0] || "N/A" },
    { label: "Area", value: areaValue },
  ];
}

export const MaharashtraParcelService = {
  stateCode: MAHARASHTRA_STATE_CODE,

  isMaharashtraCoordinate(lng: number, lat: number) {
    return (
      lng >= MAHARASHTRA_COVERAGE.west &&
      lng <= MAHARASHTRA_COVERAGE.east &&
      lat >= MAHARASHTRA_COVERAGE.south &&
      lat <= MAHARASHTRA_COVERAGE.north
    );
  },

  looksLikeMaharashtraLocation(location?: string | null) {
    return /\bmaharashtra\b/i.test(location || "");
  },

  async resolveVillageOverlay(bounds: IndiaViewportBounds): Promise<IndiaOverlayVillage | null> {
    const samplePoints = buildViewportSamplePoints(bounds);

    for (const point of samplePoints) {
      const hit = await getPlotAtXYGeoref(point).catch(() => null);
      if (!hit?.gis_code) continue;

      const extent = await getVillageExtent(hit.gis_code).catch(() => null);
      const normalizedExtent = normalizeExtent4326(extent);
      if (!normalizedExtent) continue;

      const parts = parseLocationParts(hit.gisinfo || extent?.attribution);

      return {
        stateCode: MAHARASHTRA_STATE_CODE,
        stateName: "Maharashtra",
        gisCode: hit.gis_code,
        overlayCodes: null,
        extent: normalizedExtent,
        administrativeLevels: [
          { code: "", label: "District", value: parts.districtName || "N/A" },
          { code: "", label: "Taluka", value: parts.subdistrictName || "N/A" },
          { code: "", label: "Village", value: parts.villageName || "N/A" },
        ],
        districtName: parts.districtName,
        subdistrictName: parts.subdistrictName,
        villageName: parts.villageName,
      };
    }

    return null;
  },

  async getParcelAtCoordinate(
    coordinates: [number, number],
  ): Promise<IndiaParcelSelection | null> {
    const hit = await getPlotAtXYGeoref(coordinates).catch(() => null);
    if (!hit?.plot_no?.trim() || !hit.gis_code?.trim() || !hit.id?.trim()) {
      return null;
    }
    const resolvedHit: MaharashtraPlotAtXYResponse = hit;
    const plotNo = resolvedHit.plot_no!.trim();
    const gisCode = resolvedHit.gis_code!.trim();
    const hitPlotId = resolvedHit.id!.trim();

    const [plot, extent] = await Promise.all([
      getPlotInfo(gisCode, plotNo).catch(() => null),
      getPlotExtent(gisCode, hitPlotId).catch(() => null),
    ]);

    if (!plot) {
      return null;
    }

    const plotId = extent?.plotid || plot.plotid || hitPlotId;
    const parts = parseLocationParts(plot.gisinfo || resolvedHit.gisinfo);
    const parsedInfo = parsePlotInfo(plot.info);
    const normalizedExtent = normalizeExtent4326(extent);
    const plotReportUrl = buildPlotReportUrl(gisCode, plotNo);

    return {
      stateCode: MAHARASHTRA_STATE_CODE,
      stateName: "Maharashtra",
      sourceName: "Maha BhuNakasha",
      gisCode,
      plotId,
      plotNo,
      parcelLabel: `Plot ${plotNo}`,
      locationLabel:
        [parts.villageName, parts.subdistrictName, parts.districtName]
          .filter(Boolean)
          .join(", ") || "Maharashtra Parcel",
      districtName: parts.districtName,
      subdistrictName: parts.subdistrictName,
      villageName: parts.villageName,
      gisInfo: decodePortalText(plot.gisinfo || resolvedHit.gisinfo) || null,
      surveyNo: parsedInfo.surveyNo || plotNo,
      areaSqm: isFiniteNumber(plot.map_area) ? plot.map_area : plot.area ?? null,
      areaLabel:
        isFiniteNumber(plot.map_area) || isFiniteNumber(plot.area)
          ? `${Math.round(((plot.map_area || plot.area || 0) + Number.EPSILON) * 100) / 100} sqm`
          : plot.formatedArea || parsedInfo.totalAreaLabel || null,
      owners: parsedInfo.owners,
      remarks: parsedInfo.potKharabaLabel
        ? `Pot kharaba: ${parsedInfo.potKharabaLabel}`
        : null,
      infoHtml: decodePortalText(plot.info) || plot.info || null,
      infoLinksHtml: plot.infoLinks || null,
      mapSketchUrl: plotReportUrl,
      plotReportUrl,
      geometry: null,
      extent: normalizedExtent,
      parcelFields: buildParcelFields(resolvedHit, plot, parsedInfo),
      administrativeFields: buildAdministrativeFields(parts),
      sourceBadge: "Official BhuNaksha",
      overlay: {
        highlightType: "wms",
        wmsPath: "/api/in/maharashtra/parcels/wms",
        plotId,
        highlightStateCode: MAHARASHTRA_STATE_CODE,
      },
    };
  },

  async fetchWmsImage(url: string) {
    return getBhuNakshaBinary({
      baseUrl: MAHARASHTRA_BHUNAKSHA_BASE,
      landingPath: MAHARASHTRA_LANDING_PATH,
      url,
    });
  },
};

export default MaharashtraParcelService;
