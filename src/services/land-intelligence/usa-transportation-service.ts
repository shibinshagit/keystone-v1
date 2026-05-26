import { GoogleMapsServerService } from "@/services/land-intelligence/google-maps-server-service";
import {
  evaluateTransportationHeuristics,
  resolveUsaTransportationContext,
  type TransportationHeuristicInput,
  type TransportationRiskLevel,
  type TransportationScreeningReport,
  type TransportationWorkZone,
  type UsaTransportationContext,
} from "@/lib/land-intelligence/transportation";

const WZDX_REGISTRY_URL = "https://data.transportation.gov/resource/69qe-yiui.json";
const REGISTRY_CACHE_TTL_MS = 30 * 60 * 1000;
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const NEARBY_RADIUS_METERS = 5000;

type WzdxRegistryRecord = {
  state?: string;
  issuingorganization?: string;
  feedname?: string;
  url?: { url?: string };
  active?: boolean;
  needapikey?: boolean;
};

type GeoJsonLike = {
  type?: string;
  features?: WzdxFeatureLike[];
};

type WzdxFeatureLike = {
  id?: string | number;
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, any>;
};

const registryCache = new Map<
  string,
  { expiresAt: number; data: WzdxRegistryRecord[] }
>();
const feedCache = new Map<string, { expiresAt: number; data: GeoJsonLike | null }>();

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function getRegistryEntries(stateName: string) {
  const key = normalizeText(stateName);
  const now = Date.now();
  const cached = registryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const url = `${WZDX_REGISTRY_URL}?state=${encodeURIComponent(key)}&active=true`;
  const data = await fetchJson<WzdxRegistryRecord[]>(url);
  registryCache.set(key, {
    expiresAt: now + REGISTRY_CACHE_TTL_MS,
    data,
  });
  return data;
}

function pickRegistryEntry(
  entries: WzdxRegistryRecord[],
  context: UsaTransportationContext,
) {
  for (const preference of context.registryIssuerPreferences) {
    const match = entries.find((entry) =>
      normalizeText(entry.issuingorganization).includes(normalizeText(preference)),
    );
    if (match) return match;
  }

  return (
    entries.find((entry) => !entry.needapikey && entry.url?.url) ||
    entries.find((entry) => entry.url?.url) ||
    null
  );
}

async function getFeedPayload(url: string) {
  const now = Date.now();
  const cached = feedCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const payload = await fetchJson<GeoJsonLike>(url);
  feedCache.set(url, {
    expiresAt: now + FEED_CACHE_TTL_MS,
    data: payload,
  });
  return payload;
}

function extractCoordinatePairs(value: unknown, target: Array<[number, number]>) {
  if (!Array.isArray(value)) return;

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    target.push([value[0], value[1]]);
    return;
  }

  for (const child of value) {
    extractCoordinatePairs(child, target);
  }
}

function getNearestCoordinateDistanceMeters(
  coordinates: [number, number],
  feature: WzdxFeatureLike,
) {
  const pairs: Array<[number, number]> = [];
  extractCoordinatePairs(feature.geometry?.coordinates, pairs);

  if (pairs.length === 0) return null;

  return pairs.reduce<number | null>((nearest, [lng, lat]) => {
    const distance = Math.round(
      GoogleMapsServerService.calculateDistanceInMeters(
        coordinates[1],
        coordinates[0],
        lat,
        lng,
      ),
    );
    if (nearest == null) return distance;
    return Math.min(nearest, distance);
  }, null);
}

function isActiveWorkZone(feature: WzdxFeatureLike, nowTime: number) {
  const props = feature.properties || {};
  const eventStatus = normalizeText(props.event_status);
  if (["completed", "archived", "cancelled", "inactive"].includes(eventStatus)) {
    return false;
  }

  const startDate = props.start_date ? String(props.start_date) : null;
  const endDate = props.end_date ? String(props.end_date) : null;
  const startTime = startDate ? Date.parse(startDate) : null;
  const endTime = endDate ? Date.parse(endDate) : null;

  if (startTime != null && Number.isFinite(startTime) && startTime > nowTime) {
    return eventStatus === "pending";
  }
  if (endTime != null && Number.isFinite(endTime) && endTime < nowTime) {
    return false;
  }

  return true;
}

function mapFeedFeatureToWorkZone(
  feature: WzdxFeatureLike,
  distanceMeters: number,
  registryRecord: WzdxRegistryRecord | null,
): TransportationWorkZone {
  const props = feature.properties || {};
  const core = props.core_details || {};

  return {
    id: String(feature.id || core.name || `${distanceMeters}-${Math.random()}`),
    name: String(core.name || "Work-zone event"),
    roadNames: Array.isArray(core.road_names)
      ? core.road_names.map((road: unknown) => String(road))
      : [],
    direction: typeof core.direction === "string" ? core.direction : undefined,
    description:
      typeof core.description === "string" ? core.description : undefined,
    startDate: props.start_date ? String(props.start_date) : undefined,
    endDate: props.end_date ? String(props.end_date) : undefined,
    eventStatus:
      typeof props.event_status === "string" ? props.event_status : undefined,
    vehicleImpact:
      typeof props.vehicle_impact === "string" ? props.vehicle_impact : undefined,
    distanceMeters,
    sourceOrganization:
      registryRecord?.issuingorganization ||
      (typeof core.data_source_id === "string" ? core.data_source_id : undefined),
    feedName:
      registryRecord?.feedname ||
      (typeof core.data_source_id === "string" ? core.data_source_id : undefined),
  };
}

