import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { UnitTypology } from '../types';
import { applyVariableSetbacks } from './setback-utils';

export type AlgoTypology = 'lamella' | 'tower' | 'perimeter' | 'point' | 'slab' | 'lshaped' | 'ushaped' | 'tshaped' | 'hshaped' | 'oshaped';

export interface AlgoParams {
    typology: AlgoTypology;
    spacing: number;       
    width: number;         
    setback: number;       

    // Variable Setbacks
    frontSetback?: number;
    rearSetback?: number;
    sideSetback?: number;
    roadAccessSides?: string[]; 

    orientation: number;   
    wingDepth?: number;    
    minLength?: number;    

    // Extended Params (for UI binding)
    targetGFA?: number;
    targetFAR?: number;
    minFloors?: number;
    maxFloors?: number;
    shuffleUnits?: boolean;
    exactTypologyAllocation?: boolean; 
    minHeight?: number;
    maxHeight?: number; 
    minFootprint?: number;
    maxFootprint?: number;
    minSCR?: number;
    maxSCR?: number;
    parkingRatio?: number;
    gridOrientation?: number;
    avgUnitSize?: number;
    commercialPercent?: number;
    landUse?: string; 
    selectedUtilities?: string[];
    programMix?: { residential: number; commercial: number; institutional: number; hospitality: number; };
    commercialMix?: { retail: number; office: number };
    allocationMode?: 'floor' | 'plot'; 
    parkingType?: any;
    parkingTypes?: ('ug' | 'pod' | 'surface' | 'ground' | 'none')[];
    floorHeight?: number;
    groundFloorHeight?: number;
    maxAllowedFAR?: number; 
    siteCoverage?: number;
    seedOffset?: number;

    // Podium / Stepped Massing
    hasPodium?: boolean;
    podiumFloors?: number;
    upperFloorReduction?: number;

    // Dimensional Constraints
    minBuildingWidth?: number;
    maxBuildingWidth?: number;
    minBuildingLength?: number;
    maxBuildingLength?: number;

    // Multi-Typology & Vastu
    typologies?: string[];
    vastuCompliant?: boolean;

    // Advanced Placement
    obstacles?: Feature<Polygon>[];
    targetPosition?: Feature<Point>;

    // Optional Hints
    wingLengthA?: number;
    wingLengthB?: number;

    // Seed for pagination/refresh
    seed?: number;

    // Unit Mix Configuration
    unitMix?: UnitTypology[];

    // GFA Maximization Mode
    autoMaxGFA?: boolean; 
    infillSetback?: number; 
    infillMode?: 'ring' | 'grid' | 'hybrid'; 
    intendedUse?: string;
}

export type LamellaParams = AlgoParams;

function seededRandom(x: number, y: number, seed: number = 0) {
    const vector = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return vector - Math.floor(vector);
}

export function generateTowers(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { spacing, width, orientation, setback, obstacles, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    const maxWidth = maxBuildingWidth || width;
    const minWidth = minBuildingWidth || (maxWidth * 0.7); 

    //Apply Setback
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);
    if (!bufferedPlot) return [];

    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    //Create Grid of Points
    const sideGap = params.sideSetback ?? params.spacing ?? 6;
    const depthGap = (params.frontSetback ?? 6) + (params.rearSetback ?? 6);

    const strideX = maxWidth + sideGap;
    const strideY = maxWidth + depthGap;

    const center = turf.centroid(validArea);
    const pMin = turf.point([minX, minY]);
    const pMax = turf.point([maxX, maxY]);
    const diagonal = turf.distance(pMin, pMax, { units: 'kilometers' as const }) * 1000;
    const genSize = diagonal * 1.5;

    const cols = Math.ceil(genSize / strideX);
    const rows = Math.ceil(genSize / strideY);

    const startX = -genSize / 2;
    const startY = -genSize / 2;

    const destination = turf.rhumbDestination || turf.destination;

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const xOffset = startX + (i * strideX);
            const yOffset = startY + (j * strideY);

            //Move from center along rotated axes
            const p1 = destination(center, xOffset, orientation, { units: 'meters' as const });
            const pointLoc = destination(p1, yOffset, orientation + 90, { units: 'meters' as const });

            //Randomize Width for this tower
            const rand = seededRandom(i, j, seedOffset);
            const currentWidth = minWidth + (rand * (maxWidth - minWidth));

            // Create tower footprint (square)
            const hw = currentWidth / 2;
            const c1 = destination(pointLoc, hw * Math.sqrt(2), orientation + 45, { units: 'meters' as const });
            const c2 = destination(pointLoc, hw * Math.sqrt(2), orientation + 135, { units: 'meters' as const });
            const c3 = destination(pointLoc, hw * Math.sqrt(2), orientation + 225, { units: 'meters' as const });
            const c4 = destination(pointLoc, hw * Math.sqrt(2), orientation + 315, { units: 'meters' as const });

            const poly = turf.polygon([[
                c1.geometry.coordinates,
                c2.geometry.coordinates,
                c3.geometry.coordinates,
                c4.geometry.coordinates,
                c1.geometry.coordinates
            ]]);

            if (turf.booleanPointInPolygon(pointLoc, validArea)) {
                const intersect = turf.intersect(poly, validArea);
                if (intersect) {
                    const area = turf.area(intersect);
                    if (area > (currentWidth * currentWidth) * 0.5) {

                        //Check GFA Constraints
                        if (params.targetGFA && params.maxFloors) {
                            const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                            const potentialGFA = area * params.maxFloors;
                            if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                                continue;
                            }
                        }

                        const clippedPoly = intersect as Feature<Polygon>;

                        let collision = false;
                        if (obstacles && obstacles.length > 0) {
                            for (const obs of obstacles) {
                                if (turf.booleanOverlap(clippedPoly, obs) || turf.booleanContains(obs, clippedPoly) || turf.booleanContains(clippedPoly, obs)) {
                                    collision = true;
                                    break;
                                }
                                const obsIntersect = turf.intersect(clippedPoly, obs);
                                if (obsIntersect) {
                                    collision = true;
                                    break;
                                }
                            }
                        }

                        if (!collision) {
                            clippedPoly.properties = {
                                type: 'generated',
                                subtype: 'tower',
                                width: currentWidth,
                                area: area
                            };
                            buildings.push(clippedPoly);
                        }
                    }
                }
            }
        }
    }

    return buildings;
}

