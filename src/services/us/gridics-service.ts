import type { GeoJsonObject } from 'geojson';
import type {
  RegulationArtifacts,
  RegulationData,
  RegulationFieldProvenance,
  RegulationFieldProvenanceMap,
  RegulationSectionName,
  RegulationSourceConfidence,
  RegulationValue,
} from '@/lib/types';
import { getUSStateCode, US_STATE_CODES, US_STATE_NAME_TO_CODE } from '@/lib/geography';

const GRIDICS_BASE_URL = 'https://api.gridics.com/v1';
const GRIDICS_CACHE_TTL_MS = 55_000;

const cache = new Map<string, { expiresAt: number; promise: Promise<GridicsPropertyRecord | null> }>();

interface GridicsOverlay {
  Name?: string;
  Description?: string | null;
}

interface GridicsUse {
  TypeName?: string;
  AllowedUsesLabel?: string;
  AllowedUsesName?: string;
  CalibrationUsesLabel?: string;
}

interface GridicsFrontage {
  Label?: string;
  FrontageType?: number;
  Setback?: number | number[] | null;
  MinThoroughfareWidth?: number | null;
  SegmentsLengths?: string | number[] | null;
}

interface GridicsBuilding {
  Overlays?: GridicsOverlay[];
  Uses?: GridicsUse[];
  Envelope?: Record<string, unknown>;
  ZoningAllowance?: Record<string, unknown>;
  CalibrationGeneral?: Record<string, unknown>;
  Frontages?: GridicsFrontage[];
  UsesStatistic?: Record<string, unknown>;
  GeoJSONViews?: Record<string, unknown> | null;
}

export interface GridicsPropertyRecord {
  Id?: number;
  GroupId?: string;
  Address?: string;
  State?: string;
  City?: string;
  ZipCode?: string;
  FolioNumber?: string;
  LotType?: number | string | null;
  CalculationStatus?: number | null;
  updatedAt?: string;
  Buildings?: GridicsBuilding[];
}

interface GridicsLookupResponse {
  status?: string;
  dataRows?: number;
  messages?: string[];
  data?: GridicsPropertyRecord[];
}

export interface GridicsLookupInput {
  location?: string;
  coordinates?: [number, number];
  address?: string;
  zipCode?: string;
  groupId?: string;
  intendedUse?: string;
  stateEnv?: string;
}

export interface GridicsNormalizedResult {
  regulation: RegulationData;
  artifacts: RegulationArtifacts | null;
  propertyRecord: GridicsPropertyRecord;
}

function getGridicsApiKey(): string | null {
  return process.env.GRIDICS_DEMO_API?.trim() || null;
}

function normalizeUseLabel(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return 'Parcel-Specific Zoning';
  if (text.toLowerCase() === 'mixed use') return 'Mixed-Use';
  if (text.toLowerCase() === 'mixed-use') return 'Mixed-Use';
  return text;
}

function compactParams(params: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search;
}

function normalizeStateEnv(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper.toLowerCase();

  const match = getUSStateCode(trimmed);
  return match ? match.toLowerCase() : null;
}

function inferStateEnv(input: Pick<GridicsLookupInput, 'stateEnv' | 'location' | 'address'>): string | null {
  const explicit = normalizeStateEnv(input.stateEnv);
  if (explicit) return explicit;

  const candidates = [input.location, input.address]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const candidate of candidates) {
    const direct = normalizeStateEnv(candidate);
    if (direct) return direct;

    const parts = candidate.split(/[,/]/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const normalizedPart = normalizeStateEnv(part);
      if (normalizedPart) return normalizedPart;
    }

    const lowered = candidate.toLowerCase();
    for (const [stateName, abbr] of Object.entries(US_STATE_NAME_TO_CODE)) {
      if (lowered.includes(stateName.toLowerCase())) return abbr.toLowerCase();
    }

    const abbrMatch = lowered.match(/\b([a-z]{2})\b/g);
    if (abbrMatch) {
      for (const fragment of abbrMatch) {
        const normalizedFragment = normalizeStateEnv(fragment);
        if (normalizedFragment) return normalizedFragment;
      }
    }
  }

  return null;
}

