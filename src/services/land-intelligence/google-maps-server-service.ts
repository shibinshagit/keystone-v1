import type { Feature, Polygon } from "geojson";

interface NearbyPlaceLocation {
  latitude?: number;
  longitude?: number;
}

interface NearbyPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: NearbyPlaceLocation;
  types?: string[];
}

interface NearbyPlacesRequest {
  includedTypes: string[];
  radius?: number;
  maxResultCount?: number;
}

interface SnappedPoint {
  location?: { latitude?: number; longitude?: number };
  originalIndex?: number;
  placeId?: string;
}

interface ParsedApiPayload {
  error?: { message?: string };
  raw?: string;
  places?: NearbyPlace[];
  snappedPoints?: SnappedPoint[];
  status?: string;
  error_message?: string;
  results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
}

// In-memory cache keeps repeated SEZ / parcel-adjacent lookups from re-hitting Google within
// the same server process. This is a runtime cache only, not a persisted dataset.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

function getApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY");
  }
  return apiKey;
}

function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMeters = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

async function parseJsonPayload(response: Response): Promise<ParsedApiPayload> {
  const text = await response.text();

  try {
    return text ? (JSON.parse(text) as ParsedApiPayload) : {};
  } catch {
    return { raw: text };
  }
}

async function searchNearbyPlacesRaw(
  center: [number, number],
  request: NearbyPlacesRequest,
): Promise<NearbyPlace[]> {
  const apiKey = getApiKey();
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({
      includedTypes: request.includedTypes,
      maxResultCount: request.maxResultCount ?? 10,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: {
            latitude: center[1],
            longitude: center[0],
          },
          radius: Math.max(500, Math.min(request.radius ?? 2000, 50000)),
        },
      },
    }),
  });

  const data = await parseJsonPayload(response);

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.raw || "Google Places request failed");
  }

  return Array.isArray(data.places) ? data.places : [];
}

function sampleBoundaryPoints(
  geometry: Feature<Polygon>,
  maxPoints: number = 60,
): Array<{ lat: number; lng: number }> {
  const ring = geometry.geometry.coordinates?.[0] ?? [];
  if (ring.length === 0) return [];

  const uniqueRing =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;

  const step = Math.max(1, Math.ceil(uniqueRing.length / maxPoints));
  return uniqueRing
    .filter((_, index) => index % step === 0)
    .map(([lng, lat]) => ({ lat, lng }));
}

export const GoogleMapsServerService = {
  calculateDistanceInMeters,

  // Used for LC1, LC3, LC5 and parts of GP1. This is parcel-proximity data, but it still depends
  // on Google place coverage/classification rather than a statutory or official planning dataset.
  async searchNearbyPlaces(
    center: [number, number],
    request: NearbyPlacesRequest,
  ): Promise<
    Array<{
      id: string;
      name: string;
      address: string;
      coordinates: [number, number];
      distanceMeters: number;
      types: string[];
    }>
  > {
    const places = await searchNearbyPlacesRaw(center, request);

    return places
      .map((place, index) => {
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        if (typeof lat !== "number" || typeof lng !== "number") return null;

        return {
          id: place.id || `google-place-${index}-${lat}-${lng}`,
          name: place.displayName?.text || "Unnamed place",
          address: place.formattedAddress || "",
          coordinates: [lng, lat] as [number, number],
          distanceMeters: Math.round(
            calculateDistanceInMeters(center[1], center[0], lat, lng),
          ),
          types: Array.isArray(place.types) ? place.types : [],
        };
      })
      .filter(
        (
          place,
        ): place is {
          id: string;
          name: string;
          address: string;
          coordinates: [number, number];
          distanceMeters: number;
          types: string[];
        } => place !== null,
      )
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  },

  // Used for LC2 and LC4. This gives us road adjacency/access context, but not authoritative
  // statutory road-width information on its own.
  async snapPointsToNearestRoads(points: Array<{ lat: number; lng: number }>): Promise<
    Array<{
      originalIndex: number;
      placeId: string | null;
      original: { lat: number; lng: number };
      snapped: { lat: number; lng: number };
      distanceMeters: number;
    }>
  > {
    const apiKey = getApiKey();
    const sanitizedPoints = points
      .slice(0, 100)
      .filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lng) &&
          Math.abs(point.lat) <= 90 &&
          Math.abs(point.lng) <= 180,
      );

    if (sanitizedPoints.length === 0) return [];

    const encodedPoints = sanitizedPoints
      .map((point) => `${point.lat},${point.lng}`)
      .join("|");
    const response = await fetch(
      `https://roads.googleapis.com/v1/nearestRoads?points=${encodeURIComponent(encodedPoints)}&key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
    );

    const data = await parseJsonPayload(response);

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.raw || "Google Roads request failed");
    }

    const snappedPoints = Array.isArray(data.snappedPoints) ? data.snappedPoints : [];

    return snappedPoints
      .map((snappedPoint) => {
        const originalIndex = snappedPoint.originalIndex;
        const snappedLat = snappedPoint.location?.latitude;
        const snappedLng = snappedPoint.location?.longitude;

        if (
          typeof originalIndex !== "number" ||
          typeof snappedLat !== "number" ||
          typeof snappedLng !== "number"
        ) {
          return null;
        }

        const original = sanitizedPoints[originalIndex];
        if (!original) return null;

        return {
          originalIndex,
          placeId: snappedPoint.placeId || null,
          original,
          snapped: { lat: snappedLat, lng: snappedLng },
          distanceMeters: Math.round(
            calculateDistanceInMeters(
              original.lat,
              original.lng,
              snappedLat,
              snappedLng,
            ),
          ),
        };
      })
      .filter(
        (
          point,
        ): point is {
          originalIndex: number;
          placeId: string | null;
          original: { lat: number; lng: number };
          snapped: { lat: number; lng: number };
          distanceMeters: number;
        } => point !== null,
      );
  },

  // Currently used for ME2 to convert named SEZ locations into coordinates.
  // This is correct for point-distance scoring, but input quality still depends on how clean
  // the SEZ source names/addresses are.
  async geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    const normalizedAddress = address.trim();
    if (!normalizedAddress) return null;

    if (geocodeCache.has(normalizedAddress)) {
      return geocodeCache.get(normalizedAddress) || null;
    }

    const apiKey = getApiKey();
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
    );

    const data = await parseJsonPayload(response);

    if (!response.ok || data?.status === "REQUEST_DENIED" || data?.status === "INVALID_REQUEST") {
      throw new Error(data?.error_message || data?.raw || "Google Geocoding request failed");
    }

    const location = data?.results?.[0]?.geometry?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);

    const result =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null;

    geocodeCache.set(normalizedAddress, result);
    return result;
  },

  // Boundary sampling lets LC4 reason about frontage/access on the parcel edge rather than
  // relying only on the centroid.
  sampleParcelBoundaryPoints(
    geometry: Feature<Polygon>,
    maxPoints?: number,
  ): Array<{ lat: number; lng: number }> {
    return sampleBoundaryPoints(geometry, maxPoints);
  },
};

export default GoogleMapsServerService;
