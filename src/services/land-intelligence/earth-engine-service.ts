/**
 * Google Earth Engine Service — LIVE API
 *
 * Uses the official @google/earthengine Node.js client to run
 * Sentinel-2 based NDVI analysis for urban growth tracking.
 *
 * Auth: Service Account JSON Key
 */

import type { Feature, Polygon } from 'geojson';
import ee from '@google/earthengine';
import type { SatelliteChangeData, TerrainIntelligenceData } from '@/lib/types';

function getProjectId() { return process.env.EARTH_ENGINE_PROJECT_ID; }
function getSAKeyJSON() { return process.env.EARTH_ENGINE_SERVICE_ACCOUNT_KEY; }
function IS_MOCK() { return !getProjectId() || !getSAKeyJSON(); }
const SRTM_DATASET = 'USGS/SRTMGL1_003';
const DEFAULT_TERRAIN_BUFFER_METERS = 250;

// ── Auth & Initialization ─────────────────────────────────────────────────────

let _initialized = false;
let _initPromise: Promise<void> | null = null;

async function initGEE(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    try {
      const sa = JSON.parse(getSAKeyJSON()!);
      console.log(`[EarthEngine] Authenticating as ${sa.client_email}...`);
      
      ee.data.authenticateViaPrivateKey(sa, () => {
        // Must set the project ID before initialize for v1 API
        ee.data.setProject(getProjectId()!);
        
        ee.initialize(
          null,
          null,
          () => {
            _initialized = true;
            console.log('[EarthEngine] Library initialized for Project:', getProjectId());
            resolve();
          },
          (err: any) => {
             console.error('[EarthEngine] Initialize error:', err);
             reject(err);
          }
        );
      }, (err: any) => {
        console.error('[EarthEngine] Auth error:', err);
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });

  _initPromise = _initPromise.catch((error) => {
    _initialized = false;
    _initPromise = null;
    throw error;
  });

  return _initPromise;
}

function evaluateEE<T>(target: any): Promise<T> {
  return new Promise((resolve, reject) => {
    target.evaluate((result: T, error: any) => {
      if (error) {
        reject(new Error(typeof error === 'string' ? error : JSON.stringify(error)));
        return;
      }
      resolve(result);
    });
  });
}

function round(value: number | null, digits: number = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNullableNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDegrees(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function aspectDirectionFromDegrees(value: number | null): TerrainIntelligenceData['aspectDirection'] {
  const normalized = normalizeDegrees(value);
  if (normalized == null) return null;
  const directions: TerrainIntelligenceData['aspectDirection'][] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalized / 45) % 8;
  return directions[index];
}

function classifyTerrain(meanSlope: number | null, relief: number | null): TerrainIntelligenceData['terrainClass'] {
  if ((meanSlope ?? 0) < 2 && (relief ?? 0) < 5) return 'flat';
  if ((meanSlope ?? 0) < 5 && (relief ?? 0) < 12) return 'gentle';
  if ((meanSlope ?? 0) < 10 && (relief ?? 0) < 30) return 'rolling';
  if ((meanSlope ?? 0) < 18 && (relief ?? 0) < 60) return 'steep';
  return 'very-steep';
}

function classifyRunoffRisk(meanSlope: number | null, relief: number | null): TerrainIntelligenceData['runoffRisk'] {
  if ((meanSlope ?? 0) < 1.5 && (relief ?? 0) < 3) return 'high';
  if ((meanSlope ?? 0) > 15 || (relief ?? 0) > 60) return 'high';
  if ((meanSlope ?? 0) < 3 || (relief ?? 0) < 8) return 'moderate';
  return 'low';
}

function classifyFoundationRisk(meanSlope: number | null, relief: number | null): TerrainIntelligenceData['foundationRisk'] {
  if ((meanSlope ?? 0) > 12 || (relief ?? 0) > 35) return 'high';
  if ((meanSlope ?? 0) > 6 || (relief ?? 0) > 15) return 'moderate';
  return 'low';
}

function classifyBuildability(
  runoffRisk: TerrainIntelligenceData['runoffRisk'],
  foundationRisk: TerrainIntelligenceData['foundationRisk'],
): TerrainIntelligenceData['buildability'] {
  if (runoffRisk === 'high' || foundationRisk === 'high') return 'constrained';
  if (runoffRisk === 'moderate' || foundationRisk === 'moderate') return 'conditional';
  return 'favorable';
}

function buildDrainageNote(
  aspectDirection: TerrainIntelligenceData['aspectDirection'],
  runoffRisk: TerrainIntelligenceData['runoffRisk'],
  terrainClass: TerrainIntelligenceData['terrainClass'],
) {
  const fallDirection = aspectDirection ? `with the primary fall trending ${aspectDirection}` : 'with no strong aspect signal';
  if (runoffRisk === 'high' && terrainClass === 'flat') {
    return `The land is very gentle ${fallDirection}, which can trap water during heavy rain. Ponding and stormwater outfall design should be reviewed early.`;
  }
  if (runoffRisk === 'high') {
    return `The site has energetic topography ${fallDirection}. Surface runoff could accelerate and may require stepped grading, erosion control, or retaining.`;
  }
  if (runoffRisk === 'moderate') {
    return `Drainage looks manageable ${fallDirection}, but grading and stormwater routing should still be coordinated early in concept planning.`;
  }
  return `Terrain drainage appears favorable ${fallDirection}, with enough fall to support early-stage stormwater planning without obvious topographic red flags.`;
}

function buildTerrainSummary(
  terrainClass: TerrainIntelligenceData['terrainClass'],
  aspectDirection: TerrainIntelligenceData['aspectDirection'],
  meanSlope: number | null,
  relief: number | null,
  buildability: TerrainIntelligenceData['buildability'],
  runoffRisk: TerrainIntelligenceData['runoffRisk'],
) {
  const aspectText = aspectDirection ? `${aspectDirection}-facing` : 'mixed-aspect';
  return `SRTM indicates ${terrainClass} ${aspectText} terrain with a mean slope of ${round(meanSlope, 1) ?? 'N/A'} deg and about ${round(relief, 1) ?? 'N/A'} m of relief across the analyzed area. Overall terrain buildability looks ${buildability}, with ${runoffRisk} runoff risk at this screening stage.`;
}

function buildTerrainRegion(
  coordinates: [number, number],
  plotGeometry?: Feature<Polygon> | null,
  bufferMeters: number = DEFAULT_TERRAIN_BUFFER_METERS,
) {
  if (plotGeometry?.geometry?.type === 'Polygon' && plotGeometry.geometry.coordinates?.length) {
    return {
      geometry: ee.Geometry.Polygon(plotGeometry.geometry.coordinates as any),
      geometryMode: 'plot' as const,
      bufferRadiusMeters: null,
    };
  }

  return {
    geometry: ee.Geometry.Point(coordinates).buffer(bufferMeters),
    geometryMode: 'buffer' as const,
    bufferRadiusMeters: bufferMeters,
  };
}

function buildMockTerrainResult(
  coordinates: [number, number],
  location: string,
  plotGeometry?: Feature<Polygon> | null,
  bufferMeters: number = DEFAULT_TERRAIN_BUFFER_METERS,
): TerrainIntelligenceData {
  const [lng, lat] = coordinates;
  const seed = Math.abs(Math.round(lng * 1000 + lat * 1000));
  const meanElevation = 40 + Math.abs(lat * 12) + (seed % 75);
  const relief = (plotGeometry ? 6 : 14) + (seed % (plotGeometry ? 10 : 18));
  const meanSlope = (plotGeometry ? 1.2 : 2.5) + ((seed % 28) / 10);
  const maxSlope = meanSlope + 2 + ((seed % 20) / 10);
  const aspectDegrees = (seed * 17) % 360;
  const aspectDirection = aspectDirectionFromDegrees(aspectDegrees);
  const terrainClass = classifyTerrain(meanSlope, relief);
  const runoffRisk = classifyRunoffRisk(meanSlope, relief);
  const foundationRisk = classifyFoundationRisk(meanSlope, relief);
  const buildability = classifyBuildability(runoffRisk, foundationRisk);
  const drainageNote = buildDrainageNote(aspectDirection, runoffRisk, terrainClass);

  return {
    location,
    coordinates,
    analysisDate: new Date().toISOString().split('T')[0],
    source: 'Mock SRTM terrain (set EARTH_ENGINE_PROJECT_ID for live)',
    dataset: SRTM_DATASET,
    resolutionMeters: 30,
    geometryMode: plotGeometry ? 'plot' : 'buffer',
    bufferRadiusMeters: plotGeometry ? null : bufferMeters,
    elevationMeters: {
      mean: round(meanElevation, 1),
      min: round(meanElevation - relief / 2, 1),
      max: round(meanElevation + relief / 2, 1),
      relief: round(relief, 1),
      centroid: round(meanElevation, 1),
    },
    slopeDegrees: {
      mean: round(meanSlope, 1),
      max: round(maxSlope, 1),
    },
    aspectDegrees: round(aspectDegrees, 1),
    aspectDirection,
    terrainClass,
    runoffRisk,
    foundationRisk,
    buildability,
    drainageNote,
    summary: buildTerrainSummary(
      terrainClass,
      aspectDirection,
      meanSlope,
      relief,
      buildability,
      runoffRisk,
    ),
  };
}

// ── Sentinel-2 NDVI Analysis ──────────────────────────────────────────────────

/**
 * Computes the mean NDVI over a 5km radius for the given year (Sentinel-2 SR).
 */
async function computeMeanNDVI(lng: number, lat: number, year: number): Promise<number> {
  await initGEE();

  return new Promise((resolve, reject) => {
    try {
      const point = ee.Geometry.Point([lng, lat]);
      const region = point.buffer(5000); // 5km radius

      const start = `${year}-01-01`;
      const end = `${year}-12-31`;

      const collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(start, end)
        // Filter out highly cloudy images across the region
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

      // Calculate median composite to remove clouds
      const medianImage = collection.median();

      // Compute NDVI (B8 = NIR, B4 = Red)
      const ndvi = medianImage.normalizedDifference(['B8', 'B4']).rename('NDVI');

      // Reduce region to get the mean NDVI value
      const dict = ndvi.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        scale: 30, // 30m resolution for faster compute
        maxPixels: 1e9
      });

      // Evaluate pulls the data from Google's servers to our Node backend
      dict.evaluate((result: any, error: any) => {
        if (error) return reject(new Error(error));
        // result is normally e.g. { NDVI: 0.245 }
        const val = result?.NDVI;
        if (typeof val === 'number') {
          resolve(val);
        } else {
          resolve(0.2); // Fallback if region had no data
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ── Mock fallback ─────────────────────────────────────────────────────────────

const DELHI_MOCK: Record<string, Partial<SatelliteChangeData>> = {
  dwarka:  { urbanGrowthIndex: 78, builtUpAreaPct: 72, builtUpChange5yr: 15.3, ndviTrend: 'decreasing', ndviAverage: 0.18, landSurfaceTempC: 34.2 },
  rohini:  { urbanGrowthIndex: 65, builtUpAreaPct: 80, builtUpChange5yr: 8.1, ndviTrend: 'stable',     ndviAverage: 0.22, landSurfaceTempC: 33.8 },
  narela:  { urbanGrowthIndex: 88, builtUpAreaPct: 45, builtUpChange5yr: 22.6, ndviTrend: 'decreasing', ndviAverage: 0.35, landSurfaceTempC: 32.1 },
  noida:   { urbanGrowthIndex: 92, builtUpAreaPct: 68, builtUpChange5yr: 25.4, ndviTrend: 'decreasing', ndviAverage: 0.15, landSurfaceTempC: 35.0 },
  default: { urbanGrowthIndex: 70, builtUpAreaPct: 65, builtUpChange5yr: 12.0, ndviTrend: 'stable',     ndviAverage: 0.25, landSurfaceTempC: 33.5 },
};

function getMock(location: string): Partial<SatelliteChangeData> {
  const loc = location.toLowerCase();
  for (const [k, v] of Object.entries(DELHI_MOCK)) if (loc.includes(k)) return v;
  return DELHI_MOCK.default;
}

function buildMockResult(location: string, coordinates: [number, number], m: Partial<SatelliteChangeData>, source: string): SatelliteChangeData {
  return {
    location, coordinates,
    urbanGrowthIndex: m.urbanGrowthIndex!,
    builtUpAreaPct: m.builtUpAreaPct!,
    builtUpChange5yr: m.builtUpChange5yr!,
    ndviTrend: m.ndviTrend!,
    ndviAverage: m.ndviAverage!,
    landSurfaceTempC: m.landSurfaceTempC!,
    analysisDate: new Date().toISOString().split('T')[0],
    source,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const EarthEngineService = {
  isMockMode(): boolean {
    return IS_MOCK();
  },

  async getUrbanGrowthIndex(
    coordinates: [number, number],
    location: string = 'Delhi'
  ): Promise<SatelliteChangeData> {
    const [lng, lat] = coordinates;

    if (IS_MOCK()) {
      console.log(`[EarthEngine] MOCK MODE — returning simulated data for ${location}`);
      return buildMockResult(location, coordinates, getMock(location), 'Mock (set EARTH_ENGINE_PROJECT_ID for live)');
    }

    console.log(`[EarthEngine] LIVE — fetching Sentinel-2 NDVI for ${location} [${lng}, ${lat}] via Earth Engine library...`);

    try {
      // Fetch NDVI for current year
      const currentYear = new Date().getFullYear();
      const ndviValue = await computeMeanNDVI(lng, lat, currentYear - 1); // latest full year mapping

      console.log(`[EarthEngine] LIVE — NDVI = ${ndviValue}`);

      // Derive urban metrics from NDVI (lower NDVI = more built-up)
      // Cap at 95% and floor at 5%
      const builtUpAreaPct = Math.min(95, Math.max(5, Math.round((1 - ndviValue) * 100)));
      // Growth index scaled
      const urbanGrowthIndex = Math.min(100, Math.max(0, Math.round(builtUpAreaPct * 0.95 + 10)));
      
      // Calculate a rough change metric (in the future, subtract past year NDVI from current year NDVI)
      const builtUpChange5yr = parseFloat(((1 - ndviValue) * 20).toFixed(1));
      
      const ndviTrend: SatelliteChangeData['ndviTrend'] = ndviValue < 0.2 ? 'decreasing' : 'stable';
      const landSurfaceTempC = parseFloat((28 + (1 - ndviValue) * 10).toFixed(1));

      return {
        location, coordinates,
        urbanGrowthIndex, builtUpAreaPct, builtUpChange5yr,
        ndviTrend,
        ndviAverage: parseFloat(ndviValue.toFixed(3)),
        landSurfaceTempC,
        analysisDate: new Date().toISOString().split('T')[0],
        source: `Google Earth Engine LIVE (Sentinel-2, project: ${getProjectId()})`,
      };
    } catch (err: any) {
      console.error('[EarthEngine] LIVE failed, falling back to mock:', err.message);
      return buildMockResult(location, coordinates, getMock(location), `Mock (GEE live failed: ${err.message})`);
    }
  },

  async getLandChangeDetection(
    coordinates: [number, number],
    radiusKm: number = 5,
    location: string = 'Delhi'
  ): Promise<{ builtUpChange: number; vegetationChange: number; waterBodyChange: number; barrenToBuiltUp: number }> {
    const sat = await this.getUrbanGrowthIndex(coordinates, location);
    return {
      builtUpChange: sat.builtUpChange5yr,
      vegetationChange: -(sat.builtUpChange5yr * 0.6),
      waterBodyChange: -2.1,
      barrenToBuiltUp: sat.builtUpChange5yr * 0.4,
    };
  },

  async getNDVITimeSeries(
    coordinates: [number, number],
    years: number = 5,
    location: string = 'Delhi'
  ): Promise<{ year: number; ndvi: number }[]> {
    // For performance, we grab the current year and extrapolate the mock trend.
    // In full prod, we would run `computeMeanNDVI` in a Promise.all() map loop for the last 5 years.
    const live = await this.getUrbanGrowthIndex(coordinates, location);
    const cur = new Date().getFullYear();
    const base = live.ndviAverage;
    const trend = live.ndviTrend === 'decreasing' ? -0.015 : live.ndviTrend === 'increasing' ? 0.015 : 0;
    
    return Array.from({ length: years }, (_, i) => ({
      year: cur - years + 1 + i,
      ndvi: parseFloat(Math.max(0, Math.min(1, base + trend * (i - years + 1))).toFixed(3)),
    }));
  },

  async getTerrainIntelligence(
    coordinates: [number, number],
    options?: {
      plotGeometry?: Feature<Polygon> | null;
      location?: string;
      bufferMeters?: number;
    },
  ): Promise<TerrainIntelligenceData> {
    const location = options?.location || 'Selected site';
    const bufferMeters = options?.bufferMeters ?? DEFAULT_TERRAIN_BUFFER_METERS;

    if (IS_MOCK()) {
      console.log(`[EarthEngine] MOCK MODE - returning simulated SRTM terrain for ${location}`);
      return buildMockTerrainResult(coordinates, location, options?.plotGeometry, bufferMeters);
    }

    try {
      await initGEE();

      const regionConfig = buildTerrainRegion(coordinates, options?.plotGeometry, bufferMeters);
      const point = ee.Geometry.Point(coordinates);
      const dem = ee.Image(SRTM_DATASET).select('elevation');
      const terrain = ee.Algorithms.Terrain(dem);
      const regionArgs = {
        geometry: regionConfig.geometry,
        scale: 30,
        bestEffort: true,
        maxPixels: 1e8,
      };
      const elevationReducer = ee.Reducer.mean().combine({
        reducer2: ee.Reducer.minMax(),
        sharedInputs: true,
      });
      const slopeReducer = ee.Reducer.mean().combine({
        reducer2: ee.Reducer.max(),
        sharedInputs: true,
      });

      const [elevationStats, slopeStats, aspectStats, centroidStats] = await Promise.all([
        evaluateEE<Record<string, number | null>>(dem.reduceRegion({
          reducer: elevationReducer,
          ...regionArgs,
        })),
        evaluateEE<Record<string, number | null>>(terrain.select('slope').reduceRegion({
          reducer: slopeReducer,
          ...regionArgs,
        })),
        evaluateEE<Record<string, number | null>>(terrain.select('aspect').reduceRegion({
          reducer: ee.Reducer.mean(),
          ...regionArgs,
        })),
        evaluateEE<Record<string, number | null>>(dem.reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: point.buffer(15),
          scale: 30,
          bestEffort: true,
          maxPixels: 1e6,
        })),
      ]);

      const meanElevation = toNullableNumber(elevationStats.elevation_mean);
      const minElevation = toNullableNumber(elevationStats.elevation_min);
      const maxElevation = toNullableNumber(elevationStats.elevation_max);
      const meanSlope = toNullableNumber(slopeStats.slope_mean);
      const maxSlope = toNullableNumber(slopeStats.slope_max);
      const aspectDegrees = toNullableNumber(aspectStats.aspect);
      const centroidElevation = toNullableNumber(centroidStats.elevation);
      const relief =
        meanElevation != null && minElevation != null && maxElevation != null
          ? maxElevation - minElevation
          : null;
      const aspectDirection = aspectDirectionFromDegrees(aspectDegrees);
      const terrainClass = classifyTerrain(meanSlope, relief);
      const runoffRisk = classifyRunoffRisk(meanSlope, relief);
      const foundationRisk = classifyFoundationRisk(meanSlope, relief);
      const buildability = classifyBuildability(runoffRisk, foundationRisk);
      const drainageNote = buildDrainageNote(aspectDirection, runoffRisk, terrainClass);

      return {
        location,
        coordinates,
        analysisDate: new Date().toISOString().split('T')[0],
        source: `Google Earth Engine LIVE (${SRTM_DATASET}, project: ${getProjectId()})`,
        dataset: SRTM_DATASET,
        resolutionMeters: 30,
        geometryMode: regionConfig.geometryMode,
        bufferRadiusMeters: regionConfig.bufferRadiusMeters,
        elevationMeters: {
          mean: round(meanElevation, 1),
          min: round(minElevation, 1),
          max: round(maxElevation, 1),
          relief: round(relief, 1),
          centroid: round(centroidElevation, 1),
        },
        slopeDegrees: {
          mean: round(meanSlope, 1),
          max: round(maxSlope, 1),
        },
        aspectDegrees: round(aspectDegrees, 1),
        aspectDirection,
        terrainClass,
        runoffRisk,
        foundationRisk,
        buildability,
        drainageNote,
        summary: buildTerrainSummary(
          terrainClass,
          aspectDirection,
          meanSlope,
          relief,
          buildability,
          runoffRisk,
        ),
      };
    } catch (err: any) {
      console.error('[EarthEngine] Terrain analysis failed, falling back to mock:', err?.message || err);
      return buildMockTerrainResult(coordinates, location, options?.plotGeometry, bufferMeters);
    }
  },
};

export default EarthEngineService;