function extractZipCode(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toFiniteNumbers(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toNumber(entry))
      .filter((entry): entry is number => entry !== null);
  }

  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((entry) => toNumber(entry))
      .filter((entry): entry is number => entry !== null);
  }

  const numeric = toNumber(value);
  return numeric === null ? [] : [numeric];
}

function feetToMeters(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Number((value * 0.3048).toFixed(2));
}

function sqftToSqm(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Number((value * 0.092903).toFixed(2));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function valueFromEnvelope(envelope: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const numeric = toNumber(envelope?.[key]);
    if (numeric !== null) return numeric;
  }
  return undefined;
}

function positiveValue(value: number | undefined): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

function firstMetricValue(value: unknown): number | undefined {
  const numbers = toFiniteNumbers(value);
  const first = numbers.find((entry) => entry >= 0);
  return first == null ? undefined : feetToMeters(first);
}

function parseFrontageLengthMeters(frontage: GridicsFrontage): number | undefined {
  const segments = toFiniteNumbers(frontage.SegmentsLengths);
  if (segments.length === 0) return undefined;
  return feetToMeters(segments.reduce((sum, value) => sum + value, 0));
}

function deriveFrontageMeters(frontages: GridicsFrontage[]): number | undefined {
  const lengths = frontages
    .filter((frontage) => frontage.FrontageType === 1)
    .map(parseFrontageLengthMeters)
    .filter((value): value is number => value != null);

  if (lengths.length > 0) return Math.max(...lengths);

  const fallbackLengths = frontages
    .map(parseFrontageLengthMeters)
    .filter((value): value is number => value != null);

  return fallbackLengths.length > 0 ? Math.max(...fallbackLengths) : undefined;
}

function deriveRoadWidthMeters(frontages: GridicsFrontage[]): number | undefined {
  const widths = frontages
    .filter((frontage) => frontage.FrontageType === 1)
    .map((frontage) => feetToMeters(toNumber(frontage.MinThoroughfareWidth)))
    .filter((value): value is number => value != null);

  if (widths.length > 0) return Math.max(...widths);

  const fallbackWidths = frontages
    .map((frontage) => feetToMeters(toNumber(frontage.MinThoroughfareWidth)))
    .filter((value): value is number => value != null);

  return fallbackWidths.length > 0 ? Math.max(...fallbackWidths) : undefined;
}

function deriveFrontSetbackMeters(
  frontages: GridicsFrontage[],
  envelope: Record<string, unknown> | undefined,
): number | undefined {
  const frontageSetbacks = frontages
    .filter((frontage) => frontage.FrontageType === 1)
    .map((frontage) => firstMetricValue(frontage.Setback))
    .filter((value): value is number => value != null);

  if (frontageSetbacks.length > 0) return Math.max(...frontageSetbacks);

  return (
    firstMetricValue(envelope?.EffectivePFrontSetbackPrincipal) ||
    firstMetricValue(envelope?.EffectiveTFrontSetbackPrincipal) ||
    firstMetricValue(envelope?.EffectivePFrontSetbackSecondary) ||
    firstMetricValue(envelope?.EffectiveTFrontSetbackSecondary)
  );
}

function deriveRearSetbackMeters(
  envelope: Record<string, unknown> | undefined,
  calibration: Record<string, unknown> | undefined,
): number | undefined {
  return (
    firstMetricValue(envelope?.EffectivePRearSetback) ||
    firstMetricValue(envelope?.EffectiveTRearSetback) ||
    feetToMeters(toNumber(calibration?.PRearSetbackMax))
  );
}

function deriveSideSetbackMeters(
  envelope: Record<string, unknown> | undefined,
  calibration: Record<string, unknown> | undefined,
): number | undefined {
  return (
    firstMetricValue(envelope?.EffectivePSideSetback) ||
    firstMetricValue(envelope?.EffectiveTSideSetback) ||
    feetToMeters(toNumber(calibration?.PSideSetbackMax))
  );
}

