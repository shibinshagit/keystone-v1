/**
 * data.gov.in Service
 * Fetches census, FDI, and SEZ data from India's Open Government Data Platform.
 * 
 * Requires: DATA_GOV_API_KEY environment variable
 * API docs: https://data.gov.in/ogpl_apis
 */

import type { CensusData, FDIData, SEZData } from '@/lib/types';

const BASE_URL = 'https://api.data.gov.in/resource';

// Known dataset resource IDs on data.gov.in
const RESOURCE_IDS = {
  // Census 2011 district-wise population
  CENSUS_POPULATION: '9115b89c-7a80-4f54-9b06-21086e0f0bd7',
  // FDI equity inflows sector-wise
  FDI_EQUITY: '4bfe5b3a-3a1c-4355-8970-a12e3c5c1a01',
  // SEZ listings
  SEZ_LIST: '15f41a4e-6ab3-4126-9769-a4f8e1a0284b',
} as const;

function getApiKey(): string {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) {
    throw new Error('[DataGov] DATA_GOV_API_KEY environment variable is not set');
  }
  return key;
}

async function fetchResource(resourceId: string, filters: Record<string, string> = {}, limit = 100): Promise<any> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}/${resourceId}`);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));

  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(`filters[${key}]`, value);
  }

  console.log(`[DataGov] Fetching: ${url.toString().replace(apiKey, '***')}`);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`[DataGov] API returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data;
}

export const DataGovService = {
  /**
   * Fetch census population data for a state/district
   */
  async getCensusData(state: string, district?: string): Promise<CensusData[]> {
    try {
      const filters: Record<string, string> = {};
      if (state) filters['state_name'] = state;
      if (district) filters['district_name'] = district;

      const data = await fetchResource(RESOURCE_IDS.CENSUS_POPULATION, filters, 50);
      const records = data.records || [];

      return records.map((r: any) => ({
        state: r.state_name || r.state || state,
        district: r.district_name || r.district || district || '',
        totalPopulation: parseInt(r.total_population || r.tot_p || '0', 10),
        malePopulation: parseInt(r.male_population || r.tot_m || '0', 10),
        femalePopulation: parseInt(r.female_population || r.tot_f || '0', 10),
        literacyRate: parseFloat(r.literacy_rate_total || r.effective_literacy_rate_total_ || '0'),
        populationDensity: parseFloat(r.population_density || r.density_of_population || '0'),
        decadalGrowthRate: parseFloat(r.decadal_growth_rate || r.growth_rate || '0'),
        urbanPopulationPct: parseFloat(r.urban_population_percentage || '0'),
        householdCount: parseInt(r.no_of_households || r.total_no_of_hh || '0', 10),
        source: 'data.gov.in Census 2011',
        year: 2011,
      }));
    } catch (error: any) {
      console.error('[DataGov] Census fetch error:', error.message);
      return [];
    }
  },

  /**
   * Fetch FDI equity inflows by sector/state
   */
  async getFDIData(state?: string, sector?: string): Promise<FDIData[]> {
    try {
      const filters: Record<string, string> = {};
      if (state) filters['state'] = state;
      if (sector) filters['sector'] = sector;

      const data = await fetchResource(RESOURCE_IDS.FDI_EQUITY, filters, 100);
      const records = data.records || [];

      return records.map((r: any) => ({
        sector: r.sector || r.sector_name || 'Unknown',
        amountInrCrores: parseFloat(r.amount_in_inr_crores || r.cumulative_inflows_rs_crore || '0'),
        amountUsdMillions: parseFloat(r.amount_in_usd_millions || r.cumulative_inflows_us_million || '0'),
        year: r.financial_year || r.year || '',
        state: r.state || state,
        source: 'data.gov.in FDI Statistics',
      }));
    } catch (error: any) {
      console.error('[DataGov] FDI fetch error:', error.message);
      return [];
    }
  },

  /**
   * Fetch Special Economic Zone listings
   */
  async getSEZData(state?: string): Promise<SEZData[]> {
    try {
      const filters: Record<string, string> = {};
      if (state) filters['state'] = state;

      const data = await fetchResource(RESOURCE_IDS.SEZ_LIST, filters, 200);
      const records = data.records || [];

      return records.map((r: any) => ({
        name: r.name_of_the_sez || r.sez_name || 'Unknown SEZ',
        developer: r.developer_name || r.name_of_the_developer || '',
        state: r.state || state || '',
        district: r.district || r.location || '',
        sector: r.sector || r.type_of_sez || '',
        areaHectares: parseFloat(r.area_in_hectares || r.area || '0'),
        status: mapSEZStatus(r.status || r.approval_status || ''),
        source: 'data.gov.in SEZ India',
      }));
    } catch (error: any) {
      console.error('[DataGov] SEZ fetch error:', error.message);
      return [];
    }
  },
};

function mapSEZStatus(status: string): SEZData['status'] {
  const s = status.toLowerCase();
  if (s.includes('operational') || s.includes('exporting')) return 'Operational';
  if (s.includes('notified')) return 'Notified';
  if (s.includes('formal')) return 'Formal Approval';
  return 'In-Principle';
}

export default DataGovService;
