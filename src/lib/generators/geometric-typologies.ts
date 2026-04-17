import * as turf from '@turf/turf';
import { planarArea } from './geometry-utils';
import { generateBuildingLayout } from './layout-generator';
import { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';
import { UnitTypology } from '../types';
import { applyVariableSetbacks } from './setback-utils';
import { AlgoParams } from './basic-generator';
export interface GeometricTypologyParams {
    wingDepth?: number;
    wingLengthA?: number;
    wingLengthB?: number;
    orientation: number;
    setback: number;
    minFootprint?: number;
    maxFootprint?: number;
    maxFloors?: number;
    obstacles?: Feature<Polygon>[];
    targetPosition?: Feature<Point>;
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[];
    // Dimensional Constraints
    minBuildingWidth?: number;
    maxBuildingWidth?: number;
    minBuildingLength?: number;
    maxBuildingLength?: number;
    // Directional Spacing
    sideSetback?: number;
    frontSetback?: number;
    rearSetback?: number;
    roadAccessSides?: string[];
    seed?: number;
    selectedUtilities?: string[];
    intendedUse?: string;
}

export function checkCollision(poly: Feature<Polygon>, obstacles?: Feature<Polygon>[]): boolean {
    if (!obstacles || obstacles.length === 0) return false;
    for (const obs of obstacles) {
        try {
            // @ts-ignore
            const intersect = turf.intersect(poly, obs);
            if (intersect && turf.area(intersect) > 1) return true;
        } catch (e) {
        }
    }
    return false;
}

/**
 * Apply corner clearance to prevent building parts from touching at corners.
 */
function applyCornerClearance(
    parts: Feature<Polygon>[],
    minClearance: number = 2
): Feature<Polygon>[] {
    return parts.map(part => {
        try {
            const shrunk = turf.buffer(part, -minClearance / 2000, { units: 'kilometers' });
            if (shrunk && turf.area(shrunk) > 50) {
                // Recalculate stored area after shrinkage
                if (shrunk.properties || part.properties) {
                    shrunk.properties = { ...(part.properties || {}), ...(shrunk.properties || {}), area: planarArea(shrunk) };
                }
                return shrunk as Feature<Polygon>;
            }
            return part;
        } catch (e) {
            return part;
        }
    });
}

/**
 * Creates an offset polygon (buffer) for a LineString.
 */
function createWingFromEdge(
    edge: Feature<LineString>,
    depth: number,
    plotPoly: Feature<Polygon | MultiPolygon>
): Feature<Polygon> | null {
    try {

        // Create a rectangle along the edge.
        const coords = edge.geometry.coordinates;
        const p1 = coords[0];
        const p2 = coords[1];
        const bearing = turf.bearing(p1, p2);
        const dist = turf.distance(p1, p2, { units: 'meters' });

        const center = turf.midpoint(p1, p2);
        const poly = turf.transformRotate(
            turf.bboxPolygon([
                center.geometry.coordinates[0] - dist / 200000,
                center.geometry.coordinates[1] - depth / 111000,
                center.geometry.coordinates[0] + dist / 200000,
                center.geometry.coordinates[1] + depth / 111000
            ]),
            bearing,
            { pivot: center }
        );

        // @ts-ignore
        const bufferedEdge = turf.buffer(edge, depth, { units: 'meters', steps: 1 }); // Square edges?
        const wing = turf.intersect(bufferedEdge, plotPoly);
        return wing as Feature<Polygon>;
    } catch (e) { return null; }
}

/**
 * Robust "Perimeter-Aligned" L-Shape Generator
 * 1. Identify Simplied Plot Corners.
 * 2. Generate Wings along adjacent edges.
 * 3. Union them.
 */

function enforceMaxFootprint(
    poly: Feature<Polygon | MultiPolygon>,
    maxArea: number | undefined,
    minArea: number | undefined
): Feature<Polygon | MultiPolygon> | null {
    if (!maxArea) return poly;

    let currentArea = turf.area(poly);
    if (currentArea <= maxArea) return poly;

    let temp = poly;
    let attempts = 0;
    let factor = 0.5;

    while (currentArea > maxArea && attempts < 15) {
        if (currentArea > maxArea * 2) factor = 2.0;
        else if (currentArea > maxArea * 1.5) factor = 1.0;
        else factor = 0.2;

        // @ts-ignore
        const shrunk = turf.buffer(temp, -factor, { units: 'meters' });

        if (!shrunk || !shrunk.geometry) return null;

        temp = shrunk as Feature<Polygon | MultiPolygon>;
        currentArea = turf.area(temp);
        attempts++;
    }

    if (currentArea <= maxArea) {
        if (minArea && currentArea < minArea) return null;
        return temp;
    }
    return null;
}

// Diversity Selection Helper
function selectDiverseCandidate(
    candidates: { feature: any, score: number, variantId?: string, pairId?: string, parts?: any[] }[],
    seed: number
): any[] {
    if (candidates.length === 0) return [];

    const groups: Record<string, typeof candidates> = {};
    candidates.forEach(c => {
        const key = c.variantId || c.pairId || 'default';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
    });

    Object.values(groups).forEach(g => g.sort((a, b) => b.score - a.score));

    // Round Robin Interleaving
    const diverseList: typeof candidates = [];
    const groupKeys = Object.keys(groups);
    groupKeys.sort();

    let maxLen = 0;
    groupKeys.forEach(k => maxLen = Math.max(maxLen, groups[k].length));

    for (let i = 0; i < maxLen; i++) {
        for (const key of groupKeys) {
            if (groups[key][i]) {
                diverseList.push(groups[key][i]);
            }
        }
    }



    const selected = diverseList[seed % diverseList.length];
    return selected.parts || [];
}
/**
 * U-Shape Generator - Direct clone of L-shape with arms from BOTH ends.
 *
 * slab1 = horizontal bottom along edge (= L-shape slab1)
 * slab2 = left arm perpendicular from START end (= L-shape slab2 at 'start')
 * slab3 = right arm perpendicular from FAR end (= L-shape slab2 at 'far')
 */
export function generateUShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        seed = 0
    } = params;

    const globalSetback = params.setback ?? 3;
    const sideSetback  = Math.max(params.sideSetback  ?? globalSetback, 3);
    const frontSetback = Math.max(params.frontSetback ?? globalSetback, 3);
    const rearSetback  = Math.max(params.rearSetback  ?? frontSetback, 3);
    const cornerMargin = Math.min(Math.max(sideSetback, 3), 5); // Moderate buffer — plot already shrunk by setback extras
    const rowGap       = frontSetback + rearSetback;
    const armGap       = 0;

    const strategyVariant = seed % 3;
    let sMinLength = minBuildingLength;
    let sMaxLength = maxBuildingLength;
    let sMinWidth  = minBuildingWidth;
    let sMaxWidth  = maxBuildingWidth;

    // Seed diversity: vary courtyard width and arm proportions
    // Keep multipliers conservative so all variants can fit on typical plots
    const courtPreference = strategyVariant === 0 ? 'compact' : strategyVariant === 1 ? 'medium' : 'wide';

    const uShapeSpacing = Math.max(rowGap, sideSetback * 2, 6);

    console.log(`[U-Gen] seed=${seed} variant=${strategyVariant} W[${sMinWidth}-${sMaxWidth}] L[${sMinLength}-${sMaxLength}] setbacks: F=${frontSetback} R=${rearSetback} S=${sideSetback} uGap=${Math.max(sideSetback, 6)}`);

    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];
    if (coords.length < 4) return [];

    const validEdges: { edge: any; length: number; bearing: number; idx: number }[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= sMinLength) {
            validEdges.push({ edge: turf.lineString([coords[i], coords[i + 1]]), length, bearing: turf.bearing(p1, p2), idx: i });
        }
    }
    if (validEdges.length === 0) return [];
    // Don't sort by length — keep original polygon edge order so rotation gives
    // genuinely different starting positions on the plot boundary for each seed.
    const edgeRotation = seed % validEdges.length;
    const rotatedEdges = [...validEdges.slice(edgeRotation), ...validEdges.slice(0, edgeRotation)];
    console.log(`[U-Gen] ${validEdges.length} valid edges, rotation=${edgeRotation}`);

    const results: Feature<Polygon>[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    let uIdx = 0;

    function clipToValidArea(poly: Feature<Polygon>, threshold = 0.80): Feature<Polygon> | null {
        try {
            let intersection: any = null;
            try {
                // @ts-ignore
                intersection = turf.intersect(poly, validArea);
            } catch {
                // @ts-ignore
                intersection = turf.intersect(turf.buffer(poly, 0), turf.buffer(validArea, 0));
            }
            if (!intersection || turf.area(intersection) < turf.area(poly) * threshold) return null;
            if (intersection.geometry.type === 'MultiPolygon') {
                const parts = (turf.unkinkPolygon(intersection as any) as any).features as Feature<Polygon>[];
                intersection = parts.reduce((a: Feature<Polygon>, b: Feature<Polygon>) => turf.area(a) >= turf.area(b) ? a : b);
            }
            return intersection as Feature<Polygon>;
        } catch { return null; }
    }

    // Like clipToValidArea but returns the ORIGINAL rectangle (keeps it rectangular)
    function checkContainment(poly: Feature<Polygon>, threshold = 0.80): Feature<Polygon> | null {
        try {
            let intersection: any = null;
            try {
                // @ts-ignore
                intersection = turf.intersect(poly, validArea);
            } catch {
                // @ts-ignore
                intersection = turf.intersect(turf.buffer(poly, 0), turf.buffer(validArea, 0));
            }
            if (!intersection || turf.area(intersection) < turf.area(poly) * threshold) return null;
            return poly; // Return ORIGINAL rectangle, not clipped shape
        } catch { return null; }
    }

    const clearance = 0; // No applyCornerClearance, so no buffer needed — exact dimensions

    let depthOffset = 0;
    for (let depthPass = 0; depthPass < 4; depthPass++) {
        let placedThisPass = 0;

        for (const edgeData of rotatedEdges) {
            const limitDist = edgeData.length - cornerMargin;
            // Center-outward scan: start from edge midpoint where both arms have max room
            const midDist = edgeData.length / 2;
            const scanPositions: number[] = [];
            for (let offset = 0; offset < edgeData.length / 2; offset += 5) {
                const leftPos = midDist - offset;
                const rightPos = midDist + offset;
                if (leftPos >= cornerMargin && leftPos + sMinLength <= limitDist) scanPositions.push(leftPos);
                if (offset > 0 && rightPos >= cornerMargin && rightPos + sMinLength <= limitDist) scanPositions.push(rightPos);
            }
            let scanIdx = 0;

            while (scanIdx < scanPositions.length) {
                const currentDist = scanPositions[scanIdx];
                const maxAvailLen = limitDist - currentDist;
                if (maxAvailLen < sMinWidth * 2 + sMinWidth) { scanIdx++; continue; }

                const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });

                let inwardTurn: number | null = null;
                for (const turn of [90, -90]) {
                    try {
                        const probe = createRect(edgeStart.geometry.coordinates, edgeData.bearing, sMinLength, sMinWidth, turn);
                        // @ts-ignore
                        const inter = turf.intersect(turf.buffer(probe, 0), turf.buffer(validArea, 0));
                        if (inter && turf.area(inter) >= turf.area(probe) * 0.30) { inwardTurn = turn; break; }
                    } catch { }
                }
                if (inwardTurn === null) { scanIdx++; continue; }

                const perpBearing = edgeData.bearing + inwardTurn;

                let pStart: number[];
                if (depthOffset > 0) {
                    const deeper = turf.destination(edgeStart, depthOffset, perpBearing, { units: 'meters' });
                    pStart = deeper.geometry.coordinates;
                } else {
                    pStart = edgeStart.geometry.coordinates;
                }

                const containThreshold = depthPass <= 1 ? 0.85 : 0.70;
                const armContainThreshold = 0.30; // arms go deep into irregular plots, clip aggressively
                let uPlaced = false;
                let dbgS1Fail = 0, dbgS2Fail = 0, dbgS3Fail = 0;
                // -- U-SHAPE: connector along edge + arms from BOTH ends --
                // -- PERIPHERAL U-SHAPE: all 3 pieces anchored to plot edge --
                //
                // +------+                          +------+
                // | ARM1 |  armLen (deep, inward)    | ARM2 |
                // |      |  +--------------------+   |      |
                // |      |  | CONNECTOR (shallow) |  |      |
                // |      |  | conDepth (inward)   |  |      |
                // +------+  +--------------------+   +------+
                // =========== PLOT EDGE ===========================

                const widthOptions: number[] = [];
                for (let w = sMaxWidth; w >= sMinWidth; w -= 1) widthOptions.push(w);
                if (widthOptions.length === 0 || widthOptions[widthOptions.length - 1] !== sMinWidth) widthOptions.push(sMinWidth);

                const armLenOpts: number[] = [];
                for (let al = sMaxLength; al >= sMinLength; al -= 5) armLenOpts.push(Math.round(al));
                if (armLenOpts.length === 0 || armLenOpts[armLenOpts.length - 1] !== sMinLength) armLenOpts.push(sMinLength);

                // Connector depth: same width range as other slabs (20-25m)
                const conDepthOpts: number[] = [];
                for (let cd = sMaxWidth; cd >= sMinWidth; cd -= 1) conDepthOpts.push(cd);
                if (conDepthOpts.length === 0 || conDepthOpts[conDepthOpts.length - 1] !== sMinWidth) conDepthOpts.push(sMinWidth);

                // Courtyard width varies by seed strategy — keep multipliers conservative
                // so all variants succeed on the same plot (diversity via edge rotation + arm dims)
                const minCourt = courtPreference === 'compact' ? sMinLength : courtPreference === 'medium' ? Math.round(sMinLength * 1.15) : Math.round(sMinLength * 1.3);
                const uGap = Math.max(sideSetback, 6); // Gap based on height-setback to keep slabs separated safely
                const maxCourt = Math.min(maxAvailLen - 2 * (sMinWidth + uGap + clearance), sMaxLength); // Strictly adhere to sMaxLength

                for (const armW of widthOptions) {
                    if (uPlaced) break;
                    const compArmW = armW + clearance;
                    for (let court = minCourt; court <= maxCourt; court += 5) {
                        if (uPlaced) break;
                        const totalEdgeSpan = compArmW + uGap + court + uGap + compArmW;
                        if (totalEdgeSpan > maxAvailLen + clearance) continue;
                        for (const armLen of armLenOpts) {
                            if (uPlaced) break;
                            const compArmLen = armLen + clearance;
                            // ARM1: at pStart, perpendicular inward, width along edge
                            const arm1Raw = createRect(pStart, perpBearing, compArmLen, compArmW, -inwardTurn);
                            const arm1 = checkContainment(arm1Raw, armContainThreshold);
                            if (!arm1) { dbgS1Fail++; continue; }
                            if (checkCollision(arm1, usedAreas)) { dbgS1Fail++; continue; }
                            // ARM2: offset along edge (after ARM1 and CONNECTOR, with gaps), perpendicular inward
                            const arm2Origin = turf.destination(turf.point(pStart), compArmW + uGap + court + uGap, edgeData.bearing, { units: 'meters' }).geometry.coordinates;
                            const arm2Raw = createRect(arm2Origin, perpBearing, compArmLen, compArmW, -inwardTurn);
                            const arm2 = checkContainment(arm2Raw, armContainThreshold);
                            if (!arm2) { dbgS3Fail++; continue; }
                            if (checkCollision(arm2, usedAreas)) { dbgS3Fail++; continue; }
                            try { // @ts-ignore
                                const ov = turf.intersect(arm1, arm2);
                                if (ov && turf.area(ov) > 1) continue;
                            } catch { }
                            // CONNECTOR: between arms at edge with gaps on both sides
                            const conOrigin = turf.destination(turf.point(pStart), compArmW + uGap, edgeData.bearing, { units: 'meters' }).geometry.coordinates;
                            let connector: Feature<Polygon> | null = null;
                            for (const conDepth of conDepthOpts) {
                                if (connector) break;
                                // Crucial fix: the arms must be significantly longer than the connector depth 
                                // to form a visible courtyard (otherwise it looks like a solid block)
                                if (armLen < conDepth + 15) continue;
                                
                                const compConDepth = conDepth + clearance;
                                const conRaw = createRect(conOrigin, edgeData.bearing, court, compConDepth, inwardTurn);
                                const clipped = checkContainment(conRaw, containThreshold);
                                if (!clipped) continue;
                                if (checkCollision(clipped, usedAreas)) continue;
                                try { // @ts-ignore
                                    const o1 = turf.intersect(clipped, arm1);
                                    if (o1 && turf.area(o1) > 1) continue;
                                    // @ts-ignore
                                    const o2 = turf.intersect(clipped, arm2);
                                    if (o2 && turf.area(o2) > 1) continue;
                                } catch { }
                                connector = clipped;
                            }
                            if (!connector) { dbgS2Fail++; continue; }
                            usedAreas.push(arm1, connector, arm2);
                            const slabs: [Feature<Polygon>, number][] = [[connector, edgeData.bearing], [arm1, perpBearing], [arm2, perpBearing]];
                            for (const [slab, bearing] of slabs) {
                                try {
                                    const area = planarArea(slab);
                                    const layout = generateBuildingLayout(slab, { ...params, subtype: 'slab', unitMix: params.unitMix, alignmentRotation: bearing, selectedUtilities: params.selectedUtilities });
                                    slab.properties = { type: 'generated', subtype: 'slab', area, cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities, alignmentRotation: bearing, scenarioId: `U-${uIdx}`, score: area };
                                    results.push(slab);
                                } catch (e) { console.warn('[U-Gen] Layout failed:', e); }
                            }
                            uIdx++;
                            console.log(`[U-Gen] Placed U: arms=${armLen}x${armW}m, court=${court}m, span=${totalEdgeSpan.toFixed(0)}m`);
                            uPlaced = true;
                            placedThisPass++;
                            const placedEnd = currentDist + totalEdgeSpan + uShapeSpacing;
                            while (scanIdx < scanPositions.length && scanPositions[scanIdx] < placedEnd) scanIdx++;
                        }
                    }
                }
                if (!uPlaced) {
                    if (dbgS1Fail + dbgS2Fail + dbgS3Fail > 0) {
                        console.log(`[U-Gen] edge=${edgeData.idx} dist=${currentDist.toFixed(0)}: slab1Fail=${dbgS1Fail} slab2Fail=${dbgS2Fail} slab3Fail=${dbgS3Fail}`);
                    }
                    scanIdx++;
                }
            }
        }
        console.log(`[U-Gen] Depth pass ${depthPass}: placed ${placedThisPass} U-shapes`);
        if (placedThisPass === 0) break;
        depthOffset += sMaxWidth + Math.max(rowGap, 5);
    }
    console.log(`[U-Gen] Done: ${results.length} parts (${uIdx} U-shapes)`);
    // Return results directly — rectangles already have 3.5m clearance buffer built in
    return results;
}