function buildPermittedUseCategories(building: GridicsBuilding): string[] {
  const usesStatistic = building.UsesStatistic;
  const usesTypes =
    usesStatistic && typeof usesStatistic === 'object'
      ? (usesStatistic as Record<string, unknown>).usesTypes
      : null;

  if (usesTypes && typeof usesTypes === 'object' && !Array.isArray(usesTypes)) {
    return uniqueStrings(
      Object.entries(usesTypes).flatMap(([category, stats]) => {
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return [];
        const allowed = toNumber((stats as Record<string, unknown>).allowed) || 0;
        return allowed > 0 ? [category.replace(/_/g, ' ')] : [];
      }),
    );
  }

  return uniqueStrings(
    (building.Uses || [])
      .filter((item) => {
        const allowance = String(item.AllowedUsesName || '').toLowerCase();
        return allowance.includes('right') || allowance.includes('warrant') || allowance.includes('exception');
      })
      .map((item) => item.TypeName),
  );
}

function buildPermittedUses(building: GridicsBuilding): string[] {
  return uniqueStrings(
    (building.Uses || [])
      .filter((item) => {
        const allowance = String(item.AllowedUsesName || '').toLowerCase();
        return allowance.includes('right') || allowance.includes('warrant') || allowance.includes('exception');
      })
      .map((item) => {
        const label = item.CalibrationUsesLabel || item.TypeName || 'Allowed use';
        const allowance = item.AllowedUsesName ? ` (${item.AllowedUsesName})` : '';
        return `${label}${allowance}`;
      }),
  ).slice(0, 20);
}

function buildOverlayNames(building: GridicsBuilding): string[] {
  return uniqueStrings((building.Overlays || []).map((overlay) => overlay.Name)).slice(0, 20);
}

function lotTypeLabel(value: unknown): string | undefined {
  const numeric = toNumber(value);
  if (numeric === 1) return 'Interior';
  if (numeric === 2) return 'Corner';
  if (numeric === 3) return 'Block';
  if (numeric === 4) return 'Through';
  return numeric != null ? String(numeric) : undefined;
}

function setFieldProvenance(
  map: RegulationFieldProvenanceMap,
  section: RegulationSectionName,
  key: string,
  provenance: RegulationFieldProvenance,
) {
  map[section] = {
    ...(map[section] || {}),
    [key]: provenance,
  };
}

function addValue(
  bucket: Record<string, RegulationValue>,
  key: string,
  config: {
    value?: unknown;
    desc: string;
    unit?: string;
    min?: unknown;
    max?: unknown;
    includeWhenEmpty?: boolean;
  },
): boolean {
  const hasValue =
    config.value !== undefined &&
    config.value !== null &&
    !(typeof config.value === 'string' && config.value.trim().length === 0) &&
    !(Array.isArray(config.value) && config.value.length === 0);

  const hasBounds = config.min !== undefined || config.max !== undefined;
  if (!hasValue && !hasBounds && !config.includeWhenEmpty) return false;

  bucket[key] = {
    desc: config.desc,
    unit: config.unit || '',
    value: hasValue ? config.value : '',
    ...(config.min !== undefined ? { min: config.min } : {}),
    ...(config.max !== undefined ? { max: config.max } : {}),
  };

  return true;
}

function isGeoJsonObject(value: unknown): value is GeoJsonObject {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).type === 'string';
}

