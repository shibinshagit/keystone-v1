import { NextRequest, NextResponse } from 'next/server';
import { DataGovService } from '@/services/land-intelligence/data-gov-service';
import { EarthEngineService } from '@/services/land-intelligence/earth-engine-service';
import { EnvironmentalService } from '@/services/land-intelligence/environmental-service';
import { GoogleMapsServerService } from '@/services/land-intelligence/google-maps-server-service';
import { PopulationMigrationService } from '@/services/land-intelligence/population-migration-service';
import { ProposedInfraService } from '@/services/land-intelligence/proposed-infra-service';
import { TransportationService } from '@/services/land-intelligence/transportation-service';
import { lookupRegulationForLocationAndUse } from '@/lib/regulation-lookup-server';
import { getUSScoreInputs, isUSCoordinates } from '@/services/us/us-score-data-service';
import { evaluateDevelopability, toDevelopabilityScore } from '@/lib/scoring/developability-engine';
import type { ItemResult } from '@/lib/scoring/schema-engine';
import type { EnvironmentalScreeningReport } from '@/lib/land-intelligence/environmental';
import type { TransportationScreeningReport } from '@/lib/land-intelligence/transportation';
import type {
  CensusData,
  LandIntelligenceQuery,
  PopulationMigrationAnalysis,
  RegulationData,
  SEZData,
  SatelliteChangeData,
  TerrainIntelligenceData,
} from '@/lib/types';

type Coordinates = [number, number];

interface AmenityRecord {
  id?: string | number;
  category?: string;
  name?: string;
  distance?: number;
  distanceMeters?: number;
}

interface NearbyAmenitySummaryItem {
  label: string;
  count: number;
  nearestDistanceMeters: number | null;
  sampleNames: string[];
}

interface PopulationMigrationResponse extends PopulationMigrationAnalysis {}

