
'use client';
import React from 'react';
import {
    Building2,
    Trees,
    Car,
    ChevronDown,
    ChevronRight,
    LandPlot,
    Trash2,
    Zap,
    Fan,
    ArrowDownToLine,
    Layers,
    Box,
    Grid,
    Ghost,
    Eye,
    EyeOff,
    Leaf,
    DoorOpen
} from 'lucide-react';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { Project } from '@/lib/types';


function PlotItem({ plot }: { plot: import('@/lib/types').Plot }) {
    const { actions, selectedObjectId, uiState, componentVisibility } = useBuildingStore(s => ({
        actions: s.actions,
        selectedObjectId: s.selectedObjectId,
        uiState: s.uiState,
        componentVisibility: s.componentVisibility
    }));
    const [isOpen, setIsOpen] = React.useState(true);

    const isPlotSelected = selectedObjectId?.type === 'Plot' && selectedObjectId.id === plot.id;

    const renderObject = (obj: any, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea' | 'EntryPoint') => {
        let Icon;
        switch (type) {
            case 'Building': Icon = Building2; break;
            case 'GreenArea': Icon = Trees; break;
            case 'ParkingArea': Icon = Car; break;
            case 'BuildableArea': Icon = LandPlot; break;
            case 'UtilityArea': Icon = Zap; break;
            case 'EntryPoint': Icon = DoorOpen; break;
            default: Icon = Building2;
        }

        const isSelected = selectedObjectId?.id === obj.id && selectedObjectId?.type === type;
        let info = null;
        if (type === 'ParkingArea' && obj.capacity) {
            info = <span className="text-xs text-muted-foreground ml-2">({obj.capacity} spots)</span>;
        } else if (type === 'UtilityArea' && obj.level !== undefined) {
            const levelText = obj.level < 0 ? 'Basement' : 'Ground';
            info = <span className="text-xs text-muted-foreground ml-2">({levelText})</span>;
        }

        return (
            <div key={obj.id} className={cn("flex items-center justify-between p-2 rounded-md transition-colors", isSelected ? 'bg-primary/20' : 'hover:bg-muted')}>
                <button onClick={() => actions.selectObject(obj.id, type)} className="flex-1 text-left text-sm flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <span>{obj.name}</span>
                    {info}
                </button>
                <div className="flex items-center gap-1">
                    {type === 'UtilityArea' && obj.level !== undefined && obj.level < 0 && (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.toggleObjectVisibility(plot.id, obj.id, type);
                            }}
                            title={obj.visible !== false ? "Hide Basement Utility" : "Show Basement Utility"}
                        >
                            {obj.visible !== false ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deleteObject(plot.id, obj.id, type)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                </div>
            </div>
        )
    };

    const buildableAreas = plot.buildableAreas || [];

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="bg-secondary/30 rounded-lg">
            <div className={cn("flex items-center justify-between p-2 rounded-t-lg transition-colors", isOpen && "border-b border-border/50", isPlotSelected ? 'bg-primary/20' : 'hover:bg-muted/50')}>
                <div className='flex-1 text-left flex items-center gap-2'>
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                            {isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
                        </Button>
                    </CollapsibleTrigger>
                    <button onClick={() => actions.selectObject(plot.id, 'Plot')} className="flex-1 text-left">
                        <span className='font-medium text-sm'>{plot.name}</span>
                    </button>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => actions.deletePlot(plot.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            </div>
            <CollapsibleContent>
                <div className='p-2 space-y-2'>
                    {buildableAreas.map(b => renderObject(b, 'BuildableArea'))}
                    {plot.buildings.map(b => (
                        <React.Fragment key={b.id}>
                            {renderObject(b, 'Building')}

                            {/* Render Internal Utilities (New System) */}
                            {b.internalUtilities && b.internalUtilities.length > 0 && (
                                <div className="pl-8 space-y-1 pb-2">
                                    {b.internalUtilities.map(util => (
                                        <div
                                            key={util.id}
                                            className={cn(
                                                "flex items-center text-xs cursor-pointer transition-colors group",
                                                (util.type === 'Electrical' && componentVisibility.electrical) || (util.type === 'HVAC' && componentVisibility.hvac)
                                                    ? "text-primary font-medium"
                                                    : "text-muted-foreground hover:text-primary"
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (util.type === 'Electrical') actions.toggleComponentVisibility('electrical');
                                                else if (util.type === 'HVAC') actions.toggleComponentVisibility('hvac');
                                            }}
                                        >
                                            {util.type === 'Electrical' ? <Zap className="h-3 w-3 mr-2 text-amber-400" /> : <Fan className="h-3 w-3 mr-2 text-blue-400" />}
                                            <span className="flex-1">{util.name}</span>
                                            {((util.type === 'Electrical' && componentVisibility.electrical) || (util.type === 'HVAC' && componentVisibility.hvac)) ?
                                                <Eye className="h-3 w-3 ml-2" /> :
                                                <EyeOff className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-50" />
                                            }
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Basement Parking with Visibility Toggle - Show Individual Floors */}
                            {b.floors.filter(f => f.type === 'Parking' && f.parkingType !== 'Stilt' && f.parkingType !== 'Podium').length > 0 && (
                                <div className="pl-8 space-y-1 pb-2">
                                    {b.floors
                                        .filter(f => f.type === 'Parking' && f.parkingType !== 'Stilt' && f.parkingType !== 'Podium')
                                        .map((floor, index) => (
                                            <div
                                                key={floor.id}
                                                className={cn(
                                                    "flex items-center text-xs cursor-pointer transition-colors group",
                                                    componentVisibility.basements
                                                        ? "text-primary font-medium"
                                                        : "text-muted-foreground hover:text-primary"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actions.toggleComponentVisibility('basements');
                                                }}
                                                title={componentVisibility.basements ? "Hide Basements" : "Show Basements"}
                                            >
                                                <ArrowDownToLine className="h-3 w-3 mr-2 text-slate-500" />
                                                <span className="flex-1">
                                                    {floor.parkingType || 'Basement'} Parking ({floor.parkingCapacity || 0})
                                                </span>
                                                {componentVisibility.basements ? <Eye className="h-3 w-3 ml-2" /> : <EyeOff className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-50" />}
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            {/* Render Internal Layout Items */}
                            {b.cores && b.cores.length > 0 && (
                                <div className="pl-8 space-y-1 pb-2">
                                    <div
                                        className={cn(
                                            "flex items-center text-xs cursor-pointer transition-colors group",
                                            componentVisibility.cores
                                                ? "text-primary font-medium"
                                                : "text-muted-foreground hover:text-primary"
                                        )}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            actions.toggleComponentVisibility('cores');
                                        }}
                                        title={componentVisibility.cores ? "Hide Cores" : "Show Only Cores"}
                                    >
                                        <Box className="h-3 w-3 mr-2" style={{ color: '#9370DB' }} />
                                        <span className="flex-1">Cores ({b.cores.length})</span>
                                        {componentVisibility.cores ? <Eye className="h-3 w-3 ml-2" /> : <EyeOff className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-50" />}
                                    </div>
                                </div>
                            )}
                            {b.units && b.units.length > 0 && (
                                <div className="pl-8 space-y-1 pb-2">
                                    {/* Header row */}
                                    <div
                                        className={cn(
                                            "flex items-center text-xs cursor-pointer transition-colors group",
                                            componentVisibility.units
                                                ? "text-primary font-medium"
                                                : "text-muted-foreground hover:text-primary"
                                        )}
                                        onClick={(e) => { e.stopPropagation(); actions.toggleComponentVisibility('units'); }}
                                        title={componentVisibility.units ? "Hide Units" : "Show Only Units"}
                                    >
                                        <Grid className="h-3 w-3 mr-2 text-blue-400" />
                                        <span className="flex-1">Units ({b.units.length})</span>
                                        {componentVisibility.units ? <Eye className="h-3 w-3 ml-2" /> : <EyeOff className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-50" />}
                                    </div>
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                    {plot.greenAreas.map(g => renderObject(g, 'GreenArea'))}
                    {(plot.entries || []).map(e => renderObject(e, 'EntryPoint'))}
                    {plot.parkingAreas.map(p => renderObject(p, 'ParkingArea'))}

                    {plot.utilityAreas.map(u => renderObject(u, 'UtilityArea'))}

                    {plot.buildings.length === 0 && plot.greenAreas.length === 0 && plot.parkingAreas.length === 0 && buildableAreas.length === 0 && plot.utilityAreas.length === 0 && (
                        <p className='text-xs text-center text-muted-foreground p-2'>This plot is empty.</p>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}

export function ProjectExplorer({ className, embedded = false }: { className?: string; embedded?: boolean }) {
    const { plots, uiState, actions } = useBuildingStore(s => ({
        plots: s.plots,
        uiState: s.uiState,
        actions: s.actions
    }));

    const activeProject = useBuildingStore(s => s.projects.find(p => p.id === s.activeProjectId));
    const { regulations } = useGreenRegulations(activeProject as unknown as Project);

    const handleRegulationChange = (value: string) => {
        if (activeProject) {
            // value is the regulation ID (or name if we use that)
            // But project expects an array of strings in 'greenCertification'
            // Let's assume the value maps to one of 'IGBC' | 'GRIHA' | 'LEED' | 'Green Building'
            // Or better, we store the specific regulation ID in 'regulationId' field?
            // The type definition has 'regulationId?: string' but 'greenCertification?: string[]'.
            // Let's update 'greenCertification' with the selected value for now.
            actions.updateProject(activeProject.id, { greenCertification: [value as any] });
        }
    };

    // Always render structure even if empty to keep layout stable, or return null if preferred.
    // We want to show the explorer structure even if empty to provide guidance


    const Container = embedded ? 'div' : Card;

    return (
        <div className={cn('w-full flex-1 min-h-0 flex flex-col', className)}>
            <Container className={cn("flex flex-col h-full", embedded ? "" : "bg-background/80 backdrop-blur-sm border-t-0 rounded-t-none rounded-b-xl shadow-none")}>
                {!embedded && (
                    <CardHeader className="py-2 px-4 border-b">
                        <div className="flex flex-row items-center justify-between mb-2">
                            <CardTitle className="text-sm">Project Explorer</CardTitle>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn("h-6 w-6", uiState.ghostMode && "text-primary bg-primary/10")}
                                onClick={actions.toggleGhostMode}
                                title="Toggle Ghost Mode (View Internals)"
                            >
                                <Ghost className="h-4 w-4" />
                            </Button>
                        </div>
                        {/* Green Regulation Selector */}
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Green Regulation</Label>
                            <Select
                                value={activeProject?.greenCertification?.[0] || 'IGBC'}
                                onValueChange={handleRegulationChange}
                            >
                                <SelectTrigger className="h-7 text-xs">
                                    <SelectValue placeholder="Select Regulation" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="IGBC">IGBC Green Homes</SelectItem>
                                    <SelectItem value="GRIHA">GRIHA</SelectItem>
                                    <SelectItem value="LEED">LEED</SelectItem>
                                    <SelectItem value="Green Building">Generic Green Building</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                )}
                <div className={cn("flex-1 overflow-hidden", embedded ? "" : "p-0")}>
                    {/* If embedded, we might want ScrollArea or just simple div.
                        Original used ScrollArea. Keep it.
                        Original content had p-0 on CardContent. */}
                    <ScrollArea className="h-full">
                        <div className="space-y-2 p-3">
                            {plots.length > 0 ? (
                                plots.map(plot => <PlotItem key={plot.id} plot={plot} />)
                            ) : (
                                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
                                    <LandPlot className="h-10 w-10 opacity-20" />
                                    <div className="text-xs max-w-[200px]">
                                        <p className="font-medium">No plots defined</p>
                                        <p className="opacity-70">Use the drawing tools to outline your site boundary and begin planning.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </Container>
        </div>
    )
}