/**
 * Generates a perimeter block (courtyard)
 */
export function generatePerimeter(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { width, setback, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    const minW = minBuildingWidth || (width * 0.8);
    const maxW = maxBuildingWidth || width;

    const rand = seededRandom(1, 1, seedOffset);
    const currentWidth = minW + (rand * (maxW - minW));

    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);
    if (!bufferedPlot) return [];
    const outerPoly = bufferedPlot as Feature<Polygon>;

    const innerPoly = turf.buffer(outerPoly, -currentWidth / 1000, { units: 'kilometers' as const });

    if (!innerPoly) {
        outerPoly.properties = { type: 'generated', subtype: 'block' };
        return [outerPoly];
    }

    const block = turf.difference(outerPoly, innerPoly);

    if (block) {
        const geoms = block.geometry.type === 'MultiPolygon'
            ? block.geometry.coordinates.map((c: any) => turf.polygon(c))
            : [block as Feature<Polygon>];

        geoms.forEach((geom: Feature<Polygon>) => {
            const area = turf.area(geom);

            if (params.targetGFA && params.maxFloors) {
                const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                const potentialGFA = area * params.maxFloors;
                if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                    return;
                }
            }

            geom.properties = {
                type: 'generated',
                subtype: 'perimeter',
                width,
                area: area
            };
            buildings.push(geom as Feature<Polygon>);
        });
    }

    return buildings;
}

/**
 * Generates parallel "Lamella" (linear) blocks inside a given polygon.
 */
export function generateLamellas(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { spacing, width, orientation, setback, minLength = 10, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    const minW = minBuildingWidth || (width * 0.8);
    const maxW = maxBuildingWidth || width;

    const rand = seededRandom(2, 2, seedOffset);
    const currentWidth = minW + (rand * (maxW - minW));

    console.log('[generateLamellas] params:', params);

    //Apply Setback
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);

    if (!bufferedPlot) return [];

    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    const point1 = turf.point([minX, minY]);
    const point2 = turf.point([maxX, maxY]);
    const diagonal = turf.distance(point1, point2, { units: 'kilometers' as const }) * 1000;
    const center = turf.centroid(validArea);

    const stride = currentWidth + spacing;
    const generationSize = diagonal * 1.5;

    const destination = turf.rhumbDestination || turf.destination;

    const rot = orientation;

    const count = Math.ceil(generationSize / stride);

    for (let i = -Math.floor(count / 2); i <= Math.ceil(count / 2); i++) {
        const offset = i * stride;

        //Randomize width per bar for variety
        const rand = seededRandom(i, count, seedOffset);
        const currentWidth = minW + (rand * (maxW - minW));

        //Move perpendicular to orientation (rot + 90)
        const origin = destination(center, offset, rot + 90, { units: 'meters' as const });

        //Create line segment
        const p1 = destination(origin, generationSize / 2, rot, { units: 'meters' as const });
        const p2 = destination(origin, generationSize / 2, rot + 180, { units: 'meters' as const });

        const line = turf.lineString([p1.geometry.coordinates, p2.geometry.coordinates]);

        // Buffer line to create rectangle
        const buildingPoly = turf.buffer(line, currentWidth / 2 / 1000, { units: 'kilometers', steps: 4 });

        if (!buildingPoly) continue;

        //Intersect
        let intersection = null;
        try {
            intersection = turf.intersect(validArea, buildingPoly);
        } catch (e) {
            continue;
        }

        if (intersection) {
            const geomType = intersection.geometry.type;
            let polys: Feature<Polygon>[] = [];

            if (geomType === 'Polygon') {
                polys = [intersection as Feature<Polygon>];
            } else if (geomType === 'MultiPolygon') {
                const coords = (intersection as Feature<MultiPolygon>).geometry.coordinates;
                polys = coords.map(c => turf.polygon(c) as Feature<Polygon>);
            }

            polys.forEach(poly => {
                const area = turf.area(poly);

                if (area > (width * minLength)) {
                    if (params.targetGFA && params.maxFloors) {
                        const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                        const potentialGFA = area * params.maxFloors;

                        if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                            return; 
                        }
                    }

                    poly.properties = {
                        type: 'generated',
                        subtype: 'lamella',
                        width,
                        area
                    };
                    buildings.push(poly);
                }
            });
        }
    }

    return buildings;
}
