/**
 * US Parcel Fetcher
 *
 * Fetches parcel/property overlays from Realie for display on the Mapbox map.
 * Realie returns normalized parcel records with point and, when available,
 * parcel polygon geometry. If a record only has point coordinates, we build a
 * small approximate footprint so existing map overlay behavior still works.
 */

import type { FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import {
    getRealieAssessedValue,
    getRealieCoordinates,
    getRealieLotAreaSqFt,
    searchRealiePropertiesByLocation,
    type RealiePropertyRecord,
} from './us-parcel-service';

export interface ParcelProperties {
    id: string;
    owner: string;
    address: string;
    apn: string;
    assessedValue?: number;
    zoning?: string;
    areaSqft?: number;
    county: string;
    source: 'Realie';
}

function isSupportedUSCoordinate(lng: number, lat: number): boolean {
    return lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66;
}

function milesBetweenLngLat(a: [number, number], b: [number, number]): number {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthMiles = 3958.8;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthMiles * Math.asin(Math.sqrt(h));
}

function getSearchRadiusMiles(bounds: { west: number; south: number; east: number; north: number }): number {
    const center: [number, number] = [
        (bounds.west + bounds.east) / 2,
        (bounds.south + bounds.north) / 2,
    ];
    const corner: [number, number] = [bounds.east, bounds.north];
    return Math.min(2, Math.max(0.05, milesBetweenLngLat(center, corner)));
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

function isWithinBounds(coordinates: [number, number] | undefined, bounds: { west: number; south: number; east: number; north: number }) {
    if (!coordinates) return true;
    const [lng, lat] = coordinates;
    return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function toParcelFeature(
    property: RealiePropertyRecord,
    index: number,
): FeatureCollection<Polygon | MultiPolygon, ParcelProperties>['features'][number] | null {
    const coordinates = getRealieCoordinates(property);
    const areaSqft = getRealieLotAreaSqFt(property);
    const geometry = isPolygonalGeometry(property.geometry)
        ? property.geometry
        : coordinates
            ? createApproximateParcelGeometry(coordinates, areaSqft)
            : null;

    if (!geometry) return null;

    return {
        type: 'Feature',
        geometry,
        properties: {
            id: String(property.parcelId || `realie-parcel-${index}`),
            owner: String(property.ownerName || 'Unknown'),
            address: String(property.addressFull || property.address || property.addressRaw || ''),
            apn: String(property.parcelId || ''),
            assessedValue: getRealieAssessedValue(property) || undefined,
            zoning: property.zoningCode ? String(property.zoningCode) : undefined,
            areaSqft: areaSqft || undefined,
            county: [property.county, property.state].filter(Boolean).join(', ') || 'US Property',
            source: 'Realie',
        },
    };
}

export async function fetchParcelsInBounds(
    bounds: { west: number; south: number; east: number; north: number },
    _locationHint?: string,
): Promise<FeatureCollection<Polygon | MultiPolygon, ParcelProperties>> {
    const centerLng = (bounds.west + bounds.east) / 2;
    const centerLat = (bounds.south + bounds.north) / 2;

    if (!isSupportedUSCoordinate(centerLng, centerLat)) {
        return { type: 'FeatureCollection', features: [] };
    }

    try {
        const properties = await searchRealiePropertiesByLocation({
            longitude: centerLng,
            latitude: centerLat,
            radius: getSearchRadiusMiles(bounds),
            limit: 100,
        });

        return {
            type: 'FeatureCollection',
            features: properties
                .filter((property) => isWithinBounds(getRealieCoordinates(property), bounds))
                .map(toParcelFeature)
                .filter((feature): feature is FeatureCollection<Polygon | MultiPolygon, ParcelProperties>['features'][number] => feature !== null),
        };
    } catch (error) {
        console.warn('[USParcelFetcher] Realie fetch failed:', error);
        return { type: 'FeatureCollection', features: [] };
    }
}

export function isInSupportedUSCounty(lng: number, lat: number): boolean {
    return isSupportedUSCoordinate(lng, lat);
}

export function getCountyLabel(lng: number, lat: number): string | null {
    return isSupportedUSCoordinate(lng, lat) ? 'Realie US coverage' : null;
}

export default {
    fetchParcelsInBounds,
    isInSupportedUSCounty,
    getCountyLabel,
};
