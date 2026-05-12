/**
 * US Parcel & Title Data Service
 *
 * Fetches parcel, ownership, value, mortgage/lien, zoning, and geometry data
 * from Realie. Realie normalizes US public property records behind a single
 * API, which lets this service replace the previous county-by-county ArcGIS
 * parcel lookup without changing the downstream Keystone data shape.
 *
 * Required env:
 * REALIE_API_KEY
 */

import type { Geometry } from 'geojson';

export interface USTitleOwnership {
    ownerName: string;
    ownerType: 'Corporate' | 'Individual' | 'Government' | 'Trust';
    lastSaleDate: string;
    lastSalePrice: number;
    assessedValue: number;
}

export interface USZoningInfo {
    zoningCode: string;
    zoningDescription: string;
    jurisdiction: string;
    floodZone: string; // FEMA designation: X, A, AE, V, etc.
}

export interface USEncumbrance {
    type: 'Lien' | 'Easement' | 'Deed Restriction' | 'Mortgage';
    description: string;
    amount?: number;
    status: 'Active' | 'Cleared';
}

export interface USDueDiligenceInfo {
    altaSurveyStatus: 'Available' | 'Required' | 'In Progress';
    relativePositionalPrecision: string;
    recognizedEnvironmentalConditions: string;
    titleCommitmentStatus: 'Issued' | 'Pending' | 'Exceptions Noted';
}

export interface USParcelData {
    parcelId: string; // APN (Assessor's Parcel Number)
    lotAreaSqFt: number;
    address?: string;
    coordinates?: [number, number];
    geometry?: Geometry;
    title: USTitleOwnership;
    zoning: USZoningInfo;
    encumbrances: USEncumbrance[];
    dueDiligence: USDueDiligenceInfo;
    altaSurveyAvailable: boolean;
    source: 'realie' | 'llm' | 'fallback';
}

const REALIE_BASE_URL = 'https://app.realie.ai/api/public';

export interface RealiePropertyRecord {
    parcelId?: string;
    address?: string;
    addressRaw?: string;
    addressFull?: string;
    county?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    ownerName?: string;
    zoningCode?: string;
    jurisdiction?: string;
    acres?: number | string;
    landArea?: number | string;
    totalAssessedValue?: number | string;
    totalMarketValue?: number | string;
    totalLandValue?: number | string;
    modelValue?: number | string;
    transferDate?: string;
    transferDateObject?: string;
    transferPrice?: number | string;
    totalLienCount?: number | string;
    totalLienBalance?: number | string;
    lenderName?: string;
    longitude?: number | string;
    latitude?: number | string;
    location?: {
        type?: string;
        coordinates?: [number, number];
    };
    geometry?: Geometry;
    residential?: boolean;
    useCode?: string | number;
    [key: string]: unknown;
}

export interface RealieLocationSearchOptions {
    longitude: number;
    latitude: number;
    radius?: number;
    limit?: number;
    offset?: number;
    residential?: boolean;
}

export interface RealiePropertySearchOptions {
    state: string;
    county?: string;
    city?: string;
    address?: string;
    zipCode?: string;
    includeUnassignedAddress?: boolean;
    limit?: number;
    cursor?: string;
    offset?: number;
}

function getRealieApiKey(): string | null {
    return process.env.REALIE_API_KEY?.trim() || null;
}

function toNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[$,]/g, ''));
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function compactParams(params: Record<string, unknown>): URLSearchParams {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
    }
    return search;
}

async function fetchRealie<T>(path: string, params: URLSearchParams): Promise<T | null> {
    const apiKey = getRealieApiKey();
    if (!apiKey) {
        console.warn('[USParcelService] REALIE_API_KEY not set; falling back to generated parcel data.');
        return null;
    }

    const url = `${REALIE_BASE_URL}${path}?${params.toString()}`;
    const res = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(15000),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Realie HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
    }

    return res.json() as Promise<T>;
}

export function getRealieCoordinates(property: RealiePropertyRecord): [number, number] | undefined {
    const locationCoordinates = property.location?.coordinates;
    if (
        Array.isArray(locationCoordinates) &&
        locationCoordinates.length >= 2 &&
        Number.isFinite(Number(locationCoordinates[0])) &&
        Number.isFinite(Number(locationCoordinates[1]))
    ) {
        return [Number(locationCoordinates[0]), Number(locationCoordinates[1])];
    }

    const lng = toNumber(property.longitude, NaN);
    const lat = toNumber(property.latitude, NaN);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : undefined;
}