// Helper to get midpoint of a LineString or coords
function getMidpoint(coords: number[][]): number[] {
    const len = coords.length;
    if (len < 2) return coords[0];
    const p1 = coords[0];
    const p2 = coords[coords.length - 1];
    return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

/**
 * T-Shape Generator — Integrated approach:
 *   For each position on each edge, try to place slab1 (the bar, full rectangle)
 *   THEN attach a perpendicular stem (slab2) from the CENTER of slab1's inner edge.
 *   Only commit the T-shape if BOTH parts fit fully inside validArea.
 *   Advance past the full T-shape to leave room for the next one.
 *
 * NO CLIPPING — both arms must be complete, uncut rectangles.
 * Dimensional constraints: width 20-25m, length 25-55m
 */
export function generateTShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        seed = 0
    } = params;

    // Use at least 3m internal margins regardless of what setback values were passed
    // (the plot boundary has already been shrunk by mainSetback in the store)
    const globalSetback = params.setback ?? 3;
    const sideSetback = Math.max(params.sideSetback ?? globalSetback, 3);
    const frontSetback = Math.max(params.frontSetback ?? globalSetback, 3);
    const rearSetback = Math.max(params.rearSetback ?? frontSetback, 3);

    // cornerMargin: moderate buffer — plot already shrunk by setback extras
    const cornerMargin = Math.min(Math.max(sideSetback, 3), 5);
    // armGap: physical gap between the bar's inner face and the stem start (prevents merging)
    const armGap = Math.max(rearSetback, 3);

    // --- DIVERSITY LOGIC ---
    const strategyVariant = seed % 3; // 0: Balanced, 1: Dense, 2: Heavy
    let sMinLength = minBuildingLength;
    let sMaxLength = maxBuildingLength;
    let sMinWidth = minBuildingWidth;
    let sMaxWidth = maxBuildingWidth;

    if (strategyVariant === 1) {
        // Dense: slightly shorter buildings, but keep them architecturally viable
        sMaxLength = Math.min(maxBuildingLength, minBuildingLength + 20);
    } else if (strategyVariant === 2) {
        // Heavy: wider buildings, modest min length increase (40m was too high for many plots)
        sMinWidth = Math.max(minBuildingWidth, maxBuildingWidth - 2);
        sMinLength = Math.max(minBuildingLength, 30); // was 40 → too aggressive
    }

    const dynWidthOptions = strategyVariant === 1 ? [sMinWidth, sMaxWidth] : [sMaxWidth, sMinWidth];

    const tShapeSpacing = Math.max(sideSetback, 3);

    console.log(`[T-Gen] ===== Integrated T-Gen (seed=${seed}) =====`);
    console.log(`[T-Gen] Dims: W[${sMinWidth}-${sMaxWidth}] L[${sMinLength}-${sMaxLength}]`);
    console.log(`[T-Gen] Setbacks: side=${sideSetback}, front=${frontSetback}, rear=${rearSetback}, armGap=${armGap}, tSpacing=${tShapeSpacing}`);

    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    if (coords.length < 4) return [];

    // Seeded random
    const sr = (idx: number) => {
        const x = Math.sin(seed + idx) * 10000;
        return x - Math.floor(x);
    };

    // Helper: Check if polygon is contained in validArea
    // Helper: Confine polygon to validArea to mold to boundary
    function clipToValidArea(poly: Feature<Polygon>, threshold = 0.80): Feature<Polygon> | null {
        try {
            let intersection = null;
            try {
                // @ts-ignore
                intersection = turf.intersect(poly, validArea);
            } catch (e) {
                // @ts-ignore
                const cp = turf.buffer(poly, 0);
                // @ts-ignore
                const ca = turf.buffer(validArea, 0);
                // @ts-ignore
                intersection = turf.intersect(cp, ca);
            }
            if (!intersection || turf.area(intersection) < turf.area(poly) * threshold) return null;

            // Extract main polygon if multipolygon is returned
            if (intersection.geometry.type === 'MultiPolygon') {
                const polys = turf.unkinkPolygon(intersection as any).features;
                let largest = polys[0];
                for (const p of polys) {
                    if (turf.area(p) > turf.area(largest)) largest = p;
                }
                intersection = largest;
            }

            return intersection as Feature<Polygon>;
        } catch (e) {
            return null;
        }
    }

    // Collect valid edges
    type EdgeData = { edge: Feature<LineString>; length: number; bearing: number; idx: number };
    const validEdges: EdgeData[] = [];

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= minBuildingLength) {
            validEdges.push({
                edge: turf.lineString([coords[i], coords[i + 1]]),
                length,
                bearing: turf.bearing(p1, p2),
                idx: i
            });
        }
    }

    if (validEdges.length === 0) return [];

    // Sort edges by strategy
    const strategy = seed % 3;
    validEdges.sort((a, b) => {
        if (strategy === 1) return (b.length + sr(a.idx) * 20) - (a.length + sr(b.idx) * 20);
        if (strategy === 2) return a.length - b.length;
        return b.length - a.length;
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INTEGRATED: Place bar (slab1) + stem (slab2) together as a unit
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const results: Feature<Polygon>[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    let tIdx = 0;

    const maxDepthPasses = 5; // More passes to fill deep plots
    let depthOffset = 0;

    for (let depthPass = 0; depthPass < maxDepthPasses; depthPass++) {
        let placedThisPass = 0;

        for (const edgeData of validEdges) {
            let currentDist = cornerMargin;
            const limitDist = edgeData.length - cornerMargin;

            while (currentDist + sMinLength <= limitDist) {
                const maxAvailLen = Math.min(sMaxLength, limitDist - currentDist);
                if (maxAvailLen < sMinLength) break;

                const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });

                // Determine inward direction
                let inwardTurn: number | null = null;
                for (const turn of [90, -90]) {
                    try {
                        const probe = createRect(edgeStart.geometry.coordinates, edgeData.bearing, sMinLength, sMinWidth, turn);
                        // @ts-ignore
                        const inter = turf.intersect(turf.buffer(probe, 0), turf.buffer(validArea, 0));
                        if (inter && turf.area(inter) >= turf.area(probe) * 0.30) {
                            inwardTurn = turn;
                            break;
                        }
                    } catch (e) { }
                }
                if (inwardTurn === null) { currentDist += 5; continue; }

                // For deeper passes, offset start point into plot
                let pStart: number[];
                if (depthOffset > 0) {
                    const perpBearingOff = edgeData.bearing + inwardTurn;
                    const deeper = turf.destination(edgeStart, depthOffset, perpBearingOff, { units: 'meters' });
                    pStart = deeper.geometry.coordinates;
                } else {
                    pStart = edgeStart.geometry.coordinates;
                }

                const perpBearing = edgeData.bearing + inwardTurn;

                // Try bar (slab1) sizes: step down in 5m increments for best fit
                let tPlaced = false;

                // Generate granular length options: from maxAvailLen down to sMinLength in 5m steps
                const lengthOptions: number[] = [];
                for (let l = Math.min(sMaxLength, maxAvailLen); l >= sMinLength; l -= 5) {
                    lengthOptions.push(Math.round(l));
                }
                if (lengthOptions.length === 0 || lengthOptions[lengthOptions.length - 1] !== sMinLength) {
                    lengthOptions.push(sMinLength);
                }

                // Generate granular width options: from sMaxWidth down to sMinWidth in 1m steps
                const widthOptions: number[] = [];
                for (let w = sMaxWidth; w >= sMinWidth; w -= 1) {
                    widthOptions.push(w);
                }
                if (widthOptions.length === 0 || widthOptions[widthOptions.length - 1] !== sMinWidth) {
                    widthOptions.push(sMinWidth);
                }

                for (const s1Len of lengthOptions) {
                    if (tPlaced) break;
                    for (const s1W of widthOptions) {
                        if (tPlaced) break;

                        // Add clearance buffer (matches slab generator) so that after
                        // applyCornerClearance shrinks by ~1.5m/side, final dims match user config
                        const clearance = 3.5;
                        const compLen = s1Len + clearance;
                        const compW = s1W + clearance;
                        const slab1Raw = createRect(pStart, edgeData.bearing, compLen, compW, inwardTurn);

                        // Bar must be fully contained (relax for deeper passes)
                        const containThreshold = depthPass <= 1 ? 0.90 : 0.80;
                        const slab1 = clipToValidArea(slab1Raw, containThreshold);
                        if (!slab1) continue;

                        // Bar must not collide
                        if (checkCollision(slab1, usedAreas)) continue;

                        // ——— Now try to attach stem (slab2) perpendicular from CENTER ———
                        let slab2: Feature<Polygon> | null = null;

                        // Find center of slab1's inner edge
                        const barMidAlongEdge = turf.destination(
                            turf.point(pStart), compLen / 2, edgeData.bearing, { units: 'meters' }
                        );
                        const innerEdgeCenter = turf.destination(
                            barMidAlongEdge, compW, perpBearing, { units: 'meters' }
                        );

                        // Stem origin: offset from inner edge center by armGap
                        const stemOrigin = turf.destination(
                            innerEdgeCenter, armGap, perpBearing, { units: 'meters' }
                        ).geometry.coordinates;

                        // Try stem sizes: step down in 5m increments, cap at 60% of bar length
                        const maxStemLen = Math.min(sMaxLength, Math.max(Math.round(s1Len * 0.6), sMinLength));
                        const minStemLen = sMinLength;
                        const stemLengthOptions: number[] = [];
                        for (let sl = maxStemLen; sl >= minStemLen; sl -= 5) {
                            stemLengthOptions.push(Math.round(sl));
                        }
                        if (stemLengthOptions.length === 0 || stemLengthOptions[stemLengthOptions.length - 1] !== minStemLen) {
                            stemLengthOptions.push(minStemLen);
                        }
                        const stemWidthOptions = widthOptions; // Same granular widths as bar

                        for (const stemLen of stemLengthOptions) {
                            if (slab2) break;
                            for (const stemW of stemWidthOptions) {
                                if (slab2) break;

                                // Stem goes inward (perpBearing), centered on the bar's midpoint
                                // We need to offset the start so the stem is centered horizontally
                                const compStemLen = stemLen + clearance;
                                const compStemW = stemW + clearance;
                                const halfStemW = compStemW / 2;
                                const stemStartCentered = turf.destination(
                                    turf.point(stemOrigin), -halfStemW, edgeData.bearing, { units: 'meters' }
                                ).geometry.coordinates;

                                // Create stem: along perpBearing direction, with width extending along edgeData.bearing
                                const stemRectRaw = createRect(stemStartCentered, perpBearing, compStemLen, compStemW, -inwardTurn);

                                // Stem must be fully contained
                                const stemRect = clipToValidArea(stemRectRaw, containThreshold);
                                if (!stemRect) continue;

                                // Stem must not collide with existing buildings
                                if (checkCollision(stemRect, usedAreas)) continue;

                                // Stem must not overlap bar
                                try {
                                    // @ts-ignore
                                    const overlap = turf.intersect(stemRect, slab1);
                                    if (overlap && turf.area(overlap) > 1) continue;
                                } catch (e) { }

                                slab2 = stemRect;
                            }
                        }

                        // Passes 0-1: must be T-shape (bar + stem). Pass 2+: allow solo slab to fill center.
                        if (!slab2 && depthPass <= 1) continue;

                        // ✅ Both bar + stem fit — commit!
                        usedAreas.push(slab1);
                        if (slab2) usedAreas.push(slab2);

                        // Generate layouts for both arms
                        const slabPair: [Feature<Polygon>, number][] = [
                            [slab1, edgeData.bearing],
                            ...(slab2 ? [[slab2, perpBearing] as [Feature<Polygon>, number]] : [])
                        ];

                        for (const [arm, bearing] of slabPair) {
                            try {
                                const area = planarArea(arm);
                                const layout = generateBuildingLayout(arm, {
                                    ...params,
                                    subtype: 'slab', // Treat arm as standard slab for core/unit layout
                                    unitMix: params.unitMix,
                                    alignmentRotation: bearing,
                                    selectedUtilities: params.selectedUtilities
                                });

                                arm.properties = {
                                    type: 'generated',
                                    subtype: 'slab',
                                    area,
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances,
                                    internalUtilities: layout.utilities,
                                    alignmentRotation: bearing,
                                    scenarioId: `T-${tIdx}`,
                                    score: area
                                };

                                results.push(arm);
                            } catch (e) {
                                console.warn(`[T-Gen] Layout generation failed:`, e);
                            }
                        }

                        console.log(`[T-Gen] T-shape at dist=${currentDist.toFixed(0)}: bar=${s1Len}x${s1W}m, stem=${slab2 ? turf.area(slab2).toFixed(0) : 0}m2`);
                        tPlaced = true;
                        placedThisPass++;
                        tIdx++;
                        currentDist += s1Len + tShapeSpacing; // generous spacing for T-shapes
                    }
                }

                if (!tPlaced) {
                    currentDist += 5;
                }
            }
        }
        
        console.log(`[T-Gen] Depth pass ${depthPass}: ${placedThisPass} T-shapes placed`);
        if (placedThisPass === 0) break;
        // Step inward by max bar depth + gap to avoid overlapping previous pass's widest bar
        depthOffset += sMaxWidth + armGap;
    }

    console.log(`[T-Gen] Done: ${results.length} buildings (${tIdx} T-shapes)`);

    return applyCornerClearance(results, 3);
}

