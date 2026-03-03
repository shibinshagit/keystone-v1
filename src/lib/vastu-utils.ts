import * as turf from '@turf/turf';
import { Feature, Polygon, Point } from 'geojson';

/**
 * Configuration for Vastu Center calculation.
 * Set to 'centroid' or 'centerOfMass'.
 */
export const VASTU_CENTER_METHOD: 'centroid' | 'centerOfMass' = 'centroid';

/**
 * Returns the Vastu center point for a given geometry based on the configured method.
 */
export function getVastuCenter(geometry: Feature<Polygon>): Feature<Point> {
    if (VASTU_CENTER_METHOD === 'centerOfMass') {
        return turf.centerOfMass(geometry);
    }
    return turf.centroid(geometry);
}