function buildGridicsArtifacts(building: GridicsBuilding | undefined): RegulationArtifacts | null {
  const views = building?.GeoJSONViews;
  if (!views || typeof views !== 'object') return null;

  const geoJsonViews: Array<[string, GeoJsonObject]> = Object.entries(views).flatMap(([key, value]) =>
    isGeoJsonObject(value) ? [[key, value]] : [],
  );
  const availableViews = geoJsonViews.map(([key]) => key);
  if (availableViews.length === 0) return null;

  const preferredViewOrder = ['ZA', 'Envelope', 'BuildingEnvelope', 'Lot', 'Parcel'];
  const preferredView = preferredViewOrder.find((view) =>
    geoJsonViews.some(([key]) => key.toLowerCase() === view.toLowerCase()),
  );
  const selectedViewEntry =
    geoJsonViews.find(([key]) => preferredView && key.toLowerCase() === preferredView.toLowerCase()) ||
    geoJsonViews[0];

  return {
    gridics: {
      provider: 'gridics',
      availableViews,
      envelopeGeometryView: selectedViewEntry?.[0],
      envelopeGeometry: selectedViewEntry?.[1] || null,
      frontageCount: building?.Frontages?.length || 0,
    },
  };
}

function deriveSourceConfidence({
  inferredFields,
  missingFields,
}: {
  inferredFields: string[];
  missingFields: string[];
}): RegulationSourceConfidence {
  if (missingFields.length > 0) return 'partial';
  if (inferredFields.length > 0) return 'inferred';
  return 'explicit';
}

function buildRegulationId(groupId: string | undefined, useLabel: string): string {
  const safeGroupId = String(groupId || 'unknown').trim().toLowerCase();
  const safeUse = useLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `gridics-${safeGroupId}-${safeUse || 'parcel'}`;
}

