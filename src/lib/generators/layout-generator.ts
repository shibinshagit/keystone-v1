
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { Building, Core, Unit, UnitTypology, UtilityArea, UtilityType, EntryPoint, BuildingIntendedUse } from '../types';
import { generateVastuGates } from '../vastu-gate-generator';

interface LayoutParams {
    minUnitSize?: number; 
    avgUnitSize?: number; 
    corridorWidth?: number; 
    subtype?: string; 
    roadAccessSides?: string[]; 
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[]; 
    alignmentRotation?: number; 
    intendedUse?: BuildingIntendedUse | string; 
    numFloors?: number;
    floorHeight?: number;
    shuffleUnits?: boolean; 
    exactTypologyAllocation?: boolean; 
    buildingId?: string; 
    selectedUtilities?: string[]; 
}

// Get cardinal direction of a bearing (0-360)
function getCardinalDirection(bearing: number): string {
    const b = (bearing + 360) % 360;
    if (b >= 315 || b < 45) return 'N';
    if (b >= 45 && b < 135) return 'E';
    if (b >= 135 && b < 225) return 'S';
    if (b >= 225 && b < 315) return 'W';
    return 'N';
}

// Get base color for unit type
function getColorForUnitType(unitName: string): string {
    const name = unitName.toLowerCase();
    if (name.includes('studio')) return '#ADD8E6'; // Light Blue
    if (name.includes('1bhk') || name.includes('1 bhk')) return '#80BC65'; // Green
    if (name.includes('2bhk') || name.includes('2 bhk')) return '#1E90FF'; // Blue
    if (name.includes('3bhk') || name.includes('3 bhk')) return '#DA70D6'; // Orchid
    if (name.includes('4bhk') || name.includes('4 bhk')) return '#FFD700'; // Gold
    if (name.includes('office')) return '#A9A9A9'; // Dark Gray
    if (name.includes('guest room') || name.includes('suite')) return '#70c8daff'; 
    if (name.includes('hall') || name.includes('public')) return '#F0E68C'; // Khaki
    return '#414141';
}

// Darken a hex color by 10%
function darkenColor(hex: string): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xFF) - 25);
    const g = Math.max(0, ((num >> 8) & 0xFF) - 25);
    const b = Math.max(0, (num & 0xFF) - 25);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/**
 * Create a rotated rectangle polygon.
 * @param center Centroid of the rectangle
 * @param widthWidth in meters
 * @param height Height in meters
 * @param bearing Bearing in degrees (0 = north, clockwise)
 */
function createRotatedRect(center: Feature<Point>, width: number, height: number, bearing: number = 0): Feature<Polygon> {
    const wHalf = width / 2;
    const hHalf = height / 2;

    const corners = [
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(-wHalf, hHalf) * 180 / Math.PI }, // NW
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(wHalf, hHalf) * 180 / Math.PI },  // NE
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(wHalf, -hHalf) * 180 / Math.PI }, // SE
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(-wHalf, -hHalf) * 180 / Math.PI }, // SW
    ];

    const ring = corners.map(c => turf.destination(center, c.dist, c.angle, { units: 'meters' }).geometry.coordinates);
    ring.push(ring[0]);

    return turf.polygon([ring as any]);
}

/**
 * Determine the dominant orientation (bearing) of a plot.
 */
export function getPlotOrientation(plotPoly: Feature<Polygon>): number {
    try {
        const coords = plotPoly.geometry.coordinates[0];
        let maxLen = -1;
        let dominantBearing = 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const len = turf.distance(p1, p2, { units: 'meters' });
            if (len > maxLen) {
                maxLen = len;
                dominantBearing = turf.bearing(p1, p2);
            }
        }
        return dominantBearing;
    } catch (e) {
        return 0;
    }
}

/**
 * Generates an internal layout (Cores + Units) for a given building geometry.
 */
