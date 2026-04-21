'use client';

import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useBuildingStore, useSelectedPlot, useProjectData } from '@/hooks/use-building-store';
import type { BuildingIntendedUse } from '@/lib/types';
import { Info, RotateCcw, Box, Layers, Maximize, Move, MousePointer, AlertTriangle, Sparkles, MousePointerClick } from "lucide-react";
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';


// Building typology icons
const typologyIcons = {
    point: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="15" y="10" width="10" height="20" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    slab: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="8" y="15" width="24" height="10" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    lshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 22 10 L 22 18 L 30 18 L 30 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    ushaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 15 10 L 15 25 L 25 25 L 25 10 L 30 10 L 30 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    oshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <rect x="10" y="10" width="20" height="20" className="fill-current stroke-current stroke-[1.5]" />
            <rect x="15" y="15" width="10" height="10" className="fill-background stroke-current stroke-[1.5]" />
        </svg>
    ),
    tshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 30 10 L 30 18 L 24 18 L 24 30 L 16 30 L 16 18 L 10 18 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
    hshaped: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 10 10 L 15 10 L 15 18 L 25 18 L 25 10 L 30 10 L 30 30 L 25 30 L 25 22 L 15 22 L 15 30 L 10 30 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
};

const parkingIcons = {
    none: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <circle cx="20" cy="20" r="14" className="stroke-current stroke-[1.5] fill-none" />
            <line x1="10" y1="10" x2="30" y2="30" className="stroke-current stroke-[1.5]" />
        </svg>
    ),
    ug: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 12 L 28 20 L 20 28 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
            <path d="M 20 22 L 20 30" className="stroke-current stroke-[2] fill-none" markerEnd="url(#arrow)" />
        </svg>
    ),
    pod: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 12 L 28 20 L 20 28 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
            <path d="M 20 18 L 20 10" className="stroke-current stroke-[2] fill-none" markerEnd="url(#arrow-up)" />
        </svg>
    ),
    surface: (
        <svg viewBox="0 0 40 40" className="w-full h-full">
            <path d="M 20 15 L 28 20 L 20 25 L 12 20 Z" className="fill-current stroke-current stroke-[1.5]" />
        </svg>
    ),
};

type BuildingTypology = 'point' | 'slab' | 'lshaped' | 'ushaped' | 'oshaped' | 'tshaped' | 'hshaped';
type ParkingTypology = 'none' | 'ug' | 'pod' | 'surface';
type LandUseType = 'residential' | 'commercial' | 'mixed' | 'institutional' | 'industrial';

// Height-wise setback table (NBC / highrise norms)
// Each entry: maxHeightM = upper bound (inclusive), setbackM = min setback on all sides
const HEIGHT_SETBACK_TABLE: { maxHeightM: number; setbackM: number }[] = [
    { maxHeightM: 15, setbackM: 5 },
    { maxHeightM: 18, setbackM: 6 },
    { maxHeightM: 24, setbackM: 8 },
    { maxHeightM: 30, setbackM: 10 },
    { maxHeightM: 40, setbackM: 12 },
    { maxHeightM: 50, setbackM: 14 },
    { maxHeightM: Infinity, setbackM: 16 }, // 55m+
];

/** Returns the minimum setback (all sides) for a given building height. */
function getHeightBasedSetback(buildingHeightM: number): number {
    for (const { maxHeightM, setbackM } of HEIGHT_SETBACK_TABLE) {
        if (buildingHeightM <= maxHeightM) return setbackM;
    }
    return 16;
}