function segmentWing(
    wingPoly: Feature<Polygon>,
    startPoint: Feature<Point>,
    directionPoint: Feature<Point>, 
    params: GeometricTypologyParams,
    initialGap: boolean = true
): Feature<Polygon>[] {
    const { maxBuildingLength = 55, sideSetback = 6, minBuildingLength = 15, minBuildingWidth = 10, maxBuildingWidth = 25 } = params;

    const segments: Feature<Polygon>[] = [];
    const bearing = turf.bearing(startPoint, directionPoint);

    const gap = sideSetback ?? params.setback ?? 6;

    let currentDist = initialGap ? 0 : -gap;

    // Safety break
    for (let i = 0; i < 20; i++) {
        currentDist += gap;

        const segmentLen = maxBuildingLength;

        const pStart = turf.destination(startPoint, currentDist, bearing, { units: 'meters' });
        const pEnd = turf.destination(startPoint, currentDist + segmentLen, bearing, { units: 'meters' });

        const width = 500; // Wide enough
        const bearingPerp = bearing + 90;
        const offset = width / 2;

        const p1 = turf.destination(pStart, offset, bearingPerp, { units: 'meters' });
        const p2 = turf.destination(pStart, -offset, bearingPerp, { units: 'meters' });
        const p3 = turf.destination(pEnd, -offset, bearingPerp, { units: 'meters' });
        const p4 = turf.destination(pEnd, offset, bearingPerp, { units: 'meters' });

        const cutter = turf.polygon([[
            p1.geometry.coordinates,
            p2.geometry.coordinates,
            p3.geometry.coordinates,
            p4.geometry.coordinates,
            p1.geometry.coordinates
        ]]);

        // Intersect
        // @ts-ignore
        const piece = turf.intersect(wingPoly, cutter);

        console.log('[segmentWing] Iter', i, '- Piece:', piece ? 'EXISTS' : 'NULL', 'Area:', piece ? turf.area(piece) : 0);
        if (piece) {
            const pieceBbox = turf.bbox(piece);
            const wingBbox = turf.bbox(wingPoly);
            console.log('[segmentWing] Piece bbox:', pieceBbox);
            console.log('[segmentWing] Wing bbox:', wingBbox);
        }

        if (piece) {
            const area = turf.area(piece);
            // x^2 - (P/2)x + A = 0
            const P = turf.length(piece, { units: 'meters' });
            const A = area;
            const semiP = P / 2;

            // Quadratic formula discriminant: b^2 - 4ac -> semiP^2 - 4*1*A
            const discriminant = (semiP * semiP) - (4 * A);

            let dim1 = 0;
            let dim2 = 0;

            if (discriminant >= 0) {
                const sqRoot = Math.sqrt(discriminant);
                dim1 = (semiP + sqRoot) / 2;
                dim2 = (semiP - sqRoot) / 2;
            } else {
                const bbox = turf.bbox(piece);
                dim1 = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
                dim2 = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
            }

            const minSide = Math.min(dim1, dim2);
            const maxSide = Math.max(dim1, dim2);
            const isWidthValid = (dim1 >= (minBuildingWidth - 1) && dim1 <= (maxBuildingWidth + 2)) || (dim2 >= (minBuildingWidth - 1) && dim2 <= (maxBuildingWidth + 2));
            const isLengthValid = (dim1 >= (minBuildingLength - 1)) || (dim2 >= (minBuildingLength - 1));

            if (minSide >= (minBuildingWidth - 1) && maxSide >= (minBuildingLength - 1)) {
                segments.push(piece as Feature<Polygon>);
                currentDist += segmentLen;
            } else {
                console.log(`[segmentWing] Rejected piece (Robust): ${minSide.toFixed(1)}m x ${maxSide.toFixed(1)}m (Min: ${minBuildingWidth}x${minBuildingLength})`);
                if (currentDist > 20) break;
            }
        } else {
            if (currentDist > 20) break;
            break;
        }
    }
    return segments;
}

/**
 * L-Shape Generator â€” Integrated approach:
 *   For each position on each edge, try to place slab1 (full rectangle)
 *   THEN immediately attach a perpendicular arm (slab2).
 *   Only commit the L-shape if BOTH arms fit fully inside validArea.
 *   Advance past the full L-shape to leave room for the next one.
 *
 * NO CLIPPING â€” both arms must be complete, uncut rectangles.
 * Dimensional constraints: width 20-25m, length 25-55m
 */
