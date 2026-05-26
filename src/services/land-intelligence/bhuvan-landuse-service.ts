/**
 * Bhuvan Land Use Service
 *
 * Queries ISRO Bhuvan WMS GetFeatureInfo to determine the exact
 * land use classification for any coordinate in India.
 *
 * Supported layers for Delhi:
 *   - LULC 50K (2015-16, 2011-12, 2005-06) — lulc:DL_LULC50K_{year}
 *   - SIS-DP Phase 2 (2018-23) — sisdp_phase2:SISDP_P2_LULC_10K_2016_2019_DL
 *   - Wasteland — wasteland:DL_WL50K_1516
 *
 * No API key required — Bhuvan WMS is open access.
 */

import { getIndianStateCode } from '@/lib/bhuvan-utils';
import type { LandUseSummary } from "@/lib/land-intelligence/land-use";

export interface LandUseResult {
  layerName: string;
  layerLabel: string;
  featureId: string;
  landUseType: string;          // e.g. "Built-up", "Agriculture", etc.
  landUseCode: string;          // raw code from Bhuvan
  area?: number;                // area in sq km if available
  properties: Record<string, any>;
  geometry?: any;               // GeoJSON geometry (optional, can be large)
  source: string;
}

export interface BhuvanLandUseReport extends LandUseSummary {
  coordinates: [number, number];
  location: string;
  stateCode: string;
  layers: LandUseResult[];
}

// ── Layer configuration ───────────────────────────────────────────────────────

interface LayerConfig {
  id: string;
  label: string;
  server: string;
  layerName: (stateCode: string) => string;
  parseLandUse: (properties: Record<string, any>) => string;
}

function looksLikeBhuvanClassCode(value: unknown): boolean {
  const text = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{4,}\d{0,3}$/.test(text);
}

function decodeBhuvanClassCode(code: unknown): string | null {
  const text = String(code ?? "").trim().toUpperCase();
  if (!text) return null;

  if (text.startsWith("ALCL")) return "Agricultural Land - Crop Land";
  if (text.startsWith("ALAP")) return "Agricultural Land - Plantation";
  if (text.startsWith("ALFL")) return "Agricultural Land - Fallow Land";
  if (text.startsWith("ALSC")) return "Agricultural Land - Shifting Cultivation";

  if (text.startsWith("BU")) return "Built-up";
  if (text.startsWith("TR")) return "Transportation";
  if (text.startsWith("MI")) return "Mining / Industrial";

  if (text.startsWith("FO")) return "Forest";
  if (text.startsWith("FP")) return "Forest Plantation";
  if (text.startsWith("SF")) return "Scrub Forest";
  if (text.startsWith("MG")) return "Mangrove / Swamp";

  if (text.startsWith("GL")) return "Grassland / Grazing Land";

  if (text.startsWith("WS")) return "Wasteland - Scrub Land";
  if (text.startsWith("WG")) return "Wasteland - Gullied / Ravenous";
  if (text.startsWith("WW")) return "Wasteland - Waterlogged";
  if (text.startsWith("WB")) return "Water Bodies";
  if (text.startsWith("RS")) return "River / Stream / Drain";
  if (text.startsWith("CN")) return "Canal";
  if (text.startsWith("LP")) return "Lakes / Ponds";
  if (text.startsWith("RT")) return "Reservoir / Tanks";
  if (text.startsWith("SN")) return "Snow / Glacial Area";

  if (text.startsWith("AL")) return "Agricultural Land";
  if (text.startsWith("WL")) return "Wetlands / Water Bodies";

  return null;
}

function getReadableLandUse(properties: Record<string, any>): string {
  const direct =
    properties.Classname ||
    properties.classname ||
    properties.CLASS ||
    properties.class_ ||
    properties.LULC;

  if (typeof direct === "string" && direct.trim() && !looksLikeBhuvanClassCode(direct)) {
    return direct.trim();
  }

  const code =
    properties.Classcode ||
    properties.classcode ||
    properties.CODE ||
    properties.code;

  const decoded = decodeBhuvanClassCode(code);
  if (decoded) return decoded;

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const fallback = extractFirstStringProp(properties);
  if (looksLikeBhuvanClassCode(fallback)) {
    return decodeBhuvanClassCode(fallback) || fallback;
  }
  return fallback;
}