function normalizeDate(value: unknown): string {
    if (!value) return 'N/A';
    const text = String(value);
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    return text.slice(0, 10);
}

function inferOwnerType(ownerName: string): USTitleOwnership['ownerType'] {
    const upperOwner = ownerName.toUpperCase();
    if (/LLC|INC|CORP|LTD|COMPANY| LP\b|PARTNERS|HOLDINGS|PROPERTIES|DEVELOP/.test(upperOwner)) return 'Corporate';
    if (/TRUST|ESTATE|TRUSTEE/.test(upperOwner)) return 'Trust';
    if (/CITY|COUNTY|STATE|GOVERNMENT|MUNICIPAL|SCHOOL|PUBLIC|AUTHORITY/.test(upperOwner)) return 'Government';
    return 'Individual';
}

function buildEncumbrances(property: RealiePropertyRecord): USEncumbrance[] {
    const lienCount = Math.max(0, Math.round(toNumber(property.totalLienCount)));
    const lienBalance = toNumber(property.totalLienBalance);
    if (lienCount <= 0 && lienBalance <= 0) return [];

    return [{
        type: 'Lien',
        description: lienBalance > 0
            ? `Realie reports ${lienCount || 1} lien record(s) with an estimated balance of $${Math.round(lienBalance).toLocaleString()}.`
            : `Realie reports ${lienCount} lien record(s).`,
        amount: lienBalance > 0 ? lienBalance : undefined,
        status: 'Active',
    }];
}

export function getRealieLotAreaSqFt(property: RealiePropertyRecord): number {
    const landArea = toNumber(property.landArea);
    if (landArea > 0) return Math.round(landArea);

    const acres = toNumber(property.acres);
    return acres > 0 ? Math.round(acres * 43560) : 0;
}

export function getRealieAssessedValue(property: RealiePropertyRecord): number {
    return (
        toNumber(property.totalAssessedValue) ||
        toNumber(property.totalMarketValue) ||
        toNumber(property.totalLandValue) ||
        toNumber(property.modelValue)
    );
}

export function realiePropertyToUSParcelData(
    property: RealiePropertyRecord,
    options: { fallbackLocation?: string; fallbackAreaSqm?: number; floodZone?: string } = {},
): USParcelData {
    const assessedValue = getRealieAssessedValue(property);
    const transferPrice = toNumber(property.transferPrice);
    const ownerName = String(property.ownerName || 'Owner on Record').trim();
    const zoningCode = String(property.zoningCode || property.useCode || 'Unknown').trim();
    const lotAreaSqFt = getRealieLotAreaSqFt(property) || Math.round((options.fallbackAreaSqm || 0) * 10.7639);
    const fullAddress = String(property.addressFull || property.address || property.addressRaw || options.fallbackLocation || '').trim();

    return {
        parcelId: String(property.parcelId || 'Unknown').trim(),
        lotAreaSqFt,
        address: fullAddress || undefined,
        coordinates: getRealieCoordinates(property),
        geometry: property.geometry,
        title: {
            ownerName,
            ownerType: inferOwnerType(ownerName),
            lastSaleDate: normalizeDate(property.transferDateObject || property.transferDate),
            lastSalePrice: transferPrice || Math.round(assessedValue * 0.85),
            assessedValue,
        },
        zoning: {
            zoningCode,
            zoningDescription: USParcelService.inferZoningDescription(zoningCode),
            jurisdiction: String(property.jurisdiction || property.county || property.city || 'County').trim(),
            floodZone: options.floodZone || 'Unknown',
        },
        encumbrances: buildEncumbrances(property),
        dueDiligence: {
            altaSurveyStatus: property.geometry ? 'Available' : 'Required',
            relativePositionalPrecision: property.geometry ? 'Parcel geometry provided by Realie' : 'Boundary survey recommended',
            recognizedEnvironmentalConditions: 'Phase I ESA Recommended',
            titleCommitmentStatus: 'Pending',
        },
        altaSurveyAvailable: Boolean(property.geometry),
        source: 'realie',
    };
}

