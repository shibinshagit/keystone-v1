import { NextRequest, NextResponse } from 'next/server';
import type { Geometry, MultiPolygon, Polygon } from 'geojson';
import {
    getRealieAssessedValue,
    getRealieCoordinates,
    getRealieLotAreaSqFt,
    searchRealiePropertiesByLocation,
    type RealiePropertyRecord,
} from '@/services/us/us-parcel-service';

/**
 * US Parcel Search API
 *
 * Uses Realie's normalized US property API instead of city/county-specific
 * ArcGIS FeatureServer queries. The response shape intentionally matches the
 * prior ArcGIS-backed endpoint so recommended parcels continue to render in
 * the existing UI.
 */

interface ParcelSearchParams {
    location: string;
    coordinates: [number, number];
    intendedUse?: string;
    zoningPreference?: string;
    plotType?: string;
    priceRange?: string;
    minAreaSqft?: number;
    maxAreaSqft?: number;
    targetAreaSqft?: number;
    minValue?: number;
    maxValue?: number;
    maxResults?: number;
}

function getAreaStrategy(
    params: ParcelSearchParams,
): { minArea: number; maxArea: number; criteria: string; radiusMiles: number } {
    const use = (params.intendedUse || '').toLowerCase();
    const pref = (params.zoningPreference || '').toLowerCase();
    const plot = (params.plotType || '').toLowerCase();

    if (params.minAreaSqft && params.maxAreaSqft && Number.isFinite(params.maxAreaSqft)) {
        let radiusMiles = 2;
        if (pref.includes('built') || pref.includes('mixed')) radiusMiles = 1.25;
        if (plot.includes('vacant')) radiusMiles = 1.5;

        return {
            minArea: params.minAreaSqft,
            maxArea: params.maxAreaSqft,
            radiusMiles,
            criteria: `Size: ${Math.round(params.minAreaSqft).toLocaleString()}-${Math.round(params.maxAreaSqft).toLocaleString()} sqft | ${params.intendedUse || 'Any'} | ${params.zoningPreference || 'Any'} | ${params.plotType || 'Any'}`,
        };
    }

    if (pref.includes('industrial') || use.includes('industrial')) {
        return { minArea: 100000, maxArea: 10000000, radiusMiles: 2, criteria: 'Industrial large lots' };
    }
    if (pref.includes('agricultural') || pref.includes('waste')) {
        return { minArea: 50000, maxArea: 5000000, radiusMiles: 2, criteria: 'Agricultural/rural large plots' };
    }
    if ((use.includes('commercial') || use.includes('mixed')) && plot.includes('vacant')) {
        return { minArea: 10000, maxArea: 300000, radiusMiles: 2, criteria: 'Vacant commercial development plots' };
    }
    if (use.includes('residential') && (plot.includes('vacant') || pref.includes('vacant'))) {
        return { minArea: 2000, maxArea: 40000, radiusMiles: 1.5, criteria: 'Vacant residential lots' };
    }
    if (plot.includes('redevelopment') || plot.includes('both')) {
        return { minArea: 8000, maxArea: 300000, radiusMiles: 1.5, criteria: 'Redevelopment candidate parcels' };
    }

    return { minArea: 3000, maxArea: 200000, radiusMiles: 1.5, criteria: 'General medium parcels' };
}