const LAYERS: LayerConfig[] = [
  {
    id: 'sisdp_phase2',
    label: 'SIS-DP Phase 2 (10K, 2018-23)',
    server: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layerName: (sc) => `sisdp_phase2:SISDP_P2_LULC_10K_2016_2019_${sc}`,
    parseLandUse: (p) => getReadableLandUse(p),
  },
  {
    id: 'lulc_50k_1516',
    label: 'LULC 50K (2015-16)',
    server: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layerName: (sc) => `lulc:${sc}_LULC50K_1516`,
    parseLandUse: (p) => getReadableLandUse(p),
  },
  {
    id: 'lulc_50k_1112',
    label: 'LULC 50K (2011-12)',
    server: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layerName: (sc) => `lulc:${sc}_LULC50K_1112`,
    parseLandUse: (p) => getReadableLandUse(p),
  },
  {
    id: 'lulc_50k_0506',
    label: 'LULC 50K (2005-06)',
    server: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layerName: (sc) => `lulc:${sc}_LULC50K_0506`,
    parseLandUse: (p) => getReadableLandUse(p),
  },
  {
    id: 'wasteland',
    label: 'Wasteland (50K, 2015-16)',
    server: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layerName: (sc) => `wasteland:${sc}_WL50K_1516`,
    parseLandUse: (p) => getReadableLandUse(p),
  },
];

function extractFirstStringProp(p: Record<string, any>): string {
  for (const v of Object.values(p)) {
    if (typeof v === 'string' && v.length > 2 && v.length < 100 && !/^\d/.test(v)) return v;
  }
  return 'Unknown';
}

// ── WMS GetFeatureInfo ────────────────────────────────────────────────────────

async function getFeatureInfo(serverUrl: string, layerName: string, lng: number, lat: number): Promise<any | null> {
  const delta = 0.005; // ~500m bbox around the point
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;

  const url = `${serverUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
    `&LAYERS=${encodeURIComponent(layerName)}&QUERY_LAYERS=${encodeURIComponent(layerName)}` +
    `&BBOX=${bbox}&SRS=EPSG:4326&WIDTH=256&HEIGHT=256` +
    `&X=128&Y=128&INFO_FORMAT=application/json&FEATURE_COUNT=3`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes('ServiceException') || text.includes('Could not find layer')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export const BhuvanLandUseService = {
  /**
   * Query all available Bhuvan LULC layers for a given coordinate.
   * Returns land use classifications across multiple time periods.
   */
  async getLandUse(
    coordinates: [number, number],
    location: string = ''
  ): Promise<BhuvanLandUseReport> {
    const [lng, lat] = coordinates;
    const stateCode = getIndianStateCode(lat, lng);

    console.log(`[Bhuvan] Querying land use for [${lng}, ${lat}] (state: ${stateCode})...`);

    const results: LandUseResult[] = [];

    // Query all layers in parallel
    const promises = LAYERS.map(async (layer) => {
      const layerName = layer.layerName(stateCode);
      console.log(`[Bhuvan]   → ${layer.label}: ${layerName}`);

      const data = await getFeatureInfo(layer.server, layerName, lng, lat);
      if (!data?.features?.length) {
        console.log(`[Bhuvan]   ✗ ${layer.label}: No features`);
        return null;
      }

      const feature = data.features[0];
      const properties = feature.properties || {};
      const landUse = layer.parseLandUse(properties);

      console.log(`[Bhuvan]   ✓ ${layer.label}: ${landUse}`);

      return {
        layerName,
        layerLabel: layer.label,
        featureId: feature.id || '',
        landUseType: landUse,
        landUseCode: properties.Classcode || properties.classcode || properties.CODE || '',
        area: properties.Shape_Area || properties.shape_area || properties.AREA || undefined,
        properties,
        source: `Bhuvan WMS (${layer.label})`,
      } as LandUseResult;
    });

    const settled = await Promise.all(promises);
    for (const r of settled) if (r) results.push(r);

    // Determine primary land use (prefer SIS-DP Phase 2, then latest LULC)
    const primary = results.find(r => r.layerName.includes('SISDP'))
      || results.find(r => r.layerName.includes('1516'))
      || results[0];

    // Detect historic change (compare 2005-06 vs 2015-16)
    const old = results.find(r => r.layerName.includes('0506'));
    const recent = results.find(r => r.layerName.includes('1516'));
    let historicChange: string | undefined;
    if (old && recent && old.landUseType !== recent.landUseType) {
      historicChange = `Changed from "${old.landUseType}" (2005-06) to "${recent.landUseType}" (2015-16)`;
    }

    return {
      coordinates,
      location,
      stateCode,
      countryCode: "IN",
      market: "India",
      layers: results,
      primaryLandUse: primary?.landUseType || 'Unknown',
      historicLandUseChange: historicChange,
      source: 'Bhuvan ISRO (WMS GetFeatureInfo)',
      sourceLabel: "Bhuvan ISRO",
    };
  },
};

export default BhuvanLandUseService;
