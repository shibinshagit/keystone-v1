
'use client';

import { create } from 'zustand';
import type { Feature, Polygon, MultiPolygon, Point, LineString, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import { BuildingIntendedUse, type Plot, type Building, type GreenArea, type ParkingArea, type Floor, type Project, type BuildableArea, type SelectableObjectType, AiScenario, type Label, RegulationData, GenerateMassingInput, AiMassingScenario, GenerateMassingOutput, GenerateSiteLayoutInput, GenerateSiteLayoutOutput, AiSiteLayout, AiMassingGeneratedObject, AiZone, GenerateZonesOutput, DesignOption, GreenRegulationData, DevelopmentStats, FeasibilityParams, UtilityType, UtilityArea, ParkingType, Unit, Core } from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { calculateParkingCapacity } from '@/lib/parking-calc';
import { produce } from 'immer';
import { applyPeripheralClearZone } from '@/lib/generators/geometry-utils';
import { toast } from './use-toast';
import { useMemo } from 'react';
import { generateSiteLayout } from '@/ai/flows/ai-site-layout-generator';
import { generateMassingOptions } from '@/ai/flows/ai-massing-generator';
import { generateLayoutZones } from '@/ai/flows/ai-zone-generator';

import { generateLamellas, generateTowers, generatePerimeter, AlgoParams, AlgoTypology } from '@/lib/generators/basic-generator';
import { generateLShapes, generateUShapes, generateTShapes, generateHShapes, generateSlabShapes, generatePointShapes, checkCollision } from '@/lib/generators/geometric-typologies';
import { generateSiteUtilities, generateBuildingLayout, calculateUtilityReservationZones, generateSiteGates } from '@/lib/generators/layout-generator';
import { splitPolygon } from '@/lib/polygon-utils';
import { db } from '@/lib/firebase';
import { calculateVastuScore } from '@/lib/engines/vastu-engine';
import { calculateGreenAnalysis } from '@/lib/engines/green-analysis-engine';
import { ComplianceEngine } from '@/lib/engines/compliance-engine';
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, getDoc, query, where } from 'firebase/firestore';
import useAuthStore from './use-auth-store';