function createApproximateParcelGeometry(
    coordinates: [number, number],
    areaSqft: number,
): Polygon {
    const [lng, lat] = coordinates;
    const sideFeet = Math.sqrt(Math.max(areaSqft, 2500));
    const latDelta = sideFeet / 364000;
    const lngDelta = sideFeet / (364000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return {
        type: 'Polygon',
        coordinates: [[
            [lng - lngDelta / 2, lat - latDelta / 2],
            [lng + lngDelta / 2, lat - latDelta / 2],
            [lng + lngDelta / 2, lat + latDelta / 2],
            [lng - lngDelta / 2, lat + latDelta / 2],
            [lng - lngDelta / 2, lat - latDelta / 2],
        ]],
    };
}

function isPolygonalGeometry(geometry: Geometry | undefined): geometry is Polygon | MultiPolygon {
    return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function computeCentroid(geometry: Polygon | MultiPolygon | undefined, fallback?: [number, number]): [number, number] | null {
    if (!geometry) return fallback ?? null;
    const rings = geometry.type === 'Polygon'
        ? geometry.coordinates
        : geometry.coordinates.flatMap((polygon) => polygon);
    const coords = rings.flatMap((ring) => ring);
    if (coords.length === 0) return fallback ?? null;

    const [lngSum, latSum] = coords.reduce(
        (sum, coord) => [sum[0] + Number(coord[0]), sum[1] + Number(coord[1])],
        [0, 0],
    );
    return [lngSum / coords.length, latSum / coords.length];
}

function getZoningMatchScore(zoning: string, intendedUse: string): number {
    if (!zoning || !intendedUse) return 0;
    const z = zoning.toLowerCase();
    const use = intendedUse.toLowerCase();

    if (use.includes('industrial') && (z.match(/\b(i|li|mi|ip|ind)\b/) || z.includes('industrial'))) return 100;
    if (use.includes('commercial') && (z.match(/\b(c|cs|gr|b|com)\b/) || z.includes('commercial') || z.includes('retail'))) return 100;
    if (use.includes('residential') && (z.match(/\b(r|sf|mf|res)\b/) || z.includes('residential') || z.includes('housing'))) return 100;
    if ((z.includes('mu') || z.includes('mixed')) && (use.includes('commercial') || use.includes('residential'))) return 50;

    return 0;
}

function matchesFilters(property: RealiePropertyRecord, params: ParcelSearchParams, strategy: ReturnType<typeof getAreaStrategy>) {
    const areaSqft = getRealieLotAreaSqFt(property);
    const assessedValue = getRealieAssessedValue(property);

    if (areaSqft > 0 && (areaSqft < strategy.minArea || areaSqft > strategy.maxArea)) return false;
    if (params.minValue && assessedValue > 0 && assessedValue < params.minValue) return false;
    if (params.maxValue && assessedValue > 0 && assessedValue > params.maxValue) return false;

    return true;
}

function toParcelResult(property: RealiePropertyRecord, index: number) {
    const coordinates = getRealieCoordinates(property);
    const areaSqft = getRealieLotAreaSqFt(property);
    const geometry = isPolygonalGeometry(property.geometry)
        ? property.geometry
        : coordinates
            ? createApproximateParcelGeometry(coordinates, areaSqft)
            : undefined;
    const centroid = computeCentroid(geometry, coordinates);

    if (!geometry || !centroid) return null;

    return {
        geometry,
        centroid,
        apn: String(property.parcelId || ''),
        address: String(property.addressFull || property.address || property.addressRaw || ''),
        zoning: String(property.zoningCode || property.useCode || ''),
        assessedValue: getRealieAssessedValue(property),
        areaSqft: areaSqft > 0 ? Math.round(areaSqft) : 0,
        areaSqm: areaSqft > 0 ? Math.round(areaSqft / 10.7639) : 0,
        county: [property.county, property.state].filter(Boolean).join(', ') || 'Realie US Property',
        source: 'Realie',
        id: String(property.parcelId || `realie-parcel-${index}`),
    };
}

function buildFallbackParcelResult(params: ParcelSearchParams) {
    const areaSqft = Math.max(
        2500,
        Math.round(
            params.targetAreaSqft ||
            params.maxAreaSqft ||
            params.minAreaSqft ||
            12000,
        ),
    );
    const geometry = createApproximateParcelGeometry(params.coordinates, areaSqft);
    const centroid = computeCentroid(geometry, params.coordinates) || params.coordinates;

    return {
        geometry,
        centroid,
        apn: `fallback-${Math.abs(Math.round(params.coordinates[0] * 10000))}-${Math.abs(Math.round(params.coordinates[1] * 10000))}`,
        address: params.location,
        zoning: params.zoningPreference || params.intendedUse || 'Unknown',
        assessedValue: 0,
        areaSqft,
        areaSqm: Math.round(areaSqft / 10.7639),
        county: 'Fallback parcel estimate',
        source: 'Fallback',
        id: `fallback-${Math.abs(Math.round(params.coordinates[0] * 10000))}-${Math.abs(Math.round(params.coordinates[1] * 10000))}`,
    };
}

export async function POST(request: NextRequest) {
    try {
        const params: ParcelSearchParams = await request.json();
        const { location, coordinates } = params;

        if (!location || !coordinates) {
            return NextResponse.json({ error: 'location and coordinates are required' }, { status: 400 });
        }

        const [lng, lat] = coordinates;
        const maxResults = params.maxResults || 10;
        const strategy = getAreaStrategy(params);

        console.log(`[ParcelSearch] Querying Realie around ${location}: radius ${strategy.radiusMiles}mi | criteria: ${strategy.criteria}`);

        let realieProperties: RealiePropertyRecord[] = [];
        let realieLookupFailed = false;

        try {
            realieProperties = await searchRealiePropertiesByLocation({
                longitude: lng,
                latitude: lat,
                radius: strategy.radiusMiles,
                limit: 100,
            });
        } catch (error: any) {
            console.warn('[ParcelSearch] Realie lookup failed, returning fallback parcel estimate:', error);
            realieLookupFailed = true;
        }

        let parcels = realieProperties
            .filter((property) => matchesFilters(property, params, strategy))
            .map(toParcelResult)
            .filter((parcel): parcel is NonNullable<typeof parcel> => parcel !== null);

        if (parcels.length === 0 && realieProperties.length > 0) {
            parcels = realieProperties
                .map(toParcelResult)
                .filter((parcel): parcel is NonNullable<typeof parcel> => parcel !== null);
        }

        parcels.sort((a, b) => {
            const matchA = getZoningMatchScore(a.zoning, params.intendedUse || '');
            const matchB = getZoningMatchScore(b.zoning, params.intendedUse || '');
            if (matchA !== matchB) return matchB - matchA;

            if (params.targetAreaSqft && params.targetAreaSqft > 0) {
                return Math.abs(a.areaSqft - params.targetAreaSqft) - Math.abs(b.areaSqft - params.targetAreaSqft);
            }

            return 0;
        });

        parcels = parcels.slice(0, maxResults);

        if (parcels.length === 0 && realieLookupFailed) {
            parcels = [buildFallbackParcelResult(params)];
        }

        return NextResponse.json({
            success: true,
            parcels,
            county: 'Realie US coverage',
            totalFound: realieProperties.length,
            searchCriteria: strategy.criteria,
            filters: {
                intendedUse: params.intendedUse || 'Any',
                zoningPreference: params.zoningPreference || 'Any',
                plotType: params.plotType || 'Any',
                priceRange: params.priceRange || 'Any',
                areaRange: `${Math.round(strategy.minArea).toLocaleString()}-${Math.round(strategy.maxArea).toLocaleString()} sqft`,
            },
            source: 'Realie',
            message: parcels.length > 0
                ? undefined
                : 'No Realie properties found in this area for the requested criteria.',
        });
    } catch (error: any) {
        console.error('[ParcelSearch] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
