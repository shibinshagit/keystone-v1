import {
  lookupRegulationForLocationAndUseAdmin as lookupFirestoreRegulationForLocationAndUse,
  type AdminRegulationLookupResult as RegulationLookupResult,
} from '@/lib/regulation-lookup-admin';
import type {
  BuildingIntendedUse,
  GeographyMarket,
  RegulationArtifacts,
  RegulationData,
  RegulationFieldProvenanceMap,
  RegulationSectionName,
  RegulationValue,
} from '@/lib/types';import { GridicsService, type GridicsLookupInput } from '@/services/us/gridics-service';

export interface ServerRegulationLookupArgs {
  location: string;
  intendedUse: BuildingIntendedUse | string;
  regulationId?: string;
  market?: GeographyMarket;
  coordinates?: [number, number];
  address?: string;
  zipCode?: string;
  parcelId?: string;
}

export interface ServerRegulationLookupResult extends Omit<RegulationLookupResult, 'source'> {
    artifacts?: RegulationArtifacts | null;
  source:
    | RegulationLookupResult['source']
    | 'gridics';
}

const REGULATION_SECTIONS: RegulationSectionName[] = [
  'geometry',
  'highrise',
  'facilities',
  'sustainability',
  'safety_and_services',
  'administration',
  'accessibility',
];

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function mergeRegulationSection(
  baseSection: Record<string, RegulationValue> | undefined,
  overrideSection: Record<string, RegulationValue> | undefined,
): Record<string, RegulationValue> {
  const merged: Record<string, RegulationValue> = { ...(baseSection || {}) };

  for (const [key, overrideValue] of Object.entries(overrideSection || {})) {
    if (!overrideValue) continue;
    const baseValue = merged[key];
    const nextValue: RegulationValue = {
      ...(baseValue || { desc: '', unit: '', value: '' }),
      ...overrideValue,
    };

    if (!hasMeaningfulValue(overrideValue.value) && baseValue && hasMeaningfulValue(baseValue.value)) {
      nextValue.value = baseValue.value;
    }
    if (!hasMeaningfulValue(overrideValue.desc) && baseValue?.desc) {
      nextValue.desc = baseValue.desc;
    }
    if (!hasMeaningfulValue(overrideValue.unit) && baseValue?.unit) {
      nextValue.unit = baseValue.unit;
    }
    if (overrideValue.min === undefined && baseValue?.min !== undefined) {
      nextValue.min = baseValue.min;
    }
    if (overrideValue.max === undefined && baseValue?.max !== undefined) {
      nextValue.max = baseValue.max;
    }

    merged[key] = nextValue;
  }

  return merged;
}