export async function searchRealiePropertiesByLocation(
    options: RealieLocationSearchOptions,
): Promise<RealiePropertyRecord[]> {
    const params = compactParams({
        longitude: options.longitude,
        latitude: options.latitude,
        radius: Math.min(2, Math.max(0, options.radius ?? 0.25)),
        limit: Math.min(100, Math.max(1, options.limit ?? 10)),
        offset: Math.max(0, options.offset ?? 0),
        residential: options.residential,
    });

    const data = await fetchRealie<{ properties?: RealiePropertyRecord[] }>('/property/location/', params);
    return Array.isArray(data?.properties) ? data.properties : [];
}

export async function searchRealieProperties(
    options: RealiePropertySearchOptions,
): Promise<{ properties: RealiePropertyRecord[]; nextCursor?: string; count?: number }> {
    const params = compactParams({
        state: options.state.toUpperCase(),
        county: options.county,
        city: options.city,
        address: options.address,
        zipCode: options.zipCode,
        includeUnassignedAddress: options.includeUnassignedAddress,
        limit: Math.min(100, Math.max(1, options.limit ?? 10)),
        cursor: options.cursor,
        offset: Math.max(0, options.offset ?? 0),
    });

    const data = await fetchRealie<{
        properties?: RealiePropertyRecord[];
        metadata?: { nextCursor?: string; count?: number };
    }>('/property/search/', params);

    return {
        properties: Array.isArray(data?.properties) ? data.properties : [],
        nextCursor: data?.metadata?.nextCursor,
        count: data?.metadata?.count,
    };
}