export function generateLShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        sideSetback = params.setback ?? 6,
        frontSetback = params.setback ?? 6,
        seed = 0
    } = params;

    const rearSetback = params.rearSetback ?? frontSetback;
    const cornerMargin = Math.min(Math.max(sideSetback, 3), 5); // Moderate buffer — plot already shrunk by setback extras
    const rowGap = frontSetback + rearSetback;
    const armGap = rearSetback; // arm uses rear setback as gap between L-shape arms
    
    // --- DIVERSITY LOGIC ---
    const strategyVariant = seed % 3; // 0: Balanced, 1: Dense, 2: Heavy
    let sMinLength = minBuildingLength;
    let sMaxLength = maxBuildingLength;
    let sMinWidth = minBuildingWidth;
    let sMaxWidth = maxBuildingWidth;

    if (strategyVariant === 1) {
        sMaxLength = Math.min(maxBuildingLength, minBuildingLength + 15);
    } else if (strategyVariant === 2) {
        sMinWidth = Math.max(minBuildingWidth, maxBuildingWidth - 2);
        sMinLength = Math.max(minBuildingLength, 40);
    }

    const dynWidthOptions = strategyVariant === 1 ? [sMinWidth, sMaxWidth] : [sMaxWidth, sMinWidth];

    const lShapeSpacing = Math.max(rowGap, sideSetback * 2, 6);

    console.log(`[L-Gen] ===== Integrated L-Gen (seed=${seed}) =====`);
    console.log(`[L-Gen] Dims: W[${sMinWidth}-${sMaxWidth}] L[${sMinLength}-${sMaxLength}]`);
    console.log(`[L-Gen] Setbacks: side=${sideSetback}, front=${frontSetback}, rear=${rearSetback}, armGap=${armGap}, lSpacing=${lShapeSpacing}`);

    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    if (coords.length < 4) return [];

    // Seeded random
    const sr = (idx: number) => {
        const x = Math.sin(seed + idx) * 10000;
        return x - Math.floor(x);
    };

    // Helper: Check if polygon is contained in validArea
    // threshold: 0.95 for edge placement, relaxed for deeper passes
    // Helper: Confine polygon to validArea to mold to boundary
    function clipToValidArea(poly: Feature<Polygon>, threshold = 0.80): Feature<Polygon> | null {
        try {
            let intersection = null;
            try {
                // @ts-ignore
                intersection = turf.intersect(poly, validArea);
            } catch (e) {
                // @ts-ignore
                const cp = turf.buffer(poly, 0);
                // @ts-ignore
                const ca = turf.buffer(validArea, 0);
                // @ts-ignore
                intersection = turf.intersect(cp, ca);
            }
            if (!intersection || turf.area(intersection) < turf.area(poly) * threshold) return null;

            // Extract main polygon if multipolygon is returned
            if (intersection.geometry.type === 'MultiPolygon') {
                const polys = turf.unkinkPolygon(intersection as any).features;
                let largest = polys[0];
                for (const p of polys) {
                    if (turf.area(p) > turf.area(largest)) largest = p;
                }
                intersection = largest;
            }

            return intersection as Feature<Polygon>;
        } catch (e) {
            return null;
        }
    }

    // Collect valid edges
    type EdgeData = { edge: Feature<LineString>; length: number; bearing: number; idx: number };
    const validEdges: EdgeData[] = [];

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= minBuildingLength) {
            validEdges.push({
                edge: turf.lineString([coords[i], coords[i + 1]]),
                length,
                bearing: turf.bearing(p1, p2),
                idx: i
            });
        }
    }

    if (validEdges.length === 0) return [];

    // Sort edges by strategy
    const strategy = seed % 3;
    validEdges.sort((a, b) => {
        if (strategy === 1) return (b.length + sr(a.idx) * 20) - (a.length + sr(b.idx) * 20);
        if (strategy === 2) return a.length - b.length;
        return b.length - a.length;
    });

    const preferFarEnd = (seed % 2) === 0;


    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    // INTEGRATED: Place slab1 + slab2 together as a unit
    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

    const results: Feature<Polygon>[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    let lIdx = 0;

    const maxDepthPasses = 6; // enough passes to reach center of large plots
    let depthOffset = 0;
    const attachEnds = preferFarEnd ? ['far', 'start'] : ['start', 'far'];

    for (let depthPass = 0; depthPass < maxDepthPasses; depthPass++) {
        let placedThisPass = 0;

        for (const edgeData of validEdges) {
            let currentDist = cornerMargin;
            const limitDist = edgeData.length - cornerMargin;

            while (currentDist + sMinLength <= limitDist) {
                const maxAvailLen = Math.min(sMaxLength, limitDist - currentDist);
                if (maxAvailLen < sMinLength) break;

                const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });

                // Determine inward direction
                let inwardTurn: number | null = null;
                for (const turn of [90, -90]) {
                    try {
                        const probe = createRect(edgeStart.geometry.coordinates, edgeData.bearing, sMinLength, sMinWidth, turn);
                        // @ts-ignore
                        const inter = turf.intersect(turf.buffer(probe, 0), turf.buffer(validArea, 0));
                        if (inter && turf.area(inter) >= turf.area(probe) * 0.30) {
                            inwardTurn = turn;
                            break;
                        }
                    } catch (e) { }
                }
                if (inwardTurn === null) { currentDist += 5; continue; }

                // For deeper passes, offset start point into plot
                let pStart: number[];
                if (depthOffset > 0) {
                    const perpBearingOff = edgeData.bearing + inwardTurn;
                    const deeper = turf.destination(edgeStart, depthOffset, perpBearingOff, { units: 'meters' });
                    pStart = deeper.geometry.coordinates;
                } else {
                    pStart = edgeStart.geometry.coordinates;
                }

                const perpBearing = edgeData.bearing + inwardTurn;

                // Try slab1 sizes: step down in 5m increments for best fit
                let lPlaced = false;

                // Generate granular length options: from maxAvailLen down to sMinLength in 5m steps
                const lengthOptions: number[] = [];
                for (let l = Math.min(sMaxLength, maxAvailLen); l >= sMinLength; l -= 5) {
                    lengthOptions.push(Math.round(l));
                }
                if (lengthOptions.length === 0 || lengthOptions[lengthOptions.length - 1] !== sMinLength) {
                    lengthOptions.push(sMinLength);
                }

                // Generate granular width options: from sMaxWidth down to sMinWidth in 1m steps
                const widthOptions: number[] = [];
                for (let w = sMaxWidth; w >= sMinWidth; w -= 1) {
                    widthOptions.push(w);
                }
                if (widthOptions.length === 0 || widthOptions[widthOptions.length - 1] !== sMinWidth) {
                    widthOptions.push(sMinWidth);
                }

                for (const s1Len of lengthOptions) {
                    if (lPlaced) break;
                    for (const s1W of widthOptions) {
                        if (lPlaced) break;

                        // Add clearance buffer (matches slab generator) to counteract applyCornerClearance
                        const clearance = 3.5;
                        const compLen = s1Len + clearance;
                        const compW = s1W + clearance;

                        const slab1Raw = createRect(pStart, edgeData.bearing, compLen, compW, inwardTurn);

                        // Slab1 must be fully contained (relax for deeper passes)
                        const containThreshold = depthPass <= 1 ? 0.90 : 0.80;
                        const slab1 = clipToValidArea(slab1Raw, containThreshold);
                        if (!slab1) continue;

                        // Slab1 must not collide
                        if (checkCollision(slab1, usedAreas)) continue;

                        // â”€â”€â”€ Now try to attach slab2 perpendicular â”€â”€â”€
                        let slab2: Feature<Polygon> | null = null;
                        let validTurn = null;

                        for (const end of attachEnds) {
                            if (slab2) break;

                            let armOrigin: number[];
                            let armDepthTurn: number;

                            if (end === 'start') {
                                // Arm from inner corner at START end
                                const innerCorner = turf.destination(
                                    turf.point(pStart), compW, perpBearing, { units: 'meters' }
                                );
                                armOrigin = innerCorner.geometry.coordinates;
                                armDepthTurn = -inwardTurn;
                            } else {
                                // Arm from inner corner at FAR end
                                const farEnd = turf.destination(
                                    turf.point(pStart), compLen, edgeData.bearing, { units: 'meters' }
                                );
                                const innerCorner = turf.destination(farEnd, compW, perpBearing, { units: 'meters' });
                                armOrigin = innerCorner.geometry.coordinates;
                                armDepthTurn = inwardTurn;
                            }

                            // Arm starts offset from slab1's inner corner by rear setback
                            const armStart = turf.destination(
                                turf.point(armOrigin), armGap, perpBearing, { units: 'meters' }
                            ).geometry.coordinates;

                            // Try arm sizes: step down in 5m increments for best fit
                            const armLengthOptions: number[] = [];
                            for (let al = sMaxLength; al >= sMinLength; al -= 5) {
                                armLengthOptions.push(Math.round(al));
                            }
                            if (armLengthOptions.length === 0 || armLengthOptions[armLengthOptions.length - 1] !== sMinLength) {
                                armLengthOptions.push(sMinLength);
                            }
                            const armWidthOptions = widthOptions; // Same granular widths

                            for (const aLen of armLengthOptions) {
                                if (slab2) break;
                                for (const aW of armWidthOptions) {
                                    if (slab2) break;

                                    const compALen = aLen + clearance;
                                    const compAW = aW + clearance;

                                    const armRectRaw = createRect(armStart, perpBearing, compALen, compAW, armDepthTurn);

                                    // Arm must be fully contained
                                    const armRect = clipToValidArea(armRectRaw, containThreshold);
                                    if (!armRect) continue;

                                    // Arm must not collide with existing buildings
                                    if (checkCollision(armRect, usedAreas)) continue;

                                    // Arm must not overlap slab1
                                    try {
                                        // @ts-ignore
                                        const overlap = turf.intersect(armRect, slab1);
                                        if (overlap && turf.area(overlap) > 1) continue;
                                    } catch (e) { }

                                    slab2 = armRect;
                                }
                            }
                        }

                        // For deeper passes (center), allow solo slab if no arm fits
                        if (!slab2 && depthPass <= 1) continue; // Edge passes: must be L-shape
                        // Deeper passes: accept solo slab to fill center

                        // ✅ Both slab1 + slab2 fit — commit!
                        usedAreas.push(slab1);
                        if (slab2) usedAreas.push(slab2);

                        // Generate layouts for both arms
                        const slabPair: [Feature<Polygon>, number][] = [
                            [slab1, edgeData.bearing],
                            ...(slab2 ? [[slab2, perpBearing] as [Feature<Polygon>, number]] : [])
                        ];

                        for (const [arm, bearing] of slabPair) {
                            try {
                                const area = planarArea(arm);
                                const layout = generateBuildingLayout(arm, {
                                    ...params,
                                    subtype: 'slab', // Treat arm as standard slab for core/unit layout
                                    unitMix: params.unitMix,
                                    alignmentRotation: bearing,
                                    selectedUtilities: params.selectedUtilities
                                });

                                arm.properties = {
                                    type: 'generated',
                                    subtype: 'slab',
                                    area,
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances,
                                    internalUtilities: layout.utilities,
                                    alignmentRotation: bearing,
                                    scenarioId: `L-${lIdx}`,
                                    score: area
                                };

                                results.push(arm);
                            } catch (e) {
                                console.warn(`[L-Gen] Layout generation failed:`, e);
                            }
                        }

                        console.log(`[L-Gen] L-shape at dist=${currentDist.toFixed(0)}: slab1=${s1Len}x${s1W}m, slab2=${turf.area(slab2).toFixed(0)}m2`);
                        lPlaced = true;
                        placedThisPass++;
                        lIdx++;
                        currentDist += s1Len + lShapeSpacing; // generous spacing for L-shapes
                    }
                }

                if (!lPlaced) currentDist += 5;
            }
        }

        console.log(`[L-Gen] Depth pass ${depthPass}: ${placedThisPass} L-shapes placed`);
        if (placedThisPass === 0) break;
        depthOffset += maxBuildingWidth + Math.max(sideSetback, 3); // tighter rows to fill center
    }

    console.log(`[L-Gen] Done: ${results.length} buildings (${lIdx} L-shapes)`);

    return applyCornerClearance(results, 3);
}






/**
             * Robust "Perimeter-Aligned" H-Shape Generator
             * Create "Crossbar" by connecting their midpoints.
             */
export function generateHShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        seed = 0
    } = params;

    const globalSetback = params.setback ?? 3;
    const sideSetback  = Math.max(params.sideSetback  ?? globalSetback, 3);
    const frontSetback = Math.max(params.frontSetback ?? globalSetback, 3);
    const rearSetback  = Math.max(params.rearSetback  ?? frontSetback, 3);
    const cornerMargin = Math.min(Math.max(sideSetback, 3), 5); // Moderate buffer — plot already shrunk by setback extras
    const rowGap       = frontSetback + rearSetback;

    const strategyVariant = seed % 3;
    let sMinLength = minBuildingLength;
    let sMaxLength = maxBuildingLength;
    let sMinWidth  = minBuildingWidth;
    let sMaxWidth  = maxBuildingWidth;

    // Seed diversity: vary crossbar position
    const crossbarPosition = strategyVariant === 0 ? 'center' : strategyVariant === 1 ? 'lower' : 'upper';

    const hShapeSpacing = Math.max(rowGap, sideSetback * 2, 6);

    console.log(`[H-Gen] seed=${seed} variant=${strategyVariant} W[${sMinWidth}-${sMaxWidth}] L[${sMinLength}-${sMaxLength}] setbacks: F=${frontSetback} R=${rearSetback} S=${sideSetback} crossbar=${crossbarPosition}`);

    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];
    if (coords.length < 4) return [];

    const validEdges: { edge: any; length: number; bearing: number; idx: number }[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= sMinLength) {
            validEdges.push({ edge: turf.lineString([coords[i], coords[i + 1]]), length, bearing: turf.bearing(p1, p2), idx: i });
        }
    }
    if (validEdges.length === 0) return [];
    validEdges.sort((a, b) => b.length - a.length);
    const edgeRotation = seed % validEdges.length;
    const rotatedEdges = [...validEdges.slice(edgeRotation), ...validEdges.slice(0, edgeRotation)];
    console.log(`[H-Gen] ${validEdges.length} valid edges, rotation=${edgeRotation}`);

    const results: Feature<Polygon>[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    let hIdx = 0;

    function checkContainment(poly: Feature<Polygon>, threshold = 0.80): Feature<Polygon> | null {
        try {
            let intersection: any = null;
            try {
                // @ts-ignore
                intersection = turf.intersect(poly, validArea);
            } catch {
                // @ts-ignore
                intersection = turf.intersect(turf.buffer(poly, 0), turf.buffer(validArea, 0));
            }
            if (!intersection || turf.area(intersection) < turf.area(poly) * threshold) return null;
            return poly;
        } catch { return null; }
    }

    const clearance = 0;
    const hGap = Math.max(sideSetback, 6);

    let depthOffset = 0;
    for (let depthPass = 0; depthPass < 4; depthPass++) {
        let placedThisPass = 0;

        for (const edgeData of rotatedEdges) {
            const limitDist = edgeData.length - cornerMargin;
            const midDist = edgeData.length / 2;
            const scanPositions: number[] = [];
            for (let offset = 0; offset < edgeData.length / 2; offset += 5) {
                const leftPos = midDist - offset;
                const rightPos = midDist + offset;
                if (leftPos >= cornerMargin && leftPos + sMinLength <= limitDist) scanPositions.push(leftPos);
                if (offset > 0 && rightPos >= cornerMargin && rightPos + sMinLength <= limitDist) scanPositions.push(rightPos);
            }
            let scanIdx = 0;

            while (scanIdx < scanPositions.length) {
                const currentDist = scanPositions[scanIdx];
                const maxAvailLen = limitDist - currentDist;
                if (maxAvailLen < sMinWidth * 2 + sMinWidth) { scanIdx++; continue; }

                const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });

                let inwardTurn: number | null = null;
                for (const turn of [90, -90]) {
                    try {
                        const probe = createRect(edgeStart.geometry.coordinates, edgeData.bearing, sMinLength, sMinWidth, turn);
                        // @ts-ignore
                        const inter = turf.intersect(turf.buffer(probe, 0), turf.buffer(validArea, 0));
                        if (inter && turf.area(inter) >= turf.area(probe) * 0.30) { inwardTurn = turn; break; }
                    } catch { }
                }
                if (inwardTurn === null) { scanIdx++; continue; }

                const perpBearing = edgeData.bearing + inwardTurn;

                let pStart: number[];
                if (depthOffset > 0) {
                    const deeper = turf.destination(edgeStart, depthOffset, perpBearing, { units: 'meters' });
                    pStart = deeper.geometry.coordinates;
                } else {
                    pStart = edgeStart.geometry.coordinates;
                }

                const containThreshold = depthPass <= 1 ? 0.85 : 0.70;
                const armContainThreshold = 0.30;
                let hPlaced = false;
                let dbgArm1Fail = 0, dbgArm2Fail = 0, dbgCrossFail = 0;

                // H-SHAPE: ARM1 + CROSSBAR (middle) + ARM2
                // +------+                          +------+
                // | ARM1 |                           | ARM2 |
                // |      |  +--------------------+   |      |
                // |      |  | CROSSBAR (middle)  |   |      |
                // |      |  +--------------------+   |      |
                // +------+                           +------+
                // =========== PLOT EDGE ===========================

                const widthOptions: number[] = [];
                for (let w = sMaxWidth; w >= sMinWidth; w -= 1) widthOptions.push(w);
                if (widthOptions.length === 0 || widthOptions[widthOptions.length - 1] !== sMinWidth) widthOptions.push(sMinWidth);

                const armLenOpts: number[] = [];
                for (let al = sMaxLength; al >= sMinLength; al -= 5) armLenOpts.push(Math.round(al));
                if (armLenOpts.length === 0 || armLenOpts[armLenOpts.length - 1] !== sMinLength) armLenOpts.push(sMinLength);

                const crossDepthOpts: number[] = [];
                for (let cd = sMaxWidth; cd >= sMinWidth; cd -= 1) crossDepthOpts.push(cd);
                if (crossDepthOpts.length === 0 || crossDepthOpts[crossDepthOpts.length - 1] !== sMinWidth) crossDepthOpts.push(sMinWidth);

                const minCourt = sMinLength;
                const maxCourt = Math.min(maxAvailLen - 2 * (sMinWidth + hGap + clearance), sMaxLength);

                for (const armW of widthOptions) {
                    if (hPlaced) break;
                    const compArmW = armW + clearance;
                    for (let court = minCourt; court <= maxCourt; court += 5) {
                        if (hPlaced) break;
                        const totalEdgeSpan = compArmW + hGap + court + hGap + compArmW;
                        if (totalEdgeSpan > maxAvailLen + clearance) continue;
                        for (const armLen of armLenOpts) {
                            if (hPlaced) break;
                            const compArmLen = armLen + clearance;

                            // ARM1
                            const arm1Raw = createRect(pStart, perpBearing, compArmLen, compArmW, -inwardTurn);
                            const arm1 = checkContainment(arm1Raw, armContainThreshold);
                            if (!arm1) { dbgArm1Fail++; continue; }
                            if (checkCollision(arm1, usedAreas)) { dbgArm1Fail++; continue; }

                            // ARM2
                            const arm2Origin = turf.destination(turf.point(pStart), compArmW + hGap + court + hGap, edgeData.bearing, { units: 'meters' }).geometry.coordinates;
                            const arm2Raw = createRect(arm2Origin, perpBearing, compArmLen, compArmW, -inwardTurn);
                            const arm2 = checkContainment(arm2Raw, armContainThreshold);
                            if (!arm2) { dbgArm2Fail++; continue; }
                            if (checkCollision(arm2, usedAreas)) { dbgArm2Fail++; continue; }

                            try { // @ts-ignore
                                const ov = turf.intersect(arm1, arm2);
                                if (ov && turf.area(ov) > 1) continue;
                            } catch { }

                            // CROSSBAR: in the MIDDLE of arms (key difference from U-shape)
                            const crossEdgeOrigin = turf.destination(turf.point(pStart), compArmW + hGap, edgeData.bearing, { units: 'meters' }).geometry.coordinates;

                            let crossbar: Feature<Polygon> | null = null;
                            for (const crossDepth of crossDepthOpts) {
                                if (crossbar) break;
                                if (armLen < crossDepth + 15) continue;

                                let crossInwardOffset: number;
                                if (crossbarPosition === 'center') {
                                    crossInwardOffset = (armLen - crossDepth) / 2;
                                } else if (crossbarPosition === 'lower') {
                                    crossInwardOffset = (armLen - crossDepth) / 3;
                                } else {
                                    crossInwardOffset = (armLen - crossDepth) * 2 / 3;
                                }

                                const crossStartPoint = turf.destination(
                                    turf.point(crossEdgeOrigin),
                                    crossInwardOffset,
                                    perpBearing,
                                    { units: 'meters' }
                                ).geometry.coordinates;

                                const compCrossDepth = crossDepth + clearance;
                                const crossRaw = createRect(crossStartPoint, edgeData.bearing, court, compCrossDepth, inwardTurn);
                                const clipped = checkContainment(crossRaw, containThreshold);
                                if (!clipped) continue;
                                if (checkCollision(clipped, usedAreas)) continue;

                                try { // @ts-ignore
                                    const o1 = turf.intersect(clipped, arm1);
                                    if (o1 && turf.area(o1) > 1) continue;
                                    // @ts-ignore
                                    const o2 = turf.intersect(clipped, arm2);
                                    if (o2 && turf.area(o2) > 1) continue;
                                } catch { }
                                crossbar = clipped;
                            }
                            if (!crossbar) { dbgCrossFail++; continue; }

                            usedAreas.push(arm1, crossbar, arm2);
                            const slabs: [Feature<Polygon>, number][] = [
                                [arm1, perpBearing],
                                [crossbar, edgeData.bearing],
                                [arm2, perpBearing]
                            ];
                            for (const [slab, bearing] of slabs) {
                                try {
                                    const area = planarArea(slab);
                                    const layout = generateBuildingLayout(slab, {
                                        ...params,
                                        subtype: 'slab',
                                        unitMix: params.unitMix,
                                        alignmentRotation: bearing,
                                        selectedUtilities: params.selectedUtilities
                                    });
                                    slab.properties = {
                                        type: 'generated',
                                        subtype: 'slab',
                                        area,
                                        cores: layout.cores,
                                        units: layout.units,
                                        entrances: layout.entrances,
                                        internalUtilities: layout.utilities,
                                        alignmentRotation: bearing,
                                        scenarioId: `H-${hIdx}`,
                                        score: area
                                    };
                                    results.push(slab);
                                } catch (e) { console.warn('[H-Gen] Layout failed:', e); }
                            }
                            console.log(`[H-Gen] Placed H: arms=${armLen}x${armW}m, crossbar=${crossbarPosition}, court=${court}m, span=${totalEdgeSpan.toFixed(0)}m`);
                            hPlaced = true;
                            placedThisPass++;
                            hIdx++;
                            const placedEnd = currentDist + totalEdgeSpan + hShapeSpacing;
                            while (scanIdx < scanPositions.length && scanPositions[scanIdx] < placedEnd) scanIdx++;
                        }
                    }
                }
                if (!hPlaced) {
                    if (dbgArm1Fail + dbgArm2Fail + dbgCrossFail > 0) {
                        console.log(`[H-Gen] edge=${edgeData.idx} dist=${currentDist.toFixed(0)}: arm1Fail=${dbgArm1Fail} arm2Fail=${dbgArm2Fail} crossFail=${dbgCrossFail}`);
                    }
                    scanIdx++;
                }
            }
        }
        console.log(`[H-Gen] Depth pass ${depthPass}: placed ${placedThisPass} H-shapes`);
        if (placedThisPass === 0) break;
        depthOffset += sMaxWidth + Math.max(rowGap, 5);
    }
    console.log(`[H-Gen] Done: ${results.length} parts (${hIdx} H-shapes)`);
    return results;
}