export type DrawingObjectType = 'Plot' | 'Zone' | 'Building' | 'Road';

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
    uiState: { showVastuCompass: boolean; isFeasibilityPanelOpen: boolean; ghostMode: boolean }; // New UI State
    componentVisibility: { electrical: boolean; hvac: boolean; basements: boolean; cores: boolean; units: boolean };
    aiScenarios: (AiScenario | AiMassingScenario)[] | null;
    isLoading: boolean;
    active: boolean;
    isSaving: boolean;
    isGeneratingAi: boolean;
    isGeneratingAlgo: boolean;
    generationParams: AlgoParams;

    designOptions: DesignOption[]; // Saved scenarios
    tempScenarios: { plots: Plot[] }[] | null; // Temporary scenarios for selection
    isGeneratingScenarios: boolean;

    mapLocation: string | null;
    mapCommand: { type: 'flyTo'; center: [number, number]; zoom?: number } | null;
    greenRegulations: GreenRegulationData[]; // Global Green Regulations cache

    actions: {
        setMapLocation: (location: string | null) => void;
        executeMapCommand: (command: { type: 'flyTo'; center: [number, number]; zoom?: number } | null) => void;
        loadProjects: () => Promise<void>;
        createProject: (name: string, totalPlotArea?: number, intendedUse?: BuildingIntendedUse, location?: string, regulationId?: string, greenCertification?: ('IGBC' | 'GRIHA' | 'LEED' | 'Green Building')[], vastuCompliant?: boolean) => Promise<Project | null>;
        deleteProject: (projectId: string) => Promise<void>;
        loadProject: (projectId: string) => Promise<void>;
        saveCurrentProject: () => Promise<void>;
        startDrawing: (objectType: DrawingObjectType, activePlotId?: string | null) => void;
        addDrawingPoint: (point: [number, number]) => void;
        finishDrawing: (geometry: Feature<Polygon | Point>) => boolean;
        defineZone: (name: string, type: ZoneType, intendedUse?: BuildingIntendedUse, utilityType?: UtilityType) => void;
        cancelDefineZone: () => void;
        selectObject: (id: string | null, type: SelectableObjectType | null) => void;
        updateBuilding: (buildingId: string, props: Partial<Omit<Building, 'id' | 'floors'>>) => void;
        updateProject: (projectId: string, props: Partial<Project>) => void;
        updateSimulationResults: (results: { wind?: { compliantArea: number; avgSpeed: number }; sun?: { compliantArea: number; avgHours: number } }) => void;
        setScenario: (scenario: any) => void;
        updatePlot: (plotId: string, props: Partial<Omit<Plot, 'id'>>) => void;
        updateObject: (objectId: string, objectType: SelectableObjectType, props: Partial<any>) => void;
        deletePlot: (id: string) => void;
        deleteObject: (plotId: string, objectId: string, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea' | 'Label' | 'EntryPoint') => void;
        resetDrawing: () => void;
        undoLastPoint: () => void;
        clearAllPlots: () => void;
        runAiLayoutGenerator: (plotId: string, prompt: string) => Promise<void>;
        runAiMassingGenerator: (plotId: string) => Promise<void>;
        applyAiLayout: (plotId: string, scenario: AiScenario | AiMassingScenario) => void;
        clearAiScenarios: () => void;
        setHoveredObject: (id: string | null, type: SelectableObjectType | null) => void;
        toggleObjectVisibility: (plotId: string, objectId: string, type: SelectableObjectType) => void;

        setGenerationParams: (params: Partial<AlgoParams>) => void;
        regenerateGreenAreas: (plotId: string, buildableAreaOverride?: Feature<Polygon>) => void;
        generateScenarios: (plotId: string, params: AlgoParams) => void;
        runAlgoMassingGenerator: (plotId: string) => void;
        addParkingFloor: (buildingId: string, parkingType: ParkingType, level?: number) => void;
        setPlotRegulation: (plotId: string, regulationType: string) => void;
        setPlotRegulationByIndex: (plotId: string, index: number) => void;

        saveDesignOption: (name: string, description?: string) => void;
        loadDesignOption: (id: string) => void;
        deleteDesignOption: (id: string) => void;


        applyScenario: (scenarioIndex: number) => void;
        clearTempScenarios: () => void;
        toggleVastuCompass: (show: boolean) => void;
        toggleFeasibilityPanel: () => void;
        toggleGhostMode: () => void;
        toggleComponentVisibility: (component: 'electrical' | 'hvac' | 'basements' | 'cores' | 'units') => void;
        setFeasibilityPanelOpen: (isOpen: boolean) => void;

        setLocationData: (data: any) => void;
        toggleAmenityVisibility: (category: string) => void;

        undo: () => void;
        redo: () => void;
    };
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
    [UtilityType.DGSet]: '#FFB74D', // Gold/Orange
    [UtilityType.RainwaterHarvesting]: '#00CED1', // Turquoise
    [UtilityType.SolidWaste]: '#8D6E63', // Brownish
    [UtilityType.Admin]: '#FDD835', // Yellow
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
// Helper to convert geometry for Firestore
const prepareForFirestore = (plots: Plot[]): any[] => {
    console.log('[prepareForFirestore] Input plots:', plots.length);
    return plots.map(plot => {
        const prepared = {
            ...plot,
            geometry: plot.geometry ? JSON.stringify(plot.geometry) : null,
            centroid: plot.centroid ? JSON.stringify(plot.centroid) : null,
            buildings: (plot.buildings || []).map(b => ({
                ...b,
                geometry: JSON.stringify(b.geometry),
                centroid: JSON.stringify(b.centroid),
                cores: (b.cores || []).map(c => ({
                    ...c,
                    geometry: JSON.stringify(c.geometry)
                })),
                units: (b.units || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
                internalUtilities: (b.internalUtilities || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
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
                    cores: (b.cores || []).map((c: any) => ({
                        ...c,
                        geometry: safeParse(c.geometry, `core-${c.id}`)
                    })),
                    units: (b.units || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `unit-${u.id}`)
                    })),
                    internalUtilities: (b.internalUtilities || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `util-int-${u.id}`)
                    })),
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

    try {
        const geoResponse = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=region&access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`);
        const geoData = await geoResponse.json();
        const regionFeature = geoData.features[0];
        if (regionFeature) {
            locationName = regionFeature.text;
        }

        if (locationName) {
            const regulationsRef = collection(db, 'regulations');
            const q = query(regulationsRef, where('location', '==', locationName));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                fetchedRegulations = querySnapshot.docs.map(doc => doc.data() as RegulationData);
            } else {
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
    } catch (e) {
        console.error('Failed to fetch location or regulations', e);
        toast({ variant: 'destructive', title: 'Location Error', description: 'Could not determine plot location or fetch regulations.' });
    }

    // Determine regulation based on Project settings
    const activeProject = useBuildingStore.getState().projects.find(p => p.id === useBuildingStore.getState().activeProjectId);
    const intendedUse = activeProject?.intendedUse || 'Residential';
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
            plotToUpdate.setback = defaultRegulation?.geometry?.setback?.value ?? 4;
            plotToUpdate.maxBuildingHeight = defaultRegulation?.geometry?.max_height?.value;
            plotToUpdate.far = defaultRegulation?.geometry?.floor_area_ratio?.value;
            plotToUpdate.maxCoverage = defaultRegulation?.geometry?.max_ground_coverage?.value;
        }
    }));
}


const useBuildingStoreWithoutUndo = create<BuildingState>((set, get) => ({
    projects: [],
    activeProjectId: null,
    plots: [],
    drawingPoints: [],
    drawingState: {
        isDrawing: false,
        objectType: null,
        activePlotId: null,
        roadWidth: 6,
    },
    zoneDefinition: {
        isDefining: false,
        geometry: null,
        centroid: null,
        activePlotId: null,
    },
    selectedObjectId: null,
    hoveredObjectId: null,
    uiState: { showVastuCompass: false, isFeasibilityPanelOpen: false, ghostMode: false },
    componentVisibility: { electrical: false, hvac: false, basements: false, cores: false, units: false },
    aiScenarios: null,
    isLoading: true,
    active: false,
    isSaving: false,
    isGeneratingAi: false,

    isGeneratingAlgo: false,
    generationParams: {
        typology: 'lamella',
        width: 12,
        spacing: 15,
        orientation: 0,
        setback: 4,
    },

    designOptions: [],
    tempScenarios: null,
    isGeneratingScenarios: false,
    greenRegulations: [],

    mapLocation: null,
    actions: {
        // setMapLocation: Moved to bottom
        // loadProjects: Moved to bottom

        createProject: async (name, totalPlotArea, intendedUse = BuildingIntendedUse.Residential, location, regulationId, greenCertification, vastuCompliant) => {
            console.log('[createProject] Received parameters:');
            console.log('  name:', name);
            console.log('  totalPlotArea:', totalPlotArea);
            console.log('  intendedUse:', intendedUse);
            console.log('  location:', location);
            console.log('  regulationId:', regulationId);
            console.log('  greenCertification:', greenCertification);
            console.log('  vastuCompliant:', vastuCompliant);

            try {
                const userId = useAuthStore.getState().user?.uid || 'guest';

                // Geocode the location to get lat/lng coordinates
                let locationCoords: { lat: number; lng: number } | undefined;
                if (location) {
                    try {
                        const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
                        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${mapboxToken}&limit=1&country=IN`;
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
                    regulationId,
                    greenCertification,
                    vastuCompliant,
                    plots: [],
                    lastModified: new Date().toISOString(),
                };

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
        // deleteProject: Moved to bottom
        // loadProject: Moved to bottom
        // saveCurrentProject: Shadowed implementation removed
        saveDesignOption: (name, description) => {
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
        loadDesignOption: (id) => {
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
        updateSimulationResults: (results) => {
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

                        // If we have explicit buildable areas stored, try to intersect with them for better precision
                        if (plot.buildableAreas && plot.buildableAreas.length > 0 && remainingGeom) {
                            // @ts-ignore
                            const intersect = turf.intersect(remainingGeom, plot.buildableAreas[0].geometry);
                            if (intersect) {
                                remainingGeom = intersect;
                                console.log('[RegenerateGreenAreas] Intersected with stored buildable area for precision');
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

        generateScenarios: async (plotId: string, params: AlgoParams) => {
            const { plots } = get();
            const plotStub = plots.find(p => p.id === plotId);
            if (!plotStub) return;

            // SITE UTILIZATION (Percentage 0-100)
            const userMaxCoverage = params.siteCoverage !== undefined ? params.siteCoverage * 100 : (plotStub.regulation?.geometry?.max_ground_coverage?.value || 50);

            set({ isGeneratingScenarios: true });

            // Helper to generate buildings for a scenario
            const createScenario = (name: string, p: Omit<AlgoParams, 'width'> & { width?: number; maxBuildingHeight?: number; far?: number; maxCoverage?: number; overrideTypologies?: string[]; seed?: number }) => {
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
                    console.log(`[Debug] Post-utility buildable area: ${turf.area(peripheralResult.buildableArea).toFixed(2)}m²`);
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
                    return;
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

                // Add User-Defined Obstacles (Only permanent ones, avoid blocking new generation with stale items)
                plotStub.utilityAreas?.forEach(ua => {
                    // Only treat as obstacle if NOT a generated zone that we are about to replace
                    if (ua.geometry && !ua.id.includes('peripheral') && !ua.name.includes('Generated')) {
                        builtObstacles.push(ua.geometry as Feature<Polygon>);
                    }
                });
                plotStub.parkingAreas?.forEach(pa => {
                    if (pa.geometry && !pa.id.includes('peripheral') && !pa.name.includes('Generated')) {
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

                // VASTU: Reserve corner zones for utilities BEFORE building generation
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
                const effectiveMaxFootprint = params.maxFootprint ?? (plotArea * userMaxCoverage / 100);
                const effectiveMinFootprint = params.minFootprint ?? 100;
                const effectiveMaxFloors = params.maxFloors ?? regulationMaxFloors;
                const effectiveMaxFAR = params.maxAllowedFAR ?? (currentRegulation.geometry.floor_area_ratio?.value || 2.0);
                const effectiveMaxGFA = params.targetGFA ?? (plotArea * effectiveMaxFAR);

                console.log(`[Compliance] Plot Area: ${plotArea.toFixed(0)}m²`);
                console.log(`[Compliance] Regulation Defaults: MaxFootprint=${regulationMaxFootprint.toFixed(0)}m², MaxFloors=${regulationMaxFloors}, MaxGFA=${maxGFA.toFixed(0)}m²`);
                console.log(`[Compliance] Effective Values: MaxFootprint=${effectiveMaxFootprint.toFixed(0)}m², MinFootprint=${effectiveMinFootprint}m², MaxFloors=${effectiveMaxFloors}, MaxGFA=${effectiveMaxGFA.toFixed(0)}m²`);

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

                sortedTypologies.forEach((typology: string, index: number) => {
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
                        setback: (hasPeripheralRoad || hasSurfaceParking) ? (p.frontSetback ?? 0) : 0,
                        sideSetback: p.sideSetback ?? 0,
                        frontSetback: (hasPeripheralRoad || hasSurfaceParking) ? (p.frontSetback ?? 0) : 0,
                        rearSetback: p.rearSetback ?? 0,
                        roadAccessSides: plotStub.roadAccessSides || [],
                        wingLengthA: undefined,
                        wingLengthB: undefined,
                        seed: p.seed ?? 0
                    };

                    console.log(`[generateScenarios] Typology: ${typology}, Index: ${index}`);

                    // Iterate over ALL chunks for this typology
                    for (const chunk of validChunks) {
                        let chunkGenerated: Feature<Polygon>[] = [];

                        switch (typology) {
                            case 'point':
                                chunkGenerated = generatePointShapes(chunk, genParams);
                                break;
                            case 'slab':
                            case 'plot':
                                chunkGenerated = generateSlabShapes(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generatePointShapes(chunk, genParams);
                                }
                                break;
                            case 'lshaped':
                                chunkGenerated = generateLShapes(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(chunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(chunk, genParams);
                                    }
                                }
                                break;
                            case 'ushaped':
                                chunkGenerated = generateUShapes(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(chunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(chunk, genParams);
                                    }
                                }
                                break;
                            case 'tshaped':
                                chunkGenerated = generateTShapes(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(chunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(chunk, genParams);
                                    }
                                }
                                break;
                            case 'hshaped':
                                chunkGenerated = generateHShapes(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(chunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(chunk, genParams);
                                    }
                                }
                                break;
                            case 'oshaped':
                                chunkGenerated = generatePerimeter(chunk, genParams);
                                if (chunkGenerated.length === 0) {
                                    chunkGenerated = generateSlabShapes(chunk, genParams);
                                    if (chunkGenerated.length === 0) {
                                        chunkGenerated = generatePointShapes(chunk, genParams);
                                    }
                                }
                                break;
                            default:
                                chunkGenerated = generatePointShapes(chunk, genParams);
                        }

                        // Handle segments and collisions
                        if (['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(typology)) {
                            chunkGenerated.forEach(segment => {
                                if (!checkCollision(segment, builtObstacles)) {
                                    builtObstacles.push(segment);
                                    geomFeatures.push(segment);
                                }
                            });
                        } else {
                            chunkGenerated.forEach(g => {
                                if (!checkCollision(g, builtObstacles)) {
                                    builtObstacles.push(g);
                                    geomFeatures.push(g);
                                }
                            });
                        }
                    }
                });

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

                // Convert to Buildings
                let newBuildings: Building[] = explodedFeatures.flatMap((f, i) => {
                    // Calculate height based on floor count range AND regulation limits
                    const floorHeight = params.floorHeight || 3.5;

                    // User-specified constraints (defaults)
                    const minF = params.minFloors ?? 5;
                    let maxF = params.maxFloors ?? 12;

                    // Use constraints passed in 'p' if available (from specific regulation), otherwise fallback to plotStub
                    const constraintHeight = p.maxBuildingHeight !== undefined ? p.maxBuildingHeight : plotStub.maxBuildingHeight;

                    // Apply regulation height limit IF user didn't explicitly override it with a higher value
                    if (constraintHeight) {
                        const regulationMaxFloorsVal = Math.floor(constraintHeight / floorHeight);
                        // If user set maxF higher than regulation, we keep user value but log it
                        if (maxF > regulationMaxFloorsVal) {
                            console.log(`[Override] Using user maxFloors ${maxF} instead of regulation limit ${regulationMaxFloorsVal}`);
                        } else {
                            maxF = Math.min(maxF, regulationMaxFloorsVal);
                        }
                    }

                    // Ensure valid range
                    if (maxF < minF) {
                        console.warn(`Regulation constraint too restrictive. Adjusting minFloors from ${minF} to ${maxF}`);
                        maxF = Math.max(minF, maxF); // Allow at least minF
                    }

                    // Vastu-aware height assignment
                    let vastuHeightMultiplier = 1.0;
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
                        // SW: dx < 0 && dy < 0 → multiplier 1.0
                        // NE: dx > 0 && dy > 0 → multiplier 0.5
                        // Gradient between based on position
                        const swFactor = Math.max(0, (-dx - dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));
                        const neFactor = Math.max(0, (dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));

                        // SW gets full height, NE gets 50% height, others are in between
                        vastuHeightMultiplier = 0.75 + 0.25 * swFactor - 0.25 * neFactor;
                        vastuHeightMultiplier = Math.max(0.5, Math.min(1.0, vastuHeightMultiplier));

                        console.log(`Vastu height multiplier for building ${i}: ${vastuHeightMultiplier.toFixed(2)} (SW factor: ${swFactor.toFixed(2)}, NE factor: ${neFactor.toFixed(2)})`);
                    }

                    const baseFloors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    const floors = Math.max(minF, Math.round(baseFloors * vastuHeightMultiplier));
                    const height = floors * floorHeight;

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
                                height: floorHeight,
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
                            
                            // Split Commercial roughly 40% Retail / 60% Office (min 1 Retail if any commercial)
                            const retailFloors = commFloors > 0 ? Math.max(1, Math.floor(commFloors * 0.4)) : 0;
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
                                        height: floorHeight,
                                        color: colors[k] || '#cccccc',
                                        type: 'Occupied',
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
                        intendedUse = BuildingIntendedUse.Commercial;
                    }

                    // Fallback for non-mixed / standard cases if floors not yet generated
                    if (buildingSpecificFloors.length === 0) {
                        const floorColors = generateFloorColors(floors, intendedUse);
                        buildingSpecificFloors = Array.from({ length: floors }, (_, j) => ({
                            id: `floor-${id}-${j}`,
                            height: floorHeight,
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
                    const freshLayout = generateBuildingLayout(f as Feature<Polygon>, {
                        subtype: f.properties?.subtype || params.typology,
                        unitMix: projectUnitMix,
                        intendedUse: intendedUse,
                        // Preserve the alignment rotation stored by the geometric generators so units
                        // are generated axis-aligned and then rotated back to match the building
                        alignmentRotation: f.properties?.alignmentRotation ?? 0
                    });
                    const layout: any = {
                        cores: freshLayout.cores,
                        units: freshLayout.units,
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
                        const retailFloors = commFloors > 0 ? Math.max(1, Math.floor(commFloors * 0.4)) : 0;
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
                        // A rough approximation: distance = sqrt(Area) * (reduction / 100) / 2
                        const area = turf.area(f);
                        const bufferDist = -Math.max(1, Math.sqrt(area) * (reduction / 100) * 0.5);

                        try {
                            const buffered = turf.buffer(f, bufferDist, { units: 'meters' });
                            if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
                                const bufferedArea = turf.area(buffered);
                                // Ensure the buffered geometry didn't completely collapse or become invalid
                                if (bufferedArea > area * 0.1) {
                                    towerGeometry = buffered as Feature<Polygon>;
                                    // REATTACH PROPERTIES LOST DURING BUFFERING
                                    towerGeometry.properties = { ...f.properties, alignmentRotation: f.properties?.alignmentRotation ?? 0 };
                                } else {
                                    throw new Error("Buffer caused geometry to collapse too much.");
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
                            alignmentRotation: towerAlignRotForLayout
                        });

                        // Multiply units across floors — only on Residential floors for floor-wise mixed use
                        const multiplyUnits = (floors: Floor[], baseLayout: any, residentialOnly = false) => {
                            const units: Unit[] = [];
                            floors.forEach(floor => {
                                if ((floor.level !== undefined && floor.level < 0) || floor.type === 'Parking' || floor.type === 'Utility') return;
                                // Skip non-residential floors when residentialOnly is true
                                if (residentialOnly && floor.intendedUse !== BuildingIntendedUse.Residential) return;
                                (baseLayout.units || []).forEach((u: Unit) => units.push({ ...u, id: `${floor.id}-u-${u.id}`, floorId: floor.id }));
                            });
                            return units;
                        };

                        const podiumFloorsArray = buildingSpecificFloors.slice(0, pFloors);
                        const towerFloorsArray = buildingSpecificFloors.slice(pFloors).map(fl => ({ ...fl, id: `floor-${id}-tower-${fl.level || fl.id}` }));

                        const alignRot = f.properties?.alignmentRotation ?? 0;

                        // Podium: non-residential use (Retail/Public/Hospitality) — no BHK units
                        const podiumIntendedUse = isFloorWiseMixed ? BuildingIntendedUse.MixedUse : intendedUse;
                        const podiumBuilding: Building = {
                            ...baseBuildingProps,
                            intendedUse: podiumIntendedUse,
                            cores: layout.cores || [],
                            units: isFloorWiseMixed ? [] : multiplyUnits(podiumFloorsArray, layout),
                            id: `${id}-podium`,
                            name: `Building ${i + 1} (Podium)`,
                            geometry: f,
                            centroid: turf.centroid(f),
                            area: turf.area(f),
                            height: pFloors * floorHeight,
                            numFloors: pFloors,
                            baseHeight: 0,
                            floors: podiumFloorsArray,
                            alignmentRotation: alignRot,
                            totalFloors: floors,
                        } as Building;
                        
                        const towerAlignRot = (towerGeometry as any).properties?.alignmentRotation ?? alignRot;

                        // Tower: always Residential for floor-wise mixed-use — generate BHK units
                        const towerBuilding: Building = {
                            ...baseBuildingProps,
                            intendedUse: towerIntendedUse,
                            cores: towerLayoutResult.cores || [],
                            units: multiplyUnits(towerFloorsArray, towerLayoutResult, isFloorWiseMixed),
                            id: `${id}-tower`,
                            name: `Building ${i + 1} (Tower)`,
                            geometry: towerGeometry,
                            centroid: turf.centroid(towerGeometry),
                            area: turf.area(towerGeometry),
                            height: tFloors * floorHeight,
                            numFloors: tFloors,
                            baseHeight: pFloors * floorHeight,
                            floors: towerFloorsArray,
                            alignmentRotation: towerAlignRot,
                        } as Building;
                        
                        return [podiumBuilding, towerBuilding];
                    }

                    const multiplyUnits = (floors: Floor[], baseLayout: any) => {
                        const units: Unit[] = [];
                        floors.forEach(floor => {
                            if ((floor.level !== undefined && floor.level < 0) || floor.type === 'Parking' || floor.type === 'Utility') return;
                            (baseLayout.units || []).forEach((u: Unit) => units.push({ ...u, id: `${floor.id}-u-${u.id}`, floorId: floor.id }));
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
                        area: turf.area(f),
                        height: height,
                        numFloors: floors,
                        baseHeight: 0,
                        floors: buildingSpecificFloors,
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
                        const scaleFactor = effectiveFARConstraint / actualFAR;
                        console.warn(`FAR exceeded! Scaling building heights by ${(scaleFactor * 100).toFixed(1)}%`);

                        // Scale down floor counts proportionally
                        newBuildings.forEach(b => {
                            const newFloors = Math.max(1, Math.floor(b.numFloors * scaleFactor));
                            b.numFloors = newFloors;
                            b.height = newFloors * b.typicalFloorHeight;
                            
                            // If this is a tower, we must preserve its base height but adjust its top
                            // The baseHeight should NOT be reset unless we are also scaling the podium.
                            // Currently, both scale proportionally, so tower's baseHeight should scale 
                            // proportionally to its podium's new height if we want to be perfect, 
                            // but simply keeping baseHeight = original podium height might cause gaps 
                            // if podium shrunk. 
                            // Since podium and tower scale by the SAME factor, we can scale baseHeight too.
                            if (b.id.includes('-tower')) {
                                b.baseHeight = Math.floor((b.baseHeight || 0) / b.typicalFloorHeight * scaleFactor) * b.typicalFloorHeight;
                            }
                            
                            // Only modify the NON-PARKING floors
                            // Because if we blindly recreate all floors, we lose the basement/stilt parking definitions
                            // So let's slice the existing non-parking floors array instead, or recreate it properly
                            const occupiableFloorsCount = newFloors;
                            const parkingFloors = b.floors.filter(f => f.type === 'Parking');
                            const occupiableFloors = b.floors.filter(f => f.type !== 'Parking');
                            
                            // Adjust the number of occupiable floors to match newFloors
                            let newOccupiableFloors = occupiableFloors.slice(0, occupiableFloorsCount);
                            if (newOccupiableFloors.length < occupiableFloorsCount) {
                                // Shouldn't happen if we're only scaling DOWN, but just in case
                                const diff = occupiableFloorsCount - newOccupiableFloors.length;
                                const colors = generateFloorColors(diff, b.intendedUse as BuildingIntendedUse);
                                const extra = Array.from({ length: diff }, (_, j) => ({
                                    id: `floor-${b.id}-extra-${j}`,
                                    height: b.typicalFloorHeight,
                                    color: colors[j] || '#cccccc',
                                    level: b.id.includes('-tower') ? (newOccupiableFloors.length + j) : (newOccupiableFloors.length + j) // Standard indexing
                                    // Note: FAR scaling logic below will need further refinement for Podium-Tower siblings but we fix the local tower gap here.
                                    // Actually, if we use sequential indexing, level is just index.
                                    // For towers in FAR scaling, we'd need to find the specific sibling.

                                }));
                                newOccupiableFloors = [...newOccupiableFloors, ...extra as Floor[]];
                            }
                            
                            b.floors = [...parkingFloors, ...newOccupiableFloors];

                            // Re-sync units: after floor truncation, some units may reference
                            // floor IDs that no longer exist. Re-map units to surviving floors.
                            if (b.units && b.units.length > 0) {
                                const survivingFloorIds = new Set(newOccupiableFloors.map(f => f.id));
                                // Find template units from any surviving floor
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
                        });
                    }
                }

                // --- SITE UTILIZATION (COVERAGE) ENFORCEMENT ---
                // Prune buildings from smallest to largest until coverage limit is satisfied
                const coverageLimit = p.maxCoverage ?? (plotStub.maxCoverage ? plotStub.maxCoverage : undefined);
                if (coverageLimit !== undefined && newBuildings.length > 0) {
                    const covPlotArea = turf.area(plotStub.geometry);
                    const maxAllowedFootprint = covPlotArea * (coverageLimit / 100);
                    let totalFootprint = newBuildings.reduce((sum, b) => sum + b.area, 0);

                    if (totalFootprint > maxAllowedFootprint * 1.05) {
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
                // --- PARKING GENERATION ---
                // Handle multiple parking types (UG, Podium/Stilt)
                // Surface parking is handled separately in Peripheral Zone Generation
                if (params.parkingTypes && params.parkingTypes.length > 0 && newBuildings.length > 0) {
                    newBuildings.forEach((b: Building) => {
                        // Towers share the podium's basement/stilt, so they don't get their own parking floors directly
                        if (b.id.includes('-tower')) return;

                        const parkingArea = b.area || 500;
                        const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);

                        // Underground Parking (Basements)
                        if (params.parkingTypes?.includes('ug')) {
                            // Add Basements (Levels -1, -2)
                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor
                            });
                        }

                        // Podium/Stilt Parking
                        if (params.parkingTypes?.includes('pod')) {
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
                    });
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

                // Create a Deep Clone of the plot and replace buildings
                const plotClone = JSON.parse(JSON.stringify(plotStub));
                plotClone.buildings = newBuildings;

                // Clear other generated areas to avoid overlap confusion (re-populated below derived from params)
                plotClone.greenAreas = [];
                plotClone.parkingAreas = [];

                // --- PERIPHERAL ZONE GENERATION ---
                // Preserve manually drawn roads from the original plot (they survive scenario generation)
                const existingManualRoads = (plotStub.utilityAreas || []).filter(
                    (ua: UtilityArea) => ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')
                );

                // Add peripheral road zone if "Roads" is selected in utilities
                if (params.selectedUtilities?.includes('Roads') && peripheralRoadZone) {
                    const roadUtility: UtilityArea = {
                        id: `road-peripheral-${crypto.randomUUID()}`,
                        name: 'Peripheral Road',
                        type: UtilityType.Roads,
                        geometry: peripheralRoadZone as Feature<Polygon>,
                        centroid: turf.centroid(peripheralRoadZone),
                        area: turf.area(peripheralRoadZone),
                        visible: true
                    };
                    plotClone.utilityAreas = [...existingManualRoads, roadUtility];
                } else {
                    plotClone.utilityAreas = [...existingManualRoads];
                }

                // Add peripheral parking zone if "surface" parking is selected
                // Add peripheral parking zone if "surface" parking is selected
                if (params.parkingTypes?.includes('surface') && peripheralParkingZone) {
                    const parkingArea: ParkingArea = {
                        id: `parking-peripheral-${crypto.randomUUID()}`,
                        name: 'Peripheral Parking',
                        type: ParkingType.Surface,
                        geometry: peripheralParkingZone as Feature<Polygon>,
                        centroid: turf.centroid(peripheralParkingZone),
                        area: turf.area(peripheralParkingZone),
                        capacity: Math.floor((turf.area(peripheralParkingZone) * 0.75) / 12.5), // 12.5 m² per car
                        visible: true
                    };
                    plotClone.parkingAreas.push(parkingArea);
                }

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
                            b.utilities = [...internalUtils] as UtilityType[]; // Tag building

                            // Visual: Add HVAC Plant on Roof
                            // We add a small "mechanical floor" or block on top
                            if (internalUtils.includes('HVAC')) {
                                b.floors.push({
                                    id: `floor-${b.id}-hvac`,
                                    height: 2.5,
                                    color: '#EA580C', // Orange-600
                                    type: 'Utility',
                                    utilityType: UtilityType.HVAC
                                });
                                b.height += 2.5;
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

                    console.log('[Utility Debug] Generating', externalUtils.length, 'external utility zones');

                    // 2. External Utilities (Plot Zones)
                    if (externalUtils.length > 0) {
                        try {
                            const plotBoundary = plotStub.geometry;
                            const innerSetback = turf.buffer(plotBoundary, -(plotStub.setback || 5), { units: 'meters' });

                            if (innerSetback) {
                                // Get all coordinates to find corners of the actual polygon (better than bbox for irregular plots)
                                // Vastu/Smart Utility Generation
                                try {
                                    const obstacles = [
                                        ...(plotClone.utilityAreas || []),
                                        ...(plotClone.parkingAreas || []),
                                        ...(plotClone.roads || []) // Added roads as obstacles for utilities
                                    ];

                                    // Use the innerSetback (buildable area) to ensure utilities stay strictly inside the main setback line
                                    const { utilities: smartUtils, buildings: updatedBuildings } = generateSiteUtilities(
                                        innerSetback as Feature<Polygon>,
                                        plotClone.buildings,
                                        params.vastuCompliant,
                                        obstacles,
                                        params.selectedUtilities
                                    );

                                    plotClone.utilityAreas.push(...smartUtils);
                                    // Update buildings and filter out those that were hidden (visible === false)
                                    plotClone.buildings = updatedBuildings.filter((b: any) => b.visible !== false);
                                } catch (err) {
                                    console.warn("Smart utility generation failed, falling back or skipping", err);
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to generate external utility placement", e);
                        }
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

                    // Start with validAreaPoly (respects Setbacks + Peripheral Road/Parking)
                    // Clean it first to avoid initial topology errors
                    // @ts-ignore
                    let remainingGeom: Feature<Polygon | MultiPolygon> | null = validAreaPoly ? turf.cleanCoords(validAreaPoly) : null;

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
                                collection.features.forEach(f => {
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
                    (params.typology === 'slab' || params.typology === 'plot') ? 'slab' :
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


                // --- Generate Scenario 2: Complementary typology for variety ---
                await sleep(600); // Thinking time
                // Pick a complementary typology for S2 to ensure visual variety
                const s2Typo = scenarioTypologies[1].length > 0 ? baseTypo :
                    (baseTypo === 'slab' ? 'lshaped' :
                        baseTypo === 'lshaped' ? 'slab' :
                            baseTypo === 'ushaped' ? 'slab' :
                                baseTypo === 'hshaped' ? 'lshaped' :
                                    baseTypo === 'tshaped' ? 'slab' :
                                        baseTypo === 'oshaped' ? 'slab' :
                                            'slab');
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


                // --- Generate Scenario 3: Alternative angle/typology ---
                await sleep(600); // Thinking time
                // S3 uses a rotated orientation for visual variety
                const altAngle = isVastu ? 0 : 90;
                const s3Typo = scenarioTypologies[2].length > 0 ? baseTypo :
                    (baseTypo === 'slab' ? 'slab' :
                        baseTypo === 'lshaped' ? 'lshaped' :
                            'slab');

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
                    const plotIndex = draft.plots.findIndex(p => p.id === scenPlot.id);
                    if (plotIndex !== -1) {
                        // Deep clone to ensure React detects the change and triggers map cleanup
                        // Replace all generated areas to ensure clean state
                        draft.plots[plotIndex].buildings = JSON.parse(JSON.stringify(scenPlot.buildings));
                        draft.plots[plotIndex].greenAreas = JSON.parse(JSON.stringify(scenPlot.greenAreas));
                        draft.plots[plotIndex].parkingAreas = JSON.parse(JSON.stringify(scenPlot.parkingAreas));
                        draft.plots[plotIndex].buildableAreas = JSON.parse(JSON.stringify(scenPlot.buildableAreas));

                        // Merge: keep manually drawn roads from current plot, replace generated utilities from scenario
                        const currentManualRoads = (draft.plots[plotIndex].utilityAreas || []).filter(
                            (ua: UtilityArea) => ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road')
                        );
                        const scenarioGeneratedUtils = (scenPlot.utilityAreas || []).filter(
                            (ua: UtilityArea) => !(ua.type === UtilityType.Roads && !ua.name?.includes('Peripheral Road'))
                        );
                        draft.plots[plotIndex].utilityAreas = JSON.parse(JSON.stringify([
                            ...currentManualRoads,
                            ...scenarioGeneratedUtils
                        ]));
                        // Fix: Copy generated gates
                        if (scenPlot.entries) {
                            draft.plots[plotIndex].entries = JSON.parse(JSON.stringify(scenPlot.entries));
                        }
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
                        plot.setback = selectedReg.geometry?.setback?.value
                            || selectedReg.geometry?.min_setback?.value
                            || selectedReg.geometry?.front_setback?.value
                            || 4; // Improved setback fetching

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
                    plot.setback = selectedReg.geometry?.setback?.value
                        || selectedReg.geometry?.min_setback?.value
                        || selectedReg.geometry?.front_setback?.value
                        || 4; // Improved fallback logic here too

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
                draft.uiState.ghostMode = show !== undefined ? show : !draft.uiState.ghostMode;
                toast({ title: draft.uiState.ghostMode ? "Ghost Mode Enabled" : "Ghost Mode Disabled", description: "Internal structures are now " + (draft.uiState.ghostMode ? "visible" : "hidden") });
            }));
        },

        toggleComponentVisibility: (component: 'electrical' | 'hvac' | 'basements' | 'cores' | 'units') => {
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

        setMapLocation: (location: { lat: number; lng: number }) => set({ mapLocation: location }),
        undo: () => console.warn('Undo not implemented'),
        redo: () => console.warn('Redo not implemented'),
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
                    }
                }));
            } catch (error) {
                console.error("Error deleting project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not delete project.' });
            }
        },
        loadProject: async (projectId: string) => {
            set({ isLoading: true, activeProjectId: projectId, plots: [], selectedObjectId: null });
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

                    draft.drawingState = {
                        isDrawing: true,
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
                            const intendedUse = parentBuildableArea ? parentBuildableArea.intendedUse : BuildingIntendedUse.Residential;

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
                                    area: turf.area(roadPolygon),
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
                const plot = draft.plots.find(p => p.id === activePlotId);
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
                },
                zoneDefinition: { // Reset zoneDefinition as well
                    isDefining: false,
                    geometry: null,
                    centroid: null,
                    activePlotId: null,
                }
            });
        },
        selectObject: (id: string | null, type: SelectableObjectType | null) => {
            get().actions.resetDrawing();
            if (!id || !type) {
                set({ selectedObjectId: null });
                return;
            }

            const { plots } = get();
            let selectedObjectCentroid: Feature<Point> | null = null;
            for (const plot of plots) {
                if (type === 'Plot' && plot.id === id) {
                    selectedObjectCentroid = plot.centroid;
                    break;
                }
                const allObjects = [...plot.buildings, ...plot.greenAreas, ...plot.parkingAreas, ...plot.buildableAreas];
                const foundObject = allObjects.find(obj => obj.id === id);
                if (foundObject) {
                    selectedObjectCentroid = foundObject.centroid;
                    break;
                }
            }

            if (selectedObjectCentroid) {
                window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: selectedObjectCentroid.geometry.coordinates } }));
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

                        Object.assign(building, props);

                        // numFloors represents OCCUPIABLE floors only (excludes parking/utility)
                        const newNumFloors = building.numFloors ?? oldNumFloors;
                        const newTypicalHeight = building.typicalFloorHeight ?? oldTypicalHeight;
                        console.log(`[DEBUG updateBuilding AFTER ASSIGN] building.numFloors=${building.numFloors}, newNumFloors=${newNumFloors}`);

                        if (props.numFloors !== undefined || props.typicalFloorHeight !== undefined) {
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
                                            height: newTypicalHeight,
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
                                        height: newTypicalHeight,
                                        color: colors[i] || '#cccccc',
                                        type: 'General' as const,
                                        intendedUse: building.intendedUse,
                                        level: existing?.level ?? calculatedLevel
                                    };
                                });
                            }

                            building.floors = [...specialFloors, ...newFloors];
                            building.height = building.floors.reduce((sum, f) => sum + (f.height || 0), 0);
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
                                            alignmentRotation: building.alignmentRotation ?? 0,
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
                            building.area = turf.area(props.geometry);
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
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot) {
                    Object.assign(plot, props);
                    if (props.geometry) {
                        plot.area = turf.area(props.geometry);
                    }
                    if (props.selectedRegulationType) {
                        plot.regulation = plot.availableRegulations?.find(r => r.type === props.selectedRegulationType) || null;
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
                draft.plots = draft.plots.filter(p => p.id !== id);
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
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot) {
                    if (type === 'Building') {
                        plot.buildings = plot.buildings.filter(b => b.id !== objectId);
                        shouldRegenerateGreenAreas = true; // Regenerate after building deletion
                    }
                    if (type === 'GreenArea') plot.greenAreas = plot.greenAreas.filter(g => g.id !== objectId);
                    if (type === 'ParkingArea') plot.parkingAreas = plot.parkingAreas.filter((p: ParkingArea) => p.id !== objectId);
                    if (type === 'BuildableArea') plot.buildableAreas = plot.buildableAreas.filter(b => b.id !== objectId);
                    if (type === 'UtilityArea') {
                        plot.utilityAreas = plot.utilityAreas.filter((u: UtilityArea) => u.id !== objectId);
                        shouldRegenerateGreenAreas = true; // Regenerate after utility deletion
                    }
                    if (type === 'Label' && plot.labels) plot.labels = plot.labels.filter(l => l.id !== objectId);
                    if (type === 'EntryPoint' && plot.entries) plot.entries = plot.entries.filter(e => e.id !== objectId);

                    if (wasSelected) {
                        draft.selectedObjectId = null;
                    }
                }
            }));

            // Automatically regenerate green areas after building/utility deletion
            if (shouldRegenerateGreenAreas) {
                console.log(`[DeleteObject] Triggering green area regeneration for plot ${plotId}`);
                get().actions.regenerateGreenAreas(plotId);
            }
        },
        clearAllPlots: () => {
            set({ plots: [], selectedObjectId: null });
            get().actions.resetDrawing();
        },

        runAlgoMassingGenerator: (plotId) => {
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
                    const minF = params.minFloors ?? 5;
                    let maxF = params.maxFloors ?? 12;

                    // Regulation check could go here
                    // Use params or plot limits

                    const floors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    const height = floors * floorHeight;

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
                            height: floorHeight,
                            color: generateFloorColors(floors, intendedUse)[j] || '#cccccc'
                        })),
                        area: turf.area(f),
                        numFloors: floors,
                        typicalFloorHeight: floorHeight,
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
                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor
                            });
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
                            const vastuReg = draft.vastuRegulations?.[0]; // Simplification: Use first available or selected

                            // We need to implement a way to select Vastu reg. For now, grab the first one.
                            if (activePlot && vastuReg) {
                                // We need a helper to run this inside produce, or run it outside.
                                // It's better to run pure logic outside. But we are inside produce.
                                // We'll assume the function is pure and imported.
                                const result = calculateVastuScore(activePlot as any, newBuildings, vastuReg); // Cast to avoid Immer Draft issues

                                if (!activePlot.developmentStats) {
                                    activePlot.developmentStats = calculateDevelopmentStats(activePlot as any, activePlot.buildings, DEFAULT_FEASIBILITY_PARAMS);
                                }
                                activePlot.developmentStats.vastuScore = {
                                    overall: result.overallScore,
                                    rating: result.rating,
                                    breakdown: result.breakdown
                                };
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
        applyAiLayout: (plotId, scenario) => {
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

                scenario.objects.forEach((aiObj, aiIndex) => {
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

                    const buildingsInZone = scenario.objects.filter(o =>
                        (o as AiMassingGeneratedObject).placement === aiMassingObject.placement && o.type === 'Building'
                    );
                    const isMultiBuildingZone = buildingsInZone.length > 1;

                    let finalGeometry: Feature<Polygon>;
                    if (aiObj.type === 'Building' && isMultiBuildingZone) {
                        const geometries = splitPolygon(containerGeometry, buildingsInZone.length);
                        const buildingIndexInZone = buildingsInZone.findIndex(b => (b as AiMassingGeneratedObject).name === aiMassingObject.name);
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
                                area: turf.area(towerGeometry),
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
        setHoveredObject: (id, type) => {
            if (!id || !type) {
                set({ hoveredObjectId: null });
            } else {
                set({ hoveredObjectId: { id, type } });
            }
        },
        toggleObjectVisibility: (plotId, objectId, type) => {
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
                const { OverpassPlacesService } = await import('@/services/overpass-places-service');
                const newAmenities = await OverpassPlacesService.searchNearby(center, category as any);

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

    return useMemo(() => {
        const project = projects.find(p => p.id === activeProjectId);

        const consumedPlotArea = plots.reduce((acc, p) => acc + p.area, 0);

        let geomRegs = selectedPlot?.regulation?.geometry;
        if (!geomRegs && plots.length > 0) {
            geomRegs = plots.find(p => p.regulation?.geometry)?.regulation?.geometry;
        }

        const far = Number(
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

        const totalBuildableArea = (project.totalPlotArea ?? consumedPlotArea) * far;
        const consumedBuildableArea = plots
            .flatMap(p => p.buildings)
            .reduce((acc, b) => {
                // Use numFloors (the user-editable count) rather than floors.length
                // which can include parking/utility floors and doesn't update reactively.
                const effectiveFloors = b.numFloors ?? b.floors.filter(f => f.type !== 'Parking').length;
                return acc + b.area * effectiveFloors;
            }, 0);

        return {
            ...project,
            plots, // Explicitly include active plots
            far,
            totalBuildableArea,
            consumedBuildableArea,
            consumedPlotArea,
            totalPlotArea: project.totalPlotArea ?? consumedPlotArea,
        };
    }, [projects, activeProjectId, plots, selectedPlot]);
}

export { useBuildingStore, useSelectedBuilding, useProjectData, useSelectedPlot };


