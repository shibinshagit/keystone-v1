
import * as turf from '@turf/turf';
import { planarDestination } from './geometry-utils';
import { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { AlgoParams } from './basic-generator';

/**
 * Applies variable setbacks (Front, Rear, Side) to a polygon.
 * 
 * Strategy:
 * 1. Calculate Bounding Box of the polygon.
 * 2. Identify "Front" edges based on `roadAccessSides` (N, S, E, W).
 *    - N: Top edge (Max Y)
 *    - S: Bottom edge (Min Y)
 *    - E: Right edge (Max X)
 *    - W: Left edge (Min X)
 * 3. Identify "Rear" edge (Opposite to Front).
 *    - If multiple Fronts, Rear might be ambiguous, defaulting to remaining edges as Side or specific logic.
 *    - Simple case: Single Front -> Opposite is Rear.
 * 4. Apply setbacks by offsetting edges or intersecting with half-planes.
 * 
 * Fallback:
 * - If `roadAccessSides` is empty or undefined, use `setback` (uniform) or `frontSetback` as uniform.
 */
export function applyVariableSetbacks(
    poly: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon | MultiPolygon> | null {
    const {
        setback,
        frontSetback,
        rearSetback,
        sideSetback,
        roadAccessSides
    } = params;

    const effectiveUniform = setback ?? 0;

    if (
        (frontSetback === undefined && rearSetback === undefined && sideSetback === undefined) ||
        !roadAccessSides ||
        roadAccessSides.length === 0
    ) {
        if (effectiveUniform === 0) return poly;
        // @ts-ignore
        return turf.buffer(poly, -effectiveUniform, { units: 'meters' });
    }

    const valFront = frontSetback ?? effectiveUniform;
    const valRear = rearSetback ?? effectiveUniform;
    const valSide = sideSetback ?? effectiveUniform;

    const bbox = turf.bbox(poly);
    const [minX, minY, maxX, maxY] = bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    if (width < 1 || height < 1) return null;
    // @ts-ignore
    let shrunkPoly = turf.buffer(poly, -valSide, { units: 'meters' });

    if (!shrunkPoly) return null;

    // Now cut extra for Front/Rear
    const extraFront = Math.max(0, valFront - valSide);
    const extraRear = Math.max(0, valRear - valSide);

    if (extraFront === 0 && extraRear === 0) {
        return shrunkPoly as Feature<Polygon | MultiPolygon>;
    }

    const cutters: Feature<Polygon>[] = [];

    const createCutter = (edge: string, margin: number) => {
        if (margin <= 0) return;
        const huge = 1000;

        /*
          BBox:
          minX,maxY (NW) ------ maxX,maxY (NE)
              |                     |
          minX,minY (SW) ------ maxX,minY (SE)
        */

        let cPoly: Feature<Polygon> | null = null;

        switch (edge) {
            case 'N': // Top Edge
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    maxY - (margin / 111111),
                    maxX + huge,
                    maxY + huge
                ]);
                break;
            case 'S': // Bottom Edge
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    minY - huge,
                    maxX + huge,
                    minY + (margin / 111111)
                ]);
                break;
            case 'E': // Right Edge
                cPoly = turf.bboxPolygon([
                    maxX - (margin / 111111),
                    minY - huge,
                    maxX + huge,
                    maxY + huge
                ]);
                break;
            case 'W': // Left Edge
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    minY - huge,
                    minX + (margin / 111111),
                    maxY + huge
                ]);
                break;
        }

        if (edge === 'N') {
            const nw = turf.point([minX, maxY]);
            const cutLine = turf.point(planarDestination(nw, margin, 180));
            const cutY = cutLine.geometry.coordinates[1];

            cPoly = turf.bboxPolygon([minX - 0.1, cutY, maxX + 0.1, maxY + 0.1]);
        }
        else if (edge === 'S') {
            const sw = turf.point([minX, minY]);
            const cutLine = turf.point(planarDestination(sw, margin, 0));
            const cutY = cutLine.geometry.coordinates[1];

            cPoly = turf.bboxPolygon([minX - 0.1, minY - 0.1, maxX + 0.1, cutY]);
        }
        else if (edge === 'E') {
            const ne = turf.point([maxX, maxY]);
            const cutLine = turf.point(planarDestination(ne, margin, 270));
            const cutX = cutLine.geometry.coordinates[0];

            cPoly = turf.bboxPolygon([cutX, minY - 0.1, maxX + 0.1, maxY + 0.1]);
        }
        else if (edge === 'W') {
            const nw = turf.point([minX, maxY]);
            const cutLine = turf.point(planarDestination(nw, margin, 90));
            const cutX = cutLine.geometry.coordinates[0];

            cPoly = turf.bboxPolygon([minX - 0.1, minY - 0.1, cutX, maxY + 0.1]);
        }

        if (cPoly) cutters.push(cPoly);
    };

    // Apply Front Setbacks
    roadAccessSides.forEach(side => {
        const s = side.charAt(0).toUpperCase();
        createCutter(s, extraFront);
    });

    // Apply Rear Setbacks (Opposite to Front)
    const rearSides = new Set<string>();
    roadAccessSides.forEach(side => {
        const s = side.charAt(0).toUpperCase();
        if (s === 'N') rearSides.add('S');
        if (s === 'S') rearSides.add('N');
        if (s === 'E') rearSides.add('W');
        if (s === 'W') rearSides.add('E');
    });

    roadAccessSides.forEach(side => {
        const s = side.charAt(0).toUpperCase();
        rearSides.delete(s);
    });

    rearSides.forEach(s => {
        createCutter(s, extraRear);
    });

    for (const cutter of cutters) {
        try {
            // @ts-ignore
            shrunkPoly = turf.difference(shrunkPoly, cutter);
            if (!shrunkPoly) return null;
        } catch (e) {
            console.warn("Setback cut failed", e);
            return null;
        }
    }

    return shrunkPoly as Feature<Polygon | MultiPolygon>;
}