/**
 * Slab Generator (Rectangular Blocks along Edges)
 */
// Helper to get strip polygon along an edge based on depth
function getStrip(edge: Feature<LineString>, depth: number, plotPoly: Feature<Polygon | MultiPolygon>): Feature<Polygon> | null {
    try {
        const buffered = turf.buffer(edge, depth, { units: 'meters' });
        // @ts-ignore
        const intersect = turf.intersect(buffered, plotPoly);
        return intersect as Feature<Polygon>;
    } catch (e) { return null; }
}

// Helper for deterministic random numbers
function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export function generateSlabShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        wingDepth, setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        seed = 0
    } = params;

    // Enforce minimum 3m internal margins — plot boundary is already shrunk by mainSetback
    const globalSetback = params.setback ?? 3;
    const sideSetback = Math.max(params.sideSetback ?? globalSetback, 3);
    const frontSetback = Math.max(params.frontSetback ?? globalSetback, 3);

    // DIVERSITY: Strategy based on seed
    const strategy = seed % 3; // 0=Balanced, 1=Dense, 2=Heavy

    // Adjust limits based on strategy, BUT stay within global min/max
    let strategyMinLength = minBuildingLength;
    let strategyMaxLength = maxBuildingLength;
    let strategyMinWidth = minBuildingWidth;
    let strategyMaxWidth = maxBuildingWidth;

    if (strategy === 1) {
        // Dense: Prefer shorter buildings
        strategyMaxLength = Math.min(maxBuildingLength, minBuildingLength + 15); // Cap length
    } else if (strategy === 2) {
        // Heavy: Prefer thicker, longer buildings
        strategyMinWidth = Math.max(minBuildingWidth, maxBuildingWidth - 2); // Force thickness
        strategyMinLength = Math.max(minBuildingLength, 40); // Force length
    }

    console.log(`[SlabGen] Strategy=${strategy}, Limits: W[${strategyMinWidth}-${strategyMaxWidth}] L[${strategyMinLength}-${strategyMaxLength}]`);
    console.log(`[SlabGen] Spacing: Side=${sideSetback}m, Front=${frontSetback}m, Setback=${setback}m`);

    // Valid Area
    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;

    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });

    // Coords for edge detection
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];

    // Sequential Placement Logic

    // Get all edges long enough to fit at least one min-building
    const validEdges: { edge: Feature<LineString>, length: number, bearing: number }[] = [];

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= strategyMinLength) {
            validEdges.push({
                edge: turf.lineString([coords[i], coords[i + 1]]),
                length,
                bearing: turf.bearing(p1, p2)
            });
        }
    }

    // FALLBACK: If Strategy 2 (Heavy) is too strict and found no edges, relax to global min
    if (validEdges.length === 0 && strategy === 2) {
        console.log(`[SlabGen] Strategy 2 (Heavy) found no edges >= ${strategyMinLength}m. Relaxing to ${minBuildingLength}m...`);
        strategyMinLength = minBuildingLength;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const length = turf.distance(p1, p2, { units: 'meters' });
            if (length >= strategyMinLength) {
                validEdges.push({
                    edge: turf.lineString([coords[i], coords[i + 1]]),
                    length,
                    bearing: turf.bearing(p1, p2)
                });
            }
        }
    }

    console.log(`[Debug SlabGen] Valid Edges Found: ${validEdges.length} (Min Length: ${strategyMinLength}m)`);

    // DIVERSITY: Shuffle edge order based on seed for different layouts
    // Use seed to create deterministic but varied ordering
    const seededRandom = (index: number) => {
        const x = Math.sin(seed + index) * 10000;
        return x - Math.floor(x);
    };

    validEdges.sort((a, b) => {
        if (strategy === 1) {
            // Dense: Shuffle edges for variety
            const weightA = b.length + seededRandom(validEdges.indexOf(a)) * 20;
            const weightB = a.length + seededRandom(validEdges.indexOf(b)) * 20;
            return weightA - weightB;
        } else {
            // Balanced/Heavy: Longest edges first (Standard)
            return b.length - a.length;
        }
    });

    // Try to fill edges
    for (const edgeData of validEdges) {
        let currentDist = 0;
        const totalDist = edgeData.length;

        const rowGap = (frontSetback ?? 6) + (params.rearSetback ?? 6);
        const cornerMargin = Math.min(Math.max(frontSetback ?? 6, 3), 5); // Moderate buffer — plot already shrunk by setback extras 
        currentDist = cornerMargin;

        const limitDist = totalDist - cornerMargin;
        console.log(`[Debug SlabGen] Edge Dist: ${totalDist.toFixed(1)}m. Start: ${currentDist}m, Limit: ${limitDist.toFixed(1)}m`);

        while (currentDist + strategyMinLength <= limitDist) {
            const randL = seededRandom(candidates.length + currentDist);
            const maxAvailableLen = Math.min(strategyMaxLength, limitDist - currentDist);
            const actualLength = strategyMinLength + (randL * (maxAvailableLen - strategyMinLength));

            const clearance = 3.5; 
            const compLength = actualLength + clearance;

            if (currentDist + actualLength > limitDist && candidates.length > 0) {
                console.log(`[Debug SlabGen] Breaking @ ${currentDist.toFixed(1)}m: next block length ${actualLength.toFixed(1)}m exceeds limit ${limitDist.toFixed(1)}m`);
                break;
            } else if (currentDist + actualLength > limitDist) {
                break;
            }

            const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });
            const pStart = edgeStart.geometry.coordinates;

            let validTurn: number | null = null;

            const randW = seededRandom(candidates.length + 99);
            const rawDepth = strategyMinWidth + (randW * (strategyMaxWidth - strategyMinWidth));
            const compDepth = rawDepth + clearance;
            for (const turn of [90, -90]) {
                try {
                    const probe = createRect(pStart, edgeData.bearing, compLength, compDepth, turn);
                    // @ts-ignore
                    const cleanedProbe = turf.buffer(probe, 0);
                    // @ts-ignore
                    const intersect = turf.intersect(cleanedProbe, validArea);

                    const probeArea = turf.area(probe);
                    const intersectArea = intersect ? turf.area(intersect) : 0;

                    if (intersect && intersectArea >= probeArea * 0.85) {
                        validTurn = turn;
                        break;
                    } else {
                        console.log(`[Debug SlabGen] Probe ${turn} failed: ${intersectArea.toFixed(1)} / ${probeArea.toFixed(1)} mÃ‚Â²`);
                    }
                } catch (e) {
                    console.warn('[Generator] Probe failed:', e);
                }
            }

            if (validTurn !== null) {
                let depthOffset = 0;
                let rowsAdded = 0;

                while (rowsAdded < 1) {
                    const currentEdgeStart = turf.destination(
                        turf.point(pStart),
                        depthOffset,
                        edgeData.bearing + (validTurn as number),
                        { units: 'meters' }
                    );

                    let validPoly: Feature<Polygon> | null = null;
                    let winningDepth = 0;

                    let depthOptions = [rawDepth, strategyMinWidth];

                    for (const d of depthOptions) {
                        try {
                            const cDepth = d + clearance;
                            const poly = createRect(
                                currentEdgeStart.geometry.coordinates,
                                edgeData.bearing,
                                compLength,
                                cDepth,
                                validTurn as number
                            );

                            let intersect = null;
                            try {
                                intersect = turf.intersect(poly, validArea);
                            } catch (e) {
                                const cleanedPoly = turf.buffer(poly, 0);
                                const cleanedArea = turf.buffer(validArea, 0);
                                intersect = turf.intersect(cleanedPoly, cleanedArea);
                            }

                            const polyArea = turf.area(poly);
                            if (intersect && turf.area(intersect) >= polyArea * 0.90) {
                                if (!checkCollision(poly, usedAreas)) {
                                    const clipped = turf.intersect(poly, validArea);
                                    if (clipped) {
                                        // Use area+perimeter to get rotation-independent dimensions
                                        // (axis-aligned bbox shrinks on rotated edges and gives wrong readings)
                                        const clippedArea = turf.area(clipped);
                                        const clippedPerim = turf.length(clipped, { units: 'meters' });
                                        const semiP = clippedPerim / 2;
                                        const disc = semiP * semiP - 4 * clippedArea;
                                        let clippedMinDim: number, clippedMaxDim: number;
                                        if (disc >= 0) {
                                            const sq = Math.sqrt(disc);
                                            clippedMinDim = (semiP - sq) / 2;
                                            clippedMaxDim = (semiP + sq) / 2;
                                        } else {
                                            // Fallback to bbox if formula fails
                                            const bbox = turf.bbox(clipped);
                                            clippedMinDim = Math.min(
                                                turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' }),
                                                turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' })
                                            );
                                            clippedMaxDim = Math.max(
                                                turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' }),
                                                turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' })
                                            );
                                        }
                                        if (clippedMinDim >= strategyMinWidth && clippedMaxDim >= strategyMinLength) {
                                            validPoly = clipped as Feature<Polygon>;
                                            winningDepth = d;
                                            break;
                                        } else {
                                            console.log(`[Debug SlabGen] Clipped building too small: ${clippedMinDim.toFixed(1)}m x ${clippedMaxDim.toFixed(1)}m (min: ${strategyMinWidth}m x ${strategyMinLength}m). Skipping.`);
                                        }
                                    }
                                } else {
                                    console.log('[Debug SlabGen] Collision blocked placement');
                                }
                            } else {
                                console.log(`[Debug SlabGen] Containment failed: ${intersect ? turf.area(intersect).toFixed(1) : 0} / ${polyArea.toFixed(1)} mÃ‚Â²`);
                            }
                        } catch (e) { }
                    }

                    if (validPoly) {
                        const area = planarArea(validPoly);
                        const layout = generateBuildingLayout(validPoly, {
                            ...params,
                            subtype: 'slab', unitMix: params.unitMix, alignmentRotation: edgeData.bearing, selectedUtilities: params.selectedUtilities
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'slab', area: area,
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            alignmentRotation: edgeData.bearing,
                            scenarioId: `Slab-Row-${rowsAdded}-Seq-${candidates.length}`,
                            score: area
                        };

                        candidates.push({ feature: validPoly, score: area });
                        usedAreas.push(validPoly);
                        console.log(`[Debug SlabGen] Placed building ${candidates.length}. Size: ${actualLength.toFixed(1)}x${winningDepth.toFixed(1)}m. Area: ${area.toFixed(1)}mÃ‚Â²`);

                        depthOffset += winningDepth + rowGap;
                        rowsAdded++;
                    } else {
                        break;
                    }
                }

                if (rowsAdded > 0) {
                    currentDist += actualLength + sideSetback;
                } else {
                    currentDist += 5;
                }
            } else {
                currentDist += 5;
            }
        }
    }


    const slabFeatures = candidates.map(c => c.feature);
    slabFeatures.forEach(r => { if (!r.properties) r.properties = {}; r.properties.subtype = 'slab'; });
    return applyCornerClearance(slabFeatures, 3);
}