export function ParametricToolbar({ embedded = false }: { embedded?: boolean }) {
    const { actions, plots, generationParams, designOptions, selectedObjectId } = useBuildingStore(state => ({
        actions: state.actions,
        plots: state.plots,
        generationParams: state.generationParams,
        designOptions: state.designOptions,
        selectedObjectId: state.selectedObjectId,
    }));

    const [selectedTypologies, setSelectedTypologies] = useState<BuildingTypology[]>(['point']);
    const [selectedParking, setSelectedParking] = useState<ParkingTypology[]>(['ug', 'surface']);
    const projectData = useProjectData();
    const isVastuEnabled = projectData?.vastuCompliant;
    const [targetGFA, setTargetGFA] = useState(0);
    const [targetFAR, setTargetFAR] = useState(3.0);
    const [floorRange, setFloorRange] = useState([5, 12]);
    const [heightRange, setHeightRange] = useState([16.8, 39.2]);
    const [footprintRange, setFootprintRange] = useState([400, 1000]);
    const [scrRange, setScrRange] = useState<[number, number]>([2.0, 4.0]);
    const [parkingRatio, setParkingRatio] = useState(0.30);
    const [buildingWidthRange, setBuildingWidthRange] = useState<[number, number]>([20, 25]);
    const [buildingLengthRange, setBuildingLengthRange] = useState<[number, number]>([25, 55]);
    const [buildingCount, setBuildingCount] = useState(2);
    const [gridOrientation, setGridOrientation] = useState(0);
    const [avgUnitSize, setAvgUnitSize] = useState(85);
    const [commercialPercent, setCommercialPercent] = useState(0);
    const [setback, setSetback] = useState(5);
    const [frontSetback, setFrontSetback] = useState<number | undefined>(undefined);
    const [rearSetback, setRearSetback] = useState<number | undefined>(undefined);
    const [sideSetback, setSideSetback] = useState<number | undefined>(undefined);
    const [siteCoverage, setSiteCoverage] = useState(0.6);
    const [useFloorLimit, setUseFloorLimit] = useState(true);
    const [useHeightBasedSetback, setUseHeightBasedSetback] = useState(false);
    const [infillSetback, setInfillSetback] = useState(6);
    const [infillMode, setInfillMode] = useState<'ring' | 'grid' | 'hybrid'>('hybrid');

    const [floorHeight, setFloorHeight] = useState(3.5);
    const [groundFloorHeight, setGroundFloorHeight] = useState(4.5);
    const [landUse, setLandUse] = useState<LandUseType>('residential');
    const [programMix, setProgramMix] = useState({
        residential: 100,
        commercial: 0,
        institutional: 0,
        hospitality: 0
    });

    const [commercialMix, setCommercialMix] = useState({
        retail: 40,
        office: 60
    });

    const [unitAreaConfig, setUnitAreaConfig] = useState({
        '2BHK': 140,
        '3BHK': 185,
        '4BHK': 245
    });

    const [shuffleUnits, setShuffleUnits] = useState(false);
    const [exactTypologyAllocation, setExactTypologyAllocation] = useState(true); // DEFAULT ON
    const [allocationMode, setAllocationMode] = useState<'floor' | 'plot'>('floor');
    const [commercialShape, setCommercialShape] = useState<'large-footprint' | 'block'>('block');
    const [selectedUtilities, setSelectedUtilities] = useState<string[]>(['Roads', 'Water', 'Electrical', 'HVAC', 'STP', 'WTP', 'Solar PV', 'EV Charging']);

    // Constraints
    const [regulationMaxFloors, setRegulationMaxFloors] = useState(60);
    const [maxAllowedHeight, setMaxAllowedHeight] = useState(100);
    const [regulationMaxFAR, setRegulationMaxFAR] = useState(4.0);
    const [regulationMaxCoverage, setRegulationMaxCoverage] = useState(1.0);

    // Compliance Override
    const [maxFootprintOverride, setMaxFootprintOverride] = useState<number | undefined>(undefined);
    const [minFootprintOverride, setMinFootprintOverride] = useState<number>(100);

    // Podium / Stepped Massing Controls
    const [hasPodium, setHasPodium] = useState(false);
    const [podiumFloors, setPodiumFloors] = useState(2);
    const [upperFloorReduction, setUpperFloorReduction] = useState(30);

    // Scenario Management State
    const [seedOffset, setSeedOffset] = useState(0);


    // Update mix when land use changes
    useEffect(() => {
        if (landUse === 'residential') setProgramMix({ residential: 100, commercial: 0, institutional: 0, hospitality: 0 });
        else if (landUse === 'commercial') setProgramMix({ residential: 0, commercial: 100, institutional: 0, hospitality: 0 });
        else if (landUse === 'institutional') setProgramMix({ residential: 0, commercial: 0, institutional: 100, hospitality: 0 });
        else if (landUse === 'industrial') setProgramMix({ residential: 0, commercial: 100, institutional: 0, hospitality: 0 });
        else if (landUse === 'mixed') setProgramMix({ residential: 40, commercial: 40, institutional: 10, hospitality: 10 });
    }, [landUse]);

    // Sync design params to store for the top-level AI rendering button
    useEffect(() => {
        actions.setRenderingDesignParams({
            landUse,
            unitMix: unitAreaConfig,
            selectedUtilities,
            hasPodium,
            podiumFloors,
            parkingTypes: selectedParking.filter(p => p !== 'none'),
            typology: selectedTypologies[0] || 'point',
        });
    }, [landUse, unitAreaConfig, selectedUtilities, hasPodium, podiumFloors, selectedParking, selectedTypologies, actions]);

    // Derive the truly selected plot based on user selection
    const selectedPlot = selectedObjectId?.type === 'Plot'
        ? plots.find(p => p.id === selectedObjectId.id)
        : selectedObjectId
            ? plots.find(p => p.buildings.some(b => b.id === selectedObjectId.id) || p.greenAreas.some(g => g.id === selectedObjectId.id) || p.parkingAreas.some(pk => pk.id === selectedObjectId.id))
            : undefined;
    const selectedBuilding = selectedObjectId?.type === 'Building'
        ? selectedPlot?.buildings.find(b => b.id === selectedObjectId.id)
        : selectedPlot?.buildings.length === 1
            ? selectedPlot.buildings[0]
            : undefined;

    // Apply typology-specific dimensions on initial mount and when landUse/typology changes
    useEffect(() => {
        if (selectedTypologies.length === 1) {
            const t = selectedTypologies[0];
            const isCommercialType = landUse === 'commercial' || landUse === 'institutional';
            
            if (t === 'point') {
                setBuildingWidthRange(isCommercialType ? [20, 20] : [20, 25]);
                setBuildingLengthRange([25, 30]); // Squarish for point blocks
            } else if (t === 'slab') {
                setBuildingWidthRange(isCommercialType ? [20, 20] : [20, 22]);
                setBuildingLengthRange([40, 55]); // Long for slabs
            } else if (['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(t)) {
                setBuildingWidthRange(isCommercialType ? [20, 20] : [20, 25]);
                setBuildingLengthRange([40, 55]);
            }
        }
    }, [selectedTypologies, landUse]);

    useEffect(() => {
        if (selectedPlot?.setback) {
            setSetback(selectedPlot.setback);
        }
    }, [selectedPlot?.setback]);

    useEffect(() => {
        if (selectedPlot) {
            const regSetback = selectedPlot.regulation?.geometry?.setback?.value
                || selectedPlot.regulation?.geometry?.min_setback?.value
                || selectedPlot.regulation?.geometry?.front_setback?.value;

            const initialSetback = regSetback ?? selectedPlot.setback ?? 5;

            console.log('[Parametric Toolbar] Initializing setback for plot:', {
                plotId: selectedPlot.id,
                regSetback,
                plotSetback: selectedPlot.setback,
                initialSetback
            });

            setSetback(initialSetback);
        }
    }, [selectedPlot?.id]);

    const initializedPlotIdRef = useRef<string | null>(null);

    // Apply regulations when plot changes
    useEffect(() => {
        if (selectedPlot?.regulation?.geometry && selectedPlot.id !== initializedPlotIdRef.current) {
            initializedPlotIdRef.current = selectedPlot.id;
            const geomRegs = selectedPlot.regulation.geometry;



            // Height and Floors
            const maxFloorsValue = geomRegs['max_floors']?.value
                || geomRegs['number_of_floors']?.value
                || geomRegs['floors']?.value;

            const maxHeightValue = geomRegs['max_height']?.value || geomRegs['building_height']?.value;

            if (maxFloorsValue !== undefined) {
                const mf = Number(maxFloorsValue);
                if (!isNaN(mf) && mf > 0) {
                    setRegulationMaxFloors(mf);
                    setFloorRange([Math.max(1, Math.min(5, mf)), mf]);
                    setMaxAllowedHeight(mf * 3.5);
                }
            } else if (maxHeightValue) {
                const maxHeight = Number(maxHeightValue);
                if (!isNaN(maxHeight)) {
                    setMaxAllowedHeight(maxHeight);
                    setHeightRange(prev => [prev[0], Math.min(prev[1], maxHeight)]);
                    const mf = Math.floor(maxHeight / 3.5);
                    setRegulationMaxFloors(mf);
                    setFloorRange([Math.max(1, Math.min(5, mf)), mf]);
                }
            }

            // Setback
            const setbackValue = geomRegs['setback']?.value
                || geomRegs['min_setback']?.value
                || geomRegs['front_setback']?.value
                || geomRegs['building_setback']?.value;

            // FAR
            const farValue = geomRegs['floor_area_ratio']?.value
                || geomRegs['max_far']?.value
                || geomRegs['fsi']?.value;

            console.log('[Parametric Toolbar] Regulation fetch:', {
                regulationType: selectedPlot.selectedRegulationType,
                setbackValue,
                farValue
            });

            if (setbackValue !== undefined) {
                const sb = Number(setbackValue);
                if (!isNaN(sb) && sb > 0) {
                    setSetback(sb);
                }
            }

            // Variable Setbacks
            if (geomRegs['front_setback']?.value) setFrontSetback(Number(geomRegs['front_setback'].value));
            if (geomRegs['rear_setback']?.value) setRearSetback(Number(geomRegs['rear_setback'].value));
            if (geomRegs['side_setback']?.value) setSideSetback(Number(geomRegs['side_setback'].value));

            if (farValue !== undefined) {
                const far = Number(farValue);
                if (!isNaN(far) && far > 0) {
                    setRegulationMaxFAR(far);
                    setTargetFAR(selectedPlot.userFAR ?? far);
                }
            } else if (selectedPlot.userFAR) {
                setTargetFAR(selectedPlot.userFAR);
            }

            // Coverage
            const coverageValue = geomRegs['max_ground_coverage']?.value
                || geomRegs['ground_coverage']?.value
                || geomRegs['coverage']?.value;

            if (coverageValue !== undefined) {
                const cv = Number(coverageValue);
                if (!isNaN(cv) && cv > 0) {
                    const decimalCoverage = cv / 100;
                    setRegulationMaxCoverage(decimalCoverage);
                    setSiteCoverage(decimalCoverage);
                }
            }
        }
    }, [selectedPlot?.id, selectedPlot?.regulation]);

    useEffect(() => {
        if (selectedPlot?.area) {
            const gfa = Math.round(selectedPlot.area * targetFAR);
            setTargetGFA(gfa);
        }
    }, [targetFAR, selectedPlot?.area]);

    // Ref to remember the manual setback before height-based mode overrides it
    const manualSetbackRef = useRef(setback);

    // Live-sync height-based setback to store when toggle is ON (reacts to floor/height changes)
    useEffect(() => {
        if (!selectedPlot || !useHeightBasedSetback) return;
        const estH = floorRange[1] * floorHeight;
        const hSb = getHeightBasedSetback(estH);
        const effective = Math.max(manualSetbackRef.current, hSb);
        if (effective !== selectedPlot.setback) {
            actions.updatePlot(selectedPlot.id, { setback: effective });
        }
    }, [useHeightBasedSetback, floorRange, floorHeight, selectedPlot?.id]);

    // Toggle handler: save/restore manual setback synchronously (avoids useEffect ordering bugs)
    const handleToggleHeightSetback = () => {
        if (!useHeightBasedSetback) {
            // About to turn ON — save current manual setback
            manualSetbackRef.current = setback;
        } else {
            // About to turn OFF — restore saved manual setback
            const saved = manualSetbackRef.current;
            setSetback(saved);
            if (selectedPlot) {
                actions.updatePlot(selectedPlot.id, { setback: saved });
            }
        }
        setUseHeightBasedSetback(v => !v);
    };

    useEffect(() => {
        if (selectedPlot?.selectedRegulationType) {
            const regType = selectedPlot.selectedRegulationType.toLowerCase();
            if (regType.includes('mixed')) {
                setLandUse('mixed');
            } else if (regType.includes('commercial') || regType.includes('shopping') || regType.includes('retail') || regType.includes('office')) {
                setLandUse('commercial');
            } else if (regType.includes('industrial') || regType.includes('warehouse') || regType.includes('storage') || regType.includes('manufacturing')) {
                setLandUse('industrial');
            } else if (regType.includes('institutional') || regType.includes('public') || regType.includes('civic') || regType.includes('government')) {
                setLandUse('institutional');
            } else if (regType.includes('residential') || regType.includes('housing') || regType.includes('plotted')) {
                setLandUse('residential');
            }
        }
    }, [selectedPlot?.selectedRegulationType]);

    const handleGenerate = () => {
        if (!selectedPlot) {
            return;
        }

        // Compute effective setback: height-based override if toggle is on
        const estimatedMaxHeight = floorRange[1] * floorHeight;
        const heightDerivedSetback = getHeightBasedSetback(estimatedMaxHeight);
        const effectiveSetback = useHeightBasedSetback
            ? Math.max(setback, heightDerivedSetback)
            : setback;
        // When height-based setback is ON, ALWAYS enforce the height-derived minimum
        // for all directional setbacks — even if the user hasn't manually overridden them.
        // This ensures arms, gaps, and spacing all respect the height constraint.
        const effectiveFront = useHeightBasedSetback
            ? Math.max(frontSetback ?? heightDerivedSetback, heightDerivedSetback)
            : frontSetback;
        const effectiveRear = useHeightBasedSetback
            ? Math.max(rearSetback ?? heightDerivedSetback, heightDerivedSetback)
            : rearSetback;
        const effectiveSide = useHeightBasedSetback
            ? Math.max(sideSetback ?? heightDerivedSetback, heightDerivedSetback)
            : sideSetback;

        const params: any = {
            typologies: selectedTypologies,
            targetGFA: targetGFA,
            targetFAR,
            minFloors: floorRange[0],
            maxFloors: floorRange[1],
            autoMaxGFA: !useFloorLimit,
            infillSetback: !useFloorLimit ? infillSetback : undefined,
            infillMode: !useFloorLimit ? infillMode : undefined,
            minHeight: heightRange[0],
            maxHeight: heightRange[1],
            parkingType: selectedParking[0],
            parkingTypes: selectedParking,
            parkingRatio,
            // minFootprint: minFootprintOverride,
            // maxFootprint: maxFootprintOverride,
            minSCR: scrRange[0],
            maxSCR: scrRange[1],
            gridOrientation,
            avgUnitSize,
            commercialPercent,
            minBuildingWidth: buildingWidthRange[0],
            maxBuildingWidth: buildingWidthRange[1],
            minBuildingLength: buildingLengthRange[0],
            maxBuildingLength: buildingLengthRange[1],
            width: buildingWidthRange[1],
            minLength: buildingLengthRange[0],
            buildingCount,
            floorHeight,
            groundFloorHeight,
            landUse,
            programMix,
            commercialMix,
            allocationMode,
            commercialShape,
            selectedUtilities,
            // params.setback = user's base setback (for mainSetback / boundary shrink).
            // Height-based values go into directional setbacks only (front/rear/side).
            // This ensures extras = frontSetback - mainSetback > 0, pushing buildings inward
            // — same behavior as manually increasing front setback.
            // When height-based is ON, use the saved manual setback (before override).
            setback: useHeightBasedSetback ? manualSetbackRef.current : setback,
            frontSetback: effectiveFront,
            rearSetback: effectiveRear,
            sideSetback: effectiveSide,
            maxAllowedFAR: targetFAR,
            siteCoverage,
            seedOffset,
            vastuCompliant: projectData?.vastuCompliant || false,
            hasPodium,
            podiumFloors,
            upperFloorReduction,
            unitMix: [
                { name: '2BHK', mixRatio: 1, area: unitAreaConfig['2BHK'] },
                { name: '3BHK', mixRatio: 1, area: unitAreaConfig['3BHK'] },
                { name: '4BHK', mixRatio: 1, area: unitAreaConfig['4BHK'] }
            ].filter(u => u.area > 0),
            shuffleUnits,
            exactTypologyAllocation
        };

        const newOffset = seedOffset + 3;
        setSeedOffset(newOffset);
        params.seedOffset = newOffset;

        console.log('[ParametricToolbar] Generating with params:', {
            setback,
            sideSetback,
            paramsSideSetback: params.sideSetback
        });


        actions.generateScenarios(selectedPlot.id, params);
    };

    const Container = embedded ? 'div' : Card;

    const baseLandUse = selectedPlot?.regulation?.type || 'residential';
    const isLargeFootprint = typeof baseLandUse === 'string' && ['commercial', 'public', 'industrial', 'institutional'].some(t => baseLandUse.toLowerCase().includes(t));

    return (
        <TooltipProvider>
            <Container className={cn("flex flex-col font-sans h-full", embedded ? "" : "w-full shadow-xl bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 max-h-[calc(100vh-200px)]")}>
                <div className="px-3 py-2 border-b shrink-0">
                    <h2 className="text-xs font-semibold flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Design Strategy
                    </h2>
                </div>

                <div className={cn("flex-1 overflow-y-auto overflow-x-hidden min-h-0", embedded ? "p-3 scrollbar-thin" : "p-3 space-y-4 scrollbar-thin")}>
                    {selectedPlot ? (
                        <div className="space-y-4">
                            {/* Generation Mode: Parametric Only */}



                            {/* Regulation / Zone Display (Read-Only) */}

                            {selectedPlot.regulation ? (
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Regulation / Zone</Label>
                                    <div className="text-xs font-medium px-3 py-2 rounded-md border border-input bg-muted/50 text-foreground">
                                        {selectedPlot.regulation.type}
                                    </div>
                                </div>
                            ) : null}

                            {/* Building Typologies */}
                            {!isLargeFootprint ? (
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Typology</Label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {(['point', 'slab', 'lshaped', 'ushaped', 'tshaped', 'hshaped'] as BuildingTypology[]).map(type => (
                                            <Tooltip key={type}>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedTypologies(prev => {
                                                                let next = prev;
                                                                if (prev.includes(type)) {
                                                                    if (prev.length === 1) next = prev;
                                                                    else next = prev.filter(t => t !== type);
                                                                } else {
                                                                    next = [...prev, type];
                                                                }

                                                                if (next.length === 1) {
                                                                    const t = next[0];
                                                                    if (t === 'point') {
                                                                        setBuildingWidthRange([20, 25]);
                                                                        setBuildingLengthRange([25, 30]);
                                                                    } else if (t === 'slab') {
                                                                        setBuildingWidthRange([20, 22]);
                                                                        setBuildingLengthRange([40, 55]);
                                                                    } else if (['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(t)) {
                                                                        setBuildingWidthRange([20, 25]);
                                                                        setBuildingLengthRange([40, 55]);
                                                                    }
                                                                }
                                                                return next;
                                                            });
                                                        }}
                                                        className={cn(
                                                            'flex-shrink-0 w-14 h-14 rounded-md border p-1 transition-all flex flex-col items-center justify-center gap-0.5',
                                                            selectedTypologies.includes(type)
                                                                ? 'border-primary bg-primary text-primary-foreground ring-1 ring-primary/50 shadow-sm'
                                                                : 'border-border bg-background hover:bg-muted/80 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                                                        )}
                                                    >
                                                        <div className="h-5 w-5">{typologyIcons[type]}</div>
                                                        <span className="text-[10px] font-medium capitalize truncate w-full text-center">{type === 'lshaped' ? 'L-Shape' : type === 'ushaped' ? 'U-Shape' : type === 'tshaped' ? 'T-Shape' : type === 'hshaped' ? 'H-Shape' : type === 'oshaped' ? 'O-Shape' : type}</span>
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">
                                                    <p>{type === 'lshaped' ? 'L-Shaped Building' : type === 'ushaped' ? 'U-Shaped Building' : type === 'point' ? 'Point Block' : type === 'slab' ? 'Linear Slab' : type === 'tshaped' ? 'T-Shaped Building' : type === 'hshaped' ? 'H-Shaped Building' : `${type.charAt(0).toUpperCase() + type.slice(1)} Shape`}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Typology</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => setCommercialShape('large-footprint')}
                                            className={cn(
                                                'flex flex-col items-center gap-1.5 p-2.5 rounded-md border transition-all',
                                                commercialShape === 'large-footprint'
                                                    ? 'border-primary bg-primary/20 text-primary ring-1 ring-primary/50 shadow-sm'
                                                    : 'border-border bg-background hover:bg-muted/80 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            <div className="w-8 h-8 flex items-center justify-center">
                                                <svg viewBox="0 0 40 40" className="w-full h-full">
                                                    <path d="M5,8 L18,5 L35,10 L32,35 L8,32 Z" className="stroke-current stroke-2 fill-current/20" />
                                                </svg>
                                            </div>
                                            <span className="text-[10px] font-medium">Plot Shape</span>
                                        </button>
                                        <button
                                            onClick={() => setCommercialShape('block')}
                                            className={cn(
                                                'flex flex-col items-center gap-1.5 p-2.5 rounded-md border transition-all',
                                                commercialShape === 'block'
                                                    ? 'border-primary bg-primary/20 text-primary ring-1 ring-primary/50 shadow-sm'
                                                    : 'border-border bg-background hover:bg-muted/80 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            <div className="w-8 h-8 flex items-center justify-center">
                                                <svg viewBox="0 0 40 40" className="w-full h-full">
                                                    <rect x="5" y="8" width="30" height="24" rx="2" className="stroke-current stroke-2 fill-current/20" />
                                                </svg>
                                            </div>
                                            <span className="text-[10px] font-medium">Block</span>
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-muted-foreground/70 italic px-1">
                                        {commercialShape === 'block' ? 'Clean square/rectangle footprints' : 'Buildings follow the plot boundary shape'}
                                    </p>
                                </div>
                            )}

                            {/* Land Use */}
                            {/* <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Land Use</Label>
                            <div className="flex bg-muted/30 p-0.5 rounded-lg border">
                                {(['residential', 'commercial', 'mixed', 'institutional'] as LandUseType[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setLandUse(type)}
                                        className={cn(
                                            'flex-1 h-7 text-[10px] font-medium rounded-md transition-all capitalize',
                                            landUse === type ? 'bg-background shadow-sm text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div> */}

                            {/* Podium / Stepped Massing Controls (Commercial/Public/Industrial Only) */}
                            {/*
                            {(landUse === 'commercial' || landUse === 'institutional') && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider cursor-pointer" onClick={() => setHasPodium(!hasPodium)}>
                                            Stepped / Podium Massing
                                        </Label>
                                        <input
                                            type="checkbox"
                                            checked={hasPodium}
                                            onChange={(e) => setHasPodium(e.target.checked)}
                                            className="h-3 w-3 accent-primary"
                                        />
                                    </div>
                                    
                                    {hasPodium && (
                                        <div className="space-y-3 pt-2">
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Podium Floors</span>
                                                    <span>{podiumFloors} floors</span>
                                                </div>
                                                <Slider
                                                    value={[podiumFloors]}
                                                    min={1}
                                                    max={5}
                                                    step={1}
                                                    onValueChange={([val]) => setPodiumFloors(val)}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Upper Floor Reduction</span>
                                                    <span>{upperFloorReduction}%</span>
                                                </div>
                                                <Slider
                                                    value={[upperFloorReduction]}
                                                    min={10}
                                                    max={60}
                                                    step={5}
                                                    onValueChange={([val]) => setUpperFloorReduction(val)}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            */}

                            {/* Unit Mix Allocation (Residential / Mixed Only) - Exact Typology is now the default */}
                            {(landUse === 'residential' || landUse === 'mixed') && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Unit Areas (sqm)</Label>
                                    </div>

                                    <div className="space-y-3 pl-1">
                                        {Object.entries(unitAreaConfig).map(([type, value]) => (
                                            <div key={type} className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-2 w-1/3">
                                                    <div className={cn(
                                                        "w-2 h-2 rounded-full",
                                                        type === '2BHK' && "bg-[#1E90FF]",
                                                        type === '3BHK' && "bg-[#DA70D6]",
                                                        type === '4BHK' && "bg-[#FFD700]"
                                                    )} />
                                                    <span className="text-[10px] font-medium text-muted-foreground">{type}</span>
                                                </div>
                                                <div className="flex-1 flex items-center gap-2">
                                                    <Slider
                                                        value={[value]}
                                                        min={50}
                                                        max={500}
                                                        step={5}
                                                        onValueChange={([val]) => setUnitAreaConfig(prev => ({ ...prev, [type]: val }))}
                                                        className={cn(
                                                            "[&_.relative]:h-1.5 [&_span]:h-3 [&_span]:w-3",
                                                            type === '2BHK' && "[&_.absolute]:bg-[#1E90FF]",
                                                            type === '3BHK' && "[&_.absolute]:bg-[#DA70D6]",
                                                            type === '4BHK' && "[&_.absolute]:bg-[#FFD700]"
                                                        )}
                                                    />
                                                    <div className="flex items-center gap-1 shrink-0 w-16">
                                                        <input
                                                            type="number"
                                                            value={value}
                                                            onChange={(e) => setUnitAreaConfig(prev => ({ ...prev, [type]: Number(e.target.value) || 0 }))}
                                                            className="w-[42px] h-6 rounded border bg-background px-1 text-[10px] text-right focus:outline-none focus:ring-1 focus:ring-primary"
                                                        />
                                                        <span className="text-[9px] text-muted-foreground">m²</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Shuffle Toggle */}
                                    {/* <div className="flex items-center justify-between pt-1 border-t border-border/30">
                                        <Label className="text-[10px] text-muted-foreground cursor-pointer" onClick={() => setShuffleUnits(!shuffleUnits)}>
                                            Shuffle Unit Order
                                        </Label>
                                        <input
                                            type="checkbox"
                                            checked={shuffleUnits}
                                            onChange={(e) => setShuffleUnits(e.target.checked)}
                                            className="h-3 w-3 accent-primary"
                                        />
                                    </div> */}

                                    {/* Exact Typology Allocation Toggle */}
                                    {/* <div className="flex items-center justify-between pt-1">
                                        <div>
                                            <Label className="text-[10px] text-muted-foreground cursor-pointer" onClick={() => setExactTypologyAllocation(!exactTypologyAllocation)}>
                                                Exact Typology Sizes
                                            </Label>
                                            <p className="text-[9px] text-muted-foreground/60 italic leading-tight mt-0.5">
                                                Uses theoretical m² per BHK type instead of fitted geometry
                                            </p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={exactTypologyAllocation}
                                            onChange={(e) => setExactTypologyAllocation(e.target.checked)}
                                            className="h-3 w-3 accent-primary"
                                        />
                                    </div> */}
                                </div>
                            )}

                            {/* Podium / Stepped Massing Controls (Residential) */}
                            {landUse === 'residential' && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <button className="flex items-center justify-between w-full" onClick={() => setHasPodium(!hasPodium)}>
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider cursor-pointer">
                                            Stepped / Podium Massing
                                        </Label>
                                        <div className={cn(
                                            'h-4 w-7 rounded-full transition-colors relative',
                                            hasPodium ? 'bg-primary' : 'bg-muted-foreground/30'
                                        )}>
                                            <div className={cn(
                                                'h-3 w-3 rounded-full bg-white absolute top-0.5 transition-transform',
                                                hasPodium ? 'translate-x-3.5' : 'translate-x-0.5'
                                            )} />
                                        </div>
                                    </button>

                                    {hasPodium && (
                                        <div className="space-y-3 pt-2">
                                    <p className="text-[10px] text-muted-foreground italic">
                                                Lower floors form the wide podium. Upper residential floors get a smaller footprint.
                                            </p>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Podium Floors</span>
                                                    <span>{podiumFloors} floors</span>
                                                </div>
                                                <Slider
                                                    value={[podiumFloors]}
                                                    min={1}
                                                    max={5}
                                                    step={1}
                                                    onValueChange={([val]) => setPodiumFloors(val)}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Upper Floor Reduction</span>
                                                    <span>{upperFloorReduction}%</span>
                                                </div>
                                                <Slider
                                                    value={[upperFloorReduction]}
                                                    min={10}
                                                    max={60}
                                                    step={5}
                                                    onValueChange={([val]) => setUpperFloorReduction(val)}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Commercial Use Breakdown */}
                            {landUse === 'commercial' && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <div className="space-y-3 pt-1">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Commercial Typology</Label>
                                            <Badge
                                                variant="outline"
                                                className={cn("text-[9px] h-4",
                                                    commercialMix.retail + commercialMix.office !== 100
                                                        ? "text-red-500 border-red-200"
                                                        : "text-green-600 border-green-200"
                                                )}
                                            >
                                                Total: {commercialMix.retail + commercialMix.office}%
                                            </Badge>
                                        </div>

                                        {/* Allocation Mode Toggle */}
                                        <div className="grid grid-cols-2 gap-1 bg-muted/30 p-1 rounded-md">
                                            <button
                                                onClick={() => setAllocationMode('floor')}
                                                className={cn(
                                                    "text-[10px] py-1 rounded-sm transition-all",
                                                    allocationMode === 'floor' ? "bg-background shadow-sm text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Floor-wise (Vertical)
                                            </button>
                                            <button
                                                onClick={() => setAllocationMode('plot')}
                                                className={cn(
                                                    "text-[10px] py-1 rounded-sm transition-all",
                                                    allocationMode === 'plot' ? "bg-background shadow-sm text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Plot-wise (Horizontal)
                                            </button>
                                        </div>

                                        {/* Retail / Office Sliders */}
                                        <div className="space-y-3 pl-1">
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Retail</span>
                                                    <span>{commercialMix.retail}%</span>
                                                </div>
                                                <Slider
                                                    value={[commercialMix.retail]}
                                                    max={100}
                                                    step={5}
                                                    onValueChange={([v]) => setCommercialMix({ retail: v, office: 100 - v })}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-pink-500 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Office</span>
                                                    <span>{commercialMix.office}%</span>
                                                </div>
                                                <Slider
                                                    value={[commercialMix.office]}
                                                    max={100}
                                                    step={5}
                                                    onValueChange={([v]) => setCommercialMix({ retail: 100 - v, office: v })}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-blue-500 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Program Allocations (Hidden for single use unless mixed) */}

                            {landUse === 'mixed' && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <div className="space-y-2">
                                        {/* Program Mix */}
                                        <div className="space-y-3 pt-1 mt-2">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Mix Allocation</Label>
                                                <Badge
                                                    variant="outline"
                                                    className={cn("text-[9px] h-4",
                                                        programMix.residential + programMix.commercial + programMix.institutional + programMix.hospitality !== 100
                                                            ? "text-red-500 border-red-200"
                                                            : "text-green-600 border-green-200"
                                                    )}
                                                >
                                                    Total: {programMix.residential + programMix.commercial + programMix.institutional + programMix.hospitality}%
                                                </Badge>
                                            </div>

                                            {/* Allocation Mode Toggle */}
                                            <div className="grid grid-cols-2 gap-1 bg-muted/30 p-1 rounded-md">
                                                <button
                                                    onClick={() => setAllocationMode('floor')}
                                                    className={cn(
                                                        "text-[10px] py-1 rounded-sm transition-all",
                                                        allocationMode === 'floor' ? "bg-background shadow-sm text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                                                    )}
                                                >
                                                    Floor-wise (Vertical)
                                                </button>
                                                <button
                                                    onClick={() => setAllocationMode('plot')}
                                                    className={cn(
                                                        "text-[10px] py-1 rounded-sm transition-all",
                                                        allocationMode === 'plot' ? "bg-background shadow-sm text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                                                    )}
                                                >
                                                    Plot-wise (Horizontal)
                                                </button>
                                            </div>

                                            {/* Mix Sliders */}
                                            <div className="space-y-3 pl-1">
                                                {/* Residential */}
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Residential</span>
                                                        <span>{programMix.residential}%</span>
                                                    </div>
                                                    <Slider
                                                        value={[programMix.residential]}
                                                        max={100}
                                                        step={5}
                                                        onValueChange={([v]) => setProgramMix(prev => ({ ...prev, residential: v }))}
                                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-orange-400 [&_span]:h-3 [&_span]:w-3"
                                                    />
                                                </div>

                                                {/* Commercial */}
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Commercial</span>
                                                        <span>{programMix.commercial}%</span>
                                                    </div>
                                                    <Slider
                                                        value={[programMix.commercial]}
                                                        max={100}
                                                        step={5}
                                                        onValueChange={([v]) => setProgramMix(prev => ({ ...prev, commercial: v }))}
                                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-blue-500 [&_span]:h-3 [&_span]:w-3"
                                                    />
                                                </div>

                                                {/* Sub-split for retail/office when commercial exists */}
                                                {programMix.commercial > 0 && (
                                                    <div className="pl-3 border-l-2 border-border/50 space-y-3 ml-1 py-1">
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between text-[9px]">
                                                                <span className="text-muted-foreground">Retail (within Commercial)</span>
                                                                <span>{commercialMix.retail}%</span>
                                                            </div>
                                                            <Slider
                                                                value={[commercialMix.retail]}
                                                                max={100}
                                                                step={5}
                                                                onValueChange={([v]) => setCommercialMix({ retail: v, office: 100 - v })}
                                                                className="[&_.relative]:h-1 [&_.absolute]:bg-pink-500 [&_span]:h-2.5 [&_span]:w-2.5"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between text-[9px]">
                                                                <span className="text-muted-foreground">Office (within Commercial)</span>
                                                                <span>{commercialMix.office}%</span>
                                                            </div>
                                                            <Slider
                                                                value={[commercialMix.office]}
                                                                max={100}
                                                                step={5}
                                                                onValueChange={([v]) => setCommercialMix({ retail: 100 - v, office: v })}
                                                                className="[&_.relative]:h-1 [&_.absolute]:bg-blue-400 [&_span]:h-2.5 [&_span]:w-2.5"
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Hospitality*/}
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Hospitality</span>
                                                        <span>{programMix.hospitality}%</span>
                                                    </div>
                                                    <Slider
                                                        value={[programMix.hospitality]}
                                                        max={100}
                                                        step={5}
                                                        onValueChange={([v]) => setProgramMix(prev => ({ ...prev, hospitality: v }))}
                                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-pink-500 [&_span]:h-3 [&_span]:w-3"
                                                    />
                                                </div>

                                                {/* Institutional */}
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Institutional/Public</span>
                                                        <span>{programMix.institutional}%</span>
                                                    </div>
                                                    <Slider
                                                        value={[programMix.institutional]}
                                                        max={100}
                                                        step={5}
                                                        onValueChange={([v]) => setProgramMix(prev => ({ ...prev, institutional: v }))}
                                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-yellow-500 [&_span]:h-3 [&_span]:w-3"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Podium for Mixed-Use (Floor-wise: auto-podium; Plot-wise: slider) */}
                            {landUse === 'mixed' && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <button className="flex items-center justify-between w-full" onClick={() => setHasPodium(!hasPodium)}>
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider cursor-pointer">
                                            Stepped / Podium Massing
                                        </Label>
                                        <div className={cn(
                                            'h-4 w-7 rounded-full transition-colors relative',
                                            hasPodium ? 'bg-primary' : 'bg-muted-foreground/30'
                                        )}>
                                            <div className={cn(
                                                'h-3 w-3 rounded-full bg-white absolute top-0.5 transition-transform',
                                                hasPodium ? 'translate-x-3.5' : 'translate-x-0.5'
                                            )} />
                                        </div>
                                    </button>

                                    {hasPodium && (
                                        <div className="space-y-3 pt-2">
                                            {allocationMode === 'floor' && (
                                                <p className="text-[11px] text-muted-foreground italic">
                                                    Retail, Office, Institutional &amp; Hospitality floors form the podium automatically. Residential becomes the tower.
                                                </p>
                                            )}
                                            {allocationMode === 'plot' && (
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Podium Floors (Residential)</span>
                                                        <span>{podiumFloors} floors</span>
                                                    </div>
                                                    <Slider
                                                        value={[podiumFloors]}
                                                        min={1}
                                                        max={5}
                                                        step={1}
                                                        onValueChange={([val]) => setPodiumFloors(val)}
                                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                    />
                                                </div>
                                            )}
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">Upper Floor Reduction</span>
                                                    <span>{upperFloorReduction}%</span>
                                                </div>
                                                <Slider
                                                    value={[upperFloorReduction]}
                                                    min={10}
                                                    max={60}
                                                    step={5}
                                                    onValueChange={([val]) => setUpperFloorReduction(val)}
                                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/50 [&_span]:h-3 [&_span]:w-3"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}


                            {/* --- SECTION: Site Layout --- */}
                            <div className="flex items-center gap-2 pt-2 pb-1">
                                <div className="h-px flex-1 bg-border/50"></div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Site Layout</span>
                                <div className="h-px flex-1 bg-border/50"></div>
                            </div>
                            {/* Parking Typology */}
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Parking</Label>
                                <div className="space-y-2">
                                    <div className="grid grid-cols-4 gap-2">
                                        {(['none', 'ug', 'surface'] as ParkingTypology[]).map(type => (
                                            <Tooltip key={type}>
                                                <TooltipTrigger asChild>
                                                    <button
                                                        onClick={() => {
                                                            if (type === 'none') {
                                                                setSelectedParking(['none']);
                                                            } else {
                                                                setSelectedParking(prev => {
                                                                    if (prev.includes('none')) return [type];
                                                                    if (prev.includes(type)) {
                                                                        const next = prev.filter(t => t !== type);
                                                                        return next.length ? next : ['none'];
                                                                    }
                                                                    return [...prev, type];
                                                                });
                                                            }
                                                        }}
                                                        className={cn(
                                                            'flex-shrink-0 h-10 rounded-md border p-1 transition-all flex items-center justify-center gap-2',
                                                            selectedParking.includes(type)
                                                                ? 'border-primary bg-primary/20 text-blue-400 ring-1 ring-primary/50 shadow-sm'
                                                                : 'border-border bg-background hover:bg-muted/80 hover:border-primary/50 text-foreground/70 hover:text-foreground'
                                                        )}
                                                    >
                                                        <div className="flex flex-col items-center gap-1">
                                                            <div className="h-4 w-4">{parkingIcons[type]}</div>
                                                            <span className="text-[10px] font-medium capitalize">{type === 'ug' ? 'Bsmt' : type === 'surface' ? 'Ground' : 'None'}</span>
                                                        </div>
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">
                                                    <p>{type === 'ug' ? 'Underground Parking' : type === 'surface' ? 'Surface/Ground Parking' : 'No Parking Provided'}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ))}
                                    </div>
                                    {/* <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="text-muted-foreground">Ratio</span>
                                            <span>{parkingRatio.toFixed(2)}</span>
                                        </div>
                                        <Slider
                                            value={[parkingRatio]}
                                            min={0.1}
                                            max={1.0}
                                            step={0.05}
                                            onValueChange={(val) => setParkingRatio(val[0])}
                                            className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                        />
                                    </div> */}
                                </div>
                            </div>

                            {/* Site Coverage Configuration */}
                            <div className="space-y-1.5 pt-2">
                                <div className="flex justify-between text-[10px]">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-bold uppercase text-muted-foreground tracking-wider">Site Utilization</span>
                                        <span className="text-[9px] text-muted-foreground/60">(Reg: {(regulationMaxCoverage * 100).toFixed(0)}%)</span>
                                    </div>
                                    <span className={cn(
                                        "font-medium",
                                        siteCoverage > regulationMaxCoverage ? "text-amber-500" : "text-foreground"
                                    )}>
                                        {(siteCoverage * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <div className="relative pt-1">
                                    <Slider
                                        value={[siteCoverage]}
                                        min={0.05}
                                        max={1.0}
                                        step={0.01}
                                        onValueChange={([v]) => setSiteCoverage(v)}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                    />
                                    {/* Regulation Limit Marker */}
                                    <div 
                                        className="absolute top-1 h-1.5 w-0.5 bg-destructive/40 pointer-events-none"
                                        style={{ left: `${regulationMaxCoverage * 100}%` }}
                                        title={`Regulation Limit: ${(regulationMaxCoverage * 100).toFixed(0)}%`}
                                    />
                                </div>
                            </div>

                            {/* Utilities Selection */}
                            <div className="space-y-1.5 pt-2">
                                <div className="flex justify-between items-center">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Utility Infrastructure</Label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 p-0 text-[10px] text-primary"
                                        onClick={() => {
                                            const ALL = ['Roads', 'Water', 'Rainwater Harvesting', 'Electrical', 'HVAC', 'DG Set', 'Gas', 'Fire', 'STP', 'Solid Waste', 'WTP', 'Admin', 'Solar PV', 'EV Charging'];
                                            if (selectedUtilities.length === ALL.length) setSelectedUtilities([]);
                                            else setSelectedUtilities(ALL);
                                        }}
                                    >
                                        {selectedUtilities.length === 14 ? 'Deselect All' : 'Select All'}
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {['Roads', 'Water', 'Rainwater Harvesting', 'Electrical', 'HVAC', 'DG Set', 'Gas', 'Fire', 'STP', 'Solid Waste', 'WTP', 'Admin', 'Solar PV', 'EV Charging'].map(type => (
                                        <Tooltip key={type}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => {
                                                        setSelectedUtilities(prev =>
                                                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                                        )
                                                    }}
                                                    className={cn(
                                                        'text-[10px] px-1.5 py-1.5 rounded-md border transition-all truncate',
                                                        selectedUtilities.includes(type)
                                                            ? 'bg-primary/10 border-primary/50 text-foreground font-medium'
                                                            : 'bg-muted/10 border-border text-muted-foreground hover:bg-muted/30'
                                                    )}
                                                >
                                                    {type === 'Rainwater Harvesting' ? 'RWH' : type === 'Solid Waste' ? 'Waste/OWC' : type === 'DG Set' ? 'DG Set' : type === 'Solar PV' ? 'Solar PV' : type === 'EV Charging' ? 'EV Charging' : type}
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                <p>Include {type} in generation</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    ))}
                                </div>
                            </div>

                            {/* --- SECTION: Building Specs --- */}
                            <div className="flex items-center gap-2 pt-2 pb-1">
                                <div className="h-px flex-1 bg-border/50"></div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Building Specs</span>
                                <div className="h-px flex-1 bg-border/50"></div>
                            </div>
                            {/* Building Dimensions / Building Count */}
                            {(['commercial', 'institutional', 'industrial', 'public'].includes(landUse?.toLowerCase() || '')) ? (
                                /* --- BUILDING COUNT for Commercial/Industrial/Public --- */
                                <div className="space-y-3 pt-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Number of Buildings</Label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[1, 2, 3, 4].map(count => (
                                            <button
                                                key={count}
                                                onClick={() => setBuildingCount(count)}
                                                className={cn(
                                                    'h-10 rounded-md border text-sm font-medium transition-all',
                                                    buildingCount === count
                                                        ? 'border-primary bg-primary text-primary-foreground ring-1 ring-primary/50 shadow-sm'
                                                        : 'border-border bg-background hover:bg-muted/80 hover:border-primary/50 text-muted-foreground hover:text-foreground'
                                                )}
                                            >
                                                {count}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground italic">
                                        Large buildings will fill the available area within setbacks.
                                    </p>
                                </div>
                            ) : (
                                /* --- BUILDING DIMENSIONS for Residential/Mixed --- */
                                <div className="space-y-3 pt-2">
                                    <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Building Dimensions</Label>

                                    {/* Height-Based Arm Constraint Badge */}
                                    {useHeightBasedSetback && (() => {
                                        const estH = floorRange[1] * floorHeight;
                                        const hSb = getHeightBasedSetback(estH);
                                        const minArmLen = hSb + 15; // arm must be deeper than setback + 15m min buildable
                                        const tooShort = buildingLengthRange[0] < minArmLen;
                                        return (
                                            <div className={cn(
                                                "rounded-md border px-2.5 py-1.5 text-[10px] space-y-0.5",
                                                tooShort
                                                    ? "bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400"
                                                    : "bg-primary/10 border-primary/30"
                                            )}>
                                                <div className="flex items-center justify-between">
                                                    <span className="font-semibold">Height-Arm Constraint</span>
                                                    <span className={cn("font-bold", tooShort ? "text-amber-500" : "text-primary")}>
                                                        Min arm ≥ {minArmLen}m
                                                    </span>
                                                </div>
                                                <p className="text-muted-foreground leading-tight">
                                                    Setback {hSb}m + 15m min depth. {tooShort
                                                        ? `⚠ Arm length ${buildingLengthRange[0]}m may be too short.`
                                                        : "✓ Arm length is sufficient."}
                                                </p>
                                            </div>
                                        );
                                    })()}

                                    {/* Width Range */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="text-muted-foreground">Arm Width</span>
                                            <span className={cn(buildingWidthRange[0] < 10 || buildingWidthRange[1] > 40 ? "text-destructive font-bold" : "")}>{buildingWidthRange[0]}m – {buildingWidthRange[1]}m</span>
                                        </div>
                                        <Slider
                                            value={buildingWidthRange}
                                            min={10}
                                            max={40}
                                            step={0.5}
                                            minStepsBetweenThumbs={1}
                                            onValueChange={(val) => setBuildingWidthRange(val as [number, number])}
                                            className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                        />
                                    </div>

                                    {/* Length (Arm Depth) Range */}
                                    <div className="space-y-1">
                                        {(() => {
                                            const estH = floorRange[1] * floorHeight;
                                            const hSb = getHeightBasedSetback(estH);
                                            const minArmLen = useHeightBasedSetback ? hSb + 15 : 15;
                                            const tooShort = useHeightBasedSetback && buildingLengthRange[0] < minArmLen;
                                            return (
                                                <>
                                                    <div className="flex justify-between text-[10px]">
                                                        <span className="text-muted-foreground">Arm Length</span>
                                                        <span className={cn(
                                                            tooShort ? "text-amber-500 font-bold" :
                                                            buildingLengthRange[0] < 15 || buildingLengthRange[1] > 100 ? "text-destructive font-bold" : ""
                                                        )}>
                                                            {buildingLengthRange[0]}m – {buildingLengthRange[1]}m
                                                            {tooShort && <span className="ml-1">⚠</span>}
                                                        </span>
                                                    </div>
                                                    <Slider
                                                        value={buildingLengthRange}
                                                        min={useHeightBasedSetback ? Math.max(minArmLen, 15) : 15}
                                                        max={100}
                                                        step={1}
                                                        minStepsBetweenThumbs={5}
                                                        onValueChange={(val) => {
                                                            const clamped: [number, number] = [
                                                                Math.max(val[0], minArmLen),
                                                                val[1]
                                                            ];
                                                            setBuildingLengthRange(clamped);
                                                        }}
                                                        className={cn(
                                                            "[&_.relative]:h-1.5 [&_span]:h-3 [&_span]:w-3",
                                                            tooShort
                                                                ? "[&_.absolute]:bg-amber-500/60"
                                                                : "[&_.absolute]:bg-primary/20"
                                                        )}
                                                    />
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}

                                {/* Constraints */}
                                <div className="space-y-3 pt-1">
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-[10px] font-medium text-foreground/80">Floor Ht</Label>
                                            <span className="text-[10px] text-muted-foreground">{floorHeight}m</span>
                                        </div>
                                        <Slider
                                            value={[floorHeight]}
                                            min={3.0}
                                            max={6.0}
                                            step={0.1}
                                            onValueChange={([v]) => setFloorHeight(v)}
                                            className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3.5 [&_span]:w-3.5"
                                        />
                                    </div>

                                    {/* Ground Floor Height */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-[10px] font-medium text-foreground/80">Ground Floor Ht</Label>
                                            <span className="text-[10px] text-muted-foreground">{groundFloorHeight}m</span>
                                        </div>
                                        <Slider
                                            value={[groundFloorHeight]}
                                            min={3.0}
                                            max={7.0}
                                            step={0.1}
                                            onValueChange={([v]) => setGroundFloorHeight(v)}
                                            className="[&_.relative]:h-1.5 [&_.absolute]:bg-amber-500/40 [&_span]:h-3.5 [&_span]:w-3.5"
                                        />
                                    </div>

                                    {/* Height-Based Setback Toggle */}
                                    <button
                                        className="flex items-center justify-between w-full group"
                                        onClick={handleToggleHeightSetback}
                                    >
                                        <div className="flex flex-col items-start gap-0.5">
                                            <Label className="text-[10px] font-medium text-foreground/80 cursor-pointer">
                                                Height-Based Setback
                                            </Label>
                                            {/* <span className="text-[9px] text-muted-foreground leading-tight">
                                                NBC / highrise table (overrides if larger)
                                            </span> */}
                                        </div>
                                        <div className={cn(
                                            'h-4 w-7 rounded-full transition-colors relative shrink-0',
                                            useHeightBasedSetback ? 'bg-primary' : 'bg-muted-foreground/30'
                                        )}>
                                            <div className={cn(
                                                'h-3 w-3 rounded-full bg-white absolute top-0.5 transition-transform',
                                                useHeightBasedSetback ? 'translate-x-3.5' : 'translate-x-0.5'
                                            )} />
                                        </div>
                                    </button>

                                      {/* Show computed height-setback when toggle is on */}
                                    {useHeightBasedSetback && (() => {
                                        const estH = floorRange[1] * floorHeight;
                                        const hSb = getHeightBasedSetback(estH);
                                        const band = HEIGHT_SETBACK_TABLE.find(r => estH <= r.maxHeightM);
                                        return (
                                            <div className="flex items-center justify-between rounded-md bg-primary/10 border border-primary/30 px-2.5 py-1.5 text-[10px]">
                                                <span className="text-muted-foreground">
                                                    Est. height: <span className="font-medium text-foreground">{estH.toFixed(1)}m</span>
                                                    {band && band.maxHeightM !== Infinity && (
                                                        <span className="ml-1">(≤{band.maxHeightM}m)</span>
                                                    )}
                                                    {band && band.maxHeightM === Infinity && (
                                                        <span className="ml-1">(55m+)</span>
                                                    )}
                                                </span>
                                                <span className="font-semibold text-primary">→ {hSb}m setback</span>
                                            </div>
                                        );
                                    })()}

                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="font-medium text-foreground/80">Setback</span>
                                            {selectedPlot?.regulation?.geometry?.setback?.value && (
                                                <span className={cn("text-muted-foreground", setback < selectedPlot.regulation.geometry.setback.value && "text-red-500 font-bold")}>
                                                    Min: {selectedPlot.regulation.geometry.setback.value}m
                                                </span>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                step="0.5"
                                                value={useHeightBasedSetback ? Math.max(setback, getHeightBasedSetback(floorRange[1] * floorHeight)) : setback}
                                                disabled={useHeightBasedSetback}
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    setSetback(val);
                                                    // Sync to store for immediate visualization (Orange Line) update
                                                    if (!isNaN(val) && selectedPlot) {
                                                        actions.updatePlot(selectedPlot.id, { setback: val });
                                                    }
                                                }}
                                                className={cn("h-8 text-xs bg-muted/20 border-border pr-8", useHeightBasedSetback && "opacity-60 cursor-not-allowed", selectedPlot?.regulation?.geometry?.setback?.value && setback < selectedPlot.regulation.geometry.setback.value && "border-red-500 text-red-500")}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">m</span>
                                        </div>

                                        {/* Variable Setback Overrides */}
                                        <div className="grid grid-cols-3 gap-2 pt-1">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] text-muted-foreground">Front</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={useHeightBasedSetback ? Math.max(frontSetback ?? 0, getHeightBasedSetback(floorRange[1] * floorHeight)) : (frontSetback ?? '')}
                                                    disabled={useHeightBasedSetback}
                                                    onChange={e => setFrontSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder={useHeightBasedSetback ? "Override" : "Auto"}
                                                    className={cn("h-7 text-[10px] bg-muted/20 border-border", useHeightBasedSetback && "opacity-60 cursor-not-allowed")}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] text-muted-foreground">Rear</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={useHeightBasedSetback ? Math.max(rearSetback ?? 0, getHeightBasedSetback(floorRange[1] * floorHeight)) : (rearSetback ?? '')}
                                                    disabled={useHeightBasedSetback}
                                                    onChange={e => setRearSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder={useHeightBasedSetback ? "Override" : "Auto"}
                                                    className={cn("h-7 text-[10px] bg-muted/20 border-border", useHeightBasedSetback && "opacity-60 cursor-not-allowed")}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] text-muted-foreground">Side</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={useHeightBasedSetback ? Math.max(sideSetback ?? 0, getHeightBasedSetback(floorRange[1] * floorHeight)) : (sideSetback ?? '')}
                                                    disabled={useHeightBasedSetback}
                                                    onChange={e => setSideSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder={useHeightBasedSetback ? "Override" : "Auto"}
                                                    className={cn("h-7 text-[10px] bg-muted/20 border-border", useHeightBasedSetback && "opacity-60 cursor-not-allowed")}
                                                />
                                            </div>
                                        </div>
                                    </div>


                                    {/* Use Floor Limit Toggle */}
                                    <button
                                        className="flex items-center justify-between w-full group"
                                        onClick={() => setUseFloorLimit(!useFloorLimit)}
                                    >
                                        <Label className="text-[10px] font-medium text-foreground/80 cursor-pointer">
                                            Use Floor Limit
                                        </Label>
                                        <div className={cn(
                                            'h-4 w-7 rounded-full transition-colors relative',
                                            useFloorLimit ? 'bg-primary' : 'bg-muted-foreground/30'
                                        )}>
                                            <div className={cn(
                                                'h-3 w-3 rounded-full bg-white absolute top-0.5 transition-transform',
                                                useFloorLimit ? 'translate-x-3.5' : 'translate-x-0.5'
                                            )} />
                                        </div>
                                    </button>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-[10px] font-medium text-foreground/80">
                                                Floors Range
                                            </Label>
                                            <span className={cn("text-[10px] text-muted-foreground", floorRange[1] > regulationMaxFloors && "text-red-500 font-bold")}>
                                                {floorRange[0]} - {floorRange[1]} floors (Reg: {regulationMaxFloors})
                                            </span>
                                        </div>
                                        <Slider
                                            value={floorRange}
                                            min={1}
                                            max={60}
                                            step={1}
                                            minStepsBetweenThumbs={1}
                                            onValueChange={setFloorRange}
                                            className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3.5 [&_span]:w-3.5"
                                        />
                                        {!useFloorLimit && (
                                            <>
                                                <p className="text-[10px] text-muted-foreground italic mt-1 leading-tight">
                                                    Floors will be assigned randomly within your selected range to hit target GFA. Infill footprints added only if needed.
                                                </p>
                                                {/* <div className="flex items-center gap-2 mt-2">
                                                    <Label className="text-[10px] font-medium text-foreground/80 whitespace-nowrap">Infill Setback</Label>
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        min={3}
                                                        max={50}
                                                        value={infillSetback}
                                                        onChange={e => setInfillSetback(Number(e.target.value) || 6)}
                                                        className="h-7 text-[10px] bg-muted/20 border-border w-16"
                                                    />
                                                    <span className="text-[9px] text-muted-foreground">m</span>
                                                </div> */}
                                                {/* Infill Mode selector — hidden for now, default is hybrid
                                                <div className="flex items-center gap-2 mt-2">
                                                    <Label className="text-[10px] font-medium text-foreground/80 whitespace-nowrap">Infill Mode</Label>
                                                    <select
                                                        value={infillMode}
                                                        onChange={e => setInfillMode(e.target.value as 'ring' | 'grid' | 'hybrid')}
                                                        className="h-7 text-[10px] bg-muted/20 border border-border rounded px-1 text-foreground"
                                                    >
                                                        <option value="hybrid">Hybrid (Ring + Grid)</option>
                                                        <option value="ring">Ring Only</option>
                                                        <option value="grid">Grid Only</option>
                                                    </select>
                                                </div>
                                                */}
                                            </>
                                        )}
                                    </div>
                                </div>

                            {/* Targets */}
                            <div className="space-y-3 pt-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Targets</Label>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="font-medium text-foreground/80">GFA</span>
                                            <span className="text-muted-foreground">m²</span>
                                        </div>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                value={targetGFA}
                                                onChange={(e) => setTargetGFA(Number(e.target.value))}
                                                className="h-8 text-xs bg-muted/20 border-border"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px]">
                                            <span className="font-medium text-foreground/80">FAR</span>
                                            <span className={cn("text-muted-foreground", targetFAR > regulationMaxFAR && "text-red-500 font-bold")}>Max: {regulationMaxFAR}</span>
                                        </div>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                step="0.1"
                                                value={targetFAR}
                                                onChange={(e) => setTargetFAR(Number(e.target.value))}
                                                className={cn("h-8 text-xs bg-muted/20 border-border", targetFAR > regulationMaxFAR && "border-red-500 text-red-500")}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 pb-4">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button onClick={handleGenerate} className="w-full h-9 shadow-sm">
                                            <Sparkles className="mr-2 h-3 w-3" />
                                            Generate / Refresh
                                        </Button>
                                    </TooltipTrigger>
                                     <TooltipContent>
                                         <p>Generate design scenarios based on current parameters</p>
                                     </TooltipContent>
                                 </Tooltip>
                            </div>
                        </div>
                    ) : (
                        <div className="flex h-full items-center justify-center p-4 text-center">
                            <div className="space-y-1.5 flex flex-col items-center">
                                <div className="h-10 w-10 rounded-full bg-muted/20 flex items-center justify-center">
                                    <MousePointerClick className="h-5 w-5 text-muted-foreground/40" />
                                </div>
                                <p className="text-xs text-muted-foreground max-w-[180px]">Select a plot to configure design parameters.</p>
                            </div>
                        </div>
                    )}
                </div>


            </Container >
        </TooltipProvider>
    );
}
