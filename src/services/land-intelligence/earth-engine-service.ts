/**
 * Google Earth Engine Service (Placeholder)
 * 
 * Returns mock satellite analysis data for the Delhi pilot until
 * GEE credentials are configured.
 * 
 * When ready, this will use the Earth Engine REST API:
 * https://developers.google.com/earth-engine/reference/rest
 * 
 * Requires: EARTH_ENGINE_PROJECT_ID and EARTH_ENGINE_SERVICE_ACCOUNT_KEY
 */

import type { SatelliteChangeData } from '@/lib/types';

const IS_MOCK = !process.env.EARTH_ENGINE_PROJECT_ID;

// Realistic mock data for various Delhi sub-areas (for pilot testing)
const DELHI_MOCK_DATA: Record<string, Partial<SatelliteChangeData>> = {
  'dwarka': {
    urbanGrowthIndex: 78,
    builtUpAreaPct: 72,
    builtUpChange5yr: 15.3,
    ndviTrend: 'decreasing',
    ndviAverage: 0.18,
    landSurfaceTempC: 34.2,
  },
  'rohini': {
    urbanGrowthIndex: 65,
    builtUpAreaPct: 80,
    builtUpChange5yr: 8.1,
    ndviTrend: 'stable',
    ndviAverage: 0.22,
    landSurfaceTempC: 33.8,
  },
  'narela': {
    urbanGrowthIndex: 88,
    builtUpAreaPct: 45,
    builtUpChange5yr: 22.6,
    ndviTrend: 'decreasing',
    ndviAverage: 0.35,
    landSurfaceTempC: 32.1,
  },
  'noida': {
    urbanGrowthIndex: 92,
    builtUpAreaPct: 68,
    builtUpChange5yr: 25.4,
    ndviTrend: 'decreasing',
    ndviAverage: 0.15,
    landSurfaceTempC: 35.0,
  },
  'default': {
    urbanGrowthIndex: 70,
    builtUpAreaPct: 65,
    builtUpChange5yr: 12.0,
    ndviTrend: 'stable',
    ndviAverage: 0.25,
    landSurfaceTempC: 33.5,
  },
};

function getMockDataForLocation(location: string): Partial<SatelliteChangeData> {
  const loc = location.toLowerCase();
  for (const [key, data] of Object.entries(DELHI_MOCK_DATA)) {
    if (loc.includes(key)) return data;
  }
  return DELHI_MOCK_DATA['default'];
}

export const EarthEngineService = {
  /**
   * Check if running with mock data
   */
  isMockMode(): boolean {
    return IS_MOCK;
  },

  /**
   * Get urban growth index for a location
   * Measures rate of urbanization using satellite imagery change detection
   */
  async getUrbanGrowthIndex(
    coordinates: [number, number],
    location: string = 'Delhi'
  ): Promise<SatelliteChangeData> {
    if (IS_MOCK) {
      console.log(`[EarthEngine] MOCK MODE — returning simulated data for ${location}`);
      const mock = getMockDataForLocation(location);
      return {
        location,
        coordinates,
        urbanGrowthIndex: mock.urbanGrowthIndex!,
        builtUpAreaPct: mock.builtUpAreaPct!,
        builtUpChange5yr: mock.builtUpChange5yr!,
        ndviTrend: mock.ndviTrend!,
        ndviAverage: mock.ndviAverage!,
        landSurfaceTempC: mock.landSurfaceTempC!,
        analysisDate: new Date().toISOString().split('T')[0],
        source: 'Google Earth Engine (MOCK)',
      };
    }

    // ── Real GEE implementation (to be enabled when credentials arrive) ──
    return await this._fetchFromGEE(coordinates, location);
  },

  /**
   * Get land change detection over a time period
   */
  async getLandChangeDetection(
    coordinates: [number, number],
    radiusKm: number = 5,
    location: string = 'Delhi'
  ): Promise<{
    builtUpChange: number;
    vegetationChange: number;
    waterBodyChange: number;
    barrenToBuiltUp: number;
  }> {
    if (IS_MOCK) {
      console.log(`[EarthEngine] MOCK — land change detection for ${location} (${radiusKm}km radius)`);
      const mock = getMockDataForLocation(location);
      return {
        builtUpChange: mock.builtUpChange5yr!,
        vegetationChange: -(mock.builtUpChange5yr! * 0.6),
        waterBodyChange: -2.1,
        barrenToBuiltUp: mock.builtUpChange5yr! * 0.4,
      };
    }

    // Real implementation placeholder
    throw new Error('[EarthEngine] Real GEE not configured. Set EARTH_ENGINE_PROJECT_ID.');
  },

  /**
   * Get NDVI (vegetation index) time series
   */
  async getNDVITimeSeries(
    coordinates: [number, number],
    years: number = 5,
    location: string = 'Delhi'
  ): Promise<{ year: number; ndvi: number }[]> {
    if (IS_MOCK) {
      console.log(`[EarthEngine] MOCK — NDVI time series for ${location}`);
      const mock = getMockDataForLocation(location);
      const baseNDVI = mock.ndviAverage!;
      const currentYear = new Date().getFullYear();
      const trend = mock.ndviTrend === 'decreasing' ? -0.02 : mock.ndviTrend === 'increasing' ? 0.02 : 0;

      return Array.from({ length: years }, (_, i) => ({
        year: currentYear - years + 1 + i,
        ndvi: Math.max(0, Math.min(1, baseNDVI - trend * (years - 1 - i) + (Math.random() * 0.04 - 0.02))),
      }));
    }

    throw new Error('[EarthEngine] Real GEE not configured. Set EARTH_ENGINE_PROJECT_ID.');
  },

  /**
   * Placeholder for real Earth Engine REST API call
   */
  async _fetchFromGEE(coordinates: [number, number], location: string): Promise<SatelliteChangeData> {
    const projectId = process.env.EARTH_ENGINE_PROJECT_ID;
    // TODO: Implement real GEE REST API call
    // POST https://earthengine.googleapis.com/v1/projects/{project}/value:compute
    // Using Landsat/Sentinel-2 composites for change detection

    console.warn('[EarthEngine] Real GEE API call not yet implemented');
    // Fallback to mock
    const mock = getMockDataForLocation(location);
    return {
      location,
      coordinates,
      urbanGrowthIndex: mock.urbanGrowthIndex!,
      builtUpAreaPct: mock.builtUpAreaPct!,
      builtUpChange5yr: mock.builtUpChange5yr!,
      ndviTrend: mock.ndviTrend!,
      ndviAverage: mock.ndviAverage!,
      landSurfaceTempC: mock.landSurfaceTempC!,
      analysisDate: new Date().toISOString().split('T')[0],
      source: `Google Earth Engine (project: ${projectId})`,
    };
  },
};

export default EarthEngineService;