function mergeFieldProvenance(
  gridicsProvenance: RegulationFieldProvenanceMap | undefined,
  firestoreRegulation: RegulationData | null,
): RegulationFieldProvenanceMap | undefined {
  const merged: RegulationFieldProvenanceMap = {
    ...(gridicsProvenance || {}),
  };

  if (!firestoreRegulation) {
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  for (const section of REGULATION_SECTIONS) {
    const firestoreSection = firestoreRegulation[section];
    if (!firestoreSection || typeof firestoreSection !== 'object') continue;

    for (const [key, value] of Object.entries(firestoreSection)) {
      if (!value) continue;
      const overrideHasValue =
        hasMeaningfulValue(value.value) ||
        value.min !== undefined ||
        value.max !== undefined ||
        hasMeaningfulValue(value.desc);

      if (!overrideHasValue) continue;

      merged[section] = {
        ...(merged[section] || {}),
        [key]: {
          provider: 'firestore',
          status: 'override',
          detail: 'Admin / Firestore regulation overrides the parcel-derived Gridics value for this field.',
          basis: 'Firestore regulation lookup',
        },
      };
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeGridicsWithFirestore(
  gridicsRegulation: RegulationData,
  firestoreRegulation: RegulationData | null,
  firestoreSource: RegulationLookupResult['source'],
): RegulationData {
  if (!firestoreRegulation) {
    return gridicsRegulation;
  }

  return {
    ...gridicsRegulation,
    geometry: mergeRegulationSection(gridicsRegulation.geometry, firestoreRegulation.geometry),
    highrise: mergeRegulationSection(gridicsRegulation.highrise || {}, firestoreRegulation.highrise || {}),
    facilities: mergeRegulationSection(gridicsRegulation.facilities, firestoreRegulation.facilities),
    sustainability: mergeRegulationSection(gridicsRegulation.sustainability, firestoreRegulation.sustainability),
    safety_and_services: mergeRegulationSection(gridicsRegulation.safety_and_services, firestoreRegulation.safety_and_services),
    administration: mergeRegulationSection(gridicsRegulation.administration, firestoreRegulation.administration),
    accessibility: mergeRegulationSection(gridicsRegulation.accessibility || {}, firestoreRegulation.accessibility || {}),
    sourceInfo: {
      ...(gridicsRegulation.sourceInfo || {
        provider: 'gridics',
        label: 'Gridics',
      }),
      provider: 'hybrid',
      label: 'Gridics + admin override',
      confidence: 'partial',
      hasAdminOverride: true,
      detail:
        firestoreSource === 'specific-id'
          ? 'Gridics parcel data with an explicit admin regulation override.'
          : 'Gridics parcel data with admin fallback values layered in.',
    },
    fieldProvenance: mergeFieldProvenance(gridicsRegulation.fieldProvenance, firestoreRegulation),
  };
}

function shouldTryGridics(args: ServerRegulationLookupArgs): boolean {
  if (args.market !== 'USA') return false;
  if (args.parcelId) return true;
  if (args.coordinates) return true;
  return Boolean(args.address && args.zipCode);
}

function toGridicsInput(args: ServerRegulationLookupArgs): GridicsLookupInput {
  return {
    location: args.location,
    coordinates: args.coordinates,
    address: args.address,
    zipCode: args.zipCode,
    groupId: args.parcelId,
    intendedUse: String(args.intendedUse || ''),
  };
}

export async function lookupRegulationForLocationAndUse({
  location,
  intendedUse,
  regulationId,
  market,
  coordinates,
  address,
  zipCode,
  parcelId,
}: ServerRegulationLookupArgs): Promise<ServerRegulationLookupResult> {
  let firestoreResult: RegulationLookupResult = {
    regulation: null,
    matchedLocation: null,
    source: 'not-found',
  };
  let firestoreError: unknown = null;

  const shouldUseGridics = shouldTryGridics({
    location,
    intendedUse,
    regulationId,
    market,
     coordinates,
    address,
    zipCode,
    parcelId,
  });

  if (!shouldUseGridics) {
    return lookupFirestoreRegulationForLocationAndUse({
      location,
      intendedUse,
      regulationId,
      market,
    });
  }

  try {
    const gridicsResult = await GridicsService.getNormalizedResult(
      toGridicsInput({ location, intendedUse, regulationId, market, coordinates, address, zipCode, parcelId }),
    );

    if (!gridicsResult) {
      try {
        return await lookupFirestoreRegulationForLocationAndUse({
          location,
          intendedUse,
          regulationId,
          market,
        });
      } catch (error) {
        console.warn('[RegulationLookupServer] Firestore lookup failed after Gridics returned no data:', error);
        return {
          regulation: null,
          matchedLocation: location || null,
          source: 'not-found',
        };
      }
    }

    try {
      firestoreResult = await lookupFirestoreRegulationForLocationAndUse({
        location,
        intendedUse,
        regulationId,
        market,
      });
    } catch (error) {
      firestoreError = error;
      console.warn('[RegulationLookupServer] Firestore lookup failed; continuing with Gridics parcel data only:', error);
    }

    const mergedRegulation = mergeGridicsWithFirestore(
      gridicsResult.regulation,
      firestoreResult.regulation,
      firestoreResult.source,
    );

    return {
        artifacts: gridicsResult.artifacts,
      regulation: mergedRegulation,
      matchedLocation: location || firestoreResult.matchedLocation,
      source: 'gridics',
    };
  } catch (error) {
    console.warn('[RegulationLookupServer] Gridics lookup failed, falling back to Firestore:', error);
    try {
      return await lookupFirestoreRegulationForLocationAndUse({
        location,
        intendedUse,
        regulationId,
        market,
      });
    } catch (firestoreFallbackError) {
      console.warn('[RegulationLookupServer] Firestore fallback also failed:', firestoreFallbackError);

      if (firestoreError) {
        console.warn('[RegulationLookupServer] Earlier Firestore lookup failure retained for context:', firestoreError);
      }

      return {
        regulation: null,
        matchedLocation: location || null,
        source: 'not-found',
      };
    }
  }
}
