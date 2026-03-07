/**
 * Geometry Utilities for Building Generation
 * Handles peripheral clear zones, setbacks, and buildable area calculations
 */

import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Position } from 'geojson';

/**
 * Calculates a destination point based on a starting point, distance, and bearing
 * using a planar approximation. This is often faster and sufficient for small-scale
 * site planning than spherical calculations.
 * 
 * @param origin - [lng, lat] starting point
 * @param distance - distance in meters
 * @param bearing - bearing in degrees (0 = North, 90 = East, etc.)
 * @returns [lng, lat] destination point
 */
export function planarDestination(
    origin: Position,
    distance: number,
    bearing: number
): Position {
    const lat = origin[1];
    const lng = origin[0];

    // Meters per degree latitude (approximate)
    const metersPerDegreeLat = 111111;
    // Meters per degree longitude (adjusts with latitude)
    const metersPerDegreeLng = 111111 * Math.cos(lat * (Math.PI / 180));

    const bearingRad = bearing * (Math.PI / 180);

    const deltaLat = (distance * Math.cos(bearingRad)) / metersPerDegreeLat;
    const deltaLng = (distance * Math.sin(bearingRad)) / metersPerDegreeLng;

    return [lng + deltaLng, lat + deltaLat];
}

/**
 * Convert polygon coordinates to local meters relative to centroid.
 * Returns array of [x, y] in meters.
 */
function toLocalMeters(coords: Position[]): [number, number][] {
    if (coords.length === 0) return [];
    // Use the centroid latitude for conversion
    let sumLat = 0;
    for (const c of coords) sumLat += c[1];
    const refLat = sumLat / coords.length;

    const metersPerDegreeLat = 111111;
    const metersPerDegreeLng = 111111 * Math.cos(refLat * (Math.PI / 180));

    return coords.map(c => [
        c[0] * metersPerDegreeLng,
        c[1] * metersPerDegreeLat
    ]);
}

/**
 * Compute polygon area using the Shoelace formula in planar meters.
 * No earth curvature — accurate for site-scale features (<10km).
 */
export function planarArea(geojson: Feature<Polygon | MultiPolygon> | any): number {
    try {
        const geom = geojson.geometry || geojson;
        if (geom.type === 'Polygon') {
            let area = shoelaceRing(toLocalMeters(geom.coordinates[0]));
            for (let i = 1; i < geom.coordinates.length; i++) {
                // Holes must be strictly subtracted regardless of winding order
                area -= shoelaceRing(toLocalMeters(geom.coordinates[i]));
            }
            return Math.max(0, area); // Ensure we don't return negative area
        } else if (geom.type === 'MultiPolygon') {
            let total = 0;
            for (const poly of geom.coordinates) {
                let polyArea = shoelaceRing(toLocalMeters(poly[0]));
                for (let i = 1; i < poly.length; i++) {
                    polyArea -= shoelaceRing(toLocalMeters(poly[i]));
                }
                total += Math.max(0, polyArea);
            }
            return total;
        }
    } catch (e) {
        console.warn('[planarArea] fallback to turf.area:', e);
    }
    return turf.area(geojson);
}

function shoelaceRing(pts: [number, number][]): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
        area += (pts[i][0] * pts[i + 1][1]) - (pts[i + 1][0] * pts[i][1]);
    }
    // Return ABSOLUTE area for the ring, ignoring clockwise/counter-clockwise winding
    return Math.abs(area / 2);
}

/**
 * Compute polygon perimeter in planar meters (Euclidean distance after local projection).
 */
