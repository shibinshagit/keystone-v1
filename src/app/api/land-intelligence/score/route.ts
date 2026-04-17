import { NextRequest, NextResponse } from 'next/server';
import { DataGovService } from '@/services/land-intelligence/data-gov-service';
import { EarthEngineService } from '@/services/land-intelligence/earth-engine-service';
import { GoogleMapsServerService } from '@/services/land-intelligence/google-maps-server-service';
import { ProposedInfraService } from '@/services/land-intelligence/proposed-infra-service';
import { lookupRegulationForLocationAndUse } from '@/lib/regulation-lookup';
import { evaluateDevelopability, toDevelopabilityScore } from '@/lib/scoring/developability-engine';
import type { ItemResult } from '@/lib/scoring/schema-engine';
import type {
  CensusData,
  LandIntelligenceQuery,
  RegulationData,
  SEZData,
  SatelliteChangeData,
} from '@/lib/types';

type Coordinates = [number, number];

interface AmenityRecord {
  id?: string | number;
  category?: string;
  name?: string;
  distance?: number;
  distanceMeters?: number;
}

const DEFAULT_COORDS: Coordinates = [77.209, 28.6139];
const EMPTY_PROPOSED_INFRA_SIGNAL = {
  available: false,
  count: 0,
  source: 'MoSPI PAIMANA Public Dashboard',
  snippets: [],
};
const TRANSIT_PLACE_TYPES = ['bus_station', 'train_station', 'subway_station'];
const SCHOOL_PLACE_TYPES = ['school', 'primary_school', 'secondary_school', 'university'];
const AIRPORT_DISTANCE_OPTIMAL_RANGE: [number, number] = [5000, 40000];

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function getRegulationText(regulation: RegulationData | null) {
  const zone = regulation?.geometry?.land_use_zoning?.value;
  const landUseCategory = regulation?.geometry?.land_use_category?.value;
  const conversionStatus = regulation?.geometry?.conversion_status?.value;

  return {
    zoneText: [zone, landUseCategory].filter(Boolean).map(normalizeText).join(' | '),
    conversionText: normalizeText(conversionStatus),
  };
}

// Current legal scoring is driven by admin/regulation records only.
// Until master-plan extraction is wired in, this is the best available zoning/CLU evidence,
// but it is still incomplete for locations where regulation data is missing or sparse.
function regulationAllowsUse(regulation: RegulationData | null, intendedUse: string | undefined) {
  if (!regulation || !intendedUse) return false;

  const intended = normalizeText(intendedUse);
  const regType = normalizeText(regulation.type);
  const { zoneText } = getRegulationText(regulation);
  const haystack = `${regType} ${zoneText}`.trim();

  if (!haystack) return false;
  if (haystack.includes(intended)) return true;

  if (includesAny(intended, ['retail', 'office', 'commercial', 'hospitality'])) {
    return includesAny(haystack, ['commercial', 'retail', 'office', 'business', 'mixed']);
  }
  if (intended.includes('mixed')) {
    return includesAny(haystack, ['mixed', 'commercial', 'residential']);
  }
  if (intended.includes('industrial')) {
    return includesAny(haystack, ['industrial', 'warehouse', 'logistics']);
  }
  if (includesAny(intended, ['public', 'institution', 'utility'])) {
    return includesAny(haystack, ['public', 'institution', 'utility', 'hospital', 'school', 'civic']);
  }

  return includesAny(haystack, ['residential', 'housing', 'group housing']);
}

// CLU feasibility is still heuristic for now: we infer "possible" from available
// conversion text rather than a parcel-authoritative approval workflow.
function canPotentiallyConvert(regulation: RegulationData | null) {
  if (!regulation) return false;
  const { conversionText } = getRegulationText(regulation);

  if (!conversionText) return false;
  if (includesAny(conversionText, ['not allowed', 'not permitted', 'prohibited'])) {
    return false;
  }

  return includesAny(conversionText, [
    'allowed',
    'permitted',
    'possible',
    'convert',
    'conversion',
    'clu',
    'change of land use',
    'approval',
  ]);
}

function getNumericRegulationValue(regulation: RegulationData | null, path: string[]): number | null {
  let current: unknown = regulation;

  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  const numeric = Number(current);
  return Number.isFinite(numeric) ? numeric : null;
}