export async function fetchGridicsPropertyRecord(input: GridicsLookupInput): Promise<GridicsPropertyRecord | null> {
  const apiKey = getGridicsApiKey();
  if (!apiKey) {
    console.warn('[GridicsService] GRIDICS_DEMO_API not set; skipping Gridics zoning lookup.');
    return null;
  }

  const stateEnv = inferStateEnv(input);
  if (!stateEnv) {
    console.warn('[GridicsService] Unable to infer state_env for Gridics request.');
    return null;
  }

  const normalizedAddress = input.address?.trim();
  const zipCode = input.zipCode?.trim() || extractZipCode(normalizedAddress || input.location || '');
  const params = compactParams({
    state_env: stateEnv,
    ...(input.groupId
      ? { groupId: input.groupId }
      : input.coordinates
        ? { lat: input.coordinates[1], lon: input.coordinates[0] }
        : normalizedAddress && zipCode
          ? { address: normalizedAddress, zipCode }
          : {}),
  });

  if (!params.has('groupId') && !(params.has('lat') && params.has('lon')) && !(params.has('address') && params.has('zipCode'))) {
    console.warn('[GridicsService] Gridics needs coordinates, groupId, or address+zipCode.');
    return null;
  }

  const cacheKey = params.toString();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const requestPromise = (async () => {
    const url = `${GRIDICS_BASE_URL}/property-record?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Gridics HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
    }

    const payload = (await response.json()) as GridicsLookupResponse;
    if (payload.status !== 'OK' || !Array.isArray(payload.data) || payload.data.length === 0) {
      return null;
    }

    return payload.data[0] || null;
  })();

  cache.set(cacheKey, {
    expiresAt: now + GRIDICS_CACHE_TTL_MS,
    promise: requestPromise,
  });

  requestPromise.catch(() => {
    const latest = cache.get(cacheKey);
    if (latest?.promise === requestPromise) {
      cache.delete(cacheKey);
    }
  });

  return requestPromise;
}

export function gridicsPropertyRecordToRegulationData(
  record: GridicsPropertyRecord,
  input: GridicsLookupInput = {},
): RegulationData {
  const building = record.Buildings?.[0];
  const envelope = building?.Envelope;
  const zoningAllowance = building?.ZoningAllowance;
  const calibration = building?.CalibrationGeneral;
  const frontages = building?.Frontages || [];
  const useLabel = normalizeUseLabel(input.intendedUse);
  const locationLabel = input.location?.trim() || [record.City, record.State].filter(Boolean).join(', ') || 'USA Parcel';
  const zoneCode =
    String(
      zoningAllowance?.ZoneCombinationName ||
      zoningAllowance?.ZoneId ||
      zoningAllowance?.SubZoneId ||
      '',
    ).trim() || 'Unknown';
  const overlays = building ? buildOverlayNames(building) : [];
  const permittedUseCategories = building ? buildPermittedUseCategories(building) : [];
  const permittedUses = building ? buildPermittedUses(building) : [];
  const frontageMeters = deriveFrontageMeters(frontages);
  const roadWidthMeters = deriveRoadWidthMeters(frontages);
  const frontSetbackMeters = deriveFrontSetbackMeters(frontages, envelope);
  const rearSetbackMeters = deriveRearSetbackMeters(envelope, calibration);
  const sideSetbackMeters = deriveSideSetbackMeters(envelope, calibration);
  const maxFloors = positiveValue(valueFromEnvelope(envelope, 'TotalBuidingHeight'));
  const explicitHeightMeters = feetToMeters(valueFromEnvelope(envelope, 'TotalBuildingHeightFeet'));
  const inferredHeightMeters =
    explicitHeightMeters ||
    (maxFloors && maxFloors > 0 ? Number((maxFloors * 3.5).toFixed(2)) : undefined);
  const lotCoverage = positiveValue(valueFromEnvelope(envelope, 'LotCoverage', 'EffectiveLotCoverage'));
  const openSpace = valueFromEnvelope(envelope, 'MinOpenSpace', 'EffectiveMinOpenSpace');
  const far = positiveValue(valueFromEnvelope(envelope, 'FloorAreaRatio'));
  const maxUnits = valueFromEnvelope(envelope, 'DensityUnits');
  const unitsPerAcre = valueFromEnvelope(envelope, 'DensityNet');
  const parcelAreaSqm = sqftToSqm(
    valueFromEnvelope(envelope, 'LotAreaFeetGAPI', 'LotAreaFeet', 'LotAreaPR'),
  );
  const maxBuildableAreaSqm = sqftToSqm(valueFromEnvelope(envelope, 'MaxBuildingAreaAllowed', 'FloorAreaRatioCapacity'));
  const maxFootprintSqm = sqftToSqm(valueFromEnvelope(envelope, 'MaxBuildingFootprint', 'MaxLotCoverageArea'));
  const fieldProvenance: RegulationFieldProvenanceMap = {};
  const missingFields: string[] = [];
  const inferredFields: string[] = [];

  if (!explicitHeightMeters && maxFloors) {
    missingFields.push('explicit max height in feet/meters');
    inferredFields.push('max height');
  }
  if (sideSetbackMeters == null) {
    missingFields.push('side setback');
  }
  if (far == null) {
    missingFields.push('floor area ratio');
  }
  if (maxUnits == null) {
    missingFields.push('allowed unit count');
  }

  const geometry: Record<string, RegulationValue> = {};
  const highrise: Record<string, RegulationValue> = {};
  const facilities: Record<string, RegulationValue> = {};
  const sustainability: Record<string, RegulationValue> = {};
  const safetyAndServices: Record<string, RegulationValue> = {};
  const administration: Record<string, RegulationValue> = {};

  addValue(geometry, 'land_use_zoning', {
    value: zoneCode,
    desc: 'Gridics parcel-specific zoning district / zone combination.',
  });
  addValue(administration, 'land_use_zoning', {
    value: zoneCode,
    desc: 'Gridics parcel-specific zoning district / zone combination.',
  });
  addValue(geometry, 'floor_area_ratio', {
    value: far,
    desc: 'Parcel-specific FAR returned by the Gridics envelope model.',
  });
  addValue(geometry, 'max_far', {
    value: far,
    desc: 'Alias of Gridics floor area ratio.',
  });
  const farProvenance: RegulationFieldProvenance = far != null
    ? {
        provider: 'gridics',
        status: 'explicit',
        detail: 'Floor area ratio came directly from the Gridics parcel envelope.',
        basis: 'Envelope.FloorAreaRatio',
        rawField: 'FloorAreaRatio',
      }
    : {
        provider: 'gridics',
        status: 'missing',
        detail: 'Gridics did not return a usable parcel-level floor area ratio for this record.',
        basis: 'No parcel-level FloorAreaRatio value was present',
        rawField: 'FloorAreaRatio',
      };
  setFieldProvenance(fieldProvenance, 'geometry', 'floor_area_ratio', farProvenance);
  setFieldProvenance(fieldProvenance, 'geometry', 'max_far', farProvenance);
  addValue(geometry, 'max_ground_coverage', {
    value: lotCoverage,
    desc: 'Maximum lot coverage returned by Gridics.',
    unit: '%',
  });
  addValue(geometry, 'max_floors', {
    value: maxFloors,
    desc: 'Maximum story count returned by Gridics.',
    unit: 'stories',
  });
  addValue(geometry, 'max_height', {
    value: inferredHeightMeters,
    desc: explicitHeightMeters
      ? 'Maximum building height converted from Gridics feet to meters.'
      : 'Estimated metric height derived from Gridics max floors when explicit feet data is absent.',
    unit: 'm',
  });
  if (inferredHeightMeters != null) {
    setFieldProvenance(fieldProvenance, 'geometry', 'max_height', explicitHeightMeters != null
      ? {
          provider: 'gridics',
          status: 'explicit',
          detail: 'Gridics returned an explicit feet-based height that was converted to meters.',
          basis: 'Envelope.TotalBuildingHeightFeet',
          rawField: 'TotalBuildingHeightFeet',
        }
      : {
          provider: 'gridics',
          status: 'inferred',
          detail: 'Metric height inferred from Gridics story count because no explicit feet height was returned.',
          basis: 'Envelope.TotalBuidingHeight x assumed 3.5m floor-to-floor',
          rawField: 'TotalBuidingHeight',
          assumption: 'Assumes 3.5 meters per floor for a preliminary height cap.',
        });
  }
  addValue(geometry, 'setback', {
    value: [frontSetbackMeters, rearSetbackMeters, sideSetbackMeters]
      .filter((value): value is number => value != null)
      .reduce<number | undefined>((max, value) => (max == null ? value : Math.max(max, value)), undefined),
    desc: 'Most restrictive parcel setback currently mapped from Gridics.',
    unit: 'm',
  });
  addValue(geometry, 'front_setback', {
    value: frontSetbackMeters,
    desc: 'Front setback mapped from Gridics frontage and envelope data.',
    unit: 'm',
  });
  addValue(geometry, 'rear_setback', {
    value: rearSetbackMeters,
    desc: 'Rear setback mapped from Gridics envelope data.',
    unit: 'm',
  });
  addValue(geometry, 'side_setback', {
    value: sideSetbackMeters,
    desc: 'Side setback mapped from Gridics envelope data.',
    unit: 'm',
    includeWhenEmpty: true,
  });
  setFieldProvenance(fieldProvenance, 'geometry', 'side_setback', sideSetbackMeters != null
    ? {
        provider: 'gridics',
        status: 'explicit',
        detail: 'Side setback came directly from the Gridics parcel envelope/calibration payload.',
        basis: 'Envelope/calibration side setback fields',
        rawField: ['Envelope', 'CalibrationGeneral'],
      }
    : {
        provider: 'gridics',
        status: 'missing',
        detail: 'Gridics did not return a parcel-explicit side setback for this record.',
        basis: 'No usable side setback field in the envelope/calibration payload',
        rawField: ['Envelope', 'CalibrationGeneral'],
      });
  addValue(geometry, 'road_width', {
    value: roadWidthMeters,
    desc: 'Right-of-way width mapped from Gridics frontage data.',
    unit: 'm',
  });
  addValue(geometry, 'minimum_frontage_width', {
    value: frontageMeters,
    desc: 'Longest primary frontage segment mapped from Gridics.',
    unit: 'm',
  });
  addValue(geometry, 'units_per_acre', {
    value: unitsPerAcre,
    desc: 'Residential density allowance returned by Gridics.',
    unit: 'du/ac',
  });
  addValue(geometry, 'density_norms', {
    value: maxUnits,
    desc: 'Maximum dwelling unit count allowed on the parcel.',
    unit: 'units',
    includeWhenEmpty: true,
  });
  setFieldProvenance(fieldProvenance, 'geometry', 'density_norms', maxUnits != null
    ? {
        provider: 'gridics',
        status: 'explicit',
        detail: 'Allowed unit count came directly from the Gridics parcel envelope.',
        basis: 'Envelope.DensityUnits',
        rawField: 'DensityUnits',
      }
    : {
        provider: 'gridics',
        status: 'missing',
        detail: 'Gridics did not return an explicit allowed unit count for this parcel.',
        basis: 'No parcel-level DensityUnits value was present',
        rawField: 'DensityUnits',
      });
  addValue(geometry, 'open_space', {
    value: openSpace,
    desc: 'Minimum open space requirement returned by Gridics.',
    unit: '%',
  });
  addValue(geometry, 'minimum_plot_size', {
    value: parcelAreaSqm,
    desc: 'Parcel area from Gridics lot geometry for feasibility context.',
    unit: 'sqm',
  });
  addValue(geometry, 'max_buildable_area', {
    value: maxBuildableAreaSqm,
    desc: 'Maximum buildable area allowed by Gridics.',
    unit: 'sqm',
  });
  addValue(geometry, 'max_building_footprint', {
    value: maxFootprintSqm,
    desc: 'Maximum building footprint allowed by Gridics.',
    unit: 'sqm',
  });

  addValue(highrise, 'max_floors', {
    value: maxFloors,
    desc: 'Maximum story count returned by Gridics.',
    unit: 'stories',
  });
  addValue(highrise, 'max_building_height', {
    value: inferredHeightMeters,
    desc: explicitHeightMeters
      ? 'Maximum building height converted from Gridics feet to meters.'
      : 'Estimated from story count because Gridics did not return an explicit feet height for this parcel.',
    unit: 'm',
  });
  if (inferredHeightMeters != null) {
    setFieldProvenance(fieldProvenance, 'highrise', 'max_building_height', explicitHeightMeters != null
      ? {
          provider: 'gridics',
          status: 'explicit',
          detail: 'High-rise max height is an explicit Gridics height converted to meters.',
          basis: 'Envelope.TotalBuildingHeightFeet',
          rawField: 'TotalBuildingHeightFeet',
        }
      : {
          provider: 'gridics',
          status: 'inferred',
          detail: 'High-rise max height was inferred from Gridics story count.',
          basis: 'Envelope.TotalBuidingHeight x assumed 3.5m floor-to-floor',
          rawField: 'TotalBuidingHeight',
          assumption: 'Assumes 3.5 meters per floor for preliminary analysis.',
        });
  }

  addValue(sustainability, 'open_space', {
    value: openSpace,
    desc: 'Minimum open space requirement returned by Gridics.',
    unit: '%',
  });

  addValue(administration, 'permitted_use_categories', {
    value: permittedUseCategories,
    desc: 'Allowed use categories derived from Gridics permitted-use statistics.',
  });
  addValue(administration, 'permitted_uses', {
    value: permittedUses,
    desc: 'Allowed and conditionally allowed uses derived from Gridics.',
  });
  addValue(administration, 'special_zones', {
    value: overlays,
    desc: 'Applicable overlays and special zones returned by Gridics.',
  });
  addValue(administration, 'zoning_regulation_name', {
    value: zoningAllowance?.ZoningRegulationName,
    desc: 'Underlying zoning code / regulation name in Gridics.',
  });
  addValue(administration, 'zoning_regulation_link', {
    value: zoningAllowance?.ZoningRegulationLink,
    desc: 'Gridics code reference link for this zoning district.',
  });
  addValue(administration, 'gridics_group_id', {
    value: record.GroupId,
    desc: 'Gridics parcel group identifier.',
  });
  addValue(administration, 'parcel_id', {
    value: record.FolioNumber,
    desc: 'Parcel identifier / folio returned by Gridics.',
  });
  addValue(administration, 'lot_type', {
    value: lotTypeLabel(record.LotType),
    desc: 'Lot type classification returned by Gridics.',
  });
  addValue(administration, 'calculation_status', {
    value: record.CalculationStatus,
    desc: 'Gridics calculation status for this property record.',
  });
  addValue(administration, 'frontage_details', {
    value: frontages.map((frontage) => ({
      label: frontage.Label,
      frontageType: frontage.FrontageType,
      setbackMeters: firstMetricValue(frontage.Setback),
      rightOfWayMeters: feetToMeters(toNumber(frontage.MinThoroughfareWidth)),
      segmentLengthMeters: parseFrontageLengthMeters(frontage),
    })),
    desc: 'Frontage-level parcel details returned by Gridics.',
  });
  addValue(administration, 'building_envelope_available', {
    value: Boolean(buildGridicsArtifacts(building)?.gridics?.envelopeGeometry),
    desc: 'Whether Gridics returned parcel/building-envelope geometry for this record.',
  });
  addValue(administration, 'source', {
    value: 'Gridics',
    desc: 'Primary zoning/buildability provider.',
  });
  addValue(facilities, 'parking', {
    value: overlays.find((overlay) => /parking/i.test(overlay)) ? overlays.filter((overlay) => /parking/i.test(overlay)) : undefined,
    desc: 'Parking-related overlays returned by Gridics when available.',
  });
  addValue(safetyAndServices, 'fire_safety', {
    value: overlays.find((overlay) => /fire|faa/i.test(overlay)) ? overlays.filter((overlay) => /fire|faa/i.test(overlay)) : undefined,
    desc: 'Fire / aviation-related overlays returned by Gridics when available.',
  });

  return {
    id: buildRegulationId(record.GroupId, useLabel),
    location: locationLabel,
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: record.State,
    city: record.City,
    jurisdictionLevel: 'city',
    codeFamily: 'Gridics Zoning API',
    type: `${useLabel} (Gridics Parcel)`,
    geometry,
    highrise,
    facilities,
    sustainability,
    safety_and_services: safetyAndServices,
    administration,
    accessibility: {},
    sourceInfo: {
      provider: 'gridics',
      label: 'Gridics',
      confidence: deriveSourceConfidence({ inferredFields, missingFields }),
      detail: zoneCode !== 'Unknown' ? `Parcel-specific zoning: ${zoneCode}` : undefined,
      gridicsGroupId: record.GroupId,
      zoneCode: zoneCode !== 'Unknown' ? zoneCode : undefined,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
    },
    fieldProvenance,
  };
}

export function gridicsPropertyRecordToArtifacts(record: GridicsPropertyRecord): RegulationArtifacts | null {
  return buildGridicsArtifacts(record.Buildings?.[0]);
}

export const GridicsService = {
  async getPropertyRecord(input: GridicsLookupInput) {
    return fetchGridicsPropertyRecord(input);
  },

  async getNormalizedResult(input: GridicsLookupInput): Promise<GridicsNormalizedResult | null> {
    const record = await fetchGridicsPropertyRecord(input);
    if (!record) return null;

    return {
      regulation: gridicsPropertyRecordToRegulationData(record, input),
      artifacts: gridicsPropertyRecordToArtifacts(record),
      propertyRecord: record,
    };
  },

  async getRegulationData(input: GridicsLookupInput): Promise<RegulationData | null> {
    const normalized = await this.getNormalizedResult(input);
    return normalized?.regulation || null;
  },

  async getArtifacts(input: GridicsLookupInput): Promise<RegulationArtifacts | null> {
    const normalized = await this.getNormalizedResult(input);
    return normalized?.artifacts || null;
  },
};

export default GridicsService;