function summarizeWorkZoneStatus(
  countWithin1Km: number,
  countWithin5Km: number,
  nearestDistanceMeters: number | null,
): TransportationRiskLevel {
  if (countWithin5Km <= 0) return "low";
  if (
    countWithin1Km >= 3 ||
    (nearestDistanceMeters != null && nearestDistanceMeters <= 500)
  ) {
    return "high";
  }
  if (
    countWithin1Km > 0 ||
    (nearestDistanceMeters != null && nearestDistanceMeters <= 2000)
  ) {
    return "moderate";
  }
  return "low";
}

export const UsaTransportationService = {
  async getTransportationScreening({
    coordinates,
    location = "",
    heuristicInput = {},
  }: {
    coordinates: [number, number];
    location?: string;
    heuristicInput?: Omit<TransportationHeuristicInput, "jurisdictionContext" | "location">;
  }): Promise<TransportationScreeningReport> {
    const context = resolveUsaTransportationContext(location);
    if (!context) {
      throw new Error(
        "USA transportation screening could not resolve a valid state context from the provided location.",
      );
    }

    const notes: string[] = [];
    let registryAvailable = false;
    let feedAvailable = false;
    let sampleWorkZones: TransportationWorkZone[] = [];
    let countWithin1Km = 0;
    let countWithin5Km = 0;
    let nearestWorkZoneDistance: number | null = null;

    try {
      const registryEntries = await getRegistryEntries(context.stateName);
      registryAvailable = registryEntries.length > 0;

      if (!registryAvailable) {
        notes.push("No WZDx registry entry was returned for the mapped state.");
      } else {
        const registryEntry = pickRegistryEntry(registryEntries, context);
        if (!registryEntry?.url?.url) {
          notes.push("A WZDx registry entry exists, but a usable feed URL was not available.");
        } else if (registryEntry.needapikey) {
          notes.push(
            `${registryEntry.issuingorganization || "The selected feed"} requires an API key, so live work-zone filtering was skipped.`,
          );
        } else {
          const payload = await getFeedPayload(registryEntry.url.url);
          const features = Array.isArray(payload?.features) ? payload.features : [];
          feedAvailable = features.length > 0;

          const nowTime = Date.now();
          const nearby = features
            .filter((feature) => isActiveWorkZone(feature, nowTime))
            .map((feature) => {
              const distanceMeters = getNearestCoordinateDistanceMeters(
                coordinates,
                feature,
              );
              if (distanceMeters == null || distanceMeters > NEARBY_RADIUS_METERS) {
                return null;
              }

              return mapFeedFeatureToWorkZone(
                feature,
                distanceMeters,
                registryEntry,
              );
            })
            .filter((feature): feature is TransportationWorkZone => feature !== null)
            .sort((a, b) => a.distanceMeters - b.distanceMeters);

          sampleWorkZones = nearby.slice(0, 5);
          countWithin1Km = nearby.filter((zone) => zone.distanceMeters <= 1000).length;
          countWithin5Km = nearby.length;
          nearestWorkZoneDistance = nearby[0]?.distanceMeters ?? null;

          if (!feedAvailable) {
            notes.push("The WZDx feed returned no features for this request.");
          }
        }
      }
    } catch (error: any) {
      notes.push(
        error?.message || "Live WZDx transportation feed lookup was unavailable.",
      );
    }

    const heuristics = evaluateTransportationHeuristics({
      ...heuristicInput,
      location,
      jurisdictionContext: context,
      nearbyWorkZoneCountWithin1Km: countWithin1Km,
      nearbyWorkZoneCountWithin5Km: countWithin5Km,
      nearestWorkZoneDistanceMeters: nearestWorkZoneDistance,
    });

    return {
      market: "USA",
      countryCode: "US",
      location,
      city: context.city,
      stateCode: context.stateCode,
      tia: heuristics.tia,
      transitAccess: heuristics.transit,
      roadwayContext: heuristics.roadway,
      accessManagement: heuristics.accessManagement,
      nearbyWorkZones: {
        ...heuristics.nearbyWorkZones,
        status: summarizeWorkZoneStatus(
          countWithin1Km,
          countWithin5Km,
          nearestWorkZoneDistance,
        ),
        nearestDistanceMeters: nearestWorkZoneDistance,
        countWithin1Km,
        countWithin5Km,
        sampleWorkZones,
      },
      approvals: heuristics.approvals,
      dataSources: {
        wzdxRegistry: {
          available: registryAvailable,
          notes: registryAvailable ? undefined : ["No registry entry was found."],
        },
        wzdxFeed: {
          available: feedAvailable,
          notes: feedAvailable ? undefined : notes,
        },
        googleTransit: {
          available: heuristics.transit.nearestDistanceMeters != null,
        },
        googleRoads: {
          available:
            heuristics.roadway.centroidRoadDistanceMeters != null ||
            heuristics.roadway.boundaryRoadCoverageRatio != null,
        },
      },
      notes,
    };
  },
};

export default UsaTransportationService;