export function generateBuildingLayout(
    buildingPoly: Feature<Polygon | MultiPolygon>,
    params: LayoutParams = {}
): { cores: Core[], units: Unit[], entrances: any[], utilities: UtilityArea[], efficiency?: number } {
    console.log('[Layout Generator] Generating layout with params:', params);

    // --- ROTATION WRAPPER START ---
    let workingPoly = buildingPoly;
    const rotationAngle = params.alignmentRotation || 0;
    const center = turf.centroid(buildingPoly);

    if (rotationAngle !== 0) {
        workingPoly = turf.transformRotate(buildingPoly, -rotationAngle, { pivot: center });
    }
    // --- ROTATION WRAPPER END ---

    const cores: Core[] = [];
    const units: Unit[] = [];
    const entrances: any[] = [];
    const utilities: UtilityArea[] = [];

    const minUnitSize = params.minUnitSize || 60;
    const targetUnitSize = params.avgUnitSize || 120;
    const intendedUse = params.intendedUse || 'Residential';

    // ---CORE CALCULATION LOGIC ---
    const floorArea = turf.area(workingPoly); // Area per floor (BUA)
    const floors = params.numFloors || 5; 
    const height = floors * (params.floorHeight || 3.1);

    // Determine Population (POP) per floor
    let popPerFloor = 0;
    let assumedUnitsPerFloor = 0;
    
    if (intendedUse === 'Residential') {
        const estUnitSize = targetUnitSize;
        assumedUnitsPerFloor = Math.max(1, Math.floor((floorArea * 0.75) / estUnitSize)); // Assuming 75% efficiency
        popPerFloor = assumedUnitsPerFloor * 5; // 5 persons per unit
    } else if (intendedUse === 'Commercial' || intendedUse === 'Industrial') {
        popPerFloor = floorArea / 10; // 10 sqm per person
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        popPerFloor = floorArea / 6; // 6 sqm per person
    } else {
        popPerFloor = floorArea / 10; // Fallback
    }

    if (popPerFloor < 1) popPerFloor = 10; // Minimum safety

    // 3. LIFT CALCULATIONS
    let numLifts = 0;
    let passengerLifts = 0;
    let serviceLifts = 0;
    let stretcherLifts = 0;

    if (intendedUse === 'Residential') {
        passengerLifts = Math.max(1, Math.ceil(assumedUnitsPerFloor / 80)); // 1 per 70-90 units
    } else if (intendedUse === 'Commercial' || intendedUse === 'Industrial') {
        passengerLifts = Math.max(1, Math.ceil(popPerFloor / 275)); // 1 per 250-300 pop
        // OR 1 per 800-1000 sqm
        const areaBasedLifts = Math.max(1, Math.ceil(floorArea / 900));
        passengerLifts = Math.max(passengerLifts, areaBasedLifts);
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public' || intendedUse === 'Hospitality') {
        passengerLifts = Math.max(1, Math.ceil(floorArea / 2250)); // 1 per 2000-2500 sqm
        stretcherLifts = 1; // Mandatory
    } else {
        passengerLifts = Math.max(1, Math.ceil(floorArea / 1000));
    }

    // Height overrides
    if (floors > 10) serviceLifts += 1; // Fire lift essentially
    if (floors > 20) serviceLifts += 1;

    const liftArea = (passengerLifts * 2.5) + (serviceLifts * 5.0) + (stretcherLifts * 6.0);
    numLifts = passengerLifts + serviceLifts + stretcherLifts;

    // 4. STAIRCASE CALCULATIONS
    let numStairs = (popPerFloor <= 30 && height <= 20) ? 1 : 2;
    if (popPerFloor > 500 && (intendedUse === 'Commercial' || intendedUse === 'Institutional')) {
        numStairs = 3;
    }

    let stairAreaPerStair = 15; // default residential
    if (intendedUse === 'Commercial') stairAreaPerStair = 22;
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') stairAreaPerStair = 28;

    const stairArea = numStairs * stairAreaPerStair;

    // 5. LOBBY & CORRIDOR CALCULATIONS
    let lobbyMultiplier = 4; // Res default
    if (intendedUse === 'Commercial') lobbyMultiplier = 6;
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') lobbyMultiplier = 8;
    
    const lobbyArea = numLifts * lobbyMultiplier;

    let corridorArea = 0;
    if (intendedUse === 'Residential') {
        if (assumedUnitsPerFloor <= 4) corridorArea = 8;
        else if (assumedUnitsPerFloor <= 8) corridorArea = 16;
        else corridorArea = 28;
    } else if (intendedUse === 'Commercial') {
        corridorArea = floorArea * 0.08; // 8%
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        corridorArea = floorArea * 0.12; // 12%
    }

    // 6. SHAFT CALCULATIONS
    let shaftArea = 0;
    // Plumbing (Res: 1 per 4 units, Comm: 1 per 750sqm, Inst: 1 per 500sqm)
    let plumbingShafts = 1;
    if (intendedUse === 'Residential') {
        plumbingShafts = Math.ceil(assumedUnitsPerFloor / 4);
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        plumbingShafts = Math.ceil(floorArea / 500);
    } else {
        plumbingShafts = Math.ceil(floorArea / 750);
    }
    shaftArea += plumbingShafts * 0.8;
    
    // Elec/Fire (1 per core roughly)
    const numPhysicalCores = params.subtype === 'ushaped' ? 2 : 1; 
    shaftArea += (numPhysicalCores * 0.6) + (numPhysicalCores * 0.5); // Elec + Fire

    // HVAC Riser
    if (intendedUse === 'Commercial') shaftArea += Math.ceil(floorArea / 1000) * 3;
    else if (intendedUse === 'Institutional') shaftArea += numPhysicalCores * 4.5;

    // Garbage/Others
    if (intendedUse === 'Residential' && assumedUnitsPerFloor >= 6) shaftArea += 0.7;
    else if (intendedUse === 'Hospitality' || intendedUse === 'Institutional') shaftArea += 1.5;

    // Fire Check Lobby
    let fireLobbyArea = 0;
    if (height > 24) {
        fireLobbyArea = numPhysicalCores * 10;
    }

    const calculatedCoreAreaPerFloor = liftArea + stairArea + lobbyArea + corridorArea + shaftArea + fireLobbyArea;
    const coreAreaPerNode = calculatedCoreAreaPerFloor / numPhysicalCores;
    

    const coreRatio = calculatedCoreAreaPerFloor / floorArea;
    
    let healthyMin = 0.25, healthyMax = 0.35;
    if (intendedUse === 'Residential') { healthyMin = 0.15; healthyMax = 0.25; }
    else if (intendedUse === 'Retail') { healthyMin = 0.35; healthyMax = 0.50; }
    else if (intendedUse === 'Commercial' || intendedUse === 'Office' || intendedUse === 'Industrial') { healthyMin = 0.25; healthyMax = 0.35; }
    else if (intendedUse === 'Hospitality') { healthyMin = 0.25; healthyMax = 0.40; }
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') { healthyMin = 0.30; healthyMax = 0.40; }
    else if (intendedUse === 'MixedUse' || params.subtype === 'mixed') { healthyMin = 0.25; healthyMax = 0.35; }
    
    if (coreRatio < healthyMin || coreRatio > healthyMax) {
        console.warn(`[Audit] Core ratio ${(coreRatio*100).toFixed(1)}% is outside healthy range (${healthyMin*100}-${healthyMax*100}%) for ${intendedUse}!`);
    } else {
        console.log(`[Audit] Core ratio ${(coreRatio*100).toFixed(1)}% is within healthy bounds (${healthyMin*100}-${healthyMax*100}%) for ${intendedUse}.`);
    }
    
    const minCoreArea = Math.max(20, floorArea * healthyMin / numPhysicalCores);
    const maxCoreArea = floorArea * (healthyMax + 0.05) / numPhysicalCores;
    
    let finalCoreArea = coreAreaPerNode;
    if (coreAreaPerNode < minCoreArea) {
        console.warn(`[Layout Gen] Core calculation (${coreAreaPerNode.toFixed(1)} sqm) is below healthy minimum (${minCoreArea.toFixed(1)} sqm). Enforcing minimum benchmark area.`);
        finalCoreArea = minCoreArea;
    } else if (coreAreaPerNode > maxCoreArea) {
        finalCoreArea = maxCoreArea;
    }

    const bbox = turf.bbox(workingPoly);
    const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const depth = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });

    const isHorizontal = width > depth;
    const longAxis = isHorizontal ? width : depth;
    const shortAxis = isHorizontal ? depth : width;
    
    let coreW = 0;
    let coreD = 0;
    
    let spineLength = Math.max(10, longAxis - 16); 
    let spineThickness = finalCoreArea / spineLength;

    if (spineThickness < 2.5) {
        spineThickness = 2.5;
        spineLength = finalCoreArea / spineThickness;
    } else if (spineThickness > shortAxis * 0.5) {
        spineThickness = shortAxis * 0.5;
        spineLength = finalCoreArea / spineThickness;
    }
    
    if (isHorizontal) {
        coreW = spineLength;
        coreD = spineThickness;
    } else {
        coreW = spineThickness;
        coreD = spineLength;
    }

    coreW = Math.min(coreW, width * 0.95);
    coreD = Math.min(coreD, depth * 0.95);

    console.log(`[Layout Gen] Computed Core -> Pop: ${popPerFloor.toFixed(0)}, Lifts: ${numLifts}, Stairs: ${numStairs}, Area: ${finalCoreArea.toFixed(1)} sqm, Dims: ${coreW.toFixed(1)}x${coreD.toFixed(1)}`);

    const createCoreAtPoint = (point: Feature<any>, id: string): Feature<Polygon> | null => {
        const coords = point.geometry.coordinates;
        const pt = turf.point(coords);
        
        const n = turf.destination(pt, coreD / 2 / 1000, 0).geometry.coordinates[1];
        const s = turf.destination(pt, coreD / 2 / 1000, 180).geometry.coordinates[1];
        const e = turf.destination(pt, coreW / 2 / 1000, 90).geometry.coordinates[0];
        const w = turf.destination(pt, coreW / 2 / 1000, -90).geometry.coordinates[0];
        
        let corePoly = turf.bboxPolygon([w, s, e, n]);

        const clipped = turf.intersect(corePoly, workingPoly);
        if (clipped && turf.area(clipped) > 10) { 
            return clipped as Feature<Polygon>;
        }
        return null;
    };

    // Typology-Specific Core Placement
    console.log('[Layout Generator] Generating cores for subtype:', params.subtype);

    if (params.subtype === 'lshaped') {
        console.log('[Layout Generator] L-Shape detected - placing core at junction');
        const [minX, minY, maxX, maxY] = bbox;

        // For L-shapes, the inner corner is where the two wings meet
        const candidates = [
            turf.point([minX + (maxX - minX) * 0.35, minY + (maxY - minY) * 0.35]), // SW inner
            turf.point([maxX - (maxX - minX) * 0.35, minY + (maxY - minY) * 0.35]), // SE inner
            turf.point([maxX - (maxX - minX) * 0.35, maxY - (maxY - minY) * 0.35]), // NE inner
            turf.point([minX + (maxX - minX) * 0.35, maxY - (maxY - minY) * 0.35]), // NW inner
            // Additional candidates closer to edges
            turf.point([minX + (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]),
            turf.point([maxX - (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]),
            turf.point([maxX - (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]),
            turf.point([minX + (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]),
        ];

        for (const candidate of candidates) {
            // @ts-ignore
            if (turf.booleanContains(workingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, 'core-l-junction');
                if (core) {
                    console.log('[Layout Generator] L-Shape core placed at junction');
                    cores.push({ id: 'core-l-junction', type: 'Lobby', geometry: core });
                    break;
                }
            }
        }

    } else if (params.subtype === 'ushaped') {
        // U-Shape: Two cores at the base inner corners
        console.log('[Layout Generator] U-Shape detected - placing two cores');
        const [minX, minY, maxX, maxY] = bbox;

        // Simplified U-shape candidates (Base Corners)
        const candidates = [
            turf.point([minX + (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]), // SW
            turf.point([maxX - (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]), // SE
            turf.point([maxX - (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]), // NE
            turf.point([minX + (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]), // NW
        ];
        // Place 2 cores for U-Shape if possible
        let placed = 0;
        for (const candidate of candidates) {
            if (placed >= 2) break;
            // @ts-ignore
            if (turf.booleanContains(workingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, `core-u-${placed}`);
                if (core) {
                    cores.push({ id: `core-u-${placed}`, type: 'Lobby', geometry: core });
                    placed++;
                }
            }
        }

    } else if (params.subtype === 'tshaped') {
        // T-Shape: Core at the stem/cap junction
        console.log('[Layout Generator] T-Shape detected - placing core at junction');
        const [minX, minY, maxX, maxY] = bbox;
        const midX = (minX + maxX) / 2;

        // Junction is where stem meets cap - try multiple heights
        const candidates = [
            turf.point([midX, maxY - (maxY - minY) * 0.35]),
            turf.point([midX, maxY - (maxY - minY) * 0.40]),
            turf.point([midX, maxY - (maxY - minY) * 0.30]),
            turf.point([midX, minY + (maxY - minY) * 0.50]), // Center fallback
        ];

        for (const candidate of candidates) {
            // @ts-ignore
            if (turf.booleanContains(workingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, 'core-t-junction');
                if (core) {
                    console.log('[Layout Generator] T-Shape core placed at junction');
                    cores.push({ id: 'core-t-junction', type: 'Lobby', geometry: core });
                    break;
                }
            }
        }

    } else if (params.subtype === 'hshaped') {
        // H-Shape: Two cores at the crossbar junctions
        console.log('[Layout Generator] H-Shape detected - placing two cores');
        const [minX, minY, maxX, maxY] = bbox;
        const midY = (minY + maxY) / 2;

        // Cores at left and right crossbar junctions
        const leftCandidates = [
            turf.point([minX + (maxX - minX) * 0.25, midY]),
            turf.point([minX + (maxX - minX) * 0.20, midY]),
            turf.point([minX + (maxX - minX) * 0.30, midY]),
        ];

        const rightCandidates = [
            turf.point([maxX - (maxX - minX) * 0.25, midY]),
            turf.point([maxX - (maxX - minX) * 0.20, midY]),
            turf.point([maxX - (maxX - minX) * 0.30, midY]),
        ];

        // Try left core
        for (const candidate of leftCandidates) {
            if (turf.booleanPointInPolygon(candidate, workingPoly)) {
                const core = createCoreAtPoint(candidate, 'core-h-left');
                if (core) {
                    cores.push({ id: 'core-h-left', type: 'Lobby', geometry: core });
                    console.log('[Layout Generator] H-Shape left core placed');
                    break;
                }
            }
        }

        // Try right core
        for (const candidate of rightCandidates) {
            if (turf.booleanPointInPolygon(candidate, workingPoly)) {
                const core = createCoreAtPoint(candidate, 'core-h-right');
                if (core) {
                    cores.push({ id: 'core-h-right', type: 'Lobby', geometry: core });
                    console.log('[Layout Generator] H-Shape right core placed');
                    break;
                }
            }
        }

    } else {
        console.log('[Layout Generator] Default core placement (subtype:', params.subtype, ')');
        let centerPoint = turf.centroid(workingPoly);

        if (!turf.booleanContains(workingPoly, centerPoint)) {
            centerPoint = turf.centerOfMass(workingPoly);
            if (!turf.booleanContains(workingPoly, centerPoint)) {
                centerPoint = turf.pointOnFeature(workingPoly);
            }
        }

        const core = createCoreAtPoint(centerPoint, 'core-default');
        if (core) cores.push({ id: 'core-default', type: 'Lobby', geometry: core });
    }

    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, using fallback');
        const fallbackPoint = turf.pointOnFeature(workingPoly);
        const core = createCoreAtPoint(fallbackPoint, 'core-fallback');
        if (core) cores.push({ id: 'core-fallback', type: 'Lobby', geometry: core });
    }

    console.log('[Layout Generator] Total cores placed:', cores.length);

    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, returning empty layout');
        return { cores: [], units: [], utilities: [], entrances: [] };
    }

    let coreGeom = cores[0].geometry;

    const shouldInclude = (type: string) => {
        if (!params.selectedUtilities) return true;
        const mapping: Record<string, string> = {
            'Electrical': UtilityType.Electrical,
            'HVAC': UtilityType.HVAC,
            'Solar PV': UtilityType.SolarPV,
            'Rooftop Solar': UtilityType.SolarPV,
            'EV Charging': UtilityType.EVStation
        };
        const mappedType = mapping[type] || type;
        return params.selectedUtilities.some(u => {
            const mU = mapping[u] || u;
            return u === type || mU === mappedType;
        });
    };

    // Electrical Shaft (Vertical Utility)
    if (shouldInclude('Electrical')) {
    try {
        const bBox = turf.bbox(workingPoly);
        
        const elecTargetArea = Math.max(2, (width * depth) * 0.015);
        
        let elecW: number, elecD: number;
        let coreEdgeCenter: Feature<Point>;
        let shiftDirection: number;
        let offsetDist: number;
        
        const coreBox = coreGeom ? turf.bbox(coreGeom) : bBox;

        if (isHorizontal) {
            elecD = coreD;
            elecW = elecTargetArea / elecD;
            coreEdgeCenter = turf.point([coreBox[2], (coreBox[1] + coreBox[3]) / 2]);
            shiftDirection = 90;
            offsetDist = elecW / 2;
        } else {
            elecW = coreW;
            elecD = elecTargetArea / elecW;
            coreEdgeCenter = turf.point([(coreBox[0] + coreBox[2]) / 2, coreBox[1]]);
            shiftDirection = 180;
            offsetDist = elecD / 2;
        }
        
        const startPoint = turf.destination(
            coreEdgeCenter, 
            offsetDist / 1000, 
            shiftDirection, 
            { units: 'kilometers' }
        );
        
        const cPt = startPoint.geometry.coordinates;
        const elecWDeg = elecW / ((40008000 / 360) * Math.cos(cPt[1] * Math.PI / 180));
        const elecDDeg = elecD / 111111;
        
        const elecBoxFeature = turf.bboxPolygon([
            cPt[0] - elecWDeg / 2,
            cPt[1] - elecDDeg / 2,
            cPt[0] + elecWDeg / 2,
            cPt[1] + elecDDeg / 2
        ]);
        
        const safeElecPoly = turf.intersect(elecBoxFeature, workingPoly) || elecBoxFeature;

        utilities.push({
            id: `util-elec-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Electrical Shaft',
            type: UtilityType.Electrical,
            geometry: safeElecPoly as Feature<Polygon>,
            centroid: turf.centroid(safeElecPoly as Feature<Polygon>),
            area: turf.area(safeElecPoly as Feature<Polygon>),
            visible: true
        });
        
        try {
            const merged = turf.union(coreGeom, safeElecPoly);
            if (merged && merged.geometry.type === 'Polygon') {
                coreGeom = merged as Feature<Polygon>;
            } else if (merged && merged.geometry.type === 'MultiPolygon') {
                coreGeom = merged as any;
            }
        } catch (e) {
            console.warn('[Layout Generator] Failed to merge electrical shaft with core geometry', e);
        }
        
        console.log('[Layout Generator] Placed Electrical Shaft at SE corner, merged into core area');
    } catch (e) {
        console.warn('Failed to place Electrical Shaft', e);
    }
    }

    // HVAC Zone (Rooftop) - Vastu: W/SW side of building
    const isPodiumBuilding = params.buildingId?.includes('-podium');
    if (!isPodiumBuilding && shouldInclude('HVAC')) {
    try {
        const floorsCount = params.numFloors || 5;
        const totalGFA = (width * depth) * Math.max(1, floorsCount);
        const hvacTargetArea = Math.max(16, totalGFA * 0.015);
        
        const bBox = turf.bbox(workingPoly);
        const hvacW = width * 0.45;
        const hvacD = Math.min(depth * 0.45, hvacTargetArea / (width * 0.45));
        const hvacActualD = Math.max(3, hvacD);
        
        const swPoint = turf.point([bBox[0], bBox[1]]);
        const startPoint = turf.transformTranslate(swPoint, 1, 45, { units: 'meters' });
        const startCoords = startPoint.geometry.coordinates;
        
        const hvacWDeg = hvacW / 111320;
        const hvacDDeg = hvacActualD / 110540;
        const hvacBoxFeature = turf.bboxPolygon([
            startCoords[0], startCoords[1],
            startCoords[0] + hvacWDeg, startCoords[1] + hvacDDeg
        ]);
        
        let hvacPoly = turf.intersect(hvacBoxFeature, workingPoly);
        if (!hvacPoly || turf.area(hvacPoly) < 4) {
            const center = turf.center(workingPoly);
            const hvacSize = Math.sqrt(hvacTargetArea);
            const fallbackCenter = turf.transformTranslate(center, width * 0.15, -90, { units: 'meters' }); // Shift west
            hvacPoly = turf.envelope(turf.buffer(fallbackCenter, hvacSize / 2, { units: 'meters' }));
            // @ts-ignore
            hvacPoly = turf.intersect(hvacPoly, workingPoly) || hvacPoly;
        }

        utilities.push({
            id: `util-hvac-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Rooftop HVAC Unit',
            type: UtilityType.HVAC,
            geometry: hvacPoly as Feature<Polygon>,
            centroid: turf.centroid(hvacPoly),
            area: turf.area(hvacPoly),
            visible: true
        });
        console.log('[Layout Generator] Placed Rooftop HVAC Unit (W/SW - Vastu compliant)');
    } catch (e) {
        console.warn('Failed to place HVAC Zone', e);
    }
    }

    // Rooftop Solar PV
    if (!isPodiumBuilding && (shouldInclude('Solar PV') || shouldInclude('Rooftop Solar'))) {
    try {
        const bBox = turf.bbox(workingPoly);
        const footprintArea = turf.area(workingPoly);
        const solarW = width * 0.45;
        const solarD = depth * 0.45;
        
        const sePoint = turf.point([bBox[2], bBox[1]]);
        const solarStart = turf.transformTranslate(sePoint, 1, -135, { units: 'meters' });
        const solarCoords = solarStart.geometry.coordinates;
        
        const solarWDeg = solarW / 111320;
        const solarDDeg = solarD / 110540;
        const solarBoxFeature = turf.bboxPolygon([
            solarCoords[0] - solarWDeg, solarCoords[1],
            solarCoords[0], solarCoords[1] + solarDDeg
        ]);
        
        let solarPoly = turf.intersect(solarBoxFeature, workingPoly);
        if (!solarPoly || turf.area(solarPoly) < 4) {
            const center = turf.center(workingPoly);
            const fallbackCenter = turf.transformTranslate(center, width * 0.15, 90, { units: 'meters' });
            const solarSize = Math.sqrt(solarW * solarD);
            solarPoly = turf.envelope(turf.buffer(fallbackCenter, solarSize / 2, { units: 'meters' }));
            solarPoly = turf.intersect(solarPoly, workingPoly) || solarPoly;
        }

        const solarArea = turf.area(solarPoly);
        utilities.push({
            id: `util-solar-roof-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Rooftop Solar PV',
            type: UtilityType.SolarPV,
            geometry: solarPoly as Feature<Polygon>,
            centroid: turf.centroid(solarPoly),
            area: solarArea,
            visible: true
        });
        console.log(`[Layout Generator] Placed Rooftop Solar PV (S/SE - ${solarArea.toFixed(1)}m²)`);
    } catch (e) {
        console.warn('Failed to place Rooftop Solar PV', e);
    }
    }
    // EV Charging
    const isTowerBuilding = params.buildingId?.includes('-tower');
    if (!isTowerBuilding && shouldInclude('EV Charging')) {
    try {
        const bBox = turf.bbox(workingPoly);
        const evW = width * 0.8;
        const evD = 2.0;
        
        const nwPoint = turf.point([bBox[0], bBox[3]]);
        const evStart = turf.transformTranslate(nwPoint, 0.5, 135, { units: 'meters' });
        const evCoords = evStart.geometry.coordinates;
        
        const evWDeg = evW / 111320;
        const evDDeg = evD / 110540;
        const evBoxFeature = turf.bboxPolygon([
            evCoords[0], evCoords[1] - evDDeg,
            evCoords[0] + evWDeg, evCoords[1]
        ]);
        
        let evPoly = turf.intersect(evBoxFeature, workingPoly);
        if (evPoly && turf.area(evPoly) > 2) {
            utilities.push({
                id: `util-ev-${Math.random().toString(36).substr(2, 5)}`,
                name: 'EV Charging Station',
                type: UtilityType.EVStation,
                geometry: evPoly as Feature<Polygon>,
                centroid: turf.centroid(evPoly),
                area: turf.area(evPoly),
                visible: true
            });
            console.log('[Layout Generator] Placed EV Charging Zone sub-polygon');
        }
    } catch (e) {
        console.warn('Failed to place EV Station polygon', e);
    }
    }

    let obstacles: any = undefined;

    if (coreGeom) {
        const corridorW = params.corridorWidth || 0.1;
        const coreWithCorridor = turf.buffer(coreGeom, corridorW / 1000, { units: 'kilometers' });

        obstacles = coreWithCorridor || coreGeom;
    }

    let leasablePoly = workingPoly; 
    if (obstacles) {
        try {
            // @ts-ignore
            leasablePoly = turf.difference(workingPoly, obstacles);
        } catch (err) {
            console.warn('turf.difference failed, trying small buffer fallback', err);
            try {
                // @ts-ignore
                leasablePoly = turf.difference(workingPoly, turf.buffer(obstacles, 0.001, { units: 'kilometers' }));
            } catch (err2) {
                console.warn('Buffer fallback also failed for difference. Using original polygon.', err2);
            }
        }
        if (!leasablePoly) {
            if (coreGeom) {
                // @ts-ignore
                leasablePoly = turf.difference(workingPoly, coreGeom);
            }
            if (!leasablePoly) leasablePoly = workingPoly;
        }
    }

    let useUnitMix = params.unitMix;
    if (params.intendedUse === BuildingIntendedUse.Commercial) {
        useUnitMix = [{ name: 'Office', mixRatio: 1, area: 150 }];
    } else if (params.intendedUse === BuildingIntendedUse.Hospitality) {
        useUnitMix = [{ name: 'Guest Room', mixRatio: 1, area: 35 }];
    } else if (params.intendedUse === BuildingIntendedUse.Public || params.intendedUse === BuildingIntendedUse.Industrial) {
        useUnitMix = [{ name: 'Hall', mixRatio: 1, area: 500 }];
    } else if (!useUnitMix || useUnitMix.length === 0) {
        useUnitMix = [
            { name: '2BHK', mixRatio: 0.30, area: 140 },
            { name: '3BHK', mixRatio: 0.35, area: 185 },
            { name: '4BHK', mixRatio: 0.35, area: 245 }
        ];
    }

    const weightedAvgSize = useUnitMix.reduce((acc, unit) => acc + (unit.area * unit.mixRatio), 0);
    const smallestUnitArea = Math.min(...useUnitMix.map(u => u.area));
    const baseGridUnitSize = Math.max(10, Math.round(smallestUnitArea / 5));
    const nominalGridSizeM = Math.sqrt(baseGridUnitSize);
    const cellsX = Math.max(1, Math.round(width / nominalGridSizeM));
    const cellsY = Math.max(1, Math.round(depth / nominalGridSizeM));
    
    const bboxWidthDeg = bbox[2] - bbox[0];
    const bboxHeightDeg = bbox[3] - bbox[1];
    const wDegGrid = bboxWidthDeg / cellsX;
    const hDegGrid = bboxHeightDeg / cellsY;

    const gridW = width / cellsX;
    const gridH = depth / cellsY;
    const actualCellAreaM2 = gridW * gridH;

    // Create an exact mathematical grid of rectangular polygons
    let gridFeatures: { poly: Feature<Polygon>, i: number, j: number }[] = [];
    const minXGrid = bbox[0], minYGrid = bbox[1];
    
    for (let i = 0; i < cellsX; i++) {
        for (let j = 0; j < cellsY; j++) {
            const cellMinX = minXGrid + (i * wDegGrid);
            const cellMinY = minYGrid + (j * hDegGrid);
            const cellMaxX = cellMinX + wDegGrid;
            const cellMaxY = cellMinY + hDegGrid;
            
            gridFeatures.push({
                poly: turf.bboxPolygon([cellMinX, cellMinY, cellMaxX, cellMaxY]),
                i, j
            });
        }
    }

    let validModules: { poly: Feature<Polygon>, validPoly: Feature<Polygon>, i: number, j: number }[] = [];
    gridFeatures.forEach((cell) => {
        try {
            // @ts-ignore
            const intersection = turf.intersect(cell.poly, leasablePoly);
            if (intersection && turf.area(intersection) > actualCellAreaM2 * 0.02) {
                validModules.push({ ...cell, validPoly: intersection as Feature<Polygon> });
            }
        } catch (e) { }
    });

    const totalValidCells = validModules.length;
    const leasableAreaM2 = validModules.reduce((sum, m) => sum + turf.area(m.validPoly), 0);
    console.log(`[Layout Generator] Tiled Grid: ${totalValidCells} modules, cell≈${actualCellAreaM2.toFixed(1)}m², leasable≈${leasableAreaM2.toFixed(0)}m²`);

    // GEOMETRIC UNIT SUBDIVISION
    const lBbox = turf.bbox(leasablePoly!);
    const [lMinX, lMinY, lMaxX, lMaxY] = lBbox;
    
    const coreCentroidPt = cores.length > 0 
        ? turf.centroid(cores[0].geometry) 
        : turf.centroid(workingPoly);
    const coreCenter = coreCentroidPt.geometry.coordinates;
    
    const corridorBuffer = params.corridorWidth || 1.5;
    const coreForStrips = coreGeom 
        ? turf.buffer(coreGeom, corridorBuffer / 1000, { units: 'kilometers' })
        : null;
    const coreBbox = coreForStrips ? turf.bbox(coreForStrips) : null;
    
    const isHorizontalBuilding = width > depth;
    
    const degPerMeterX = (lMaxX - lMinX) / width;
    const degPerMeterY = (lMaxY - lMinY) / depth;
    
    let stripA: { minX: number, maxX: number, minY: number, maxY: number, depth: number, length: number };
    let stripB: { minX: number, maxX: number, minY: number, maxY: number, depth: number, length: number };
    
    if (isHorizontalBuilding) {
        // Horizontal building: core runs E-W, strips are N and S
        const coreMaxY = (params.exactTypologyAllocation && coreBbox) ? coreBbox[3] : coreCenter[1];
        const coreMinY = (params.exactTypologyAllocation && coreBbox) ? coreBbox[1] : coreCenter[1];
        stripA = {
            minX: lMinX, maxX: lMaxX,
            minY: coreMaxY, maxY: lMaxY,
            depth: (lMaxY - coreMaxY) / degPerMeterY,
            length: width
        };
        stripB = {
            minX: lMinX, maxX: lMaxX,
            minY: lMinY, maxY: coreMinY,
            depth: (coreMinY - lMinY) / degPerMeterY,
            length: width
        };
    } else {
        // Vertical building: core runs N-S, strips are E and W
        const coreMaxX = (params.exactTypologyAllocation && coreBbox) ? coreBbox[2] : coreCenter[0];
        const coreMinX = (params.exactTypologyAllocation && coreBbox) ? coreBbox[0] : coreCenter[0];
        stripA = {
            minX: coreMaxX, maxX: lMaxX,
            minY: lMinY, maxY: lMaxY,
            depth: (lMaxX - coreMaxX) / degPerMeterX,
            length: depth
        };
        stripB = {
            minX: lMinX, maxX: coreMinX,
            minY: lMinY, maxY: lMaxY,
            depth: (coreMinX - lMinX) / degPerMeterX,
            length: depth
        };
    }
    
    console.log(`[Layout Generator] Strips: A depth=${stripA.depth.toFixed(1)}m len=${stripA.length.toFixed(1)}m, B depth=${stripB.depth.toFixed(1)}m len=${stripB.length.toFixed(1)}m`,
        coreBbox ? `coreBbox=[${coreBbox.map((v: number) => v.toFixed(6)).join(',')}]` : 'no-core-bbox',
        `building=${width.toFixed(1)}×${depth.toFixed(1)}m`);
    
    const computeUnitWidths = (stripDepth: number) => {
        if (stripDepth < 1) return useUnitMix.map(u => ({ ...u, unitWidth: u.area }));
        return useUnitMix.map(u => ({
            ...u,
            unitWidth: u.area / stripDepth
        }));
    };
    
    const avgStripDepth = (stripA.depth + stripB.depth) / 2;
    const unitWidths = computeUnitWidths(avgStripDepth);
    const avgUnitWidth = unitWidths.reduce((s, u) => s + u.unitWidth * u.mixRatio, 0);
    const totalLength = stripA.length;
    
    const totalUnitSlots = Math.max(1, Math.floor((totalLength * 2) / avgUnitWidth));
    
    const unitCounts = unitWidths.map(u => ({
        ...u,
        count: Math.max(0, Math.round(totalUnitSlots * u.mixRatio))
    }));
    
    unitCounts.forEach(u => {
        if (u.count === 0 && u.mixRatio > 0) u.count = 1;
    });
    
    let totalWidthUsed = unitCounts.reduce((s, u) => s + u.count * u.unitWidth, 0);
    unitCounts.sort((a, b) => b.count - a.count);
    while (totalWidthUsed > totalLength * 2 && unitCounts[0].count > 1) {
        unitCounts[0].count--;
        totalWidthUsed -= unitCounts[0].unitWidth;
    }
    
    console.log(`[Layout Generator] Floor plan:`, 
        unitCounts.map(u => `${u.name}=${u.count}×${u.unitWidth.toFixed(1)}m`).join(', '),
        `total=${totalWidthUsed.toFixed(0)}m / ${(totalLength*2).toFixed(0)}m`);
    
    // EXACT TYPOLOGY ALLOCATION MODE
    if (params.exactTypologyAllocation && leasableAreaM2 > 0) {
        let targetTotalArea = 0;
        
        unitCounts.forEach(u => {
            if (u.mixRatio > 0) {
                const rawProportion = leasableAreaM2 * u.mixRatio;
                u.count = Math.max(1, Math.round(rawProportion / u.area));
            } else {
                u.count = 0;
            }
            targetTotalArea += u.count * u.area;
        });

        while (targetTotalArea > leasableAreaM2 && targetTotalArea > 0) {
            const validToTrim = [...unitCounts].filter(u => u.count > 0).sort((a, b) => b.area - a.area);
            if (validToTrim.length > 0) {
                const targetToTrim = unitCounts.find(u => u.name === validToTrim[0].name)!;
                targetToTrim.count--;
                targetTotalArea -= targetToTrim.area;
            } else {
                break;
            }
        }

        let remainingSpace = leasableAreaM2 - targetTotalArea;
        const typesSmallToLarge = [...unitCounts].sort((a, b) => a.area - b.area);
        for (const u of typesSmallToLarge) {
            while (remainingSpace >= u.area * 0.95) {
                const originalU = unitCounts.find(x => x.name === u.name)!;
                originalU.count++;
                targetTotalArea += originalU.area;
                remainingSpace -= originalU.area;
            }
        }

        console.log(`[Layout Generator] [exactTypology] Fixed Allocation: sum=${targetTotalArea.toFixed(0)}m2 <= leasable=${leasableAreaM2.toFixed(0)}m2 | counts:`, 
            unitCounts.map(u => `${u.name}=${u.count}`).join(', '));
    }

    let deckA: { type: string, color: string, targetArea: number, unitWidth: number }[] = [];
    let deckB: { type: string, color: string, targetArea: number, unitWidth: number }[] = [];

    if (params.exactTypologyAllocation) {
        // ── EXACT TYPOLOGY PATH ──────────────────────────────────────────────────
        const allUnitsToPlace: typeof deckA = [];
        unitCounts.forEach(u => {
            for (let i = 0; i < u.count; i++) {
                allUnitsToPlace.push({
                    type: u.name,
                    color: getColorForUnitType(u.name),
                    targetArea: u.area,
                    unitWidth: u.area / avgStripDepth
                });
            }
        });
        allUnitsToPlace.sort((a, b) => b.targetArea - a.targetArea);

        const typeGroups: Record<string, typeof allUnitsToPlace> = {};
        for (const u of allUnitsToPlace) {
            if (!typeGroups[u.type]) typeGroups[u.type] = [];
            typeGroups[u.type].push(u);
        }
        for (const typeName of Object.keys(typeGroups)) {
            const group = typeGroups[typeName];
            for (let i = 0; i < group.length; i++) {
                if (i % 2 === 0) deckA.push(group[i]);
                else deckB.push(group[i]);
            }
        }
        // Within each strip, largest units first
        deckA.sort((a, b) => b.targetArea - a.targetArea);
        deckB.sort((a, b) => b.targetArea - a.targetArea);

    } else {
        // ── NORMAL MIX PATH (original logic) ─────────────────────────────────────
        const unitDeck: typeof deckA = [];
        const remaining = unitCounts.map(u => ({ ...u, left: u.count, colorIdx: 0 }));
        let left = remaining.reduce((s, u) => s + u.left, 0);
        while (left > 0) {
            for (const u of remaining) {
                if (u.left > 0) {
                    const color = u.colorIdx % 2 === 0
                        ? getColorForUnitType(u.name)
                        : darkenColor(getColorForUnitType(u.name));
                    unitDeck.push({ type: u.name, color, targetArea: u.area, unitWidth: u.unitWidth });
                    u.left--;
                    u.colorIdx++;
                    left--;
                }
            }
        }

        // Shuffle if requested
        if (params.shuffleUnits) {
            const buildingSeed = Math.floor(coreCenter[0] * 100000 + coreCenter[1] * 100000);
            const seededRandom = (seed: number) => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };
            let currentSeed = buildingSeed;
            for (let i = unitDeck.length - 1; i > 0; i--) {
                const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
                [unitDeck[i], unitDeck[j]] = [unitDeck[j], unitDeck[i]];
            }
        }

        const aSlots = Math.round(unitDeck.length * 0.5);
        deckA = unitDeck.slice(0, aSlots);
        deckB = unitDeck.slice(aSlots);
    }
    
    const createStripUnits = (
        strip: typeof stripA,
        deck: typeof deckA,
        unitStartIdx: number
    ): number => {
        if (deck.length === 0 || strip.depth < 1 || strip.length < 1) return unitStartIdx;
        
        const exactDeckWidth = params.exactTypologyAllocation 
            ? deck.reduce((s, u) => s + (u.targetArea / strip.depth), 0)
            : deck.reduce((s, u) => s + u.unitWidth, 0);

        const scaleFactor = params.exactTypologyAllocation ? 1 : (strip.length / exactDeckWidth);
        
        let currentPos = 0; 
        
        for (let d = 0; d < deck.length; d++) {
            const assignment = deck[d];
            const exactWidthForThisStrip = params.exactTypologyAllocation ? (assignment.targetArea / strip.depth) : assignment.unitWidth;
            const scaledWidth = exactWidthForThisStrip * scaleFactor;
            
            if (params.exactTypologyAllocation && currentPos + scaledWidth > strip.length * 1.05) {
                console.log(`[Layout Generator] Exact Typology: Skipped unit ${assignment.type} due to strip length constraints. Trying smaller units in remaining space.`);
                continue;
            }

            let nextPos = currentPos + scaledWidth;
            if (d === deck.length - 1 && (!params.exactTypologyAllocation || (currentPos + scaledWidth > strip.length * 0.95))) {
                nextPos = strip.length;
            }
            if (params.exactTypologyAllocation) {
                 nextPos = Math.min(nextPos, strip.length); 
            }
            
            let unitRect: Feature<Polygon>;
            if (isHorizontalBuilding) {
                const x1 = strip.minX + currentPos * degPerMeterX;
                const x2 = strip.minX + nextPos * degPerMeterX;
                unitRect = turf.bboxPolygon([x1, strip.minY, x2, strip.maxY]);
            } else {
                const y1 = strip.minY + currentPos * degPerMeterY;
                const y2 = strip.minY + nextPos * degPerMeterY;
                unitRect = turf.bboxPolygon([strip.minX, y1, strip.maxX, y2]);
            }
            
            let finalGeom: Feature<Polygon> | null = null;
            try {
                // @ts-ignore
                const clipped = turf.intersect(unitRect, leasablePoly);
                if (clipped) {
                    if (clipped.geometry.type === 'Polygon') {
                        finalGeom = clipped as Feature<Polygon>;
                    } else if (clipped.geometry.type === 'MultiPolygon') {
                        const parts = (clipped.geometry.coordinates as any[]).map((c: any) => turf.polygon(c));
                        parts.sort((a: any, b: any) => turf.area(b) - turf.area(a));
                        finalGeom = parts[0] as Feature<Polygon>;
                    }
                }
            } catch (e) {
                finalGeom = unitRect;
            }
            
            if (finalGeom && turf.area(finalGeom) > 5) {
                units.push({
                    id: `unit-${unitStartIdx + d}`,
                    type: assignment.type,
                    geometry: finalGeom,
                    color: assignment.color,
                    targetArea: assignment.targetArea
                });
            }
            
            currentPos = nextPos;
        }

        return unitStartIdx + deck.length + (params.exactTypologyAllocation ? 999 : 0); 
    };
    
    const nextIdx = createStripUnits(stripA, deckA, 0);
    createStripUnits(stripB, deckB, nextIdx);
    
    console.log(`[Layout Generator] Final: ${units.length} units placed.`, 
        units.map(u => `${u.type}(${u.targetArea}sqm)`).join(', '));

    try {
        const buildingCenter = turf.centroid(workingPoly);
        const vertices = turf.explode(workingPoly).features;

        let bestCandidatePoint: any = null;
        let bestCandidateScore = -1;

        for (let i = 0; i < vertices.length - 1; i++) {
            const p1 = vertices[i];
            const p2 = vertices[i + 1];
            const edgeMid = turf.midpoint(p1, p2);

            const bearing = turf.bearing(buildingCenter, edgeMid);
            const direction = getCardinalDirection(bearing);

            let score = 0;

            if (params.vastuCompliant) {
                const b = (bearing + 360) % 360;
                if (b > 20 && b < 70) score = 100;
                else if (direction === 'E') score = 80;
                else if (direction === 'N') score = 70;
                else if (direction === 'S') score = 10;
                else if (direction === 'W') score = 20;
                else score = 30;
            }
            else if (params.roadAccessSides && params.roadAccessSides.length > 0) {
                if (params.roadAccessSides.includes(direction)) score = 100;
                else score = 10;
            }
            else {
                if (direction === 'S') score = 60;
                else score = 50;
            }

            const dist = turf.distance(p1, p2, { units: 'meters' });
            if (dist < 4) score -= 50;

            if (score > bestCandidateScore) {
                bestCandidateScore = score;
                bestCandidatePoint = edgeMid;
            }
        }

        if (bestCandidatePoint) {
            entrances.push({
                id: 'main-access',
                type: 'Both',
                position: bestCandidatePoint.geometry.coordinates as [number, number],
                name: 'Main Entrance / Exit'
            });
        }

    } catch (e) {
        console.warn('Error generating entrance:', e);
    }

    // --- MASTER ROTATION BLOCK ---
    if (rotationAngle !== 0) {
        cores.forEach(c => {
            if (c.geometry) {
                // @ts-ignore
                c.geometry = turf.transformRotate(c.geometry, rotationAngle, { pivot: center });
            }
        });
        utilities.forEach(u => {
            if (u.geometry) {
                // @ts-ignore
                u.geometry = turf.transformRotate(u.geometry, rotationAngle, { pivot: center });
                u.centroid = turf.centroid(u.geometry);
            }
        });
        units.forEach(u => {
            if (u.geometry) {
                // @ts-ignore
                u.geometry = turf.transformRotate(u.geometry, rotationAngle, { pivot: center });
            }
        });
        entrances.forEach(e => {
            if (e.position && e.position.length >= 2) {
                const pt = turf.point([e.position[0], e.position[1]]);
                // @ts-ignore
                const rotatedPt = turf.transformRotate(pt, rotationAngle, { pivot: center });
                e.position = rotatedPt.geometry.coordinates as [number, number];
            }
        });
        console.log(`[Layout Gen] Master rotated all components back by ${rotationAngle}deg`);
    }
    const totalArea = turf.area(buildingPoly);
    let totalUnitArea = 0;
    units.forEach(u => { if (u.geometry) totalUnitArea += turf.area(u.geometry); });
    const efficiency = totalUnitArea / totalArea;
    const efficiencyPercent = (efficiency * 100).toFixed(1);

    return { cores, units, entrances, utilities, efficiency: parseFloat(efficiencyPercent) };
}

/**
 * Determines Utility Size and Placement based on Vastu or User Logic
 */
interface UtilityDef {
    type: UtilityType;
    name: string;
    area: number; // m2
    color: string;
    height: number;
    level?: number;
}

/**
 * Calculate corner reservation zones for utilities 
 */
export function calculateUtilityReservationZones(
    plotPoly: Feature<Polygon>,
    vastuCompliant: boolean = false
): Feature<Polygon>[] {
    if (!vastuCompliant) return [];

    const reservationZones: Feature<Polygon>[] = [];
    const bbox = turf.bbox(plotPoly);
    const minX = bbox[0];
    const minY = bbox[1];
    const maxX = bbox[2];
    const maxY = bbox[3];

    const reserveSize = 35; // meters
    const wPerDeg = 111320;
    const hPerDeg = 110540;
    const reserveSizeDegX = reserveSize / wPerDeg;
    const reserveSizeDegY = reserveSize / hPerDeg;

    // NE Corner - Water (UGT)
    const neZone = turf.bboxPolygon([
        maxX - reserveSizeDegX,
        maxY - reserveSizeDegY,
        maxX,
        maxY
    ]);
    reservationZones.push(neZone);

    // SE Corner - Electrical/Fire
    const seZone = turf.bboxPolygon([
        maxX - reserveSizeDegX,
        minY,
        maxX,
        minY + reserveSizeDegY
    ]);
    reservationZones.push(seZone);

    // NW Corner - STP/WTP/Waste
    const nwZone = turf.bboxPolygon([
        minX,
        maxY - reserveSizeDegY,
        minX + reserveSizeDegX,
        maxY
    ]);
    reservationZones.push(nwZone);

    console.log(`[Utility Reservation] Created ${reservationZones.length} corner zones for Vastu utilities`);
    return reservationZones;
}

export function generateSiteUtilities(
    plotPoly: Feature<Polygon>,
    buildings: any[],
    vastuCompliant: boolean = false,
    obstacles: Feature<Polygon>[] = [],
    selectedUtilities?: string[],
    peripheralParkingZone?: Feature<Polygon | MultiPolygon> | null
): { utilities: any[], buildings: any[] } {
    const utilities: any[] = [];
    const containerPoly = (peripheralParkingZone || plotPoly) as Feature<Polygon>;
    const minX = turf.bbox(containerPoly)[0];
    const minY = turf.bbox(containerPoly)[1];
    const maxX = turf.bbox(containerPoly)[2];
    const maxY = turf.bbox(containerPoly)[3];

    // --- CALCULATE DEMAND ---

    let totalUnits = 0;
    buildings.forEach(b => {
        if (b.properties && b.properties.units && Array.isArray(b.properties.units)) {
            totalUnits += b.properties.units.length;
        } else if (b.units && Array.isArray(b.units)) {
            totalUnits += b.units.length;
        } else {
            try {
                let area = 0;
                if (b.type === 'Feature' || b.type === 'Polygon' || b.type === 'MultiPolygon') {
                    area = turf.area(b);
                } else if (b.geometry) {
                    area = turf.area(b.geometry);
                } else if (b.area) {
                    area = b.area;
                }

                if (area > 0) {
                    const floors = b.numFloors || (b.properties && b.properties.floors) || 5;
                    totalUnits += Math.floor(area / 80) * floors;
                }
            } catch (e) {
                console.warn('[Utility Generator] Error calculating building area for unit estimate:', e);
            }
        }
    });

    if (totalUnits === 0) totalUnits = 50; // Safety baseline

    // Assumptions
    const avgPersonsPerUnit = 4;
    const population = Math.round(totalUnits * avgPersonsPerUnit);
    const waterDemandPerPerson = 135; // LPCD (IS 1172)
    const sewageDemandPerPerson = 120; // LPCD
    const totalWaterDemand = population * waterDemandPerPerson; // Liters/Day

    // --- SIZING UTILITIES ---

    // STP (Sewage Treatment Plant) — building-calc: stpCapacity * 8 m²/KLD
    const stpCapacityKLD = (population * sewageDemandPerPerson * 1.2) / 1000;
    const stpArea = Math.max(15, Math.ceil(stpCapacityKLD * 8)); // 8 m²/KLD (Extended Aeration)

    // WTP (Water Treatment Plant) — building-calc: wtpCapacity * 6 m²/KLD
    const wtpCapacityKLD = (population * waterDemandPerPerson * 1.2) / 1000;
    const wtpArea = Math.max(10, Math.ceil(wtpCapacityKLD * 6)); // 6 m²/KLD

    // UGT (Underground Water Tank) — building-calc: capacity * 0.4 (depth 2.5m)
    const ugtVolume = (population * waterDemandPerPerson) / 1000; // m³ (full day storage)
    const ugtArea = Math.max(20, Math.ceil(ugtVolume * 0.4)); // depth 2.5m → multiply by 0.4

    // OWC (Organic Waste Converter) — building-calc: capacity * 0.5 + 10
    const owcCapacityKg = population * 0.3; // kg/day
    const owcArea = Math.max(8, Math.ceil(owcCapacityKg * 0.5 + 10)); // 0.5 m²/kg + 10m² buffer

    // DG Set (Diesel Generator) — building-calc: (pop*0.8*0.7*0.4*1.25)/500 * 25
    const totalLoadKW = population * 0.8 * 0.7; // 0.8kW/person, 0.7 diversity factor
    const essentialLoad = totalLoadKW * 0.4; // 40% essential
    const dgKVA = essentialLoad * 1.25; // 25% margin
    const dgArea = Math.max(15, Math.ceil((dgKVA / 500) * 25)); // 25 m² per 500 kVA set

    // Electrical Substation — building-calc: 40 + (units/100) * 15
    const substationArea = Math.max(25, Math.ceil(40 + (totalUnits / 100) * 15));

    // Transformer Yard — building-calc: 20 + (units/100) * 8
    const transformerArea = Math.max(20, Math.ceil(20 + (totalUnits / 100) * 8));

    // Gas Bank (LPG Manifold)
    const gasArea = Math.max(15, Math.min(40, Math.ceil(population * 0.02)));

    // Fire Pump Room & Tank — building-calc: hydrantCount * 40, depth 3m
    const avgFloors = buildings.length > 0 
        ? Math.round(buildings.reduce((s: number, b: any) => s + (b.numFloors || 1), 0) / buildings.length)
        : 5;
    const hydrantCount = Math.ceil(avgFloors / 5) * 2;
    const fireTankVolume = Math.max(hydrantCount * 40, (300 * 5) / 1000 * 1000 / 60) * 30 / 1000; // 30min storage
    const fireTankArea = Math.max(20, Math.ceil(fireTankVolume / 3.0)); // 3.0m depth (building-calc uses 0.35 factor ≈ 1/3m)
    const firePumpRoomArea = 30;

    // Admin / Security Office (SW)
    const adminBlockArea = Math.max(20, Math.ceil(population * 0.01));

    // Solar PV (Roof/Ground)
    const solarCapacityKW = totalLoadKW * 0.25; // 25% of peak load
    const solarAreaReq = solarCapacityKW * 10; // 10 sqm/kW

    // Rainwater Harvesting (RWH) — building-calc: roofArea * (1200/1000) * 0.85, depth 2.5m
    let roofAreaSum = 0;
    buildings.forEach(b => {
        try {
            if (b.area && b.area > 0) {
                roofAreaSum += b.area;
            } else if (b.properties?.area && b.properties.area > 0) {
                roofAreaSum += b.properties.area;
            } else {
                roofAreaSum += turf.area(b.geometry || b);
            }
        } catch (e) {}
    });
    const annualRainfall = 1200; // mm (building-calc default)
    const annualHarvestVol = roofAreaSum * (annualRainfall / 1000) * 0.85; // m³
    const maxStorageVol = (population * 30 * 30) / 1000; // m³ (30L/person for 30 days)
    const rwhVolume = Math.min(annualHarvestVol * 0.15, maxStorageVol);
    const rwhArea = Math.max(15, Math.ceil(rwhVolume * 0.4)); // depth 2.5m → 1/2.5 = 0.4

    // EV Charging
    const evPoints = Math.ceil(totalUnits * 1.5 * 0.2); 

    console.log(`[Utility Sizing - NBC/IS Standards]`);
    console.log(`Units: ${totalUnits}, Pop: ${population} (${avgPersonsPerUnit}/unit)`);
    console.log(`STP -> Cap: ${stpCapacityKLD.toFixed(1)} KLD | Area: ${stpArea} sqm (@8 m²/KLD)`);
    console.log(`WTP -> Cap: ${wtpCapacityKLD.toFixed(1)} KLD | Area: ${wtpArea} sqm (@6 m²/KLD)`);
    console.log(`UGT (Water) -> Vol: ${ugtVolume.toFixed(1)} m³ | Area: ${ugtArea} sqm (2.5m depth)`);
    console.log(`RWH -> Roof: ${roofAreaSum.toFixed(1)} m² | Harvest: ${annualHarvestVol.toFixed(1)} m³ | Storage: ${rwhVolume.toFixed(1)} m³ | Area: ${rwhArea} sqm (2.5m depth)`);
    console.log(`Electrical -> Peak: ${totalLoadKW.toFixed(0)} kW | Essential: ${essentialLoad.toFixed(0)} kW | DG: ${dgKVA.toFixed(0)} kVA`);
    console.log(`DG Set Area -> ${dgArea} sqm (25m²/500kVA)`);
    console.log(`Substation -> ${substationArea} sqm | Transformer -> ${transformerArea} sqm`);
    console.log(`Fire Tank -> Vol: ${fireTankVolume.toFixed(0)} m³ | Area: ${fireTankArea} sqm (3.0m depth)`);
    console.log(`Gas: ${gasArea} sqm | Admin: ${adminBlockArea} sqm | OWC: ${owcArea} sqm`);
    console.log(`Solar PV -> ${solarCapacityKW.toFixed(1)} kW = ${solarAreaReq.toFixed(1)} sqm`);
    console.log(`EV Points -> ${evPoints}`);
    console.groupEnd();

    // --- GROUPING & PLACEMENT ZONES ---

    const groupNE: UtilityDef[] = [];
    const groupSE: UtilityDef[] = [];
    const groupNW: UtilityDef[] = [];
    const groupSW: UtilityDef[] = [];

    const plotOrientation = getPlotOrientation(plotPoly);

    const shouldInclude = (type: string) => !selectedUtilities || selectedUtilities.includes(type);

    // NE: Water Zone (Vastu: Water/Eshanya)
    if (shouldInclude(UtilityType.Water)) groupNE.push({ type: UtilityType.Water, name: 'UGT (Domestic)', area: ugtArea, color: '#4FC3F7', height: 2.5, level: -1 });
    // RWH often near Water
    if (shouldInclude(UtilityType.RainwaterHarvesting)) groupNE.push({ type: UtilityType.RainwaterHarvesting, name: 'RWH Tank', area: rwhArea, color: '#81D4FA', height: 2.5, level: -1 });

    // SE: Fire / Electrical (Vastu: Agni)
    if (shouldInclude(UtilityType.Electrical)) groupSE.push({ type: UtilityType.Electrical, name: 'Substation/Transf.', area: transformerArea + substationArea, color: '#FF9800', height: 2.5, level: 0 });
    if (shouldInclude(UtilityType.DGSet)) groupSE.push({ type: UtilityType.DGSet, name: 'DG Set', area: dgArea, color: '#FFB74D', height: 2.5, level: 0 });
    if (shouldInclude(UtilityType.Gas)) groupSE.push({ type: UtilityType.Gas, name: 'Gas Bank', area: gasArea, color: '#F48FB1', height: 2, level: 0 });
    // Fire Pump Room usually near clusters, SE is good or near entry
    if (shouldInclude(UtilityType.Fire)) groupSE.push({ type: UtilityType.Fire, name: 'Fire Pump Room', area: firePumpRoomArea, color: '#FF5722', height: 2.5, level: -1 });

    // NW: Waste / Air (Vastu: Vayu)
    if (shouldInclude(UtilityType.STP)) groupNW.push({ type: UtilityType.STP, name: 'STP Plant', area: stpArea, color: '#BA68C8', height: 2.5, level: -1 });
    if (shouldInclude(UtilityType.SolidWaste)) groupNW.push({ type: UtilityType.SolidWaste, name: 'OWC (Waste)', area: owcArea, color: '#8D6E63', height: 2, level: 0 });
    if (shouldInclude(UtilityType.WTP)) groupNW.push({ type: UtilityType.WTP, name: 'WTP Plant', area: wtpArea, color: '#29B6F6', height: 3, level: -1 });

    // SW: Earth / Heavy / Admin (Vastu: Nairitya)
    if (shouldInclude(UtilityType.Admin)) groupSW.push({ type: UtilityType.Admin, name: 'Admin / Security', area: adminBlockArea, color: '#FDD835', height: 3, level: 0 });
    // Separate Fire Tank (Underground) often in non-obtrusive area
    if (shouldInclude(UtilityType.Fire)) groupSW.push({ type: UtilityType.Fire, name: 'Fire Tank (UG)', area: fireTankArea, color: '#EF9A9A', height: 2.5, level: -1 });

    // --- PLACEMENT ALGORITHM ---

    const placeGroupInCorner = (group: UtilityDef[], corner: 'NE' | 'SE' | 'SW' | 'NW'): UtilityDef[] => {
        const failedItems: UtilityDef[] = [];
        if (group.length === 0) return [];

        const margin = 1.5;
        const gap = peripheralParkingZone ? 0.1 : 1.0;
        const wPerDeg = 111320;
        const hPerDeg = 110540;
        let cornerX = 0, cornerY = 0;
        let growX = 0, growY = 0;

        if (corner === 'NE') { cornerX = maxX; cornerY = maxY; growX = -1; growY = -1; }
        if (corner === 'SE') { cornerX = maxX; cornerY = minY; growX = -1; growY = 1; }
        if (corner === 'SW') { cornerX = minX; cornerY = minY; growX = 1; growY = 1; }
        if (corner === 'NW') { cornerX = minX; cornerY = maxY; growX = 1; growY = -1; }

        console.log(`[Utility Debug] Placing in ${corner}: bbox=[${minX}, ${minY}, ${maxX}, ${maxY}], corner=[${cornerX}, ${cornerY}]`);

        const marchTarget = turf.centroid(containerPoly);
        let currentPoint = turf.point([cornerX, cornerY]);

        let steps = 0;
        const maxSteps = 1000;

        // @ts-ignore
        while (!turf.booleanPointInPolygon(currentPoint, containerPoly) && steps < maxSteps) {
            const bearing = turf.bearing(currentPoint, marchTarget);
            currentPoint = turf.destination(currentPoint, 1, bearing, { units: 'meters' });
            steps++;
        }

        if (steps >= maxSteps) {
            console.warn(`[Utility Debug] Could not find valid start point for corner ${corner}`);
            return group;
        }

        const effectiveMargin = peripheralParkingZone ? 0.5 : margin;
        const bearing = turf.bearing(currentPoint, marchTarget);
        currentPoint = turf.destination(currentPoint, effectiveMargin, bearing, { units: 'meters' });

        let [cursorX, cursorY] = currentPoint.geometry.coordinates;

        group.forEach(util => {
            let placed = false;
            let bestDist = Infinity;
            let bestPoly: Feature<Polygon> | null = null;

            const maxSide = peripheralParkingZone ? 3.5 : Infinity;
            const side = Math.min(Math.sqrt(util.area), maxSide);
            const uW = side;
            const uH = side;
            const uWDeg = uW / wPerDeg;
            const uHDeg = uH / hPerDeg;

            const searchSteps = peripheralParkingZone ? 120 : 40;
            const stepM = peripheralParkingZone ? 0.5 : 3;

            const gridPoints: {i: number, j: number, localX: number, localY: number, dist: number}[] = [];
            for (let i = 0; i < searchSteps; i++) {
                for (let j = 0; j < searchSteps; j++) {
                    const localX = (i - (searchSteps / 2)) * stepM;
                    const localY = (j - (searchSteps / 2)) * stepM;
                    gridPoints.push({
                        i, j, localX, localY, dist: Math.sqrt(localX * localX + localY * localY)
                    });
                }
            }
            gridPoints.sort((a,b) => a.dist - b.dist);

            for (const pt of gridPoints) {
                if (placed) break;

                const localX = pt.localX;
                const localY = pt.localY;
                    
                    const rad = -plotOrientation * Math.PI / 180;
                    const rotX = localX * Math.cos(rad) - localY * Math.sin(rad);
                    const rotY = localX * Math.sin(rad) + localY * Math.cos(rad);

                    const offsetX = rotX / wPerDeg;
                    const offsetY = rotY / hPerDeg;

                    const originX = cursorX + offsetX;
                    const originY = cursorY + offsetY;

                    const uSeedStr = util.name + util.type + pt.i + pt.j;
                    let uSeed = 0;
                    for (let c = 0; c < uSeedStr.length; c++) uSeed += uSeedStr.charCodeAt(c);
                    
                    const shapeTypeInt = uSeed % 4;
                    let poly: Feature<Polygon>;
                    
                    if (shapeTypeInt === 0) {
                        poly = createRotatedRect(turf.point([originX, originY]), uW, uH, plotOrientation);
                    } else {
                        const radius = uW / 2;
                        const steps = shapeTypeInt === 1 ? 32 : (shapeTypeInt === 2 ? 6 : 8);
                        poly = turf.circle(turf.point([originX, originY]), radius, { units: 'meters', steps: steps });
                    }

                    // 1. BOUNDARY CHECK
                    let inside = false;
                    try {
                        if (peripheralParkingZone) {
                            // @ts-ignore
                            inside = turf.booleanContains(containerPoly, poly);
                        } else {
                            // @ts-ignore
                            const safeContainer = turf.buffer(containerPoly, -1.0, { units: 'meters' }) || containerPoly;
                            // @ts-ignore
                            inside = turf.booleanContains(safeContainer, poly);
                        }
                    } catch (e) { }

                    if (!inside) continue;

                    // 2. PRE-CALCULATE BUFFERED POLY (Ensure Gap)
                    let bufferedPoly;
                    try {
                        const gapDistance = peripheralParkingZone ? 0.2 : 1.0;
                        // @ts-ignore
                        bufferedPoly = turf.buffer(poly, gapDistance, { units: 'meters' });
                    } catch (e) { bufferedPoly = poly; }
                    const checkPoly = bufferedPoly || poly;

                    // 3. OBSTACLE CHECK
                    let obstacleOverlap = false;
                    for (const obst of obstacles) {
                        try {
                            if (obst && obst.geometry) {
                                // @ts-ignore
                                if (turf.booleanIntersects(checkPoly, obst.geometry)) { obstacleOverlap = true; break; }
                            }
                        } catch (e) { }
                    }

                    if (obstacleOverlap) continue;

                    // 4. EXISTING BUILDING CHECK
                    let buildingOverlap = false;
                    for (const b of buildings) {
                        try {
                            if (b && b.geometry && b.visible !== false) {
                                // @ts-ignore
                                if (turf.booleanIntersects(checkPoly, b.geometry)) { buildingOverlap = true; break; }
                            }
                        } catch (e) { }
                    }

                    // FORCE RESOLVE: If overlapping building at PRIORITY spot
                    if (buildingOverlap) {
                        const colliding = buildings.filter(b => b.visible !== false && turf.booleanIntersects(checkPoly, b.geometry));

                        for (const b of colliding) {
                            if (!b.geometry) continue;

                            const isValidCandidate = (geo: any) => {
                                try {
                                    // 1. Must NOT overlap the Utility (+Gap) we are trying to place
                                    // @ts-ignore
                                    if (turf.booleanIntersects(geo, checkPoly)) return false;

                                    // 2. Must NOT overlap OTHER buildings
                                    for (const other of buildings) {
                                        if (other.id === b.id || other.visible === false) continue;
                                        // @ts-ignore
                                        if (turf.booleanIntersects(geo, other.geometry)) return false;
                                    }
                                    return true;
                                } catch (e) { return false; }
                            };

                            let resolved = false;

                            // RESIZE (Shrink)
                            try {
                                const bbox = turf.bbox(b);
                                // @ts-ignore
                                const w = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[2], bbox[1]]), { units: 'meters' });
                                // @ts-ignore
                                const h = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[0], bbox[3]]), { units: 'meters' });

                                if (w > 20 && h > 20) { // Only shrink if reasonable size
                                    const scales = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]; // More granular steps
                                    for (const s of scales) {
                                        // @ts-ignore
                                        const scaled = turf.transformScale(b, s);
                                        if (isValidCandidate(scaled.geometry)) {
                                            b.geometry = scaled.geometry;
                                            console.log(`[Utility Force] Shrunk building ${b.id} by factor ${s} to fit`);
                                            resolved = true;
                                            break;
                                        }
                                    }
                                }
                            } catch (e) { console.warn('Resize failed', e); }

                            if (resolved) continue;

                            b.visible = false;
                            console.log(`[Utility Force] Removing building ${b.id} (Resize failed)`);
                        }
                        buildingOverlap = false;
                    }

                    if (buildingOverlap) continue;

                    let utilityOverlap = false;
                    let bufferedCandidate;
                    try {
                        bufferedCandidate = turf.buffer(poly, gap, { units: 'meters' });
                    } catch (e) { bufferedCandidate = poly; }

                    for (const u of utilities) {
                        try {
                            if (turf.booleanIntersects(poly, u.geometry)) { utilityOverlap = true; break; }
                            if (bufferedCandidate && turf.booleanIntersects(bufferedCandidate, u.geometry)) { utilityOverlap = true; break; }
                        } catch (e) { }
                    }
                    if (utilityOverlap) continue;

                    utilities.push({
                        id: `util-${util.type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                        name: util.name,
                        type: util.type,
                        geometry: poly as Feature<Polygon>,
                        area: turf.area(poly),
                        targetArea: util.area,
                        centroid: turf.centroid(poly),
                        visible: util.level !== undefined && util.level < 0 ? false : true,
                        color: util.color,
                        level: util.level || 0,
                        height: util.height
                    });

                    console.log(`[Utility Debug] ✓ Placed ${util.name} in ${corner} (Grid ${pt.i},${pt.j})`);
                    placed = true;

                    break;
            }

            if (!placed) {
                console.warn(`[Utility] Could not place ${util.name} in ${corner} after grid search.`);
                failedItems.push(util);
            }
        });
        return failedItems;
    };

    if (vastuCompliant) {
        const failedNE = placeGroupInCorner(groupNE, 'NE');
        const failedSE = placeGroupInCorner(groupSE, 'SE');
        const failedNW = placeGroupInCorner(groupNW, 'NW');
        const failedSW = placeGroupInCorner(groupSW, 'SW');

        const retrySE: UtilityDef[] = [];
        failedNW.forEach(u => {
            if (['STP', 'WTP', 'OWC'].some(t => u.type.includes(t) || u.name.includes(t))) {
                console.log(`[Utility Failover] Moving ${u.name} from NW to SE (Acceptable Direction)`);
                retrySE.push(u);
            }
        });
        if (retrySE.length > 0) {
            placeGroupInCorner(retrySE, 'SE');
        }
    } else {
        const allUtils = [...groupNE, ...groupSE, ...groupNW, ...groupSW];
        const corners: ('NE' | 'SE' | 'SW' | 'NW')[] = ['NE', 'SE', 'SW', 'NW'];
        let remaining = allUtils;

        for (const corner of corners) {
            if (remaining.length === 0) break;
            remaining = placeGroupInCorner(remaining, corner);
        }

        if (remaining.length > 0) {
            console.warn(`[Utility] ${remaining.length} utilities could not be placed in any corner:`, remaining.map(u => u.name).join(', '));
        }
    }

    return { utilities, buildings };
}

/**
 * Generates entry and exit points for the site.
 * Logic:
 * 1. If Vastu is enabled: Place gates in the auspicious zones (N3, N4, E3, E4, S3, S4, W3, W4)
 *    that intersect with the plot boundary on sides with road access.
 * 2. If Vastu is disabled: Place gates where internal roads intersect with the external plot boundary.
 */
export function generateSiteGates(
    plotPoly: Feature<Polygon | MultiPolygon>,
    vastuCompliant: boolean = false,
    roadAccessSides: string[] = [],
    internalRoads: Feature<Polygon | MultiPolygon>[] = [],
    existingBuildings: Building[] = []
): EntryPoint[] {
    const gates: EntryPoint[] = [];

    // Auto-detect road sides from plot bbox if not provided
    let sides = roadAccessSides.length > 0 ? roadAccessSides : ['N', 'S', 'E', 'W'];
    console.log(`[Gates] Using road access sides: ${sides.join(', ')} (auto=${roadAccessSides.length === 0})`);

    // Get plot boundary coordinates
    const bbox = turf.bbox(plotPoly);
    const [minX, minY, maxX, maxY] = bbox;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    let coords: number[][] = [];
    try {
        const geom = plotPoly.type === 'Feature' ? plotPoly.geometry : plotPoly;
        if (geom.type === 'Polygon') {
            coords = (geom as Polygon).coordinates[0];
        } else if (geom.type === 'MultiPolygon') {
            coords = (geom as MultiPolygon).coordinates[0][0];
        }
    } catch (e) {
        console.warn('[Gates] Could not extract coordinates');
        return [];
    }

    if (coords.length < 4) return [];

    const findClosestBoundaryPoint = (targetLng: number, targetLat: number): [number, number] => {
        const targetPt = turf.point([targetLng, targetLat]);
        const plotLine = turf.polygonToLine(plotPoly);
        const snapped = turf.nearestPointOnLine(plotLine as any, targetPt);
        return snapped.geometry.coordinates as [number, number];
    };

    const isColliding = (point: [number, number]): boolean => {
        const pt = turf.point(point);
        const buffer = turf.buffer(pt, 5, { units: 'meters' });

        return existingBuildings.some(b => {
            // @ts-ignore
            return turf.booleanOverlap(buffer, b.geometry) || turf.booleanContains(b.geometry, pt) || turf.booleanPointInPolygon(pt, b.geometry);
        });
    };

    const findValidPosition = (targetLng: number, targetLat: number): [number, number] | null => {
        let bestPos = findClosestBoundaryPoint(targetLng, targetLat);

        if (!existingBuildings || existingBuildings.length === 0) return bestPos;

        if (!isColliding(bestPos)) return bestPos;

        const plotLine = turf.polygonToLine(plotPoly);
        const lineLength = turf.length(plotLine as any, { units: 'meters' });
        const step = 5;
        const maxSearch = 50;

        const startPt = turf.point(bestPos);
        // @ts-ignore
        const startDist = turf.nearestPointOnLine(plotLine as any, startPt).properties.location;

        for (let d = step; d <= maxSearch; d += step) {
            // Check forward
            const fwdDist = (startDist + d) % lineLength;
            const fwdPt = turf.along(plotLine as any, fwdDist, { units: 'meters' });
            const fwdPos = fwdPt.geometry.coordinates as [number, number];
            if (!isColliding(fwdPos)) return fwdPos;

            // Check backward
            let backDist = (startDist - d);
            if (backDist < 0) backDist += lineLength;
            const backPt = turf.along(plotLine as any, backDist, { units: 'meters' });
            const backPos = backPt.geometry.coordinates as [number, number];
            if (!isColliding(backPos)) return backPos;
        }

        console.warn('[Gates] Could not find non-colliding position for gate, defaulting to collision');
        return bestPos;
    };

    // Vastu-compliant gate placement targets specific angular sectors
    // Non-Vastu just places gates at the midpoint of each road-facing side
    const sideTargets: Record<string, [number, number]> = {
        'N': [cx, maxY],             // North midpoint
        'S': [cx, minY],             // South midpoint
        'E': [maxX, cy],             // East midpoint
        'W': [minX, cy],             // West midpoint
    };

    if (vastuCompliant) {
        console.log(`[Gate Generator] Vastu mode enabled. Sides: ${sides.join(', ')}`);
        const center: [number, number] = [cx, cy];
        const newGates = generateVastuGates(plotPoly as Feature<Polygon>, center, sides);

        newGates.forEach(g => {
            let pos = g.position;
            if (isColliding(pos)) {
                const validPos = findValidPosition(pos[0], pos[1]);
                if (validPos) {
                    pos = validPos;
                } else {
                    return;
                }
            }

            gates.push({
                ...g,
                position: pos
            });
        });
    } else {
        // Non-Vastu: place at side midpoints
        sides.forEach(side => {
            const target = sideTargets[side];
            if (!target) return;
            const pos = findValidPosition(target[0], target[1]);
            if (!pos) return;

            gates.push({
                id: `gate-side-${side}-${Math.random().toString(36).substr(2, 5)}`,
                type: 'Both',
                position: pos,
                name: `${side} Gate`
            });
        });
    }

    console.log(`[Gates] Successfully generated ${gates.length} gates`);
    return gates;
}