export function planarPerimeter(geojson: Feature<Polygon | MultiPolygon> | any): number {
    try {
        const geom = geojson.geometry || geojson;
        const ring = geom.type === 'Polygon'
            ? geom.coordinates[0]
            : geom.coordinates[0][0]; // First polygon of MultiPolygon
        const local = toLocalMeters(ring);
        let perimeter = 0;
        for (let i = 0; i < local.length - 1; i++) {
            const dx = local[i + 1][0] - local[i][0];
            const dy = local[i + 1][1] - local[i][1];
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    } catch (e) {
        console.warn('[planarPerimeter] fallback to turf.length');
        const line = turf.polygonToLine(geojson);
        return turf.length(line, { units: 'meters' });
    }
}

/**
 * Derive approximate L × W dimensions from planar area and perimeter.
 * Uses the quadratic formula: s = P/2; L,W = (s ± sqrt(s²-4A))/2
 * Returns { length, width, area } all in meters/m².
 */
export function planarDimensions(geojson: Feature<Polygon | MultiPolygon> | any): { length: number; width: number; area: number } {
    const area = planarArea(geojson);
    const perimeter = planarPerimeter(geojson);

    const s = perimeter / 2;
    const disc = (s * s) - (4 * area);
    let l = 0, w = 0;
    if (disc >= 0) {
        l = (s + Math.sqrt(disc)) / 2;
        w = (s - Math.sqrt(disc)) / 2;
    } else {
        l = Math.sqrt(area);
        w = l;
    }

    return {
        length: Math.max(l, w),
        width: Math.min(l, w),
        area
    };
}

export interface PeripheralZoneConfig {
    parkingWidth: number;
    roadWidth: number;
}

export interface SetbackConfig {
    front?: number;
    rear?: number;
    side?: number;
    general: number;
}

/**
 * Apply 11m Peripheral Clear Zone (5m Parking + 6m Road)
 */
export function applyPeripheralClearZone(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    config: PeripheralZoneConfig = { parkingWidth: 5, roadWidth: 6 }
): {
    buildableArea: Feature<Polygon | MultiPolygon> | null;
    parkingZone: Feature<Polygon | MultiPolygon> | null;
    roadZone: Feature<Polygon | MultiPolygon> | null;
} {
    try {
        const totalClearance = config.parkingWidth + config.roadWidth;

        const cleanedPlot = turf.cleanCoords(plotGeometry);
        const buildable = turf.buffer(cleanedPlot, -totalClearance / 1000, { units: 'kilometers' });

        // buildable area
        if (!buildable || turf.area(buildable) < 100) {
            console.warn('[applyPeripheralClearZone] Buildable area too small or vanished after clearance');
            return { buildableArea: null, parkingZone: null, roadZone: null };
        }

        const buildablePoly = turf.unkinkPolygon(buildable).features.reduce((largest, current) => {
            return turf.area(current) > turf.area(largest) ? current : largest;
        }).geometry;

        const buildableFeature = turf.polygon(buildablePoly.coordinates);

        // parking zone
        const parkingOuter = cleanedPlot;
        const parkingInnerRaw = turf.buffer(cleanedPlot, -config.parkingWidth / 1000, { units: 'kilometers' });

        let parkingInner = parkingInnerRaw;
        if (parkingInner) {
            const piPoly = turf.unkinkPolygon(parkingInner).features.reduce((largest, current) => {
                return turf.area(current) > turf.area(largest) ? current : largest;
            }).geometry;
            parkingInner = turf.polygon(piPoly.coordinates);
        }

        const parkingZone = parkingInner ? turf.difference(parkingOuter, parkingInner) : null;

        // road zone
        const roadOuter = parkingInner;
        const roadInner = buildableFeature;

        const roadZone = roadOuter && roadInner ? turf.difference(roadOuter, roadInner) : null;

        if (roadZone && turf.area(roadZone) > turf.area(cleanedPlot) * 0.9) {
            console.warn('[applyPeripheralClearZone] Road zone seemingly covers entire plot, discarding');
            return { buildableArea: buildableFeature, parkingZone: parkingZone as Feature<Polygon>, roadZone: null };
        }

        return {
            buildableArea: buildableFeature as Feature<Polygon>,
            parkingZone: parkingZone as Feature<Polygon> | null,
            roadZone: roadZone as Feature<Polygon> | null
        };
    } catch (error) {
        console.error('[applyPeripheralClearZone] Error:', error);
        return { buildableArea: null, parkingZone: null, roadZone: null };
    }
}

/**
 * Apply setbacks with corner handling
 */
export function applyRobustSetbacks(
    geometry: Feature<Polygon | MultiPolygon>,
    setback: number
): Feature<Polygon | MultiPolygon> | null {
    try {
        if (setback <= 0) return geometry;

        const buffered = turf.buffer(geometry, -setback / 1000, { units: 'kilometers' });

        if (!buffered || turf.area(buffered) < 50) {
            console.warn('[applyRobustSetbacks] Area vanished or too small after setback');
            return null;
        }

        return buffered as Feature<Polygon | MultiPolygon>;
    } catch (error) {
        console.error('[applyRobustSetbacks] Error:', error);
        return null;
    }
}

/**
 * Ensure minimum corner clearance between building segments
 */
export function ensureCornerClearance(
    buildingFootprints: Feature<Polygon>[],
    minClearance: number = 3
): Feature<Polygon>[] {
    const result: Feature<Polygon>[] = [];

    for (let i = 0; i < buildingFootprints.length; i++) {
        let building = buildingFootprints[i];
        let hasOverlap = false;

        for (let j = 0; j < buildingFootprints.length; j++) {
            if (i === j) continue;

            const other = buildingFootprints[j];
            const distance = turf.distance(
                turf.centroid(building),
                turf.centroid(other),
                { units: 'meters' }
            );

            if (distance < minClearance * 2) {
                const shrunk = turf.buffer(building, -minClearance / 2000, { units: 'kilometers' });
                if (shrunk && turf.area(shrunk) > 50) {
                    building = shrunk as Feature<Polygon>;
                    hasOverlap = true;
                }
            }
        }

        result.push(building);
    }

    return result;
}

/**
 * Deduct obstacle areas from buildable area
 */
export function deductObstacles(
    buildableArea: Feature<Polygon | MultiPolygon>,
    obstacles: Feature<Polygon | MultiPolygon>[]
): Feature<Polygon | MultiPolygon> | null {
    try {
        let result = buildableArea;

        for (const obstacle of obstacles) {
            if (!obstacle) continue;

            const diff = turf.difference(result, obstacle);
            if (!diff) {
                console.warn('[deductObstacles] Obstacle consumed entire buildable area');
                return null;
            }
            result = diff as Feature<Polygon | MultiPolygon>;
        }

        return result;
    } catch (error) {
        console.error('[deductObstacles] Error:', error);
        return buildableArea;
    }
}
