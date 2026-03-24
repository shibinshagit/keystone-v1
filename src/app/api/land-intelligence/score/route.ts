import { NextRequest, NextResponse } from 'next/server';
import { DataGovService } from '@/services/land-intelligence/data-gov-service';
import { EarthEngineService } from '@/services/land-intelligence/earth-engine-service';
import { evaluateDevelopability, toDevelopabilityScore } from '@/lib/scoring/developability-engine';
import type { ItemResult } from '@/lib/scoring/schema-engine';
import type { LandIntelligenceQuery, CensusData, SEZData, SatelliteChangeData } from '@/lib/types';

/**
 * Land Intelligence: Developability Score
 * 
 * POST /api/land-intelligence/score
 * Body: LandIntelligenceQuery JSON
 * 
 * Aggregates data from all services and runs the scoring engine.
 */
export async function POST(request: NextRequest) {
  try {
    const query: LandIntelligenceQuery = await request.json();

    if (!query.location) {
      return NextResponse.json({ error: 'location is required' }, { status: 400 });
    }

    const coords: [number, number] = query.coordinates || [77.2090, 28.6139]; // Default: Delhi center
    const state = query.location;
    const district = query.district;

    console.log(`[Land Intel] Computing Developability Score for ${state}${district ? ` / ${district}` : ''}`);

    // ── Fetch all data sources in parallel ──
    const [censusData, fdiData, sezData, satelliteData] = await Promise.allSettled([
      DataGovService.getCensusData(state, district),
      DataGovService.getFDIData(state),
      DataGovService.getSEZData(state),
      EarthEngineService.getUrbanGrowthIndex(coords, district || state),
    ]);

    const census: CensusData[] = censusData.status === 'fulfilled' ? censusData.value : [];
    const fdi = fdiData.status === 'fulfilled' ? fdiData.value : [];
    const sez: SEZData[] = sezData.status === 'fulfilled' ? sezData.value : [];
    const satellite: SatelliteChangeData | null = satelliteData.status === 'fulfilled' ? satelliteData.value : null;

    // ── Map data to scoring engine inputs ──
    const results: Record<string, ItemResult | undefined> = {};

    // GP1: Infrastructure proximity — score based on satellite urban index as proxy
    if (satellite) {
      results['GP1'] = {
        score: Math.min(80, Math.round(satellite.urbanGrowthIndex * 0.8)),
        status: satellite.urbanGrowthIndex > 50,
      };
    }

    // GP2: FDI corridor alignment
    if (fdi.length > 0) {
      const totalFDI = fdi.reduce((sum, f) => sum + f.amountUsdMillions, 0);
      results['GP2'] = {
        score: totalFDI > 1000 ? 60 : totalFDI > 500 ? 45 : totalFDI > 100 ? 30 : 15,
        status: totalFDI > 100,
      };
    }

    // GP3: Urban expansion index (satellite)
    if (satellite) {
      results['GP3'] = {
        score: Math.min(80, Math.round(satellite.builtUpChange5yr * 3.2)),
        status: satellite.builtUpChange5yr > 10,
      };
    }

    // GP4: Population growth trend
    if (census.length > 0) {
      const avgGrowth = census.reduce((sum, c) => sum + c.decadalGrowthRate, 0) / census.length;
      results['GP4'] = {
        score: avgGrowth > 20 ? 40 : avgGrowth > 15 ? 30 : avgGrowth > 10 ? 20 : 10,
        status: avgGrowth > 10,
      };
    }

    // GP5: Proposed infrastructure — no live data yet, neutral
    results['GP5'] = undefined;

    // LR1: Zoning compliance — assume compliant for now (needs master plan)
    results['LR1'] = { status: true, score: 80 };

    // LR2: CLU feasibility — default positive
    results['LR2'] = { score: 35 };

    // LR3: Dispute flags — assume no disputes found (placeholder)
    results['LR3'] = { status: true, score: 60 };

    // LR4: RERA status — not available yet
    results['LR4'] = undefined;

    // LR5: Master plan conformity — needs master plan PDF
    results['LR5'] = undefined;

    // LC1: Metro distance — rough estimate from satellite data
    if (satellite) {
      results['LC1'] = {
        score: satellite.urbanGrowthIndex > 70 ? 50 : satellite.urbanGrowthIndex > 40 ? 35 : 20,
        status: satellite.urbanGrowthIndex > 50,
      };
    }

    // LC2: Highway access — estimate from built-up area
    if (satellite) {
      results['LC2'] = {
        score: satellite.builtUpAreaPct > 60 ? 45 : satellite.builtUpAreaPct > 40 ? 30 : 15,
        status: satellite.builtUpAreaPct > 50,
      };
    }

    // LC3: Amenity density — placeholder (would use Overpass data)
    results['LC3'] = { score: 40 };

    // LC4: Road width — not available
    results['LC4'] = undefined;

    // LC5: Airport distance — not calculated
    results['LC5'] = undefined;

    // ME1: Price trend — not available
    results['ME1'] = undefined;

    // ME2: SEZ proximity
    if (sez.length > 0) {
      const operationalSEZ = sez.filter(s => s.status === 'Operational').length;
      results['ME2'] = {
        score: operationalSEZ > 5 ? 40 : operationalSEZ > 2 ? 30 : operationalSEZ > 0 ? 20 : 5,
        status: operationalSEZ > 0,
      };
    }

    // ME3: Absorption rate — not available
    results['ME3'] = undefined;

    // ME4: Population density vs supply gap
    if (census.length > 0) {
      const avgDensity = census.reduce((sum, c) => sum + c.populationDensity, 0) / census.length;
      results['ME4'] = {
        score: avgDensity > 10000 ? 50 : avgDensity > 5000 ? 35 : avgDensity > 1000 ? 20 : 10,
        status: avgDensity > 5000,
      };
    }

    // ── Run scoring engine ──
    const engineOutput = evaluateDevelopability(results);
    const developabilityScore = toDevelopabilityScore(engineOutput, results);

    return NextResponse.json({
      success: true,
      query,
      score: developabilityScore,
      dataSources: {
        census: { count: census.length, available: census.length > 0 },
        fdi: { count: fdi.length, available: fdi.length > 0 },
        sez: { count: sez.length, available: sez.length > 0 },
        satellite: { available: satellite !== null, isMock: EarthEngineService.isMockMode() },
      },
    });
  } catch (error: any) {
    console.error('[Land Intel] Score computation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to compute developability score' },
      { status: 500 }
    );
  }
}
