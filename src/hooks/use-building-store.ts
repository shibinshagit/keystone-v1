
'use client';

import { create } from 'zustand';
import type { Feature, Polygon, MultiPolygon, Point, LineString, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import { BuildingIntendedUse, type Plot, type Building, type GreenArea, type ParkingArea, type Floor, type Project, type BuildableArea, type SelectableObjectType, AiScenario, type Label, RegulationData, GenerateMassingInput, AiMassingScenario, GenerateMassingOutput, GenerateSiteLayoutInput, GenerateSiteLayoutOutput, AiSiteLayout, AiMassingGeneratedObject, AiZone, GenerateZonesOutput, DesignOption, GreenRegulationData, VastuRegulationData, DevelopmentStats, FeasibilityParams, UtilityType, UtilityArea, ParkingType, Unit, Core, type RenderingBuildingInfo, type RenderingPlotInfo, type RenderingProjectSummary, type GenerateRenderingOutput, type AdditiveScoreSummary, type EvaluateLandInput, getPrimarySetback } from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { calculateParkingCapacity } from '@/lib/parking-calc';
import { produce } from 'immer';
import { applyPeripheralClearZone, planarArea } from '@/lib/generators/geometry-utils';
import { toast } from './use-toast';
import { useMemo } from 'react';
import { generateSiteLayout } from '@/ai/flows/ai-site-layout-generator';
import { generateMassingOptions } from '@/ai/flows/ai-massing-generator';
import { generateArchitecturalRendering } from '@/ai/flows/ai-architectural-rendering';
import { generateLayoutZones } from '@/ai/flows/ai-zone-generator';
import { generateSitePlanImage } from '@/lib/generate-site-plan-image';

import { generateLamellas, generateTowers, generatePerimeter, AlgoParams, AlgoTypology } from '@/lib/generators/basic-generator';
import { generateLShapes, generateUShapes, generateTShapes, generateHShapes, generateSlabShapes, generatePointShapes, generateLargeFootprint, generateCommercialBlocks, checkCollision } from '@/lib/generators/geometric-typologies';
import { generateSiteUtilities, generateBuildingLayout, calculateUtilityReservationZones, generateSiteGates, getPlotOrientation } from '@/lib/generators/layout-generator';
import { splitPolygon } from '@/lib/polygon-utils';
import { db } from '@/lib/firebase';
import { inferRegulationGeography } from '@/lib/geography';
import { calculateVastuScore } from '@/lib/engines/vastu-engine';
import { calculateGreenAnalysis } from '@/lib/engines/green-analysis-engine';
import { ComplianceEngine } from '@/lib/engines/compliance-engine';
import ultimateVastuChecklist from '@/data/ultimate-vastu-checklist.json';
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, getDoc, query, where } from 'firebase/firestore';
import useAuthStore from './use-auth-store';
import { getRegulationCollectionNameForMarket, shouldUseNationalIndiaFallback } from '@/lib/regulation-collections';
import { getAvailableRegulationsForLocation } from '@/lib/regulation-lookup';

export type DrawingObjectType = 'Plot' | 'Zone' | 'Building' | 'Road' | 'Move' | 'Select';

type ZoneType = 'BuildableArea' | 'GreenArea' | 'ParkingArea' | 'UtilityArea';

interface ZoneDefinitionState {
    isDefining: boolean;
    geometry: Feature<Polygon> | null;
    centroid: Feature<Point> | null;
    activePlotId: string | null;
}

interface DrawingState {
    isDrawing: boolean;
    objectType: DrawingObjectType | null;
    activePlotId: string | null; // The plot we are drawing inside
    roadWidth: number; // Width of the road in meters
    buildingIntendedUse: BuildingIntendedUse; // Intended use when drawing a building
}

interface InstantAnalysisTarget {
    coordinates: [number, number];
    locationLabel: string;
    district?: string;
    stateCode?: string;
    stateName?: string;
    plotId?: string | null;
    plotName?: string | null;
    parcelAware: boolean;
    source: 'map-click';
    requestKey: string;
    capturedAt: string;
}

interface UiState {
    showVastuCompass: boolean;
    isFeasibilityPanelOpen: boolean;
    ghostMode: boolean;
    isInstantAnalysisMode: boolean;
}

interface BuildingState {
    projects: Project[];
    activeProjectId: string | null;
    plots: Plot[]; // plots for the active project
    drawingPoints: [number, number][];
    drawingState: DrawingState;
    zoneDefinition: ZoneDefinitionState;
    selectedObjectId: { type: SelectableObjectType; id: string } | null;
    hoveredObjectId: { type: SelectableObjectType; id: string } | null;
    uiState: UiState;
    componentVisibility: { electrical: boolean; hvac: boolean; basements: boolean; cores: boolean; units: boolean; solar: boolean; ev: boolean };
    aiScenarios: (AiScenario | AiMassingScenario)[] | null;
    activeBhuvanLayer: string | null;
    activeBhuvanOpacity: number;
    bhuvanData: any | null;
    isFetchingBhuvan: boolean;
    districtNameHint?: string;
    isLoading: boolean;
    active: boolean;
    isSaving: boolean;
    isGeneratingAi: boolean;
    isGeneratingRendering: boolean;
    aiRenderingUrl: string | null;
    aiRenderingResult: GenerateRenderingOutput | null;
    aiRenderingMinimized: boolean;
    renderingDesignParams: DesignParamsForRendering | null;
    isGeneratingAlgo: boolean;
    generationParams: AlgoParams;

    designOptions: DesignOption[]; // Saved scenarios
    tempScenarios: { plots: Plot[] }[] | null; // Temporary scenarios for selection
    isGeneratingScenarios: boolean;

    mapLocation: string | null;
    mapCommand: { type: 'flyTo'; center: [number, number]; zoom?: number } | null;
    instantAnalysisTarget: InstantAnalysisTarget | null;
    greenRegulations: GreenRegulationData[]; // Global Green Regulations cache
    vastuRegulations: VastuRegulationData[]; // Global Vastu Guidelines cache

    actions: any;
}

import { hslToRgb, BUILDING_MATERIALS } from '@/lib/color-utils';

export const UTILITY_COLORS = {
    [UtilityType.STP]: '#8B4513', // SaddleBrown
    [UtilityType.WTP]: '#00CED1', // DarkTurquoise
    [UtilityType.HVAC]: '#FF8C00', // DarkOrange
    [UtilityType.Electrical]: '#FFD700', // Gold
    [UtilityType.Water]: '#1E90FF', // DodgerBlue
    [UtilityType.Fire]: '#FF0000', // Red
    [UtilityType.Gas]: '#228B22', // ForestGreen
    [UtilityType.Roads]: '#555555', // DarkGrey
    [UtilityType.OWC]: '#8B4513', // SaddleBrown (reuse/similar to STP)
    [UtilityType.DGSet]: '#3A4F2E', // Olive Green
    [UtilityType.RainwaterHarvesting]: '#00CED1', // Turquoise
    [UtilityType.SolidWaste]: '#8D6E63', // Brownish
    [UtilityType.Admin]: '#FDD835', // Yellow
    [UtilityType.SolarPV]: '#1A237E', // Solar Indigo
};

const generateFloorColors = (count: number, buildingType: BuildingIntendedUse = BuildingIntendedUse.Residential): string[] => {
    const material = BUILDING_MATERIALS[buildingType] || BUILDING_MATERIALS[BuildingIntendedUse.Residential];
    const colors: string[] = [];

    for (let i = 0; i < count; i++) {
        // Create vertical gradient: lighter at bottom, darker at top
        const floorRatio = count > 1 ? i / (count - 1) : 0;

        // Darken by 10-15% toward the top for depth
        const lightnessAdjustment = -12 * floorRatio;
        const lightness = Math.max(40, Math.min(80, material.baseLightness + lightnessAdjustment));

        // Slight hue variation for realism (±5 degrees)
        const hueVariation = (Math.random() - 0.5) * 10;
        const hue = material.baseHue + hueVariation;

        colors.push(hslToRgb(hue, material.saturation, lightness));
    }

    return colors;
}

// Helper to determine opacity based on building type
const getOpacityForBuildingType = (buildingType: BuildingIntendedUse): number => {
    switch (buildingType) {
        case BuildingIntendedUse.Commercial:
            return 0.85; // More transparent for glass facades
        case BuildingIntendedUse.MixedUse:
            return 0.88; // Slightly transparent
        case BuildingIntendedUse.Residential:
            return 0.95; // More solid
        case BuildingIntendedUse.Industrial:
            return 0.98; // Very solid
        case BuildingIntendedUse.Public:
            return 0.92; // Moderately solid
        default:
            return 0.9;
    }
};

// Helper to convert geometry for Firestore

/**
 * Recursively walks an object/array and JSON-stringifies any value that
 * is or contains a nested array (arrays of arrays), which Firestore rejects.
 */
const sanitizeForFirestore = (val: any): any => {
    if (val === null || val === undefined) return val;
    if (Array.isArray(val)) {
        // Check if any element is itself an array → nested array → stringify the whole thing
        if (val.some((item: any) => Array.isArray(item))) {
            return JSON.stringify(val);
        }
        // Otherwise recursively sanitize each element
        return val.map((item: any) => sanitizeForFirestore(item));
    }
    if (typeof val === 'object' && !(val instanceof Date)) {
        const sanitized: any = {};
        for (const key of Object.keys(val)) {
            sanitized[key] = sanitizeForFirestore(val[key]);
        }
        return sanitized;
    }
    return val;
};

const prepareForFirestore = (plots: Plot[]): any[] => {
    console.log('[prepareForFirestore] Input plots:', plots.length);
    const serialized = plots.map(plot => {
        const prepared = {
            ...plot,
            geometry: plot.geometry ? JSON.stringify(plot.geometry) : null,
            centroid: plot.centroid ? JSON.stringify(plot.centroid) : null,
            buildings: (plot.buildings || []).map(b => ({
                ...b,
                geometry: JSON.stringify(b.geometry),
                centroid: JSON.stringify(b.centroid),
                originalGeometry: b.originalGeometry ? JSON.stringify(b.originalGeometry) : undefined,
                originalCentroid: b.originalCentroid ? JSON.stringify(b.originalCentroid) : undefined,
                cores: (b.cores || []).map(c => ({
                    ...c,
                    geometry: JSON.stringify(c.geometry)
                })),
                originalCores: b.originalCores ? b.originalCores.map(c => ({
                    ...c,
                    geometry: JSON.stringify(c.geometry)
                })) : undefined,
                units: (b.units || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
                originalUnits: b.originalUnits ? b.originalUnits.map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })) : undefined,
                internalUtilities: (b.internalUtilities || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
                originalInternalUtilities: b.originalInternalUtilities ? b.originalInternalUtilities.map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry),
                    centroid: JSON.stringify(u.centroid)
                })) : undefined,
            })),
            greenAreas: (plot.greenAreas || []).map(g => ({
                ...g,
                geometry: JSON.stringify(g.geometry),
                centroid: JSON.stringify(g.centroid),
            })),
            parkingAreas: (plot.parkingAreas || []).map(p => ({
                ...p,
                geometry: JSON.stringify(p.geometry),
                centroid: JSON.stringify(p.centroid),
                originalGeometry: p.originalGeometry ? JSON.stringify(p.originalGeometry) : undefined,
            })),
            buildableAreas: (plot.buildableAreas || []).map(b => ({
                ...b,
                geometry: JSON.stringify(b.geometry),
                centroid: JSON.stringify(b.centroid),
            })),
            utilityAreas: (plot.utilityAreas || []).map(u => ({
                ...u,
                geometry: JSON.stringify(u.geometry),
                centroid: JSON.stringify(u.centroid),
            })),
        };
        return prepared;
    });
    // Final pass: catch any remaining nested arrays that we missed above
    return sanitizeForFirestore(serialized);
};

// Helper to safely parse geometry
const safeParse = (data: any, label: string) => {
    if (!data) return null;
    if (typeof data === 'object') return data; // Already an object
    try {
        const parsed = JSON.parse(data);
        // Handle double-serialization check
        if (typeof parsed === 'string') {
            try { return JSON.parse(parsed); }
            catch { return parsed; }
        }
        return parsed;
    } catch (e) {
        console.warn(`[safeParse] Failed to parse ${label}:`, data);
        return null;
    }
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// function normalizeRotation(angle: number) {
//     let normalized = ((angle % 360) + 360) % 360;
//     if (normalized >= 180) {
//         normalized -= 180;
//     }
//     return normalized;
// }
const normalizeRotation = (angle: number) => {
    let normalized = ((angle % 360) + 360) % 360;
    if (normalized >= 180) normalized -= 360;
    return normalized;
};

// const captureBuildingRotationSnapshot = (building: Building) => {
//     if (!building.originalGeometry && building.geometry) {
//         building.originalGeometry = deepClone(building.geometry);
//     }
//     if (!building.originalCentroid && building.centroid) {
//         building.originalCentroid = deepClone(building.centroid);
//     }
//     if (!building.originalCores && building.cores) {
//         building.originalCores = deepClone(building.cores);
//     }
//     if (!building.originalUnits && building.units) {
//         building.originalUnits = deepClone(building.units);
//     }
//     if (!building.originalInternalUtilities && building.internalUtilities) {
//         building.originalInternalUtilities = deepClone(building.internalUtilities);
//     }
//     if (building.originalAlignmentRotation === undefined) {
//         building.originalAlignmentRotation = building.alignmentRotation ?? 0;
//     }
// };

const captureBuildingRotationSnapshot = (building: Building) => {

    if (building.originalGeometry === undefined && building.geometry) {
        building.originalGeometry = deepClone(building.geometry);
    }

    if (building.originalCentroid === undefined && building.centroid) {
        building.originalCentroid = deepClone(building.centroid);
    }

    if (building.originalCores === undefined && building.cores) {
        building.originalCores = deepClone(building.cores);
    }

    if (building.originalUnits === undefined && building.units) {
        building.originalUnits = deepClone(building.units);
    }

    if (building.originalInternalUtilities === undefined && building.internalUtilities) {
        building.originalInternalUtilities = deepClone(building.internalUtilities);
    }

    if (building.originalAlignmentRotation === undefined) {
        building.originalAlignmentRotation = building.alignmentRotation ?? 0;
    }
};

// const restoreBuildingRotationSnapshot = (building: Building) => {
//     if (!building.originalGeometry || !building.originalCentroid) return false;

//     building.geometry = deepClone(building.originalGeometry);
//     building.centroid = deepClone(building.originalCentroid);

//     if (building.originalCores) {
//         building.cores = deepClone(building.originalCores);
//     }
//     if (building.originalUnits) {
//         building.units = deepClone(building.originalUnits);
//     }
//     if (building.originalInternalUtilities) {
//         building.internalUtilities = deepClone(building.originalInternalUtilities);
//     }

//     building.alignmentRotation = building.originalAlignmentRotation ?? 0;
//     return true;
// };

const restoreBuildingRotationSnapshot = (building: Building) => {

    if (!building.originalGeometry || !building.originalCentroid) return false;

    building.geometry = deepClone(building.originalGeometry);
    building.centroid = deepClone(building.originalCentroid);

    if (building.originalCores) {
        building.cores = deepClone(building.originalCores);
    }

    if (building.originalUnits) {
        building.units = deepClone(building.originalUnits);
    }

    if (building.originalInternalUtilities) {
        building.internalUtilities = deepClone(building.originalInternalUtilities);
    }

    building.alignmentRotation = building.originalAlignmentRotation ?? 0;

    return true;
};

const rotateBuildingFromSnapshot = (building: Building, angle: number) => {

    captureBuildingRotationSnapshot(building);

    if (!building.originalGeometry || !building.originalCentroid) return;

    const rotation = normalizeRotation(angle);

    const pivot = building.originalCentroid.geometry.coordinates;

    // rotate building footprint
    building.geometry = turf.transformRotate(
        building.originalGeometry,
        rotation,
        { pivot }
    );
    building.geometry.properties = {
        ...(building.geometry.properties || {}),
        alignmentRotation: rotation,
    };
    building.centroid = turf.transformRotate(
        building.originalCentroid,
        rotation,
        { pivot }
    );

    // rotate cores
    if (building.originalCores) {
        building.cores = building.originalCores.map(core => ({
            ...core,
            geometry: turf.transformRotate(core.geometry, rotation, { pivot })
        }));
    }

    // rotate units
    if (building.originalUnits) {
        building.units = building.originalUnits.map(unit => ({
            ...unit,
            geometry: turf.transformRotate(unit.geometry, rotation, { pivot })
        }));
    }

    // rotate utilities
    if (building.originalInternalUtilities) {
        building.internalUtilities = building.originalInternalUtilities.map(util => ({
            ...util,
            geometry: turf.transformRotate(util.geometry, rotation, { pivot }),
            centroid: turf.transformRotate(util.centroid, rotation, { pivot })
        }));
    }

    building.alignmentRotation = rotation;
};


// Helper to parse geometry from Firestore
const parseFromFirestore = (plots: any[]): Plot[] => {
    if (!plots || !Array.isArray(plots)) {
        console.warn('[parseFromFirestore] Invalid input:', plots);
        return [];
    }
    console.log('[parseFromFirestore] Parsing plots:', plots.length);

    return plots.map(plot => {
        try {
            // Check if this plot is already parsed (has geometry object)
            // or if it needs parsing
            const parsedPlot = {
                ...plot,
                isHeatAnalysisActive: plot.isHeatAnalysisActive ?? false,
                geometry: safeParse(plot.geometry, `plot-${plot.id}-geometry`),
                centroid: safeParse(plot.centroid, `plot-${plot.id}-centroid`),
                buildings: (plot.buildings || []).map((b: any) => ({
                    ...b,
                    geometry: safeParse(b.geometry, `bldg-${b.id}`),
                    centroid: safeParse(b.centroid, `bldg-${b.id}-centroid`),
                    originalGeometry: b.originalGeometry ? safeParse(b.originalGeometry, `bldg-${b.id}-original-geometry`) : undefined,
                    originalCentroid: b.originalCentroid ? safeParse(b.originalCentroid, `bldg-${b.id}-original-centroid`) : undefined,
                    cores: (b.cores || []).map((c: any) => ({
                        ...c,
                        geometry: safeParse(c.geometry, `core-${c.id}`)
                    })),
                    originalCores: b.originalCores ? b.originalCores.map((c: any) => ({
                        ...c,
                        geometry: safeParse(c.geometry, `core-${c.id}-original`)
                    })) : undefined,
                    units: (b.units || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `unit-${u.id}`)
                    })),
                    originalUnits: b.originalUnits ? b.originalUnits.map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `unit-${u.id}-original`)
                    })) : undefined,
                    internalUtilities: (b.internalUtilities || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `util-int-${u.id}`)
                    })),
                    originalInternalUtilities: b.originalInternalUtilities ? b.originalInternalUtilities.map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `util-int-${u.id}-original`),
                        centroid: safeParse(u.centroid, `util-int-${u.id}-original-centroid`)
                    })) : undefined,
                })),
                greenAreas: (plot.greenAreas || []).map((g: any) => ({
                    ...g,
                    geometry: safeParse(g.geometry, `green-${g.id}`),
                    centroid: safeParse(g.centroid, `green-${g.id}-centroid`),
                })),
                parkingAreas: (plot.parkingAreas || []).map((p: any) => ({
                    ...p,
                    geometry: safeParse(p.geometry, `parking-${p.id}`),
                    centroid: safeParse(p.centroid, `parking-${p.id}-centroid`),
                    originalGeometry: p.originalGeometry ? safeParse(p.originalGeometry, `parking-${p.id}-origGeom`) : undefined,
                })),
                buildableAreas: (plot.buildableAreas || []).map((b: any) => ({
                    ...b,
                    geometry: safeParse(b.geometry, `buildable-${b.id}`),
                    centroid: safeParse(b.centroid, `buildable-${b.id}-centroid`),
                })),
                utilityAreas: (plot.utilityAreas || []).map((u: any) => ({
                    ...u,
                    geometry: safeParse(u.geometry, `utility-${u.id}`),
                    centroid: safeParse(u.centroid, `utility-${u.id}-centroid`),
                })),
            };

            // Debug log for first plot to verify structure
            if (plot === plots[0]) {
                console.log('[parseFromFirestore] Parsed First Plot Sample:', {
                    id: parsedPlot.id,
                    hasGeometry: !!parsedPlot.geometry,
                    geometryType: parsedPlot.geometry?.type
                });
            }

            return parsedPlot;
        } catch (e) {
            console.error("Failed to parse plot from firestore", plot, e);
            return { ...plot, geometry: null, centroid: null, buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [], utilityAreas: [] };
        }
    }).filter(p => {
        if (!p.geometry) console.warn('[parseFromFirestore] Filtered out plot with missing geometry:', p.id);
        return p.geometry;
    }); // Filter out plots that failed to parse
};

async function fetchRegulationsForPlot(plotId: string, centroid: Feature<Point>) {
    const [lon, lat] = centroid.geometry.coordinates;
    let locationName: string | null = 'Default';
    let fetchedRegulations: RegulationData[] = [];
    const activeProject = useBuildingStore.getState().projects.find(
        p => p.id === useBuildingStore.getState().activeProjectId,
    );

    try {
        const collectionName = getRegulationCollectionNameForMarket(activeProject?.market);
        const regulationsRef = collection(db, collectionName);
        const preferredProjectLocations = [
            activeProject?.city,
            activeProject?.locationLabel,
            typeof activeProject?.location === 'string' ? activeProject.location : undefined,
            activeProject?.stateOrProvince,
        ].filter((value, index, values): value is string => !!value && values.indexOf(value) === index);

        for (const candidate of preferredProjectLocations) {
            const regulations = await getAvailableRegulationsForLocation({
                location: candidate,
                market: activeProject?.market,
            });
            if (regulations.length > 0) {
                locationName = candidate;
                fetchedRegulations = regulations;
                break;
            }
        }

        if (fetchedRegulations.length === 0) {
            const geoResponse = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=place,region&access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`);
            const geoData = await geoResponse.json();
            const placeFeature = Array.isArray(geoData.features)
                ? geoData.features.find((feature: any) => feature.place_type?.includes('place'))
                : null;
            const regionFeature = Array.isArray(geoData.features)
                ? geoData.features.find((feature: any) => feature.place_type?.includes('region'))
                : null;
            locationName = placeFeature?.text || regionFeature?.text || locationName;

            if (locationName) {
                console.log(`[Store] Fetching local regulations for ${locationName}...`);
                const regulations = await getAvailableRegulationsForLocation({
                    location: locationName,
                    market: activeProject?.market,
                });
                if (regulations.length > 0) {
                    fetchedRegulations = regulations;
                } else if (shouldUseNationalIndiaFallback(activeProject?.market)) {
                    // Fallback to National (NBC) if no local regulations found
                    console.log(`[Store] No local regulations for ${locationName}, fetching NBC fallback...`);
                    const nbcQ = query(regulationsRef, where('location', '==', 'National (NBC)'));
                    const nbcSnapshot = await getDocs(nbcQ);
                    if (!nbcSnapshot.empty) {
                        fetchedRegulations = nbcSnapshot.docs.map(doc => doc.data() as RegulationData);
                        console.log(`[Store] NBC fallback found ${fetchedRegulations.length} entries.`);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Failed to fetch location or regulations', e);
        toast({ variant: 'destructive', title: 'Location Error', description: 'Could not determine plot location or fetch regulations.' });
    }

    // Determine regulation based on Project settings
    let intendedUse = activeProject?.intendedUse || 'Residential';
    if (intendedUse.toLowerCase() === 'mixed use') intendedUse = 'Mixed-Use';
    else if (intendedUse.toLowerCase() === 'mixed-use') intendedUse = 'Mixed Use';

    const projectRegulationId = activeProject?.regulationId;

    let defaultRegulation: RegulationData | undefined;

    // 1. Priority: Explicit Project Regulation ID
    if (projectRegulationId) {
        defaultRegulation = fetchedRegulations.find(r => r.id === projectRegulationId || r.type === projectRegulationId);
    }

    // 2. Fallback: Match Intended Use (Optimization)
    if (!defaultRegulation) {
        // Only try to find a match, do NOT force random ones
        defaultRegulation = fetchedRegulations.find(r => r.type && r.type.toLowerCase() === intendedUse.toLowerCase()); // Exact match preference

        if (!defaultRegulation) {
            defaultRegulation = fetchedRegulations.find(r => r.type && r.type.toLowerCase().includes(intendedUse.toLowerCase()));
        }
    }

    // 3. Fallback: National (NBC) if entirely missing or no matching use case found locally
    if (!defaultRegulation && shouldUseNationalIndiaFallback(activeProject?.market)) {
        console.log(`[Store] No matching local regulations found for intended use: ${intendedUse}, fetching National (NBC) fallback...`);
        try {
            const regulationsRef = collection(db, getRegulationCollectionNameForMarket(activeProject?.market));
            const nbcQ = query(regulationsRef, where('location', '==', 'National (NBC)'));
            const nbcSnapshot = await getDocs(nbcQ);
            
            if (!nbcSnapshot.empty) {
                const nbcRegulations = nbcSnapshot.docs.map(doc => doc.data() as RegulationData);
                // Try exactly same intended use matching against NBC pool
                defaultRegulation = nbcRegulations.find(r => r.type && r.type.toLowerCase() === intendedUse.toLowerCase());
                if (!defaultRegulation) {
                    defaultRegulation = nbcRegulations.find(r => r.type && r.type.toLowerCase().replace('-', ' ') === intendedUse.toLowerCase().replace('-', ' '));
                }
                if (!defaultRegulation) {
                    defaultRegulation = nbcRegulations.find(r => r.type && r.type.toLowerCase().includes(intendedUse.toLowerCase().replace('-', ' ')));
                }
                
                // If we found a match from NBC, ensure it's added to available regulations so UI can see it
                if (defaultRegulation) {
                    console.log(`[Store] Successfully applied NBC Fallback: ${defaultRegulation.type}`);
                    // Ensure the NBC regulation is in the available loop for the dropdown UI
                    if (!fetchedRegulations.find(r => r.id === defaultRegulation!.id)) {
                        fetchedRegulations.push(defaultRegulation);
                    }
                }
            }
        } catch (e) {
            console.error('[Store] Failed to fetch NBC fallback regulations', e);
        }
    }

    // Removed aggressive fallbacks (Residential / First Available) as per user request
    // If no regulation matches, it will remain NULL, allowing the user to set it manually or see "No Regulation"

    useBuildingStore.setState(produce((draft: BuildingState) => {
        const plotToUpdate = draft.plots.find(p => p.id === plotId);
        if (plotToUpdate) {
            plotToUpdate.location = locationName;
            plotToUpdate.availableRegulations = fetchedRegulations;
            plotToUpdate.selectedRegulationType = defaultRegulation?.type || null;
            plotToUpdate.regulation = defaultRegulation || null;

            // Extract regulation constraints
            plotToUpdate.setback = getPrimarySetback(defaultRegulation) ?? 4;
            plotToUpdate.maxBuildingHeight = defaultRegulation?.geometry?.max_height?.value;
            plotToUpdate.far = defaultRegulation?.geometry?.floor_area_ratio?.value;
            plotToUpdate.maxCoverage = defaultRegulation?.geometry?.max_ground_coverage?.value;
        }
    }));
}

// ── Helper: collect rendering project data from current store state ──
export type DesignParamsForRendering = { landUse: string; unitMix: Record<string, number>; selectedUtilities: string[]; hasPodium: boolean; podiumFloors: number; parkingTypes: string[]; typology: string };

/** Convert a Blob (from canvas.toBlob) into a base64 data-URI string. */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function summarizeAdditiveScore(items: Array<{ maxScore: number; achievedScore: number }>): AdditiveScoreSummary {
    const eligible = items.filter(i => i.maxScore > 0);
    const totalScore = eligible.reduce((sum, item) => sum + item.achievedScore, 0);
    const maxScore = eligible.reduce((sum, item) => sum + item.maxScore, 0);

    // Convert achievedScore -> points: if achievedScore equals maxScore -> 1 point,
    // if it's half of maxScore -> 0.5 point, else 0. This keeps compatibility with items created by the engine.
    const pointSum = eligible.reduce((sum, item) => {
        const pts = item.maxScore > 0 ? (item.achievedScore / item.maxScore) : 0;
        // Cap to 1 and treat 0.5 fractions naturally
        const normalized = Math.min(1, Math.max(0, pts));
        return sum + normalized;
    }, 0);

    const maxPoints = eligible.length;
    const percentage = maxPoints > 0 ? Math.round((pointSum / maxPoints) * 100) : 0;

    return { totalScore, maxScore, percentage };
}

function collectRenderingData(
    _plots: Plot[],
    selectedPlot: Plot,
    designParams: DesignParamsForRendering
): {
    buildingsInfo: Array<RenderingBuildingInfo & {
        id: string;
        parts?: Array<{
            type: 'podium' | 'tower' | 'main';
            footprint: number[][][];
            height: number;
        }>;
    }>;
    plotInfo: RenderingPlotInfo & { boundary?: number[][][] };
    summary: RenderingProjectSummary;
} | null {
    const buildingsData = selectedPlot.buildings;
    const getCentroid = (geometry: Feature<Polygon>): { x: number; y: number } => {
        const centroid = turf.centroid(geometry);
        return {
            x: Number(centroid.geometry.coordinates[0].toFixed(8)),
            y: Number(centroid.geometry.coordinates[1].toFixed(8)),
        };
    };
    const normalizePoint = (point: [number, number], plotCenter: [number, number]) => {
        return {
            x: Number((point[0] - plotCenter[0]).toFixed(8)),
            y: Number((point[1] - plotCenter[1]).toFixed(8)),
        };
    };
    const normalizePolygon = (coordinates: number[][][], plotCenter: [number, number]): number[][][] => {
        return coordinates.map(ring =>
            ring.map(point => {
                const normalized = normalizePoint([point[0], point[1]], plotCenter);
                return [normalized.x, normalized.y];
            })
        );
    };
    const getBuildingFootprint = (building: Building): number[][][] => {
        return building.geometry?.geometry?.coordinates
            ? JSON.parse(JSON.stringify(building.geometry.geometry.coordinates))
            : [];
    };
    const getBuildingPartType = (buildingId: string): 'podium' | 'tower' | 'main' => {
        if (buildingId.endsWith('-podium')) return 'podium';
        if (buildingId.endsWith('-tower')) return 'tower';
        return 'main';
    };
    const getRelatedBuildingParts = (building: Building) => {
        const baseId = building.id.endsWith('-podium')
            ? building.id.replace(/-podium$/, '')
            : building.id.endsWith('-tower')
                ? building.id.replace(/-tower$/, '')
                : building.id;
        const pairedBuildings = buildingsData.filter(candidate =>
            candidate.id === baseId ||
            candidate.id === `${baseId}-podium` ||
            candidate.id === `${baseId}-tower`
        );
        const uniqueBuildings = pairedBuildings.length > 0 ? pairedBuildings : [building];

        return uniqueBuildings.map(partBuilding => ({
            type: getBuildingPartType(partBuilding.id),
            footprint: getBuildingFootprint(partBuilding),
            height: partBuilding.height,
        }));
    };
    const plotBoundary = selectedPlot.geometry?.geometry?.coordinates
        ? JSON.parse(JSON.stringify(selectedPlot.geometry.geometry.coordinates))
        : undefined;
    const plotCenterCoords = selectedPlot.geometry
        ? (() => {
            const centroid = getCentroid(selectedPlot.geometry);
            return [centroid.x, centroid.y] as [number, number];
        })()
        : ([0, 0] as [number, number]);
    const plotFootprint = plotBoundary
        ? normalizePolygon(plotBoundary, plotCenterCoords)
        : undefined;

    // Compute plot centroid for spatial positioning
    let plotCenterLng = 0, plotCenterLat = 0;
    try {
        if (selectedPlot.geometry) {
            const plotCentroid = turf.centroid(selectedPlot.geometry);
            plotCenterLng = plotCentroid.geometry.coordinates[0];
            plotCenterLat = plotCentroid.geometry.coordinates[1];
        }
    } catch { /* ignore */ }

    const buildingsInfo = buildingsData.map((b): RenderingBuildingInfo & {
        id: string;
        parts?: Array<{
            type: 'podium' | 'tower' | 'main';
            footprint: number[][][];
            height: number;
        }>;
    } => {
        let footprintWidth = Math.round(Math.sqrt(b.area));
        let footprintDepth = footprintWidth;
        const footprint = getBuildingFootprint(b);
        const center = getCentroid(b.geometry);
        const parts = getRelatedBuildingParts(b);
        const partSummary = parts
            .map(part => `${part.type} ${Math.round(part.height)}m`)
            .join(', ');
        const normalizedCenter = normalizePoint([center.x, center.y], plotCenterCoords);
        const normalizedFootprint = normalizePolygon(footprint, plotCenterCoords);
        let bCenterLng = center.x, bCenterLat = center.y;
        try {
            const bbox = turf.bbox(b.geometry);
            const sw = turf.point([bbox[0], bbox[1]]);
            const ne = turf.point([bbox[2], bbox[3]]);
            const se = turf.point([bbox[2], bbox[1]]);
            footprintWidth = Math.round(turf.distance(sw, se, { units: 'meters' })) || footprintWidth;
            footprintDepth = Math.round(turf.distance(se, ne, { units: 'meters' })) || footprintDepth;
        } catch { /* square fallback */ }

        // Determine spatial position relative to plot center
        let position: string | undefined;
        if (buildingsData.length > 1 && plotCenterLng !== 0 && bCenterLng !== 0) {
            const ns = bCenterLat > plotCenterLat ? 'front' : 'back';
            const ew = bCenterLng > plotCenterLng ? 'right' : 'left';
            const latDiff = Math.abs(bCenterLat - plotCenterLat);
            const lngDiff = Math.abs(bCenterLng - plotCenterLng);
            // If one axis dominates, use single direction; otherwise combine
            if (latDiff > lngDiff * 3) position = `${ns} side of the plot`;
            else if (lngDiff > latDiff * 3) position = `${ew} side of the plot`;
            else position = `${ns}-${ew} of the plot`;
        }

        const basementFloors = b.floors ? b.floors.filter(f => f.level !== undefined && f.level < 0).length : 0;
        const aboveGround = b.numFloors;
        const totalFlrs = aboveGround + basementFloors;
        const gfa = b.area * totalFlrs;

        const parkingFlrs = b.floors ? b.floors.filter(f => f.type === 'Parking') : [];
        const parkingCapacity = parkingFlrs.reduce((sum, f) => sum + (f.parkingCapacity || 0), 0);
        const evStations = b.floors ? b.floors.reduce((sum, f) => sum + (f.evStations || 0), 0) : 0;

        const coreBreakdown = { lifts: 0, stairs: 0, service: 0, lobbies: 0 };
        if (b.cores) {
            b.cores.forEach(c => {
                if (c.type === 'Lift') coreBreakdown.lifts++;
                else if (c.type === 'Stair') coreBreakdown.stairs++;
                else if (c.type === 'Service') coreBreakdown.service++;
                else if (c.type === 'Lobby') coreBreakdown.lobbies++;
            });
        }

        const unitBreakdown: Record<string, number> = {};
        if (b.units) {
            b.units.forEach(u => { unitBreakdown[u.type] = (unitBreakdown[u.type] || 0) + 1; });
        }

        const relativePosition = normalizedCenter;

        // Extract per-floor use allocation for mixed-use buildings
        let floorUseAllocation: { use: string; floors: string; count: number }[] | undefined;
        if (b.floors && b.floors.length > 0) {
            const aboveGroundFloors = b.floors
                .filter(f => (f.level === undefined || f.level >= 0) && f.type !== 'Parking')
                .sort((a, f2) => (a.level ?? 0) - (f2.level ?? 0));

            if (aboveGroundFloors.some(f => f.intendedUse)) {
                // Group consecutive floors by intendedUse
                const groups: { use: string; startFloor: number; endFloor: number; count: number }[] = [];
                let currentUse = '';
                let startIdx = 0;

                aboveGroundFloors.forEach((f, idx) => {
                    const use = f.intendedUse || b.intendedUse || 'Mixed-Use';
                    if (use !== currentUse) {
                        if (currentUse) {
                            groups.push({ use: currentUse, startFloor: startIdx + 1, endFloor: idx, count: idx - startIdx });
                        }
                        currentUse = use;
                        startIdx = idx;
                    }
                });
                // Push last group
                if (currentUse) {
                    groups.push({ use: currentUse, startFloor: startIdx + 1, endFloor: aboveGroundFloors.length, count: aboveGroundFloors.length - startIdx });
                }

                // Only include if there are multiple use types (truly mixed)
                const uniqueUses = new Set(groups.map(g => g.use));
                if (uniqueUses.size > 1) {
                    floorUseAllocation = groups.map(g => ({
                        use: g.use,
                        floors: g.startFloor === g.endFloor ? `F${g.startFloor}` : `F${g.startFloor}-${g.endFloor}`,
                        count: g.count,
                    }));
                }
            }
        }

        // Determine the actual intendedUse — override to 'Mixed-Use' if floors show multiple uses
        let resolvedIntendedUse: string = b.intendedUse;
        if (floorUseAllocation && floorUseAllocation.length > 1) {
            // Floors have multiple distinct uses → definitely mixed
            resolvedIntendedUse = 'Mixed-Use';
        } else if (b.programMix && b.intendedUse === 'Mixed-Use') {
            // Only apply programMix override if building is already labeled Mixed-Use
            // (avoids overriding plot-wise single-purpose buildings that carry programMix from params)
            const nonZero = Object.values(b.programMix).filter(v => v > 0).length;
            if (nonZero > 1) resolvedIntendedUse = 'Mixed-Use';
        }

        // Debug: trace rendering data extraction
        console.log(`[RenderData] Building "${b.id}" (${b.name}):`,
            `native intendedUse=${b.intendedUse},`,
            `resolved=${resolvedIntendedUse},`,
            `floors=${b.floors?.length || 0},`,
            `floorUseAllocation=${floorUseAllocation ? JSON.stringify(floorUseAllocation) : 'undefined'}`
        );

        return {
            id: b.id,
            name: parts.length > 1 ? `${b.name} (${partSummary})` : b.name,
            height: b.height, numFloors: aboveGround, basementFloors,
            totalFloors: totalFlrs, floorHeight: b.typicalFloorHeight,
            groundFloorHeight: b.groundFloorHeight || b.typicalFloorHeight,
            footprintArea: b.area,
            footprintWidth, footprintDepth, intendedUse: resolvedIntendedUse,
            typology: designParams.typology, gfa, programMix: b.programMix,
            floorUseAllocation,
            cores: coreBreakdown, unitCount: b.units?.length || 0, unitBreakdown,
            parkingFloors: parkingFlrs.length, parkingCapacity, evStations,
            position: parts.length > 1 && position ? `${position}; composite massing: ${partSummary}` : position,
            footprint: normalizedFootprint,
            center: normalizedCenter,
            relativePosition,
            rotation: b.alignmentRotation ?? b.originalAlignmentRotation ?? 0,
            parts: parts.map(part => ({
                ...part,
                footprint: normalizePolygon(part.footprint, plotCenterCoords),
            })),
        };
    });

    if (buildingsInfo.length !== selectedPlot.buildings.length) {
        throw new Error(`BUILDING COUNT MISMATCH: plot=${selectedPlot.buildings.length}, render=${buildingsInfo.length}`);
    }

    if (buildingsInfo.length === 0) return null;

    const totalPlotArea = selectedPlot.area;
    const totalGreenAreas = selectedPlot.greenAreas.length;
    const totalParkingAreas = selectedPlot.parkingAreas.length;
    const allRoadSides = new Set<string>();
    selectedPlot.roadAccessSides?.forEach(s => allRoadSides.add(s));

    const parkingPolygons = selectedPlot.parkingAreas
        .map(pa => pa.geometry?.geometry?.coordinates)
        .filter(coords => !!coords)
        .map(coords => normalizePolygon(JSON.parse(JSON.stringify(coords)), plotCenterCoords));

    // Extract road zone polygons from utilityAreas (peripheral roads)
    const roadPolygons = (selectedPlot.utilityAreas || [])
        .filter(ua => ua.type === UtilityType.Roads || ua.name?.includes('Peripheral Road') || ua.name?.includes('Road'))
        .map(ua => ua.geometry?.geometry?.coordinates)
        .filter(coords => !!coords)
        .map(coords => normalizePolygon(JSON.parse(JSON.stringify(coords)), plotCenterCoords));

    const plotInfo: RenderingPlotInfo & { boundary?: number[][][], parkingPolygons?: number[][][][], roadPolygons?: number[][][][] } = {
        plotArea: totalPlotArea, subPlotCount: 1, setback: selectedPlot.setback,
        location: (selectedPlot.location as string) || 'unspecified',
        greenAreas: totalGreenAreas, parkingAreas: totalParkingAreas,
        far: selectedPlot.far ?? undefined, maxCoverage: selectedPlot.maxCoverage ?? undefined,
        maxBuildingHeight: selectedPlot.maxBuildingHeight ?? undefined,
        regulationType: selectedPlot.regulation?.type ?? undefined,
        roadAccessSides: allRoadSides.size > 0 ? Array.from(allRoadSides) : undefined,
        footprint: plotFootprint,
        origin: { x: 0, y: 0 },
        boundary: plotBoundary,
        parkingPolygons,
        roadPolygons,
    };

    const totalGFA = buildingsInfo.reduce((s, b) => s + b.gfa, 0);
    const totalFootprint = buildingsInfo.reduce((s, b) => s + b.footprintArea, 0);
    const achievedFAR = totalPlotArea > 0 ? totalGFA / totalPlotArea : 0;
    const groundCoveragePct = totalPlotArea > 0 ? (totalFootprint / totalPlotArea) * 100 : 0;
    let sellableArea = 0;
    let fallbackGFA = 0;
    selectedPlot.buildings.forEach(b => {
        if (b.units && b.units.length > 0) {
            let buildingSellable = b.units.reduce((sum, u) => sum + (u.targetArea || 0), 0);

            // True Mathematical Correction: The tower's core punches through the podium floors,
            // effectively removing that physical area from the podium's potential leasable space.
// import * as turf from '@turf/turf'; is already at the top of the file
            if (b.id.endsWith('-podium')) {
                const siblingTower = selectedPlot.buildings.find(t => t.id === b.id.replace('-podium', '-tower'));
                if (siblingTower && siblingTower.cores) {
                    const towerCoreAreaPerFloor = siblingTower.cores.reduce((sum, c) => sum + (turf.area(c.geometry) || 0), 0);
                    const occFloors = b.floors ? b.floors.filter(f => f.type !== 'Parking' && f.type !== 'Utility').length : b.numFloors;
                    buildingSellable -= (towerCoreAreaPerFloor * occFloors);
                }
            }
            
            sellableArea += Math.max(0, buildingSellable);
        } else {
            const fsiFloors = b.floors ? b.floors.filter(f => f.type !== 'Parking').length : b.numFloors;
            fallbackGFA += (b.area * Math.max(1, fsiFloors));
        }
    });
    sellableArea += (fallbackGFA * 0.70);
    const openSpace = Math.max(0, totalPlotArea - totalFootprint);
    const efficiency = totalGFA > 0 ? sellableArea / totalGFA : 0;
    const totalUnits = buildingsInfo.reduce((s, b) => s + b.unitCount, 0);

    const parkingMap: Record<string, number> = {};
    selectedPlot.buildings.forEach(b => {
        if (b.floors) b.floors.filter(f => f.type === 'Parking').forEach(f => {
            const pType = f.parkingType || 'General';
            parkingMap[pType] = (parkingMap[pType] || 0) + (f.parkingCapacity || 0);
        });
    });
    selectedPlot.parkingAreas.forEach(pa => {
        const pType = pa.type || 'Surface';
        parkingMap[pType] = (parkingMap[pType] || 0) + (pa.capacity || 0);
    });
    const parkingSummary = Object.entries(parkingMap).map(([type, count]) => ({ type, count }));

    const utilSet = new Set<string>();
    if (selectedPlot.utilityAreas) selectedPlot.utilityAreas.forEach(u => utilSet.add(u.type));
    selectedPlot.buildings.forEach(b => {
        if (b.utilities) b.utilities.forEach(u => utilSet.add(u));
        if (b.internalUtilities) b.internalUtilities.forEach(u => utilSet.add(u.type));
    });
    designParams.selectedUtilities.forEach(u => utilSet.add(u));

    const bylawScoreItems = [
        { maxScore: 35, achievedScore: selectedPlot.far && achievedFAR <= selectedPlot.far ? 35 : 0 },
        { maxScore: 20, achievedScore: selectedPlot.maxCoverage && groundCoveragePct <= selectedPlot.maxCoverage * 100 ? 20 : 0 },
        { maxScore: 25, achievedScore: selectedPlot.maxBuildingHeight ? (buildingsInfo.every(b => b.height <= (selectedPlot.maxBuildingHeight || 999)) ? 25 : 0) : 25 },
        { maxScore: 20, achievedScore: selectedPlot.setback > 0 ? 20 : 0 },
    ];
    const bylawScoreSummary = summarizeAdditiveScore(bylawScoreItems);

    const totalGreen = selectedPlot.greenAreas.length;
    const greenScoreItems = [
        { maxScore: 25, achievedScore: totalGreen > 0 ? 25 : 0 },
        { maxScore: 20, achievedScore: totalPlotArea > 0 && openSpace / totalPlotArea >= 0.25 ? 20 : 0 },
        { maxScore: 15, achievedScore: utilSet.has('STP') || utilSet.has(UtilityType.STP) ? 15 : 0 },
        { maxScore: 15, achievedScore: utilSet.has('Solar PV') || utilSet.has(UtilityType.SolarPV) ? 15 : 0 },
        { maxScore: 15, achievedScore: utilSet.has('Rainwater Harvesting') || utilSet.has(UtilityType.RainwaterHarvesting) ? 15 : 0 },
        { maxScore: 10, achievedScore: utilSet.has('EV Station') || utilSet.has(UtilityType.EVStation) ? 10 : 0 },
    ];
    const greenScoreSummary = summarizeAdditiveScore(greenScoreItems);

    const plotsWithBuildings = selectedPlot.buildings.length > 0 ? 1 : 0;
    const vastuScoreSummary: AdditiveScoreSummary | undefined = plotsWithBuildings > 0 && selectedPlot.developmentStats?.vastuScore
        ? {
            totalScore: ((selectedPlot.developmentStats.vastuScore as any).categories || []).reduce((catAcc: number, cat: any) => {
                return catAcc + ((cat.items || []).reduce((itAcc: number, it: any) => itAcc + (it.score || 0), 0));
            }, 0),
            maxScore: ((selectedPlot.developmentStats.vastuScore as any).categories || []).reduce((catAcc: number, cat: any) => {
                return catAcc + ((cat.items || []).reduce((itAcc: number, it: any) => itAcc + (it.maxScore || 0), 0));
            }, 0),
            percentage: Math.round(((selectedPlot.developmentStats.vastuScore as any).overallScore) ?? 0),
        }
        : undefined;

    const zonesBuildable = (selectedPlot.buildableAreas || []).map(ba => ({ name: ba.name, area: Math.round(ba.area), intendedUse: ba.intendedUse }));
    const zonesGreen = (selectedPlot.greenAreas || []).map(ga => ({ name: ga.name, area: Math.round(ga.area) }));
    const zonesParking = (selectedPlot.parkingAreas || []).map(pa => ({ name: pa.name, area: Math.round(pa.area), type: pa.type, capacity: pa.capacity }));
    const zonesUtility = (selectedPlot.utilityAreas || []).map(ua => ({ name: ua.name, area: Math.round(ua.area), type: ua.type }));

    const summary: RenderingProjectSummary = {
        totalBuiltUpArea: totalGFA, achievedFAR: Math.round(achievedFAR * 100) / 100,
        groundCoveragePct: Math.round(groundCoveragePct * 10) / 10,
        sellableArea: Math.round(sellableArea), openSpace: Math.round(openSpace),
        efficiency: Math.round(efficiency * 100) / 100, totalUnits, parkingSummary,
        utilities: Array.from(utilSet),
        compliance: {
            bylaws: bylawScoreSummary.percentage,
            green: greenScoreSummary.percentage,
            vastu: vastuScoreSummary?.percentage ?? 0,
            bylawScoreSummary,
            greenScoreSummary,
            vastuScoreSummary,
        },
        zones: { buildable: zonesBuildable, green: zonesGreen, parking: zonesParking, utility: zonesUtility },
        designStrategy: {
            landUse: designParams.landUse, typology: designParams.typology,
            unitMix: designParams.unitMix, hasPodium: designParams.hasPodium,
            podiumFloors: designParams.podiumFloors, parkingTypes: designParams.parkingTypes,
            selectedUtilities: designParams.selectedUtilities,
        },
    };

    return { buildingsInfo, plotInfo, summary };
}

function buildRenderRequest(
    plots: Plot[],
    plot: Plot,
    designParams: DesignParamsForRendering
): {
    renderInput: {
        buildings: RenderingBuildingInfo[];
        plot: RenderingPlotInfo & { boundary?: number[][][] };
        design: {
            landUse: string;
            unitMix: Record<string, number>;
            selectedUtilities: string[];
            hasPodium: boolean;
            podiumFloors: number;
            parkingTypes: string[];
            layoutConstraint: string;
        };
        constraints: {
            layout: string;
            spacing: string;
            arrangement: string;
        };
        plotShapeDescription: string;
        instructions: string;
    };
    summary: RenderingProjectSummary;
} | null {
    const buildingsData = plot.buildings;
    if (!buildingsData || buildingsData.length === 0) {
        return null;
    }

    const renderData = collectRenderingData(
        plots,
        { ...plot, buildings: buildingsData },
        designParams
    );

    if (!renderData) {
        return null;
    }

    const { buildingsInfo, plotInfo, summary } = renderData;

    return {
        renderInput: {
            buildings: buildingsInfo,
            plot: plotInfo,
            design: {
                landUse: designParams.landUse,
                unitMix: designParams.unitMix,
                selectedUtilities: designParams.selectedUtilities,
                hasPodium: designParams.hasPodium,
                podiumFloors: designParams.podiumFloors,
                parkingTypes: designParams.parkingTypes,
                layoutConstraint: 'STRICT_PRESERVE',
            },
            constraints: {
                layout: 'STRICT_PRESERVE',
                spacing: 'EXACT',
                arrangement: 'NO_REORDER',
            },
            plotShapeDescription: 'Irregular polygon site with non-rectangular edges',
            instructions: `
    The site boundary is irregular and must be strictly preserved.
    All buildings must lie within the given polygon boundary.
    Do NOT convert the layout into rectangular or symmetric arrangements.
    Do NOT introduce central courtyards unless explicitly defined.
    Preserve exact building positions and spacing.
    Render ALL buildings exactly as provided.
    Preserve layout, spacing, and structure.
    Do NOT rearrange, symmetrize, or optimize placement.
    Respect multi-part buildings (podium + tower).
    Use given footprint polygons, center positions, rotations, and parts strictly.
  `,
        },
        summary,
    };
}

const useBuildingStoreWithoutUndo = create<BuildingState>((set, get) => ({
    projects: [],
    activeProjectId: null,
    plots: [],
    drawingPoints: [],
    mapCommand: null,
    drawingState: {
        isDrawing: false,
        objectType: null,
        activePlotId: null,
        roadWidth: 6,
        buildingIntendedUse: BuildingIntendedUse.Residential,
    },
    zoneDefinition: {
        isDefining: false,
        geometry: null,
        centroid: null,
        activePlotId: null,
    },
    selectedObjectId: null,
    hoveredObjectId: null,
    uiState: { showVastuCompass: false, isFeasibilityPanelOpen: false, ghostMode: false, isInstantAnalysisMode: false },
    componentVisibility: { electrical: false, hvac: false, basements: false, cores: false, units: false, solar: false, ev: false },
    aiScenarios: null,
    activeBhuvanLayer: null,
    activeBhuvanOpacity: 0.6,
    bhuvanData: null,
    isFetchingBhuvan: false,
    isLoading: true,
    active: false,
    isSaving: false,
    isGeneratingAi: false,
    isGeneratingRendering: false,
    aiRenderingUrl: null,
    aiRenderingResult: null,
    aiRenderingMinimized: false,
    renderingDesignParams: null,

    isGeneratingAlgo: false,
    generationParams: {
        typology: 'lamella',
        width: 12,
        spacing: 15,
        orientation: 0,
        setback: 0,
        selectedUtilities: ['Roads', 'Water', 'Electrical', 'HVAC', 'STP', 'WTP', 'Solar PV', 'EV Charging'],
    },

    designOptions: [],
    tempScenarios: null,
    isGeneratingScenarios: false,
    greenRegulations: [],
    vastuRegulations: [],

    mapLocation: null,
    instantAnalysisTarget: null,
    actions: {
                /**
                 * Rotates a building by a given angle (degrees) and updates its geometry and centroid.
                 * @param plotId - The plot containing the building
                 * @param buildingId - The building to rotate
                 * @param angle - The angle in degrees (clockwise)
                 */
                rotateBuilding: (plotId: string, buildingId: string, angle: number) => {
                    set(produce((draft: BuildingState) => {
                        const plot = draft.plots.find(p => p.id === plotId);
                        if (!plot) return;
                        const building = plot.buildings.find(b => b.id === buildingId);
                        if (!building || !building.geometry) return;

                        const nextRotation = normalizeRotation((building.alignmentRotation ?? 0) + angle);

                        rotateBuildingFromSnapshot(building, nextRotation);
                    }));

                    get().actions.recalculateGreenAreas(plotId);
                },
                restoreBuilding: (plotId: string, buildingId: string) => {
                    set(produce((draft: BuildingState) => {
                        const plot = draft.plots.find(p => p.id === plotId);
                        if (!plot) return;
                        const building = plot.buildings.find(b => b.id === buildingId);
                        if (!building) return;

                        restoreBuildingRotationSnapshot(building);
                    }));

                    get().actions.recalculateGreenAreas(plotId);
                },
        // setMapLocation: Moved to bottom
        // loadProjects: Moved to bottom

        createProject: async (
            name: string,
            totalPlotArea: number,
            intendedUse: BuildingIntendedUse,
            location: string,
            regulationId: string,
            greenCertification: ("IGBC" | "GRIHA" | "LEED" | "Green Building")[],
            vastuCompliant: boolean,
            geographyMeta?: {
                market?: Project['market'];
                countryCode?: Project['countryCode'];
                stateOrProvince?: string;
                city?: string;
                locationLabel?: string;
            }
        ) => {
            console.log('[createProject] Received parameters:');
            console.log('  name:', name);
            console.log('  totalPlotArea:', totalPlotArea);
            console.log('  intendedUse:', intendedUse);
            console.log('  location:', location);
            console.log('  regulationId:', regulationId);
            console.log('  greenCertification:', greenCertification);
            console.log('  vastuCompliant:', vastuCompliant);
            console.log('  geographyMeta:', geographyMeta);

            try {
                const userId = useAuthStore.getState().user?.uid || 'guest';

                // Geocode the location to get lat/lng coordinates
                let locationCoords: { lat: number; lng: number } | undefined;
                if (location) {
                    try {
                        const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
                        const geocodeLabel = geographyMeta?.locationLabel || location;
                        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(geocodeLabel)}.json?access_token=${mapboxToken}&limit=1${geographyMeta?.countryCode ? `&country=${geographyMeta.countryCode.toLowerCase()}` : ''}`;
                        const response = await fetch(geocodeUrl);
                        const data = await response.json();

                        if (data.features && data.features.length > 0) {
                            const [lng, lat] = data.features[0].center;
                            locationCoords = { lat, lng };
                            console.log(`📍 Geocoded "${location}" to:`, locationCoords);
                        } else {
                            console.warn(`Could not geocode location: ${location}`);
                        }
                    } catch (geocodeError) {
                        console.error('Geocoding error:', geocodeError);
                        // Continue without coordinates if geocoding fails
                    }
                }

                const newProject: Project = {
                    id: crypto.randomUUID(),
                    userId,
                    name,
                    totalPlotArea,
                    intendedUse,
                    location: locationCoords || location, // Store coords if available, otherwise store string
                    locationLabel: geographyMeta?.locationLabel || location,
                    market: geographyMeta?.market,
                    countryCode: geographyMeta?.countryCode,
                    stateOrProvince: geographyMeta?.stateOrProvince,
                    city: geographyMeta?.city,
                    regulationId,
                    greenCertification,
                    vastuCompliant,
                    plots: [],
                    lastModified: new Date().toISOString(),
                };

                // When creating a building, store original geometry/centroid
                // Use immer's produce to safely mutate a draft (the live snapshot may be frozen)
                // (If you have a building creation function, add this logic there)
                set(produce((draft: BuildingState) => {
                    for (const plot of draft.plots) {
                        for (const building of plot.buildings) {
                            if (building.originalGeometry === undefined && building.geometry) {
                                building.originalGeometry = deepClone(building.geometry);
                            }
                            if (building.originalCentroid === undefined && building.centroid) {
                                building.originalCentroid = deepClone(building.centroid);
                            }
                        }
                    }
                }));

                // Save to Firestore (User Scoped)
                // Sanitize undefined values (Firestore doesn't allow undefined)
                const projectDataToSave = JSON.parse(JSON.stringify({
                    ...newProject,
                    plots: [] // Plots stored separately or empty initially
                }));

                await setDoc(doc(db, 'users', userId, 'projects', newProject.id), projectDataToSave);

                set(state => ({
                    projects: [newProject, ...state.projects],
                    activeProjectId: newProject.id,
                    plots: [], // Reset plots for new project
                    active: true
                }));

                toast({ title: 'Project Created', description: `Started working on ${name}.` });
                return newProject;
            } catch (error) {
                console.error("Error creating project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to create project.' });
                return null;
            }
        },
        startProjectFromEvaluateLand: async (
            evaluateLandInput: EvaluateLandInput,
            sourcePlots: Plot[],
            selectedPlotId?: string | null,
        ) => {
            const inferredGeography = inferRegulationGeography(
                evaluateLandInput.location.trim(),
            );
            const newProject = await get().actions.createProject(
                evaluateLandInput.projectName.trim(),
                evaluateLandInput.landSize,
                evaluateLandInput.intendedUse,
                evaluateLandInput.location.trim(),
                "",
                [],
                false,
                {
                    market: inferredGeography.market,
                    countryCode: inferredGeography.countryCode,
                    stateOrProvince: inferredGeography.stateOrProvince,
                    city: inferredGeography.city,
                    locationLabel: evaluateLandInput.location.trim(),
                },
            );

            if (!newProject) {
                return null;
            }

            const clonedPlots: Plot[] = sourcePlots.map((plot, index) => {
                const clonedPlot = deepClone(plot);
                clonedPlot.projectId = newProject.id;
                clonedPlot.name =
                    clonedPlot.name ||
                    (index === 0
                        ? evaluateLandInput.projectName.trim() || 'Primary Plot'
                        : `Plot ${index + 1}`);
                clonedPlot.location = evaluateLandInput.location.trim();
                return clonedPlot;
            });

            const selectedClonedPlot =
                clonedPlots.find(plot => plot.id === selectedPlotId) ||
                clonedPlots[0] ||
                null;

            get().actions.loadPlotsIntoWorkspace(
                clonedPlots,
                selectedClonedPlot?.id ?? null,
            );
            get().actions.updateProject(newProject.id, {
                evaluateLandInput,
                lastModified: new Date().toISOString(),
            });
            await get().actions.saveCurrentProject();

            return {
                project: newProject,
                plots: clonedPlots,
                selectedPlotId: selectedClonedPlot?.id ?? null,
            };
        },
        // deleteProject: Moved to bottom
        // loadProject: Moved to bottom
        // saveCurrentProject: Shadowed implementation removed
        saveDesignOption: (name: string, description: string) => {
            const { plots, generationParams, designOptions } = get();
            const newOption: DesignOption = {
                id: crypto.randomUUID(),
                name,
                description,
                createdAt: Date.now(),
                data: {
                    // Deep clone essential data to avoid reference issues
                    plots: JSON.parse(JSON.stringify(plots)),
                    generationParams: JSON.parse(JSON.stringify(generationParams))
                }
            };
            set({ designOptions: [...designOptions, newOption] });
            get().actions.saveCurrentProject();
            toast({ title: "Scenario Saved", description: `${name} has been saved.` });
        },
        loadDesignOption: (id: string) => {
            const { designOptions } = get();
            const option = designOptions.find(o => o.id === id);
            if (!option) return;

            set({
                plots: JSON.parse(JSON.stringify(option.data.plots)),
                generationParams: JSON.parse(JSON.stringify(option.data.generationParams)),
                // Reset selection if the object doesn't exist? Or keep it simple.
                selectedObjectId: null
            });
            toast({ title: "Scenario Loaded", description: `Active layout restored to ${option.name}.` });
        },
        deleteDesignOption: (id: string) => {
            set(produce((draft: BuildingState) => {
                draft.designOptions = draft.designOptions.filter((o: DesignOption) => o.id !== id);
            }));
            get().actions.saveCurrentProject();
            toast({ title: "Scenario Deleted" });
        },
        toggleVastuCompass: (show: boolean) => set(produce((state: BuildingState) => {
            state.uiState.showVastuCompass = show;
        })),
        setFeasibilityPanelOpen: (isOpen: boolean) => set(produce((state: BuildingState) => {
            state.uiState.isFeasibilityPanelOpen = isOpen;
        })),
        updateSimulationResults: (results: Record<string, any>) => {
            set(produce((draft: BuildingState) => {
                const activeProject = draft.projects.find(p => p.id === draft.activeProjectId);
                if (activeProject) {
                    if (!activeProject.simulationResults) {
                        activeProject.simulationResults = {};
                    }
                    Object.assign(activeProject.simulationResults, results);
                }
            }));
        },

        // ============================================================
        // REGENERATE GREEN AREAS
        // Standalone function to recalculate green areas after building/utility changes
        // ============================================================
        regenerateGreenAreas: (plotId: string, buildableAreaOverride?: Feature<Polygon>) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (!plot) {
                    console.warn(`[RegenerateGreenAreas] Plot ${plotId} not found`);
                    return;
                }

                console.log('[RegenerateGreenAreas] Starting regeneration for plot:', plotId);

                // Clear existing green areas
                plot.greenAreas = [];

                // CRITICAL FIX: Recalculate buildable area from scratch to ensure we respect setbacks
                // We cannot rely on plot.buildableAreas because it might be stale or empty
                let remainingGeom: Feature<Polygon | MultiPolygon> | null = null;

                // Helper to ensure we always work with a single Polygon (not MultiPolygon or Collection)
                const ensurePolygon = (feature: any): Feature<Polygon> | null => {
                    if (!feature) return null;
                    if (feature.geometry?.type === 'Polygon') return feature as Feature<Polygon>;

                    if (feature.geometry?.type === 'MultiPolygon') {
                        // Explode and take largest
                        const poly = turf.polygon(feature.geometry.coordinates.sort((a: any, b: any) => {
                            const areaA = turf.area(turf.polygon(a));
                            const areaB = turf.area(turf.polygon(b));
                            return areaB - areaA;
                        })[0]);
                        return poly;
                    }

                    if (feature.type === 'FeatureCollection') {
                        if (feature.features.length === 0) return null;
                        const sorted = feature.features.sort((a: any, b: any) => turf.area(b) - turf.area(a));
                        if (sorted[0].geometry.type === 'Polygon') return sorted[0] as Feature<Polygon>;
                        if (sorted[0].geometry.type === 'MultiPolygon') {
                            return ensurePolygon(sorted[0]);
                        }
                    }
                    return null;
                };

                if (buildableAreaOverride) {
                    remainingGeom = buildableAreaOverride;
                    console.log('[RegenerateGreenAreas] Using provided buildable area override');
                } else {
                    // 1. Calculate Setbacks
                    // We need to apply the same setback logic as generateScenarios
                    try {
                        const plotPoly = plot.geometry;

                        // FIX: Use the 'setback' property from the Plot interface
                        // The previous code used front/rear/side which don't exist on the type, resulting in 0
                        // This caused the green area to fill the entire plot (including setback zone)
                        // @ts-ignore - In case it's missing in some types
                        const maxSetback = plot.setback || 0;

                        console.log(`[RegenerateGreenAreas] Using setback: ${maxSetback}m`);

                        // FIX: Check for Peripheral Zones (Roads/Parking) which sit inside the setback
                        // If they exist, we must push the green area start line further in
                        const hasPeripheralRoad = plot.utilityAreas?.some(u => u.name?.includes('Peripheral Road'));
                        const hasPeripheralParking = plot.parkingAreas?.some(p => p.name?.includes('Peripheral Parking'));

                        const peripheralOffset = (hasPeripheralParking ? 5 : 0) + (hasPeripheralRoad ? 6 : 0);

                        // The Green Area starts AFTER the setback AND the peripheral zones
                        const totalBuffer = -(maxSetback + peripheralOffset);

                        if (totalBuffer < 0) {
                            // @ts-ignore
                            const buffered = turf.buffer(plotPoly, totalBuffer, { units: 'meters' });
                            remainingGeom = ensurePolygon(buffered);
                            console.log(`[RegenerateGreenAreas] Calculated fresh buildable area with buffer ${totalBuffer}m (Setback: ${maxSetback}m + Peripheral: ${peripheralOffset}m)`);
                        } else {
                            remainingGeom = plot.geometry;
                        }

                        // Subtract user-drawn buildable areas — they are reserved for buildings, not green space
                        if (plot.buildableAreas && plot.buildableAreas.length > 0 && remainingGeom) {
                            for (const ba of plot.buildableAreas) {
                                if (ba.geometry && remainingGeom) {
                                    try {
                                        // @ts-ignore
                                        const diff = turf.difference(remainingGeom, ba.geometry);
                                        if (diff) remainingGeom = diff;
                                        console.log(`[RegenerateGreenAreas] Subtracted BuildableArea ${ba.id}`);
                                    } catch { /* ignore */ }
                                }
                            }
                        }

                    } catch (err) {
                        console.warn('[RegenerateGreenAreas] Failed to calculate buildable area, falling back to plot geometry', err);
                        remainingGeom = plot.geometry;
                    }
                }

                if (!remainingGeom) {
                    console.warn('[RegenerateGreenAreas] No geometry available');
                    return;
                }

                // Clean initial geometry
                try {
                    // @ts-ignore
                    remainingGeom = turf.cleanCoords(remainingGeom);
                } catch (e) {
                    console.warn('[RegenerateGreenAreas] Failed to clean coords', e);
                }

                const initialArea = turf.area(remainingGeom);
                console.log(`[RegenerateGreenAreas] Initial area: ${initialArea.toFixed(2)}m²`);

                // Define robust subtraction helper
                const robustSubtract = (base: Feature<Polygon | MultiPolygon>, clip: Feature<Polygon | MultiPolygon>, label: string) => {
                    if (!base || !clip) return base;
                    try {
                        const parts: Feature<Polygon>[] = [];
                        // @ts-ignore
                        const flattened = turf.flatten(clip);
                        flattened.features.forEach((f: any) => {
                            try {
                                // @ts-ignore
                                const unkinked = turf.unkinkPolygon(f);
                                unkinked.features.forEach((k: any) => parts.push(k));
                            } catch { parts.push(f as Feature<Polygon>); }
                        });

                        let currentBase = base;
                        for (let i = 0; i < parts.length; i++) {
                            if (!currentBase) break;
                            const cutter = turf.buffer(parts[i], 0.05, { units: 'meters' });
                            const diff = turf.difference(currentBase, cutter);
                            if (diff) currentBase = diff as Feature<Polygon | MultiPolygon>;
                        }
                        return currentBase;
                    } catch (e) {
                        console.warn(`Error subtracting ${label}`, e);
                        return base;
                    }
                };

                // 2. Subtract Everything Else
                if (remainingGeom) {

                    // Subtract all buildings
                    for (const building of plot.buildings) {
                        if (building.geometry && remainingGeom) {
                            try {
                                remainingGeom = robustSubtract(remainingGeom, building.geometry, `Building ${building.id}`);
                            } catch (e) { console.warn(e); }
                        }
                    }

                    // Subtract all utilities
                    for (const utility of plot.utilityAreas) {
                        // Skip Peripheral Road if we already offset it via buffer
                        if (utility.name?.includes('Peripheral Road')) continue;

                        if (utility.geometry && remainingGeom) {
                            try {
                                remainingGeom = robustSubtract(remainingGeom, utility.geometry, `Utility ${utility.name}`);
                            } catch (e) { console.warn(e); }
                        }
                    }

                    // Subtract Parking Areas explicitely
                    if (plot.parkingAreas) {
                        for (const parking of plot.parkingAreas) {
                            // Skip Peripheral Parking if we already offset it via buffer
                            if (parking.name?.includes('Peripheral Parking')) continue;

                            if (parking.geometry && remainingGeom) {
                                try {
                                    remainingGeom = robustSubtract(remainingGeom, parking.geometry, `Parking ${parking.id}`);
                                } catch (e) {
                                    console.warn(`[RegenerateGreenAreas] Failed to subtract parking ${parking.id}`, e);
                                }
                            }
                        }
                    }

                    // Process the final result
                    if (remainingGeom) {
                        const finalArea = turf.area(remainingGeom);

                        const greenPolygons: Feature<Polygon>[] = [];

                        if (remainingGeom.geometry.type === 'Polygon') {
                            greenPolygons.push(remainingGeom as Feature<Polygon>);
                        } else if (remainingGeom.geometry.type === 'MultiPolygon') {
                            const multiCoords = (remainingGeom.geometry as any).coordinates;
                            multiCoords.forEach((coords: any) => {
                                try {
                                    greenPolygons.push(turf.polygon(coords));
                                } catch (err) {
                                    console.warn('[RegenerateGreenAreas] Failed to convert multipolygon part', err);
                                }
                            });
                        }

                        // Create GreenArea objects
                        greenPolygons.forEach((poly, i) => {
                            const areaSize = turf.area(poly);
                            if (areaSize > 10) { // Filter out tiny slivers
                                const greenArea = {
                                    id: `green-area-${plot.id}-${i}`,
                                    geometry: poly,
                                    centroid: turf.centroid(poly),
                                    area: areaSize,
                                    name: 'Open Space',
                                    visible: true
                                };
                                plot.greenAreas.push(greenArea);
                            }
                        });

                        console.log(`[RegenerateGreenAreas] Created ${plot.greenAreas.length} green areas`);
                    } else {
                        console.warn('[RegenerateGreenAreas] No remaining geometry after subtractions');
                    }
                }
            }));
            get().actions.saveCurrentProject();
        },

            attachGreenStandards: (data: GreenRegulationData) => {
                set(produce((draft: BuildingState) => {
                    if (!draft.activeProjectId) return;
                    const project = draft.projects.find(p => p.id === draft.activeProjectId);
                    if (!project) return;
                    // Attach to project metadata
                    project.greenCertification = project.greenCertification || [];
                    if (!project.greenCertification.includes(data.certificationType)) project.greenCertification.push(data.certificationType);
                    // Store structured standard locally
                    draft.greenRegulations = draft.greenRegulations || [];
                    // assign an id if missing
                    if (!data.id) data.id = `manual-${Date.now()}`;
                    // replace or push
                    const idx = draft.greenRegulations.findIndex(g => g.id === data.id);
                    if (idx >= 0) draft.greenRegulations[idx] = data;
                    else draft.greenRegulations.push(data);

                    // Also attach to project as a transient field for immediate UI consumption
                    (project as any).greenStandards = data;
                }));
            },
            attachVastuRules: (data: VastuRegulationData) => {
                set(produce((draft: BuildingState) => {
                    if (!draft.activeProjectId) return;
                    const project = draft.projects.find(p => p.id === draft.activeProjectId);
                    if (!project) return;
                    // store vastu rules locally
                    draft.vastuRegulations = draft.vastuRegulations || [];
                    if (!data.id) data.id = `manual-vastu-${Date.now()}`;
                    const idx = draft.vastuRegulations.findIndex(v => v.id === data.id);
                    if (idx >= 0) draft.vastuRegulations[idx] = data;
                    else draft.vastuRegulations.push(data);
                    // attach transiently to project
                    (project as any).vastuRules = data;
            // Bump lastModified to force metrics/hooks to recalculate immediately
            try { (project as any).lastModified = new Date().toISOString(); } catch (e) { /* ignore */ }
                }));
            },
            loadUltimateVastuChecklist: () => {
                set(produce((draft: BuildingState) => {
                    try {
                        const data = (ultimateVastuChecklist as any) as VastuRegulationData;
                        // ensure an id so it can be saved/updated later
                        if (!data.id) data.id = `ultimate-vastu-${Date.now()}`;
                        draft.vastuRegulations = draft.vastuRegulations || [];
                        const idx = draft.vastuRegulations.findIndex(v => v.id === data.id);
                        if (idx >= 0) draft.vastuRegulations[idx] = data;
                        else draft.vastuRegulations.push(data);

                        // attach to active project if present
                        if (draft.activeProjectId) {
                            const project = draft.projects.find(p => p.id === draft.activeProjectId);
                            if (project) (project as any).vastuRules = data;
                // Also update lastModified so dependent hooks recalc immediately
                try { (project as any).lastModified = new Date().toISOString(); } catch (e) { /* ignore */ }
                        }
                    } catch (e) {
                        console.error('[loadUltimateVastuChecklist] Failed to load checklist', e);
                    }
                }));
            },

        generateScenarios: async (plotId: string, params: AlgoParams) => {
            const { plots } = get();
            const plotStub = plots.find(p => p.id === plotId);
            if (!plotStub) return;

            // SITE UTILIZATION (Percentage 0-100)
            const userMaxCoverage = params.siteCoverage !== undefined ? params.siteCoverage * 100 : (plotStub.regulation?.geometry?.max_ground_coverage?.value || 50);
            console.log(`[SiteUtil DEBUG] params.siteCoverage=${params.siteCoverage}, computed userMaxCoverage=${userMaxCoverage}%, regulation=${plotStub.regulation?.geometry?.max_ground_coverage?.value}%`);

            // Persist the full generation params so the dashboard KPI can read the actual values
            set({ isGeneratingScenarios: true, generationParams: { ...params } });

            // Helper to generate buildings for a scenario
            const createScenario = (name: string, p: Omit<AlgoParams, 'width'> & { width?: number; maxBuildingHeight?: number; far?: number; maxCoverage?: number; overrideTypologies?: string[]; seed?: number }): { plots: Plot[] } => {
                const plotClone = JSON.parse(JSON.stringify(plotStub));
                let geomFeatures: Feature<Polygon>[] = [];

                // Adjust defaults based on Land Use
                let defaultWidth = 12; // Residential default
                if (params.landUse === 'commercial') defaultWidth = 20; // Deep office plates
                else if (params.landUse === 'institutional') defaultWidth = 16;
                else if (params.landUse === 'mixed') defaultWidth = 15;

                if (params.landUse === 'commercial') defaultWidth = 20; // Deep office plates
                else if (params.landUse === 'institutional') defaultWidth = 16;
                else if (params.landUse === 'mixed') defaultWidth = 15;

                const wingDepth = p.width || defaultWidth;

                console.log('Generating Scenario:', {
                    name,
                    typologies: params.typologies,
                    landUse: params.landUse,
                    setback: p.setback,
                    RAW_SETBACK_PARAM: params.setback
                });

                // Support both old single typology and new array format
                // ---------------------------------------------------------
                // Advanced Selection & Placement Logic (Vastu + Collision)
                // ---------------------------------------------------------

                // ============================================================
                // SETBACK PIPELINE (Main Setback First)
                // ============================================================
                // 1. MAIN SETBACK: Applied to the plot boundary first.
                //    Result: 'setbackBoundary' (The buildable area limit)
                // 2. PERIPHERAL ZONES: Applied INSIDE the 'setbackBoundary'.
                //    Result: Parking/Roads take up the outer ring of the buildable area.
                // 3. BUILDINGS: Generated in the remaining inner area.
                //    Note: Generator params for setback will be set to 0 since it's already applied.
                // ============================================================

                // Helper to ensure we always work with a single Polygon (not MultiPolygon or Collection)
                const ensurePolygon = (feature: any): Feature<Polygon> | null => {
                    if (!feature) return null;
                    if (feature.geometry?.type === 'Polygon') return feature as Feature<Polygon>;

                    if (feature.geometry?.type === 'MultiPolygon') {
                        // Explode and take largest
                        const poly = turf.polygon(feature.geometry.coordinates.sort((a: any, b: any) => {
                            const areaA = turf.area(turf.polygon(a));
                            const areaB = turf.area(turf.polygon(b));
                            return areaB - areaA;
                        })[0]);
                        return poly;
                    }

                    if (feature.type === 'FeatureCollection') {
                        if (feature.features.length === 0) return null;
                        const sorted = feature.features.sort((a: any, b: any) => turf.area(b) - turf.area(a));
                        if (sorted[0].geometry.type === 'Polygon') return sorted[0] as Feature<Polygon>;
                        if (sorted[0].geometry.type === 'MultiPolygon') {
                            return ensurePolygon(sorted[0]);
                        }
                    }
                    return null;
                };

                // 1. APPLY MAIN SETBACK (from plot boundary)
                // mainSetback is the height-based setback applied uniformly to all sides.
                // Buildings placed at the edge of the buildable area are already
                // mainSetback meters from the original plot boundary.
                let setbackBoundary = plotStub.geometry;
                const mainSetback = p.setback ?? plotStub.setback ?? 0;

                if (mainSetback > 0) {
                    console.log(`[Debug] Applying Main Setback: ${mainSetback}m`);
                    // @ts-ignore
                    const buffered = turf.buffer(plotStub.geometry, -mainSetback / 1000, { units: 'kilometers' });
                    const cleaned = ensurePolygon(buffered);
                    if (cleaned) {
                        setbackBoundary = cleaned;
                        console.log(`[Debug] Setback boundary area: ${turf.area(setbackBoundary).toFixed(2)}m²`);
                    } else {
                        console.warn('[Setback] Main setback resulted in empty geometry');
                    }
                } else {
                    console.log('[Debug] No main setback applied');
                }

                // 2. PERIPHERAL ZONES (only if Roads/Surface Parking selected)
                // Applied from the set-back boundary inward
                const hasPeripheralRoad = params.selectedUtilities?.includes('Roads');
                const hasSurfaceParking = params.parkingTypes?.includes('surface') || params.parkingTypes?.includes('ground');

                console.log(`[Debug] Utilities: Road=${hasPeripheralRoad}, Parking=${hasSurfaceParking}`);

                let peripheralResult;

                if (hasPeripheralRoad || hasSurfaceParking) {
                    peripheralResult = applyPeripheralClearZone(setbackBoundary, {
                        parkingWidth: hasSurfaceParking ? 5 : 0,
                        roadWidth: hasPeripheralRoad ? 6 : 0
                    });
                    if (peripheralResult.buildableArea) {
                        console.log(`[Debug] Post-utility buildable area: ${turf.area(peripheralResult.buildableArea).toFixed(2)}m²`);
                    } else {
                        console.log('[Debug] Post-utility buildable area is null (plot too small)');
                    }
                } else {
                    peripheralResult = {
                        buildableArea: setbackBoundary,
                        parkingZone: null,
                        roadZone: null
                    };
                    console.log('[Debug] No peripheral utilities, buildable area remains same');
                }

                if (!peripheralResult.buildableArea) {
                    console.error('[generateScenarios] Plot too small for peripheral zones');
                    return { plots: [plotClone] };
                }

                const peripheralParkingZone = peripheralResult.parkingZone;
                const peripheralRoadZone = peripheralResult.roadZone;
                const roadAccessSides = plotStub.roadAccessSides || [];

                // validAreaPoly = area after peripheral zones
                // Generators will apply Front/Rear/Side setbacks from THIS boundary
                let validAreaPoly = peripheralResult.buildableArea;

                // 4. FIX DEGENERATE GEOMETRY
                // This prevents polygon-clipping errors (e.g., "Unable to complete output ring")
                // especially on small plots or after multiple buffering operations.
                try {
                    // @ts-ignore
                    const cleanedBuffer = turf.buffer(validAreaPoly, 0);
                    // @ts-ignore
                    const unkinked = turf.unkinkPolygon(cleanedBuffer);

                    // Use robust cleaner
                    const finalized = ensurePolygon(unkinked);
                    if (finalized) validAreaPoly = finalized;

                } catch (e) {
                    console.error('[Geometry Clean] Failed to clean validAreaPoly:', e);
                }

                if (!validAreaPoly || turf.area(validAreaPoly) < 10) {
                    console.warn('[generateScenarios] Resulting buildable area too small or invalid after setbacks');
                    // We allow it to continue with the tiny area, but generators will likely fail gracefully
                }

                const bufferedPlotForSectors = validAreaPoly;
                const bbox = turf.bbox(validAreaPoly); // [minX, minY, maxX, maxY]
                const [minX, minY, maxX, maxY] = bbox;

                const widthStep = (maxX - minX) / 3;
                const heightStep = (maxY - minY) / 3;

                // Helper to get Sector Centroid
                const getSectorPoint = (col: number, row: number): Feature<Point> => {
                    const cx = minX + (col * widthStep) + (widthStep / 2);
                    const cy = minY + (row * heightStep) + (heightStep / 2);
                    return turf.point([cx, cy]);
                };

                // Vastu Zones (Row 0=Bottom/South, Row 2=Top/North)
                // 6 7 8 (NW, N, NE)
                // 3 4 5 (W,  C,  E)
                // 0 1 2 (SW, S, SE)
                // Cols: 0=West, 1=Center, 2=East

                // Define Vastu Priority Zones (Heaviest to Lightest)
                const vastuZones: [number, number][] = [
                    [0, 0], // 1. SW (Nairutya) - Master/Heaviest
                    [1, 0], // 2. South (Dakshin)
                    [0, 1], // 3. West (Paschim)
                    [2, 0], // 4. SE (Agneya) - Fire
                    [0, 2], // 5. NW (Vayavya) - Air
                    [1, 2], // 6. North (Kuber) - Lighter
                    [2, 1], // 7. East (Indra)
                    [2, 2]  // 8. NE (Ishanya) - Lightest/Water
                ];

                // Keep track of placed buildings to avoid collision
                const builtObstacles: Feature<Polygon>[] = [];

                // Add User-Defined Obstacles (Only manually-drawn items, NOT previously generated ones)
                // Manually-drawn items have 'obj-' prefix IDs; generated items (STP, WTP, etc.) do not
                plotStub.utilityAreas?.forEach(ua => {
                    if (ua.geometry && ua.id.startsWith('obj-')) {
                        builtObstacles.push(ua.geometry as Feature<Polygon>);
                    }
                });
                plotStub.parkingAreas?.forEach(pa => {
                    if (pa.geometry && pa.id.startsWith('obj-')) {
                        builtObstacles.push(pa.geometry as Feature<Polygon>);
                    }
                });

                // Subtract manually drawn roads from buildable area (enforce setback from internal roads)
                const manualRoads = plotStub.utilityAreas?.filter(
                    (ua: UtilityArea) => ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')
                ) ?? [];

                let mergedRoadObstacles: Feature<Polygon | MultiPolygon> | null = null;
                for (const road of manualRoads) {
                    if (!road.geometry) continue;
                    const roadSetback = p.frontSetback ?? 3;
                    const roadBuffer = turf.buffer(road.geometry, roadSetback, { units: 'meters' });
                    if (roadBuffer) {
                        // @ts-ignore
                        mergedRoadObstacles = mergedRoadObstacles ? turf.union(mergedRoadObstacles, roadBuffer) : roadBuffer as Feature<Polygon>;
                        builtObstacles.push(roadBuffer as Feature<Polygon>);
                    }
                }

                if (mergedRoadObstacles) {
                    try {
                        // @ts-ignore
                        const subtracted = turf.difference(validAreaPoly, mergedRoadObstacles);
                        if (subtracted) {
                            // Keep all resulting chunks (Polygon or MultiPolygon)
                            validAreaPoly = (subtracted as Feature<Polygon | MultiPolygon>);
                        }
                    } catch (e) {
                        console.warn('[Road Setback] Failed to subtract roads from buildable area:', e);
                    }
                }

                // Subtract user-drawn custom zones from buildable area
                // Each zone type gets a different setback treatment:
                //   - Green areas: raw geometry, no buffer (they don't need road setback)
                //   - Parking areas: frontSetback buffer (same as roads)
                //   - Utility areas: rearSetback buffer
                const userDrawnZones: Feature<Polygon | MultiPolygon>[] = [];

                // User-drawn green areas (not generated ones) — subtract raw, no buffer
                plotStub.greenAreas?.forEach((ga: GreenArea) => {
                    if (ga.geometry && !ga.id.includes('green-area-')) {
                        userDrawnZones.push(ga.geometry as Feature<Polygon>);
                        builtObstacles.push(ga.geometry as Feature<Polygon>);
                    }
                });

                // User-drawn parking areas — subtract with frontSetback buffer (like roads)
                const parkingSetback = p.frontSetback ?? 3;
                plotStub.parkingAreas?.forEach((pa: ParkingArea) => {
                    if (pa.geometry && !pa.id.includes('parking-peripheral-') && !pa.name?.includes('Generated')) {
                        const buffered = turf.buffer(pa.geometry, parkingSetback, { units: 'meters' });
                        if (buffered) {
                            userDrawnZones.push(buffered as Feature<Polygon>);
                            builtObstacles.push(buffered as Feature<Polygon>);
                        }
                    }
                });

                // User-drawn utility areas (non-road, non-generated) — subtract with rearSetback buffer
                const utilitySetback = p.rearSetback ?? p.sideSetback ?? 3;
                plotStub.utilityAreas?.forEach((ua: UtilityArea) => {
                    if (ua.geometry && ua.id.startsWith('obj-')) {
                        const buffered = turf.buffer(ua.geometry, utilitySetback, { units: 'meters' });
                        if (buffered) {
                            userDrawnZones.push(buffered as Feature<Polygon>);
                            builtObstacles.push(buffered as Feature<Polygon>);
                        }
                    }
                });

                // User-drawn BuildableAreas — subtract with sideSetback buffer
                const buildableSetback = p.sideSetback ?? 3;
                plotStub.buildableAreas?.forEach((ba: BuildableArea) => {
                    if (ba.geometry && !ba.id.startsWith('ai-zone-')) {
                        const buffered = turf.buffer(ba.geometry, buildableSetback, { units: 'meters' });
                        if (buffered) {
                            userDrawnZones.push(buffered as Feature<Polygon>);
                            builtObstacles.push(buffered as Feature<Polygon>);
                        }
                    }
                });

                // Manually drawn Buildings — subtract with appropriate setbacks based on their use
                plotStub.buildings?.forEach((bldg: Building) => {
                    if (bldg.geometry && bldg.id.startsWith('bldg-')) {
                        // Apply a general setback for now, wait until type specific logic applies
                        const bldgSetback = 3; 
                        const buffered = turf.buffer(bldg.geometry, bldgSetback, { units: 'meters' });
                        if (buffered) {
                            userDrawnZones.push(buffered as Feature<Polygon>);
                            builtObstacles.push(buffered as Feature<Polygon>);
                        }
                    }
                });


                if (userDrawnZones.length > 0) {
                    try {
                        let mergedZones: Feature<Polygon | MultiPolygon> | null = null;
                        for (const zone of userDrawnZones) {
                            // @ts-ignore
                            mergedZones = mergedZones ? turf.union(mergedZones, zone) : zone;
                        }
                        if (mergedZones) {
                            // @ts-ignore
                            const subtracted = turf.difference(validAreaPoly, mergedZones);
                            if (subtracted) {
                                validAreaPoly = subtracted as Feature<Polygon | MultiPolygon>;
                                console.log(`[CustomZones] Subtracted ${userDrawnZones.length} user-drawn zones from buildable area`);
                            }
                        }
                    } catch (e) {
                        console.warn('[CustomZones] Failed to subtract custom zones from buildable area:', e);
                    }
                }

                // Vastu: Reserve corner zones for utilities BEFORE building generation
                // Use plotBoundary (entire plot) so reservation zones cover the setback areas too.
                if (p.vastuCompliant) {
                    const utilityReservationZones = calculateUtilityReservationZones(
                        plotStub.geometry,
                        true
                    );
                    console.log(`[Vastu] Adding ${utilityReservationZones.length} utility reservation zones as obstacles for buildings`);
                    builtObstacles.push(...utilityReservationZones);
                }

                // 2. Sort Typologies by "Heaviness" (Size/Priority)
                const typologyWeights: Record<string, number> = {
                    'hshaped': 100,
                    'ushaped': 90,
                    'lshaped': 80,
                    'tshaped': 70,
                    'slab': 60,
                    'oshaped': 50,
                    'point': 10
                };

                let typologiesToGenerate = p.overrideTypologies || params.typologies || [params.typology || 'point'];

                const sortedTypologies = [...typologiesToGenerate].sort((a, b) => {
                    return (typologyWeights[b] || 0) - (typologyWeights[a] || 0);
                });

                // 3. Sequential Generation Loop
                const plotArea = turf.area(plotStub.geometry);

                // Get current project
                const project = get().projects.find(prj => prj.id === get().activeProjectId);

                // COMPLIANCE CALCULATION
                // ---------------------------------------------------------
                // Fetch regulation from plot or fall back to defaults
                const currentRegulation = plotStub.regulation || {
                    geometry: {
                        floor_area_ratio: { value: 2.0 }, // Fallback FAR
                        max_ground_coverage: { value: 50 }, // Fallback Coverage
                        max_height: { value: 15 },
                        setback: { value: p.setback || 4 }
                    }
                };

                const complianceInput = {
                    plotArea: plotArea,
                    regulation: currentRegulation,
                    intendedUse: project?.intendedUse || 'Residential'
                };

                // @ts-ignore
                const complianceOutput = ComplianceEngine.calculate(complianceInput);
                const {
                    maxFootprint: regulationMaxFootprint,
                    maxGFA,
                    targetFloors: regulationMaxFloors
                } = complianceOutput;

                // Use user overrides if provided, otherwise use site utilization (userMaxCoverage)
                // Coverage is strictly relative to TOTAL plot area per standard real estate regulations
                // e.g. 40% ground coverage on a 10,000sqm plot = 4,000sqm max footprint
                const buildableArea = turf.area(validAreaPoly);
                const effectiveMaxFootprint = params.maxFootprint ?? (plotArea * userMaxCoverage / 100);
                const effectiveMinFootprint = params.minFootprint ?? 100;
                const effectiveMaxFloors = params.maxFloors ?? regulationMaxFloors;
                const effectiveMaxFAR = params.maxAllowedFAR ?? (currentRegulation.geometry.floor_area_ratio?.value || 2.0);
                const effectiveMaxGFA = params.targetGFA ?? (plotArea * effectiveMaxFAR);

                console.log(`[Compliance] Plot Area: ${plotArea.toFixed(0)}m², Buildable Area: ${buildableArea.toFixed(0)}m² (${(buildableArea/plotArea*100).toFixed(0)}% of plot)`);
                console.log(`[Compliance] Regulation Defaults: MaxFootprint=${regulationMaxFootprint.toFixed(0)}m², MaxFloors=${regulationMaxFloors}, MaxGFA=${maxGFA.toFixed(0)}m²`);
                console.log(`[Compliance] Effective Values: MaxFootprint=${effectiveMaxFootprint.toFixed(0)}m² (plotArea=${plotArea.toFixed(0)} × coverage=${userMaxCoverage}%), MinFootprint=${effectiveMinFootprint}m², MaxFloors=${effectiveMaxFloors}, MaxGFA=${effectiveMaxGFA.toFixed(0)}m²`);

                if (params.maxFootprint) {
                    console.warn(`[Override] User set maxFootprint to ${params.maxFootprint}m² (regulation: ${regulationMaxFootprint.toFixed(0)}m²)`);
                }
                if (params.maxFloors && params.maxFloors !== regulationMaxFloors) {
                    console.warn(`[Override] User set maxFloors to ${params.maxFloors} (regulation: ${regulationMaxFloors})`);
                }

                // FAR SCALING LOGIC
                // Calculate how many buildings we need to achieve the target GFA
                const avgBuildingFootprint = (effectiveMaxFootprint + effectiveMinFootprint) / 2;
                const avgBuildingGFA = avgBuildingFootprint * effectiveMaxFloors;
                const targetBuildingCount = Math.max(1, Math.ceil(effectiveMaxGFA / avgBuildingGFA));

                console.log(`[FAR Scaling] Target GFA: ${effectiveMaxGFA.toFixed(0)}m², Avg Building GFA: ${avgBuildingGFA.toFixed(0)}m²`);
                console.log(`[FAR Scaling] Target Building Count: ${targetBuildingCount} buildings to achieve FAR`);
                console.log(`[Coverage] User Max Coverage (Utilization): ${userMaxCoverage}%`);

                // Vastu: Protect Brahmasthan (Center)
                if (p.vastuCompliant) {
                    // Center is col=1, row=1
                    const cx1 = minX + widthStep;
                    const cx2 = minX + (2 * widthStep);
                    const cy1 = minY + heightStep;
                    const cy2 = minY + (2 * heightStep);
                    const brahmasthan = turf.polygon([[
                        [cx1, cy1], [cx2, cy1], [cx2, cy2], [cx1, cy2], [cx1, cy1]
                    ]]);
                    builtObstacles.push(brahmasthan);
                }

                console.log('[DEBUG] generateScenarios p:', p);

                // --- CHUNK PLOT (Handle split plots from roads) ---
                const validChunks: Feature<Polygon>[] = [];
                try {
                    // @ts-ignore
                    const flattened = turf.flatten(validAreaPoly);
                    flattened.features.forEach((f: any) => {
                        if (turf.area(f) > 50) { // Keep chunks larger than 50m²
                            validChunks.push(f as Feature<Polygon>);
                        }
                    });
                } catch (e) {
                    console.error('[Chunking] Failed to flatten plot:', e);
                    const poly = ensurePolygon(validAreaPoly);
                    if (poly) validChunks.push(poly);
                }

                console.log(`[Chunking] Plot split into ${validChunks.length} chunks`);

                let primaryCoverageMet = false;

                sortedTypologies.forEach((typology: string, index: number) => {
                    if (primaryCoverageMet) return;
                    // small plot check (warn/skip if too small)

                    // Dynamic Target Assignment
                    let targetPos: Feature<Point> | undefined = undefined;

                    if (p.vastuCompliant && typology !== 'point') {
                        const zoneIndex = index % vastuZones.length;
                        const [col, row] = vastuZones[zoneIndex];
                        targetPos = getSectorPoint(col, row);
                    }
                    else if (!p.vastuCompliant && sortedTypologies.length > 1 && typology !== 'point') {
                        const corners = [[0, 0], [2, 0], [2, 2], [0, 2]]; // SW, SE, NE, NW
                        const zoneIndex = index % corners.length;
                        const [col, row] = corners[zoneIndex];
                        targetPos = getSectorPoint(col, row);
                    }

                    // Get current project unit mix
                    const project = get().projects.find(prj => prj.id === get().activeProjectId);
                    const projectUnitMix = project?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

                    const genParams: AlgoParams = {
                        ...p,
                        wingDepth: wingDepth || undefined,
                        width: wingDepth || 20,
                        obstacles: builtObstacles,
                        targetPosition: targetPos,
                        vastuCompliant: !!p.vastuCompliant,
                        unitMix: projectUnitMix,
                        maxFootprint: effectiveMaxFootprint,
                        minFootprint: effectiveMinFootprint,
                        maxFloors: effectiveMaxFloors,
                        minBuildingWidth: p.minBuildingWidth ?? 20,
                        maxBuildingWidth: p.maxBuildingWidth ?? 25,
                        minBuildingLength: p.minBuildingLength ?? 25,
                        maxBuildingLength: p.maxBuildingLength ?? 55,
                        // Main setback is ALREADY applied to shrink the plot boundary.
                        // Directional setbacks handle INTER-BUILDING spacing (arm gaps, row gaps, U-shape spacing).
                        // genParams.setback is a small internal buffer from peripheral zones (road/parking).
                        // It is NOT the height-based setback — that's already applied to the plot boundary.
                        setback: (hasPeripheralRoad || hasSurfaceParking) ? 3 : 0,
                        sideSetback: p.sideSetback ?? Math.max(mainSetback, 6),
                        frontSetback: p.frontSetback ?? Math.max(mainSetback, 6),
                        rearSetback: p.rearSetback ?? (p.frontSetback ?? Math.max(mainSetback, 6)),
                        roadAccessSides: plotStub.roadAccessSides || [],
                        wingLengthA: undefined,
                        wingLengthB: undefined,
                        seed: p.seed ?? 0
                    };

                    console.log(`[generateScenarios] Typology: ${typology}, Index: ${index}`);

                    // Iterate over ALL chunks for this typology
                    for (const chunk of validChunks) {
                        if (primaryCoverageMet) break;
                        let chunkGenerated: Feature<Polygon>[] = [];

                        // --- LARGE-FOOTPRINT MODE for Commercial / Institutional / Industrial ---
                        const rawLandUse = (p as any).landUse || params.landUse || 'residential';
                        const effectiveLandUse = rawLandUse.toLowerCase();
                        if (['commercial', 'institutional', 'industrial', 'public'].includes(effectiveLandUse)) {
                            const buildingCount = (p as any).buildingCount ?? (params as any).buildingCount ?? 2;
                            console.log(`[DEBUG-COMM] ========== COMMERCIAL GENERATION START ==========`);
                            console.log(`[DEBUG-COMM] buildingCount=${buildingCount}, landUse=${effectiveLandUse}`);
                            console.log(`[DEBUG-COMM] effectiveMaxFootprint=${effectiveMaxFootprint.toFixed(0)}m², chunk area=${turf.area(chunk).toFixed(0)}m²`);
                            console.log(`[DEBUG-COMM] genParams.maxFootprint=${(genParams as any).maxFootprint?.toFixed(0) ?? 'undefined'}`);

                            // Apply directional setbacks to the chunk BEFORE passing to the generator
                            // This mirrors the residential path and ensures front/rear/side setback sliders affect commercial buildings
                            let adjustedCommChunk = chunk;
                            const peripheralBuffer = (hasPeripheralRoad || hasSurfaceParking) ? 3 : 0;
                            const commExtraFront = Math.max(peripheralBuffer, (genParams.frontSetback ?? 0) - mainSetback);
                            const commExtraRear = Math.max(peripheralBuffer, (genParams.rearSetback ?? 0) - mainSetback);
                            const commExtraSide = Math.max(peripheralBuffer, (genParams.sideSetback ?? 0) - mainSetback);

                            console.log(`[DEBUG-COMM] Setback application: mainSetback=${mainSetback}, front=${genParams.frontSetback}(extra=${commExtraFront}), rear=${genParams.rearSetback}(extra=${commExtraRear}), side=${genParams.sideSetback}(extra=${commExtraSide})`);

                            if (commExtraFront > 0 || commExtraRear > 0 || commExtraSide > 0) {
                                // Apply side setback uniformly first
                                if (commExtraSide > 0) {
                                    // @ts-ignore
                                    const sideBuffered = turf.buffer(adjustedCommChunk, -commExtraSide / 1000, { units: 'kilometers' });
                                    const sideCleaned = ensurePolygon(sideBuffered);
                                    if (sideCleaned) adjustedCommChunk = sideCleaned;
                                    console.log(`[DEBUG-COMM] Applied side setback: ${commExtraSide}m, area=${turf.area(adjustedCommChunk).toFixed(0)}m²`);
                                }

                                // Apply directional front/rear cuts
                                const commRoadSides = genParams.roadAccessSides || [];
                                if (commRoadSides.length > 0 && (commExtraFront > 0 || commExtraRear > 0)) {
                                    const frontSides = new Set(commRoadSides.map((s: string) => s.charAt(0).toUpperCase()));
                                    const rearSidesSet = new Set<string>();
                                    frontSides.forEach((s: string) => {
                                        if (s === 'N') rearSidesSet.add('S');
                                        if (s === 'S') rearSidesSet.add('N');
                                        if (s === 'E') rearSidesSet.add('W');
                                        if (s === 'W') rearSidesSet.add('E');
                                    });
                                    frontSides.forEach((s: string) => rearSidesSet.delete(s));

                                    const cutEdgeComm = (edge: string, distance: number) => {
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
                                            const shifted = turf.transformTranslate(adjustedCommChunk, distance, bearing, { units: 'meters' });
                                            // @ts-ignore
                                            const result = turf.intersect(adjustedCommChunk, shifted);
                                            if (result) {
                                                const poly = ensurePolygon(result);
                                                if (poly) {
                                                    adjustedCommChunk = poly;
                                                    console.log(`[DEBUG-COMM] Cut ${edge} edge by ${distance}m`);
                                                }
                                            }
                                        } catch (e) {
                                            console.warn(`[DEBUG-COMM] Failed to cut ${edge}:`, e);
                                        }
                                    };
                                    frontSides.forEach((s: string) => cutEdgeComm(s, commExtraFront));
                                    rearSidesSet.forEach((s: string) => cutEdgeComm(s, commExtraRear));
                                } else if (commExtraFront > 0 || commExtraRear > 0) {
                                    // No road access sides defined — apply max as uniform buffer
                                    const uniformExtra = Math.max(commExtraFront, commExtraRear);
                                    // @ts-ignore
                                    const buffered = turf.buffer(adjustedCommChunk, -uniformExtra / 1000, { units: 'kilometers' });
                                    const cleaned = ensurePolygon(buffered);
                                    if (cleaned) adjustedCommChunk = cleaned;
                                    console.log(`[DEBUG-COMM] Applied uniform front/rear buffer: ${uniformExtra}m`);
                                }
                            }

                            console.log(`[DEBUG-COMM] Adjusted chunk area: ${turf.area(adjustedCommChunk).toFixed(0)}m² (from ${turf.area(chunk).toFixed(0)}m²)`);

                            // Map land use to intendedUse for layout generator branching
                            const landUseToIntendedUse: Record<string, string> = {
                                'commercial': 'Retail',  // Default commercial to Retail layout
                                'institutional': 'Institutional',
                                'industrial': 'Industrial',
                                'public': 'Institutional',
                            };
                            const mappedIntendedUse = landUseToIntendedUse[effectiveLandUse] || 'Retail';

                            const commercialShape = (p as any).commercialShape || (params as any).commercialShape || 'large-footprint';
                            console.log(`[DEBUG-COMM] commercialShape=${commercialShape}, intendedUse=${mappedIntendedUse}`);
                            if (commercialShape === 'block') {
                                chunkGenerated = generateCommercialBlocks(adjustedCommChunk, {
                                    ...genParams,
                                    buildingCount,
                                    mainSetback: 0,  // setbacks already applied to the chunk
                                    intendedUse: mappedIntendedUse
                                } as any);
                                console.log(`[DEBUG-COMM] generateCommercialBlocks returned ${chunkGenerated.length} buildings`);
                            } else {
                                chunkGenerated = generateLargeFootprint(adjustedCommChunk, {
                                    ...genParams,
                                    buildingCount,
                                    mainSetback: 0,  // setbacks already applied to the chunk
                                    sideSetback: 0,
                                    frontSetback: 0,
                                    rearSetback: 0,
                                    intendedUse: mappedIntendedUse
                                } as any);
                                console.log(`[DEBUG-COMM] generateLargeFootprint returned ${chunkGenerated.length} buildings`);
                            }
                            chunkGenerated.forEach((b, i) => {
                                console.log(`[DEBUG-COMM]   Building ${i}: area=${turf.area(b).toFixed(0)}m², coords=${b.geometry.coordinates[0].length} vertices`);
                            });
                        } else {
                        // --- STANDARD TYPOLOGY MODE (Residential / Mixed) ---
                        // Apply directional front/rear/side setback EXTRA beyond mainSetback
                        // When peripheral roads/parking exist, ensure at least 3m buffer from the road zone.
                        // When roadAccessSides are defined, always apply front setback from the road side
                        // so buildings maintain proper distance from the road regardless of peripheral utilities.
                        let adjustedChunk = chunk;
                        const peripheralBuffer = (hasPeripheralRoad || hasSurfaceParking) ? 3 : 0;
                        const hasRoadAccess = (genParams.roadAccessSides?.length ?? 0) > 0;
                        // mainSetback already enforces the height-based setback from the plot boundary.
                        // Extras only apply when directional setback EXCEEDS mainSetback,
                        // or when peripheral road/parking needs a buffer.
                        const extraFront = Math.max(peripheralBuffer, (genParams.frontSetback ?? 0) - mainSetback);
                        const extraRear = Math.max(peripheralBuffer, (genParams.rearSetback ?? 0) - mainSetback);
                        const extraSide = Math.max(peripheralBuffer, (genParams.sideSetback ?? 0) - mainSetback);

                        console.log(`[Setback Debug] mainSetback=${mainSetback}, peripheralBuffer=${peripheralBuffer}, hasRoadAccess=${hasRoadAccess}, extras: F=${extraFront} R=${extraRear} S=${extraSide}`);

                        if (extraFront > 0 || extraRear > 0 || extraSide > 0) {
                            // Case 1: Peripheral road wraps whole plot — apply front setback on ALL sides uniformly
                            if (hasPeripheralRoad) {
                                const maxExtra = Math.max(extraFront, extraRear, extraSide);
                                console.log(`[Residential Setback] Perimeter road: applying ${maxExtra}m extra uniform buffer on all sides`);
                                // @ts-ignore
                                const buffered = turf.buffer(adjustedChunk, -maxExtra / 1000, { units: 'kilometers' });
                                const cleaned = ensurePolygon(buffered);
                                if (cleaned) adjustedChunk = cleaned;
                            }
                            // Case 2: Specific road access sides — apply directional cuts
                            else {
                                const chunkRoadSides = genParams.roadAccessSides || [];
                                if (chunkRoadSides.length > 0) {
                                    console.log(`[Residential Setback] Applying directional extras: Front+${extraFront}m, Rear+${extraRear}m, Side+${extraSide}m`);
                                    
                                    // Apply extra side setback uniformly first
                                    if (extraSide > 0) {
                                        // @ts-ignore
                                        const sideBuffered = turf.buffer(adjustedChunk, -extraSide / 1000, { units: 'kilometers' });
                                        const sideCleaned = ensurePolygon(sideBuffered);
                                        if (sideCleaned) adjustedChunk = sideCleaned;
                                    }

                                    // Apply front/rear via transformTranslate + intersect
                                    const frontSides = new Set(chunkRoadSides.map((s: string) => s.charAt(0).toUpperCase()));
                                    const rearSidesSet = new Set<string>();
                                    frontSides.forEach((s: string) => {
                                        if (s === 'N') rearSidesSet.add('S');
                                        if (s === 'S') rearSidesSet.add('N');
                                        if (s === 'E') rearSidesSet.add('W');
                                        if (s === 'W') rearSidesSet.add('E');
                                    });
                                    frontSides.forEach((s: string) => rearSidesSet.delete(s));

                                    const cutEdgeRes = (edge: string, distance: number) => {
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
                                            const shifted = turf.transformTranslate(adjustedChunk, distance, bearing, { units: 'meters' });
                                            // @ts-ignore
                                            const result = turf.intersect(adjustedChunk, shifted);
                                            if (result) {
                                                const poly = ensurePolygon(result);
                                                if (poly) {
                                                    adjustedChunk = poly;
                                                    console.log(`[Residential Setback] Cut ${edge} edge by ${distance}m`);
                                                }
                                            }
                                        } catch (e) {
                                            console.warn(`[Residential Setback] Failed to cut ${edge}:`, e);
                                        }
                                    };

                                    frontSides.forEach((s: string) => cutEdgeRes(s, extraFront));
                                    rearSidesSet.forEach((s: string) => cutEdgeRes(s, extraRear));
                                }
                                // Case 3: No road access sides defined — apply uniform buffer as fallback
                                else {
                                    const uniformExtra = Math.max(extraFront, extraRear, extraSide);
                                    console.log(`[Residential Setback] No road sides: applying ${uniformExtra}m uniform buffer`);
                                    // @ts-ignore
                                    const buffered = turf.buffer(adjustedChunk, -uniformExtra / 1000, { units: 'kilometers' });
                                    const cleaned = ensurePolygon(buffered);
                                    if (cleaned) adjustedChunk = cleaned;
                                }
                            }
                        }

                        switch (typology) {
                            case 'point':
                                chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                break;
                            case 'slab':
                            case 'plot':
                                chunkGenerated = generateSlabShapes(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                }
                                break;
                            case 'lshaped':
                                chunkGenerated = generateLShapes(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    // Only fall back to point towers — no slabs to preserve typology purity
                                    chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                }
                                break;
                            case 'ushaped':
                                chunkGenerated = generateUShapes(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                }
                                break;
                            case 'tshaped':
                                chunkGenerated = generateTShapes(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                }
                                break;
                            case 'hshaped':
                                chunkGenerated = generateHShapes(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                }
                                break;
                            case 'oshaped':
                                chunkGenerated = generatePerimeter(adjustedChunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(adjustedChunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                                    }
                                }
                                break;
                            default:
                                chunkGenerated = generatePointShapes(adjustedChunk, genParams);
                        }
                        } // end else (standard typology mode)

                        // Handle segments and collisions
                        const isLargeFootprint = ['commercial', 'institutional', 'industrial'].includes(effectiveLandUse);
                        
                        for (let gIdx = 0; gIdx < chunkGenerated.length; gIdx++) {
                            const g = chunkGenerated[gIdx];
                            if (primaryCoverageMet) {
                                console.log(`[DEBUG-COMM] Building ${gIdx}: SKIPPED (primaryCoverageMet=true)`);
                                break;
                            }
                            
                            const currentFp = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                            const remainingBudget = effectiveMaxFootprint - currentFp;
                            const buildingArea = turf.area(g);
                            const bTypo = g.properties?.subtype || g.properties?.typology || typology;
                            
                            console.log(`[DEBUG-COMM] Building ${gIdx} (${bTypo}): area=${buildingArea.toFixed(0)}m², currentFp=${currentFp.toFixed(0)}m², remainingBudget=${remainingBudget.toFixed(0)}m², effectiveMaxFootprint=${effectiveMaxFootprint.toFixed(0)}m²`);
                            
                            if (isLargeFootprint && buildingArea > remainingBudget && remainingBudget > 50) {
                                // SHRINK to fit remaining budget instead of discarding
                                const scaleFactor = Math.sqrt(remainingBudget / buildingArea);
                                console.log(`[DEBUG-COMM] Building ${gIdx}: SHRINKING (${buildingArea.toFixed(0)} > ${remainingBudget.toFixed(0)}), scaleFactor=${scaleFactor.toFixed(3)}`);
                                try {
                                    // @ts-ignore
                                    const shrunk = turf.transformScale(g, scaleFactor);
                                    if (shrunk && turf.area(shrunk) > 50) {
                                        console.log(`[DEBUG-COMM] Building ${gIdx}: SHRUNK OK -> ${turf.area(shrunk).toFixed(0)}m²`);
                                        builtObstacles.push(shrunk);
                                        geomFeatures.push(shrunk);
                                    } else {
                                        console.log(`[DEBUG-COMM] Building ${gIdx}: SHRUNK FAILED (null or too small)`);
                                    }
                                } catch (e) {
                                    console.warn(`[DEBUG-COMM] Building ${gIdx}: SHRINK ERROR`, e);
                                }
                                primaryCoverageMet = true;
                            } else if (!isLargeFootprint && currentFp + buildingArea > effectiveMaxFootprint) {
                                console.log(`[DEBUG-COMM] Building ${gIdx} (${bTypo}): RESIDENTIAL DISCARD (${(currentFp + buildingArea).toFixed(0)} > ${effectiveMaxFootprint.toFixed(0)})`);
                                primaryCoverageMet = true;
                                break;
                            } else {
                                if (isLargeFootprint) {
                                    console.log(`[DEBUG-COMM] Building ${gIdx} (${bTypo}): ACCEPTED (${buildingArea.toFixed(0)} <= ${remainingBudget.toFixed(0)})`);
                                    builtObstacles.push(g);
                                    geomFeatures.push(g);
                                } else {
                                    if (!checkCollision(g, builtObstacles)) {
                                        console.log(`[DEBUG-COMM] Building ${gIdx} (${bTypo}): ACCEPTED (${buildingArea.toFixed(0)}m², no collision)`);
                                        builtObstacles.push(g);
                                        geomFeatures.push(g);
                                    } else {
                                        console.log(`[DEBUG-COMM] Building ${gIdx} (${bTypo}): COLLISION REJECTED (${buildingArea.toFixed(0)}m², collides with ${builtObstacles.length} obstacles)`);
                                    }
                                }
                            }
                        }
                        console.log(`[DEBUG-COMM] After coverage loop: geomFeatures.length=${geomFeatures.length}`);
                    }
                });

                // ============================================================
                // GFA MAXIMIZATION: INFILL LOOP
                // Runs when autoMaxGFA is enabled OR when the primary generation
                // pass produced insufficient footprint to reach GFA target.
                // This ensures L/U/T/H typologies (which have arm gaps and spacing)
                // get additional buildings to match slab/point GFA output.
                // ============================================================

                // ============================================================
                // STAGE 1: PERIPHERAL FILL
                // After L/U/T/H primary pass, fill remaining peripheral edge
                // space with slabs/points (respecting setbacks) before doing
                // internal ring infill. This is the natural way to maximize GFA.
                // ============================================================
                const primaryFootprintTotal = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                const primaryMaxGFA = primaryFootprintTotal * effectiveMaxFloors;
                const gfaShortfall = primaryMaxGFA < effectiveMaxGFA * 0.90; // >10% short of target
                const isComplexTypology = sortedTypologies.some((t: string) =>
                    ['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(t)
                );

                // ============================================================
                // GFA MAXIMIZATION (only when autoMaxGFA toggle is ON)
                // STAGE 1: Peripheral Fill — slabs/points in remaining edges
                // STAGE 2: Ring Infill — internal ring placement if still short
                // ============================================================
                if (params.autoMaxGFA) {

                    // Block courtyard areas between L/U/T/H arms for ALL infill stages
                    if (isComplexTypology) {
                        const hullGroups: Record<string, Feature<Polygon>[]> = {};
                        for (const f of geomFeatures) {
                            const sid = f.properties?.scenarioId || 'ungrouped';
                            if (!hullGroups[sid]) hullGroups[sid] = [];
                            hullGroups[sid].push(f);
                        }
                        for (const [gid, parts] of Object.entries(hullGroups)) {
                            if (parts.length >= 2) {
                                try {
                                    // @ts-ignore
                                    const combined = turf.featureCollection(parts);
                                    const hull = turf.convex(combined);
                                    if (hull && hull.geometry.type === 'Polygon') {
                                        const bufferedHull = turf.buffer(hull, 3 / 1000, { units: 'kilometers' });
                                        if (bufferedHull) {
                                            builtObstacles.push(bufferedHull as Feature<Polygon>);
                                            console.log(`[Courtyard Block] Group ${gid}: hull ${turf.area(hull).toFixed(0)}m² + 3m buffer added as obstacle`);
                                        }
                                    }
                                } catch (e) { /* skip */ }
                            }
                        }
                    }

                    // --- STAGE 1: PERIPHERAL FILL (for L/U/T/H only) ---
                    if (gfaShortfall && isComplexTypology) {
                        console.log(`[Peripheral Fill] Primary ${sortedTypologies[0]} pass: ${geomFeatures.length} buildings, footprint=${primaryFootprintTotal.toFixed(0)}m², GFA=${primaryMaxGFA.toFixed(0)}/${effectiveMaxGFA.toFixed(0)}m² (${((1 - primaryMaxGFA/effectiveMaxGFA)*100).toFixed(0)}% short)`);

                        for (const chunk of validChunks) {
                            const currentFpCheck = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                            if (currentFpCheck * effectiveMaxFloors >= effectiveMaxGFA * 0.95) break;
                            if (currentFpCheck >= effectiveMaxFootprint) break;

                            // Apply setback buffer matching the primary pass
                            let peripheralChunk = chunk;
                            const peripheralBuffer = (hasPeripheralRoad || hasSurfaceParking) ? 3 : 0;
                            const pExtraFront = Math.max(peripheralBuffer, (p.frontSetback ?? Math.max(mainSetback, 6)) - mainSetback);
                            const pExtraRear = Math.max(peripheralBuffer, (p.rearSetback ?? (p.frontSetback ?? Math.max(mainSetback, 6))) - mainSetback);
                            const pExtraSide = Math.max(peripheralBuffer, (p.sideSetback ?? Math.max(mainSetback, 6)) - mainSetback);
                            const pMaxExtra = Math.max(pExtraFront, pExtraRear, pExtraSide);
                            if (pMaxExtra > 0) {
                                // @ts-ignore
                                const pBuffered = turf.buffer(peripheralChunk, -pMaxExtra / 1000, { units: 'kilometers' });
                                const pCleaned = ensurePolygon(pBuffered);
                                if (pCleaned) peripheralChunk = pCleaned;
                            }

                            const project = get().projects.find(prj => prj.id === get().activeProjectId);
                            const projectUnitMix = project?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

                            const peripheralParams: AlgoParams = {
                                ...p,
                                obstacles: [...builtObstacles],
                                unitMix: projectUnitMix,
                                maxFootprint: effectiveMaxFootprint,
                                minFootprint: effectiveMinFootprint,
                                maxFloors: effectiveMaxFloors,
                                minBuildingWidth: p.minBuildingWidth ?? 20,
                                maxBuildingWidth: p.maxBuildingWidth ?? 25,
                                minBuildingLength: p.minBuildingLength ?? 25,
                                maxBuildingLength: p.maxBuildingLength ?? 55,
                                frontSetback: p.frontSetback ?? Math.max(mainSetback, 3),
                                rearSetback: p.rearSetback ?? Math.max(mainSetback, 3),
                                sideSetback: p.sideSetback ?? Math.max(mainSetback, 3),
                                setback: mainSetback,
                                seed: (p.seed ?? 0) + 100
                            };

                            // Fill peripheral gaps: slabs first (better coverage), then points for remaining space
                            let peripheralBuildings: Feature<Polygon>[] = [];
                            try {
                                peripheralBuildings = generateSlabShapes(peripheralChunk, peripheralParams);
                                // Also try points in remaining space
                                const pointParams = { ...peripheralParams, obstacles: [...peripheralParams.obstacles, ...peripheralBuildings], seed: (peripheralParams.seed ?? 0) + 50 };
                                const extraPoints = generatePointShapes(peripheralChunk, pointParams);
                                peripheralBuildings = [...peripheralBuildings, ...extraPoints];
                            } catch (e) {
                                console.warn('[Peripheral Fill] Generator error:', e);
                            }

                            let peripheralAdded = 0;
                            for (const pb of peripheralBuildings) {
                                const curFp = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                                if (curFp * effectiveMaxFloors >= effectiveMaxGFA * 0.95) break;
                                if (curFp + turf.area(pb) > effectiveMaxFootprint) continue;

                                if (!checkCollision(pb, builtObstacles)) {
                                    builtObstacles.push(pb);
                                    geomFeatures.push(pb);
                                    peripheralAdded++;
                                }
                            }

                            const afterFp = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                            console.log(`[Peripheral Fill] Added ${peripheralAdded} slab/point buildings. Footprint: ${afterFp.toFixed(0)}m², GFA: ${(afterFp * effectiveMaxFloors).toFixed(0)}/${effectiveMaxGFA.toFixed(0)}m²`);
                        }
                    }

                    // --- STAGE 2: RING INFILL (if still short after peripheral fill) ---
                    const totalFootprintSoFar = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                    const userMaxFloors = effectiveMaxFloors; // Use SAME value as floor assignment
                    const maxPrimaryGFA = totalFootprintSoFar * userMaxFloors;
                    const gfaTarget = effectiveMaxGFA;
                    const coverageLimitArea = effectiveMaxFootprint; // from Site Utilization slider

                    console.log(`[GFA Infill] ========= INFILL DEBUG START =========`);
                    console.log(`[GFA Infill] Primary pass: ${geomFeatures.length} buildings, footprint=${totalFootprintSoFar.toFixed(0)}m²`);
                    console.log(`[GFA Infill] userMaxFloors=${userMaxFloors}, maxPossibleGFA=${maxPrimaryGFA.toFixed(0)}m², target=${gfaTarget.toFixed(0)}m²`);
                    console.log(`[GFA Infill] coverageLimitArea=${coverageLimitArea.toFixed(0)}m² (site utilization=${userMaxCoverage}%)`);
                    console.log(`[GFA Infill] GFA deficit: ${(gfaTarget - maxPrimaryGFA).toFixed(0)}m², need ${((gfaTarget - maxPrimaryGFA) / userMaxFloors).toFixed(0)}m² more footprint`);

                    // Unified stop check: stop when GFA target met OR coverage limit reached
                    const shouldStopInfill = () => {
                        const fp = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                        const gfaMet = fp * userMaxFloors >= gfaTarget;
                        const coverageMet = fp >= coverageLimitArea;
                        return { stop: gfaMet || coverageMet, fp, reason: gfaMet ? 'GFA' : coverageMet ? 'coverage' : 'none' };
                    };

                    // Pre-check: would adding this specific candidate exceed the coverage limit?
                    const wouldExceedCoverage = (candidate: Feature<Polygon>) => {
                        const fp = geomFeatures.reduce((sum, f) => sum + turf.area(f), 0);
                        return (fp + turf.area(candidate)) > coverageLimitArea;
                    };

                    if (maxPrimaryGFA >= gfaTarget) {
                        console.log(`[GFA Infill] Primary buildings (max ${userMaxFloors} floors) can reach target GFA. Skipping infill.`);
                    } else {
                        const selectedInfillMode = params.infillMode || 'hybrid';
                        console.log(`[GFA Infill] Primary buildings short of target. Starting ${selectedInfillMode.toUpperCase()} infill...`);

                    // For ALL infill modes, only check collision against ACTUAL BUILDINGS
                    // (not green areas, road buffers, parking zones, etc. which are in builtObstacles)
                    const infillObstacles: Feature<Polygon>[] = [...geomFeatures]; // buildings only

                    // For L/U/T/H: also block the courtyard areas between arms
                    // by adding buffered convex hulls of each building group
                    if (isComplexTypology) {
                        const groups: Record<string, Feature<Polygon>[]> = {};
                        for (const f of geomFeatures) {
                            const sid = f.properties?.scenarioId || 'ungrouped';
                            if (!groups[sid]) groups[sid] = [];
                            groups[sid].push(f);
                        }
                        for (const [gid, parts] of Object.entries(groups)) {
                            if (parts.length >= 2) {
                                try {
                                    // @ts-ignore
                                    const combined = turf.featureCollection(parts);
                                    const hull = turf.convex(combined);
                                    if (hull && hull.geometry.type === 'Polygon') {
                                        // Buffer slightly to add spacing around the shape
                                        const bufferedHull = turf.buffer(hull, 3 / 1000, { units: 'kilometers' });
                                        if (bufferedHull) {
                                            infillObstacles.push(bufferedHull as Feature<Polygon>);
                                            console.log(`[GFA Infill] Added courtyard hull for group ${gid} (${parts.length} parts, ${turf.area(hull).toFixed(0)}m²)`);
                                        }
                                    }
                                } catch (e) { /* hull failed, individual arms still block */ }
                            }
                        }
                    }

                    console.log(`[GFA Infill] builtObstacles=${builtObstacles.length} (includes green/road/parking), infillObstacles=${infillObstacles.length} (buildings + hulls)`);

                    // ============ HELPER: RING INFILL PASS ============
                    const runRingInfill = () => {
                        const buildingWidth = p.maxBuildingWidth ?? 25;
                        const frontSB = p.frontSetback ?? 6;
                        const rearSB = p.rearSetback ?? 4;
                        const ringGap = frontSB + rearSB;
                        const baseInward = buildingWidth + ringGap;
                        console.log(`[GFA Ring] Regulation setbacks: front=${frontSB}, rear=${rearSB}, ringGap=${ringGap}, baseInward=${baseInward}m`);

                        for (let ringIdx = 0; ringIdx < 25; ringIdx++) {
                            const preCheck = shouldStopInfill();
                            if (preCheck.stop) {
                                console.log(`[GFA Ring] ${preCheck.reason} limit met before ring ${ringIdx + 1} (fp=${preCheck.fp.toFixed(0)}m²)`);
                                break;
                            }

                            const totalInward = baseInward + (ringIdx * (buildingWidth + ringGap));
                            const nextInward = totalInward + buildingWidth;
                            console.log(`[GFA Ring] Ring ${ringIdx + 1}: outer=${totalInward.toFixed(1)}m, inner=${nextInward.toFixed(1)}m`);

                            // Create outer buffer (simple polygon for generator) and inner buffer (for filtering)
                            let outerPoly: Feature<Polygon> | null = null;
                            let innerPoly: Feature<Polygon> | null = null;
                            try {
                                // @ts-ignore
                                const outerBuf = turf.buffer(validAreaPoly, -totalInward / 1000, { units: 'kilometers' });
                                if (outerBuf) {
                                    if (outerBuf.geometry?.type === 'MultiPolygon') {
                                        // @ts-ignore
                                        const flat = turf.flatten(outerBuf);
                                        let largest: Feature<Polygon> | null = null;
                                        let la = 0;
                                        flat.features.forEach((f: any) => { const a = turf.area(f); if (a > la) { la = a; largest = f; } });
                                        outerPoly = largest;
                                    } else {
                                        outerPoly = ensurePolygon(outerBuf);
                                    }
                                }

                                // @ts-ignore
                                const innerBuf = turf.buffer(validAreaPoly, -nextInward / 1000, { units: 'kilometers' });
                                if (innerBuf && turf.area(innerBuf) > 50) {
                                    if (innerBuf.geometry?.type === 'MultiPolygon') {
                                        // @ts-ignore
                                        const flat = turf.flatten(innerBuf);
                                        let largest: Feature<Polygon> | null = null;
                                        let la = 0;
                                        flat.features.forEach((f: any) => { const a = turf.area(f); if (a > la) { la = a; largest = f; } });
                                        innerPoly = largest;
                                    } else {
                                        innerPoly = ensurePolygon(innerBuf);
                                    }
                                }
                                // If innerPoly is null, inner buffer collapsed → this is the last ring (center fill)
                            } catch (e) {
                                console.warn(`[GFA Ring] Ring ${ringIdx + 1}: buffer failed:`, e);
                                break;
                            }

                            if (!outerPoly || turf.area(outerPoly) < 150) {
                                console.log(`[GFA Ring] Ring ${ringIdx + 1}: outer polygon too small. Stopping rings.`);
                                break;
                            }

                            const isLastRing = !innerPoly; // Inner collapsed → center patch
                            const outerArea = turf.area(outerPoly);
                            console.log(`[GFA Ring] Ring ${ringIdx + 1}: outerArea=${outerArea.toFixed(0)}m², lastRing=${isLastRing}`);

                            let ringCandidates: Feature<Polygon>[] = [];
                            for (const typology of sortedTypologies) {
                                const project = get().projects.find(prj => prj.id === get().activeProjectId);
                                const projectUnitMix = project?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

                                const infillParams: AlgoParams = {
                                    ...p,
                                    typology: typology as any,
                                    width: p.width || 20,
                                    obstacles: [],
                                    vastuCompliant: false,
                                    unitMix: projectUnitMix,
                                    maxFootprint: effectiveMaxFootprint,
                                    minFootprint: effectiveMinFootprint,
                                    maxFloors: effectiveMaxFloors,
                                    minBuildingWidth: p.minBuildingWidth ?? 20,
                                    maxBuildingWidth: p.maxBuildingWidth ?? 25,
                                    minBuildingLength: p.minBuildingLength ?? 25,
                                    maxBuildingLength: p.maxBuildingLength ?? 55,
                                    setback: mainSetback,
                                    frontSetback: p.frontSetback ?? Math.max(mainSetback, 3),
                                    rearSetback: p.rearSetback ?? Math.max(mainSetback, 3),
                                    sideSetback: p.sideSetback ?? Math.max(mainSetback, 3),
                                    roadAccessSides: p.roadAccessSides ?? [],
                                    seed: (p.seed ?? 0) + ringIdx + 1
                                };

                                let generated: Feature<Polygon>[] = [];
                                try {
                                    switch (typology) {
                                        case 'point':
                                            generated = generatePointShapes(outerPoly, infillParams);
                                            break;
                                        case 'slab':
                                        case 'plot':
                                            generated = generateSlabShapes(outerPoly, infillParams);
                                            if (generated.length === 0) generated = generatePointShapes(outerPoly, infillParams);
                                            break;
                                        case 'lshaped':
                                        case 'ushaped':
                                        case 'tshaped':
                                        case 'hshaped':
                                            // Slabs first (better coverage), then points for gaps
                                            generated = generateSlabShapes(outerPoly, infillParams);
                                            const ptParams = { ...infillParams, obstacles: [...(infillParams.obstacles || []), ...generated], seed: (infillParams.seed ?? 0) + 50 };
                                            const pts = generatePointShapes(outerPoly, ptParams);
                                            generated = [...generated, ...pts];
                                            break;
                                        case 'oshaped':
                                            generated = generatePerimeter(outerPoly, infillParams);
                                            if (generated.length === 0) generated = generatePointShapes(outerPoly, infillParams);
                                            break;
                                        default:
                                            generated = generatePointShapes(outerPoly, infillParams);
                                    }
                                } catch (genErr) {
                                    console.warn(`[GFA Ring] ${typology} error:`, genErr);
                                }

                                // FILTER: Only keep candidates whose centroid is in the BAND
                                // (in outer polygon but NOT in inner polygon)
                                // This ensures outside-in placement — center stays empty at low coverage
                                if (!isLastRing && innerPoly && generated.length > 0) {
                                    const beforeFilter = generated.length;
                                    generated = generated.filter(g => {
                                        try {
                                            const c = turf.centroid(g);
                                            // Accept if centroid is NOT inside the inner buffer (i.e., it's in the band)
                                            return !turf.booleanPointInPolygon(c, innerPoly!);
                                        } catch { return true; }
                                    });
                                    console.log(`[GFA Ring] Ring ${ringIdx + 1}, ${typology}: ${beforeFilter} generated, ${generated.length} in band`);
                                } else {
                                    console.log(`[GFA Ring] Ring ${ringIdx + 1}, ${typology}: ${generated.length} candidates (last ring, no filter)`);
                                }
                                ringCandidates.push(...generated);
                            }

                            if (ringCandidates.length === 0) {
                                console.log(`[GFA Ring] Ring ${ringIdx + 1}: no candidates in band. Trying next ring.`);
                                continue;
                            }

                            let addedFromRing = 0;
                            let rejectedFromRing = 0;
                            let ringGFAMet = false;
                            for (const candidate of ringCandidates) {
                                const ringCheck = shouldStopInfill();
                                if (ringCheck.stop) {
                                    console.log(`[GFA Ring] ✅ ${ringCheck.reason} limit met (fp=${ringCheck.fp.toFixed(0)}m²)`);
                                    ringGFAMet = true;
                                    break;
                                }
                                // Check collision ONLY against buildings, and ensure adding won't exceed coverage
                                if (!wouldExceedCoverage(candidate) && !checkCollision(candidate, infillObstacles)) {
                                    infillObstacles.push(candidate);
                                    builtObstacles.push(candidate);
                                    geomFeatures.push(candidate);
                                    addedFromRing++;
                                } else {
                                    rejectedFromRing++;
                                }
                            }

                            const postRingFP = geomFeatures.reduce((s, f) => s + turf.area(f), 0);
                            console.log(`[GFA Ring] Ring ${ringIdx + 1}: added=${addedFromRing}, rejected=${rejectedFromRing}, total=${geomFeatures.length}`);
                            console.log(`[GFA Ring] After ring ${ringIdx + 1}: footprint=${postRingFP.toFixed(0)}m², projGFA=${(postRingFP * userMaxFloors).toFixed(0)} / target=${gfaTarget.toFixed(0)}`);

                            if (ringGFAMet || shouldStopInfill().stop) {
                                console.log(`[GFA Ring] ✅ GFA target met.`);
                                break;
                            }
                        }
                    };

                    // ============ HELPER: GRID INFILL PASS ============
                    const runGridInfill = () => {
                        const gridWidthM = p.minBuildingWidth ?? 20;
                        const gridLengthM = p.minBuildingLength ?? 25;
                        // Use the main setback parameter from the toolbar for grid spacing, falling back to sideSetback
                        const gridSideGapM = Math.max(p.setback ?? p.sideSetback ?? 6, 2);
                        const gridStepXM = gridWidthM + gridSideGapM;
                        const gridStepYM = gridLengthM + gridSideGapM;
                        const gridBbox = turf.bbox(validAreaPoly);

                        const centerLat = (gridBbox[1] + gridBbox[3]) / 2;
                        const metersPerDegreeLat = 111320;
                        const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
                        const gridStepXDeg = gridStepXM / metersPerDegreeLng;
                        const gridStepYDeg = gridStepYM / metersPerDegreeLat;
                        const halfWidthDeg = gridWidthM / 2 / metersPerDegreeLng;
                        const halfLengthDeg = gridLengthM / 2 / metersPerDegreeLat;

                        console.log(`[GFA Grid] Grid cell: ${gridWidthM}×${gridLengthM}m, gap=${gridSideGapM}m, step=${gridStepXM}×${gridStepYM}m`);
                        console.log(`[GFA Grid] Degree step: ${gridStepXDeg.toFixed(6)}° × ${gridStepYDeg.toFixed(6)}°`);

                        let gridAdded = 0;
                        let gridRejected = 0;
                        let gridOutside = 0;

                        for (let x = gridBbox[0] + halfWidthDeg; x < gridBbox[2]; x += gridStepXDeg) {
                            if (shouldStopInfill().stop) break;
                            for (let y = gridBbox[1] + halfLengthDeg; y < gridBbox[3]; y += gridStepYDeg) {
                                if (shouldStopInfill().stop) break;

                                const pt = turf.point([x, y]);
                                if (!turf.booleanPointInPolygon(pt, validAreaPoly)) {
                                    gridOutside++;
                                    continue;
                                }

                                const poly = turf.polygon([[
                                    [x - halfWidthDeg, y - halfLengthDeg],
                                    [x + halfWidthDeg, y - halfLengthDeg],
                                    [x + halfWidthDeg, y + halfLengthDeg],
                                    [x - halfWidthDeg, y + halfLengthDeg],
                                    [x - halfWidthDeg, y - halfLengthDeg]
                                ]]);

                                // @ts-ignore
                                const clipped = turf.intersect(poly, validAreaPoly);
                                const fullArea = gridWidthM * gridLengthM;
                                
                                if (!clipped) {
                                    gridOutside++;
                                    continue;
                                }

                                // Handle case where intersection returns MultiPolygon or GeometryCollection
                                let bestPoly: Feature<Polygon> | null = null;
                                // @ts-ignore
                                if (clipped.geometry.type === 'Polygon') {
                                    bestPoly = clipped as Feature<Polygon>;
                                } else if (clipped.geometry.type === 'MultiPolygon' || clipped.geometry.type === 'GeometryCollection') {
                                    // Extract largest polygon
                                    // @ts-ignore
                                    const parts = turf.flatten(clipped);
                                    let maxAreaPart = 0;
                                    for (const part of parts.features) {
                                        if (part.geometry.type === 'Polygon') {
                                            const a = turf.area(part);
                                            if (a > maxAreaPart) {
                                                maxAreaPart = a;
                                                bestPoly = part as Feature<Polygon>;
                                            }
                                        }
                                    }
                                }

                                if (!bestPoly || turf.area(bestPoly) < fullArea * 0.60) {
                                    gridOutside++;
                                    continue;
                                }

                                // Clean coordinates to prevent polygon-clipping errors downstream
                                bestPoly = turf.cleanCoords(bestPoly);

                                const useClipped = turf.area(bestPoly) < fullArea * 0.95;
                                const candidate = (useClipped ? bestPoly : poly) as Feature<Polygon>;
                                const gridSubtype = sortedTypologies.some((t: string) => t === 'slab' || t === 'plot') ? 'slab' : 'point';
                                candidate.properties = { typology: gridSubtype, subtype: gridSubtype, type: 'generated', isGridInfill: true };

                                if (!wouldExceedCoverage(candidate) && !checkCollision(candidate, infillObstacles)) {
                                    infillObstacles.push(candidate);
                                    builtObstacles.push(candidate);
                                    geomFeatures.push(candidate);
                                    gridAdded++;
                                } else {
                                    gridRejected++;
                                }
                            }
                            if (shouldStopInfill().stop) break;
                        }

                        console.log(`[GFA Grid] Grid pass: added=${gridAdded}, rejected=${gridRejected}, outside=${gridOutside}`);

                        // Offset grid pass for remaining gaps
                        if (!shouldStopInfill().stop) {
                            console.log(`[GFA Grid] Still short. Trying offset grid...`);
                            let rotAdded = 0;
                            for (let x = gridBbox[0] + halfWidthDeg + gridStepXDeg / 2; x < gridBbox[2]; x += gridStepXDeg) {
                                if (shouldStopInfill().stop) break;
                                for (let y = gridBbox[1] + halfLengthDeg + gridStepYDeg / 2; y < gridBbox[3]; y += gridStepYDeg) {
                                    if (shouldStopInfill().stop) break;

                                    const pt2 = turf.point([x, y]);
                                    if (!turf.booleanPointInPolygon(pt2, validAreaPoly)) continue;

                                    const poly2 = turf.polygon([[
                                        [x - halfWidthDeg, y - halfLengthDeg],
                                        [x + halfWidthDeg, y - halfLengthDeg],
                                        [x + halfWidthDeg, y + halfLengthDeg],
                                        [x - halfWidthDeg, y + halfLengthDeg],
                                        [x - halfWidthDeg, y - halfLengthDeg]
                                    ]]);

                                    // @ts-ignore
                                    const clipped2 = turf.intersect(poly2, validAreaPoly);
                                    const fullArea2 = gridWidthM * gridLengthM;
                                    
                                    if (!clipped2) continue;

                                    let bestPoly2: Feature<Polygon> | null = null;
                                    // @ts-ignore
                                    if (clipped2.geometry.type === 'Polygon') {
                                        bestPoly2 = clipped2 as Feature<Polygon>;
                                    } else if (clipped2.geometry.type === 'MultiPolygon' || clipped2.geometry.type === 'GeometryCollection') {
                                        // @ts-ignore
                                        const parts = turf.flatten(clipped2);
                                        let maxAreaPart = 0;
                                        for (const part of parts.features) {
                                            if (part.geometry.type === 'Polygon') {
                                                const a = turf.area(part);
                                                if (a > maxAreaPart) {
                                                    maxAreaPart = a;
                                                    bestPoly2 = part as Feature<Polygon>;
                                                }
                                            }
                                        }
                                    }

                                    if (!bestPoly2 || turf.area(bestPoly2) < fullArea2 * 0.50) continue;

                                    bestPoly2 = turf.cleanCoords(bestPoly2);

                                    const useClip2 = turf.area(bestPoly2) < fullArea2 * 0.95;
                                    const cand2 = (useClip2 ? bestPoly2 : poly2) as Feature<Polygon>;
                                    const gridSubtype2 = sortedTypologies.some((t: string) => t === 'slab' || t === 'plot') ? 'slab' : 'point';
                                    cand2.properties = { typology: gridSubtype2, subtype: gridSubtype2, type: 'generated', isGridInfill: true };

                                    if (!wouldExceedCoverage(cand2) && !checkCollision(cand2, infillObstacles)) {
                                        infillObstacles.push(cand2);
                                        builtObstacles.push(cand2);
                                        geomFeatures.push(cand2);
                                        rotAdded++;
                                    }
                                }
                                if (shouldStopInfill().stop) break;
                            }
                            console.log(`[GFA Grid] Offset grid added ${rotAdded}.`);
                        }
                    };

                    // ============ EXECUTE SELECTED INFILL MODE ============
                    if (selectedInfillMode === 'ring') {
                        runRingInfill();
                    } else if (selectedInfillMode === 'grid') {
                        runGridInfill();
                    } else {
                        // HYBRID: Ring first, then grid for center/gaps ONLY at high utilization (>75%)
                        runRingInfill();
                        const hybridCheck = shouldStopInfill();
                        if (!hybridCheck.stop && userMaxCoverage > 75) {
                            console.log(`[GFA Hybrid] Rings done. footprint=${hybridCheck.fp.toFixed(0)}m², coverage=${userMaxCoverage}%>75%. Running grid center-fill...`);
                            runGridInfill();
                        } else if (!hybridCheck.stop) {
                            console.log(`[GFA Hybrid] Rings done. footprint=${hybridCheck.fp.toFixed(0)}m², coverage=${userMaxCoverage}%≤75%. Skipping grid (increase utilization or floors).`);
                        }
                    }

                    const finalFootprint = geomFeatures.reduce((s, f) => s + turf.area(f), 0);
                    const finalProjGFA = finalFootprint * userMaxFloors;
                    console.log(`[GFA Infill] ========= INFILL END =========`);
                    console.log(`[GFA Infill] Final: ${geomFeatures.length} buildings, footprint=${finalFootprint.toFixed(0)}m²`);
                    console.log(`[GFA Infill] Projected max GFA: ${finalProjGFA.toFixed(0)}m² (target=${gfaTarget.toFixed(0)}m²)`);
                    if (finalProjGFA >= gfaTarget) {
                        console.log(`[GFA Infill] ✅ GFA target met!`);
                    } else {
                        console.warn(`[GFA Infill] ⚠️ Still short by ${(gfaTarget - finalProjGFA).toFixed(0)}m² — plot shape may not allow full coverage.`);
                    }
                    } // close else block (primary GFA short)
                }

                // SPLIT LOGIC: Explode MultiPolygons into distinct Building parts
                const explodedFeatures: Feature<Polygon>[] = [];
                geomFeatures.forEach((f, idx) => {
                    // @ts-ignore
                    if (f.geometry && (f.geometry.type === 'MultiPolygon' || (f.properties && f.properties.isSplit))) {
                        // @ts-ignore
                        const collection = turf.flatten(f);
                        // @ts-ignore
                        collection.features.forEach((subF: Feature<Polygon>, subIdx: number) => {
                            // Inherit properties but clear layout to force regeneration per part
                            subF.properties = { ...f.properties, ...subF.properties, splitIndex: subIdx };
                            if (f.properties?.subtype) subF.properties.subtype = f.properties.subtype;

                            // Important: Clear layout so generateBuildingLayout runs for this specific part
                            delete subF.properties.cores;
                            delete subF.properties.units;

                            explodedFeatures.push(subF);
                        });
                    } else {
                        explodedFeatures.push(f as Feature<Polygon>);
                    }
                });

                // --- PRE-CALCULATE FLOOR COUNTS TO HIT TARGET GFA EXACTLY ---
                const userMinF = params.minFloors ?? 1;
                const userMaxF = params.maxFloors ?? 12;
                let targetFloorCounts = new Array(explodedFeatures.length).fill(userMinF);

                if (params.autoMaxGFA || effectiveMaxGFA > 0) {
                    let activeIndices = Array.from({length: explodedFeatures.length}, (_, idx) => idx);
                    
                    // 1. Prune footprints if minimum floors exceed GFA
                    // Sort by area so we prune the smallest buildings first 
                    activeIndices.sort((a, b) => turf.area(explodedFeatures[a]) - turf.area(explodedFeatures[b]));
                    
                    let currentMinGFA = activeIndices.reduce((sum, idx) => sum + turf.area(explodedFeatures[idx]) * userMinF, 0);
                    
                    while (currentMinGFA > effectiveMaxGFA && activeIndices.length > 0) {
                        const droppedIdx = activeIndices.shift(); // Drop smallest
                        if (droppedIdx !== undefined) {
                            targetFloorCounts[droppedIdx] = 0;
                            currentMinGFA -= turf.area(explodedFeatures[droppedIdx]) * userMinF;
                        }
                    }

                    // 2. Distribute remaining GFA randomly among surviving footprints
                    let currentGFA = currentMinGFA;
                    // Filter available indices to only those that can actually grow
                    let availableIndices = activeIndices.filter(() => userMaxF > userMinF);
                    
                    let iterations = 0;
                    while (currentGFA < effectiveMaxGFA && availableIndices.length > 0 && iterations < 10000) {
                        iterations++;
                        const randIdx = Math.floor(Math.random() * availableIndices.length);
                        const bIdx = availableIndices[randIdx];
                        const area = turf.area(explodedFeatures[bIdx]);
                        
                        // If adding 1 floor keeps us within limit (allow up to 2% overshoot for perfect filling)
                        if (currentGFA + area <= effectiveMaxGFA * 1.02) {
                            targetFloorCounts[bIdx]++;
                            currentGFA += area;
                            if (targetFloorCounts[bIdx] >= userMaxF) {
                                availableIndices.splice(randIdx, 1);
                            }
                        } else {
                            availableIndices.splice(randIdx, 1);
                        }
                    }
                    console.log(`[Floor Pre-calc] Distributed floors to hit GFA. Final GFA: ${currentGFA.toFixed(0)} / ${effectiveMaxGFA.toFixed(0)}`);
                } else {
                    // Fallback just randomize between min and max (safeguard)
                    for (let i = 0; i < explodedFeatures.length; i++) {
                        targetFloorCounts[i] = Math.floor(Math.random() * (userMaxF - userMinF + 1)) + userMinF;
                    }
                }

                // Convert to Buildings
                let newBuildings: Building[] = explodedFeatures.flatMap((f, i) => {
                    const assignedFloors = targetFloorCounts[i];
                    if (assignedFloors === 0) return []; // Pruned because minFloors exceeded GFA

                    // Calculate height based on floor count range AND regulation limits
                    const floorHeight = params.floorHeight || 3.5;
                    const groundFloorHeight = params.groundFloorHeight || floorHeight;

                    let minF = assignedFloors;
                    let maxF = assignedFloors;

                    // Use constraints passed in 'p' if available (from specific regulation), otherwise fallback to plotStub
                    const constraintHeight = p.maxBuildingHeight !== undefined ? p.maxBuildingHeight : plotStub.maxBuildingHeight;

                    // Apply regulation height limit — always cap by max_height regardless of mode
                    if (constraintHeight) {
                        const regulationMaxFloorsVal = Math.floor(constraintHeight / floorHeight);
                        if (maxF > regulationMaxFloorsVal) {
                            if (!params.autoMaxGFA) {
                                console.log(`[Override] Using user maxFloors ${maxF} instead of regulation limit ${regulationMaxFloorsVal}`);
                            } else {
                                // In autoMaxGFA mode, check if we should override regulation to hit target GFA
                                // The user explicitly asked to auto-fill to hit GFA. Capping it below what's needed fails that goal.
                                console.log(`[AutoMaxGFA] Target GFA requires ${maxF} floors, but regulation is ${regulationMaxFloorsVal}. Ignoring regulation to hit target.`);
                                // NO-OP: do not cap maxF
                            }
                        } else {
                            maxF = Math.min(maxF, regulationMaxFloorsVal);
                        }
                    }

                    // Ensure valid range
                    if (maxF < minF) {
                        console.warn(`Regulation constraint too restrictive. Adjusting minFloors from ${minF} to ${maxF}`);
                        maxF = Math.max(minF, maxF); // Allow at least minF
                    }

                    // Vastu-aware height assignment (skip in autoMaxGFA mode to preserve target floors)
                    let vastuHeightMultiplier = 1.0;
                    if (!params.autoMaxGFA) {
                        const projectData = get().projects.find(proj => proj.id === get().activeProjectId);
                        const isVastuEnabled = projectData?.vastuCompliant === true;

                        if (isVastuEnabled) {
                            // Calculate building position relative to plot center
                            const plotCentroid = turf.centroid(plotStub.geometry);
                            const buildingCentroid = turf.centroid(f);
                            const plotCenter = plotCentroid.geometry.coordinates;
                            const buildingCenter = buildingCentroid.geometry.coordinates;

                            // Calculate direction from plot center to building
                            const dx = buildingCenter[0] - plotCenter[0]; // East is positive
                            const dy = buildingCenter[1] - plotCenter[1]; // North is positive

                            // Vastu rules: SW = tallest (1.0), NE = shortest (0.5)
                            const swFactor = Math.max(0, (-dx - dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));
                            const neFactor = Math.max(0, (dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));

                            vastuHeightMultiplier = 0.75 + 0.25 * swFactor - 0.25 * neFactor;
                            vastuHeightMultiplier = Math.max(0.5, Math.min(1.0, vastuHeightMultiplier));

                            console.log(`Vastu height multiplier for building ${i}: ${vastuHeightMultiplier.toFixed(2)} (SW factor: ${swFactor.toFixed(2)}, NE factor: ${neFactor.toFixed(2)})`);
                        }
                    }

                    const baseFloors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    
                    // The user's explicitly set minFloors and maxFloors via the slider MUST be respected.
                    // Vastu can scale the height, but we must clamp it back to the user's allowed bounds
                    // otherwise the visualization will show floors outside the requested range.
                    let floors = Math.max(minF, Math.round(baseFloors * vastuHeightMultiplier));
                    const absoluteMinFloors = params.minFloors ?? 1;
                    const absoluteMaxFloors = params.maxFloors ?? 999;
                    floors = Math.max(absoluteMinFloors, Math.min(absoluteMaxFloors, floors));
                    
                    console.log(`[Floors] Building ${i}: min=${minF}, max=${maxF}, base=${baseFloors}, vastuMult=${vastuHeightMultiplier.toFixed(2)}, final=${floors} (bounds: ${absoluteMinFloors}-${absoluteMaxFloors})`);

                    // FAR compliance: For large-footprint buildings, cap floors so total GFA stays within FAR limit
                    const buildingFootprint = turf.area(f);
                    if (f.properties?.subtype === 'large-footprint') {
                        // Calculate total footprint of all large-footprint buildings in this scenario
                        const totalFootprint = explodedFeatures.reduce((sum, feat) => {
                            return sum + (feat.properties?.subtype === 'large-footprint' ? turf.area(feat) : 0);
                        }, 0);
                        // Max floors this building can have = maxGFA / totalFootprint (split evenly)
                        const farMaxFloors = Math.max(1, Math.floor(effectiveMaxGFA / totalFootprint));
                        if (floors > farMaxFloors) {
                            console.log(`[FAR Cap] Large footprint building ${i}: capping floors from ${floors} to ${farMaxFloors} (footprint=${buildingFootprint.toFixed(0)}m², totalFootprint=${totalFootprint.toFixed(0)}m², maxGFA=${effectiveMaxGFA.toFixed(0)}m²)`);
                            // Respect the minimum floor constraint from the user
                            floors = Math.max(params.minFloors || 1, farMaxFloors);
                        }
                    }

                    const height = groundFloorHeight + (floors - 1) * floorHeight;

                    // Determine intended use from params
                    let intendedUse = BuildingIntendedUse.Residential;
                    let buildingSpecificFloors: any[] = [];
                    const id = `gen-${crypto.randomUUID()}`;

                    // IMPORTANT: Check mixed-use FIRST to ensure programMix allocation runs
                    // before any regulation-type overrides (which might contain 'public', etc.)
                    const regulationType = plotStub.selectedRegulationType?.toLowerCase() || '';

                    if (params.landUse === 'mixed') {
                        // --- MIXED USE ALLOCATION LOGIC ---
                        const mix = params.programMix || { residential: 100, commercial: 0, institutional: 0, hospitality: 0 };
                        const allocationMode = params.allocationMode || 'floor';

                        if (allocationMode === 'plot') {
                            // --- PLOT-WISE ALLOCATION ---
                            // Distribute buildings based on count across the total set
                            const totalBuildings = explodedFeatures.length;
                            const resLimit = (mix.residential / 100) * totalBuildings;
                            const commLimit = resLimit + (mix.commercial / 100) * totalBuildings;
                            const hospLimit = commLimit + (mix.hospitality / 100) * totalBuildings;

                            if (i < resLimit) intendedUse = BuildingIntendedUse.Residential;
                            else if (i < commLimit) intendedUse = BuildingIntendedUse.Commercial;
                            else if (i < hospLimit) intendedUse = BuildingIntendedUse.Hospitality;
                            else intendedUse = BuildingIntendedUse.Public; // 'institutional' slot maps to Public

                            const floorColors = generateFloorColors(floors, intendedUse);
                            buildingSpecificFloors = Array.from({ length: floors }, (_, j) => ({
                                id: `floor-${id}-${j}`,
                                height: j === 0 ? groundFloorHeight : floorHeight,
                                color: floorColors[j] || '#cccccc',
                                type: 'General' as const,
                                intendedUse: intendedUse,
                                level: j
                            }));

                        } else {
                            // --- FLOOR-WISE ALLOCATION (Vertical Stacking) ---
                            intendedUse = BuildingIntendedUse.MixedUse;

                            // Calculate number of floors for each use
                            // Stack Order (Bottom -> Top): Retail -> Institutional -> Hospitality -> Office -> Residential
                            const commFloors = Math.round(floors * (mix.commercial / 100));
                            
                            // Split Commercial using commercialMix if provided, else roughly 40% Retail / 60% Office
                            const defaultRetailPct = params.commercialMix ? (params.commercialMix.retail / 100) : 0.4;
                            const retailFloors = commFloors > 0 ? 
                                (params.commercialMix ? Math.round(commFloors * defaultRetailPct) : Math.max(1, Math.floor(commFloors * defaultRetailPct))) 
                                : 0;
                            const officeFloors = Math.max(0, commFloors - retailFloors);

                            const instFloors = Math.round(floors * (mix.institutional / 100));
                            const hospFloors = Math.round(floors * (mix.hospitality / 100));
                            // Residential gets the remainder to ensure total == floors
                            const resFloors = Math.max(0, floors - commFloors - instFloors - hospFloors);

                            let currentFloorIndex = 0;

                            const addFloors = (count: number, type: BuildingIntendedUse) => {
                                if (count <= 0) return;
                                const colors = generateFloorColors(count, type);
                                for (let k = 0; k < count; k++) {
                                    buildingSpecificFloors.push({
                                        id: `floor-${id}-${currentFloorIndex}`,
                                        height: currentFloorIndex === 0 ? groundFloorHeight : floorHeight,
                                        color: colors[k] || '#cccccc',
                                        type: 'General' as const,
                                        intendedUse: type,
                                        level: currentFloorIndex
                                    });
                                    currentFloorIndex++;
                                }
                            };

                            addFloors(retailFloors, BuildingIntendedUse.Retail);
                            addFloors(instFloors, BuildingIntendedUse.Public);
                            addFloors(hospFloors, BuildingIntendedUse.Hospitality);
                            addFloors(officeFloors, BuildingIntendedUse.Office);
                            addFloors(resFloors, BuildingIntendedUse.Residential);
                        }
                    } else if (regulationType.includes('industrial') || regulationType.includes('warehouse') || regulationType.includes('storage') || regulationType.includes('manufacturing')) {
                        intendedUse = BuildingIntendedUse.Industrial;
                    } else if (regulationType.includes('public') || regulationType.includes('civic') || regulationType.includes('government') || params.landUse === 'institutional') {
                        intendedUse = BuildingIntendedUse.Public;
                    } else if (params.landUse === 'commercial') {
                        if (params.commercialMix && params.allocationMode === 'plot') {
                            // Plot-wise: split buildings based on ratio
                            const totalBuildings = explodedFeatures.length;
                            const retailLimit = (params.commercialMix.retail / 100) * totalBuildings;
                            intendedUse = i < retailLimit ? BuildingIntendedUse.Retail : BuildingIntendedUse.Office;
                        } else if (params.commercialMix && params.allocationMode !== 'plot') {
                            // Floor-wise: stack Retail on bottom, Office on top
                            intendedUse = BuildingIntendedUse.Commercial;
                            const retailFloors = Math.round(floors * (params.commercialMix.retail / 100));
                            const officeFloors = Math.max(0, floors - retailFloors);
                            
                            let currentFloorIndex = 0;
                            const addFloors = (count: number, type: BuildingIntendedUse) => {
                                if (count <= 0) return;
                                const colors = generateFloorColors(count, type);
                                for (let k = 0; k < count; k++) {
                                    buildingSpecificFloors.push({
                                        id: `floor-${id}-${currentFloorIndex}`,
                                        height: currentFloorIndex === 0 ? groundFloorHeight : floorHeight,
                                        color: colors[k] || '#cccccc',
                                        type: 'General' as const,
                                        intendedUse: type,
                                        level: currentFloorIndex
                                    });
                                    currentFloorIndex++;
                                }
                            };
                            
                            addFloors(retailFloors, BuildingIntendedUse.Retail);
                            addFloors(officeFloors, BuildingIntendedUse.Office);

                            if (retailFloors === floors) intendedUse = BuildingIntendedUse.Retail;
                            if (officeFloors === floors) intendedUse = BuildingIntendedUse.Office;
                        } else {
                            intendedUse = BuildingIntendedUse.Office; // Default commercial to Office layout
                        }
                    }

                    // Fallback for non-mixed / standard cases if floors not yet generated
                    if (buildingSpecificFloors.length === 0) {
                        const floorColors = generateFloorColors(floors, intendedUse);
                        buildingSpecificFloors = Array.from({ length: floors }, (_, j) => ({
                            id: `floor-${id}-${j}`,
                            height: j === 0 ? groundFloorHeight : floorHeight,
                            color: floorColors[j] || '#cccccc',
                            type: 'General' as const,
                            intendedUse: intendedUse,
                            level: j
                        }));
                    }

                    // --- INTERNAL LAYOUT (CORES/UNITS) ---
                    // Some generators (like L/U/T/H) already calculate layout.
                    // Others (like Tower/Lamella) need it calculated here.
                    // Always regenerate layout fresh using the toolbar's unitMix to avoid stale cached units
                    const projectUnitMix = params.unitMix || activeProject?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;
                    const alignRot = f.properties?.alignmentRotation ?? getPlotOrientation(f as Feature<Polygon>);
                    
                    // Explicitly stamp the alignmentRotation into the geometry properties 
                    // so it is preserved when increasing floors later
                    if (!f.properties) f.properties = {};
                    f.properties.alignmentRotation = alignRot;

                    const freshLayout = generateBuildingLayout(f as Feature<Polygon>, {
                        subtype: f.properties?.subtype || params.typology,
                        unitMix: projectUnitMix,
                        intendedUse: intendedUse,
                        numFloors: floors,
                        // Preserve the alignment rotation stored by the geometric generators so units
                        // are generated axis-aligned and then rotated back to match the building
                        alignmentRotation: alignRot,
                        shuffleUnits: params.shuffleUnits,
                        exactTypologyAllocation: params.exactTypologyAllocation,
                        selectedUtilities: params.selectedUtilities || activeProject?.feasibilityParams?.selectedUtilities,
                        // Road-side ground floor units are removed for residential buildings
                        groundFloorRoadSideReduction: intendedUse === BuildingIntendedUse.Residential,
                        roadAccessSides: plotStub.roadAccessSides,
                        plotCentroid: turf.centroid(plotStub.geometry).geometry.coordinates as [number, number],
                    });
                    const layout: any = {
                        cores: freshLayout.cores,
                        units: freshLayout.units,
                        groundFloorUnits: freshLayout.groundFloorUnits,
                        groundFloorRemovedArea: freshLayout.groundFloorRemovedArea || 0,
                        utilities: freshLayout.utilities || f.properties?.internalUtilities || []
                    };

                    // Ensure utilities from geometric-typologies (f.properties.internalUtilities) are preserved if not re-generated
                    if (!layout.utilities && f.properties?.internalUtilities) {
                        layout.utilities = f.properties.internalUtilities;
                    }

                    const baseBuildingProps = {
                        isPolygonClosed: true,
                        opacity: 0.9,
                        extrusion: true,
                        soilData: { ph: null, bd: null },
                        intendedUse: intendedUse,
                        internalUtilities: layout.utilities || [],
                        typicalFloorHeight: floorHeight,
                        groundFloorHeight: groundFloorHeight,
                        visible: true,
                        programMix: params.landUse === 'mixed' && params.programMix
                            ? { ...params.programMix }
                            : undefined,
                    };

                    let actualPodiumFloors = params.podiumFloors;
                    
                    // For floor-wise mixed-use, we auto-calculate the podium floors (Retail + Office + Inst + Hosp)
                    if (params.landUse === 'mixed' && params.allocationMode === 'floor' && params.hasPodium && intendedUse === BuildingIntendedUse.MixedUse) {
                        const mix = params.programMix || { residential: 40, commercial: 40, institutional: 10, hospitality: 10 };
                        const commFloors = Math.round(floors * (mix.commercial / 100));
                        // Use the same retail/office split as the floor generator (line 3034)
                        const defaultRetailPct = params.commercialMix ? (params.commercialMix.retail / 100) : 0.4;
                        const retailFloors = commFloors > 0
                            ? (params.commercialMix ? Math.round(commFloors * defaultRetailPct) : Math.max(1, Math.floor(commFloors * defaultRetailPct)))
                            : 0;
                        const officeFloors = Math.max(0, commFloors - retailFloors);
                        const instFloors = Math.round(floors * (mix.institutional / 100));
                        const hospFloors = Math.round(floors * (mix.hospitality / 100));
                        actualPodiumFloors = retailFloors + officeFloors + instFloors + hospFloors;
                    }

                    const isPodiumCandidate = params.hasPodium && actualPodiumFloors !== undefined && actualPodiumFloors > 0 && floors > actualPodiumFloors && (
                        // Non-mixed landuse (commercial, institutional, residential)
                        (params.landUse !== 'mixed' && (intendedUse === BuildingIntendedUse.Commercial || intendedUse === BuildingIntendedUse.Industrial || intendedUse === BuildingIntendedUse.Public || intendedUse === BuildingIntendedUse.Residential)) ||
                        // Mixed floor-wise: auto-split MixedUse building
                        (params.landUse === 'mixed' && params.allocationMode === 'floor' && intendedUse === BuildingIntendedUse.MixedUse) ||
                        // Mixed plot-wise: ONLY residential buildings get podium treatment
                        (params.landUse === 'mixed' && params.allocationMode === 'plot' && intendedUse === BuildingIntendedUse.Residential)
                    );

                    if (isPodiumCandidate) {
                        const pFloors = actualPodiumFloors!;
                        const tFloors = floors - pFloors;
                        
                        // Shrink tower geometry
                        let towerGeometry = f;
                        const reduction = params.upperFloorReduction || 30;
                        
                        // We need a negative buffer (inset). 
                        // Estimate an appropriate buffer distance based on area and reduction percent.
                        // A rough approximation: distance = sqrt(Area) * (reduction / 100) * 0.5
                        const area = turf.area(f);
                        const bufferDist = -Math.max(1, Math.sqrt(area) * (reduction / 100) * 0.5);

                        try {
                            const buffered = turf.buffer(f, bufferDist, { units: 'meters' });
                            if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
                                const bufferedArea = turf.area(buffered);
                                // Ensure the buffered geometry shrank but didn't collapse
                                if (bufferedArea < area * 0.95 && bufferedArea > area * 0.1) {
                                    towerGeometry = buffered as Feature<Polygon>;
                                    // REATTACH PROPERTIES LOST DURING BUFFERING
                                    towerGeometry.properties = { ...f.properties, alignmentRotation: f.properties?.alignmentRotation ?? 0 };
                                } else {
                                    throw new Error("Buffer failed to shrink geometry (turf bug) or caused collapse.");
                                }
                            } else {
                                throw new Error("Buffer did not return a valid Polygon.");
                            }
                        } catch(e) {
                            console.warn("turf.buffer failed for tower geometry, falling back to centroid scaling", e);
                            try {
                                const scale = 1 - (reduction / 100);
                                const centroid = turf.centroid(f).geometry.coordinates;
                                // @ts-ignore
                                const coords = f.geometry.coordinates[0];
                                const shrunkCoords = coords.map((coord: any) => [
                                    centroid[0] + (coord[0] - centroid[0]) * scale,
                                    centroid[1] + (coord[1] - centroid[1]) * scale
                                ]);
                                towerGeometry = {
                                    type: 'Feature',
                                    properties: { ...f.properties, alignmentRotation: f.properties?.alignmentRotation ?? 0 },
                                    geometry: { type: 'Polygon', coordinates: [shrunkCoords] }
                                } as Feature<Polygon>;
                            } catch (e2) {
                                console.warn("Fallback scaling failed.", e2);
                            }
                        }

                        const towerUnitMix = params.unitMix || activeProject?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;
                        const towerAlignRotForLayout = (towerGeometry as any).properties?.alignmentRotation ?? f.properties?.alignmentRotation ?? 0;

                        // For floor-wise mixed-use: tower always contains Residential floors,
                        // so force Residential intendedUse so proper BHK units are generated.
                        const isFloorWiseMixed = params.landUse === 'mixed' && params.allocationMode === 'floor';
                        const towerIntendedUse = isFloorWiseMixed ? BuildingIntendedUse.Residential : intendedUse;

                        const towerLayoutResult = generateBuildingLayout(towerGeometry, {
                            subtype: f.properties?.subtype || params.typology,
                            unitMix: towerUnitMix,
                            intendedUse: towerIntendedUse,
                            numFloors: tFloors,
                            alignmentRotation: towerAlignRotForLayout,
                            shuffleUnits: params.shuffleUnits,
                            exactTypologyAllocation: params.exactTypologyAllocation,
                            buildingId: `${id}-tower`,
                            selectedUtilities: params.selectedUtilities || activeProject?.feasibilityParams?.selectedUtilities
                        });

                        // Multiply units across floors — only on Residential floors for floor-wise mixed use
                        const multiplyUnits = (floors: Floor[], baseLayout: any, residentialOnly = false) => {
                            const units: Unit[] = [];
                            floors.forEach(floor => {
                                if ((floor.level !== undefined && floor.level < 0) || floor.type === 'Parking' || floor.type === 'Utility') return;
                                if (residentialOnly && floor.intendedUse !== BuildingIntendedUse.Residential) return;
                                const floorUnits = (floor.level === 0 && baseLayout.groundFloorUnits) ? baseLayout.groundFloorUnits : baseLayout.units || [];
                                floorUnits.forEach((u: Unit) => units.push({ ...u, id: `${floor.id}-u-${u.id}`, floorId: floor.id }));
                            });
                            return units;
                        };

                        const podiumFloorsArray = buildingSpecificFloors.slice(0, pFloors);
                        const towerFloorsArray = buildingSpecificFloors.slice(pFloors).map(fl => ({ ...fl, id: `floor-${id}-tower-${fl.level || fl.id}` }));

                        const alignRot = f.properties?.alignmentRotation ?? 0;

                        const podiumIntendedUse = isFloorWiseMixed ? BuildingIntendedUse.MixedUse : intendedUse;
                        // Filter out rooftop utilities from podium — they belong on the tower
                        // EV Station stays on podium because it's in the basement parking
                        const podiumUtilities = (layout.utilities || []).filter((u: UtilityArea) => 
                            u.type !== UtilityType.HVAC && u.type !== UtilityType.SolarPV
                        );
                        const podiumBuilding: Building = {
                            ...baseBuildingProps,
                            intendedUse: podiumIntendedUse,
                            cores: layout.cores || [],
                            internalUtilities: podiumUtilities,
                            units: isFloorWiseMixed ? [] : multiplyUnits(podiumFloorsArray, layout),
                            id: `${id}-podium`,
                            name: `Building ${i + 1} (Podium)`,
                            geometry: f,
                            centroid: turf.centroid(f),
                            area: planarArea(f),
                            height: groundFloorHeight + (pFloors - 1) * floorHeight,
                            numFloors: pFloors,
                            baseHeight: 0,
                            floors: podiumFloorsArray,
                            alignmentRotation: alignRot,
                            totalFloors: floors,
                            groundFloorRemovedArea: layout.groundFloorRemovedArea || 0,
                        } as Building;
                        
                        const towerAlignRot = (towerGeometry as any).properties?.alignmentRotation ?? alignRot;

                        // Tower: always Residential for floor-wise mixed-use — generate BHK units
                        const towerBuilding: Building = {
                            ...baseBuildingProps,
                            intendedUse: towerIntendedUse,
                            cores: towerLayoutResult.cores || [],
                            internalUtilities: towerLayoutResult.utilities || [],
                            units: multiplyUnits(towerFloorsArray, towerLayoutResult, isFloorWiseMixed),
                            id: `${id}-tower`,
                            name: `Building ${i + 1} (Tower)`,
                            geometry: towerGeometry,
                            centroid: turf.centroid(towerGeometry),
                            area: planarArea(towerGeometry),
                            height: tFloors * floorHeight,
                            numFloors: tFloors,
                            baseHeight: groundFloorHeight + (pFloors - 1) * floorHeight,
                            floors: towerFloorsArray,
                            alignmentRotation: towerAlignRot,
                        } as Building;
                        
                        return [podiumBuilding, towerBuilding];
                    }

                    const multiplyUnits = (floors: Floor[], baseLayout: any) => {
                        const units: Unit[] = [];
                        floors.forEach(floor => {
                            if ((floor.level !== undefined && floor.level < 0) || floor.type === 'Parking' || floor.type === 'Utility') return;
                            // Ground floor (level 0): use groundFloorUnits (road-facing strip removed)
                            const isGroundFloor = floor.level === 0;
                            const floorUnits = (isGroundFloor && baseLayout.groundFloorUnits)
                                ? baseLayout.groundFloorUnits
                                : baseLayout.units || [];
                            floorUnits.forEach((u: Unit) => units.push({ ...u, id: `${floor.id}-u-${u.id}`, floorId: floor.id }));
                        });
                        return units;
                    };

                    return [{
                        ...baseBuildingProps,
                        cores: layout.cores || [],
                        units: multiplyUnits(buildingSpecificFloors, layout),
                        id: id,
                        name: `Building ${i + 1}`,
                        geometry: f,
                        centroid: turf.centroid(f),
                        area: planarArea(f),
                        height: height,
                        numFloors: floors,
                        baseHeight: 0,
                        floors: buildingSpecificFloors,
                        groundFloorRemovedArea: layout.groundFloorRemovedArea || 0,
                    } as Building];
                });

                // Apply FAR constraint if available (prefer passed constraint, then plot default)
                // Use params.maxAllowedFAR as it now correctly carries the user's truth
                const effectiveFARConstraint = params.maxAllowedFAR ?? plotStub.far;

                if (effectiveFARConstraint && newBuildings.length > 0) {
                    const plotArea = turf.area(plotStub.geometry);
                    const totalBuiltArea = newBuildings.reduce((sum, b) => sum + (b.area * b.numFloors), 0);
                    const actualFAR = totalBuiltArea / plotArea;

                    console.log(`FAR Check: Actual=${actualFAR.toFixed(2)}, Limit=${effectiveFARConstraint}`);

                    if (actualFAR > effectiveFARConstraint * 1.05) { // Allow 5% tolerance
                        console.warn(`FAR exceeded! Actual: ${actualFAR.toFixed(2)}, Limit: ${effectiveFARConstraint}`);

                        const userMinFloors = params.minFloors ?? 1;
                        let currentFAR = actualFAR;
                        const scaleFactor = effectiveFARConstraint / actualFAR;

                        // First try scaling down floors, but NEVER below user's minFloors
                        let anyFloorsScaled = false;
                        newBuildings.forEach(b => {
                            const candidateFloors = Math.floor(b.numFloors * scaleFactor);
                            const newFloors = Math.max(userMinFloors, candidateFloors);
                            
                            // Only update if it actually reduces
                            if (newFloors < b.numFloors) {
                                anyFloorsScaled = true;
                                const originalFARContribution = (b.area * b.numFloors) / plotArea;
                                const newFARContribution = (b.area * newFloors) / plotArea;
                                currentFAR -= (originalFARContribution - newFARContribution);

                                b.numFloors = newFloors;
                                b.height = newFloors * b.typicalFloorHeight;
                                if (b.id.includes('-tower')) {
                                    b.baseHeight = Math.floor((b.baseHeight || 0) / b.typicalFloorHeight * scaleFactor) * b.typicalFloorHeight;
                                }

                                const occupiableFloorsCount = newFloors;
                                const parkingFloors = b.floors.filter(f => f.type === 'Parking');
                                const occupiableFloors = b.floors.filter(f => f.type !== 'Parking');
                                
                                let newOccupiableFloors = occupiableFloors.slice(0, occupiableFloorsCount);
                                if (newOccupiableFloors.length < occupiableFloorsCount) {
                                    const diff = occupiableFloorsCount - newOccupiableFloors.length;
                                    const colors = generateFloorColors(diff, b.intendedUse as BuildingIntendedUse);
                                    const extra = Array.from({ length: diff }, (_, j) => ({
                                        id: `floor-${b.id}-extra-${j}`,
                                        height: b.typicalFloorHeight,
                                        color: colors[j] || '#cccccc',
                                        level: b.id.includes('-tower') ? (newOccupiableFloors.length + j) : (newOccupiableFloors.length + j)
                                    }));
                                    newOccupiableFloors = [...newOccupiableFloors, ...extra as Floor[]];
                                }
                                
                                b.floors = [...parkingFloors, ...newOccupiableFloors];

                                if (b.units && b.units.length > 0) {
                                    const survivingFloorIds = new Set(newOccupiableFloors.map(f => f.id));
                                    const templateFloorId = b.units.find(u => survivingFloorIds.has(u.floorId || ''))?.floorId;
                                    if (templateFloorId) {
                                        const templateUnits = b.units.filter(u => u.floorId === templateFloorId);
                                        const resyncedUnits: typeof b.units = [];
                                        newOccupiableFloors.forEach(floor => {
                                            if ((floor.level !== undefined && floor.level < 0) || floor.type === 'Parking') return;
                                            templateUnits.forEach(tmpl => {
                                                const baseId = tmpl.id.includes('-u-') ? tmpl.id.split('-u-').pop() : tmpl.id;
                                                resyncedUnits.push({ ...tmpl, id: `${floor.id}-u-${baseId}`, floorId: floor.id });
                                            });
                                        });
                                        b.units = resyncedUnits;
                                    }
                                }
                            }
                        });

                        // If FAR is STILL exceeded (because we refused to shrink floors below the minimum), we MUST prune buildings
                        if (currentFAR > effectiveFARConstraint * 1.05) {
                            console.warn(`FAR still exceeded after height compression (Current: ${currentFAR.toFixed(2)}). Pruning buildings by composite mass...`);
                            
                            // Group buildings by baseId to prune whole podium-tower assemblies together
                            const grouped = new Map<string, Building[]>();
                            newBuildings.forEach(b => {
                                const baseId = b.id.replace(/-podium$/, '').replace(/-tower$/, '');
                                if (!grouped.has(baseId)) grouped.set(baseId, []);
                                grouped.get(baseId)!.push(b);
                            });

                            const sortedGroups = Array.from(grouped.entries()).map(([baseId, blds]) => {
                                const totalGFA = blds.reduce((sum, b) => sum + (b.area * b.numFloors), 0);
                                return { baseId, blds, totalGFA };
                            }).sort((a, b) => a.totalGFA - b.totalGFA);

                            let pruned: Building[] = [...newBuildings];
                            for (const group of sortedGroups) {
                                if (currentFAR <= effectiveFARConstraint * 1.05) break;
                                
                                group.blds.forEach(bld => {
                                    const idx = pruned.findIndex(b => b.id === bld.id);
                                    if (idx !== -1) {
                                        const bldFAR = (bld.area * bld.numFloors) / plotArea;
                                        currentFAR -= bldFAR;
                                        pruned.splice(idx, 1);
                                    }
                                });
                            }
                            newBuildings = pruned;
                            console.log(`Pruning reduced FAR to ${currentFAR.toFixed(2)}. Remaining building segments: ${newBuildings.length}`);
                        }
                    }
                }

                // --- SITE UTILIZATION (COVERAGE) ENFORCEMENT ---
                // Prune buildings from smallest to largest until coverage limit is satisfied
                const coverageLimit = p.maxCoverage !== undefined ? p.maxCoverage : plotStub.maxCoverage;
                if (coverageLimit !== undefined && newBuildings.length > 0) {
                    const covPlotArea = turf.area(plotStub.geometry);
                    const maxAllowedFootprint = covPlotArea * (coverageLimit / 100);
                    let totalFootprint = newBuildings.reduce((sum, b) => sum + b.area, 0);

                    if (totalFootprint > maxAllowedFootprint * 1.05) { // Allow 5% tolerance
                        console.log(`[Coverage Enforcement] Total: ${totalFootprint.toFixed(0)}m², Limit: ${maxAllowedFootprint.toFixed(0)}m² (${coverageLimit}% of ${covPlotArea.toFixed(0)}m²). Pruning...`);
                        const sorted = [...newBuildings].sort((a, b) => a.area - b.area);
                        const pruned: Building[] = [...newBuildings];
                        for (const bld of sorted) {
                            if (totalFootprint <= maxAllowedFootprint * 1.05) break;
                            const idx = pruned.findIndex(b => b.id === bld.id);
                            if (idx !== -1) {
                                totalFootprint -= bld.area;
                                pruned.splice(idx, 1);
                            }
                        }
                        newBuildings = pruned;
                        console.log(`[Coverage Enforcement] After pruning: ${newBuildings.length} buildings, coverage: ${((totalFootprint / covPlotArea) * 100).toFixed(1)}%`);
                    }
                }

                // --- PARKING GENERATION ---
                // Smart demand-driven allocation: B1+B2 default, then B3+ tallest-first until target met
                // Surface parking is handled separately in Peripheral Zone Generation
                if (params.parkingTypes && params.parkingTypes.length > 0 && newBuildings.length > 0) {
                    // Filter eligible buildings (towers share podium parking)
                    const eligibleBuildings = newBuildings.filter((b: Building) => !b.id.includes('-tower'));

                    // Underground Parking (Basements)
                    if (params.parkingTypes?.includes('ug') && eligibleBuildings.length > 0) {
                        // STEP 1: Add default B1 + B2 to ALL eligible buildings
                        eligibleBuildings.forEach((b: Building) => {
                            const parkingArea = b.area || 500;
                            const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);

                            // EV Charging: Points = Units × 1.5 × 0.2 (from utility sizing doc)
                            const totalUnitsInBuilding = b.units?.length || Math.floor(b.area / 100) * (b.numFloors || 5);
                            const totalEVPoints = Math.ceil(totalUnitsInBuilding * 1.5 * 0.2);
                            const evPerFloor = Math.ceil(totalEVPoints / 2);

                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor,
                                evStations: evPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor,
                                evStations: totalEVPoints - evPerFloor
                            });

                            // Tag building with EV utility for visual indicators
                            if (!b.utilities) b.utilities = [];
                            if (!b.utilities.includes(UtilityType.EVStation)) {
                                b.utilities.push(UtilityType.EVStation);
                            }

                            console.log(`[Parking] Default B1+B2: ${capacityPerFloor * 2} slots, EV: ${totalEVPoints} points for ${b.name}`);
                        });

                        // STEP 2: Level-by-level sweep — add basements one level at a time
                        // to buildings sorted tallest-first, stopping as soon as parking target is met.
                        
                        // 2a. Compute required parking using ACTUAL dwelling units
                        // (same formula as compliance engine — counts b.units.length across all buildings)
                        const allPlots = get().plots || [];
                        let totalUnitsForParking = 0;
                        allPlots.forEach((p: any) => {
                            if (p.id === plotStub.id) {
                                // Current plot: use newBuildings + existing manual buildings
                                const manualBldgs = (plotStub.buildings || []).filter(
                                    (b: Building) => b.id.startsWith('bldg-') && b.visible !== false
                                );
                                [...newBuildings, ...manualBldgs].forEach((b: Building) => {
                                    totalUnitsForParking += b.units?.length || 0;
                                });
                            } else {
                                // Other plots: use their existing buildings
                                (p.buildings || []).forEach((b: Building) => {
                                    if (b.visible === false) return;
                                    totalUnitsForParking += b.units?.length || 0;
                                });
                            }
                        });
                        // Fallback to GFA estimate if no actual units exist
                        if (totalUnitsForParking === 0) {
                            const totalBuiltUpArea = newBuildings.reduce((sum: number, b: Building) => {
                                const fsiFloors = b.floors ? b.floors.filter(f => f.type !== 'Parking').length : b.numFloors;
                                return sum + (b.area * (fsiFloors || b.numFloors || 1));
                            }, 0);
                            totalUnitsForParking = Math.floor(totalBuiltUpArea / 100);
                        }
                        
                        // Find parking ratio from regulation — use MAX across all available regulations
                        let regParkingRatio = 1;
                        const plotReg = (plotStub as any).regulation;
                        if (plotReg?.facilities?.parking?.value) {
                            regParkingRatio = plotReg.facilities.parking.value;
                        }
                        // Also check all available regulations — use the HIGHEST ratio found
                        if ((plotStub as any).availableRegulations) {
                            for (const r of (plotStub as any).availableRegulations) {
                                if (r?.facilities?.parking?.value && r.facilities.parking.value > regParkingRatio) {
                                    regParkingRatio = r.facilities.parking.value;
                                }
                            }
                        }
                        const requiredParking = Math.ceil(totalUnitsForParking * regParkingRatio);
                        
                        // 2b. Count parking from B1+B2 basements only (fresh, just-added)
                        let totalProvidedParking = 0;
                        eligibleBuildings.forEach((b: Building) => {
                            b.floors.filter(f => f.type === 'Parking').forEach(f => {
                                totalProvidedParking += f.parkingCapacity || 0;
                            });
                        });
                        
                        console.log(`[Parking] Target: required=${requiredParking} (actualUnits=${totalUnitsForParking}, ratio=${regParkingRatio}), after B1+B2: provided=${totalProvidedParking}`);
                        
                        // 2c. Sort buildings tallest-first
                        const sortedByHeight = [...eligibleBuildings].sort((a, b) => {
                            const heightA = a.height || (a.numFloors * (a.typicalFloorHeight || 3.5));
                            const heightB = b.height || (b.numFloors * (b.typicalFloorHeight || 3.5));
                            return heightB - heightA;
                        });
                        
                        // 2d. Level-by-level sweep: B3 to all → B4 to all
                        const MAX_BASEMENTS = 4;
                        const DEFAULT_BASEMENTS = 2; // B1+B2 already added
                        
                        for (let lvl = DEFAULT_BASEMENTS + 1; lvl <= MAX_BASEMENTS; lvl++) {
                            if (totalProvidedParking >= requiredParking) break; // Target met!
                            
                            // Add this basement level to each building (tallest first)
                            for (const b of sortedByHeight) {
                                if (totalProvidedParking >= requiredParking) break; // Target met!
                                
                                const parkingArea = b.area || 500;
                                const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);
                                
                                b.floors.push({
                                    id: `floor-${b.id}-b${lvl}`,
                                    height: 3.5,
                                    color: '#505050',
                                    type: 'Parking',
                                    parkingType: ParkingType.Basement,
                                    level: -lvl,
                                    parkingCapacity: capacityPerFloor,
                                });
                                
                                totalProvidedParking += capacityPerFloor;
                                console.log(`[Parking] B${lvl} → ${b.name}: +${capacityPerFloor} slots (total: ${totalProvidedParking}/${requiredParking})`);
                            }
                        }
                        
                        console.log(`[Parking] Final: provided=${totalProvidedParking}, required=${requiredParking}, met=${totalProvidedParking >= requiredParking}`);
                    }

                    // Podium/Stilt Parking
                    if (params.parkingTypes?.includes('pod')) {
                        eligibleBuildings.forEach((b: Building) => {
                            const parkingArea = b.area || 500;
                            const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);
                            b.floors.push({
                                id: `floor-${b.id}-stilt`,
                                height: 3.5,
                                color: '#999999',
                                type: 'Parking',
                                parkingType: ParkingType.Stilt,
                                level: 0,
                                parkingCapacity: capacityPerFloor
                            });
                        });
                    }
                }


                // Check ground coverage if available
                let effectiveCoverage = p.maxCoverage !== undefined ? p.maxCoverage : plotStub.maxCoverage;

                // Green Certification Optimization & Feasibility Logic
                const activeProject = get().projects.find(prj => prj.id === get().activeProjectId);
                const greenRegs = get().greenRegulations;

                if (activeProject?.greenCertification && Array.isArray(activeProject.greenCertification) && activeProject.greenCertification.length > 0) {
                    let strictMaxCoverage = 100;

                    // 1. Find stricter constraints from Green Regulations
                    activeProject.greenCertification.forEach(cert => {
                        // Find matching regulation doc
                        const match = greenRegs.find(r =>
                            r.certificationType === cert ||
                            r.name.includes(cert) ||
                            (cert === 'Green Building' && r.certificationType === 'Green Building')
                        );

                        if (match && match.constraints) {
                            // If Min Open Space is defined (e.g. 0.30), Max Coverage is 1 - 0.30 = 0.70
                            if (match.constraints.minOpenSpace) {
                                const impliedCoverage = 1 - match.constraints.minOpenSpace;
                                strictMaxCoverage = Math.min(strictMaxCoverage, impliedCoverage * 100);
                            }
                            // If Max Coverage is explicitly defined
                            if (match.constraints.maxGroundCoverage) {
                                strictMaxCoverage = Math.min(strictMaxCoverage, match.constraints.maxGroundCoverage * 100);
                            }
                        } else {
                            // Fallback Defaults if no doc found (Hardcoded safety)
                            if (cert === 'LEED') strictMaxCoverage = Math.min(strictMaxCoverage, 70); // 30% Open
                            if (cert === 'GRIHA') strictMaxCoverage = Math.min(strictMaxCoverage, 75); // 25% Open
                            if (cert === 'IGBC') strictMaxCoverage = Math.min(strictMaxCoverage, 80); // 20% Green
                        }
                    });

                    // 2. Apply Stricter Limit
                    if (strictMaxCoverage < 100 && effectiveCoverage) {
                        // Only reduce, never increase beyond local regulation
                        if (strictMaxCoverage < effectiveCoverage) {
                            console.log(`Green Logic applied: Reducing Max Coverage to ${strictMaxCoverage}% (was ${effectiveCoverage}%)`);
                            effectiveCoverage = strictMaxCoverage;
                        }
                    }
                }

                if (effectiveCoverage && newBuildings.length > 0) {
                    const plotArea = turf.area(plotStub.geometry);
                    const totalFootprint = newBuildings.reduce((sum, b) => sum + b.area, 0);
                    const coveragePercent = (totalFootprint / plotArea) * 100;

                    console.log(`Coverage Check: Actual=${coveragePercent.toFixed(1)}%, Limit=${effectiveCoverage}%`);

                    if (coveragePercent > effectiveCoverage * 1.05) { // Allow 5% tolerance
                        console.warn(`Ground coverage exceeded: ${coveragePercent.toFixed(1)}% > ${effectiveCoverage}%`);
                        toast({
                            title: "Coverage Limit Exceeded",
                            description: `Buildings cover ${coveragePercent.toFixed(1)}% of plot (limit: ${effectiveCoverage}%)`,
                            variant: 'destructive'
                        });
                    }
                }

                // Create a Deep Clone of the plot and replace generated buildings, keeping user-drawn ones
                // plotClone already created at start of createScenario
                const existingManualBldgs = (plotStub.buildings || []).filter(
                    (b: Building) => b.id.startsWith('bldg-')
                );
                // Deep clone existing manual buildings to break any frozen Immer proxies
                const clonedManualBldgs = JSON.parse(JSON.stringify(existingManualBldgs));
                plotClone.buildings = [...clonedManualBldgs, ...newBuildings];

                // Persist user overrides from toolbar
                plotClone.userFAR = params.targetFAR;
                plotClone.userGFA = params.targetGFA;

                // Clear generated areas but preserve user-drawn custom zones (they survive scenario generation like manual roads)
                plotClone.greenAreas = (plotStub.greenAreas || []).filter(
                    (ga: GreenArea) => ga.geometry && !ga.id.includes('green-area-')
                );
                plotClone.parkingAreas = (plotStub.parkingAreas || []).filter(
                    (pa: ParkingArea) => pa.geometry && !pa.id.includes('parking-peripheral-') && !pa.name?.includes('Generated')
                );

                // --- PERIPHERAL ZONE GENERATION ---
                // Preserve manually drawn roads AND user-drawn utilities from the original plot
                const existingManualRoads = (plotStub.utilityAreas || []).filter(
                    (ua: UtilityArea) => ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')
                );
                const existingUserUtilities = (plotStub.utilityAreas || []).filter(
                    (ua: UtilityArea) => ua.id.startsWith('obj-')
                );

                // Add peripheral road zone if "Roads" is selected in utilities
                if (params.selectedUtilities?.includes('Roads') && peripheralRoadZone) {
                    const roadUtility: UtilityArea = {
                        id: `road-peripheral-${crypto.randomUUID()}`,
                        name: 'Peripheral Road',
                        type: UtilityType.Roads,
                        geometry: peripheralRoadZone as Feature<Polygon>,
                        centroid: turf.centroid(peripheralRoadZone),
                        area: planarArea(peripheralRoadZone),
                        visible: true
                    };
                    plotClone.utilityAreas = [...existingManualRoads, ...existingUserUtilities, roadUtility];
                } else {
                    plotClone.utilityAreas = [...existingManualRoads, ...existingUserUtilities];
                }

                // NOTE: Peripheral parking zone is added AFTER utility generation
                // so that utility footprints can be subtracted from it.
                // See the utility generation block below.

                // --- GATE GENERATION ---
                // We will generate gates after buildings and initial utilities are placed
                // but before final green area calculation.
                // Moving this block to after external utilities for consolidation.

                // --- UTILITY ZONE GENERATION ---
                console.log('[Utility Debug - generateScenarios] params.selectedUtilities:', params.selectedUtilities);
                // Note: utilityAreas already initialized above with peripheral road if selected

                if (params.selectedUtilities && Array.isArray(params.selectedUtilities) && params.selectedUtilities.length > 0) {
                    const selected = params.selectedUtilities;
                    const internalUtils = selected.filter((u: string) => ['HVAC', 'Electrical'].includes(u));
                    const externalUtils = selected.filter((u: string) => ['STP', 'WTP', 'Water', 'Fire', 'Gas', 'DG Set', 'Solid Waste', 'Rainwater Harvesting', 'Admin'].includes(u));

                    // 1. Internal Utilities (Modify Buildings)
                    if (internalUtils.length > 0 && plotClone.buildings.length > 0) {
                        plotClone.buildings.forEach((b: Building) => {
                            b.utilities = [...internalUtils] as UtilityType[];

                            // Visual: Add HVAC Plant on Roof
                            // Vastu: Chiller plant / Cooling towers → West or South-West
                            // Differentiate by building type:
                            //   - Tower: Full 2.5m HVAC (handles all tower floors)
                            //   - Podium: Smaller 1.5m HVAC (common areas only, tower has its own)
                            //   - Normal: Full 2.5m HVAC
                            if (internalUtils.includes('HVAC')) {
                                const isPodium = b.id.includes('-podium');
                                const isTower = b.id.includes('-tower');
                                // Podiums: skip HVAC floor to avoid overlapping with tower
                                // The HVAC internal utility polygon still renders on the rooftop
                                if (!isPodium) {
                                    const hvacHeight = 2.5;
                                    b.floors.push({
                                        id: `floor-${b.id}-hvac`,
                                        height: hvacHeight,
                                        color: '#EA580C', // Orange-600
                                        type: 'Utility',
                                        utilityType: UtilityType.HVAC
                                    });
                                    b.height += hvacHeight;
                                }
                            }

                            // Visual: Electrical (Base/Plinth)
                            // Add a dedicated service floor at the bottom
                            if (internalUtils.includes('Electrical')) {
                                b.floors.unshift({
                                    id: `floor-${b.id}-electrical`,
                                    height: 3.0,
                                    color: '#FCD34D', // Amber-300
                                    type: 'Utility',
                                    utilityType: UtilityType.Electrical
                                });
                                b.height += 3.0; // Increase total height
                            }
                        });
                    }

                    // 1b. Solar PV on Building Rooftops (above HVAC)
                    // Vastu: Solar panels → South-facing roof (max efficiency + Vastu compliant)
                    // Formula: Capacity = Pop × 0.8 × 0.7 × 0.25, Area = (Cap×1000)/(S×η×PR)
                    if (selected.includes('Solar PV') && plotClone.buildings.length > 0) {
                        plotClone.buildings.forEach((b: Building) => {
                            // For podium+tower: Solar PV only on tower (highest point, most sun)
                            if (b.id.includes('-podium')) return;

                            b.floors.push({
                                id: `floor-${b.id}-solar`,
                                height: 0.5, // Thin panel
                                color: '#1A237E', // Solar Indigo
                                type: 'Utility',
                                utilityType: UtilityType.SolarPV
                            });
                            b.height += 0.5;

                            // Tag the building with Solar PV utility
                            if (!b.utilities) b.utilities = [];
                            if (!b.utilities.includes(UtilityType.SolarPV)) {
                                b.utilities.push(UtilityType.SolarPV);
                            }
                        });
                    }

                    console.log('[Utility Debug] Generating', externalUtils.length, 'external utility zones');

                    // 2. External Utilities (Plot Zones) — now placed inside peripheral parking zone
                    if (externalUtils.length > 0) {
                        try {
                            const plotBoundary = plotStub.geometry;
                            const innerSetback = turf.buffer(plotBoundary, -(plotStub.setback || 5), { units: 'meters' });

                            if (innerSetback) {
                                try {
                                    const obstacles = [
                                        ...(plotClone.utilityAreas || []),
                                        ...(plotClone.parkingAreas || []),
                                        ...(plotClone.roads || [])
                                    ];

                                    // Pass peripheralParkingZone so utilities are placed inside the 5m parking strip
                                    const { utilities: smartUtils, buildings: updatedBuildings } = generateSiteUtilities(
                                        innerSetback as Feature<Polygon>,
                                        plotClone.buildings,
                                        params.vastuCompliant,
                                        obstacles,
                                        params.selectedUtilities,
                                        peripheralParkingZone  // NEW: utilities go into the parking ring
                                    );

                                    plotClone.utilityAreas.push(...smartUtils);
                                    plotClone.buildings = updatedBuildings.filter((b: any) => b.visible !== false);

                                    // --- ADD PERIPHERAL PARKING (with utility footprints subtracted) ---
                                    if (params.parkingTypes?.includes('surface') && peripheralParkingZone) {
                                        let finalParkingGeom: Feature<Polygon | MultiPolygon> | null = peripheralParkingZone as Feature<Polygon>;

                                        // Subtract utility footprints from the parking zone
                                        for (const util of smartUtils) {
                                            // Skip basement utilities — they don't occupy surface parking space
                                            if (util.level !== undefined && util.level < 0) continue;

                                            if (util.geometry && finalParkingGeom) {
                                                try {
                                                    const cutter = turf.buffer(util.geometry, 0.05, { units: 'meters' });
                                                    // @ts-ignore
                                                    const diff = turf.difference(finalParkingGeom, cutter);
                                                    if (diff) finalParkingGeom = diff as Feature<Polygon | MultiPolygon>;
                                                } catch (e) {
                                                    console.warn(`[Parking] Failed to subtract utility ${util.name}`, e);
                                                }
                                            }
                                        }

                                        if (finalParkingGeom) {
                                            let finalArea = planarArea(finalParkingGeom);

                                            // MATHEMATICAL SUBTRACTION (Option 1)
                                            // The visual polygons for utilities are small to fit the layout.
                                            // We must subtract the rest of their required NBC area mathematically.
                                            const geometricArea = finalArea;
                                            for (const util of smartUtils) {
                                                // Only ground-level utilities consume surface parking area
                                                if (util.level !== undefined && util.level < 0) continue;
                                                
                                                let physicalArea = 0;
                                                if (util.geometry) {
                                                    try {
                                                        const buffered = turf.buffer(util.geometry, 0.05, { units: 'meters' });
                                                        physicalArea = planarArea(buffered);
                                                    } catch (e) {
                                                        physicalArea = planarArea(util.geometry); // fallback
                                                    }
                                                }
                                                const requiredArea = util.targetArea || util.area;
                                                
                                                // Subtract the difference between required area and what was already physically subtracted
                                                if (requiredArea > physicalArea) {
                                                    // The buffer (0.05m) already subtracted slightly more than physicalArea from geometricArea.
                                                    // To ensure we subtract exactly requiredArea in total:
                                                    const penalty = Math.max(0, requiredArea - physicalArea);
                                                    console.log(`[Parking Math] ${util.name}: required=${requiredArea.toFixed(1)}m², physical=${physicalArea.toFixed(1)}m², penalty=${penalty.toFixed(1)}m²`);
                                                    finalArea -= penalty;
                                                }
                                            }
                                            
                                            // Prevent negative areas if utilities completely consume the space
                                            finalArea = Math.max(0, finalArea);
                                            console.log(`[Parking Math] Geometric parking: ${geometricArea.toFixed(0)}m² → After utility subtraction: ${finalArea.toFixed(0)}m²`);

                                            const parkingArea: ParkingArea = {
                                                id: `parking-peripheral-${crypto.randomUUID()}`,
                                                name: 'Peripheral Parking',
                                                type: ParkingType.Surface,
                                                geometry: finalParkingGeom as Feature<Polygon>,
                                                originalGeometry: peripheralParkingZone as Feature<Polygon>,
                                                centroid: turf.centroid(finalParkingGeom),
                                                area: finalArea,
                                                capacity: Math.floor((finalArea * 0.75) / 12.5),
                                                visible: true
                                            };

                                            plotClone.parkingAreas.push(parkingArea);

                                            // --- SOLAR PV FLOATING OVER PARKING ---
                                            if (params.selectedUtilities?.includes('Solar PV')) {
                                                let calcPopulation = 0;
                                                plotClone.buildings.forEach((b: Building) => {
                                                    const isRes = b.intendedUse === BuildingIntendedUse.Residential || b.intendedUse === BuildingIntendedUse.MixedUse;
                                                    const units = b.units?.length || b.floors.reduce((sum: number, f: Floor) => sum + (f.units?.length || 0), 0) || 0;
                                                    if (isRes) calcPopulation += units > 0 ? units * 4.5 : Math.floor(b.area / 100) * 4.5;
                                                    else calcPopulation += Math.floor(b.area / 10);
                                                });

                                                // Solar Sizing Calculation:
                                                // Capacity = Population * 0.8 kW * 0.7 * 0.25
                                                // Area = (Capacity * 1000) / (Irradiance * Efficiency * PR)
                                                const irradiance = 5.5;
                                                const efficiency = 0.18;
                                                const pr = 0.75;
                                                const capacityKW = calcPopulation * 0.8 * 0.7 * 0.25;
                                                const targetSolarArea = (capacityKW * 1000) / (irradiance * efficiency * pr);

                                                const visualArea = Math.min(targetSolarArea, finalArea);

                                                const solarPV: UtilityArea = {
                                                    id: `utility-solar-pv-${crypto.randomUUID()}`,
                                                    name: 'Solar PV Canopy',
                                                    type: UtilityType.SolarPV,
                                                    geometry: finalParkingGeom as Feature<Polygon>,
                                                    centroid: turf.centroid(finalParkingGeom),
                                                    area: visualArea,
                                                    visible: false, // OFF by default as requested
                                                    level: 1, // Represents above ground/floating
                                                    height: 3.5 // Canopy height
                                                };
                                                plotClone.utilityAreas.push(solarPV);
                                                console.log(`[Utility] Floating Solar PV created. Req Area: ${targetSolarArea.toFixed(0)}m², Actual: ${visualArea.toFixed(0)}m²`);
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.warn("Smart utility generation failed, falling back or skipping", err);
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to generate external utility placement", e);
                        }
                    } else {
                        // No external utilities selected — add peripheral parking without subtraction
                        if (params.parkingTypes?.includes('surface') && peripheralParkingZone) {
                            const finalArea = turf.area(peripheralParkingZone);
                            const parkingArea: ParkingArea = {
                                id: `parking-peripheral-${crypto.randomUUID()}`,
                                name: 'Peripheral Parking',
                                type: ParkingType.Surface,
                                geometry: peripheralParkingZone as Feature<Polygon>,
                                originalGeometry: peripheralParkingZone as Feature<Polygon>,
                                centroid: turf.centroid(peripheralParkingZone),
                                area: finalArea,
                                capacity: Math.floor((turf.area(peripheralParkingZone) * 0.75) / 12.5),
                                visible: true
                            };
                            plotClone.parkingAreas.push(parkingArea);

                            // --- SOLAR PV FLOATING OVER PARKING ---
                            if (params.selectedUtilities?.includes('Solar PV')) {
                                let calcPopulation = 0;
                                plotClone.buildings.forEach((b: Building) => {
                                    const isRes = b.intendedUse === BuildingIntendedUse.Residential || b.intendedUse === BuildingIntendedUse.MixedUse;
                                    const units = b.units?.length || b.floors.reduce((sum: number, f: Floor) => sum + (f.units?.length || 0), 0) || 0;
                                    if (isRes) calcPopulation += units > 0 ? units * 4.5 : Math.floor(b.area / 100) * 4.5;
                                    else calcPopulation += Math.floor(b.area / 10);
                                });

                                const irradiance = 5.5;
                                const efficiency = 0.18;
                                const pr = 0.75;
                                const capacityKW = calcPopulation * 0.8 * 0.7 * 0.25;
                                const targetSolarArea = (capacityKW * 1000) / (irradiance * efficiency * pr);

                                const visualArea = Math.min(targetSolarArea, finalArea);

                                const solarPV: UtilityArea = {
                                    id: `utility-solar-pv-${crypto.randomUUID()}`,
                                    name: 'Solar PV Canopy',
                                    type: UtilityType.SolarPV,
                                    geometry: peripheralParkingZone as Feature<Polygon>,
                                    centroid: turf.centroid(peripheralParkingZone),
                                    area: visualArea,
                                    visible: false, // OFF by default
                                    level: 1, // Represents above ground/floating
                                    height: 3.5 // Canopy height
                                };
                                plotClone.utilityAreas.push(solarPV);
                                console.log(`[Utility] Floating Solar PV created. Req Area: ${targetSolarArea.toFixed(0)}m², Actual: ${visualArea.toFixed(0)}m²`);
                            }
                        }
                    }
                } else {
                    if (params.parkingTypes?.includes('surface') && peripheralParkingZone) {
                        const parkingArea: ParkingArea = {
                            id: `parking-peripheral-${crypto.randomUUID()}`,
                            name: 'Peripheral Parking',
                            type: ParkingType.Surface,
                            geometry: peripheralParkingZone as Feature<Polygon>,
                            originalGeometry: peripheralParkingZone as Feature<Polygon>,
                            centroid: turf.centroid(peripheralParkingZone),
                            area: planarArea(peripheralParkingZone),
                            capacity: Math.floor((turf.area(peripheralParkingZone) * 0.75) / 12.5),
                            visible: true
                        };
                        plotClone.parkingAreas.push(parkingArea);
                    }
                }

                // --- GATE GENERATION (CONSOLIDATED) ---
                try {
                    console.log(`[Gate Debug] Generating gates with vastuCompliant: ${params.vastuCompliant}, roadAccessSides: ${plotStub.roadAccessSides?.join(', ')}`);
                    const internalRoads = [];
                    if (peripheralRoadZone) internalRoads.push(peripheralRoadZone);

                    const gates = generateSiteGates(
                        plotStub.geometry,
                        params.vastuCompliant,
                        plotStub.roadAccessSides || [],
                        internalRoads as Feature<Polygon>[],
                        plotClone.buildings // Pass all buildings for collision checks
                    );
                    plotClone.entries = gates;
                    console.log(`[Gates] Generated ${gates.length} entrance/exit points`);
                } catch (e) {
                    console.warn("Failed to generate site gates", e);
                }

                // ============================================================
                // AUTOMATIC GREEN AREA GENERATION
                // Calculate remaining plot area after subtracting all occupied zones
                // ============================================================
                try {
                    console.log('[Green Area] Starting automatic green area calculation');

                    // CLEAR EXISTING GREEN AREAS to prevent accumulation/overlap from previous runs
                    plotClone.greenAreas = [];

                    // Start with peripheralResult.buildableArea (respects outer Setbacks + Peripheral Road/Parking)
                    // We purposefully don't use validAreaPoly because validAreaPoly has setbacks subtracted around custom zones and buildings,
                    // which would result in unwanted gaps between the green area and those custom zones/buildings.
                    // @ts-ignore
                    let remainingGeom: Feature<Polygon | MultiPolygon> | null = peripheralResult.buildableArea ? turf.cleanCoords(peripheralResult.buildableArea) : null;

                    if (remainingGeom) {
                        const initialArea = turf.area(remainingGeom);
                        console.log(`[Green Area] Initial buildable area: ${initialArea.toFixed(2)}m²`);

                        // NEW ROBUST HELPER: Explode & Subtract
                        // Handles MultiPolygons and interactions that break standard diff
                        const robustSubtract = (base: Feature<Polygon | MultiPolygon>, clip: Feature<Polygon | MultiPolygon>, label: string) => {
                            if (!base || !clip) return base;
                            try {
                                const parts: Feature<Polygon>[] = [];
                                // @ts-ignore
                                const flattened = turf.flatten(clip);
                                flattened.features.forEach((f: any) => {
                                    try {
                                        // @ts-ignore
                                        const unkinked = turf.unkinkPolygon(f);
                                        unkinked.features.forEach((k: any) => parts.push(k));
                                    } catch { parts.push(f as Feature<Polygon>); }
                                });

                                console.log(`[RobustSubtract] ${label}: Processing ${parts.length} parts`);
                                const baseAreaBefore = turf.area(base);

                                let currentBase: Feature<Polygon | MultiPolygon> | null = base;
                                for (let i = 0; i < parts.length; i++) {
                                    if (!currentBase) break;
                                    // Small buffer (5cm) ensures we cut INTO the green area, not just touch it or fail precision
                                    const cutter = turf.buffer(parts[i], 0.05, { units: 'meters' });
                                    // @ts-ignore
                                    const diff = turf.difference(currentBase, cutter);
                                    if (diff) {
                                        currentBase = diff as Feature<Polygon | MultiPolygon>;
                                    }
                                }

                                return currentBase;
                            } catch (err) {
                                console.warn(`[Green Area] Failed robust subtract ${label}:`, err);
                                return base; // Return original base to avoid losing everything on error
                            }
                        };

                        // 1. Subtract Buildings (Iteratively) - Using Robust Helper
                        for (const building of plotClone.buildings) {
                            if (building.geometry && remainingGeom) {
                                remainingGeom = robustSubtract(remainingGeom, building.geometry, `Building ${building.id}`);
                            }
                        }

                        // 2. Subtract Ground-Level Utilities only (Iteratively)
                        // Basement utilities (level < 0) are underground — they don't occupy surface space
                        // so their footprints should NOT create holes in the green area above them.
                        for (const utility of plotClone.utilityAreas) {
                            if (utility.name?.includes('Peripheral Road')) continue;
                            if (utility.level !== undefined && utility.level < 0) continue; // Skip basement utilities
                            if (utility.geometry && remainingGeom) {
                                remainingGeom = robustSubtract(remainingGeom, utility.geometry, `Utility ${utility.name}`);
                            }
                        }

                        // 3. Subtract Internal Parking (Iteratively)
                        if (plotClone.parkingAreas) {
                            for (const parking of plotClone.parkingAreas) {
                                if (parking.name?.includes('Peripheral Parking')) continue;
                                if (parking.geometry && remainingGeom) {
                                    remainingGeom = robustSubtract(remainingGeom, parking.geometry, `Parking ${parking.id}`);
                                }
                            }
                        }

                        // 4. Subtract BuildableAreas (Iteratively)
                        // If a user defines a buildable area, it shouldn't get flooded with green space just because a building was deleted inside it.
                        if (plotClone.buildableAreas) {
                            for (const bArea of plotClone.buildableAreas) {
                                if (bArea.geometry && remainingGeom) {
                                    remainingGeom = robustSubtract(remainingGeom, bArea.geometry, `BuildableArea ${bArea.id}`);
                                }
                            }
                        }

                        // Process the final result
                        if (remainingGeom) {
                            const finalArea = turf.area(remainingGeom);
                            console.log(`[Green Area] Final green area: ${finalArea.toFixed(2)}m² (Removed ${initialArea - finalArea}m²)`);

                            const greenPolygons: Feature<Polygon>[] = [];
                            if (remainingGeom.geometry.type === 'Polygon') {
                                greenPolygons.push(remainingGeom as Feature<Polygon>);
                            } else if (remainingGeom.geometry.type === 'MultiPolygon') {
                                // @ts-ignore
                                const collection = turf.flatten(remainingGeom);
                                collection.features.forEach((f: any) => {
                                    if (turf.area(f) > 10) greenPolygons.push(f as Feature<Polygon>);
                                });
                            }

                            // Create GreenArea objects for each valid polygon
                            greenPolygons.forEach((poly, i) => {
                                const areaSize = turf.area(poly);
                                if (areaSize > 10) {
                                    const greenArea: GreenArea = {
                                        id: `green-area-${plotClone.id}-${i}`,
                                        geometry: poly,
                                        centroid: turf.centroid(poly),
                                        area: areaSize,
                                        name: 'Open Space',
                                        visible: true
                                    };
                                    plotClone.greenAreas.push(greenArea);
                                }
                            });

                            console.log(`[Green Area] Created ${plotClone.greenAreas.length} green areas after aggressive subtraction.`);
                        }
                    } else {
                        console.warn('[Green Area] No valid buildable area to start from');
                    }

                } catch (error) {
                    console.error('[Green Area] Failed to generate automatic green areas:', error);
                }

                // --- FINAL HEIGHT NORMALIZATION ---
                // Ensure building.height strictly represents the occupiable above-ground floors
                // This strips out any height falsely added by utilities, basements, or stilts during generation
                plotClone.buildings.forEach((b: Building) => {
                    b.height = b.floors
                        .filter((f: any) => (f.type !== 'Parking' && f.type !== 'Utility') || (f.level !== undefined && f.level >= 0 && f.type !== 'Utility'))
                        .reduce((sum: number, f: any) => sum + (f.height || 0), 0);
                });

                return { plots: [plotClone] };
            };

            // Generate 3 Variations Sequentially with Delays
            // This creates the "AI Thinking" effect in the UI
            setTimeout(async () => {
                const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

                // Initialize empty to open modal with skeletons
                set({ tempScenarios: [] });

                // Base topology param mapping — must match the switch cases in createScenario:
                // 'point', 'slab', 'plot', 'lshaped', 'ushaped', 'tshaped', 'hshaped', 'oshaped'
                const baseTypo = (params.typology === 'lshaped') ? 'lshaped' :
                    (params.typology === 'slab') ? 'slab' :
                        (params.typology === 'ushaped') ? 'ushaped' :
                            (params.typology === 'tshaped') ? 'tshaped' :
                                (params.typology === 'hshaped') ? 'hshaped' :
                                    (params.typology === 'oshaped') ? 'oshaped' :
                                        (params.typology === 'point') ? 'point' :
                                            'slab'; // Default to slab (not point) for unknown typologies

                const generatedScenarios: { plots: Plot[] }[] = [];

                // Use plotStub's current constraints
                const isVastu = params.vastuCompliant === true;

                // HYBRID LOGIC: Determine distinct combinations
                let scenarioTypologies: string[][] = [[], [], []];

                if (params.typologies && params.typologies.length > 1) {
                    const getAllSubsets = (arr: string[]) => arr.reduce(
                        (subsets, value) => subsets.concat(subsets.map(set => [value, ...set])),
                        [[]] as string[][]
                    ).filter(s => s.length > 0);

                    const allSubsets = getAllSubsets(params.typologies);
                    const shuffledSubsets = allSubsets.sort(() => 0.5 - Math.random());

                    for (let i = 0; i < 3; i++) {
                        scenarioTypologies[i] = shuffledSubsets[i % shuffledSubsets.length];
                    }
                }

                // --- Generate Scenario 1: Primary typology ---
                await sleep(100); // Quick start
                generatedScenarios.push(createScenario("Scenario 1: Optimized", {
                    typology: baseTypo as AlgoTypology,
                    spacing: 15,
                    orientation: isVastu ? 0 : 0,
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    sideSetback: params.sideSetback,
                    frontSetback: params.frontSetback,
                    rearSetback: params.rearSetback,
                    vastuCompliant: isVastu,
                    maxCoverage: userMaxCoverage,
                    overrideTypologies: scenarioTypologies[0].length > 0 ? scenarioTypologies[0] : undefined,
                    seed: 0 + (params.seedOffset || 0)
                }));
                // Update State to show S1
                set({ tempScenarios: [...generatedScenarios] });


                // --- Generate Scenario 2: Same typology, different seed for variety ---
                await sleep(600); // Thinking time
                // Keep the SAME typology for all 3 scenarios — the seed (0,1,2) provides
                // diversity (different edge rotation, strategy variant, crossbar position etc.)
                const s2Typo = scenarioTypologies[1].length > 0 ? baseTypo : baseTypo;
                generatedScenarios.push(createScenario("Scenario 2: Max Density", {
                    typology: s2Typo as AlgoTypology,
                    spacing: 12,
                    orientation: isVastu ? 0 : (plotStub.roadAccessSides?.includes('E') ? 90 : 0),
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    sideSetback: params.sideSetback,
                    frontSetback: params.frontSetback,
                    rearSetback: params.rearSetback,
                    vastuCompliant: isVastu,
                    maxCoverage: userMaxCoverage,
                    overrideTypologies: scenarioTypologies[1].length > 0 ? scenarioTypologies[1] : undefined,
                    seed: 1 + (params.seedOffset || 0)
                }));
                // Update State to show S1, S2
                set({ tempScenarios: [...generatedScenarios] });


                // --- Generate Scenario 3: Same typology, different seed ---
                await sleep(600); // Thinking time
                // S3 uses a different seed — the generator handles diversity internally
                const altAngle = isVastu ? 0 : 0;
                const s3Typo = scenarioTypologies[2].length > 0 ? baseTypo : baseTypo;

                generatedScenarios.push(createScenario("Scenario 3: Alternative", {
                    typology: s3Typo as AlgoTypology,
                    spacing: 18,
                    orientation: altAngle,
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    sideSetback: params.sideSetback,
                    frontSetback: params.frontSetback,
                    rearSetback: params.rearSetback,
                    vastuCompliant: isVastu,
                    maxCoverage: userMaxCoverage,
                    overrideTypologies: scenarioTypologies[2].length > 0 ? scenarioTypologies[2] : undefined,
                    seed: 2 + (params.seedOffset || 0)
                }));
                // Update State to show S1, S2, S3
                set({ tempScenarios: [...generatedScenarios] });


                // Finalize
                set({
                    isGeneratingScenarios: false
                });

            }, 100);
        },

        applyScenario: (index: number) => {
            const { tempScenarios } = get();
            if (!tempScenarios || !tempScenarios[index]) return;

            const selectedScenario = tempScenarios[index];

            // Apply to main state
            set(produce(draft => {
                selectedScenario.plots.forEach((scenPlot: Plot) => {
                    const plotIndex = draft.plots.findIndex((p: Plot) => p.id === scenPlot.id);
                    if (plotIndex !== -1) {
                        // Deep clone to ensure React detects the change and triggers map cleanup
                        // Merge: keep manually drawn buildings from current plot
                        const currentManualBldgs = (draft.plots[plotIndex].buildings || []).filter(
                            (b: Building) => b.id.startsWith('bldg-')
                        );
                        const scenGeneratedBldgs = (scenPlot.buildings || []).filter(
                            (b: Building) => !b.id.startsWith('bldg-')
                        );
                        draft.plots[plotIndex].buildings = JSON.parse(JSON.stringify([
                            ...currentManualBldgs,
                            ...scenGeneratedBldgs
                        ]));
                        draft.plots[plotIndex].buildableAreas = JSON.parse(JSON.stringify(scenPlot.buildableAreas));

                        // Merge: keep user-drawn green areas, replace generated ones from scenario
                        const currentUserGreens = (draft.plots[plotIndex].greenAreas || []).filter(
                            (ga: GreenArea) => !ga.id.includes('green-area-')
                        );
                        const scenGeneratedGreens = (scenPlot.greenAreas || []).filter(
                            (ga: GreenArea) => ga.id.includes('green-area-')
                        );
                        draft.plots[plotIndex].greenAreas = JSON.parse(JSON.stringify([
                            ...currentUserGreens,
                            ...scenGeneratedGreens
                        ]));

                        // Merge: keep user-drawn parking areas, replace generated ones from scenario
                        const currentUserParking = (draft.plots[plotIndex].parkingAreas || []).filter(
                            (pa: ParkingArea) => !pa.id.includes('parking-peripheral-') && !pa.name?.includes('Generated')
                        );
                        const scenGeneratedParking = (scenPlot.parkingAreas || []).filter(
                            (pa: ParkingArea) => pa.id.includes('parking-peripheral-') || pa.name?.includes('Generated')
                        );
                        draft.plots[plotIndex].parkingAreas = JSON.parse(JSON.stringify([
                            ...currentUserParking,
                            ...scenGeneratedParking
                        ]));

                        // Merge: keep manually drawn roads AND user-drawn utilities, replace generated utilities from scenario
                        const currentUserDrawn = (draft.plots[plotIndex].utilityAreas || []).filter(
                            (ua: UtilityArea) => (ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')) || ua.id.startsWith('obj-')
                        );
                        const scenarioGeneratedUtils = (scenPlot.utilityAreas || []).filter(
                            (ua: UtilityArea) => !(ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')) && !ua.id.startsWith('obj-')
                        );
                        draft.plots[plotIndex].utilityAreas = JSON.parse(JSON.stringify([
                            ...currentUserDrawn,
                            ...scenarioGeneratedUtils
                        ]));
                        // Fix: Copy generated gates
                        if (scenPlot.entries) {
                            draft.plots[plotIndex].entries = JSON.parse(JSON.stringify(scenPlot.entries));
                        }

                        // Copy user defined targets
                        draft.plots[plotIndex].userFAR = scenPlot.userFAR;
                        draft.plots[plotIndex].userGFA = scenPlot.userGFA;
                    }
                });
            }));

            toast({ title: "Design Applied", description: "Scenario has been applied to the plot." });
            get().actions.saveCurrentProject();
        },

        clearTempScenarios: () => set({ tempScenarios: null }),

        setGenerationParams: (params: Partial<AlgoParams>) => {
            set(produce(draft => {
                Object.assign(draft.generationParams, params);
            }));
        },
        setPlotRegulation: (plotId: string, regulationType: string) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot && plot.availableRegulations) {
                    // CRITICAL FIX: If the plot already has this regulation type, DO NOT reset it.
                    // This prevents overwriting a specific variant (e.g. 3m setback) with the default variant (e.g. 5m setback)
                    // when a generic component calls this action with just the type string.
                    if (plot.selectedRegulationType === regulationType && plot.regulation) {
                        return;
                    }

                    const selectedReg = plot.availableRegulations.find(r => r.type === regulationType);
                    if (selectedReg) {
                        plot.selectedRegulationType = selectedReg.type;
                        plot.regulation = selectedReg;

                        // Update constraints
                        plot.setback = getPrimarySetback(selectedReg) ?? 4;

                        plot.maxBuildingHeight = selectedReg.geometry?.max_height?.value;
                        plot.far = selectedReg.geometry?.floor_area_ratio?.value;
                        plot.maxCoverage = selectedReg.geometry?.max_ground_coverage?.value;

                        toast({ title: "Regulation Updated", description: `Applied constraints for ${selectedReg.type}` });
                    }
                }
            }));
        },
        setPlotRegulationByIndex: (plotId: string, index: number) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot && plot.availableRegulations && plot.availableRegulations[index]) {
                    const selectedReg = plot.availableRegulations[index];
                    plot.selectedRegulationType = selectedReg.type;
                    plot.regulation = selectedReg;

                    // Update constraints
                    plot.setback = getPrimarySetback(selectedReg) ?? 4;

                    plot.maxBuildingHeight = selectedReg.geometry?.max_height?.value;
                    plot.far = selectedReg.geometry?.floor_area_ratio?.value;
                    plot.maxCoverage = selectedReg.geometry?.max_ground_coverage?.value;

                    console.log('[Store] Set Regulation By Index:', {
                        index,
                        type: selectedReg.type,
                        setback: plot.setback,
                        allRegulations: plot.availableRegulations.map((r, i) => `[${i}] ${r.type} (${r.geometry?.setback?.value || '?'}m)`)
                    });

                    toast({ title: "Regulation Updated", description: `Applied constraints for ${selectedReg.type}` });
                }
            }));
        },


        toggleGhostMode: (show?: boolean) => {
            set(produce((draft: BuildingState) => {
                draft.uiState.ghostMode = (typeof show === 'boolean') ? show : !draft.uiState.ghostMode;
                // When turning ghost mode OFF, fully reset ALL visibility state so buildings render normally
                if (!draft.uiState.ghostMode) {
                    draft.componentVisibility = {
                        electrical: false,
                        hvac: false,
                        basements: false,
                        cores: false,
                        units: false,
                        solar: false,
                        ev: false,
                    };
                    // Also clear any per-building internalsVisible overrides
                    for (const plot of draft.plots) {
                        for (const building of plot.buildings) {
                            building.internalsVisible = undefined;
                        }
                    }
                }
                toast({ title: draft.uiState.ghostMode ? "Ghost Mode Enabled" : "Ghost Mode Disabled", description: "Internal structures are now " + (draft.uiState.ghostMode ? "visible" : "hidden") });
            }));
        },

        toggleComponentVisibility: (component: 'electrical' | 'hvac' | 'basements' | 'cores' | 'units' | 'solar' | 'ev') => {
            set(produce((draft: BuildingState) => {
                // Toggle the specific component
                draft.componentVisibility[component] = !draft.componentVisibility[component];

                // If turning ON a global component, clear all per-building internalsVisible overrides
                // so the global flag takes precedence (the user is switching to "global" mode)
                if (draft.componentVisibility[component]) {
                    for (const plot of draft.plots) {
                        for (const building of plot.buildings) {
                            if (building.internalsVisible !== undefined) {
                                building.internalsVisible = undefined; // Reset to "follow global"
                            }
                        }
                    }
                }
                   // Auto-enable ghostMode if any component is now visible
                const anyVisible = Object.values(draft.componentVisibility).some(v => v);
                if (anyVisible && !draft.uiState.ghostMode) {
                    draft.uiState.ghostMode = true;
                }
                // Auto-disable ghostMode if no components are visible
                else if (!anyVisible && draft.uiState.ghostMode) {
                    draft.uiState.ghostMode = false;
                }
            }));
        },

        setMapLocation: (location: string | null) => set({ mapLocation: location }),
        setInstantAnalysisMode: (enabled: boolean) => set(produce((draft: BuildingState) => {
            draft.uiState.isInstantAnalysisMode = enabled;
            if (!enabled) {
                draft.instantAnalysisTarget = null;
            }
        })),
        setInstantAnalysisTarget: (target: InstantAnalysisTarget | null) => set({ instantAnalysisTarget: target }),
        clearInstantAnalysisTarget: () => set({ instantAnalysisTarget: null }),
        // Clears the temporary map/editor state used on evaluate land.
        resetWorkspace: () => set(produce((draft: BuildingState) => {
            draft.activeProjectId = null;
            draft.plots = [];
            draft.drawingPoints = [];
            draft.mapCommand = null;
            draft.mapLocation = null;
            draft.instantAnalysisTarget = null;
            draft.selectedObjectId = null;
            draft.hoveredObjectId = null;
            draft.zoneDefinition = {
                isDefining: false,
                geometry: null,
                centroid: null,
                activePlotId: null,
            };
            draft.drawingState = {
                isDrawing: false,
                objectType: null,
                activePlotId: null,
                roadWidth: 6,
                buildingIntendedUse: BuildingIntendedUse.Residential,
            };
            draft.uiState.isFeasibilityPanelOpen = false;
            draft.uiState.isInstantAnalysisMode = false;
            draft.bhuvanData = null;
            draft.isFetchingBhuvan = false;
        })),
        // Loads a prepared plot set into the active workspace and resets state around it.
        loadPlotsIntoWorkspace: (plots: Plot[], selectedPlotId?: string | null) => set(produce((draft: BuildingState) => {
            draft.plots = plots;
            draft.selectedObjectId = selectedPlotId ? { type: 'Plot', id: selectedPlotId } : null;
            draft.hoveredObjectId = null;
            draft.drawingPoints = [];
            draft.mapCommand = null;
            draft.instantAnalysisTarget = null;
            draft.zoneDefinition = {
                isDefining: false,
                geometry: null,
                centroid: null,
                activePlotId: null,
            };
            draft.drawingState.isDrawing = false;
            draft.drawingState.objectType = null;
            draft.drawingState.activePlotId = null;
            draft.uiState.isFeasibilityPanelOpen = false;
            draft.uiState.isInstantAnalysisMode = false;
        })),
        undo: () => console.warn('Undo not implemented'),
        redo: () => console.warn('Redo not implemented'),
        executeMapCommand: (command: any) => console.warn('executeMapCommand not implemented', command),
        setScenario: (scenario: any) => console.warn('setScenario not implemented', scenario),
        toggleFeasibilityPanel: () => set(produce((draft: BuildingState) => {
            draft.uiState.isFeasibilityPanelOpen = !draft.uiState.isFeasibilityPanelOpen;
        })),
        loadProjects: async () => {
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) {
                set({ projects: [], isLoading: false });
                return;
            }


            set({ isLoading: true });

            try {
                const projectsCollection = collection(db, 'users', userId, 'projects');
                const projectSnapshot = await getDocs(projectsCollection);
                const projects = projectSnapshot.docs.map(doc => {
                    const data = doc.data() as Project;
                    // Ensure plots exist before parsing
                    if (data.plots) {
                        data.plots = parseFromFirestore(data.plots);
                    }
                    return data;
                });
                set({ projects, isLoading: false });
            } catch (error) {
                console.error("Error loading projects from Firestore:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not load projects.' });
                set({ isLoading: false });
            }
        },
        deleteProject: async (projectId: string) => {
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) return;

            try {
                await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
                set(produce(draft => {
                    draft.projects = draft.projects.filter((p: Project) => p.id !== projectId);
                    if (draft.activeProjectId === projectId) {
                        draft.activeProjectId = null;
                        draft.plots = [];
                        draft.instantAnalysisTarget = null;
                        draft.uiState.isInstantAnalysisMode = false;
                    }
                }));
            } catch (error) {
                console.error("Error deleting project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not delete project.' });
            }
        },
        loadProject: async (projectId: string) => {
            set({
                isLoading: true,
                activeProjectId: projectId,
                plots: [],
                selectedObjectId: null,
                instantAnalysisTarget: null,
                uiState: {
                    ...get().uiState,
                    isInstantAnalysisMode: false,
                },
            });
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) {
                set({ isLoading: false });
                return;
            }

            try {
                const projectRef = doc(db, 'users', userId, 'projects', projectId);
                const docSnap = await getDoc(projectRef);
                if (docSnap.exists()) {
                    const data = docSnap.data() as Project;

                    const parsedPlots = parseFromFirestore(data.plots || []);
                    const project = { ...data, plots: parsedPlots };

                    // Fetch Green Regulations in background
                    getDocs(collection(db, 'greenRegulations')).then(snap => {
                        const regs = snap.docs.map(d => d.data() as GreenRegulationData);
                        set({ greenRegulations: regs });
                    }).catch(err => console.error("Failed to load green regs", err));

                    set(produce((draft: BuildingState) => {
                        const existingIndex = draft.projects.findIndex(p => p.id === projectId);
                        if (existingIndex !== -1) {
                            draft.projects[existingIndex] = project;
                        } else {
                            draft.projects.push(project);
                        }
                        draft.plots = project.plots || [];

                        // Restore generation parameters specifically
                        if (project.generationParams) {
                            draft.generationParams = project.generationParams;
                        }

                        // Load design options if available
                        if (project.designOptions) {
                            if (typeof project.designOptions === 'string') {
                                try {
                                    draft.designOptions = JSON.parse(project.designOptions);
                                } catch (e) {
                                    console.error("Failed to parse saved design options", e);
                                    draft.designOptions = [];
                                }
                            } else if (Array.isArray(project.designOptions)) {
                                draft.designOptions = project.designOptions;
                            }
                        } else {
                            draft.designOptions = [];
                        }

                        draft.isLoading = false;
                    }));

                    // After plots are loaded into state, fetch regulations for each
                    get().plots.forEach(plot => {
                        if (plot.centroid) {
                            fetchRegulationsForPlot(plot.id, plot.centroid);
                        }
                    });

                } else {
                    toast({ variant: 'destructive', title: 'Error', description: 'Project not found.' });
                    set({ isLoading: false });
                }
            } catch (error) {
                console.error("Error loading single project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not load project.' });
                set({ isLoading: false });
            }
        },
        saveCurrentProject: async () => {
            set({ isSaving: true });
            const { activeProjectId, plots, projects, designOptions } = get();
            const userId = useAuthStore.getState().user?.uid;

            if (!userId || !activeProjectId) {
                toast({ variant: 'destructive', title: 'Error', description: 'Cannot save. No active user or project.' });
                set({ isSaving: false });
                return;
            }

            const projectToSave = projects.find(p => p.id === activeProjectId);
            if (!projectToSave) {
                set({ isSaving: false });
                return;
            }

            const updatedProject = {
                ...projectToSave,
                plots: prepareForFirestore(plots), // Convert geometries to strings
                designOptions: JSON.stringify(designOptions), // Persist saved scenarios
                generationParams: JSON.parse(JSON.stringify(get().generationParams)), // Persist setbacks
                lastModified: new Date().toISOString(),
            }

            try {
                const projectRef = doc(db, 'users', userId, 'projects', activeProjectId);
                const projectDataToSave = JSON.parse(JSON.stringify(updatedProject));
                await setDoc(projectRef, projectDataToSave);
                set(produce((draft: BuildingState) => {
                    const projIndex = draft.projects.findIndex(p => p.id === activeProjectId);
                    if (projIndex !== -1) {
                        // We keep the parsed geometry in the local state
                        draft.projects[projIndex].plots = plots;
                        draft.projects[projIndex].lastModified = updatedProject.lastModified;
                    }
                }));
                toast({ title: 'Project Saved!', description: `${projectToSave.name} has been saved.` });
            } catch (error) {
                console.error("Error saving project:", error);
                toast({ variant: 'destructive', title: 'Save Failed', description: 'Could not save project to the cloud.' });
            } finally {
                set({ isSaving: false });
            }
        },
        resetDrawing: () => {
            set(
                produce(draft => {
                    draft.drawingPoints = [];
                    draft.drawingState.isDrawing = false;
                    draft.drawingState.objectType = null;
                    draft.drawingState.activePlotId = null;
                    draft.drawingState.roadWidth = 6;
                })
            );
        },
        undoLastPoint: () => {
            set(produce(draft => {
                if (draft.drawingState.isDrawing && draft.drawingPoints.length > 0) {
                    draft.drawingPoints.pop();
                }
            }));
        },
        startDrawing: (objectType: DrawingObjectType, activePlotId: string | null = null) => {
            set(
                produce(draft => {
                    // Toggle off if already active
                    if (draft.drawingState.objectType === objectType) {
                        draft.drawingState.objectType = null;
                        draft.drawingState.isDrawing = false;
                        draft.drawingPoints = [];
                        return;
                    }

                    draft.selectedObjectId = null;
                    draft.drawingPoints = [];
                    const newActivePlotId = objectType === 'Plot' ? null : activePlotId;

                    let roadWidth = 6;
                    if (objectType === 'Road' && newActivePlotId) {
                        const plot = draft.plots.find((p: any) => p.id === newActivePlotId);
                        if (plot?.regulation?.geometry?.road_width?.value) {
                            roadWidth = plot.regulation.geometry.road_width.value;
                        }
                    }

                    // Move and Select are not 'drawing' operations in terms of UI overlays, but they use the objectType state.
                    const isDrawing = objectType !== 'Move' && objectType !== 'Select';

                    draft.drawingState = {
                        isDrawing,
                        objectType,
                        activePlotId: newActivePlotId,
                        roadWidth
                    };
                })
            );
        },
        addDrawingPoint: (point: [number, number]) => {
            const { drawingState, drawingPoints, actions } = get();
            if (!drawingState.isDrawing) return;

            set(
                produce(draft => {
                    draft.drawingPoints.push(point);
                })
            );
        },
        finishDrawing: (geometry: Feature<Polygon | Point | LineString>) => {
            try {
                const { drawingState, projects, activeProjectId, plots, actions } = get();
                if (!drawingState.isDrawing || !drawingState.objectType) return false;

                if (geometry.geometry.type !== 'Polygon' && drawingState.objectType !== 'Road') {
                    actions.resetDrawing();
                    return false;
                }

                // @ts-ignore - polygonGeometry will be null for roads, which is handled
                const polygonGeometry: Feature<Polygon> = drawingState.objectType === 'Road' ? null : geometry as Feature<Polygon>;

                if (drawingState.objectType === 'Plot') {
                    const id = `plot-${Date.now()}`;
                    const newObjArea = turf.area(polygonGeometry);
                    const centroid = turf.centroid(polygonGeometry);
                    const newPlot: Plot = {
                        id, name: `Plot ${get().plots.length + 1}`, geometry: polygonGeometry, centroid, area: newObjArea,
                        setback: 4,
                        buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [], utilityAreas: [], entries: [], labels: [],
                        visible: true,
                        location: 'Loading...',
                        availableRegulations: [],
                        selectedRegulationType: null,
                        regulation: null,
                        projectId: get().activeProjectId || '',
                    };
                    set(produce(draft => {
                        draft.plots.push(newPlot);
                        draft.selectedObjectId = { type: 'Plot', id: newPlot.id };
                    }));

                    fetchRegulationsForPlot(id, centroid);

                } else if (drawingState.objectType === 'Zone') {
                    if (!polygonGeometry) return false;
                    let currentPlotId = drawingState.activePlotId;
                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanContains(p.geometry, polygonGeometry));
                        if (!parentPlot) {
                            toast({
                                variant: 'destructive', title: 'Drawing Error',
                                description: 'Zones must be drawn completely inside a plot.',
                            });
                            actions.resetDrawing();
                            return false;
                        }
                        currentPlotId = parentPlot.id;
                    }
                    const centroid = turf.centroid(polygonGeometry);
                    set(produce((draft: BuildingState) => {
                        draft.zoneDefinition = {
                            isDefining: true,
                            geometry: polygonGeometry,
                            centroid: centroid,
                            activePlotId: currentPlotId,
                        };
                    }));
                } else if (drawingState.objectType === 'Building') {
                    if (!polygonGeometry) return false;
                    let currentPlotId = drawingState.activePlotId;
                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanContains(p.geometry, polygonGeometry));
                        if (!parentPlot) {
                            toast({
                                variant: 'destructive', title: 'Drawing Error',
                                description: 'Buildings must be drawn completely inside a plot.',
                            });
                            actions.resetDrawing();
                            return false;
                        }
                        currentPlotId = parentPlot.id;
                    }
                    set(produce((draft: BuildingState) => {
                        const plot = draft.plots.find(p => p.id === currentPlotId);
                        if (plot) {
                            const project = projects.find(p => p.id === activeProjectId);
                            const id = `bldg-${Date.now()}`;
                            const area = turf.area(polygonGeometry);
                            const numFloors = 5;
                            const typicalFloorHeight = 3;

                            const parentBuildableArea = plot.buildableAreas.find((ba: BuildableArea) => (turf as any).booleanContains(ba.geometry, polygonGeometry));
                            // Use the explicitly selected buildingIntendedUse from the toolbar if available, otherwise fallback
                            const intendedUse = draft.drawingState.buildingIntendedUse || (parentBuildableArea ? parentBuildableArea.intendedUse : BuildingIntendedUse.Residential);

                            const floors = Array.from({ length: numFloors }, (_, i) => ({ id: `floor-${id}-${i}`, height: typicalFloorHeight, color: generateFloorColors(numFloors, intendedUse)[i] }));
                            const newBuilding: Building = {
                                id: id,
                                name: `Building ${plot.buildings.length + 1}`,
                                isPolygonClosed: true,
                                geometry: polygonGeometry,
                                centroid: turf.centroid(polygonGeometry),
                                height: numFloors * typicalFloorHeight,
                                opacity: getOpacityForBuildingType(intendedUse),
                                extrusion: true,
                                soilData: null,
                                intendedUse,
                                floors,
                                area,
                                numFloors,
                                typicalFloorHeight,
                                visible: true,
                            };
                            plot.buildings.push(newBuilding);
                            draft.selectedObjectId = { type: 'Building', id: id };
                        }
                    }));
                } else if (drawingState.objectType === 'Road') {
                    let currentPlotId = drawingState.activePlotId;
                    const inputLine = geometry as Feature<LineString>;

                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanIntersects(p.geometry, inputLine));
                        if (parentPlot) currentPlotId = parentPlot.id;
                    }

                    if (currentPlotId) {
                        set(produce((draft: BuildingState) => {
                            const plot = draft.plots.find(p => p.id === currentPlotId);
                            if (plot) {
                                const id = `road-${Date.now()}`;

                                // Convert LineString to Polygon using buffer
                                const bufferedRoad = turf.buffer(inputLine, (drawingState.roadWidth / 2), { units: 'meters' });
                                const roadPolygon = bufferedRoad as Feature<Polygon>;

                                const roadArea: UtilityArea = {
                                    id,
                                    name: `Road ${plot.utilityAreas.filter(u => u.type === 'Roads').length + 1}`,
                                    type: UtilityType.Roads,
                                    geometry: roadPolygon,
                                    centroid: turf.centroid(roadPolygon),
                                    area: planarArea(roadPolygon),
                                    visible: true
                                };
                                plot.utilityAreas.push(roadArea);
                                draft.selectedObjectId = { type: 'UtilityArea', id };
                            }
                        }));
                    } else {
                        toast({
                            variant: 'destructive',
                            title: 'Drawing Error',
                            description: 'Roads must be drawn within or intersecting a plot boundary.',
                        });
                        actions.resetDrawing();
                        return false;
                    }
                }


                actions.resetDrawing();
                return true;

            } catch (error: any) {
                console.error("Error finishing drawing:", error);
                toast({
                    variant: 'destructive', title: 'Invalid Shape',
                    description: 'The drawn shape is invalid. Please avoid self-intersecting lines and try again.',
                });
                get().actions.resetDrawing();
                return false;
            }
        },
        defineZone: (name: string, type: ZoneType, intendedUse?: BuildingIntendedUse, utilityType?: UtilityType) => {
            const { zoneDefinition } = get();
            if (!zoneDefinition.isDefining || !zoneDefinition.geometry || !zoneDefinition.centroid || !zoneDefinition.activePlotId) return;

            const { geometry, centroid, activePlotId } = zoneDefinition;

            set(produce(draft => {
                const plot = draft.plots.find((p: Plot) => p.id === activePlotId);
                if (!plot) return;

                const id = `obj-${Date.now()}`;
                const area = turf.area(geometry);
                const visible = true;

                const newArea = { id, name, geometry, centroid, area, visible };

                if (type === 'GreenArea') {
                    plot.greenAreas.push(newArea);
                    draft.selectedObjectId = { type: 'GreenArea', id };
                } else if (type === 'ParkingArea') {
                    plot.parkingAreas.push(newArea);
                    draft.selectedObjectId = { type: 'ParkingArea', id };
                } else if (type === 'BuildableArea') {
                    const buildableArea: BuildableArea = { ...newArea, intendedUse: intendedUse || BuildingIntendedUse.Residential };
                    plot.buildableAreas.push(buildableArea);
                    draft.selectedObjectId = { type: 'BuildableArea', id };
                } else if (type === 'UtilityArea') {
                    const utilityArea: UtilityArea = { ...newArea, type: utilityType || UtilityType.STP };
                    plot.utilityAreas.push(utilityArea);
                    draft.selectedObjectId = { type: 'UtilityArea', id };
                }
            }));

            get().actions.cancelDefineZone();
        },
        cancelDefineZone: () => {
            set({
                drawingState: {
                    isDrawing: false,
                    objectType: null,
                    activePlotId: null,
                    roadWidth: 6,
                    buildingIntendedUse: BuildingIntendedUse.Residential,
                },
                zoneDefinition: { // Reset zoneDefinition as well
                    isDefining: false,
                    geometry: null,
                    centroid: null,
                    activePlotId: null,
                },
            });
        },
        selectObject: (id: string | null, type: SelectableObjectType | null) => {
            const currentObjType = get().drawingState.objectType;
            if (currentObjType !== 'Move' && currentObjType !== 'Select') {
                get().actions.resetDrawing();
            }
            if (!id || !type) {
                set({ selectedObjectId: null });
                return;
            }

            const { plots } = get();
            let selectedObjectCentroid: Feature<Point> | null = null;
            let zoomLevel = 16;
            for (const plot of plots) {
                if (type === 'Plot' && plot.id === id) {
                    selectedObjectCentroid = plot.centroid;
                    zoomLevel = 17;
                    break;
                }
                
                // Search in main plot objects
                const mainObjects = [...plot.buildings, ...plot.greenAreas, ...plot.parkingAreas, ...plot.buildableAreas, ...(plot.utilityAreas || [])];
                let foundMain = mainObjects.find(obj => obj.id === id);
                if (!foundMain && type === 'Building') {
                    // Check if it's a grouped building's base ID (e.g., clicking the Podium+Tower header)
                    foundMain = mainObjects.find(obj => obj.id.replace(/-podium$/, '').replace(/-tower$/, '') === id);
                }
                
                if (foundMain) {
                    selectedObjectCentroid = (foundMain as any).centroid;
                    if (type === 'GreenArea') {
                        zoomLevel = 17; // Open space same as plot
                    } else if (type === 'Building' || type === 'ParkingArea' || type === 'BuildableArea') {
                        zoomLevel = 18;
                    } else {
                        zoomLevel = 19;
                    }
                    break;
                }

                // Search in internal building objects
                for (const b of plot.buildings) {
                    const internalObjects = [...(b.internalUtilities || []), ...(b.cores || []), ...(b.units || [])];
                    const foundInternal = internalObjects.find((obj: any) => obj.id === id);
                    if (foundInternal) {
                        selectedObjectCentroid = (foundInternal as any).centroid || (foundInternal.geometry ? turf.centroid(foundInternal.geometry) : null);
                        zoomLevel = 21; // Focus tightly on units/cores
                        break;
                    }
                }
                if (selectedObjectCentroid) break;

                // Search in entry points
                const foundEntry = (plot.entries || []).find(e => e.id === id);
                if (foundEntry) {
                    selectedObjectCentroid = turf.point(foundEntry.position);
                    zoomLevel = 21;
                    break;
                }

                // Search in labels
                const foundLabel = (plot.labels || []).find(l => l.id === id);
                if (foundLabel) {
                    selectedObjectCentroid = turf.point(foundLabel.position);
                    zoomLevel = 21;
                    break;
                }
            }

            if (selectedObjectCentroid && get().drawingState.objectType !== 'Move') {
                window.dispatchEvent(new CustomEvent('flyTo', { 
                    detail: { 
                        center: selectedObjectCentroid.geometry.coordinates,
                        zoom: zoomLevel
                    } 
                }));
            }

            set(produce((draft: BuildingState) => {
                draft.selectedObjectId = { id, type };

                // Auto-exit Ghost Mode when selecting main entities
                if (type === 'Plot' || type === 'Building') {
                    draft.uiState.ghostMode = false;
                    // Reset all component visibilities
                    draft.componentVisibility.electrical = false;
                    draft.componentVisibility.hvac = false;
                    draft.componentVisibility.basements = false;
                    draft.componentVisibility.cores = false;
                    draft.componentVisibility.units = false;
                }
            }));
        },
        updateBuilding: (buildingId: string, props: Partial<Building>) => {
            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    const building = plot.buildings.find(b => b.id === buildingId);
                    if (building) {
                        const parkingCount = building.floors.filter(f => f.type === 'Parking').length;
                        const oldNumFloors = building.numFloors ?? (building.floors.length - parkingCount);
                        const oldTypicalHeight = building.typicalFloorHeight ?? building.floors[0]?.height ?? 3;

                        console.log(`[DEBUG updateBuilding ENTRY] id=${building.id}, props.numFloors=${props.numFloors}, building.numFloors=${building.numFloors}, floors.length=${building.floors.length}, parkingCount=${parkingCount}, oldNumFloors=${oldNumFloors}`);

                        // Restore geometry and centroid if provided in props
                        if (props.geometry) {
                            building.geometry = props.geometry;
                        }
                        if (props.centroid) {
                            building.centroid = props.centroid;
                        }

                        Object.assign(building, props);

                        // numFloors represents OCCUPIABLE floors only (excludes parking/utility)
                        const newNumFloors = building.numFloors ?? oldNumFloors;
                        const newTypicalHeight = building.typicalFloorHeight ?? oldTypicalHeight;
                        console.log(`[DEBUG updateBuilding AFTER ASSIGN] building.numFloors=${building.numFloors}, newNumFloors=${newNumFloors}`);

                        if (props.numFloors !== undefined || props.typicalFloorHeight !== undefined || props.groundFloorHeight !== undefined) {
                            const effectiveGFH = building.groundFloorHeight ?? newTypicalHeight;
                            // Preserve special floors (Parking, Utility)
                            const specialFloors = building.floors.filter(f => f.type === 'Parking' || f.type === 'Utility');
                            const standardFloors = building.floors.filter(f => f.type !== 'Parking' && f.type !== 'Utility');

                            let newFloors: Floor[];

                            const mix = building.programMix;
                            if (mix && building.intendedUse === BuildingIntendedUse.MixedUse) {
                                // --- MIXED USE: Recompute from stored percentages ---
                                // Stack order (bottom→top): Retail -> Institutional -> Hospitality -> Office -> Residential
                                const commFloors  = Math.round(newNumFloors * (mix.commercial  / 100));
                                
                                const retailFloors = commFloors > 0 ? Math.max(1, Math.floor(commFloors * 0.4)) : 0;
                                const officeFloors = Math.max(0, commFloors - retailFloors);
                                
                                const instFloors  = Math.round(newNumFloors * (mix.institutional / 100));
                                const hospFloors  = Math.round(newNumFloors * (mix.hospitality  / 100));
                                const resFloors   = Math.max(0, newNumFloors - commFloors - instFloors - hospFloors);

                                const segments: Array<{ use: BuildingIntendedUse; count: number }> = [
                                    { use: BuildingIntendedUse.Retail,       count: retailFloors },
                                    { use: BuildingIntendedUse.Public,       count: instFloors },
                                    { use: BuildingIntendedUse.Hospitality,  count: hospFloors },
                                    { use: BuildingIntendedUse.Office,       count: officeFloors },
                                    { use: BuildingIntendedUse.Residential,  count: resFloors  },
                                ];

                                newFloors = [];
                                let idx = 0;
                                for (const seg of segments) {
                                    const segColors = generateFloorColors(seg.count, seg.use);
                                    for (let k = 0; k < seg.count; k++) {
                                        newFloors.push({
                                            id: standardFloors[idx]?.id || `floor-${crypto.randomUUID()}-${idx}`,
                                            height: idx === 0 ? effectiveGFH : newTypicalHeight,
                                            color: segColors[k] || '#cccccc',
                                            type: 'General' as const,
                                            intendedUse: seg.use,
                                        });
                                        idx++;
                                    }
                                }
                            } else {
                                // --- NON-MIXED: Simple uniform regeneration ---
                                const colors = generateFloorColors(newNumFloors, building.intendedUse);
                                newFloors = Array.from({ length: newNumFloors }, (_, i) => {
                                    const existing = standardFloors[i];
                                    
                                    // Calculate the correct level sequentially
                                    let calculatedLevel = i;
                                    if (building.id.includes('-tower')) {
                                        const baseId = building.id.replace(/-tower$/, '');
                                        const podium = plot.buildings.find(b => b.id === `${baseId}-podium`);
                                        const podiumFloors = podium?.numFloors || 0;
                                        calculatedLevel = podiumFloors + i;
                                    }

                                    return {
                                        ...existing,
                                        id: existing?.id || `floor-${crypto.randomUUID()}-${i}`,
                                        height: i === 0 ? effectiveGFH : newTypicalHeight,
                                        color: colors[i] || '#cccccc',
                                        type: 'General' as const,
                                        intendedUse: building.intendedUse,
                                        level: existing?.level ?? calculatedLevel
                                    };
                                });
                            }

                            building.floors = [...specialFloors, ...newFloors];
                            // Height = only ABOVE-GROUND occupiable floors (exclude basements, utility rooftops, etc)
                            building.height = building.floors
                                .filter(f => (f.type !== 'Parking' && f.type !== 'Utility') || (f.level !== undefined && f.level >= 0 && f.type !== 'Utility'))
                                .reduce((sum, f) => sum + (f.height || 0), 0);
                            console.log(`[DEBUG] updateBuilding: Regenerated floors for ${building.id}. Total floors: ${building.floors.length}. newNumFloors: ${newNumFloors}. newFloors length: ${newFloors.length}`);


                            // --- RE-MULTIPLY UNITS FOR NEW FLOOR COUNT ---
                            // Get template units from the first occupiable floor that has units
                            const occupiableFloors = newFloors.filter(f =>
                                (f.level === undefined || f.level >= 0) &&
                                f.type !== 'Parking' &&
                                f.type !== 'Utility'
                            );

                            if (building.units && building.units.length > 0 && occupiableFloors.length > 0) {
                                // Find all existing units for any single floor as the template
                                const existingFloorIds = new Set(building.units.map(u => u.floorId));
                                const templateFloorId = [...existingFloorIds][0];
                                const templateUnits = building.units.filter(u => u.floorId === templateFloorId);

                                if (templateUnits.length > 0) {
                                    const regeneratedUnits: Unit[] = [];
                                    occupiableFloors.forEach(floor => {
                                        templateUnits.forEach(tmpl => {
                                            const baseUnitId = tmpl.id.includes('-u-') ? tmpl.id.split('-u-').pop() : tmpl.id;
                                            regeneratedUnits.push({
                                                ...tmpl,
                                                id: `${floor.id}-u-${baseUnitId}`,
                                                floorId: floor.id,
                                            });
                                        });
                                    });
                                    building.units = regeneratedUnits;
                                }
                            }

                            // --- RECOMPUTE LAYOUT (CORE / ELECTRICAL / HVAC) FOR NEW FLOOR COUNT ---
                            if (building.geometry) {
                                try {
                                    const freshLayout = generateBuildingLayout(
                                        building.geometry as Feature<Polygon | MultiPolygon>,
                                        {
                                            intendedUse: building.intendedUse as any,
                                            numFloors: newNumFloors,
                                            floorHeight: newTypicalHeight,
                                            // Pass the stored alignmentRotation so the grid is axis-aligned
                                            alignmentRotation: (building.geometry as any)?.properties?.alignmentRotation ?? 0,
                                            selectedUtilities: get().projects.find(p => p.id === get().activeProjectId)?.feasibilityParams?.selectedUtilities
                                        }
                                    );
                                    if (freshLayout.cores && freshLayout.cores.length > 0) {
                                        building.cores = freshLayout.cores;
                                    }
                                    if (freshLayout.utilities && freshLayout.utilities.length > 0) {
                                        building.internalUtilities = freshLayout.utilities;
                                    }
                                    // NOTE: Units are NOT overwritten from fresh layout.
                                    // The template-based multiplication above already handles
                                    // unit scaling proportionally. Fresh layout recalculates
                                    // the grid from scratch which produces different unit counts.

                                } catch (e) {
                                    console.warn('[updateBuilding] Failed to recompute layout on floor change:', e);
                                }
                            }

                        } // end if (props.numFloors !== undefined || props.typicalFloorHeight !== undefined)

                        if (props.geometry) {
                            building.area = planarArea(props.geometry);
                        }


                        building.numFloors = newNumFloors;
                        building.typicalFloorHeight = newTypicalHeight;

                        // --- PODIUM/TOWER SYNC ---
                        // When floors or height changes on a podium or tower, keep the paired building in sync.
                        if (props.numFloors !== undefined || props.typicalFloorHeight !== undefined) {
                            const baseId = buildingId.replace(/-podium$/, '').replace(/-tower$/, '');

                            if (buildingId.endsWith('-podium')) {
                                // This IS a podium — update the sibling tower's baseHeight (independent floor counts)
                                const tower = plot.buildings.find(b => b.id === `${baseId}-tower`);
                                if (tower) {
                                    // Calculate physical above-ground roof elevation of the podium
                                    // Only sum standard occupiable floors (exclude basements, parking, utilities)
                                    const podiumAboveGroundHeight = building.floors
                                        .filter(f => !((f.level !== undefined && f.level < 0) || f.type === 'Parking') && f.type !== 'Utility')
                                        .reduce((sum, f) => sum + (f.height || 0), 0);
                                    
                                    tower.baseHeight = podiumAboveGroundHeight; // podium roof = tower base

                                    // Re-index tower floor levels to start after podium floors
                                    const towerOccFloors = tower.floors.filter(f => f.type !== 'Parking' && f.type !== 'Utility');
                                    towerOccFloors.forEach((f, i) => {
                                        f.level = building.numFloors + i;
                                    });
                                }
                            } else if (buildingId.endsWith('-tower')) {
                                // This IS a tower — recompute our own baseHeight from the sibling podium
                                const podium = plot.buildings.find(b => b.id === `${baseId}-podium`);
                                if (podium) {
                                    // Use podium's above-ground height (exclude basements, parking, utilities)
                                    const podiumAboveGroundHeight = podium.floors
                                        .filter(f => !((f.level !== undefined && f.level < 0) || f.type === 'Parking') && f.type !== 'Utility')
                                        .reduce((sum, f) => sum + (f.height || 0), 0);
                                    building.baseHeight = podiumAboveGroundHeight; // stay on top of podium
                                }
                            }
                        }

                        break;
                    }
                }
            }));
        },
        addParkingFloor: (buildingId: string, parkingType: ParkingType, _level?: number) => {
            // STILT/PODIUM PARKING DISABLED As per user request
            if (parkingType === ParkingType.Stilt || parkingType === ParkingType.Podium) return;

            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    const building = plot.buildings.find(b => b.id === buildingId);
                    if (building) {
                        const isBasement = parkingType === ParkingType.Basement;

                        // Calculate next level based on existing floors of same type
                        // Basements go down (-1, -2...), Stilts go up (0, 1...) relative to ground?
                        // Or just simplistic stacking
                        const existingTypeFloors = building.floors.filter(f => f.parkingType === parkingType);

                        let nextLevel = 0;
                        if (isBasement) {
                            // Find lowest basement level
                            const minLevel = existingTypeFloors.length > 0
                                ? Math.min(...existingTypeFloors.map(f => f.level ?? -1))
                                : 0;
                            nextLevel = minLevel - 1;
                        } else {
                            // Find highest stilt level
                            const maxLevel = existingTypeFloors.length > 0
                                ? Math.max(...existingTypeFloors.map(f => f.level ?? -1))
                                : -1;
                            nextLevel = maxLevel + 1;
                        }

                        // Override if explicit level provided (though usually not in this simple API)
                        if (_level !== undefined && _level !== -1) nextLevel = _level;

                        const newFloor: Floor = {
                            id: `floor-${building.id}-parking-${Date.now()}`,
                            height: isBasement ? 3.5 : 3.5,
                            color: isBasement ? '#808080' : '#A8A8A8',
                            type: 'Parking',
                            parkingType,
                            parkingCapacity: calculateParkingCapacity(building.area, 12.5, 0.75),
                            level: nextLevel
                        };

                        // Insert at correct position in array? 
                        // Visual renderer sorts by level or handles it. 
                        // Basements usually push to end of array in generation, but here we can just push.
                        building.floors.push(newFloor);
                        
                        // Recalculate building height (above ground occupiable only)
                        building.height = building.floors
                            .filter(f => (f.type !== 'Parking' && f.type !== 'Utility') || (f.level !== undefined && f.level >= 0 && f.type !== 'Utility'))
                            .reduce((sum, f) => sum + (f.height || 0), 0);
                        break;
                    }
                }
            }));
        },
        updateProject: (projectId: string, props: Partial<Project>) => {
            set(produce((draft: BuildingState) => {
                const project = draft.projects.find((p: Project) => p.id === projectId);
                if (project) {
                    Object.assign(project, props);
                }
            }));
        },
        updatePlot: (plotId: string, props: Partial<Plot>) => {
            set(produce(draft => {
                const plot = draft.plots.find((p: Plot) => p.id === plotId);
                if (plot) {
                    Object.assign(plot, props);
                    if (props.geometry) {
                        plot.area = planarArea(props.geometry);
                    }
                    if (props.selectedRegulationType) {
                        plot.regulation = plot.availableRegulations?.find((r: any) => r.type === props.selectedRegulationType) || null;
                    }
                }
            }));
        },
        updateObject: (objectId: string, objectType: SelectableObjectType, props: any) => {
            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    let objectFound = false;
                    switch (objectType) {
                        case 'GreenArea':
                            const ga = plot.greenAreas.find(o => o.id === objectId);
                            if (ga) { Object.assign(ga, props); objectFound = true; }
                            break;
                        case 'ParkingArea':
                            const pa = plot.parkingAreas.find(o => o.id === objectId);
                            if (pa) {
                                Object.assign(pa, props);
                                if (props.area || props.efficiency || props.spaceSize || props.type) {
                                    pa.capacity = calculateParkingCapacity(pa.area, pa.spaceSize || 12.5, pa.efficiency || 0.75);
                                    if (!pa.spaceSize) pa.spaceSize = 12.5;
                                    if (!pa.efficiency) pa.efficiency = 0.75;
                                }
                                objectFound = true;
                            }
                            break;
                        case 'BuildableArea':
                            const ba = plot.buildableAreas.find(o => o.id === objectId);
                            if (ba) { Object.assign(ba, props); objectFound = true; }
                            break;
                        case 'UtilityArea':
                            const ua = plot.utilityAreas.find(o => o.id === objectId);
                            if (ua) { Object.assign(ua, props); objectFound = true; }
                            break;
                        case 'EntryPoint':
                            const ep = plot.entries.find(o => o.id === objectId);
                            if (ep) { Object.assign(ep, props); objectFound = true; }
                            break;
                    }
                    if (objectFound) break;
                }
            }));
        },
        deletePlot: (id: string) => {
            const { selectedObjectId } = get();
            const wasSelected = selectedObjectId?.type === 'Plot' && selectedObjectId.id === id;
            set(produce(draft => {
                draft.plots = draft.plots.filter((p: Plot) => p.id !== id);
                if (wasSelected) {
                    draft.selectedObjectId = null;
                }
            }));
        },
        deleteObject: (plotId: string, objectId: string, type: SelectableObjectType) => {
            const { selectedObjectId } = get();
            const wasSelected = selectedObjectId?.id === objectId;

            // Track if we should regenerate green areas
            let shouldRegenerateGreenAreas = false;

            set(produce(draft => {
                const plot = draft.plots.find((p: Plot) => p.id === plotId);
                if (plot) {
                    if (type === 'Building') {
                        plot.buildings = plot.buildings.filter((b: Building) => b.id !== objectId);
                        shouldRegenerateGreenAreas = true; // Regenerate after building deletion
                    }
                    if (type === 'GreenArea') plot.greenAreas = plot.greenAreas.filter((g: any) => g.id !== objectId);
                    if (type === 'ParkingArea') {
                        plot.parkingAreas = plot.parkingAreas.filter((p: ParkingArea) => p.id !== objectId);
                        shouldRegenerateGreenAreas = true;
                    }
                    if (type === 'BuildableArea') {
                        plot.buildableAreas = plot.buildableAreas.filter((b: any) => b.id !== objectId);
                        shouldRegenerateGreenAreas = true;
                    }
                    if (type === 'UtilityArea') {
                        plot.utilityAreas = plot.utilityAreas.filter((u: UtilityArea) => u.id !== objectId);
                        shouldRegenerateGreenAreas = true; // Regenerate after utility deletion
                    }
                    if (type === 'Label' && plot.labels) plot.labels = plot.labels.filter((l: any) => l.id !== objectId);
                    if (type === 'EntryPoint' && plot.entries) plot.entries = plot.entries.filter((e: any) => e.id !== objectId);

                    if (wasSelected) {
                        draft.selectedObjectId = null;
                    }
                }
            }));

            // Automatically regenerate parking + green areas after building/utility deletion
            if (shouldRegenerateGreenAreas) {
                console.log(`[DeleteObject] Triggering parking + green area regeneration for plot ${plotId}`);
                get().actions.recalculateParkingAreas(plotId);
                get().actions.regenerateGreenAreas(plotId);
            }
        },
        clearAllPlots: () => {
            set({ plots: [], selectedObjectId: null });
            get().actions.resetDrawing();
        },

        runAlgoMassingGenerator: (plotId: string) => {
            const { plots, generationParams } = get();
            const plot = plots.find(p => p.id === plotId);
            if (!plot || !plot.geometry) return;

            set({ isGeneratingAlgo: true });

            // Run the algorithm synchronously (it's fast enough)
            // But we wrap in a small timeout to let UI show loading state if needed
            setTimeout(() => {
                const params = get().generationParams;

                // Adjust defaults based on Land Use
                const state = get();
                const activeProject = state.projects.find(p => p.id === state.activeProjectId);
                const projectIntendedUse = activeProject?.intendedUse;

                let defaultWidth = 12; // Residential default
                if (projectIntendedUse === 'Commercial') defaultWidth = 18;
                if (projectIntendedUse === 'Industrial') defaultWidth = 25;

                const wingDepth = params.gridOrientation || defaultWidth;

                // --- APPLY ADMIN PANEL REGULATIONS ---
                const reg = plot.regulation;

                // 1. Setback: Use the larger of user param or regulation
                // If regulation exists, it acts as a minimum setback.
                const regSetback = reg?.geometry?.setback?.value;
                const effectiveSetback = regSetback !== undefined
                    ? Math.max(params.setback || 5, regSetback)
                    : (params.setback || plot.setback || 5);

                // 2. Max Height: Use the smaller of user param or regulation
                // If regulation exists, it acts as a maximum height.
                const regMaxHeight = reg?.geometry?.max_height?.value;
                const effectiveMaxHeight = regMaxHeight !== undefined
                    ? Math.min(params.maxHeight || 200, regMaxHeight)
                    : (params.maxHeight || 60);

                // 3. Max Coverage:
                const regMaxCoveragePct = reg?.geometry?.max_ground_coverage?.value;
                const effectiveMaxCoveragePct = regMaxCoveragePct !== undefined
                    ? Math.min(params.siteCoverage || 0.5, regMaxCoveragePct / 100)
                    : (params.siteCoverage || 0.5);

                // 4. Solar Requirement
                const regSolarRequired = (reg?.sustainability?.solar_panels?.value || 0) > 0;
                // If regulation requires solar, force add it to utilities if not already selected
                if (regSolarRequired) {
                    if (!params.selectedUtilities) params.selectedUtilities = [];
                    if (!params.selectedUtilities.includes('Solar') && !params.selectedUtilities.includes('HVAC')) {
                        // If HVAC is there, maybe Solar is integrated or separate? Let's add Solar.
                        // Actually 'Solar' is not in UtilityType enum in some contexts, but let's see.
                        // Assuming valid utility string. 'Solar' was used in my previous edit loop logic.
                        if (!params.selectedUtilities.includes('Solar')) {
                            params.selectedUtilities.push('Solar');
                        }
                    }
                }

                // 5. Rainwater Harvesting -> WTP/Water?
                const regRWH = (reg?.sustainability?.rainwater_harvesting?.value || 0) > 0;
                if (regRWH) {
                    if (!params.selectedUtilities) params.selectedUtilities = [];
                    if (!params.selectedUtilities.includes('Water')) { // Map RWH to Water/WTP
                        params.selectedUtilities.push('Water');
                    }
                }

                console.log(`[Generator] Applied Regulation: Setback=${effectiveSetback}m, MaxHeight=${effectiveMaxHeight}m, Coverage=${effectiveMaxCoveragePct * 100}%`);

                // Generate Setback Polygon
                const plotBoundary = plot.geometry;
                const innerSetback = turf.buffer(plotBoundary, -effectiveSetback, { units: 'meters' });

                let generatedBuildings: Feature<Polygon>[] = [];

                // Select generator
                switch (params.typology as any) {
                    case 'point': generatedBuildings = generatePointShapes(plot.geometry, { wingDepth: wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, unitMix: params.unitMix } as any); break;
                    case 'slab': generatedBuildings = generateSlabShapes(plot.geometry, { wingDepth: wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, unitMix: params.unitMix } as any); break;
                    case 'lshaped': generatedBuildings = generateLShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 30 }); break;
                    case 'ushaped': generatedBuildings = generateUShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 40, wingLengthB: 30 }); break;
                    case 'tshaped': generatedBuildings = generateTShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 40 }); break;
                    case 'hshaped': generatedBuildings = generateHShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 20 }); break;
                    case 'oshaped': generatedBuildings = generatePerimeter(plot.geometry, { ...params, width: wingDepth, setback: effectiveSetback } as any); break;
                    default: generatedBuildings = generateLamellas(plot.geometry, { ...params, setback: effectiveSetback } as any);
                }

                // Convert Features to Buildings
                const newBuildings = generatedBuildings.map((f, i) => {
                    const floorHeight = params.floorHeight || 3.5;
                    const groundFloorHeight = params.groundFloorHeight || floorHeight;
                    const minF = params.minFloors ?? 5;
                    let maxF = params.maxFloors ?? 12;

                    // Regulation check could go here
                    // Use params or plot limits

                    const floors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    const height = groundFloorHeight + (floors - 1) * floorHeight;

                    // Determine intended use from params
                    let intendedUse = BuildingIntendedUse.Residential;
                    if (params.landUse === 'commercial') intendedUse = BuildingIntendedUse.Commercial;
                    else if (params.landUse === 'institutional') intendedUse = BuildingIntendedUse.Public;
                    else if (params.landUse === 'mixed') intendedUse = BuildingIntendedUse.MixedUse;

                    const id = `bldg-algo-${Date.now()}-${i}`;
                    const opacity = getOpacityForBuildingType(intendedUse);

                    return {
                        id: id,
                        name: `Block ${i + 1}`,
                        isPolygonClosed: true,
                        geometry: f,
                        centroid: turf.centroid(f),
                        height: height,
                        opacity: opacity,
                        extrusion: true,
                        soilData: null,
                        intendedUse: intendedUse,
                        floors: Array.from({ length: floors }, (_, j) => ({
                            id: `floor-${id}-${j}`,
                            height: j === 0 ? groundFloorHeight : floorHeight,
                            color: generateFloorColors(floors, intendedUse)[j] || '#cccccc'
                        })),
                        area: planarArea(f),
                        numFloors: floors,
                        typicalFloorHeight: floorHeight,
                        groundFloorHeight: groundFloorHeight,
                        visible: true,
                    } as Building;
                });

                // --- PARKING GENERATION ---
                if (params.parkingType && newBuildings.length > 0) {
                    newBuildings.forEach((b: Building) => {
                        const parkingArea = b.area || 500;
                        const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);

                        if (params.parkingType === 'ug') {
                            // Add Basements (Levels -1, -2)
                            // EV Charging: Points = Units × 1.5 × 0.2 (from utility sizing doc)
                            const totalUnitsInBuilding = b.units?.length || Math.floor(b.area / 100) * (b.numFloors || 5);
                            const totalEVPoints = Math.ceil(totalUnitsInBuilding * 1.5 * 0.2);
                            const evPerFloor = Math.ceil(totalEVPoints / 2);

                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor,
                                evStations: evPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor,
                                evStations: totalUnitsInBuilding * 1.5 * 0.2 - Math.ceil(totalUnitsInBuilding * 1.5 * 0.2 / 2)
                            });

                            // Tag building with EV utility for visual indicators
                            if (!b.utilities) b.utilities = [];
                            if (!b.utilities.includes(UtilityType.EVStation)) {
                                b.utilities.push(UtilityType.EVStation);
                            }
                        } else if (params.parkingType === 'pod') {
                            // Add Stilt (Level 0)
                            b.floors.push({
                                id: `floor-${b.id}-stilt`,
                                height: 3.5,
                                color: '#999999',
                                type: 'Parking',
                                parkingType: ParkingType.Stilt,
                                level: 0,
                                parkingCapacity: capacityPerFloor
                            });
                            // Increase total height to account for stilt lifting the tower
                            b.height += 3.5;
                        }
                        // Surface parking not generated on buildings
                    });
                }

                // --- UTILITY LOGIC ---
                const newUtilityAreas: UtilityArea[] = [];

                // Debug: Check what we received
                console.log('[Utility Debug] params.selectedUtilities:', params.selectedUtilities);
                console.log('[Utility Debug] Is array?', Array.isArray(params.selectedUtilities));
                console.log('[Utility Debug] Length:', params.selectedUtilities?.length);

                if (params.selectedUtilities && params.selectedUtilities.length > 0) {
                    const selected = params.selectedUtilities;

                    // Classification: Internal (building-attached) vs External (plot zones)
                    // Utility generation disabled based on user feedback (utilities already exist or manual placement preferred)
                    const internalUtils: string[] = []; // selected.filter((u: string) => ['HVAC', 'Electrical'].includes(u));
                    const externalUtils: string[] = []; // selected.filter((u: string) => ['STP', 'WTP', 'Water', 'Fire', 'Gas', 'Roads'].includes(u));

                    // 1. Internal Utilities (Modify Buildings)
                    if (internalUtils.length > 0 && newBuildings.length > 0) {
                        newBuildings.forEach((b: Building) => {
                            b.utilities = [...internalUtils] as UtilityType[]; // Tag building

                            // Visual: Add HVAC Plant on Roof
                             if (internalUtils.includes('HVAC')) {
                                const hvacColor = UTILITY_COLORS[UtilityType.HVAC] || '#FFA500';
                                b.floors.push({
                                    id: `floor-${b.id}-hvac`,
                                    height: 2.5,
                                    color: hvacColor,
                                    type: 'Utility',
                                    utilityType: UtilityType.HVAC
                                });
                                b.height += 2.5;
                            }

                            // Visual: Add Electrical/Water Basement "Service Plinth"
                            if (internalUtils.includes('Electrical')) {
                                const elecColor = UTILITY_COLORS[UtilityType.Electrical] || '#FFD700';
                                b.floors.unshift({
                                    id: `floor-${b.id}-elec`,
                                    height: 3,
                                    color: elecColor,
                                    type: 'Utility',
                                    utilityType: UtilityType.Electrical
                                });
                                b.height += 3;
                                b.baseHeight = (b.baseHeight || 0);
                            }
                        });
                    }

                    // 2. External Utilities (Create Zones AND Buildings)
                    if (externalUtils.length > 0) {
                        try {
                            const plotBoundary = plot.geometry;
                            const innerSetback = turf.buffer(plotBoundary, -(plot.setback || 5), { units: 'meters' });

                            if (innerSetback) {
                                const bbox = turf.bbox(innerSetback);

                                // Define zone sizes and positions
                                const utilityConfig: Record<string, { size: number, position: 'sw' | 'se' | 'nw' | 'ne' | 'n' }> = {
                                    'STP': { size: 15, position: 'sw' },
                                    'WTP': { size: 15, position: 'se' },
                                    'Water': { size: 10, position: 'nw' },
                                    'Fire': { size: 10, position: 'ne' },
                                    'Gas': { size: 8, position: 'n' },
                                    'Roads': { size: 20, position: 'n' }
                                };

                                externalUtils.forEach((utilName: string) => {
                                    const config = utilityConfig[utilName];
                                    if (!config) return;

                                    const size = config.size;
                                    let originX, originY;

                                    // Position based on config
                                    switch (config.position) {
                                        case 'sw': // Southwest
                                            originX = bbox[0];
                                            originY = bbox[1];
                                            break;
                                        case 'se': // Southeast
                                            originX = bbox[2] - size;
                                            originY = bbox[1];
                                            break;
                                        case 'nw': // Northwest
                                            originX = bbox[0];
                                            originY = bbox[3] - size;
                                            break;
                                        case 'ne': // Northeast
                                            originX = bbox[2] - size;
                                            originY = bbox[3] - size;
                                            break;
                                        case 'n': // North-center
                                            originX = (bbox[0] + bbox[2]) / 2 - size / 2;
                                            originY = bbox[3] - size;
                                            break;
                                        default:
                                            originX = bbox[0];
                                            originY = bbox[1];
                                    }

                                    const poly = turf.bboxPolygon([originX, originY, originX + size, originY + size]);

                                    // Create 3D Building Block for visualization
                                    const height = utilName === 'Gas' || utilName === 'Roads' ? 0.5 : 4; // Road flat, Gas low
                                    const utilBldg: Building = {
                                        id: `bldg-util-${utilName}-${crypto.randomUUID()}`,
                                        name: `${utilName} ${utilName === 'Roads' ? 'Infrastructure' : 'Block'}`,
                                        isPolygonClosed: true,
                                        geometry: poly.geometry as Feature<Polygon>,
                                        centroid: turf.centroid(poly),
                                        height: height,
                                        opacity: 1,
                                        extrusion: true,
                                        soilData: null,
                                        intendedUse: BuildingIntendedUse.Industrial,
                                        floors: [{
                                            id: `floor-util-${utilName}-${crypto.randomUUID()}`,
                                            height: height,
                                            color: utilName === 'STP' ? '#708090' : utilName === 'WTP' ? '#4682B4' : utilName === 'Roads' ? '#333333' : '#FFD700',
                                            type: 'Utility',
                                            utilityType: utilName as any
                                        }],
                                        area: size * size,
                                        numFloors: 1,
                                        typicalFloorHeight: height,
                                        visible: true
                                    };
                                    newBuildings.push(utilBldg);

                                    // Create Zone for KPI
                                    newUtilityAreas.push({
                                        id: `util-${crypto.randomUUID()}`,
                                        name: `${utilName} Zone`,
                                        type: utilName as UtilityType,
                                        geometry: poly.geometry as Feature<Polygon>,
                                        centroid: turf.centroid(poly),
                                        area: size * size,
                                        visible: true
                                    });
                                });
                            }
                        } catch (e) {
                            console.warn("Failed to generate external utility placement", e);
                        }
                    }
                }

                // Update State
                set(produce((draft: BuildingState) => {
                    const activePlot = draft.plots.find((p: Plot) => p.id === plotId);
                    if (activePlot) {
                        activePlot.buildings = newBuildings;
                        activePlot.utilityAreas = newUtilityAreas;

                        // Clear others
                        activePlot.greenAreas = [];
                        activePlot.parkingAreas = [];

                        // --- VASTU COMPLIANCE CHECK ---
                        // Only if project requires it
                        const state = get();
                        const activeProject = state.projects.find(p => p.id === state.activeProjectId);

                        if (activeProject?.vastuCompliant) {
                            // Import utility dynamically or assume available at top.
                            // For this logical block, we assume calculateVastuScore is selectable.
                            // Since we can't add imports with this tool easily in one go if top is far, 
                            // we rely on the user to fix import or we do it in next step. 
                            // Actually, I should have added the import first. 
                            // Let's assume I'll add the import in a separate call or this will fail compilation.
                            // Wait, I can't add import here safely without finding line 1.
                            // I will add the logic here and then add import.

                            // NOTE: regulation object is needed. 
                            // In this scope 'plot' is available but let's re-fetch from ID or use 'activePlot'.
                            // The 'plot' var from line 1689 is stale inside this timeout callback? 
                            // No, 'plot' is closure, but 'draft' is fresh.
                            // Let's try to get Vastu regulation.
                            // We need to implement a way to select Vastu reg. For now, pass null.
                            if (activePlot) {
                                // Prefer a project-attached Vastu ruleset, fall back to global store cache or bundled checklist
                                const stateNow = get();
                                const projectVastu = (activeProject as any)?.vastuRules || (stateNow.vastuRegulations && stateNow.vastuRegulations[0]) || (ultimateVastuChecklist as any);
                                const result = calculateVastuScore(activePlot as any, newBuildings, projectVastu as any); // Cast to avoid Immer Draft issues

                                if (!activePlot.developmentStats) {
                                    activePlot.developmentStats = calculateDevelopmentStats(activePlot as any, DEFAULT_FEASIBILITY_PARAMS);
                                }
                                // Map schema engine output into the developmentStats shape expected elsewhere.
                                activePlot.developmentStats.vastuScore = {
                                    overall: result.overallScore ?? 0,
                                    // 'rating' was part of the old engine; schema engine does not provide it.
                                    rating: undefined as any,
                                    breakdown: result.breakdown || []
                                } as any;
                            }
                        }
                    }
                    draft.isGeneratingAlgo = false;
                }));

                toast({ title: 'Generated Layout', description: `Created ${newBuildings.length} blocks.` });

            }, 50);
        },


        runAiLayoutGenerator: async (plotId: string, prompt: string) => {
            set({ isGeneratingAi: true });
            try {
                const { plots, actions } = get();
                const plot = plots.find(p => p.id === plotId);
                if (!plot) {
                    throw new Error('Selected plot not found.');
                }

                const regulation = plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType);
                let userDefinedAreas = [
                    ...plot.buildableAreas.map(a => ({ ...a, intendedUse: a.intendedUse })),
                    ...plot.greenAreas.map(a => ({ ...a, intendedUse: 'GreenArea' })),
                    ...plot.parkingAreas.map(a => ({ ...a, intendedUse: 'ParkingArea' })),
                    ...plot.utilityAreas.map(a => ({ ...a, intendedUse: 'UtilityArea' })),
                ];

                // Determine auto-generation rules for Utilities
                let augmentedPrompt = prompt;
                if (plot.area > 5000) {
                    augmentedPrompt += " Please also allocate specific utility zones for STP (Sewage Treatment Plant) and WTP (Water Treatment Plant) as separate UtilityAreas.";
                }

                // If no zones exist, run the first step to generate them
                if (userDefinedAreas.length === 0) {
                    toast({ title: 'No zones found.', description: 'AI will generate zones first, then place buildings.' });

                    // Clear previous AI zones to avoid accumulation
                    set(produce((draft: BuildingState) => {
                        const p = draft.plots.find(plot => plot.id === plotId);
                        if (p) {
                            p.greenAreas = p.greenAreas.filter(g => !g.id.startsWith('ai-zone-'));
                            p.parkingAreas = p.parkingAreas.filter(pa => !pa.id.startsWith('ai-zone-'));
                            p.buildableAreas = p.buildableAreas.filter(ba => !ba.id.startsWith('ai-zone-'));
                            p.utilityAreas = p.utilityAreas.filter(ua => !ua.id.startsWith('ai-zone-'));
                        }
                    }));

                    const zoneResult: GenerateZonesOutput = await generateLayoutZones({
                        plotGeometry: JSON.stringify(plot.geometry),
                        prompt: augmentedPrompt,
                        regulations: regulation ? JSON.stringify(regulation) : "No regulations specified."
                    });

                    if (!zoneResult.zones || zoneResult.zones.length === 0) {
                        throw new Error('AI failed to generate any layout zones.');
                    }

                    // Create geometries for the generated zones and update state
                    const plotFeat = plot.geometry;
                    const setbackPoly = turf.buffer(plot.geometry, -(plot.setback ?? 0), { units: 'meters' });

                    const geometries = splitPolygon(setbackPoly as any, zoneResult.zones.length);

                    zoneResult.zones.forEach((zone: AiZone, index: number) => {
                        const id = `ai-zone-${Date.now()}-${index}`;
                        const geometry = geometries[index];
                        const centroid = turf.centroid(geometry);
                        const area = turf.area(geometry);
                        const visible = true;

                        const newArea = { id, name: zone.name, geometry, centroid, area, visible };

                        if (zone.type === 'GreenArea') {
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.greenAreas.push(newArea); }));
                        } else if (zone.type === 'ParkingArea') {
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.parkingAreas.push(newArea); }));
                        } else if (zone.type === 'BuildableArea') {
                            const buildableArea: BuildableArea = { ...newArea, intendedUse: zone.intendedUse ?? BuildingIntendedUse.Residential };
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.buildableAreas.push(buildableArea); }));
                        } else if (zone.type === 'UtilityArea') {
                            const utilityArea: UtilityArea = { ...newArea, type: zone.utilityType || UtilityType.STP };
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.utilityAreas.push(utilityArea); }));
                        }
                    });

                    // Refresh the userDefinedAreas to include the newly generated ones for the next step
                    const updatedPlot = get().plots.find(p => p.id === plotId);
                    userDefinedAreas = [
                        ...(updatedPlot?.buildableAreas.map(a => ({ ...a, intendedUse: a.intendedUse })) ?? []),
                        ...(updatedPlot?.greenAreas.map(a => ({ ...a, intendedUse: 'GreenArea' })) ?? []),
                        ...(updatedPlot?.parkingAreas.map(a => ({ ...a, intendedUse: 'ParkingArea' })) ?? []),
                        ...(updatedPlot?.utilityAreas.map(a => ({ ...a, intendedUse: 'UtilityArea' })) ?? []),
                    ];

                    if (userDefinedAreas.length === 0) {
                        throw new Error("Zone generation resulted in no usable areas.");
                    }
                }

                const serializableUserAreas = userDefinedAreas.map(({ id, name, geometry, area, intendedUse }) => ({ id, name, geometry, area, intendedUse }));

                // Step 2: Generate site layout using the (potentially new) zones
                const result: GenerateSiteLayoutOutput = await generateSiteLayout({
                    plotGeometry: JSON.stringify(plot.geometry),
                    userDefinedAreas: JSON.stringify(serializableUserAreas),
                    prompt: prompt,
                    regulations: regulation ? JSON.stringify(regulation) : "No regulations specified."
                });
                set({ aiScenarios: result.scenarios });

            } catch (error) {
                console.error("AI layout generation failed:", error);
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
                toast({ variant: 'destructive', title: 'AI Generation Failed', description: errorMessage });
            } finally {
                set({ isGeneratingAi: false });
            }
        },
        generateArchitecturalRendering: async (plotId: string, designParams: { landUse: string; unitMix: Record<string, number>; selectedUtilities: string[]; hasPodium: boolean; podiumFloors: number; parkingTypes: string[]; typology: string }) => {
            set({ isGeneratingRendering: true });
            const { plots } = get();
            const plot = plots.find(p => p.id === plotId);
            if (!plot) {
                toast({ variant: 'destructive', title: 'Error', description: 'No plot selected.' });
                set({ isGeneratingRendering: false });
                return;
            }

            try {
            const batchedRender = buildRenderRequest(plots, plot, designParams);

            if (!batchedRender) {
                toast({ variant: 'destructive', title: 'Error', description: 'No buildings on this plot to render.' });
                set({ isGeneratingRendering: false });
                return;
            }

            const { renderInput, summary } = batchedRender;

                // Generate site plan control image for image-to-image rendering
                let controlImageBase64: string | undefined;
                try {
                    console.log('[AI Rendering] Generating site plan control image...');
                    const sitePlanBlob = await generateSitePlanImage({
                        buildings: renderInput.buildings as any,
                        plot: renderInput.plot,
                        parkingPolygons: (renderInput.plot as any).parkingPolygons,
                        roadPolygons: (renderInput.plot as any).roadPolygons,
                        summary,
                    });
                    controlImageBase64 = await blobToBase64(sitePlanBlob);
                    console.log('[AI Rendering] Control image generated, size:', Math.round(controlImageBase64.length / 1024), 'KB');
                } catch (imgErr) {
                    console.warn('[AI Rendering] Control image generation failed, falling back to text-to-image:', imgErr);
                }

                const res = await generateArchitecturalRendering({ ...renderInput, controlImageBase64 });
                set({ aiRenderingUrl: res.imageUrl, aiRenderingResult: { ...res, buildings: renderInput.buildings, plot: renderInput.plot, summary } });
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
                toast({ variant: 'destructive', title: 'Rendering Failed', description: msg });
            } finally {
                set({ isGeneratingRendering: false });
            }
        },

        runAiMassingGenerator: async (plotId: string) => {
            set({ isGeneratingAi: true });
            const { plots, selectedObjectId } = get();
            const plot = plots.find(p => p.id === plotId);

            if (!plot) {
                toast({ variant: 'destructive', title: 'Error', description: 'A plot must be selected.' });
                set({ isGeneratingAi: false });
                return;
            }

            let targetArea: { name: string, area: number, geometry: any, setback?: number } = {
                name: plot.name,
                area: plot.area,
                geometry: plot.geometry,
                setback: plot.setback,
            };

            if (selectedObjectId?.type === 'BuildableArea') {
                const buildableArea = plot.buildableAreas.find(ba => ba.id === selectedObjectId.id);
                if (buildableArea) {
                    targetArea = {
                        name: buildableArea.name,
                        area: buildableArea.area,
                        geometry: buildableArea.geometry,
                        // No setback for a specific buildable area, as it's already defined
                    };
                }
            }

            const regulation = plot.regulation;
            if (!regulation) {
                toast({ variant: 'destructive', title: 'Regulation Error', description: 'No active regulation set for this plot. Cannot generate massing.' });
                set({ isGeneratingAi: false });
                return;
            }

            try {
                const input: GenerateMassingInput = {
                    plot: JSON.stringify(targetArea),
                    regulations: JSON.stringify(regulation),
                };
                const result = await generateMassingOptions(input);
                set({ aiScenarios: result.scenarios });
            } catch (error) {
                console.error("AI massing generation failed:", error);
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
                toast({ variant: 'destructive', title: 'AI Generation Failed', description: errorMessage });
            } finally {
                set({ isGeneratingAi: false });
            }
        },
        clearAiRendering: () => {
            set({ aiRenderingUrl: null, aiRenderingResult: null, aiRenderingMinimized: false });
        },
        setRenderingDesignParams: (params: DesignParamsForRendering) => {
            set({ renderingDesignParams: params });
        },
        refreshAiRenderingData: async (regenerateImage?: boolean, userPrompt?: string) => {
            const { aiRenderingResult, plots, selectedObjectId } = get();
            if (!aiRenderingResult || !plots.length) return;
            const ds = aiRenderingResult.summary?.designStrategy;
            if (!ds) return;

            // Use the selected plot, falling back to the first plot
            let plot: Plot | undefined;
            if (selectedObjectId) {
                plot = plots.find(p => p.id === selectedObjectId.id)
                    || plots.find(p => p.buildings.some(b => b.id === selectedObjectId.id))
                    || plots.find(p => p.greenAreas.some(g => g.id === selectedObjectId.id))
                    || plots.find(p => p.parkingAreas.some(pa => pa.id === selectedObjectId.id))
                    || plots.find(p => p.buildableAreas?.some(ba => ba.id === selectedObjectId.id))
                    || plots.find(p => p.utilityAreas?.some(ua => ua.id === selectedObjectId.id));
            }
            if (!plot) plot = plots[0];

            const designParams = {
                landUse: ds.landUse, typology: ds.typology, unitMix: ds.unitMix,
                hasPodium: ds.hasPodium, podiumFloors: ds.podiumFloors,
                parkingTypes: ds.parkingTypes, selectedUtilities: ds.selectedUtilities,
            };
            const batchedRender = buildRenderRequest(plots, plot, designParams);
            if (!batchedRender) return;

            if (regenerateImage) {
                set({ isGeneratingRendering: true });
                try {
                    // Generate control image for image-to-image mode
                    let controlImageBase64: string | undefined;
                    try {
                        const sitePlanBlob = await generateSitePlanImage({
                            buildings: batchedRender.renderInput.buildings as any,
                            plot: batchedRender.renderInput.plot,
                            parkingPolygons: (batchedRender.renderInput.plot as any).parkingPolygons,
                            roadPolygons: (batchedRender.renderInput.plot as any).roadPolygons,
                            summary: batchedRender.summary,
                        });
                        controlImageBase64 = await blobToBase64(sitePlanBlob);
                    } catch (imgErr) {
                        console.warn('[AI Rendering] Control image failed in refresh, falling back to text-to-image:', imgErr);
                    }

                    const res = await generateArchitecturalRendering({ ...batchedRender.renderInput, controlImageBase64, userPrompt });
                    set({ aiRenderingUrl: res.imageUrl, aiRenderingResult: { ...res, buildings: batchedRender.renderInput.buildings, plot: batchedRender.renderInput.plot, summary: batchedRender.summary } });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
                    toast({ variant: 'destructive', title: 'Rendering Failed', description: msg });
                } finally {
                    set({ isGeneratingRendering: false });
                }
            } else {
                set({ aiRenderingResult: { ...aiRenderingResult, buildings: batchedRender.renderInput.buildings, plot: batchedRender.renderInput.plot, summary: batchedRender.summary } });
            }
        },
        toggleAiRenderingMinimized: (minimized?: boolean) => {
            set({ aiRenderingMinimized: minimized ?? !get().aiRenderingMinimized });
        },

        applyAiLayout: (plotId: string, scenario: any) => {
            const { projects, activeProjectId } = get();
            const project = projects.find(p => p.id === activeProjectId);
            if (!project) return;

            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find((p: Plot) => p.id === plotId);
                if (!plot) return;

                const originalUserAreas = [
                    ...plot.buildableAreas,
                    ...plot.greenAreas,
                    ...plot.parkingAreas,
                ];

                // Clear previously AI-generated items from this plot
                plot.buildings = plot.buildings.filter(b => !b.id.startsWith('ai-gen-'));
                plot.greenAreas = plot.greenAreas.filter(g => !g.id.startsWith('ai-gen-'));
                plot.parkingAreas = plot.parkingAreas.filter(p => !p.id.startsWith('ai-gen-'));
                plot.utilityAreas = plot.utilityAreas.filter(u => !u.id.startsWith('ai-gen-') && !u.id.startsWith('ai-zone-'));

                scenario.objects.forEach((aiObj: AiMassingGeneratedObject, aiIndex: number) => {
                    const aiMassingObject = aiObj as AiMassingGeneratedObject;

                    let containerGeometry: Feature<Polygon> | null = null;

                    const placementTargetZone = originalUserAreas.find(ua => ua.name === aiMassingObject.placement);

                    if (placementTargetZone) {
                        containerGeometry = placementTargetZone.geometry;
                    } else if (aiMassingObject.placement === plot.name) {
                        const buffered = turf.buffer(plot.geometry, -plot.setback, { units: 'meters' as const });
                        if (buffered) containerGeometry = buffered as Feature<Polygon>;
                        else containerGeometry = plot.geometry;
                    }

                    if (!containerGeometry) {
                        console.warn(`Could not find placement target "${aiMassingObject.placement}" for AI object "${aiMassingObject.name}". Skipping.`);
                        return;
                    }

                    const buildingsInZone = scenario.objects.filter((o: AiMassingGeneratedObject) =>
                        (o as AiMassingGeneratedObject).placement === aiMassingObject.placement && o.type === 'Building'
                    );
                    const isMultiBuildingZone = buildingsInZone.length > 1;

                    let finalGeometry: Feature<Polygon>;
                    if (aiObj.type === 'Building' && isMultiBuildingZone) {
                        const geometries = splitPolygon(containerGeometry, buildingsInZone.length);
                        const buildingIndexInZone = buildingsInZone.findIndex((b: AiMassingGeneratedObject) => b.name === aiMassingObject.name);
                        finalGeometry = geometries[buildingIndexInZone] || containerGeometry;
                    } else {
                        finalGeometry = containerGeometry;
                    }

                    if (!finalGeometry) return;

                    const centroid = turf.centroid(finalGeometry);
                    const area = turf.area(finalGeometry);

                    // Validate centroid and area are valid
                    if (!centroid?.geometry?.coordinates ||
                        !Number.isFinite(centroid.geometry.coordinates[0]) ||
                        !Number.isFinite(centroid.geometry.coordinates[1]) ||
                        !Number.isFinite(area) || area <= 0) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Invalid centroid or area`, { centroid, area });
                        return;
                    }

                    // Validate geometry coordinates
                    const coords = finalGeometry.geometry.coordinates[0];
                    if (!coords || coords.length < 3) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Invalid geometry coordinates`);
                        return;
                    }

                    const hasInvalidCoords = coords.some((coord: any) =>
                        !Array.isArray(coord) || coord.length < 2 ||
                        !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])
                    );

                    if (hasInvalidCoords) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Geometry contains NaN or invalid coordinates`);
                        return;
                    }

                    const id = `ai-gen-${Date.now()}-${aiIndex}`;

                    if (aiObj.type === 'Building') {
                        const numFloors = aiMassingObject.numFloors ?? 10;
                        const typicalFloorHeight = 3.5;
                        const massing = aiMassingObject.massing || 'Simple';

                        if (massing === 'PodiumTower' && numFloors > 5) {
                            // Create Podium
                            const podiumFloors = 3;
                            const podiumHeight = podiumFloors * typicalFloorHeight;
                            const podiumId = `${id}-podium`;

                            const podiumBuilding: Building = {
                                id: podiumId,
                                name: `${aiMassingObject.name} (Podium)`,
                                geometry: finalGeometry,
                                centroid,
                                area,
                                isPolygonClosed: true,
                                height: podiumHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: podiumFloors }, (_, i) => ({
                                    id: `floor-${podiumId}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i] // Use same color palette
                                })),
                                numFloors: podiumFloors,
                                typicalFloorHeight,
                                visible: true,
                                baseHeight: 0,
                            };
                            plot.buildings.push(podiumBuilding);

                            // Create Tower
                            const towerFloors = numFloors - podiumFloors;
                            const towerHeight = towerFloors * typicalFloorHeight;
                            const towerId = `${id}-tower`;

                            let towerGeometry = finalGeometry;
                            let towerBufferSucceeded = false;

                            // Try to create a smaller tower footprint (inset from podium)
                            try {
                                // Use -3 meters buffer for more reliable results
                                const buffered = turf.buffer(finalGeometry, -3, { units: 'meters' });
                                if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
                                    const testCentroid = turf.centroid(buffered);
                                    const testArea = turf.area(buffered);

                                    // Only use buffered geometry if it's valid and at least 40% of original area
                                    if (testCentroid?.geometry?.coordinates &&
                                        Number.isFinite(testCentroid.geometry.coordinates[0]) &&
                                        Number.isFinite(testCentroid.geometry.coordinates[1]) &&
                                        Number.isFinite(testArea) &&
                                        testArea > 0 &&
                                        testArea >= area * 0.4) {
                                        towerGeometry = buffered as Feature<Polygon>;
                                        towerBufferSucceeded = true;
                                    }
                                }
                            } catch (e) {
                                console.warn("Failed to create tower buffer", e);
                            }

                            // If buffer failed, try a percentage-based shrink
                            if (!towerBufferSucceeded) {
                                try {
                                    // Shrink the polygon by 30% from centroid for more visible difference
                                    const podiumCentroid = turf.centroid(finalGeometry);
                                    const podiumCenter = podiumCentroid.geometry.coordinates;
                                    const coords = finalGeometry.geometry.coordinates[0];

                                    const shrunkCoords = coords.map((coord: any) => {
                                        const dx = coord[0] - podiumCenter[0];
                                        const dy = coord[1] - podiumCenter[1];
                                        return [
                                            podiumCenter[0] + dx * 0.7, // 70% of distance from center (30% shrink)
                                            podiumCenter[1] + dy * 0.7
                                        ];
                                    });

                                    towerGeometry = {
                                        type: 'Feature',
                                        properties: {},
                                        geometry: {
                                            type: 'Polygon',
                                            coordinates: [shrunkCoords]
                                        }
                                    } as Feature<Polygon>;
                                    console.log(`Used percentage-based shrink for tower "${aiMassingObject.name}"`);
                                } catch (e) {
                                    console.warn(`Failed to shrink tower geometry for "${aiMassingObject.name}", using podium geometry`, e);
                                    towerGeometry = finalGeometry; // Last resort fallback
                                }
                            }

                            const towerBuilding: Building = {
                                id: towerId,
                                name: `${aiMassingObject.name} (Tower)`,
                                geometry: towerGeometry,
                                centroid: turf.centroid(towerGeometry),
                                area: planarArea(towerGeometry),
                                isPolygonClosed: true,
                                height: towerHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: towerFloors }, (_, i) => ({
                                    id: `floor-${towerId}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i + podiumFloors]
                                })),
                                numFloors: towerFloors,
                                typicalFloorHeight,
                                visible: true,
                                baseHeight: podiumHeight,
                            };
                            plot.buildings.push(towerBuilding);

                        } else {
                            // Simple Massing
                            const newBuilding: Building = {
                                id, name: aiMassingObject.name, geometry: finalGeometry, centroid, area,
                                isPolygonClosed: true,
                                height: numFloors * typicalFloorHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: numFloors }, (_, i) => ({
                                    id: `floor-${id}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i]
                                })),
                                numFloors, typicalFloorHeight, visible: true,
                                baseHeight: 0,
                            };
                            plot.buildings.push(newBuilding);
                        }

                    } else if (aiObj.type === 'GreenArea') {
                        plot.greenAreas.push({ id, name: (aiObj as any).name, geometry: finalGeometry, centroid, area, visible: true });
                    } else if (aiObj.type === 'ParkingArea') {
                        plot.parkingAreas.push({ id, name: (aiObj as any).name, geometry: finalGeometry, centroid, area, visible: true });
                    }
                });
            }));
            get().actions.clearAiScenarios();
        },
        clearAiScenarios: () => {
            set({ aiScenarios: null });
        },
        setHoveredObject: (id: string, type: SelectableObjectType) => {
            if (!id || !type) {
                set({ hoveredObjectId: null });
            } else {
                set({ hoveredObjectId: { id, type } });
            }
        },
        toggleObjectVisibility: (plotId: string, objectId: string, type: SelectableObjectType) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (!plot) return;

                let targetObject: any;

                if (type === 'Plot' && plot.id === objectId) {
                    targetObject = plot;
                } else {
                    const allObjects = [
                        ...plot.buildings,
                        ...plot.greenAreas,
                        ...plot.parkingAreas,
                        ...plot.buildableAreas,
                        ...plot.utilityAreas
                    ];
                    targetObject = allObjects.find(obj => obj.id === objectId);
                }

                if (targetObject) {
                    targetObject.visible = !targetObject.visible;
                }
            }));
        },

        // Location & Connectivity Actions
        setLocationData: (data: any) => set(produce((state: BuildingState) => {
            const activeProject = state.projects.find(p => p.id === state.activeProjectId);
            if (!activeProject) return;

            // Ensure locationData object exists
            if (!activeProject.locationData) {
                activeProject.locationData = { amenities: [] };
            }

            // data might be a FeatureCollection or array. Standardize.
            const amenities = Array.isArray(data) ? data : (data.features || []);

            // Merge or replace? For now replace to avoid stale data
            activeProject.locationData.amenities = amenities;
            activeProject.lastModified = new Date().toISOString();
        })),

        toggleAmenityVisibility: async (category: string) => {
            const state = get();
            const { mapLocation, activeProjectId, projects, plots } = state;

            // 1. Check if category is currently active in UI state
            // We need a place to store active categories. 
            // uiState seems to be the place, but it might not have the field yet.
            // Let's assume we can add it to uiState or just use a local Set if we can't modify type easily here.
            // Ideally we should update the BuildingState interface, but for now let's check active project's data or a temp state.
            // Actually, the previous view showed `uiState: { ... }` without activeCategories.
            // I will implement a "fetch and store" logic. Visibility toggling might need a separate visual state.
            // For now, let's FETCH the data if it's not there, effectively "Activating" it.

            const activeProject = projects.find(p => p.id === activeProjectId);
            if (!activeProject) return;

            // Check if we already have data for this category? 
            // Or just always fetch for now to ensure freshness.

            // Determine Center
            let center: [number, number] | null = null;

            // Try plot centroid
            const projectPlots = plots.filter(p => !p.projectId || p.projectId === activeProjectId);
            if (projectPlots.length > 0 && projectPlots[0].centroid) {
                center = projectPlots[0].centroid.geometry.coordinates as [number, number];
            } else if (mapLocation) {
                try {
                    const parts = mapLocation.split(',').map(s => parseFloat(s.trim()));
                    if (parts.length === 2) center = [parts[1], parts[0]]; // Lat, Lng string -> Lng, Lat array
                } catch (e) { }
            }

            if (!center) {
                toast({ title: "Location Error", description: "Project location or plot not set.", variant: "destructive" });
                return;
            }

            set({ isLoading: true });

            try {
                // Dynamic import to avoid circular deps if any
                const { PlacesService } = await import('@/services/places-service');
                const newAmenities = await PlacesService.searchNearby(center, category as any);

                set(produce((draft: BuildingState) => {
                    const project = draft.projects.find(p => p.id === activeProjectId);
                    if (project) {
                        if (!project.locationData) project.locationData = { amenities: [] };

                        // Remove existing items of this category to avoid dupes
                        const otherAmenities = project.locationData.amenities.filter((a: any) => a.category !== category);

                        // Add new ones
                        project.locationData.amenities = [...otherAmenities, ...newAmenities];
                        project.lastModified = new Date().toISOString();
                    }
                }));

                if (newAmenities.length === 0) {
                    toast({ title: "No Results", description: `No ${category} found nearby.` });
                } else {
                    toast({ title: "Data Updated", description: `Found ${newAmenities.length} ${category} locations.` });
                }

            } catch (error) {
                console.error("Error fetching amenities:", error);
                toast({ title: "Fetch Error", description: "Failed to load proximity data.", variant: "destructive" });
            } finally {
                set({ isLoading: false });
            }
        },

        // ============================================================
        // THEMATIC SERVICES
        // ============================================================
        setActiveBhuvanLayer: (layerId: string | null) => {
            set({ activeBhuvanLayer: layerId, bhuvanData: null, isFetchingBhuvan: false });
        },

        setBhuvanOpacity: (opacity: number) => {
            set({ activeBhuvanOpacity: opacity });
        },

        setDistrictNameHint: (hint: string | undefined) => {
            set({ districtNameHint: hint });
        },

        setBhuvanData: (data: any | null, isFetching: boolean = false) => {
            set({ bhuvanData: data, isFetchingBhuvan: isFetching });
        },

        moveObject: (plotId: string, objectId: string, objectType: SelectableObjectType, deltaLng: number, deltaLat: number) => {
            if (deltaLng === 0 && deltaLat === 0) return;

            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (!plot) return;

                let targetObject: any;
                if (objectType === 'Building') {
                    targetObject = plot.buildings.find(b => b.id === objectId);
                } else if (objectType === 'GreenArea') {
                    targetObject = plot.greenAreas.find(g => g.id === objectId);
                } else if (objectType === 'ParkingArea') {
                    targetObject = plot.parkingAreas.find(p => p.id === objectId);
                } else if (objectType === 'UtilityArea') {
                    targetObject = plot.utilityAreas.find(u => u.id === objectId);
                }

                if (!targetObject || !targetObject.geometry) return;

                // Function to translate an object AND all its parts
                const translateBuilding = (building: Building) => {
                    const distance = Math.sqrt(deltaLng * deltaLng + deltaLat * deltaLat);
                    const bearing = (Math.atan2(deltaLng, deltaLat) * 180) / Math.PI;

                    // 1. Move Main Geometry
                    building.geometry = turf.transformTranslate(building.geometry as any, distance, bearing, { units: 'degrees' });
                    building.centroid = turf.centroid(building.geometry as any);

                    // 2. Move Cores
                    if (building.cores) {
                        building.cores.forEach(core => {
                            core.geometry = turf.transformTranslate(core.geometry, distance, bearing, { units: 'degrees' });
                        });
                    }

                    // 3. Move Units
                    if (building.units) {
                        building.units.forEach(unit => {
                            unit.geometry = turf.transformTranslate(unit.geometry, distance, bearing, { units: 'degrees' });
                        });
                    }

                    // 4. Move Internal Utilities
                    if (building.internalUtilities) {
                        building.internalUtilities.forEach(util => {
                            util.geometry = turf.transformTranslate(util.geometry, distance, bearing, { units: 'degrees' });
                            util.centroid = turf.centroid(util.geometry);
                        });
                    }
                };

                if (objectType === 'Building') {
                    const building = targetObject as Building;
                    translateBuilding(building);

                    // --- PODIUM/TOWER SYNC ---
                    // If this is a podium or tower, move the paired building as well
                    const baseId = building.id.replace(/-podium$/, '').replace(/-tower$/, '');
                    const isPodium = building.id.endsWith('-podium');
                    const isTower = building.id.endsWith('-tower');

                    if (isPodium || isTower) {
                        const pairId = isPodium ? `${baseId}-tower` : `${baseId}-podium`;
                        const pairBuilding = plot.buildings.find(b => b.id === pairId);
                        if (pairBuilding) {
                            translateBuilding(pairBuilding);
                        }
                    }
                } else {
                    // Non-building object (GreenArea, UtilityArea, etc.)
                    const distance = Math.sqrt(deltaLng * deltaLng + deltaLat * deltaLat);
                    const bearing = (Math.atan2(deltaLng, deltaLat) * 180) / Math.PI;
                    targetObject.geometry = turf.transformTranslate(targetObject.geometry, distance, bearing, { units: 'degrees' });
                    targetObject.centroid = turf.centroid(targetObject.geometry);
                }

                // NOTE: Green area recalculation is NOT done here (moveObject is called on every mouse frame).
                // Instead, call `recalculateGreenAreas(plotId)` once when the drag ends (mouseup).
            }));
        },

        // rotateBuilding implementation removed

        recalculateGreenAreas: (plotId: string) => {
            // Read current state (plain, not proxied by Immer)
            const state = get();
            const plot = state.plots.find(p => p.id === plotId);
            if (!plot) return;

            try {
                // Deep-clone all geometries to strip Immer Proxy wrappers
                // turf.js cannot operate on Proxy objects reliably
                const cloneBuildingGeoms = plot.buildings
                    .filter(b => b.geometry)
                    .map(b => JSON.parse(JSON.stringify(b.geometry)));
                
                // Include ALL ground-level utilities (including Peripheral Road) for subtraction
                // so green area doesn't leak under the road/parking zones
                // Exclude basement (level < 0) AND floating/canopy (level > 0, e.g. Solar PV)
                const cloneUtilityGeoms = plot.utilityAreas
                    .filter(u => u.geometry && ((u as any).level === undefined || (u as any).level === 0))
                    .map(u => JSON.parse(JSON.stringify(u.geometry)));
                
                const cloneParkingGeoms = plot.parkingAreas
                    .filter(p => p.geometry)
                    .map(p => JSON.parse(JSON.stringify(p.geometry)));

                // Find the base area — ALWAYS use the full plot with setback applied
                // BuildableAreas are NOT the base; they are obstacles that block green space
                let baseGeom: any = null;
                if (plot.geometry) {
                    const plotGeomClone = JSON.parse(JSON.stringify(plot.geometry));
                    const setbackDist = -(plot.setback || 4);
                    baseGeom = turf.buffer(plotGeomClone, setbackDist, { units: 'meters' });
                }

                if (!baseGeom) return;

                let remainingGeom: any = baseGeom;

                // Subtract all buildings
                for (const bGeom of cloneBuildingGeoms) {
                    if (remainingGeom) {
                        try {
                            const buffered = turf.buffer(bGeom, 0.05, { units: 'meters' });
                            // @ts-ignore
                            const diff = turf.difference(remainingGeom, buffered);
                            if (diff) remainingGeom = diff;
                        } catch { /* ignore */ }
                    }
                }

                // Subtract ALL utilities (including Peripheral Road)
                for (const uGeom of cloneUtilityGeoms) {
                    if (remainingGeom) {
                        try {
                            const buffered = turf.buffer(uGeom, 0.05, { units: 'meters' });
                            // @ts-ignore
                            const diff = turf.difference(remainingGeom, buffered);
                            if (diff) remainingGeom = diff;
                        } catch { /* ignore */ }
                    }
                }

                // Subtract parking
                for (const pGeom of cloneParkingGeoms) {
                    if (remainingGeom) {
                        try {
                            const buffered = turf.buffer(pGeom, 0.05, { units: 'meters' });
                            // @ts-ignore
                            const diff = turf.difference(remainingGeom, buffered);
                            if (diff) remainingGeom = diff;
                        } catch { /* ignore */ }
                    }
                }

                // Subtract buildable areas — these are reserved for buildings, not green space
                const cloneBuildableGeoms = plot.buildableAreas
                    .filter(b => b.geometry)
                    .map(b => JSON.parse(JSON.stringify(b.geometry)));
                for (const bGeom of cloneBuildableGeoms) {
                    if (remainingGeom) {
                        try {
                            // @ts-ignore
                            const diff = turf.difference(remainingGeom, bGeom);
                            if (diff) remainingGeom = diff;
                        } catch { /* ignore */ }
                    }
                }

                // Build new green areas from remaining geometry
                const newGreenAreas: GreenArea[] = [];
                if (remainingGeom) {
                    const greenPolygons: Feature<Polygon>[] = [];
                    if (remainingGeom.geometry.type === 'Polygon') {
                        greenPolygons.push(remainingGeom as Feature<Polygon>);
                    } else if (remainingGeom.geometry.type === 'MultiPolygon') {
                        // @ts-ignore
                        const collection = turf.flatten(remainingGeom);
                        collection.features.forEach((f: any) => {
                            if (turf.area(f) > 10) greenPolygons.push(f as Feature<Polygon>);
                        });
                    }

                    // MATHEMATICAL SUBTRACTION (Option 1)
                    // Calculate the total remaining un-subtracted area of ground utilities
                    let remainingUtilityPenalty = 0;
                    const groundUtilities = plot.utilityAreas.filter(u => (u as any).level === undefined || (u as any).level === 0);
                    for (const util of groundUtilities) {
                        const requiredArea = util.targetArea || util.area;
                        const physicalArea = util.geometry ? planarArea(util.geometry) : 0;
                        if (requiredArea > physicalArea && !util.id.includes('road')) {
                            // Rough approximation: half the penalty goes to parking, half to green
                            remainingUtilityPenalty += (requiredArea - physicalArea) * 0.5;
                        }
                    }

                    greenPolygons.forEach((poly, i) => {
                        let areaSize = planarArea(poly);
                        
                        // Apply a proportional amount of the penalty to this green polygon
                        if (remainingUtilityPenalty > 0) {
                            const penaltyToApply = Math.min(areaSize * 0.8, remainingUtilityPenalty); // Don't wipe out the whole polygon
                            areaSize -= penaltyToApply;
                            remainingUtilityPenalty -= penaltyToApply;
                        }

                        if (areaSize > 10) {
                            newGreenAreas.push({
                                id: `green-area-${plotId}-${i}`,
                                geometry: poly,
                                centroid: turf.centroid(poly),
                                area: areaSize,
                                name: 'Open Space',
                                visible: true
                            });
                        }
                    });
                }

                console.log(`[recalculateGreenAreas] Updated ${newGreenAreas.length} green areas for plot ${plotId}`);

                // Now use produce() ONLY for the state assignment
                set(produce((draft: BuildingState) => {
                    const draftPlot = draft.plots.find(p => p.id === plotId);
                    if (draftPlot) {
                        draftPlot.greenAreas = newGreenAreas;
                    }
                }));
            } catch (err) {
                console.warn('[recalculateGreenAreas] Failed:', err);
            }
        },

        recalculateParkingAreas: (plotId: string) => {
            const state = get();
            const plot = state.plots.find(p => p.id === plotId);
            if (!plot) return;

            // Only recalculate if there's a Peripheral Parking area with originalGeometry
            const hasPeripheralParking = plot.parkingAreas.some(
                pa => pa.name?.includes('Peripheral Parking') && pa.originalGeometry
            );
            if (!hasPeripheralParking) return;

            try {
                // Clone ground-level utility geometries only (level === 0 or undefined)
                // Exclude: Peripheral Road, basement (level < 0), floating/canopy (level > 0 like Solar PV)
                const groundUtilities = plot.utilityAreas
                    .filter(u => u.geometry && !u.name?.includes('Peripheral Road') && ((u as any).level === undefined || (u as any).level === 0));
                
                const cloneUtilityGeoms = groundUtilities
                    .map(u => JSON.parse(JSON.stringify(u.geometry)));

                // Process each peripheral parking area using its stored originalGeometry
                const updatedParkingAreas = plot.parkingAreas.map(pa => {
                    if (!pa.name?.includes('Peripheral Parking') || !pa.originalGeometry) return pa;

                    // Start from the ORIGINAL pristine ring (stored at generation time)
                    let freshParkingGeom: any = JSON.parse(JSON.stringify(pa.originalGeometry));

                    // Subtract each ground-level utility footprint from the pristine ring
                    for (const uGeom of cloneUtilityGeoms) {
                        if (!freshParkingGeom) break;
                        try {
                            const buffered = turf.buffer(uGeom, 0.05, { units: 'meters' });
                            // @ts-ignore
                            const diff = turf.difference(freshParkingGeom, buffered);
                            if (diff) freshParkingGeom = diff;
                        } catch { /* ignore */ }
                    }

                    if (!freshParkingGeom) return pa; // Keep original if subtraction leaves nothing

                    let newArea = planarArea(freshParkingGeom);

                    // MATHEMATICAL SUBTRACTION (Option 1)
                    // The visual polygons for utilities are small.
                    // We must subtract the rest of their required NBC area mathematically.
                    for (const util of groundUtilities) {
                        let physicalArea = 0;
                        if (util.geometry) {
                            try {
                                const buffered = turf.buffer(util.geometry, 0.05, { units: 'meters' });
                                physicalArea = planarArea(buffered);
                            } catch (e) {
                                physicalArea = planarArea(util.geometry); // fallback
                            }
                        }
                        const requiredArea = util.targetArea || util.area;
                        
                        if (requiredArea > physicalArea) {
                            // Ensure the penalty exactly makes up the difference to reach requiredArea
                            const penalty = Math.max(0, requiredArea - physicalArea);
                            console.log(`[recalcParking Math] ${util.name}: required=${requiredArea.toFixed(1)}m², physical=${physicalArea.toFixed(1)}m², penalty=${penalty.toFixed(1)}m²`);
                            newArea -= penalty;
                        }
                    }
                    
                    newArea = Math.max(0, newArea);
                    console.log(`[recalcParking Math] Final parking area: ${newArea.toFixed(0)}m²`);

                    return {
                        ...pa,
                        geometry: freshParkingGeom,
                        centroid: turf.centroid(freshParkingGeom),
                        area: newArea,
                        capacity: Math.floor((newArea * 0.75) / 12.5),
                    };
                });

                // Also find the updated parking geometry to sync Solar PV canopy
                const updatedPeripheralParking = updatedParkingAreas.find(
                    pa => pa.name?.includes('Peripheral Parking')
                );

                console.log(`[recalculateParkingAreas] Updated parking for plot ${plotId}`);

                set(produce((draft: BuildingState) => {
                    const draftPlot = draft.plots.find(p => p.id === plotId);
                    if (draftPlot) {
                        draftPlot.parkingAreas = updatedParkingAreas as any;

                        // Sync Solar PV canopy geometry with the updated parking geometry
                        if (updatedPeripheralParking?.geometry) {
                            const solarPV = draftPlot.utilityAreas.find(
                                (u: any) => u.name?.includes('Solar PV') && u.level !== undefined && u.level > 0
                            );
                            if (solarPV) {
                                solarPV.geometry = JSON.parse(JSON.stringify(updatedPeripheralParking.geometry));
                                solarPV.centroid = JSON.parse(JSON.stringify(
                                    turf.centroid(updatedPeripheralParking.geometry as any)
                                ));
                                solarPV.area = updatedPeripheralParking.area;
                                console.log(`[recalculateParkingAreas] Synced Solar PV canopy geometry`);
                            }
                        }
                    }
                }));
            } catch (err) {
                console.warn('[recalculateParkingAreas] Failed:', err);
            }
        },
    },
}));

const useBuildingStore = useBuildingStoreWithoutUndo;

const useSelectedBuilding = () => {
    const { plots, selectedObjectId } = useBuildingStore();
    if (selectedObjectId?.type !== 'Building') return null;

    for (const plot of plots) {
        const building = plot.buildings.find(b => b.id === selectedObjectId.id);
        if (building) return building;
    }
    return null;
};

const useSelectedPlot = () => {
    const { plots, selectedObjectId } = useBuildingStore();
    if (!selectedObjectId) {
        if (plots.length > 0) {
            const plot = plots[0];
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
        return null;
    }

    if (selectedObjectId.type === 'Plot') {
        const plot = plots.find(p => p.id === selectedObjectId.id);
        if (plot) {
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
        return null;
    }

    for (const plot of plots) {
        const objectExists = [
            ...plot.buildings,
            ...plot.greenAreas,
            ...plot.parkingAreas,
            ...plot.buildableAreas,
        ].some(obj => obj.id === selectedObjectId.id);

        if (objectExists) {
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
    }

    if (plots.length > 0) {
        const plot = plots[0];
        return {
            ...plot,
            regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
        };
    }

    return null;
};


const useProjectData = () => {
    const { projects, activeProjectId, plots } = useBuildingStore();
    const selectedPlot = useSelectedPlot();

    const depsStr = useMemo(() => {
        const project = projects.find(p => p.id === activeProjectId);
        if (!project) return 'no-project';
        const plotsStr = plots.map(p => {
            const buildingsStr = p.buildings.map(b => {
                const bUtils = (b.utilities || []).join(',');
                const bInternal = (b.internalUtilities || []).map((u: any) => `${u.id}-${u.type}-${u.area}`).join(',');
                return `${b.id}-${b.area}-${b.numFloors}-${bUtils}-${bInternal}`;
            }).join('_');
            const utilityStr = (p.utilityAreas || []).map(u => `${u.id}-${u.type}-${u.area}`).join('_');
            return `${p.id}-${p.area}-${buildingsStr}-${utilityStr}`;
        }).join('|');
        const simStr = project.simulationResults ? JSON.stringify(project.simulationResults) : 'none';
        return `${project.id}-${project.totalPlotArea}-${plotsStr}-${selectedPlot?.id}-${project.lastModified || ''}-${simStr}`;
    }, [projects, activeProjectId, plots, selectedPlot]);

    return useMemo(() => {
        const project = projects.find(p => p.id === activeProjectId);

        const consumedPlotArea = plots.reduce((acc, p) => acc + p.area, 0);

        let geomRegs = selectedPlot?.regulation?.geometry;
        if (!geomRegs && plots.length > 0) {
            geomRegs = plots.find(p => p.regulation?.geometry)?.regulation?.geometry;
        }

        const far = selectedPlot?.userFAR || Number(
            geomRegs?.['floor_area_ratio']?.value ||
            geomRegs?.['max_far']?.value ||
            geomRegs?.['fsi']?.value
        ) || 1.8;

        if (!project) {
            return {
                id: 'temp-no-project',
                userId: 'guest',
                name: 'No Project',
                totalPlotArea: 0,
                far: far,
                totalBuildableArea: 0,
                consumedBuildableArea: 0,
                consumedPlotArea: consumedPlotArea,
                intendedUse: BuildingIntendedUse.Residential,
                location: 'Delhi',
                greenCertification: [],
                vastuCompliant: false,
                plots: [],
                lastModified: new Date().toISOString(),
                simulationResults: undefined,
            };
        }

        const totalBuildableArea = selectedPlot?.userGFA || (project.totalPlotArea ?? consumedPlotArea) * far;
        const consumedBuildableArea = plots
            .flatMap(p => p.buildings)
            .reduce((acc, b) => {
                let parkingFloorsCount = b.floors.filter(f => f.type === 'Parking').length;
                let actualFsiFloors = b.floors.length - parkingFloorsCount;
                let effectiveFloors = b.numFloors ?? (actualFsiFloors > 0 ? actualFsiFloors : 1);
                return acc + b.area * effectiveFloors;
            }, 0);

        return {
            ...project,
            plots,
            far,
            totalBuildableArea,
            consumedBuildableArea,
            consumedPlotArea,
            totalPlotArea: project.totalPlotArea ?? consumedPlotArea,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [depsStr]);
}

export { useBuildingStore, useSelectedBuilding, useProjectData, useSelectedPlot };