// Helper
function createRect(startCoord: number[], bearing: number, length: number, depth: number, turnAngle: number): Feature<Polygon> {
    const p1 = turf.point(startCoord);
    const p2 = turf.destination(p1, length, bearing, { units: 'meters' });
    const p3 = turf.destination(p2, depth, bearing + turnAngle, { units: 'meters' });
    const p4 = turf.destination(p1, depth, bearing + turnAngle, { units: 'meters' });

    return turf.polygon([[
        p1.geometry.coordinates,
        p2.geometry.coordinates,
        p3.geometry.coordinates,
        p4.geometry.coordinates,
        p1.geometry.coordinates
    ]]);
}

/**
 * Point Generator (Square Towers at Corners)
 */
export function generatePointShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        wingDepth, setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        seed = 0
    } = params;

    const strategy = seed % 3; // 0=Mid, 1=Min, 2=Max
    let targetSide = (minBuildingWidth + maxBuildingWidth) / 2;
    if (strategy === 1) targetSide = minBuildingWidth;
    if (strategy === 2) targetSide = maxBuildingWidth;

    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });

    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    const spacing = params.sideSetback ?? 6;
    
    const cornerMargin = Math.max(spacing, 6);

    // --- Corners ---
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const pCurrent = coords[i];
            const pNext = coords[i + 1];
            const bearingNext = turf.bearing(turf.point(pCurrent), turf.point(pNext));

            // Randomize side length for this specific tower
            const rand = seededRandom(i + seed);
            const rawSide = minBuildingWidth + (rand * (maxBuildingWidth - minBuildingWidth));
            const clearance = 3.5;
            const compSide = rawSide + clearance;

            for (const turn of [90, -90]) {
                try {
                    const p1 = turf.point(pCurrent);
                    const p2 = turf.destination(p1, compSide, bearingNext, { units: 'meters' });
                    const p3 = turf.destination(p2, compSide, bearingNext + turn, { units: 'meters' });
                    const p4 = turf.destination(p1, compSide, bearingNext + turn, { units: 'meters' });

                    const poly = turf.polygon([[
                        p1.geometry.coordinates,
                        p2.geometry.coordinates,
                        p3.geometry.coordinates,
                        p4.geometry.coordinates,
                        p1.geometry.coordinates
                    ]]);

                    // @ts-ignore
                    const intersect = turf.intersect(poly, validArea);
                    const polyArea = planarArea(poly);

                    if (intersect && turf.area(intersect) >= polyArea * 0.95) {
                        if (!checkCollision(poly, usedAreas)) {
                            const layout = generateBuildingLayout(poly, {
                                ...params,
                                subtype: 'point',
                                unitMix: params.unitMix,
                                alignmentRotation: bearingNext
                            });

                            poly.properties = {
                                type: 'generated', subtype: 'point', area: polyArea,
                                cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                                alignmentRotation: bearingNext,
                                scenarioId: `Point-Corner-${i}`, score: polyArea
                            };
                            candidates.push({ feature: poly, score: polyArea });
                            usedAreas.push(poly);
                            break;
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }
    }

    // --- PHASE 2: Edges ---
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const edgeLength = turf.distance(p1, p2, { units: 'meters' });
            const bearing = turf.bearing(p1, p2);

            let currentDist = minBuildingWidth + spacing / 2; // Start closer to corners
            const endDist = edgeLength - (minBuildingWidth + spacing / 2);

            while (currentDist + minBuildingWidth <= endDist) {
                try {
                    const startCoords = turf.along(turf.lineString([coords[i], coords[i + 1]]), currentDist, { units: 'meters' }).geometry.coordinates;
                    let validPoly: Feature<Polygon> | null = null;
                    let winningSide = 0;
                    let winningRawSide = 0;

                    // Randomize side length for this edge tower
                    const rand = seededRandom(i + currentDist + seed);
                    const rawSide = minBuildingWidth + (rand * (maxBuildingWidth - minBuildingWidth));
                    const clearance = 3.5;
                    const compSide = rawSide + clearance;

                    for (const turn of [90, -90]) {
                        const v1 = startCoords;
                        const v2 = turf.destination(turf.point(v1), compSide, bearing, { units: 'meters' }).geometry.coordinates;
                        const v3 = turf.destination(turf.point(v2), compSide, bearing + turn, { units: 'meters' }).geometry.coordinates;
                        const v4 = turf.destination(turf.point(v1), compSide, bearing + turn, { units: 'meters' }).geometry.coordinates;

                        const poly = turf.polygon([[v1, v2, v3, v4, v1]]);
                        // @ts-ignore
                        const intersect = turf.intersect(poly, validArea);
                        if (intersect && turf.area(intersect) >= compSide * compSide * 0.85 && !checkCollision(poly, usedAreas)) {
                            validPoly = poly;
                            winningSide = compSide;
                            winningRawSide = rawSide;
                            break;
                        }
                    }

                    if (validPoly) {
                        const area = planarArea(validPoly);
                        const layout = generateBuildingLayout(validPoly, {
                            ...params,
                            subtype: 'point', unitMix: params.unitMix, alignmentRotation: bearing, selectedUtilities: params.selectedUtilities
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'point', area: area,
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            alignmentRotation: bearing,
                            scenarioId: `Point-Edge-${i}-${currentDist.toFixed(0)}`, score: area
                        };
                        candidates.push({ feature: validPoly, score: area });
                        usedAreas.push(validPoly);
                        currentDist += winningRawSide + spacing;
                    } else {
                        currentDist += minBuildingWidth / 2;
                    }
                } catch (e) {
                    currentDist += minBuildingWidth / 2;
                }
            }
        } catch (e) { }
    }

    if (candidates.length === 0) {
        console.warn(`[Debug PointGen] No towers generated. Corners: ${coords.length - 1}, Valid Area: ${turf.area(validArea).toFixed(1)}mÃ‚Â²`);
    }

    const towerFeatures = candidates.map(c => c.feature);
    return applyCornerClearance(towerFeatures, 3);
}


/**
 * Large-Footprint Generator for Commercial / Public / Industrial
 */
