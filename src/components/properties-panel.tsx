'use client';
import React from 'react';
import { useBuildingStore, useSelectedBuilding, useSelectedPlot } from '@/hooks/use-building-store';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import * as turf from '@turf/turf';
import { BuildingIntendedUse, type Floor, type Plot, type BuildableArea, FeasibilityParams, UnitTypology, type UtilityArea, UtilityType, ParkingType } from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { calculateTotalParkingSpaces } from '@/lib/parking-calc';
import { produce } from 'immer';
import { Button } from './ui/button';
import { Plus, Trash2, X, Info, WandSparkles, Loader2, PieChart, BarChart3, Calculator, PenTool, Zap, AlertTriangle, Fan, Car, Layers, ArrowDownToLine, Box, Grid2x2, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useProjectData } from '@/hooks/use-building-store';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';


function BuildingProperties() {
    const { actions, componentVisibility } = useBuildingStore(s => ({ actions: s.actions, componentVisibility: s.componentVisibility }));
    const selectedBuilding = useSelectedBuilding();
    const selectedPlot = useSelectedPlot();
    const [showInternals, setShowInternals] = React.useState(true);
    const projectData = useProjectData();

    if (!selectedBuilding || !selectedPlot) return null;

    const regulation = selectedPlot.regulation;

    const handleFloorCountChange = (newCount: number | '') => {
        actions.updateBuilding(selectedBuilding.id, { numFloors: newCount === '' ? 1 : newCount });
    };

    const handleTypicalFloorHeightChange = (newHeight: number | '') => {
        actions.updateBuilding(selectedBuilding.id, { typicalFloorHeight: newHeight === '' ? 3 : newHeight });
    };

    const totalGFA = (projectData?.totalBuildableArea ?? 0);
    const consumedGFA = (projectData?.consumedBuildableArea ?? 0);
    const parkingFloorsCount = selectedBuilding.floors.filter(f => f.type === 'Parking').length;
    // Occupiable floor count = numFloors if set (should exclude parking), or derive from floors array
    const occupiableFloorCount = selectedBuilding.numFloors ?? (selectedBuilding.floors.length - parkingFloorsCount);
    const effectiveFloors = Math.max(0, occupiableFloorCount);
    const currentBuildingGFA = selectedBuilding.area * effectiveFloors;
    const newBuildingGFA = currentBuildingGFA;
    const remainingGFA = totalGFA - (consumedGFA - currentBuildingGFA);
    const isOverLimit = newBuildingGFA > remainingGFA;



    return (
        <div className='space-y-4'>
            <div className='p-3 bg-secondary rounded-md space-y-2 text-sm'>
                <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Footprint Area:</span>
                    <span className='font-mono'>{selectedBuilding.area.toFixed(2)} m²</span>
                </div>
                <div className={cn('flex justify-between', isOverLimit ? 'text-destructive' : 'text-muted-foreground')}>
                    <span className=''>Gross Floor Area (GFA):</span>
                    <span className='font-mono'>{newBuildingGFA.toFixed(2)} m²</span>
                </div>
                <div className='flex justify-between text-xs'>
                    <span className='text-muted-foreground'>Remaining Project GFA:</span>
                    <span className='font-mono'>{(remainingGFA - newBuildingGFA).toFixed(2)} m²</span>
                </div>
                {isOverLimit && (
                    <div className="flex items-center gap-2 text-xs text-destructive pt-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Exceeds project's remaining GFA.</span>
                    </div>
                )}
            </div>

            <div>
                <Label htmlFor="name" className="text-sm font-medium text-muted-foreground">Building Name</Label>
                <Input id="name" value={selectedBuilding.name} onChange={(e) => actions.updateBuilding(selectedBuilding.id, { name: e.target.value })} />
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="num-floors" className="text-sm font-medium text-muted-foreground">Number of Floors</Label>
                        <Input
                            id="num-floors"
                            type="number"
                            value={occupiableFloorCount ?? ''}
                            onChange={(e) => handleFloorCountChange(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            min="1"
                        />
                    </div>
                    <div>
                        <Label htmlFor="floor-height" className="text-sm font-medium text-muted-foreground">Floor Height (m)</Label>
                        <Input
                            id="floor-height"
                            type="number"
                            value={selectedBuilding.typicalFloorHeight ?? ''}
                            onChange={(e) => handleTypicalFloorHeightChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
                            step="0.5"
                            min="1"
                        />
                    </div>
                </div>
                <div className="flex gap-2">
                    {!selectedBuilding.id.endsWith('-tower') && (
                        <Button variant="outline" size="sm" onClick={() => actions.addParkingFloor(selectedBuilding.id, ParkingType.Basement)} className="flex-1">
                            <ArrowDownToLine className="h-4 w-4 mr-2" /> Add Basement
                        </Button>
                    )}
                </div>
            </div>
            <p className='text-xs text-muted-foreground text-center'>
                Total Height: <span className='font-bold text-foreground'>{selectedBuilding.height.toFixed(2)}m</span>
            </p>

            <div>
                <Label htmlFor="opacity" className="text-sm font-medium text-muted-foreground">Opacity ({Math.round(selectedBuilding.opacity * 100)}%)</Label>
                <Slider
                    id="opacity"
                    min={0}
                    max={1}
                    step={0.1}
                    value={[selectedBuilding.opacity]}
                    onValueChange={(v) => actions.updateBuilding(selectedBuilding.id, { opacity: v[0] })}
                />
            </div>

            {/* <div>
                <Label htmlFor="intendedUse" className="text-sm font-medium text-muted-foreground">Intended Use</Label>
                <Select
                    value={selectedBuilding.intendedUse}
                    onValueChange={(v) => actions.updateBuilding(selectedBuilding.id, { intendedUse: v as BuildingIntendedUse })}
                >
                    <SelectTrigger id="intendedUse">
                        <SelectValue placeholder="Select use..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Residential">Residential</SelectItem>
                        <SelectItem value="Commercial">Commercial</SelectItem>
                        <SelectItem value="Mixed-Use">Mixed-Use</SelectItem>
                        <SelectItem value="Industrial">Industrial</SelectItem>
                        <SelectItem value="Public">Public</SelectItem>
                    </SelectContent>
                </Select>
            </div> */}

            {/* ─── Building Internals: Cores / Utilities / Units ─── */}
            {((selectedBuilding.cores && selectedBuilding.cores.length > 0) ||
              (selectedBuilding.internalUtilities && selectedBuilding.internalUtilities.length > 0) ||
              (selectedBuilding.units && selectedBuilding.units.length > 0)) && (() => {
                // Calculate if internals are effectively ON:
                const anyGlobalVisible = componentVisibility.units || componentVisibility.cores || componentVisibility.electrical || componentVisibility.hvac;
                const internalsOn = selectedBuilding.internalsVisible === true || (selectedBuilding.internalsVisible === undefined && anyGlobalVisible);
                
                const toggleInternals = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    actions.updateBuilding(selectedBuilding.id, { internalsVisible: !internalsOn });
                };

                // --- Build sorted floor stack ---
                const basementFloors = selectedBuilding.floors
                    .filter(f => f.type === 'Parking' || (f.level !== undefined && f.level < 0))
                    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)); // B2 before B1

                const regularFloors = selectedBuilding.floors
                    .filter(f => f.type !== 'Parking' && f.type !== 'Utility' && (f.level === undefined || f.level >= 0));

                // Build unit map: floorId -> unit[]
                const unitsByFloor: Record<string, typeof selectedBuilding.units> = {};
                (selectedBuilding.units || []).forEach(u => {
                    const fid = u.floorId || 'unassigned';
                    if (!unitsByFloor[fid]) unitsByFloor[fid] = [];
                    unitsByFloor[fid]!.push(u);
                });

                // Count units only on regular (non-parking) floors
                const totalOccupiableUnits = regularFloors.reduce((sum, f) => sum + (unitsByFloor[f.id]?.length || 0), 0);
                
                // Calculate average area for each unit type to display
                const unitTypeAreas: Record<string, number[]> = {};
                (selectedBuilding.units || []).forEach(u => {
                    if (!unitTypeAreas[u.type]) unitTypeAreas[u.type] = [];
                    unitTypeAreas[u.type].push(turf.area(u.geometry));
                });
                
                const uniqueUnitTypes = Object.keys(unitTypeAreas);
                const unitTypeStrings = uniqueUnitTypes.map(type => {
                    const areas = unitTypeAreas[type];
                    const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
                    return `${type} (~${Math.round(avgArea)}m²)`;
                });

                return (
                    <div className="border rounded-md overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center bg-secondary/50 text-sm font-medium hover:bg-secondary transition-colors">
                            <button
                                className="flex-1 flex items-center gap-2 px-3 py-2 text-left"
                                onClick={() => setShowInternals(v => !v)}
                            >
                                <span>Building Internals</span>
                                {showInternals ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                            <button
                                className={cn("px-3 py-2 transition-colors rounded-r-md", internalsOn ? 'text-primary hover:text-primary/80' : 'text-muted-foreground hover:text-foreground')}
                                onClick={toggleInternals}
                                title={internalsOn ? 'Hide internals for this building' : 'Show internals for this building'}
                            >
                                {internalsOn ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </button>
                        </div>

                        {showInternals && (
                            <div className="p-3 space-y-3 text-xs">

                                {/* Cores */}
                                {selectedBuilding.cores && selectedBuilding.cores.length > 0 && (
                                    <div className="flex items-center gap-2 px-1 py-0.5 text-muted-foreground">
                                        <Box className="h-3 w-3 shrink-0" style={{ color: '#9370DB' }} />
                                        <span className="flex-1 font-medium text-foreground">
                                            Core ({selectedBuilding.cores.length})
                                        </span>
                                        <span className="text-muted-foreground font-mono">
                                            {selectedBuilding.cores.reduce((s, c) => s + turf.area(c.geometry), 0).toFixed(1)} m²
                                        </span>
                                    </div>
                                )}

                                {/* Internal Utilities */}
                                {selectedBuilding.internalUtilities && selectedBuilding.internalUtilities.length > 0 && (
                                    <div className="space-y-1">
                                        {selectedBuilding.internalUtilities.map(util => {
                                            const isElec = util.type === 'Electrical';
                                            const utilArea = turf.area(util.geometry);
                                            return (
                                                <div key={util.id} className="flex items-center gap-2 px-1 py-0.5 text-muted-foreground">
                                                    {isElec ? <Zap className="h-3 w-3 text-amber-400 shrink-0" /> : <Fan className="h-3 w-3 text-blue-400 shrink-0" />}
                                                    <span className="flex-1">{util.name}</span>
                                                    <span className="font-mono">{utilArea.toFixed(1)} m²</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* ─── Floor Stack ─── */}
                                <div className="space-y-1 border-t pt-2">
                                    <div className="flex items-center gap-2 px-1 py-0.5">
                                        <Layers className="h-3 w-3 text-violet-400 shrink-0" />
                                        <span className="font-medium text-foreground">
                                            Floor Stack ({regularFloors.length} floors{basementFloors.length > 0 ? ` + ${basementFloors.length} basement${basementFloors.length > 1 ? 's' : ''}` : ''})
                                        </span>
                                    </div>

                                    {/* Basements */}
                                    {basementFloors.map((floor, i) => (
                                        <div key={floor.id} className="flex items-center gap-1.5 pl-5 py-0.5 text-muted-foreground">
                                            <Car className="h-3 w-3 text-gray-400 shrink-0" />
                                            <span className="text-gray-400 font-medium">
                                                Basement {basementFloors.length - i}
                                            </span>
                                            <span className="text-muted-foreground/60 text-[10px]">
                                                (Parking · {floor.parkingCapacity ?? '?'} cars)
                                            </span>
                                        </div>
                                    ))}

                                    {/* Regular floors with units */}
                                    {regularFloors.map((floor, i) => {
                                        const floorUnits = unitsByFloor[floor.id] || [];
                                        const floorUnitTypes = [...new Set(floorUnits.map(u => u.type))];
                                        const floorLabel = floor.level !== undefined ? `Floor ${floor.level + 1}` : `Floor ${i + 1}`;
                                        return (
                                            <div key={floor.id} className="flex items-center gap-1.5 pl-5 py-0.5 text-muted-foreground">
                                                <Layers className="h-3 w-3 text-blue-300 shrink-0" />
                                                <span className="text-blue-300 font-medium">{floorLabel}</span>
                                                {floorUnits.length > 0 && (
                                                    <>
                                                        <span>— {floorUnits.length} unit{floorUnits.length !== 1 ? 's' : ''}</span>
                                                        <span className="text-muted-foreground/60 text-[10px]">({floorUnitTypes.join(', ')})</span>
                                                    </>
                                                )}
                                                {floor.intendedUse && floor.intendedUse !== selectedBuilding.intendedUse && (
                                                    <span className="text-muted-foreground/60 text-[10px] ml-auto">{floor.intendedUse}</span>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* Total units summary */}
                                    {totalOccupiableUnits > 0 && (
                                        <div className="flex items-center gap-2 px-1 pt-1 border-t">
                                            <Grid2x2 className="h-3 w-3 text-blue-400 shrink-0" />
                                            <span className="font-medium text-foreground">
                                                Total Units: {totalOccupiableUnits}
                                            </span>
                                        </div>
                                    )}
                                    {/* {totalOccupiableUnits > 0 && (
                                        <div className="pl-5 text-muted-foreground/80 text-[10px] space-y-0.5">
                                            {unitTypeStrings.map((str, idx) => (
                                                <div key={idx} className="flex items-center gap-1.5">
                                                   <div className="w-1.5 h-1.5 rounded-full bg-blue-400/50" />
                                                   {str}
                                                </div>
                                            ))}
                                        </div>
                                    )} */}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

        </div>
    )
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

function FeasibilitySection({ stats, parkingCount }: { stats: any, parkingCount: number }) {
    if (!stats) return null;

    return (
        <div className="space-y-4 border rounded-md p-3 bg-card">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Feasibility Report
            </h4>

            <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 bg-secondary rounded flex flex-col">
                    <span className="text-muted-foreground text-xs">Total Units</span>
                    <span className="font-bold text-lg">{stats.units.total}</span>
                </div>
                <div className="p-2 bg-secondary rounded flex flex-col">
                    <span className="text-muted-foreground text-xs">Total Parking</span>
                    <span className="font-bold text-lg">{parkingCount}</span>
                </div>
                <div className="p-2 bg-secondary rounded flex flex-col col-span-2">
                    <span className="text-muted-foreground text-xs">Efficiency</span>
                    <span className="font-bold text-lg">{(stats.efficiency * 100).toFixed(0)}%</span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Area Breakdown (sqm)</div>
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                        <span>Saleable</span>
                        <span className="font-mono">{stats.areas.saleable}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Core</span>
                        <span className="font-mono">{stats.areas.core}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Circulation</span>
                        <span className="font-mono">{stats.areas.circulation}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                        <span>Total Built-up</span>
                        <span className="font-mono">{stats.totalBuiltUpArea}</span>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Unit Mix Yield</div>
                <div className="grid grid-cols-2 gap-2">
                    {Object.entries(stats.units.breakdown).map(([type, count]: [string, any]) => (
                        <div key={type} className="flex justify-between items-center text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                            <span>{type}</span>
                            <span className="font-bold">{count}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className='text-[10px] text-muted-foreground text-center pt-2 border-t mt-2'>
                Based on current Plot Area & FAR {stats.achievedFAR}
            </div>
        </div>
    );
}

function UnitMixConfig({ params, onChange }: { params: FeasibilityParams, onChange: (p: FeasibilityParams) => void }) {

    const updateFactor = (key: keyof FeasibilityParams, value: number) => {
        onChange({ ...params, [key]: value });
    };

    const updateUnitMix = (index: number, field: keyof UnitTypology, value: any) => {
        const newMix = produce(params.unitMix, draft => {
            if (field === 'mixRatio') {
                // Determine other items to balance? For now, just set it. 
                // Advanced: Auto-balance other ratios.
                // Simple: Allow user to set, normalize later or assume they sum to 1.
                draft[index].mixRatio = value;
            } else if (field === 'area') {
                draft[index].area = value;
            }
        });
        onChange({ ...params, unitMix: newMix });
    };

    return (
        <div className="space-y-4 pt-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
                <PenTool className="h-4 w-4" /> Configuration
            </h4>

            <div className="space-y-3">
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <Label>Core Area Factor</Label>
                        <span className="text-muted-foreground">{(params.coreFactor * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                        min={0.05} max={0.40} step={0.01}
                        value={[params.coreFactor]}
                        onValueChange={([v]) => updateFactor('coreFactor', v)}
                    />
                </div>
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <Label>Circulation Factor</Label>
                        <span className="text-muted-foreground">{(params.circulationFactor * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                        min={0.05} max={0.30} step={0.01}
                        value={[params.circulationFactor]}
                        onValueChange={([v]) => updateFactor('circulationFactor', v)}
                    />
                </div>
            </div>

            <Separator />

            <div className="space-y-2">
                <Label className="text-xs">Unit Typologies Mix</Label>
                {params.unitMix.map((unit, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                        <div className="w-12 text-xs font-bold">{unit.name}</div>
                        <Input
                            type="number"
                            className="h-7 w-16 text-xs p-1"
                            value={unit.area}
                            onChange={(e) => updateUnitMix(idx, 'area', parseFloat(e.target.value))}
                        />
                        <span className="text-[10px] text-muted-foreground">sqm</span>
                        <div className='flex-1'>
                            <Slider
                                min={0} max={1} step={0.1}
                                value={[unit.mixRatio]}
                                onValueChange={([v]) => updateUnitMix(idx, 'mixRatio', v)}
                            />
                        </div>
                        <span className="text-xs w-8 text-right">{(unit.mixRatio * 100).toFixed(0)}%</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function PlotProperties() {
    const { actions, activeProjectId, projects } = useBuildingStore();
    const selectedPlot = useSelectedPlot();

    const activeProject = projects.find(p => p.id === activeProjectId);

    // Memoize params to avoid recalculation loops, defaulting to constants
    const feasibilityParams = React.useMemo(() => {
        return activeProject?.feasibilityParams || DEFAULT_FEASIBILITY_PARAMS;
    }, [activeProject?.feasibilityParams]);

    const stats = React.useMemo(() => {
        if (!selectedPlot) return null;
        return calculateDevelopmentStats(selectedPlot, feasibilityParams);
    }, [selectedPlot, feasibilityParams]);

    const parkingCount = React.useMemo(() => {
        if (!selectedPlot) return 0;
        return calculateTotalParkingSpaces([selectedPlot]).total;
    }, [selectedPlot]);


    if (!selectedPlot) return null;

    const regulation = selectedPlot.regulation;
    const setbackRules = regulation?.geometry?.setback;

    const handleParamsChange = (newParams: FeasibilityParams) => {
        if (activeProjectId) {
            actions.updateProject(activeProjectId, { feasibilityParams: newParams });
        }
    };

    return (
        <div className='space-y-6 pb-6'>
            <div className='space-y-4'>
                <div>
                    <Label htmlFor="plot-name" className="text-sm font-medium text-muted-foreground">Plot Name</Label>
                    <Input id="plot-name" value={selectedPlot.name} onChange={(e) => actions.updatePlot(selectedPlot.id, { name: e.target.value })} />
                </div>
                {selectedPlot.location && (
                    <div className='p-3 bg-secondary rounded-md text-sm text-center'>
                        <span className='text-muted-foreground'>Location: </span>
                        <span className='font-semibold'>{selectedPlot.location}</span>
                        {!regulation && (
                            <p className='text-xs text-amber-500 flex items-center justify-center gap-1 mt-1'>
                                <Info className='h-3 w-3' /> No local regulations found. Using defaults.
                            </p>
                        )}
                    </div>
                )}
                <div>
                    <Label htmlFor="plot-setback" className="text-sm font-medium text-muted-foreground">Setback ({selectedPlot.setback}m)</Label>
                    <Slider
                        id="plot-setback"
                        min={setbackRules?.min ?? 0}
                        max={setbackRules?.max ?? 50}
                        step={1}
                        value={[selectedPlot.setback]}
                        onValueChange={(v) => actions.updatePlot(selectedPlot.id, { setback: v[0] })}
                    />
                </div>
            </div>

            <Separator />

            {/* UnitMixConfig moved? User requested hiding configuration */}
            {/* <UnitMixConfig params={feasibilityParams} onChange={handleParamsChange} /> */}

        </div>
    )
}

function ZoneProperties() {
    const { actions, selectedObjectId, plots } = useBuildingStore(s => ({
        actions: s.actions,
        selectedObjectId: s.selectedObjectId,
        plots: s.plots
    }));

    if (!selectedObjectId) return null;

    let object: BuildableArea | UtilityArea | undefined;
    let objectName = '';

    // Helper to find object
    const findObj = () => {
        for (const plot of plots) {
            const found = [
                ...plot.greenAreas,
                ...plot.parkingAreas,
                ...plot.buildableAreas,
                ...plot.utilityAreas
            ].find(obj => obj.id === selectedObjectId.id);
            if (found) return found;
        }
        return null;
    }

    const foundObject = findObj();
    if (foundObject) {
        object = foundObject as any; // Cast for simplified access
        objectName = foundObject.name;
    }

    if (!object) return null;

    const handleNameChange = (newName: string) => {
        actions.updateObject(selectedObjectId.id, selectedObjectId.type, { name: newName });
    }

    return (
        <div className="space-y-4 pt-4">
            <div>
                <Label htmlFor="zone-name" className="text-sm font-medium text-muted-foreground">Zone Name</Label>
                <Input id="zone-name" value={objectName} onChange={(e) => handleNameChange(e.target.value)} />
            </div>

            {selectedObjectId.type === 'UtilityArea' && (
                <div>
                    <Label htmlFor="utility-type" className="text-sm font-medium text-muted-foreground">Utility Type</Label>
                    <Select
                        value={(object as UtilityArea).type}
                        onValueChange={(v) => actions.updateObject(selectedObjectId.id, 'UtilityArea', { type: v as UtilityType })}
                    >
                        <SelectTrigger id="utility-type">
                            <SelectValue placeholder="Select type..." />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.values(UtilityType).map(t => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {selectedObjectId.type === 'ParkingArea' && (
                <div className="space-y-4 border-t pt-4">
                    <div>
                        <Label className="text-sm font-medium text-muted-foreground">Parking Type</Label>
                        <Select
                            value={(object as any).type || ParkingType.Surface}
                            onValueChange={(v) => actions.updateObject(selectedObjectId.id, 'ParkingArea', { type: v })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ParkingType.Surface}>Surface</SelectItem>
                                <SelectItem value={ParkingType.Basement}>Basement (Standalone)</SelectItem>
                                {/* <SelectItem value={ParkingType.Podium}>Podium (Standalone)</SelectItem> */}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-xs text-muted-foreground">Efficiency</Label>
                            <div className="flex items-center gap-2">
                                <Slider
                                    min={0.5} max={1.0} step={0.05}
                                    value={[(object as any).efficiency || 0.75]}
                                    onValueChange={([v]) => actions.updateObject(selectedObjectId.id, 'ParkingArea', { efficiency: v })}
                                />
                                <span className="text-xs w-8">{((object as any).efficiency || 0.75) * 100}%</span>
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs text-muted-foreground">Capacity</Label>
                            <div className="text-lg font-bold font-mono">{(object as any).capacity || 0} <span className="text-xs font-normal text-muted-foreground">cars</span></div>
                        </div>
                    </div>
                </div>
            )}

            <div className="p-3 bg-secondary rounded-md space-y-2 text-sm mt-4">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Footprint Area:</span>
                    <span className="font-mono">{object.area.toFixed(2)} m²</span>
                </div>
            </div>
        </div>
    );
}

function InternalUtilityProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId || selectedObjectId.type !== 'UtilityArea') return null;

    // First try to find it as a plot utility area (which is already handled by ZoneProperties, but just in case)
    // Here we focus on internal building utilities
    let internalUtility: any = null;
    let building: any = null;

    for (const p of plots) {
        for (const b of p.buildings) {
            const u = b.internalUtilities?.find((x: any) => x.id === selectedObjectId.id);
            if (u) {
                internalUtility = u;
                building = b;
                break;
            }
        }
        if (internalUtility) break;
    }

    if (!internalUtility) return <div className="p-4 text-sm text-center text-muted-foreground">Utility details not found.</div>;

    const isElectrical = internalUtility.type === 'Electrical';
    const name = isElectrical ? 'Electrical Room' : 'HVAC Plant';
    const Icon = isElectrical ? Zap : Fan;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <Icon className={cn("h-5 w-5", isElectrical ? "text-amber-400" : "text-blue-400")} />
                <div>
                    <h4 className="font-semibold text-sm">{internalUtility.name || name}</h4>
                    <p className="text-xs text-muted-foreground">Attached to {building.name}</p>
                </div>
            </div>

            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Footprint Area</span>
                    <span className="font-mono">{(internalUtility.geometry ? turf.area(internalUtility.geometry) : 0).toFixed(1)} m²</span>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md space-y-2 mt-4">
                    <h5 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Utility Specs</h5>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Service Logic</span>
                        <span className="font-medium">Direct Feed</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Redundancy</span>
                        <span className="font-medium">N+1 Config</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Units Served</span>
                        <span className="font-medium">{building.floors.length * 4} Units</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

function ParkingFloorProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId) return null;

    // Find floor
    let floor: any = null;
    let building: any = null;

    for (const p of plots) {
        for (const b of p.buildings) {
            const f = b.floors?.find((x: any) => x.id === selectedObjectId.id);
            if (f) {
                floor = f;
                building = b;
                break;
            }
        }
        if (floor) break;
    }

    if (!floor) return null;

    const type = floor.parkingType || ParkingType.Basement;
    const Icon = type === ParkingType.Basement ? ArrowDownToLine : (type === ParkingType.Stilt ? Layers : Car);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <Icon className="h-5 w-5 text-slate-500" />
                <div>
                    <h4 className="font-semibold text-sm">{type} Parking</h4>
                    <p className="text-xs text-muted-foreground">Building: {building.name}</p>
                </div>
            </div>

            <div className="space-y-4 text-sm pt-2">
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-2 bg-secondary rounded flex flex-col">
                        <span className="text-muted-foreground text-xs">Level</span>
                        <span className="font-bold">{floor.level !== undefined ? (floor.level < 0 ? `B${Math.abs(floor.level)}` : `L${floor.level}`) : '-'}</span>
                    </div>
                    <div className="p-2 bg-secondary rounded flex flex-col">
                        <span className="text-muted-foreground text-xs">Capacity</span>
                        <span className="font-bold text-lg">{floor.parkingCapacity || 0}</span>
                    </div>
                </div>

                <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Floor Height</span>
                    <span className="font-mono">{floor.height}m</span>
                </div>
            </div>
        </div>
    )
}

function EntryPointProperties() {
    const { actions, selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId || selectedObjectId.type !== 'EntryPoint') return null;

    let entry: any = null;
    for (const p of plots) {
        entry = p.entries.find(e => e.id === selectedObjectId.id);
        if (entry) break;
    }

    if (!entry) return null;

    return (
        <div className="space-y-4 pt-4">
            <div>
                <Label htmlFor="gate-name" className="text-sm font-medium text-muted-foreground">Gate Name</Label>
                <Input
                    id="gate-name"
                    value={entry.name || ''}
                    placeholder={`${entry.type} Gate`}
                    onChange={(e) => actions.updateObject(entry.id, 'EntryPoint', { name: e.target.value })}
                />
            </div>
            <div>
                <Label htmlFor="gate-color" className="text-sm font-medium text-muted-foreground">Gate Color</Label>
                <div className="flex gap-2 items-center mt-1">
                    <Input
                        id="gate-color"
                        type="color"
                        className="w-12 h-8 p-1 cursor-pointer"
                        value={entry.color || (entry.type === 'Entry' ? '#10b981' : entry.type === 'Exit' ? '#ef4444' : '#3b82f6')}
                        onChange={(e) => actions.updateObject(entry.id, 'EntryPoint', { color: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground font-mono uppercase">{entry.color || 'Default'}</span>
                </div>
            </div>
            <div className="p-3 bg-secondary rounded-md space-y-2 text-sm mt-4">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-semibold">{entry.type}</span>
                </div>
            </div>
        </div>
    );
}

function UnitProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId || selectedObjectId.type !== 'Unit') return null;

    let unit: any = null;
    let building: any = null;
    for (const p of plots) {
        for (const b of p.buildings) {
            const u = b.units?.find((u: any) => u.id === selectedObjectId.id);
            if (u) {
                unit = u;
                building = b;
                break;
            }
        }
        if (unit) break;
    }

    if (!unit) return null;

    const area = unit.geometry ? turf.area(unit.geometry) : 0;

    return (
        <div className="space-y-4 pt-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <div className="w-5 h-5 rounded-sm border shadow-sm" style={{ backgroundColor: unit.color || '#ccc' }} />
                <div>
                    <h4 className="font-semibold text-sm">{unit.type} Unit</h4>
                    <p className="text-xs text-muted-foreground">Building: {building.name}</p>
                </div>
            </div>

            <div className="p-3 bg-secondary rounded-md space-y-2 text-sm mt-4">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Area:</span>
                    <span className="font-mono">{area.toFixed(2)} m²</span>
                </div>
            </div>
        </div>
    );
}

function CoreProperties() {
    const { selectedObjectId, plots } = useBuildingStore();
    if (!selectedObjectId || selectedObjectId.type !== 'Core') return null;

    let core: any = null;
    let building: any = null;
    for (const p of plots) {
        for (const b of p.buildings) {
            const c = b.cores?.find((c: any) => c.id === selectedObjectId.id);
            if (c) {
                core = c;
                building = b;
                break;
            }
        }
        if (core) break;
    }

    if (!core) return null;

    // Convert footprint to m2
    const area = core.geometry ? turf.area(core.geometry) : 0;

    return (
        <div className="space-y-4 pt-4">
            <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-md">
                <Layers className="h-5 w-5 text-slate-500" />
                <div>
                    <h4 className="font-semibold text-sm">{core.type} Core</h4>
                    <p className="text-xs text-muted-foreground">Building: {building.name}</p>
                </div>
            </div>

            <div className="p-3 bg-secondary rounded-md space-y-2 text-sm mt-4">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Footprint Area:</span>
                    <span className="font-mono">{area.toFixed(2)} m²</span>
                </div>
            </div>
        </div>
    );
}

function getSelectionDetails(selectedObjectId: { type: string, id: string } | null, plots: any[]) {
    if (!selectedObjectId) return { name: 'Properties', type: '' };

    const { type, id } = selectedObjectId;
    let name = '';

    if (type === 'Plot') {
        const plot = plots.find(p => p.id === id);
        name = plot?.name;
    } else if (type === 'EntryPoint') {
        for (const plot of plots) {
            const entry = plot.entries.find((e: any) => e.id === id);
            if (entry) {
                name = entry.name || `${entry.type} Gate`;
                break;
            }
        }
    } else {
        for (const plot of plots) {
            if (type === 'Building') {
                const building = plot.buildings.find((b: any) => b.id === id);
                if (building) { name = building.name; break; }
            } else if (type === 'GreenArea') {
                const greenArea = plot.greenAreas.find((g: any) => g.id === id);
                if (greenArea) { name = greenArea.name; break; }
            } else if (type === 'ParkingArea') {
                const parkingArea = plot.parkingAreas.find((p: any) => p.id === id);
                if (parkingArea) { name = parkingArea.name; break; }
            } else if (type === 'BuildableArea') {
                const buildableArea = plot.buildableAreas.find((b: any) => b.id === id);
                if (buildableArea) { name = buildableArea.name; break; }
            } else if (type === 'UtilityArea') {
                const utilityArea = plot.utilityAreas.find((u: any) => u.id === id);
                if (utilityArea) { name = utilityArea.name; break; }
                const internalUtil = plot.buildings.flatMap((b: any) => b.internalUtilities || []).find((u: any) => u.id === id);
                if (internalUtil) { name = internalUtil.name || internalUtil.type; break; }
            } else if (type === 'Unit') {
                const b = plot.buildings.find((b: any) => b.units?.some((u: any) => u.id === id));
                const u = b?.units?.find((u: any) => u.id === id);
                if (u) { name = `${u.type} Unit`; break; }
            } else if (type === 'Core') {
                const b = plot.buildings.find((b: any) => b.cores?.some((c: any) => c.id === id));
                const c = b?.cores?.find((c: any) => c.id === id);
                if (c) { name = `${c.type} Core`; break; }
            } else if ((type as string) === 'Utility' || (type as string) === 'Parking') {
                // Search in building floors
                for (const b of plot.buildings) {
                    const f = b.floors?.find((f: any) => f.id === id);
                    if (f) {
                        if ((type as string) === 'Utility') {
                            const isElec = f.utilityType === 'Electrical' || id.includes('electrical');
                            name = isElec ? 'Electrical Room' : 'HVAC Plant';
                        } else {
                            // Parking
                            name = `${f.parkingType || 'Basement'} Parking`;
                        }
                        break;
                    }
                }
                if (name) break;
            }
        }
    }

    return { name, type };
}


export function PropertiesPanel() {
    const { selectedObjectId, actions, plots } = useBuildingStore();

    if (!selectedObjectId) return null;

    const { name, type } = getSelectionDetails(selectedObjectId, plots);

    return (
        <Card className="bg-background/80 backdrop-blur-sm max-h-full w-full flex flex-col shadow-xl overflow-hidden border-border/50 pointer-events-auto">
            <CardHeader className='flex-row items-center justify-between shrink-0'>
                <div>
                    <CardTitle className='text-lg'>{name}</CardTitle>
                    <CardDescription>{type} Properties</CardDescription>
                </div>
                <Button size="icon" variant="ghost" onClick={() => actions.selectObject(null, null)}>
                    <X className='h-4 w-4' />
                </Button>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin space-y-6 pb-4">
                {selectedObjectId.type === 'Building' && <BuildingProperties />}
                {selectedObjectId.type === 'Plot' && <PlotProperties />}
                {(selectedObjectId.type === 'GreenArea' || selectedObjectId.type === 'ParkingArea' || selectedObjectId.type === 'BuildableArea') && <ZoneProperties />}
                {selectedObjectId.type === 'UtilityArea' && (
                    plots.flatMap(p => p.utilityAreas).some(u => u.id === selectedObjectId.id)
                        ? <ZoneProperties />
                        : <InternalUtilityProperties />
                )}
                {(selectedObjectId.type as string) === 'Parking' && <ParkingFloorProperties />}
                {selectedObjectId.type === 'Unit' && <UnitProperties />}
                {selectedObjectId.type === 'Core' && <CoreProperties />}
                {selectedObjectId.type === 'EntryPoint' && <EntryPointProperties />}
            </CardContent>
        </Card>
    );
}