function scoreByDistance(
  distanceMeters: number,
  bands: Array<{ maxMeters: number; score: number }>,
  fallbackScore: number,
) {
  for (const band of bands) {
    if (distanceMeters <= band.maxMeters) {
      return band.score;
    }
  }

  return fallbackScore;
}

function round(value: number, decimals: number = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toFiniteDistance(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getNearestDistance(
  storedAmenities: AmenityRecord[],
  matcher: (amenity: AmenityRecord) => boolean,
  liveDistances: number[],
): number | null {
  const storedDistances = storedAmenities
    .filter(matcher)
    .map((amenity) => toFiniteDistance(amenity.distance ?? amenity.distanceMeters))
    .filter((distance): distance is number => distance != null);

  return [...storedDistances, ...liveDistances].sort((a, b) => a - b)[0] ?? null;
}

function countUniqueNearbyAmenities(
  storedAmenities: AmenityRecord[],
  matcher: (amenity: AmenityRecord) => boolean,
  maxDistanceMeters: number,
  liveAmenities: Array<{ id: string; distanceMeters: number }>,
  storedPrefix: string,
) {
  return new Set([
    ...storedAmenities
      .filter(matcher)
      .filter((amenity) => (toFiniteDistance(amenity.distance ?? amenity.distanceMeters) ?? Infinity) <= maxDistanceMeters)
      .map((amenity, index) => String(amenity.id ?? `${storedPrefix}-${index}`)),
    ...liveAmenities
      .filter((amenity) => amenity.distanceMeters <= maxDistanceMeters)
      .map((amenity) => amenity.id),
  ]).size;
}

function parseAbsorptionRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

// Our current SEZ dataset does not ship coordinates, so ME2 geocodes official SEZ names/addresses
// into points at runtime. This is a practical interim step, but still weaker than using official
// SEZ polygons or a maintained geocoded industrial/logistics dataset.
function buildSezGeocodeCandidates(entry: SEZData): string[] {
  const candidateParts = [
    [entry.name, entry.district, entry.state, 'India'],
    [entry.name, entry.developer, entry.district, entry.state, 'India'],
    [entry.name, entry.state, 'India'],
    [entry.developer, entry.name, entry.state, 'India'],
  ];

  return candidateParts
    .map((parts) =>
      parts
        .filter(Boolean)
        .map((part) => String(part).trim())
        .filter(Boolean)
        .join(', '),
    )
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function getNearestOperationalSez(
  coords: Coordinates,
  sezEntries: SEZData[],
): Promise<(SEZData & { distanceMeters: number }) | null> {
  const operationalSez = sezEntries.filter((entry) => entry.status === 'Operational');
  if (operationalSez.length === 0) return null;

  const geocoded = await Promise.allSettled(
    operationalSez.map(async (entry) => {
      for (const candidate of buildSezGeocodeCandidates(entry)) {
        let location: { lat: number; lng: number } | null = null;
        try {
          location = await GoogleMapsServerService.geocodeAddress(candidate);
        } catch (error) {
          console.warn('[Land Intel] SEZ geocoding failed for candidate:', candidate, error);
          continue;
        }

        if (!location) continue;

        return {
          ...entry,
          distanceMeters: Math.round(
            GoogleMapsServerService.calculateDistanceInMeters(
              coords[1],
              coords[0],
              location.lat,
              location.lng,
            ),
          ),
        };
      }

      return null;
    }),
  );

  return geocoded
    .flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const query: LandIntelligenceQuery = await request.json();

    if (!query.location) {
      return NextResponse.json({ error: 'location is required' }, { status: 400 });
    }

    const coords: Coordinates = query.coordinates || DEFAULT_COORDS;
    const state = query.location;
    const district = query.district;

    console.log(`[Land Intel] Computing Developability Score for ${state}${district ? ` / ${district}` : ''}`);

    // Parcel-aware access scoring samples the parcel boundary when geometry is available.
    // Without parcel geometry, connectivity falls back to the centroid only, which is less reliable.
    const googleRoadPoints = query.plotGeometry
      ? [
          { lat: coords[1], lng: coords[0] },
          ...GoogleMapsServerService.sampleParcelBoundaryPoints(query.plotGeometry, 48),
        ]
      : [{ lat: coords[1], lng: coords[0] }];

    const [
      censusData,
      fdiData,
      sezData,
      satelliteData,
      regulationData,
      transitData,
      schoolData,
      hospitalData,
      parkData,
      airportData,
      roadSnapData,
      proposedInfraData,
    ] = await Promise.allSettled([
      DataGovService.getCensusData(state, district),
      DataGovService.getFDIData(state),
      DataGovService.getSEZData(state),
      EarthEngineService.getUrbanGrowthIndex(coords, district || state),
      lookupRegulationForLocationAndUse({
        location: district ? `${district}, ${state}` : state,
        intendedUse: query.intendedUse || 'Residential',
      }),
      GoogleMapsServerService.searchNearbyPlaces(coords, {
        includedTypes: TRANSIT_PLACE_TYPES,
        radius: 5000,
        maxResultCount: 10,
      }),
      GoogleMapsServerService.searchNearbyPlaces(coords, {
        includedTypes: SCHOOL_PLACE_TYPES,
        radius: 2500,
        maxResultCount: 12,
      }),
      GoogleMapsServerService.searchNearbyPlaces(coords, {
        includedTypes: ['hospital'],
        radius: 4000,
        maxResultCount: 10,
      }),
      GoogleMapsServerService.searchNearbyPlaces(coords, {
        includedTypes: ['park'],
        radius: 2500,
        maxResultCount: 10,
      }),
      GoogleMapsServerService.searchNearbyPlaces(coords, {
        includedTypes: ['airport'],
        radius: 50000,
        maxResultCount: 5,
      }),
      GoogleMapsServerService.snapPointsToNearestRoads(googleRoadPoints),
      ProposedInfraService.getMospiSignal({
        state,
        district,
      }),
    ]);

    // Several current reference datasets are still partial-coverage inside the project.
    // When a state/city is missing here, those score items stay empty or fall back gracefully.
    const census: CensusData[] = censusData.status === 'fulfilled' ? censusData.value : [];
    const fdi = fdiData.status === 'fulfilled' ? fdiData.value : [];
    const sez: SEZData[] = sezData.status === 'fulfilled' ? sezData.value : [];
    const satellite: SatelliteChangeData | null = satelliteData.status === 'fulfilled' ? satelliteData.value : null;
    const regulation = regulationData.status === 'fulfilled' ? regulationData.value.regulation : null;
    const transitPlaces = transitData.status === 'fulfilled' ? transitData.value : [];
    const schools = schoolData.status === 'fulfilled' ? schoolData.value : [];
    const hospitals = hospitalData.status === 'fulfilled' ? hospitalData.value : [];
    const parks = parkData.status === 'fulfilled' ? parkData.value : [];
    const airports = airportData.status === 'fulfilled' ? airportData.value : [];
    const snappedRoads = roadSnapData.status === 'fulfilled' ? roadSnapData.value : [];
    const proposedInfra =
      proposedInfraData.status === 'fulfilled'
        ? proposedInfraData.value
        : EMPTY_PROPOSED_INFRA_SIGNAL;
    const underwriting = query.underwriting;
    const storedAmenities: AmenityRecord[] = Array.isArray(query.locationAmenities) ? query.locationAmenities : [];
    const roadAccessSides = Array.isArray(query.roadAccessSides)
      ? query.roadAccessSides.filter((side): side is string => typeof side === 'string' && side.length > 0)
      : [];

    const results: Record<string, ItemResult | undefined> = {};

    // Prefer previously scanned/stored project amenities when available, then supplement with
    // live Google results. This avoids ignoring data already collected elsewhere in the product.
    const nearestTransit = getNearestDistance(
      storedAmenities,
      (amenity) => amenity.category === 'transit',
      transitPlaces.map((place) => place.distanceMeters),
    );
    const nearestAirport = getNearestDistance(
      storedAmenities,
      (amenity) =>
        String(amenity.name || amenity.category || '')
          .toLowerCase()
          .includes('airport'),
      airports.map((place) => place.distanceMeters),
    );
    const centroidRoadDistance = snappedRoads.find((point) => point.originalIndex === 0)?.distanceMeters ?? null;
    const boundaryRoads = snappedRoads.filter((point) => point.originalIndex > 0);
    const boundaryCoverageRatio =
      googleRoadPoints.length > 1
        ? boundaryRoads.filter((point) => point.distanceMeters <= 30).length / Math.max(1, googleRoadPoints.length - 1)
        : 0;

    const nearbySchoolCount = countUniqueNearbyAmenities(
      storedAmenities,
      (amenity) => amenity.category === 'school' || amenity.category === 'college',
      2000,
      schools,
      'stored-school',
    );
    const nearbyHospitalCount = countUniqueNearbyAmenities(
      storedAmenities,
      (amenity) => amenity.category === 'hospital',
      3000,
      hospitals,
      'stored-hospital',
    );
    const nearbyParkCount = countUniqueNearbyAmenities(
      storedAmenities,
      (amenity) => amenity.category === 'park',
      2000,
      parks,
      'stored-park',
    );

    const roadWidth = getNumericRegulationValue(regulation, ['geometry', 'road_width', 'value']);
    const frontageWidth = getNumericRegulationValue(regulation, ['geometry', 'minimum_frontage_width', 'value']);
    const absorptionRate = getNumericRegulationValue(regulation, ['administration', 'absorption_assumptions', 'value']);
    const regulationPermitsUse = regulationAllowsUse(regulation, query.intendedUse);
    const cluPossible = canPotentiallyConvert(regulation);
    const nearestOperationalSez = await getNearestOperationalSez(coords, sez);
    const roadAccessSideScore =
      roadAccessSides.length >= 3
        ? 8
        : roadAccessSides.length === 2
          ? 6
          : roadAccessSides.length === 1
            ? 3
            : 0;

    let lc1Score = 0;
    if (nearestTransit != null) {
      lc1Score = scoreByDistance(
        nearestTransit,
        [
          { maxMeters: 500, score: 60 },
          { maxMeters: 1000, score: 50 },
          { maxMeters: 2500, score: 38 },
          { maxMeters: 5000, score: 24 },
        ],
        10,
      );
      results['LC1'] = {
        score: lc1Score,
        status: nearestTransit <= 2500,
        value: round(nearestTransit / 1000, 2),
      };
    }

    let lc2Score = 0;
    if (centroidRoadDistance != null) {
      lc2Score = scoreByDistance(
        centroidRoadDistance,
        [
          { maxMeters: 15, score: 50 },
          { maxMeters: 30, score: 42 },
          { maxMeters: 60, score: 32 },
          { maxMeters: 120, score: 20 },
        ],
        8,
      );
      results['LC2'] = {
        score: lc2Score,
        status: centroidRoadDistance <= 60,
        value: centroidRoadDistance,
      };
    }

    const amenityScore = Math.min(
      60,
      nearbySchoolCount * 8 +
        nearbyHospitalCount * 14 +
        nearbyParkCount * 8 +
        (nearbySchoolCount > 0 && nearbyHospitalCount > 0 && nearbyParkCount > 0 ? 8 : 0),
    );
    if (amenityScore > 0) {
      results['LC3'] = {
        score: amenityScore,
        status: amenityScore >= 32,
        value: {
          schools: nearbySchoolCount,
          hospitals: nearbyHospitalCount,
          parks: nearbyParkCount,
        },
      };
    }

    const frontageSignalScore =
      (boundaryCoverageRatio >= 0.45 ? 22 : boundaryCoverageRatio >= 0.25 ? 16 : boundaryCoverageRatio > 0 ? 10 : 0) +
      roadAccessSideScore +
      (roadWidth != null ? (roadWidth >= 18 ? 10 : roadWidth >= 12 ? 8 : roadWidth >= 9 ? 6 : roadWidth >= 6 ? 4 : 2) : 0) +
      (frontageWidth != null
        ? frontageWidth >= 18
          ? 8
          : frontageWidth >= 12
            ? 6
            : frontageWidth >= 9
              ? 4
              : frontageWidth >= 6
                ? 2
                : 1
        : 0);
    if (frontageSignalScore > 0) {
      results['LC4'] = {
        score: Math.min(40, frontageSignalScore),
        status: frontageSignalScore >= 22,
        value: {
          boundaryCoverageRatio: round(boundaryCoverageRatio, 2),
          roadAccessSides,
          roadWidth,
          frontageWidth,
        },
      };
    }

    let lc5Score = 0;
    if (nearestAirport != null) {
      lc5Score =
        nearestAirport < 5000
          ? 12
          : scoreByDistance(
              nearestAirport,
              [
                { maxMeters: 10000, score: 24 },
                { maxMeters: 25000, score: 40 },
                { maxMeters: 40000, score: 30 },
                { maxMeters: 60000, score: 20 },
              ],
              10,
            );
      results['LC5'] = {
        score: lc5Score,
        status:
          nearestAirport >= AIRPORT_DISTANCE_OPTIMAL_RANGE[0] &&
          nearestAirport <= AIRPORT_DISTANCE_OPTIMAL_RANGE[1],
        value: round(nearestAirport / 1000, 2),
      };
    }

    // GP1 is currently derived from transit, road, and airport access.
    // This is much better than the old satellite proxy, but it still is not a full
    // infrastructure-opportunity model with utilities/logistics/travel-time layers.
    if (lc1Score || lc2Score || lc5Score) {
      const normalizedTransit = (lc1Score / 60) * 30;
      const normalizedRoad = (lc2Score / 50) * 30;
      const normalizedAirport = (lc5Score / 40) * 20;
      const gp1Score = Math.round(normalizedTransit + normalizedRoad + normalizedAirport);

      results['GP1'] = {
        score: Math.min(80, gp1Score),
        status: gp1Score >= 48,
      };
    }

    // GP2 remains a broad FDI proxy until we ingest actual corridor/growth-zone geodata.
    if (fdi.length > 0) {
      const totalFDI = fdi.reduce((sum, record) => sum + record.amountUsdMillions, 0);
      results['GP2'] = {
        score: totalFDI > 1000 ? 60 : totalFDI > 500 ? 45 : totalFDI > 100 ? 30 : 15,
        status: totalFDI > 100,
        value: totalFDI,
      };
    }

    // GP3 still uses area-level satellite change, not parcel-specific historical land-cover change.
    if (satellite) {
      results['GP3'] = {
        score: Math.min(80, Math.round(satellite.builtUpChange5yr * 3.2)),
        status: satellite.builtUpChange5yr > 10,
        value: satellite.builtUpChange5yr,
      };
    }

    // GP4 still depends on coarse Census-style growth signals, not fresh micro-market population data.
    if (census.length > 0) {
      const avgGrowth = census.reduce((sum, record) => sum + record.decadalGrowthRate, 0) / census.length;
      results['GP4'] = {
        score: avgGrowth > 20 ? 40 : avgGrowth > 15 ? 30 : avgGrowth > 10 ? 20 : 10,
        status: avgGrowth > 10,
        value: round(avgGrowth, 1),
      };
    }

    // GP5 uses a lightweight public-source parser for now.
    // This is intentionally treated as a signal, not a fully authoritative planned-infra dataset.
    if (proposedInfra.available) {
      results['GP5'] = {
        score:
          proposedInfra.count >= 4
            ? 40
            : proposedInfra.count >= 2
              ? 28
              : 18,
        status: proposedInfra.count >= 2,
        value: {
          count: proposedInfra.count,
          source: proposedInfra.source,
          snippets: proposedInfra.snippets,
        },
      };
    }

    if (regulation) {
      if (regulationPermitsUse) {
        results['LR1'] = { score: 80, status: true };
      } else {
        results['LR1'] = { score: 0, status: false };
      }

      if (regulationPermitsUse) {
        results['LR2'] = { score: 50, status: true };
      } else if (cluPossible) {
        results['LR2'] = { score: 30, status: true };
      } else {
        results['LR2'] = { score: 0, status: false };
      }
    }

    // LR3 remains intentionally unscored until we have a reliable legal-risk source.
    results['LR3'] = undefined;
    const reraRegistration = underwriting?.approvals?.reraRegistration?.trim();
    if (reraRegistration) {
      results['LR4'] = {
        score: reraRegistration.toLowerCase() !== 'pending' ? 30 : 10,
        status: reraRegistration.toLowerCase() !== 'pending',
        value: reraRegistration,
      };
    }
    // LR5 is deferred until master-plan extraction is wired into the score flow.
    results['LR5'] = undefined;
    // ME1 stays blank until we have historical price-trend data by locality/micro-market.
    results['ME1'] = undefined;

    if (nearestOperationalSez) {
      const distanceKm = round(nearestOperationalSez.distanceMeters / 1000, 2);
      results['ME2'] = {
        score: scoreByDistance(
          nearestOperationalSez.distanceMeters,
          [
            { maxMeters: 5000, score: 40 },
            { maxMeters: 15000, score: 32 },
            { maxMeters: 30000, score: 24 },
            { maxMeters: 60000, score: 16 },
          ],
          8,
        ),
        status: nearestOperationalSez.distanceMeters <= 30000,
        value: {
          name: nearestOperationalSez.name,
          district: nearestOperationalSez.district,
          sector: nearestOperationalSez.sector,
          distanceKm,
          source: nearestOperationalSez.source,
        },
      };
    } else if (sez.length > 0) {
      // Fallback when SEZ names exist but cannot be reliably geocoded.
      // This is weaker than parcel-distance scoring, but better than dropping ME2 entirely.
      const operationalSEZ = sez.filter((entry) => entry.status === 'Operational').length;
      results['ME2'] = {
        score: operationalSEZ > 5 ? 24 : operationalSEZ > 2 ? 18 : operationalSEZ > 0 ? 12 : 5,
        status: operationalSEZ > 0,
        value: {
          count: operationalSEZ,
          source: 'State-level SEZ availability fallback',
        },
      };
    }

    const competitorAbsorptionRates = (underwriting?.competitors || [])
      .map((competitor) => parseAbsorptionRate(competitor.absorptionRate))
      .filter((rate): rate is number => rate != null);
    const averageCompetitorAbsorption =
      competitorAbsorptionRates.length > 0
        ? competitorAbsorptionRates.reduce((sum, rate) => sum + rate, 0) / competitorAbsorptionRates.length
        : null;
    const marketAbsorptionSignal = absorptionRate ?? averageCompetitorAbsorption;

    // ME3 is still only as good as the admin assumptions / competitor underwriting we have.
    // It is not yet a market-wide absorption feed.
    if (marketAbsorptionSignal != null) {
      results['ME3'] = {
        score:
          marketAbsorptionSignal >= 25
            ? 50
            : marketAbsorptionSignal >= 18
              ? 38
              : marketAbsorptionSignal >= 12
                ? 26
                : 14,
        status: marketAbsorptionSignal >= 18,
        value: round(marketAbsorptionSignal, 1),
      };
    }

    // ME4 is still a density-only proxy today because supply/inventory/pipeline data is missing.
    if (census.length > 0) {
      const avgDensity = census.reduce((sum, record) => sum + record.populationDensity, 0) / census.length;
      results['ME4'] = {
        score: avgDensity > 10000 ? 50 : avgDensity > 5000 ? 35 : avgDensity > 1000 ? 20 : 10,
        status: avgDensity > 5000,
        value: round(avgDensity, 0),
      };
    }

    const engineOutput = evaluateDevelopability(results);
    const developabilityScore = toDevelopabilityScore(engineOutput, results);

    const { plotGeometry: _omittedPlotGeometry, ...responseQuery } = query;

    return NextResponse.json({
      success: true,
      query: responseQuery,
      score: developabilityScore,
      dataSources: {
        census: { count: census.length, available: census.length > 0 },
        fdi: { count: fdi.length, available: fdi.length > 0 },
        sez: { count: sez.length, available: sez.length > 0 },
        satellite: { available: satellite !== null, isMock: EarthEngineService.isMockMode() },
        regulation: { available: regulation !== null },
        googlePlaces: {
          count:
            storedAmenities.length +
            transitPlaces.length +
            schools.length +
            hospitals.length +
            parks.length +
            airports.length,
          available:
            transitPlaces.length +
              schools.length +
              hospitals.length +
              parks.length +
              airports.length >
            0,
        },
        googleRoads: {
          count: snappedRoads.length,
          available: snappedRoads.length > 0,
        },
        proposedInfrastructure: {
          count: proposedInfra.count,
          available: proposedInfra.available,
        },
      },
    });
  } catch (error: any) {
    console.error('[Land Intel] Score computation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to compute developability score' },
      { status: 500 },
    );
  }
}