export function generateLargeFootprint(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams & { buildingCount?: number; mainSetback?: number }
): Feature<Polygon>[] {
    const {
        obstacles,
        sideSetback = 6,
        frontSetback = 6,
        rearSetback = 6,
        roadAccessSides = [],
        maxFootprint,
        seed = 0
    } = params;

    const buildingCount = Math.max(1, Math.min(4, params.buildingCount ?? 2));

    let workArea: Feature<Polygon>;
    if (plotGeometry.geometry.type === 'MultiPolygon') {
        const largest = ensurePolygonFeature(plotGeometry);
        if (!largest) {
            console.warn('[LargeFootprint] Could not extract Polygon');
            return [];
        }
        workArea = largest;
    } else {
        workArea = plotGeometry as Feature<Polygon>;
    }

    const alreadyApplied = (params as any).mainSetback ?? 0;
    const extraFront = Math.max(0, frontSetback - alreadyApplied);
    const extraRear = Math.max(0, rearSetback - alreadyApplied);
    const extraSide = Math.max(0, sideSetback - alreadyApplied);

    console.log(`[LargeFootprint] Processing Directional Setbacks (Targeting: Front ${frontSetback}m, Rear ${rearSetback}m, Sides ${sideSetback}m)`);

    if (extraSide > 0) {
        const buffered = turf.buffer(workArea, -extraSide / 1000, { units: 'kilometers' });
        if (buffered) {
            const poly = ensurePolygonFeature(buffered);
            if (poly) {
                workArea = poly;
                console.log(`[LargeFootprint] Applied extra side setback: ${extraSide}m`);
            }
        }
    }

    if ((extraFront > 0 || extraRear > 0) && roadAccessSides.length > 0) {
        const wBbox = turf.bbox(workArea);
        const [wMinX, wMinY, wMaxX, wMaxY] = wBbox;

        const frontSides = new Set(roadAccessSides.map((s: string) => s.charAt(0).toUpperCase()));
        const rearSidesSet = new Set<string>();
        frontSides.forEach(s => {
            if (s === 'N') rearSidesSet.add('S');
            if (s === 'S') rearSidesSet.add('N');
            if (s === 'E') rearSidesSet.add('W');
            if (s === 'W') rearSidesSet.add('E');
        });
        frontSides.forEach(s => rearSidesSet.delete(s));

        const cutEdge = (edge: string, distance: number) => {
            if (distance <= 0) return;
            
            let bearing = 0;
            switch (edge) {
                case 'N': bearing = 180; break;
                case 'S': bearing = 0; break;
                case 'E': bearing = 270; break;
                case 'W': bearing = 90; break;
            }

            try {
                // @ts-ignore
                const shifted = turf.transformTranslate(workArea, distance, bearing, { units: 'meters' });
                // @ts-ignore
                const result = turf.intersect(workArea, shifted);
                
                if (result) {
                    const poly = ensurePolygonFeature(result);
                    if (poly) {
                        workArea = poly;
                        console.log(`[LargeFootprint] Set back ${edge} edge by ${distance}m (Total from boundary: ${(alreadyApplied + distance).toFixed(1)}m)`);
                    }
                }
            } catch (e) {
                console.warn(`[LargeFootprint] Failed to cut ${edge} edge via translate:`, e);
            }
        };

        // Apply front setback cuts (road-facing sides)
        frontSides.forEach(s => cutEdge(s, extraFront));
        // Apply rear setback cuts (opposite to road)
        rearSidesSet.forEach(s => cutEdge(s, extraRear));

        console.log(`[LargeFootprint] After directional setbacks, area=${turf.area(workArea).toFixed(0)}mÃ‚Â²`);
    }

    const plotArea = turf.area(workArea);
    const bbox = turf.bbox(workArea);
    const [minLng, minLat, maxLng, maxLat] = bbox;

    const widthM = turf.distance([minLng, minLat], [maxLng, minLat], { units: 'meters' });
    const heightM = turf.distance([minLng, minLat], [minLng, maxLat], { units: 'meters' });

    if (widthM < 10 || heightM < 10) {
        console.warn('[LargeFootprint] Plot too narrow');
        return [];
    }

    const degPerMLng = (maxLng - minLng) / widthM;
    const degPerMLat = (maxLat - minLat) / heightM;

    // Centroid of workArea
    const centroid = turf.centroid(workArea);
    const [cLng, cLat] = centroid.geometry.coordinates;

    // --- Continuous seed-based variation (unlimited scenarios) ---
    const sr = (offset: number) => {
        const x = Math.sin((seed + offset) * 9.8765) * 10000;
        return x - Math.floor(x);
    };

    const baseSplitAlongWidth = widthM >= heightM;
    const aspectRatio = Math.max(widthM, heightM) / Math.min(widthM, heightM);
    
    let splitAlongWidth = baseSplitAlongWidth;
    if (aspectRatio < 2.5 && sr(1) > 0.5) {
        splitAlongWidth = !baseSplitAlongWidth;
    }

    const gapMultiplier = 1 + sr(2) * 2;
    const gapXM = Math.max(sideSetback * gapMultiplier, 3 * gapMultiplier);
    const gapYM = Math.max(sideSetback * gapMultiplier, 3 * gapMultiplier);
    
    // We need both because for 4 buildings, it splits both ways
    const gapLng = widthM > 0 ? (maxLng - minLng) * (gapXM / widthM) : 0;
    const gapLat = heightM > 0 ? (maxLat - minLat) * (gapYM / heightM) : 0;

    console.log(`[LargeFootprint] START: count=${buildingCount}, seed=${seed}, splitAlong=${splitAlongWidth ? 'width' : 'height'}, gapM=${gapMultiplier.toFixed(2)}`);
    console.log(`[LargeFootprint] Bbox: ${widthM.toFixed(0)}Ãƒâ€”${heightM.toFixed(0)}m, gapX=${gapXM.toFixed(1)}m, gapY=${gapYM.toFixed(1)}m`);

    const createFallbackRect = (cx: number, cy: number, wM: number, hM: number): Feature<Polygon> => {
        const halfW = (wM / 2) * degPerMLng;
        const halfH = (hM / 2) * degPerMLat;
        return turf.polygon([[
            [cx - halfW, cy - halfH],
            [cx + halfW, cy - halfH],
            [cx + halfW, cy + halfH],
            [cx - halfW, cy + halfH],
            [cx - halfW, cy - halfH],
        ]]);
    };

    const slicePolygonToArea = (poly: Feature<Polygon>, targetArea: number, direction: 'N' | 'S' | 'E' | 'W'): Feature<Polygon> => {
        const totalA = turf.area(poly);
        if (targetArea >= totalA * 0.99) return poly;
        
        const b = turf.bbox(poly);
        const huge = 1000;
        let low = (direction === 'N' || direction === 'S') ? b[1] : b[0];
        let high = (direction === 'N' || direction === 'S') ? b[3] : b[2];
        
        let bestPoly = poly;
        
        for (let i = 0; i < 25; i++) {
            const current = (low + high) / 2;
            let cutter: Feature<Polygon>;
            if (direction === 'N') cutter = turf.bboxPolygon([b[0] - huge, current, b[2] + huge, b[3] + huge]);
            else if (direction === 'S') cutter = turf.bboxPolygon([b[0] - huge, b[1] - huge, b[2] + huge, current]);
            else if (direction === 'E') cutter = turf.bboxPolygon([current, b[1] - huge, b[2] + huge, b[3] + huge]);
            else cutter = turf.bboxPolygon([b[0] - huge, b[1] - huge, current, b[3] + huge]);
            
            try {
                // @ts-ignore
                const intersected = turf.intersect(poly, cutter);
                if (!intersected) {
                    if (direction === 'N' || direction === 'E') high = current; else low = current;
                    continue;
                }
                
                let resPoly: Feature<Polygon> | null = null;
                if (intersected.geometry.type === 'Polygon') resPoly = intersected as Feature<Polygon>;
                else if (intersected.geometry.type === 'MultiPolygon') {
                    // @ts-ignore
                    const parts = turf.flatten(intersected);
                    resPoly = parts.features.sort((x: any, y: any) => turf.area(y) - turf.area(x))[0];
                }
                if (!resPoly) continue;
                
                const area = turf.area(resPoly);
                bestPoly = resPoly;
                
                if (Math.abs(area - targetArea) < targetArea * 0.02) break;
                
                if (direction === 'N' || direction === 'E') {
                    if (area > targetArea) low = current; else high = current;
                } else {
                    if (area > targetArea) high = current; else low = current;
                }
            } catch (e) {
                break;
            }
        }
        bestPoly.properties = { ...bestPoly.properties, skipScale: true };
        return bestPoly;
    };

    const clipShapeToBbox = (clipBbox: [number, number, number, number], label: string): Feature<Polygon>[] => {
        const results: Feature<Polygon>[] = [];
        try {
            const clipPoly = turf.bboxPolygon(clipBbox);
            // @ts-ignore
            const clipped = turf.intersect(workArea, clipPoly);
            if (clipped) {
                if (clipped.geometry.type === 'Polygon') {
                    results.push(clipped as Feature<Polygon>);
                } else if (clipped.geometry.type === 'MultiPolygon') {
                    // @ts-ignore
                    const parts = turf.flatten(clipped);
                    let maxArea = 0;
                    let bestPart: Feature<Polygon> | null = null;
                    parts.features.forEach((f: Feature<Polygon>) => {
                        const a = turf.area(f);
                        if (a > maxArea && a > 10) {
                            maxArea = a;
                            bestPart = f;
                        }
                    });
                    if (bestPart) results.push(bestPart);
                }
                console.log(`[LargeFootprint] ${label}: ${results.length} pieces, total area=${results.reduce((s, f) => s + turf.area(f), 0).toFixed(0)}mÃ‚Â²`);
            } else {
                console.warn(`[LargeFootprint] ${label}: no intersection`);
            }
        } catch (e) {
            console.error(`[LargeFootprint] ${label}: clip error`, e);
        }
        return results;
    };

    // Generate plot-shaped building footprints
    let rawBuildings: Feature<Polygon>[] = [];

    const totalTarget = maxFootprint ?? (plotArea * 0.5);
    const perBuildingTarget = totalTarget / buildingCount;

    if (buildingCount === 1) {
        // 7 variations for 1 building, cycling with seed
        const variation = seed % 7;

        console.log(`[LargeFootprint] 1 building: variation=${variation}, plotArea=${plotArea.toFixed(0)}mÃ‚Â², target=${perBuildingTarget.toFixed(0)}mÃ‚Â²`);
        
        let frontEdge = 'S';
        if (roadAccessSides && roadAccessSides.length > 0) {
            frontEdge = roadAccessSides[0].charAt(0).toUpperCase();
        }

        // Map directions based on front edge
        const dirMap: Record<string, Record<string, 'N'|'S'|'E'|'W'>> = {
            'S': { front: 'S', rear: 'N', left: 'W', right: 'E' },
            'N': { front: 'N', rear: 'S', left: 'E', right: 'W' },
            'E': { front: 'E', rear: 'W', left: 'N', right: 'S' },
            'W': { front: 'W', rear: 'E', left: 'S', right: 'N' },
        };
        const dirs = dirMap[frontEdge] || dirMap['S'];

        if (variation === 0) {
            // Centered: use buffer inset (follows plot shape!)
            rawBuildings.push(workArea);
            // Will be scaled with buffer below
        } else if (variation === 1) {
            // Hug front edge
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.front));
        } else if (variation === 2) {
            // Hug rear edge
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.rear));
        } else if (variation === 3) {
            // Hug left side
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.left));
        } else if (variation === 4) {
            // Hug right side
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.right));
        } else if (variation === 5) {
            // Front-left corner: slice front then slice left
            const frontSlice = slicePolygonToArea(workArea, plotArea * 0.7, dirs.front);
            rawBuildings.push(slicePolygonToArea(frontSlice, perBuildingTarget, dirs.left));
        } else {
            // Front-right corner: slice front then slice right
            const frontSlice = slicePolygonToArea(workArea, plotArea * 0.7, dirs.front);
            rawBuildings.push(slicePolygonToArea(frontSlice, perBuildingTarget, dirs.right));
        }

    } else if (buildingCount <= 3) {
        // 6 distinct strategies for 2-3 buildings, cycling with seed
        const strategy = seed % 6;
        
        // Decide axis and proportions based on strategy
        let useWidth = baseSplitAlongWidth;
        let splitRatios: number[] = []; // Proportional sizes for each building
        let stratGapMul = 1;
        
        switch (strategy) {
            case 0: // Natural axis, equal splits
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                break;
            case 1: // Opposite axis, equal splits
                useWidth = aspectRatio < 2.5 ? !baseSplitAlongWidth : baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                break;
            case 2: // Natural axis, unequal
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.6, 0.4] : [0.5, 0.25, 0.25];
                break;
            case 3: // Opposite axis, unequal
                useWidth = aspectRatio < 2.5 ? !baseSplitAlongWidth : baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.4, 0.6] : [0.25, 0.5, 0.25];
                break;
            case 4: // Natural axis, extra wide gap
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                stratGapMul = 3;
                break;
            case 5: // Short axis, equal splits
                useWidth = !baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                stratGapMul = 1.5;
                break;
        }
        
        console.log(`[LargeFootprint] ${buildingCount} buildings: strategy=${strategy}, axis=${useWidth ? 'width' : 'height'}, ratios=[${splitRatios}], gapMul=${stratGapMul}`);

        // Strip-based splitting
        const localGapLng = widthM > 0 ? (maxLng - minLng) * (Math.max(sideSetback * stratGapMul, 3 * stratGapMul) / widthM) : 0;
        const localGapLat = heightM > 0 ? (maxLat - minLat) * (Math.max(sideSetback * stratGapMul, 3 * stratGapMul) / heightM) : 0;

        for (let i = 0; i < buildingCount; i++) {
            let clipBbox: [number, number, number, number];
                const ratio = splitRatios[i] || (1 / buildingCount);
                
                const prevRatioSum = splitRatios.slice(0, i).reduce((a, b) => a + b, 0);

                if (useWidth) {
                    const totalUsable = maxLng - minLng - localGapLng * (buildingCount - 1);
                    const stripW = totalUsable * ratio;
                    const sLng = minLng + prevRatioSum * totalUsable + i * localGapLng;
                    const eLng = sLng + stripW;
                    clipBbox = [sLng, minLat - 0.01, eLng, maxLat + 0.01];
                } else {
                    const totalUsable = maxLat - minLat - localGapLat * (buildingCount - 1);
                    const stripH = totalUsable * ratio;
                    const sLat = minLat + prevRatioSum * totalUsable + i * localGapLat;
                    const eLat = sLat + stripH;
                    clipBbox = [minLng - 0.01, sLat, maxLng + 0.01, eLat];
                }

                const pieces = clipShapeToBbox(clipBbox, `Strip${i}`);
                if (pieces.length > 0) {
                    rawBuildings.push(...pieces);
                } else {
                    console.warn(`[LargeFootprint] Strip ${i}: clip failed, using fallback rectangle`);
                    const cx = useWidth ? (clipBbox[0] + clipBbox[2]) / 2 : cLng;
                    const cy = useWidth ? cLat : (clipBbox[1] + clipBbox[3]) / 2;
                    const fw = useWidth ? (clipBbox[2] - clipBbox[0]) / degPerMLng * 0.9 : widthM * 0.8;
                    const fh = useWidth ? heightM * 0.8 : (clipBbox[3] - clipBbox[1]) / degPerMLat * 0.9;
                    rawBuildings.push(createFallbackRect(cx, cy, fw, fh));
                }
            }
    } else {
        const hShift = (sr(4) - 0.5) * 0.3;
        const vShift = (sr(5) - 0.5) * 0.3;
        
        let midLng = (minLng + maxLng) / 2 + hShift * (maxLng - minLng);
        let midLat = (minLat + maxLat) / 2 + vShift * (maxLat - minLat);
        
        const halfGapLng = gapLng / 2;
        const halfGapLat = gapLat / 2;

        const quadrants: { bbox: [number, number, number, number], label: string }[] = [
            { bbox: [minLng - 0.01, minLat - 0.01, midLng - halfGapLng, midLat - halfGapLat], label: 'SW' },
            { bbox: [midLng + halfGapLng, minLat - 0.01, maxLng + 0.01, midLat - halfGapLat], label: 'SE' },
            { bbox: [minLng - 0.01, midLat + halfGapLat, midLng - halfGapLng, maxLat + 0.01], label: 'NW' },
            { bbox: [midLng + halfGapLng, midLat + halfGapLat, maxLng + 0.01, maxLat + 0.01], label: 'NE' },
        ];

        for (const q of quadrants) {
            const pieces = clipShapeToBbox(q.bbox, q.label);
            if (pieces.length > 0) {
                rawBuildings.push(...pieces);
            } else {
                const cx = (q.bbox[0] + q.bbox[2]) / 2;
                const cy = (q.bbox[1] + q.bbox[3]) / 2;
                rawBuildings.push(createFallbackRect(cx, cy, widthM * 0.35, heightM * 0.35));
            }
        }
    }

    console.log(`[LargeFootprint] Generated ${rawBuildings.length} plot-shaped footprints`);

    const scaledBuildings: Feature<Polygon>[] = [];
    rawBuildings.forEach((poly, idx) => {
        try {
            if (poly.properties?.skipScale) {
                scaledBuildings.push(poly);
                console.log(`[LargeFootprint] Piece ${idx} kept at ${turf.area(poly).toFixed(0)}mÃ‚Â² (pre-sliced)`);
                return;
            }

            const currentArea = turf.area(poly);
            if (currentArea > perBuildingTarget * 1.05) {
                const scaleFactor = Math.sqrt(perBuildingTarget / currentArea);
                try {
                    // @ts-ignore
                    const scaledPoly = turf.transformScale(poly, scaleFactor);
                    if (scaledPoly) {
                        scaledBuildings.push(scaledPoly as Feature<Polygon>);
                        console.log(`[LargeFootprint] Piece ${idx} scaled: ${currentArea.toFixed(0)}mÃ‚Â² -> ${turf.area(scaledPoly).toFixed(0)}mÃ‚Â² (target ${perBuildingTarget.toFixed(0)}mÃ‚Â², factor ${scaleFactor.toFixed(2)})`);
                    } else {
                        scaledBuildings.push(poly);
                    }
                } catch (e) {
                    console.warn(`[LargeFootprint] Failed to transformScale piece ${idx}`, e);
                    scaledBuildings.push(poly);
                }
            } else {
                scaledBuildings.push(poly);
                console.log(`[LargeFootprint] Piece ${idx} kept at ${currentArea.toFixed(0)}mÃ‚Â² (target was ${perBuildingTarget.toFixed(0)}mÃ‚Â²)`);
            }
        } catch (e) {
            console.warn(`[LargeFootprint] Failed to scale piece ${idx}, using original`, e);
            scaledBuildings.push(poly);
        }
    });

    // Set properties for each building
    const finalBuildings: Feature<Polygon>[] = [];
    scaledBuildings.forEach((poly: Feature<Polygon>, idx: number) => {
        try {
            const area = turf.area(poly);
            const coords = poly.geometry.coordinates[0];
            let maxEdgeLen = 0;
            let alignBearing = 0;
            for (let j = 0; j < coords.length - 1; j++) {
                const len = turf.distance(coords[j], coords[j + 1], { units: 'meters' });
                if (len > maxEdgeLen) {
                    maxEdgeLen = len;
                    alignBearing = turf.bearing(coords[j], coords[j + 1]);
                }
            }

            poly.properties = {
                type: 'generated',
                subtype: 'large-footprint',
                area,
                cores: [],
                units: [],
                entrances: [],
                internalUtilities: [],
                alignmentRotation: alignBearing,
                scenarioId: `LargeFootprint-${buildingCount}-${idx}`,
                score: area
            };

            // Try layout generation
            try {
                const layout = generateBuildingLayout(poly, {
                    ...params,
                    subtype: 'large-footprint',
                    unitMix: params.unitMix,
                    alignmentRotation: alignBearing
                });
                if (layout) {
                    poly.properties.cores = layout.cores;
                    poly.properties.units = layout.units;
                    poly.properties.entrances = layout.entrances;
                    poly.properties.internalUtilities = layout.utilities;
                }
            } catch (layoutErr) {
                console.warn(`[LargeFootprint] Layout gen failed for building ${idx}`);
            }

            finalBuildings.push(poly);
        } catch (e) {
            console.error(`[LargeFootprint] Error for building ${idx}:`, e);
        }
    });

    console.log(`[LargeFootprint] FINAL: ${finalBuildings.length}/${buildingCount} buildings. Total footprint: ${finalBuildings.reduce((s, b) => s + turf.area(b), 0).toFixed(0)}mÃ‚Â²`);

    return finalBuildings;
}