const DEFAULT_COORDS: Coordinates = [77.209, 28.6139];
const EMPTY_PROPOSED_INFRA_SIGNAL = {
  available: false,
  count: 0,
  source: 'MoSPI PAIMANA Public Dashboard',
  snippets: [],
};
const TRANSIT_PLACE_TYPES = ['bus_station', 'train_station', 'subway_station'];
const SCHOOL_PLACE_TYPES = ['school', 'primary_school', 'secondary_school', 'university'];
const MALL_PLACE_TYPES = ['shopping_mall', 'department_store'];
const AIRPORT_DISTANCE_OPTIMAL_RANGE: [number, number] = [0, 40000];

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
function regulationAllowsUse(
  regulation: RegulationData | null,
  options?: { intendedUse?: string; parcelAware?: boolean },
) {
  if (!regulation || !options?.intendedUse) return !!options?.parcelAware;

  const intended = normalizeText(options.intendedUse);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

function buildNearbyAmenitySummaryItem(
  label: string,
  liveAmenities: Array<{ name: string; distanceMeters: number }>,
): NearbyAmenitySummaryItem {
  const sortedAmenities = [...liveAmenities].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );

  return {
    label,
    count: sortedAmenities.length,
    nearestDistanceMeters:
      sortedAmenities.length > 0 ? sortedAmenities[0].distanceMeters : null,
    sampleNames: sortedAmenities
      .slice(0, 3)
      .map((amenity) => amenity.name)
      .filter(Boolean),
  };
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
    const storedAmenities: AmenityRecord[] = Array.isArray(query.locationAmenities) ? query.locationAmenities : [];
    const roadAccessSides = Array.isArray(query.roadAccessSides)
      ? query.roadAccessSides.filter((side): side is string => typeof side === 'string' && side.length > 0)
      : [];

    const isUS = isUSCoordinates(coords[0], coords[1]);
    console.log(`[Land Intel] Computing Developability Score for ${state}${district ? ` / ${district}` : ''} [${isUS ? 'US' : 'Global'}]`);

    // The US data services expect "City, State" to properly map to Census/BLS FIPS codes.
    // In our payload, query.location is usually the State and query.district is the City.
    // However, we now pass query.rawLocation to preserve the original unmodified search string (like "Parcel X, Austin, Texas").
    const fullUSLocation = query.rawLocation || (district ? `${district}, ${state}` : state);

    const usScoreInputsPromise = isUS ? getUSScoreInputs(fullUSLocation) : Promise.resolve(null);
    // Fetch US parcel data inline ONLY if a parcel-aware request is made (drawn plot or clicked point)
    const usParcelPromise = (isUS && query.parcelAware)
      ? import('@/services/us/us-parcel-service').then(m => m.USParcelService.getParcelData(fullUSLocation, Number(query.landSizeSqm) || 1000, coords)).catch(() => null)
      : Promise.resolve(null);
    // Fetch expanded US environmental data (FEMA flood, EPA EJScreen, Historic Places)
    const usEnvironmentalPromise = isUS
      ? import('@/services/us/us-environmental-service').then(m => m.USEnvironmentalService.getEnvironmentalData(coords)).catch(() => null)
      : Promise.resolve(null);

    // AI Summary is intentionally excluded from this response to keep latency low.
    // The frontend calls /api/land-intelligence/ai-summary separately after the score loads.
    const usAiSummaryPromise = Promise.resolve(null);

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
      terrainData,
      regulationData,
      transitData,
      schoolData,
      hospitalData,
      mallData,
      parkData,
      airportData,
      roadSnapData,
      proposedInfraData,
      environmentalScreeningData,
    ] = await Promise.allSettled([
      DataGovService.getCensusData(state, district),
      DataGovService.getFDIData(state),
      DataGovService.getSEZData(state),
      EarthEngineService.getUrbanGrowthIndex(coords, district || state),
      EarthEngineService.getTerrainIntelligence(coords, {
        plotGeometry: query.plotGeometry,
        location: district || state,
      }),
      lookupRegulationForLocationAndUse({
        location: district ? `${district}, ${state}` : state,
        intendedUse: query.intendedUse || 'Residential',
        market: query.market,
        coordinates: coords,
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
        includedTypes: MALL_PLACE_TYPES,
        radius: 5000,
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
      isUS
        ? EnvironmentalService.getEnvironmentalScreening({
            coordinates: coords,
            location: district ? `${district}, ${state}` : state,
            market: query.market || 'USA',
            countryCode: query.countryCode || 'US',
          })
        : Promise.resolve(null),
    ]);

    // Several current reference datasets are still partial-coverage inside the project.
    // When a state/city is missing here, those score items stay empty or fall back gracefully.
    const census: CensusData[] = censusData.status === 'fulfilled' ? censusData.value : [];
    const fdi = fdiData.status === 'fulfilled' ? fdiData.value : [];
    const sez: SEZData[] = sezData.status === 'fulfilled' ? sezData.value : [];
    const satellite: SatelliteChangeData | null = satelliteData.status === 'fulfilled' ? satelliteData.value : null;
    const terrain: TerrainIntelligenceData | null = terrainData.status === 'fulfilled' ? terrainData.value : null;
    const terrainIsMock = terrain?.source?.toLowerCase().includes('mock') ?? EarthEngineService.isMockMode();
    const regulation = regulationData.status === 'fulfilled' ? regulationData.value.regulation : null;
    const transitPlaces = transitData.status === 'fulfilled' ? transitData.value : [];
    const schools = schoolData.status === 'fulfilled' ? schoolData.value : [];
    const hospitals = hospitalData.status === 'fulfilled' ? hospitalData.value : [];
    const malls = mallData.status === 'fulfilled' ? mallData.value : [];
    const parks = parkData.status === 'fulfilled' ? parkData.value : [];
    const airports = airportData.status === 'fulfilled' ? airportData.value : [];
    const snappedRoads = roadSnapData.status === 'fulfilled' ? roadSnapData.value : [];
    const proposedInfra =
      proposedInfraData.status === 'fulfilled'
        ? proposedInfraData.value
        : EMPTY_PROPOSED_INFRA_SIGNAL;
    const environmentalScreening: EnvironmentalScreeningReport | null =
      environmentalScreeningData.status === 'fulfilled'
        ? environmentalScreeningData.value
        : null;
    let transportationScreening: TransportationScreeningReport | null = null;

    const usAiSummary = await usAiSummaryPromise;

    const usInputs = await usScoreInputsPromise;
    const usParcel = await usParcelPromise;
    const usEnvironmental = await usEnvironmentalPromise;

    // Compute buyability score server-side (no AI needed) from parcel + market data
    let usBuyabilityScore: number | null = null;
    let usDevelopmentProspect: string | null = null;
    if (isUS && usInputs) {
      let score = 0;
      
      // Economy contribution (0-30)
      const unemp = usInputs.economicHealthValue.unemploymentRate;
      score += unemp <= 3.5 ? 15 : unemp <= 5.0 ? 12 : unemp < 7.0 ? 8 : 4;
      
      const income = usInputs.economicHealthValue.medianIncome;
      score += income >= 100000 ? 15 : income >= 75000 ? 12 : income > 50000 ? 8 : 4;

      // Population contribution (0-30)
      const pop = usInputs.populationGrowthValue.population;
      score += pop > 1000000 ? 15 : pop >= 500000 ? 12 : pop > 100000 ? 8 : 4;
      
      const tier = (usInputs.populationGrowthValue.growthTier || '').toLowerCase();
      score += (tier.includes('high') || tier.includes('major') || tier.includes('strong')) ? 15 : (tier.includes('mod') || tier.includes('stable') || tier.includes('emerging')) ? 10 : 5;

      // Permits / Market contribution (0-20)
      const permits = usInputs.permitActivityValue.totalUnits;
      score += permits > 10000 ? 20 : permits > 5000 ? 15 : permits > 1000 ? 10 : 5;

      // Parcel specific readiness (0-20)
      if (usParcel) {
        if (usParcel.zoning?.zoningCode && usParcel.zoning.zoningCode !== 'Unknown') score += 8;
        if (usParcel.title?.assessedValue && usParcel.title.assessedValue > 0) score += 4;
        const hasLien = usParcel.encumbrances?.some(e => e.type?.toLowerCase().includes('lien') || e.status?.toLowerCase().includes('dispute'));
        if (!hasLien) score += 8;
      } else {
        // General location search gets generic points
        score += 10;
      }

      usBuyabilityScore = Math.min(100, Math.max(0, score));
      usDevelopmentProspect = usBuyabilityScore >= 80 ? 'Excellent' : usBuyabilityScore >= 65 ? 'Good' : usBuyabilityScore >= 45 ? 'Moderate' : 'Risky';
    }

    const underwriting = query.underwriting;

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
    const nearbyMallCount = countUniqueNearbyAmenities(
      storedAmenities,
      (amenity) =>
        amenity.category === 'mall' ||
        amenity.category === 'shopping' ||
        String(amenity.name || '').toLowerCase().includes('mall'),
      4000,
      malls,
      'stored-mall',
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
    const regulationPermitsUse = regulationAllowsUse(regulation, { intendedUse: query.intendedUse, parcelAware: query.parcelAware });
    const cluPossible = canPotentiallyConvert(regulation);
    const nearestOperationalSez = await getNearestOperationalSez(coords, sez);
    const populationMigration = PopulationMigrationService.analyze({
      state,
      district,
      censusRecords: census,
      satellite,
      fdi,
      sez,
      nearestOperationalSezDistanceMeters: nearestOperationalSez?.distanceMeters ?? null,
      proposedInfrastructure: proposedInfra,
    });
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
        nearbyMallCount * 8 +
        nearbyParkCount * 8 +
        (nearbySchoolCount > 0 && nearbyHospitalCount > 0 && nearbyMallCount > 0 ? 8 : 0),
    );
    if (amenityScore > 0) {
      results['LC3'] = {
        score: amenityScore,
        status: amenityScore >= 32,
        value: {
          schools: nearbySchoolCount,
          hospitals: nearbyHospitalCount,
          malls: nearbyMallCount,
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
    if (query.market === 'USA' || query.countryCode === 'US') {
      try {
        transportationScreening =
          await TransportationService.getTransportationScreening({
            coordinates: coords,
            location: district ? `${district}, ${state}` : state,
            market: query.market,
            countryCode: query.countryCode,
            roadAccessSides,
            landSizeSqm: query.landSizeSqm,
            intendedUse: query.intendedUse,
            nearestTransitDistanceMeters: nearestTransit,
            transitCountWithin5Km: transitPlaces.length,
            transitSampleNames: transitPlaces.map((place) => place.name).slice(0, 5),
            centroidRoadDistanceMeters: centroidRoadDistance,
            boundaryRoadCoverageRatio: round(boundaryCoverageRatio, 2),
            roadWidthMeters: roadWidth,
            frontageWidthMeters: frontageWidth,
          });
      } catch (error) {
        console.warn('[LandIntel] Transportation fetch issue:', error);
      }
    }

    const transportationAccessPenalty =
      transportationScreening?.accessManagement.status === 'high'
        ? 8
        : transportationScreening?.accessManagement.status === 'moderate'
          ? 4
          : 0;
    if (frontageSignalScore > 0) {
      results['LC4'] = {
        score: Math.max(6, Math.min(40, frontageSignalScore - transportationAccessPenalty)),
        status:
          frontageSignalScore - transportationAccessPenalty >= 22 &&
          transportationScreening?.accessManagement.status !== 'high',
        value: {
          boundaryCoverageRatio: round(boundaryCoverageRatio, 2),
          roadAccessSides,
          roadWidth,
          frontageWidth,
          tiaLikelihood: transportationScreening?.tia.likelihood,
          accessRisk: transportationScreening?.accessManagement.status,
          nearbyWorkZones: transportationScreening?.nearbyWorkZones.countWithin1Km,
        },
      };
    }

    let lc5Score = 0;
    if (nearestAirport != null) {
      lc5Score = scoreByDistance(
        nearestAirport,
        [
          { maxMeters: 10000, score: 40 },
          { maxMeters: 25000, score: 30 },
          { maxMeters: 40000, score: 20 },
          { maxMeters: 60000, score: 10 },
        ],
        5,
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

    if (isUS && usInputs) {
      results['GP2'] = {
        score: usInputs.economicHealthScore,
        status: usInputs.economicHealthValue.unemploymentRate < 5,
        value: usInputs.economicHealthValue,
      };
    } else if (fdi.length > 0) {
      const totalFDI = fdi.reduce((sum, record) => sum + record.amountUsdMillions, 0);
      results['GP2'] = {
        score: totalFDI > 1000 ? 60 : totalFDI > 500 ? 45 : totalFDI > 100 ? 30 : 15,
        status: totalFDI > 100,
        value: totalFDI,
      };
    }

    // GP3 — Satellite NDVI (works globally via Earth Engine)
    if (satellite) {
      results['GP3'] = {
        score: Math.min(80, Math.round(satellite.builtUpChange5yr * 3.2)),
        status: satellite.builtUpChange5yr > 10,
        value: satellite.builtUpChange5yr,
      };
    }

    // GP4 — US: Population size/growth tier (Census ACS) / India: Census 2011 migration
    if (isUS && usInputs) {
      results['GP4'] = {
        score: usInputs.populationGrowthScore,
        status: usInputs.populationGrowthValue.population > 200_000,
        value: usInputs.populationGrowthValue,
      };
    } else if (populationMigration) {
      const annualGrowth = populationMigration.projectedAnnualGrowthRate2011To2025;
      const confidenceMultiplier = 0.85 + populationMigration.confidence * 0.15;
      const rawGp4Score =
        annualGrowth >= 2.8
          ? 40
          : annualGrowth >= 2
            ? 34
            : annualGrowth >= 1.2
              ? 26
              : annualGrowth >= 0.5
                ? 18
                : annualGrowth >= 0
                  ? 10
                  : 4;
      results['GP4'] = {
        score: Math.round(rawGp4Score * confidenceMultiplier),
        status: populationMigration.migrationDirection !== 'outward',
        value: populationMigration,
      };
    }

    // GP5 — US: Building permit activity (Census BPS) / India: MoSPI proposed infra
    if (isUS && usInputs) {
      results['GP5'] = {
        score: usInputs.permitActivityScore,
        status: usInputs.permitActivityValue.totalUnits > 5000,
        value: {
          count: usInputs.permitActivityValue.totalUnits,
          source: 'US Census Bureau Building Permits Survey',
          permits: usInputs.permitActivityValue,
        },
      };
    } else if (proposedInfra.available) {
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

    if (isUS && usParcel) {
      // LR1 — Zoning compliance: US parcel has a zoning code
      const hasZoning = !!usParcel.zoning?.zoningCode;
      results['LR1'] = {
        score: hasZoning ? 80 : 0,
        status: hasZoning,
        value: usParcel.zoning,
      };

      // LR2 — CLU feasibility: Based on zoning description matching intended use
      const zoningDesc = (usParcel.zoning?.zoningDescription || '').toLowerCase();
      const intendedUse = (query.intendedUse || '').toLowerCase();
      const zoningAligns = 
        (intendedUse.includes('residential') && (zoningDesc.includes('residential') || zoningDesc.includes('mixed'))) ||
        (intendedUse.includes('commercial') && (zoningDesc.includes('commercial') || zoningDesc.includes('mixed') || zoningDesc.includes('business'))) ||
        (intendedUse.includes('industrial') && (zoningDesc.includes('industrial') || zoningDesc.includes('manufacturing'))) ||
        zoningDesc.includes('mixed');
      results['LR2'] = {
        score: zoningAligns ? 50 : 20,
        status: zoningAligns,
        value: { zoningCode: usParcel.zoning?.zoningCode, intendedUse: query.intendedUse, compatible: zoningAligns },
      };

      // LR3 — Encumbrances / legal flags
      const encCount = usParcel.encumbrances?.length ?? 0;
      const hasLien = usParcel.encumbrances?.some(e => e.type?.toLowerCase().includes('lien'));
      results['LR3'] = {
        score: encCount === 0 ? 60 : hasLien ? 15 : 35,
        status: !hasLien,
        value: { encumbrances: usParcel.encumbrances, count: encCount },
      };

      // LR4 — Title / ownership status (assessed value > 0 = clear title signal)
      const hasTitle = usParcel.title && usParcel.title.assessedValue > 0;
      results['LR4'] = {
        score: hasTitle ? 30 : 10,
        status: !!hasTitle,
        value: usParcel.title,
      };

      // LR5 — ALTA survey / flood zone
      const altaAvailable = usParcel.altaSurveyAvailable;
      const floodZone = usParcel.zoning?.floodZone || 'Unknown';
      const safeFoodZone = floodZone === 'X' || floodZone === 'X500' || floodZone === 'B' || floodZone === 'C';
      results['LR5'] = {
        score: (altaAvailable ? 15 : 5) + (safeFoodZone ? 15 : 5),
        status: altaAvailable && safeFoodZone,
        value: { altaSurveyAvailable: altaAvailable, floodZone },
      };
    } else if (isUS && !usParcel) {
      // US city-level search: parcel-dependent legal checks should stay pending
      // until the user draws or clicks a parcel with title/zoning/survey detail.
      results['LR1'] = undefined;
      results['LR2'] = undefined;
      results['LR3'] = undefined;
      results['LR4'] = undefined;
      results['LR5'] = undefined;
    } else if (regulation) {
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

    if (!isUS) {
      // LR3 remains intentionally unscored until we have a reliable legal-risk source.
      results['LR3'] = undefined;
    }
    const reraRegistration = underwriting?.approvals?.reraRegistration?.trim();
    if (!isUS && reraRegistration) {
      results['LR4'] = {
        score: reraRegistration.toLowerCase() !== 'pending' ? 30 : 10,
        status: reraRegistration.toLowerCase() !== 'pending',
        value: reraRegistration,
      };
    }
    if (!isUS) {
      // LR5 is deferred until master-plan extraction is wired into the score flow.
      results['LR5'] = undefined;
    }
    // ME1 stays blank until we have historical price-trend data by locality/micro-market.
    results['ME1'] = undefined;

    // ME2 — US: Market zone / permit growth tier / India: SEZ distance
    if (isUS && usInputs) {
      results['ME2'] = {
        score: usInputs.marketZoneScore,
        status: usInputs.marketZoneValue.tier !== 'Tier 3',
        value: usInputs.marketZoneValue,
      };
    } else if (nearestOperationalSez) {
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

    // ME3 — US: building permit absorption rate / India: admin underwriting assumptions
    if (isUS && usInputs) {
      results['ME3'] = {
        score: usInputs.absorptionScore,
        status: usInputs.absorptionValue > 6,
        value: usInputs.absorptionValue,
      };
    } else if (marketAbsorptionSignal != null) {
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

    // ME4 — US: demand density (population + income tier) / India: Census population density
    if (isUS && usInputs) {
      results['ME4'] = {
        score: usInputs.demandDensityScore,
        status: usInputs.demandDensityValue.tier !== 'Emerging',
        value: usInputs.demandDensityValue,
      };
    } else if (populationMigration) {
      const projectedDensity = populationMigration.projectedDensity2025;
      const annualGrowth = populationMigration.projectedAnnualGrowthRate2011To2025;
      const migrationBoost =
        populationMigration.migrationDirection === 'inward'
          ? 6
          : populationMigration.migrationDirection === 'balanced'
            ? 2
            : -4;
      let me4Score =
        projectedDensity > 12000
          ? 42
          : projectedDensity > 7000
            ? 34
            : projectedDensity > 3000
              ? 24
              : 14;
      if (annualGrowth >= 2) me4Score += 8;
      else if (annualGrowth >= 1) me4Score += 4;
      me4Score += migrationBoost;
      results['ME4'] = {
        score: clamp(me4Score, 6, 50),
        status: populationMigration.migrationDirection !== 'outward' && projectedDensity > 3000,
        value: populationMigration,
      };
    }

    const engineOutput = evaluateDevelopability(results);
    const developabilityScore = toDevelopabilityScore(engineOutput, results);
    const nearbyAmenities = {
      transit: buildNearbyAmenitySummaryItem('Metro / Transit', transitPlaces),
      schools: buildNearbyAmenitySummaryItem('Schools', schools),
      hospitals: buildNearbyAmenitySummaryItem('Hospitals', hospitals),
      malls: buildNearbyAmenitySummaryItem('Malls', malls),
    };

    const { plotGeometry: _omittedPlotGeometry, ...responseQuery } = query;

    return NextResponse.json({
      success: true,
      query: responseQuery,
      score: developabilityScore,
      isUS,
      usMarketData: isUS && usInputs ? {
        city: usInputs.resolvedCity,
        state: usInputs.resolvedState,
        economy: usInputs.economicHealthValue,
        population: usInputs.populationGrowthValue,
        permits: usInputs.permitActivityValue,
        marketZone: usInputs.marketZoneValue,
        absorptionRate: usInputs.absorptionValue,
        demandDensity: usInputs.demandDensityValue,
        buyabilityScore: usBuyabilityScore,
        developmentProspect: usDevelopmentProspect,
        parcel: usParcel ? {
          parcelId: usParcel.parcelId,
          zoning: usParcel.zoning,
          title: usParcel.title,
          encumbrances: usParcel.encumbrances,
          source: usParcel.source,
          address: usParcel.address,
          lotAreaSqFt: usParcel.lotAreaSqFt,
        } : null,
        environmental: usEnvironmental ? {
          elevationMeters: usEnvironmental.elevationMeters,
          floodZone: usEnvironmental.floodZone,
          ejscreen: usEnvironmental.ejscreen,
          historicDistrict: usEnvironmental.historicDistrict,
        } : null,
        aiSummary: usAiSummary,
      } : null,
      terrain,
      environmentalScreening,
      transportationScreening,
      populationMigration: (!isUS ? populationMigration : null) as PopulationMigrationResponse | null,
      nearbyAmenities,
      dataSources: {
        census: isUS
          ? { count: 1, available: usInputs !== null, source: 'US Census ACS 5-Year' }
          : { count: census.length, available: census.length > 0 },
        populationMigration: { count: populationMigration ? populationMigration.timeSeries.length : 0, available: !isUS && populationMigration !== null },
        fdi: isUS
          ? { count: 0, available: false }
          : { count: fdi.length, available: fdi.length > 0 },
        sez: isUS
          ? { count: 0, available: false }
          : { count: sez.length, available: sez.length > 0 },
        usEconomy: isUS ? { available: usInputs !== null, source: 'Bureau of Labor Statistics' } : undefined,
        usPermits: isUS ? { available: usInputs !== null, source: 'US Census BPS' } : undefined,
        usProperty: isUS ? {
          available: usParcel !== null,
          source: usParcel?.source === 'realie' ? 'Realie Property Data API' : usParcel?.source || 'Unavailable',
        } : undefined,
        usEnvironmental: isUS ? {
          available: usEnvironmental !== null,
          femaFlood: usEnvironmental?.floodZone?.source === 'fema-nfhl',
          epaEjscreen: usEnvironmental?.ejscreen?.source === 'epa-ejscreen',
          historicPlaces: usEnvironmental?.historicDistrict?.source === 'nps-api',
          source: 'FEMA NFHL + EPA EJScreen + NPS NRHP',
        } : undefined,
        satellite: { available: satellite !== null, isMock: EarthEngineService.isMockMode() },
        terrain: {
          available: terrain !== null,
          isMock: terrainIsMock,
          source: terrain?.source || terrain?.dataset || 'USGS/SRTMGL1_003',
        },
        regulation: {
          available: regulation !== null,
          source: regulation?.sourceInfo?.label || undefined,
        },
        googlePlaces: {
          count:
            storedAmenities.length +
            transitPlaces.length +
            schools.length +
            hospitals.length +
            malls.length +
            parks.length +
            airports.length,
          available:
            transitPlaces.length +
              schools.length +
              hospitals.length +
              malls.length +
              parks.length +
              airports.length >
            0,
        },
        googleRoads: {
          count: snappedRoads.length,
          available: snappedRoads.length > 0,
        },
        proposedInfrastructure: isUS
          ? { count: usInputs?.permitActivityValue.totalUnits ?? 0, available: usInputs !== null, source: 'US Census BPS' }
          : { count: proposedInfra.count, available: proposedInfra.available },
        environmental: {
          count: environmentalScreening
            ? environmentalScreening.airQuality.facilityCount +
              environmentalScreening.waterQuality.facilityCount
            : 0,
          available: environmentalScreening !== null,
        },
        transportation: {
          count: transportationScreening?.nearbyWorkZones.countWithin5Km || 0,
          available: transportationScreening !== null,
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
