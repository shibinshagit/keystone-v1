import { adminDb } from '@/lib/firebase-admin';
import {
  getDefaultLocationForMarket,
  getStateForUSLocation,
  inferRegulationGeography,
} from '@/lib/geography';
import {
  getRegulationCollectionNameForMarket,
  shouldUseNationalIndiaFallback,
} from '@/lib/regulation-collections';
import type { BuildingIntendedUse, GeographyMarket, RegulationData } from '@/lib/types';

export interface AdminRegulationLookupResult {
  regulation: RegulationData | null;
  matchedLocation: string | null;
  source:
    | 'specific-id'
    | 'generic-id'
    | 'location-query'
    | 'national-fallback'
    | 'not-found';
}

function normalizeIntendedUse(intendedUse: string): string {
  const value = intendedUse.trim();
  if (value.toLowerCase() === 'mixed use') return 'Mixed-Use';
  if (value.toLowerCase() === 'mixed-use') return 'Mixed Use';
  return value;
}

function buildLocationCandidates(location: string, market?: GeographyMarket): string[] {
  const cleaned = location.trim();
  if (!cleaned) return [getDefaultLocationForMarket(market || 'India')];

  const inferred = inferRegulationGeography(cleaned);
  const state = market === 'USA' ? getStateForUSLocation(cleaned) : inferred.stateOrProvince;
  const parts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(india|usa|us|uae|united arab emirates)$/i.test(part));

  return Array.from(
    new Set([
      ...(state ? [state] : []),
      ...(inferred.city ? [inferred.city] : []),
      cleaned,
      ...parts,
      ...(parts.length > 1 ? [parts[parts.length - 1], parts[0]] : []),
    ]),
  );
}

function findBestMatch(regulations: RegulationData[], intendedUse: string): RegulationData | null {
  const normalized = intendedUse.toLowerCase().replace(/-/g, ' ');

  return (
    regulations.find((reg) => reg.type?.toLowerCase() === intendedUse.toLowerCase()) ||
    regulations.find((reg) => reg.type?.toLowerCase().replace(/-/g, ' ') === normalized) ||
    regulations.find((reg) => reg.type?.toLowerCase().includes(normalized)) ||
    regulations[0] ||
    null
  );
}

function getStatewiseRegulationId(
  regulationId?: string,
  market?: GeographyMarket,
): string | undefined {
  if (!regulationId || market !== 'USA') return regulationId;

  const [locationPart, ...rest] = regulationId.split('-');
  if (rest.length === 0) return regulationId;

  const state = getStateForUSLocation(locationPart);
  return state ? `${state}-${rest.join('-')}` : regulationId;
}

export async function getAvailableRegulationsForLocationAdmin({
  location,
  market,
}: {
  location: string;
  market?: GeographyMarket;
}): Promise<RegulationData[]> {
  if (!location.trim()) return [];

  const collectionName = getRegulationCollectionNameForMarket(market);
  const candidates = buildLocationCandidates(location, market);
  const seen = new Set<string>();
  const regulations: RegulationData[] = [];

  for (const candidate of candidates) {
    const snapshot = await adminDb.collection(collectionName).where('location', '==', candidate).get();
    snapshot.docs.forEach((entry) => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      regulations.push({
        id: entry.id,
        ...(entry.data() as RegulationData),
      });
    });
  }

  return regulations;
}

export async function lookupRegulationForLocationAndUseAdmin({
  location,
  intendedUse,
  regulationId,
  market,
}: {
  location: string;
  intendedUse: BuildingIntendedUse | string;
  regulationId?: string;
  market?: GeographyMarket;
}): Promise<AdminRegulationLookupResult> {
  const normalizedUse = normalizeIntendedUse(String(intendedUse || 'Residential'));
  const locationCandidates = buildLocationCandidates(location, market);
  const collectionName = getRegulationCollectionNameForMarket(market);
  const effectiveRegulationId = getStatewiseRegulationId(regulationId, market);

  if (effectiveRegulationId) {
    const specificDoc = await adminDb.collection(collectionName).doc(effectiveRegulationId).get();
    if (specificDoc.exists) {
      const regulation = specificDoc.data() as RegulationData;
      return {
        regulation,
        matchedLocation: regulation.location || locationCandidates[0] || null,
        source: 'specific-id',
      };
    }

    for (const candidate of locationCandidates) {
      const regulations = await getAvailableRegulationsForLocationAdmin({ location: candidate, market });
      const matchedBaseline = regulations.find((reg) => reg.id === effectiveRegulationId);
      if (matchedBaseline) {
        return {
          regulation: matchedBaseline,
          matchedLocation: candidate,
          source: 'specific-id',
        };
      }
    }
  }

  for (const candidate of locationCandidates) {
    const genericDoc = await adminDb.collection(collectionName).doc(`${candidate}-${normalizedUse}`).get();
    if (genericDoc.exists) {
      const regulation = genericDoc.data() as RegulationData;
      return {
        regulation,
        matchedLocation: candidate,
        source: 'generic-id',
      };
    }
  }

  for (const candidate of locationCandidates) {
    const regulations = await getAvailableRegulationsForLocationAdmin({ location: candidate, market });
    if (regulations.length === 0) continue;

    const bestMatch = findBestMatch(regulations, normalizedUse);
    if (bestMatch) {
      return {
        regulation: bestMatch,
        matchedLocation: candidate,
        source: 'location-query',
      };
    }
  }

  if (!shouldUseNationalIndiaFallback(market)) {
    return {
      regulation: null,
      matchedLocation: null,
      source: 'not-found',
    };
  }

  const nationalSnapshot = await adminDb.collection(collectionName).where('location', '==', 'National (NBC)').get();
  if (!nationalSnapshot.empty) {
    const regulations = nationalSnapshot.docs.map((entry) => ({
      id: entry.id,
      ...(entry.data() as RegulationData),
    }));
    const bestMatch = findBestMatch(regulations, normalizedUse);
    if (bestMatch) {
      return {
        regulation: bestMatch,
        matchedLocation: 'National (NBC)',
        source: 'national-fallback',
      };
    }
  }

  return {
    regulation: null,
    matchedLocation: null,
    source: 'not-found',
  };
}
