'use client';

import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useBuildingStore, useSelectedPlot, useProjectData } from '@/hooks/use-building-store';
import { Info, RotateCcw, Box, Layers, Maximize, Move, MousePointer, AlertTriangle, Sparkles, MousePointerClick } from "lucide-react";
import { useState, useEffect } from 'react';
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
type LandUseType = 'residential' | 'commercial' | 'mixed' | 'institutional';

export function ParametricToolbar({ embedded = false }: { embedded?: boolean }) {
    const { actions, plots, generationParams, designOptions, selectedObjectId } = useBuildingStore(state => ({
        actions: state.actions,
        plots: state.plots,
        generationParams: state.generationParams,
        designOptions: state.designOptions,
        selectedObjectId: state.selectedObjectId
    }));

    const [selectedTypologies, setSelectedTypologies] = useState<BuildingTypology[]>(['point']);
    const [selectedParking, setSelectedParking] = useState<ParkingTypology[]>(['ug', 'surface']);
    // ...
    // ... in return JSX ...
    const projectData = useProjectData();
    const isVastuEnabled = projectData?.vastuCompliant;

    const [targetGFA, setTargetGFA] = useState(0);
    const [targetFAR, setTargetFAR] = useState(3.0);
    const [floorRange, setFloorRange] = useState([5, 12]);
    const [heightRange, setHeightRange] = useState([16.8, 39.2]);
    const [footprintRange, setFootprintRange] = useState([400, 1000]);
    const [scrRange, setScrRange] = useState<[number, number]>([2.0, 4.0]);
    const [parkingRatio, setParkingRatio] = useState(0.30);
    const [buildingWidthRange, setBuildingWidthRange] = useState<[number, number]>([20, 25]); // Default: 20-25m
    const [buildingLengthRange, setBuildingLengthRange] = useState<[number, number]>([25, 55]); // Default: 25-55m
    const [gridOrientation, setGridOrientation] = useState(0);
    const [avgUnitSize, setAvgUnitSize] = useState(85);
    const [commercialPercent, setCommercialPercent] = useState(0);
    const [setback, setSetback] = useState(5); // Setback distance in meters
    const [frontSetback, setFrontSetback] = useState<number | undefined>(undefined);
    const [rearSetback, setRearSetback] = useState<number | undefined>(undefined);
    const [sideSetback, setSideSetback] = useState<number | undefined>(undefined);
    const [siteCoverage, setSiteCoverage] = useState(0.6); // 60% default utilization

    // Generation Mode: Parametric Only
    // const [generationMode, setGenerationMode] = useState<'ai' | 'algo'>('algo');

    // New Generative Params
    const [floorHeight, setFloorHeight] = useState(3.5);
    const [landUse, setLandUse] = useState<LandUseType>('residential');
    const [programMix, setProgramMix] = useState({
        residential: 100,
        commercial: 0,
        institutional: 0,
        hospitality: 0
    });

    const [unitMixConfig, setUnitMixConfig] = useState({
        '1BHK': 15,
        '2BHK': 40,
        '3BHK': 35,
        '4BHK': 10
    });

    const [allocationMode, setAllocationMode] = useState<'floor' | 'plot'>('floor'); // New Allocation Mode
    const [selectedUtilities, setSelectedUtilities] = useState<string[]>(['Roads', 'STP', 'WTP', 'Electrical', 'HVAC', 'Water']);

    // Constraints
    const [regulationMaxFloors, setRegulationMaxFloors] = useState(60);
    const [maxAllowedHeight, setMaxAllowedHeight] = useState(100);
    const [regulationMaxFAR, setRegulationMaxFAR] = useState(4.0);
    const [regulationMaxCoverage, setRegulationMaxCoverage] = useState(1.0);

    // Compliance Overrides (optional - will use regulation defaults if not set)
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
        else if (landUse === 'mixed') setProgramMix({ residential: 40, commercial: 40, institutional: 10, hospitality: 10 });
    }, [landUse]);

    // Derive the truly selected plot based on user selection
    const selectedPlot = selectedObjectId?.type === 'Plot'
        ? plots.find(p => p.id === selectedObjectId.id)
        : selectedObjectId
            ? plots.find(p => p.buildings.some(b => b.id === selectedObjectId.id) || p.greenAreas.some(g => g.id === selectedObjectId.id) || p.parkingAreas.some(pk => pk.id === selectedObjectId.id))
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

    // Sync setback with Selected Plot (Must be after selectedPlot is defined)
    useEffect(() => {
        if (selectedPlot?.setback) {
            setSetback(selectedPlot.setback);
        }
    }, [selectedPlot?.setback]);

    // Initialize setback from plot when plot first loads
    useEffect(() => {
        if (selectedPlot) {
            // Try to get setback from regulation first, then plot.setback, then default
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
    }, [selectedPlot?.id]); // Only run when plot changes

    // Apply regulations when plot changes
    useEffect(() => {
        if (selectedPlot?.regulation?.geometry) {
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
                    // Initialize floor range to compliant state
                    setFloorRange([Math.max(1, Math.min(5, mf)), mf]);
                    // Also update height range if floors are specified
                    setMaxAllowedHeight(mf * 3.5);
                }
            } else if (maxHeightValue) {
                const maxHeight = Number(maxHeightValue);
                if (!isNaN(maxHeight)) {
                    setMaxAllowedHeight(maxHeight);
                    // Clamp height range
                    setHeightRange(prev => [prev[0], Math.min(prev[1], maxHeight)]);

                    // Approximate floors (assuming ~3.5m regular floor)
                    const mf = Math.floor(maxHeight / 3.5);
                    setRegulationMaxFloors(mf);
                    // Initialize floor range to compliant state
                    setFloorRange([Math.max(1, Math.min(5, mf)), mf]);
                }
            }


            // Setback - Try multiple possible field names
            const setbackValue = geomRegs['setback']?.value
                || geomRegs['min_setback']?.value
                || geomRegs['front_setback']?.value
                || geomRegs['building_setback']?.value;

            // FAR - Try multiple possible field names
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
                    // Update targetFAR to regulation default
                    setTargetFAR(far);
                }
            }

            // Coverage - Try multiple possible field names
            const coverageValue = geomRegs['max_ground_coverage']?.value
                || geomRegs['ground_coverage']?.value
                || geomRegs['coverage']?.value;

            if (coverageValue !== undefined) {
                const cv = Number(coverageValue);
                if (!isNaN(cv) && cv > 0) {
                    // Convert % to decimal
                    const decimalCoverage = cv / 100;
                    setRegulationMaxCoverage(decimalCoverage);
                    // Cap siteCoverage if current value exceeds regulation
                    setSiteCoverage(prev => Math.min(prev, decimalCoverage));
                }
            }
        }
    }, [selectedPlot?.id, selectedPlot?.regulation]); // Re-run if plot or regulations change

    // Sync GFA when FAR or Plot Area changes
    useEffect(() => {
        if (selectedPlot?.area) {
            const gfa = Math.round(selectedPlot.area * targetFAR);
            setTargetGFA(gfa);
        }
    }, [targetFAR, selectedPlot?.area]);

    // Auto-detect land use from regulation type
    useEffect(() => {
        if (selectedPlot?.selectedRegulationType) {
            const regType = selectedPlot.selectedRegulationType.toLowerCase();

            // Check in order of specificity
            if (regType.includes('mixed')) {
                setLandUse('mixed');
            } else if (regType.includes('commercial') || regType.includes('shopping') || regType.includes('retail') || regType.includes('office')) {
                setLandUse('commercial');
            } else if (regType.includes('industrial') || regType.includes('warehouse') || regType.includes('storage') || regType.includes('manufacturing')) {
                setLandUse('commercial'); // Industrial uses commercial typology in the current system
            } else if (regType.includes('institutional') || regType.includes('public') || regType.includes('civic') || regType.includes('government')) {
                setLandUse('institutional');
            } else if (regType.includes('residential') || regType.includes('housing') || regType.includes('plotted')) {
                setLandUse('residential');
            }
            // If no match, keep current landUse
        }
    }, [selectedPlot?.selectedRegulationType]);

    const handleGenerate = () => {
        if (!selectedPlot) {
            return;
        }

        // Use the GFA from state (which is synced or manually edited)
        // Check if GFA matches FAR, if not, maybe user edited GFA? 
        // For now, assume state.targetGFA is the truth.

        // Store current parameters and trigger generation
        const params: any = {
            typologies: selectedTypologies,
            targetGFA: targetGFA, // Use state value
            targetFAR,
            minFloors: floorRange[0],
            maxFloors: floorRange[1], // This will be used as compliance maxFloors
            minHeight: heightRange[0],
            maxHeight: heightRange[1],
            parkingType: selectedParking[0], // Legacy support
            parkingTypes: selectedParking,
            parkingRatio,
            // minFootprint: minFootprintOverride,
            // maxFootprint: maxFootprintOverride,
            minSCR: scrRange[0],
            maxSCR: scrRange[1],
            gridOrientation,
            avgUnitSize,
            commercialPercent,
            // New Params
            minBuildingWidth: buildingWidthRange[0],
            maxBuildingWidth: buildingWidthRange[1],
            minBuildingLength: buildingLengthRange[0],
            maxBuildingLength: buildingLengthRange[1],
            width: buildingWidthRange[1], // Fallback for legacy generators using 'width'
            minLength: buildingLengthRange[0], // Fallback
            floorHeight,
            landUse,
            programMix, // Single instance
            allocationMode, // Pass allocation mode
            selectedUtilities,
            setback,
            frontSetback,
            rearSetback,
            sideSetback,
            maxAllowedFAR: targetFAR,
            siteCoverage,
            seedOffset,
            vastuCompliant: projectData?.vastuCompliant || false,
            hasPodium,
            podiumFloors,
            upperFloorReduction,
            unitMix: [
                { name: '1BHK', mixRatio: unitMixConfig['1BHK'] / 100, area: 60 },
                { name: '2BHK', mixRatio: unitMixConfig['2BHK'] / 100, area: 140 },
                { name: '3BHK', mixRatio: unitMixConfig['3BHK'] / 100, area: 185 },
                { name: '4BHK', mixRatio: unitMixConfig['4BHK'] / 100, area: 250 }
            ].filter(u => u.mixRatio > 0)
        };

        // Increment seed offset for NEXT generation (Simulation of "Refresh")
        // But we want THIS generation to use the NEW offset?
        // Or do we use the CURRENT offset and increment for NEXT?
        // Let's use current, but trigger update for next.
        // Actually, if we just set state, it won't update 'params' immediately in this closure.

        // Calculate new offset here, use it, then set state.
        const newOffset = seedOffset + 3;
        setSeedOffset(newOffset);
        params.seedOffset = newOffset;

        console.log('[ParametricToolbar] Generating with params:', {
            setback,
            sideSetback,
            paramsSideSetback: params.sideSetback
        });

        // Trigger scenario generation (this will open the modal)
        actions.generateScenarios(selectedPlot.id, params);
    };

    const Container = embedded ? 'div' : Card;

    return (
        <TooltipProvider>
            <Container className={cn("flex flex-col font-sans h-full", embedded ? "" : "w-full shadow-xl bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 max-h-[calc(100vh-200px)]")}>
                {!embedded && (
                    <CardHeader className="py-2 px-3 flex-shrink-0 border-b">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Generate Design
                        </CardTitle>
                    </CardHeader>
                )}

                <div className={cn("flex-1 overflow-y-auto overflow-x-hidden min-h-0", embedded ? "p-3 scrollbar-thin" : "p-3 space-y-4 scrollbar-thin")}>
                    {selectedPlot ? (
                        <div className="space-y-4">
                            {/* Generation Mode: Parametric Only */}


                            {/* --- SECTION: Design Strategy --- */}
                            <div className="flex items-center gap-2 pt-2 pb-1">
                                <div className="h-px flex-1 bg-border/50"></div>
                                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Design Strategy</span>
                                <div className="h-px flex-1 bg-border/50"></div>
                            </div>
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

                                                            // Smart Defaults for Dimensions
                                                            // If switching TO a specific single typology, adjust defaults
                                                            if (next.length === 1) {
                                                                const t = next[0];
                                                                if (t === 'point') {
                                                                    setBuildingWidthRange([20, 25]); // Range within limits
                                                                    setBuildingLengthRange([25, 30]); // Squarish, above min length
                                                                } else if (t === 'slab') {
                                                                    setBuildingWidthRange([20, 22]); // Narrowest allowed (20m)
                                                                    setBuildingLengthRange([40, 55]); // Long
                                                                } else if (['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(t)) {
                                                                    setBuildingWidthRange([20, 25]); // Wing depth
                                                                    setBuildingLengthRange([40, 55]); // Overall extent
                                                                }
                                                            } else {
                                                                // Mixed or multiple? Revert to generic "User Request" defaults
                                                                // Or just leave as is.
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
                                                    <span className="text-[9px] font-medium capitalize truncate w-full text-center">{type === 'lshaped' ? 'L-Shape' : type === 'ushaped' ? 'U-Shape' : type === 'oshaped' ? 'O-Shape' : type}</span>
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                <p>{type === 'lshaped' ? 'L-Shaped Building' : type === 'ushaped' ? 'U-Shaped Building' : type === 'point' ? 'Point Block' : type === 'slab' ? 'Linear Slab' : `${type.charAt(0).toUpperCase() + type.slice(1)} Shape`}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    ))}
                                </div>
                            </div>

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

                            {/* Unit Mix Allocation (Residential / Mixed Only) */}
                            {(landUse === 'residential' || landUse === 'mixed') && (
                                <div className="p-3 bg-muted/20 border rounded-lg space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Unit Mix Allocation</Label>
                                        <Badge
                                            variant="outline"
                                            className={cn("text-[9px] h-4",
                                                (unitMixConfig['1BHK'] + unitMixConfig['2BHK'] + unitMixConfig['3BHK'] + unitMixConfig['4BHK']) !== 100
                                                    ? "text-red-500 border-red-200"
                                                    : "text-green-600 border-green-200"
                                            )}
                                        >
                                            Total: {unitMixConfig['1BHK'] + unitMixConfig['2BHK'] + unitMixConfig['3BHK'] + unitMixConfig['4BHK']}%
                                        </Badge>
                                    </div>

                                    <div className="space-y-3 pl-1">
                                        {Object.entries(unitMixConfig).map(([type, value]) => (
                                            <div key={type} className="space-y-1">
                                                <div className="flex justify-between text-[10px]">
                                                    <span className="text-muted-foreground">{type}</span>
                                                    <span>{value}%</span>
                                                </div>
                                                <Slider
                                                    value={[value]}
                                                    max={100}
                                                    step={5}
                                                    onValueChange={([val]) => setUnitMixConfig(prev => ({ ...prev, [type]: val }))}
                                                    className={cn(
                                                        "[&_.relative]:h-1.5 [&_span]:h-3 [&_span]:w-3",
                                                        type === '1BHK' && "[&_.absolute]:bg-[#80BC65]",
                                                        type === '2BHK' && "[&_.absolute]:bg-[#1E90FF]",
                                                        type === '3BHK' && "[&_.absolute]:bg-[#DA70D6]",
                                                        type === '4BHK' && "[&_.absolute]:bg-[#FFD700]"
                                                    )}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Podium / Stepped Massing Controls (Residential) */}
                            {landUse === 'residential' && (
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
                                            <p className="text-[9px] text-muted-foreground italic">
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
                                                                    // If previously 'none', start fresh with this type
                                                                    if (prev.includes('none')) return [type];
                                                                    // Toggle off
                                                                    if (prev.includes(type)) {
                                                                        const next = prev.filter(t => t !== type);
                                                                        return next.length ? next : ['none'];
                                                                    }
                                                                    // Toggle on
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
                                                            <span className="text-[9px] font-medium capitalize">{type === 'ug' ? 'Bsmt' : type === 'surface' ? 'Ground' : 'None'}</span>
                                                        </div>
                                                    </button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">
                                                    <p>{type === 'ug' ? 'Underground Parking' : type === 'surface' ? 'Surface/Ground Parking' : 'No Parking Provided'}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        ))}
                                    </div>
                                    <div className="space-y-1">
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
                                    </div>
                                </div>
                            </div>

                            {/* Site Coverage Configuration */}
                            <div className="space-y-1.5 pt-2">
                                <div className="flex justify-between text-[10px]">
                                    <span className="font-bold uppercase text-muted-foreground tracking-wider">Site Utilization</span>
                                    <span>{(siteCoverage * 100).toFixed(0)}%</span>
                                </div>
                                <Slider
                                    value={[siteCoverage]}
                                    min={0.1}
                                    max={regulationMaxCoverage}
                                    step={0.05}
                                    onValueChange={([v]) => setSiteCoverage(v)}
                                    className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                />
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
                                            const ALL = ['Roads', 'Water', 'Rainwater Harvesting', 'Electrical', 'HVAC', 'DG Set', 'Gas', 'Fire', 'STP', 'Solid Waste', 'WTP', 'Admin'];
                                            if (selectedUtilities.length === ALL.length) setSelectedUtilities([]);
                                            else setSelectedUtilities(ALL);
                                        }}
                                    >
                                        {selectedUtilities.length === 12 ? 'Select None' : 'Select All'}
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {['Roads', 'Water', 'Rainwater Harvesting', 'Electrical', 'HVAC', 'DG Set', 'Gas', 'Fire', 'STP', 'Solid Waste', 'WTP', 'Admin'].map(type => (
                                        <Tooltip key={type}>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => {
                                                        setSelectedUtilities(prev =>
                                                            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                                                        )
                                                    }}
                                                    className={cn(
                                                        'text-[9px] px-1 py-1.5 rounded-md border transition-all truncate',
                                                        selectedUtilities.includes(type)
                                                            ? 'bg-primary/10 border-primary/50 text-foreground font-medium'
                                                            : 'bg-muted/10 border-border text-muted-foreground hover:bg-muted/30'
                                                    )}
                                                >
                                                    {type === 'Rainwater Harvesting' ? 'RWH' : type === 'Solid Waste' ? 'Waste/OWC' : type === 'DG Set' ? 'DG Set' : type}
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
                            {/* Building Dimensions */}
                            <div className="space-y-3 pt-2">
                                <Label className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Building Dimensions</Label>

                                {
                                    /* Warning Removed as per user request */
                                }

                                {/* Width Range */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-muted-foreground">Building Width</span>
                                        <span className={cn(buildingWidthRange[0] < 20 || buildingWidthRange[1] > 25 ? "text-destructive font-bold" : "")}>{buildingWidthRange[0]}m - {buildingWidthRange[1]}m</span>
                                    </div>
                                    <Slider
                                        value={buildingWidthRange}
                                        min={20}
                                        max={25}
                                        step={0.5}
                                        minStepsBetweenThumbs={1}
                                        onValueChange={(val) => setBuildingWidthRange(val as [number, number])}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                    />
                                </div>

                                {/* Length Range */}
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px]">
                                        <span className="text-muted-foreground">Building Length</span>
                                        <span className={cn(buildingLengthRange[0] < 25 || buildingLengthRange[1] > 55 ? "text-destructive font-bold" : "")}>{buildingLengthRange[0]}m - {buildingLengthRange[1]}m</span>
                                    </div>
                                    <Slider
                                        value={buildingLengthRange}
                                        min={25}
                                        max={55}
                                        step={1}
                                        minStepsBetweenThumbs={5}
                                        onValueChange={(val) => setBuildingLengthRange(val as [number, number])}
                                        className="[&_.relative]:h-1.5 [&_.absolute]:bg-primary/20 [&_span]:h-3 [&_span]:w-3"
                                    />
                                </div>
                            </div>

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
                                                value={setback}
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    setSetback(val);
                                                    // Sync to store for immediate visualization (Orange Line) update
                                                    if (!isNaN(val) && selectedPlot) {
                                                        actions.updatePlot(selectedPlot.id, { setback: val });
                                                    }
                                                }}
                                                className={cn("h-8 text-xs bg-muted/20 border-border pr-8", selectedPlot?.regulation?.geometry?.setback?.value && setback < selectedPlot.regulation.geometry.setback.value && "border-red-500 text-red-500")}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">m</span>
                                        </div>

                                        {/* Variable Setback Overrides */}
                                        <div className="grid grid-cols-3 gap-2 pt-1">
                                            <div className="space-y-1">
                                                <Label className="text-[9px] text-muted-foreground">Front</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={frontSetback ?? ''}
                                                    onChange={e => setFrontSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder="Auto"
                                                    className="h-7 text-[10px] bg-muted/20 border-border"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[9px] text-muted-foreground">Rear</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={rearSetback ?? ''}
                                                    onChange={e => setRearSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder="Auto"
                                                    className="h-7 text-[10px] bg-muted/20 border-border"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[9px] text-muted-foreground">Side</Label>
                                                <Input
                                                    type="number"
                                                    step="0.5"
                                                    value={sideSetback ?? ''}
                                                    onChange={e => setSideSetback(e.target.value ? Number(e.target.value) : undefined)}
                                                    placeholder="Auto"
                                                    className="h-7 text-[10px] bg-muted/20 border-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-[10px] font-medium text-foreground/80">Floors</Label>
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
                            <div className="space-y-2 flex flex-col items-center">
                                <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                                    <MousePointerClick className="h-6 w-6 text-muted-foreground/50" />
                                </div>
                                <p className="text-sm text-muted-foreground max-w-[180px]">Select a plot on the map to view and generate design scenarios.</p>
                            </div>
                        </div>
                    )}
                </div>


            </Container >
        </TooltipProvider>
    );
}
