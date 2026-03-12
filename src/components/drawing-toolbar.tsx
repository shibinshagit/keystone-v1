'use client';
import { Button } from '@/components/ui/button';
import { useBuildingStore, type DrawingObjectType } from '@/hooks/use-building-store';
import { useToast } from '@/hooks/use-toast';
import { Building2, LandPlot, Map, WandSparkles, Cuboid, Route, Move, MousePointerClick } from 'lucide-react';
import { Slider } from './ui/slider';
import { Label } from './ui/label';
import React from 'react';
import { AiGeneratorModal } from './ai-generator-modal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { AiMassingModal } from './ai-massing-modal';
import { produce } from 'immer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { BuildingIntendedUse } from '@/lib/types';

export function DrawingToolbar() {
    const { actions, drawingState, plots, selectedObjectId, drawingPoints, uiState } = useBuildingStore(s => ({
        actions: s.actions,
        drawingState: s.drawingState,
        plots: s.plots,
        selectedObjectId: s.selectedObjectId,
        drawingPoints: s.drawingPoints,
        uiState: s.uiState
    }));
    const { toast } = useToast();

    const setRoadWidth = (width: number) => {
        useBuildingStore.setState(produce(draft => {
            draft.drawingState.roadWidth = width;
        }));
    };

    const setBuildingIntendedUse = (use: BuildingIntendedUse) => {
        useBuildingStore.setState(produce(draft => {
            draft.drawingState.buildingIntendedUse = use;
        }));
    };

    const handleToolClick = (tool: DrawingObjectType) => {
        if (tool !== 'Plot' && tool !== 'Select' && plots.length === 0) {
            toast({
                variant: 'destructive',
                title: 'No Plot Available',
                description: 'Please create a plot before adding other objects.',
            });
            return;
        }
        let activePlotId = null;
        if (selectedObjectId?.type === 'Plot') {
            activePlotId = selectedObjectId.id;
        } else if (plots.length > 0) {
            activePlotId = [...plots].sort((a, b) => {
                const bTime = b.id.includes('-') ? parseInt(b.id.split('-')[1]) : 0;
                const aTime = a.id.includes('-') ? parseInt(a.id.split('-')[1]) : 0;
                return bTime - aTime;
            })[0].id;
        }
        actions.startDrawing(tool, activePlotId);
    }

    const tools: { name: DrawingObjectType, icon: React.ElementType, tooltip: string }[] = [
        { name: 'Select', icon: MousePointerClick, tooltip: 'Select Objects' },
        { name: 'Plot', icon: Map, tooltip: 'Draw Plot Boundary' },
        { name: 'Zone', icon: LandPlot, tooltip: 'Draw Custom Zone' },
        { name: 'Building', icon: Building2, tooltip: 'Draw Building' },
        { name: 'Road', icon: Route, tooltip: 'Draw Road (Polygon)' },
        { name: 'Move', icon: Move, tooltip: 'Move Objects' },
    ];

    const isPlotSelected = selectedObjectId?.type === 'Plot';


    const isFeasibilityPanelOpen = useBuildingStore(state => !!state.selectedObjectId && state.uiState.isFeasibilityPanelOpen);
    const kpiBottom = isFeasibilityPanelOpen ? 'calc(45vh + 8px)' : '52px';

    return (
        <div className="absolute left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 transition-all duration-300 print:hidden" style={{ bottom: kpiBottom }}>
            {drawingState.objectType === 'Road' && drawingState.isDrawing && (
                <div className="bg-background/90 backdrop-blur-sm p-4 rounded-lg border border-border shadow-lg w-64 animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <Label className="text-sm font-medium">Road Width</Label>
                        <span className="text-sm font-bold text-primary">{drawingState.roadWidth}m</span>
                    </div>
                    <Slider
                        value={[drawingState.roadWidth]}
                        min={3}
                        max={30}
                        step={0.5}
                        onValueChange={(vals) => setRoadWidth(vals[0])}
                    />
                    {drawingPoints.length >= 2 && (
                        <Button
                            className="w-full mt-1"
                            size="sm"
                            onClick={() => window.dispatchEvent(new CustomEvent('finishRoad'))}
                        >
                            Done
                        </Button>
                    )}
                </div>
            )}
            {drawingState.objectType === 'Building' && drawingState.isDrawing && (
                <div className="bg-background/90 backdrop-blur-sm p-4 rounded-lg border border-border shadow-lg w-64 animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-3">
                    <Label className="text-sm font-medium">Building Type</Label>
                    <Select
                        value={drawingState.buildingIntendedUse}
                        onValueChange={(val) => setBuildingIntendedUse(val as BuildingIntendedUse)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select type..." />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.values(BuildingIntendedUse).filter(use => use !== BuildingIntendedUse.Utility).map(use => (
                                <SelectItem key={use} value={use}>
                                    {use.replace(/([A-Z])/g, ' $1').trim()}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {drawingPoints.length >= 2 && (
                        <Button
                            className="w-full mt-1"
                            size="sm"
                            onClick={() => window.dispatchEvent(new CustomEvent('closePolygon'))}
                        >
                            Finish Building
                        </Button>
                    )}
                </div>
            )}
            <div className="flex gap-2 bg-background/80 backdrop-blur-sm p-2 rounded-lg border border-border shadow-md">
                <TooltipProvider>
                    {tools.map(tool => (
                        <Tooltip key={tool.name}>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant={drawingState.objectType === tool.name ? 'default' : 'ghost'}
                                    onClick={() => handleToolClick(tool.name)}
                                    disabled={drawingState.isDrawing && drawingState.objectType !== tool.name}
                                >
                                    <tool.icon className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p>{tool.tooltip}</p>
                            </TooltipContent>
                        </Tooltip>
                    ))}
                    {/* <div className="h-10 border-l border-border mx-2"></div> */}
                    {/* <Tooltip>
                        <TooltipTrigger asChild>
                            <div><AiGeneratorModal /></div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>AI Site Layout Generator (2D)</p>
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div><AiMassingModal /></div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>AI Massing Generator (3D)</p>
                        </TooltipContent>
                    </Tooltip> */}
                </TooltipProvider>
            </div>
        </div>
    )
}