function distanceSq(a: [number, number], b: [number, number]): number {
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function findBestRealieProperty(
    properties: RealiePropertyRecord[],
    coordinates?: [number, number],
    targetAreaSqFt?: number,
) {
    if (properties.length === 0) return null;
    if (!coordinates && !targetAreaSqFt) return properties[0];

    return [...properties].sort((a, b) => {
        const aCoords = getRealieCoordinates(a);
        const bCoords = getRealieCoordinates(b);
        const aDistance = coordinates && aCoords ? distanceSq(aCoords, coordinates) : Number.MAX_SAFE_INTEGER;
        const bDistance = coordinates && bCoords ? distanceSq(bCoords, coordinates) : Number.MAX_SAFE_INTEGER;
        if (aDistance !== bDistance) return aDistance - bDistance;

        if (targetAreaSqFt) {
            return Math.abs(getRealieLotAreaSqFt(a) - targetAreaSqFt) - Math.abs(getRealieLotAreaSqFt(b) - targetAreaSqFt);
        }

        return 0;
    })[0];
}

export const USParcelService = {
    /**
     * Gets parcel data for a US location.
     * Priority: Realie location search -> LLM -> hardcoded fallback.
     */
    async getParcelData(location: string, areaSqm: number, coordinates?: [number, number]): Promise<USParcelData> {
        if (coordinates) {
            try {
                const properties = await searchRealiePropertiesByLocation({
                    longitude: coordinates[0],
                    latitude: coordinates[1],
                    radius: 0.25,
                    limit: 10,
                });
                const bestProperty = findBestRealieProperty(properties, coordinates, areaSqm * 10.7639);
                if (bestProperty) {
                    console.log(`[USParcelService] Realie parcel data retrieved for ${location}`);
                    const floodZone = await this.fetchFloodZone(coordinates);
                    return realiePropertyToUSParcelData(bestProperty, {
                        fallbackLocation: location,
                        fallbackAreaSqm: areaSqm,
                        floodZone,
                    });
                }
            } catch (err) {
                console.warn('[USParcelService] Realie location search failed:', err);
            }
        }

        return this.getParcelDataViaLLM(location, areaSqm);
    },

    /**
     * Fetch FEMA flood-zone enrichment. Realie supplies property records; FEMA
     * remains the authoritative flood source used elsewhere in the app.
     */
    async fetchFloodZone(coordinates: [number, number]): Promise<string> {
        try {
            const { USEnvironmentalService } = await import('./us-environmental-service');
            const femaData = await USEnvironmentalService.fetchFEMAFloodZone(coordinates[0], coordinates[1]);
            if (femaData) {
                console.log(`[USParcelService] FEMA flood zone: ${femaData.zone} (${femaData.zoneDescription})`);
                return femaData.zone;
            }
        } catch {
            // FEMA fetch failed, keep unknown.
        }
        return 'Unknown';
    },

    /**
     * LLM-based parcel data generation (fallback when Realie data is unavailable).
     */
    async getParcelDataViaLLM(location: string, areaSqm: number): Promise<USParcelData> {
        try {
            const { generateWithFallback } = await import('@/ai/model-fallback');
            const areaSqFt = Math.round(areaSqm * 10.7639);

            const prompt = `You are a commercial real estate county assessor dataset emulator. Generate a highly realistic, plausible parcel profile for a ${areaSqm} sqm (${areaSqFt} sqft) commercial/mixed-use plot located in or around ${location}, US.
Return ONLY valid JSON matching this exact schema:
{
  "parcelId": "A realistic APN format for the county",
  "lotAreaSqFt": ${areaSqFt},
  "title": {
    "ownerName": "A realistic corporate/trust owner name",
    "ownerType": "Corporate or Trust",
    "lastSaleDate": "YYYY-MM-DD",
    "lastSalePrice": number,
    "assessedValue": number
  },
  "zoning": {
    "zoningCode": "Realistic local zoning code",
    "zoningDescription": "Description of that zoning code",
    "jurisdiction": "City or County name",
    "floodZone": "X, A, AE, etc."
  },
  "encumbrances": [
    { "type": "Easement or Lien", "description": "Realistic description", "status": "Active" }
  ],
  "dueDiligence": {
    "altaSurveyStatus": "Required",
    "relativePositionalPrecision": "0.07 feet + 50 ppm",
    "recognizedEnvironmentalConditions": "Phase I ESA Required",
    "titleCommitmentStatus": "Pending"
  },
  "altaSurveyAvailable": false
}
Do not include markdown or extra text.`;

            const response = await generateWithFallback(prompt, 'gemini');

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in LLM response');

            const data = JSON.parse(jsonMatch[0]);

            console.log(`[USParcelService] LLM parcel data generated for ${location}`);
            return { ...data, altaSurveyAvailable: data.altaSurveyAvailable ?? false, source: 'llm' };
        } catch (error) {
            console.error('[USParcelService] LLM parcel fallback failed:', error);
            return this.getHardcodedFallback(location, areaSqm);
        }
    },

    /**
     * Hardcoded fallback (last resort).
     */
    getHardcodedFallback(location: string, areaSqm: number): USParcelData {
        const areaSqFt = Math.round(areaSqm * 10.7639);
        return {
            parcelId: `APN-${Math.floor(Math.random() * 10000000)}`,
            lotAreaSqFt: areaSqFt,
            address: location,
            title: {
                ownerName: 'National Holdings LLC',
                ownerType: 'Corporate',
                lastSaleDate: '2018-05-12',
                lastSalePrice: 1500000,
                assessedValue: 1850000,
            },
            zoning: {
                zoningCode: 'C-2',
                zoningDescription: 'General Commercial',
                jurisdiction: 'County',
                floodZone: 'Unknown',
            },
            encumbrances: [],
            dueDiligence: {
                altaSurveyStatus: 'Required',
                relativePositionalPrecision: 'Boundary survey recommended',
                recognizedEnvironmentalConditions: 'Phase I ESA Recommended',
                titleCommitmentStatus: 'Pending',
            },
            altaSurveyAvailable: false,
            source: 'fallback',
        };
    },

    /**
     * Infer a human-readable zoning description from a code.
     */
    inferZoningDescription(code: string): string {
        const upper = code.toUpperCase();
        if (/^R-?[1-5]|^SF|^RS|RESIDENTIAL/.test(upper)) return 'Single/Multi-Family Residential';
        if (/^C-?[1-5]|^CBD|^GC|COMMERCIAL|^CS/.test(upper)) return 'General Commercial';
        if (/^MU|^MX|MIXED/.test(upper)) return 'Mixed Use';
        if (/^I-?[1-3]|^LI|^HI|INDUSTRIAL/.test(upper)) return 'Industrial';
        if (/^O-?[1-3]|OFFICE/.test(upper)) return 'Office';
        if (/^PD|PLANNED/.test(upper)) return 'Planned Development';
        if (/^A-?[1-3]|^AG|AGRICULTURAL/.test(upper)) return 'Agricultural';
        if (/^P-?[1-3]|PUBLIC|INSTITUTIONAL/.test(upper)) return 'Public/Institutional';
        return code;
    },
};

export default USParcelService;