/**
 * Commercial Block Generator — Produces clean square / rectangle buildings
 * that fit within the plot's buildable envelope. Unlike generateLargeFootprint
 * which clips the plot shape, this always outputs axis-aligned rectangles.
 */
export function generateCommercialBlocks(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams & { buildingCount?: number; mainSetback?: number }
): Feature<Polygon>[] {
    const {
        sideSetback = 6,
        frontSetback = 6,
        rearSetback = 6,
        roadAccessSides = [],
        maxFootprint,
        seed = 0
    } = params;

    const buildingCount = Math.max(1, Math.min(4, params.buildingCount ?? 1));

    let workArea: Feature<Polygon>;
    if (plotGeometry.geometry.type === 'MultiPolygon') {
        const largest = ensurePolygonFeature(plotGeometry);
        if (!largest) { console.warn('[CommBlocks] Could not extract Polygon'); return []; }
        workArea = largest;
    } else {
        workArea = plotGeometry as Feature<Polygon>;
    }

    // Setbacks are already applied to the chunk (by use-building-store.ts)
    // Apply a small internal margin so buildings don't touch the workArea edge
    const internalMargin = 3; // meters
    if (internalMargin > 0) {
        const buffered = turf.buffer(workArea, -internalMargin / 1000, { units: 'kilometers' });
        if (buffered) { const p = ensurePolygonFeature(buffered); if (p) workArea = p; }
    }

    console.log(`[CommBlocks] Work area after margin: ${turf.area(workArea).toFixed(0)}m²`);

    const bbox = turf.bbox(workArea);
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const widthM = turf.distance([minLng, minLat], [maxLng, minLat], { units: 'meters' });
    const heightM = turf.distance([minLng, minLat], [minLng, maxLat], { units: 'meters' });
    if (widthM < 15 || heightM < 15) { console.warn('[CommBlocks] Plot too narrow after setbacks'); return []; }

    const degPerMLng = (maxLng - minLng) / widthM;
    const degPerMLat = (maxLat - minLat) / heightM;
    const workAreaSqm = turf.area(workArea);

    // Target footprint: use maxFootprint if given but cap to 70% of the REDUCED work area
    // This ensures buildings don't fill the entire post-setback area
    const totalTarget = Math.min(maxFootprint ?? (workAreaSqm * 0.6), workAreaSqm * 0.7);
    const gapM = Math.max(sideSetback, 6); // Gap between buildings

    // Seed-based variation
    const sr = (offset: number) => { const x = Math.sin((seed + offset) * 9.8765) * 10000; return x - Math.floor(x); };

    // Decide split axis: prefer splitting along the LONGER axis
    const splitAlongWidth = widthM >= heightM;

    console.log(`[CommBlocks] START: count=${buildingCount}, workArea=${widthM.toFixed(0)}×${heightM.toFixed(0)}m (${workAreaSqm.toFixed(0)}m²), target=${totalTarget.toFixed(0)}m², gap=${gapM}m, axis=${splitAlongWidth ? 'W' : 'H'}`);

    const results: Feature<Polygon>[] = [];
    const centroid = turf.centroid(workArea);
    const [cLng, cLat] = centroid.geometry.coordinates;

    // Internal building margin from work area edges (buildings sit inset from the workArea boundary)
    const buildingInset = 3; // meters
    const effectiveW = widthM - buildingInset * 2;
    const effectiveH = heightM - buildingInset * 2;

    const createRect = (cx: number, cy: number, wM: number, hM: number): Feature<Polygon> => {
        const halfW = (wM / 2) * degPerMLng;
        const halfH = (hM / 2) * degPerMLat;
        return turf.polygon([[
            [cx - halfW, cy - halfH],
            [cx + halfW, cy - halfH],
            [cx + halfW, cy + halfH],
            [cx - halfW, cy + halfH],
            [cx - halfW, cy - halfH],
        ]]);
    };

    if (buildingCount === 1) {
        // Single large rectangle centered in the work area
        const variation = seed % 4;
        let bW: number, bH: number;

        if (variation === 0) {
            // Square-ish: use shorter axis as guide
            const side = Math.min(effectiveW, effectiveH) * 0.75;
            bW = side; bH = side;
        } else if (variation === 1) {
            // Wide rectangle
            bW = effectiveW * 0.8;
            bH = Math.min(effectiveH * 0.6, totalTarget / bW);
        } else if (variation === 2) {
            // Deep rectangle
            bH = effectiveH * 0.8;
            bW = Math.min(effectiveW * 0.6, totalTarget / bH);
        } else {
            // Golden ratio
            const ratio = 1.618;
            bW = Math.sqrt(totalTarget * ratio);
            bH = totalTarget / bW;
        }

        // Clamp to effective bounds
        bW = Math.min(bW, effectiveW * 0.85); bH = Math.min(bH, effectiveH * 0.85);
        bW = Math.max(bW, 20); bH = Math.max(bH, 20);

        // Scale down if exceeding target
        const area = bW * bH;
        if (area > totalTarget * 1.05) {
            const scale = Math.sqrt(totalTarget / area);
            bW *= scale; bH *= scale;
        }

        const rect = createRect(cLng, cLat, bW, bH);
        results.push(rect);
        console.log(`[CommBlocks] Single block: ${bW.toFixed(0)}×${bH.toFixed(0)}m = ${(bW * bH).toFixed(0)}m²`);

    } else if (buildingCount <= 3) {
        // 2-3 buildings split along primary axis
        const perBuilding = totalTarget / buildingCount;
        const totalGap = gapM * (buildingCount - 1);

        if (splitAlongWidth) {
            const availW = effectiveW - totalGap;
            const eachW = Math.max(availW / buildingCount, 15);
            const eachH = Math.min(effectiveH * 0.75, perBuilding / eachW);
            const clampedW = Math.min(eachW * 0.9, effectiveW / buildingCount * 0.85);
            const clampedH = Math.max(Math.min(eachH, effectiveH * 0.75), 15);

            for (let i = 0; i < buildingCount; i++) {
                // Position each building evenly along width
                const stripW = effectiveW / buildingCount;
                const cx = minLng + (buildingInset + stripW * (i + 0.5)) * degPerMLng;
                const rect = createRect(cx, cLat, clampedW, clampedH);
                results.push(rect);
                console.log(`[CommBlocks] Block ${i}: ${clampedW.toFixed(0)}×${clampedH.toFixed(0)}m at strip ${i}`);
            }
        } else {
            const availH = effectiveH - totalGap;
            const eachH = Math.max(availH / buildingCount, 15);
            const eachW = Math.min(effectiveW * 0.75, perBuilding / eachH);
            const clampedH = Math.min(eachH * 0.9, effectiveH / buildingCount * 0.85);
            const clampedW = Math.max(Math.min(eachW, effectiveW * 0.75), 15);

            for (let i = 0; i < buildingCount; i++) {
                const stripH = effectiveH / buildingCount;
                const cy = minLat + (buildingInset + stripH * (i + 0.5)) * degPerMLat;
                const rect = createRect(cLng, cy, clampedW, clampedH);
                results.push(rect);
                console.log(`[CommBlocks] Block ${i}: ${clampedW.toFixed(0)}×${clampedH.toFixed(0)}m at strip ${i}`);
            }
        }
    } else {
        // 4 buildings: 2×2 grid
        const quadW = (effectiveW - gapM) / 2;
        const quadH = (effectiveH - gapM) / 2;
        const bW = Math.max(quadW * 0.8, 15);
        const bH = Math.max(quadH * 0.8, 15);

        const insetLng = buildingInset * degPerMLng;
        const insetLat = buildingInset * degPerMLat;
        const halfGapLng = (gapM / 2) * degPerMLng;
        const halfGapLat = (gapM / 2) * degPerMLat;

        const quadrants = [
            { cx: (minLng + insetLng + cLng - halfGapLng) / 2, cy: (minLat + insetLat + cLat - halfGapLat) / 2, label: 'SW' },
            { cx: (cLng + halfGapLng + maxLng - insetLng) / 2, cy: (minLat + insetLat + cLat - halfGapLat) / 2, label: 'SE' },
            { cx: (minLng + insetLng + cLng - halfGapLng) / 2, cy: (cLat + halfGapLat + maxLat - insetLat) / 2, label: 'NW' },
            { cx: (cLng + halfGapLng + maxLng - insetLng) / 2, cy: (cLat + halfGapLat + maxLat - insetLat) / 2, label: 'NE' },
        ];

        for (const q of quadrants) {
            const rect = createRect(q.cx, q.cy, bW, bH);
            results.push(rect);
            console.log(`[CommBlocks] Block ${q.label}: ${bW.toFixed(0)}×${bH.toFixed(0)}m`);
        }
    }

    // Clip each building to the workArea and assign properties + layout
    const finalBuildings: Feature<Polygon>[] = [];
    results.forEach((rect, idx) => {
        try {
            // @ts-ignore
            let clipped = turf.intersect(rect, workArea);
            if (!clipped) { clipped = rect; }
            let poly: Feature<Polygon>;
            if (clipped.geometry.type === 'MultiPolygon') {
                const p = ensurePolygonFeature(clipped);
                if (!p) return;
                poly = p;
            } else {
                poly = clipped as Feature<Polygon>;
            }

            const area = turf.area(poly);
            if (area < 50) return;

            // Find alignment
            const coords = poly.geometry.coordinates[0];
            let maxEdgeLen = 0, alignBearing = 0;
            for (let j = 0; j < coords.length - 1; j++) {
                const len = turf.distance(coords[j], coords[j + 1], { units: 'meters' });
                if (len > maxEdgeLen) { maxEdgeLen = len; alignBearing = turf.bearing(coords[j], coords[j + 1]); }
            }

            poly.properties = {
                type: 'generated',
                subtype: 'commercial-block',
                area,
                cores: [],
                units: [],
                entrances: [],
                internalUtilities: [],
                alignmentRotation: alignBearing,
                scenarioId: `CommBlock-${buildingCount}-${idx}`,
                score: area
            };

            try {
                const layout = generateBuildingLayout(poly, {
                    ...params,
                    subtype: 'commercial-block',
                    unitMix: params.unitMix,
                    alignmentRotation: alignBearing
                });
                if (layout) {
                    poly.properties.cores = layout.cores;
                    poly.properties.units = layout.units;
                    poly.properties.entrances = layout.entrances;
                    poly.properties.internalUtilities = layout.utilities;
                }
            } catch (e) {
                console.warn(`[CommBlocks] Layout gen failed for building ${idx}`);
            }

            finalBuildings.push(poly);
        } catch (e) {
            console.error(`[CommBlocks] Error for building ${idx}:`, e);
        }
    });

    console.log(`[CommBlocks] FINAL: ${finalBuildings.length}/${buildingCount} buildings. Total footprint: ${finalBuildings.reduce((s, b) => s + turf.area(b), 0).toFixed(0)}m²`);
    return finalBuildings;
}

/** Helper: ensure a GeoJSON feature is a single Polygon */
function ensurePolygonFeature(f: any): Feature<Polygon> | null {
    if (!f || !f.geometry) return null;
    if (f.geometry.type === 'Polygon') return f as Feature<Polygon>;
    if (f.geometry.type === 'MultiPolygon') {
        try {
            // @ts-ignore
            const parts = turf.flatten(f);
            let best: Feature<Polygon> | null = null;
            let bestArea = 0;
            parts.features.forEach((p: any) => {
                const a = turf.area(p);
                if (a > bestArea) {
                    bestArea = a;
                    best = p as Feature<Polygon>;
                }
            });
            return best;
        } catch (e) {
            if (f.geometry.coordinates && f.geometry.coordinates.length > 0) {
                return turf.polygon(f.geometry.coordinates[0]) as Feature<Polygon>;
            }
        }
    }
    return null;
}

