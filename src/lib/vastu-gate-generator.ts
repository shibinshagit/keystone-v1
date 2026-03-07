import * as turf from '@turf/turf';
import { planarDestination } from './generators/geometry-utils';
import { Feature, Polygon } from 'geojson';
import { EntryPoint } from './types';



export const VASTU_GATE_BEARINGS: { label: string; bearing: number; zones: string }[] = [
    { label: 'N-Gate', bearing: 11.25, zones: 'N3/N4' },
    { label: 'E-Gate', bearing: 101.25, zones: 'E3/E4' },
    { label: 'S-Gate', bearing: 191.25, zones: 'S3/S4' },
    { label: 'W-Gate', bearing: 281.25, zones: 'W3/W4' },
];


function rayIntersectsPolygon(
    center: [number, number],
    bearingDeg: number,
    plotGeometry: Feature<Polygon>
): [number, number] | null {
    const destination = turf.point(planarDestination(center, 10000, bearingDeg));
    const ray = turf.lineString([center, destination.geometry.coordinates as [number, number]]);

    const boundary = turf.polygonToLine(plotGeometry);
    const intersections = turf.lineIntersect(ray as any, boundary as any);

    if (!intersections || intersections.features.length === 0) return null;

    let closest: [number, number] | null = null;
    let minDist = Infinity;

    intersections.features.forEach((f: any) => {
        const coords = f.geometry.coordinates as [number, number];
        const dist = turf.distance(center, coords, { units: 'meters' });
        if (dist < minDist) {
            minDist = dist;
            closest = coords;
        }
    });

    return closest;
}

/**
 * Generate Vastu-compliant gate positions for a plot.
 * Places gates at the N3/N4, E3/E4, S3/S4, W3/W4 zone boundaries
 * where they intersect the plot boundary.
 * 
 * @param plotGeometry - The plot polygon
 * @param center - [lng, lat] center of the plot
 * @param roadAccessSides - Array of road-accessible sides ('N', 'E', 'S', 'W')
 * @returns Array of EntryPoint objects
 */
export function generateVastuGates(
    plotGeometry: Feature<Polygon>,
    center: [number, number],
    roadAccessSides: string[] = []
): EntryPoint[] {
    const gates: EntryPoint[] = [];

    VASTU_GATE_BEARINGS.forEach(({ label, bearing, zones }) => {
        const cardinal = zones[0];
        if (roadAccessSides.length > 0 && !roadAccessSides.includes(cardinal)) {
            return;
        }
        const position = rayIntersectsPolygon(center, bearing, plotGeometry);
        if (!position) return;

        gates.push({
            id: `vastu-gate-${zones.toLowerCase().replace('/', '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'Both',
            position,
            name: label,
            color: cardinal === 'N' ? '#22c55e' : cardinal === 'E' ? '#3b82f6' : cardinal === 'S' ? '#f59e0b' : '#8b5cf6',
        });
    });

    return gates;
}
