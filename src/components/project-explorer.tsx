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
    DoorOpen,
    Sun,
    BatteryCharging
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
import { useDevelopmentMetrics } from '@/hooks/use-development-metrics';


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
                <button onClick={() => actions.selectObject(obj.id, type)} className="flex-1 text-left text-xs flex items-center gap-1.5 min-w-0">
                    <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{obj.name}</span>
                    {info}
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                    {type === 'UtilityArea' && (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.toggleObjectVisibility(plot.id, obj.id, type);
                            }}
                            title={obj.visible !== false ? "Hide" : "Show"}
                        >
                            {obj.visible !== false ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                        </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => actions.deleteObject(plot.id, obj.id, type)}>
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            </div>
        )
    };

    const buildableAreas = plot.buildableAreas || [];

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="bg-secondary/20 rounded-lg">
            <div className={cn("flex items-center gap-1 p-1.5 rounded-t-lg transition-colors", isOpen && "border-b border-border/30", isPlotSelected ? 'bg-primary/15' : 'hover:bg-muted/50')}>
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                        {isOpen ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
                    </Button>
                </CollapsibleTrigger>
                <button onClick={() => actions.selectObject(plot.id, 'Plot')} className="flex-1 text-left min-w-0">
                    <span className='font-medium text-xs truncate block'>{plot.name}</span>
                </button>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => actions.deletePlot(plot.id)}>
                    <Trash2 className="h-3 w-3" />
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
                                    {b.internalUtilities.map(util => {
                                        // Determine which toggle this utility maps to
                                        let toggleKey: 'electrical' | 'hvac' | 'solar' | 'ev' | null = null;
                                        let IconComp = Zap;
                                        let iconColor = 'text-amber-400';
                                        
                                        if (util.type === 'Electrical') {
                                            toggleKey = 'electrical';
                                            IconComp = Zap;
                                            iconColor = 'text-amber-400';
                                        } else if (util.type === 'HVAC') {
                                            toggleKey = 'hvac';
                                            IconComp = Fan;
                                            iconColor = 'text-orange-400';
                                        } else if (util.type === 'Solar PV') {
                                            toggleKey = 'solar';
                                            IconComp = Sun;
                                            iconColor = 'text-indigo-400';
                                        } else if (util.type === 'EV Station') {
                                            toggleKey = 'ev';
                                            IconComp = BatteryCharging;
                                            iconColor = 'text-green-500';
                                        }

                                        if (!toggleKey) return null;

                                        const isVisible = componentVisibility[toggleKey];

                                        return (
                                            <div
                                                key={util.id}
                                                className={cn(
                                                    "flex items-center text-xs cursor-pointer transition-colors group",
                                                    isVisible
                                                        ? "text-primary font-medium"
                                                        : "text-muted-foreground hover:text-primary"
                                                )}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actions.toggleComponentVisibility(toggleKey!);
                                                }}
                                            >
                                <IconComp className={`h-3.5 w-3.5 mr-1.5 shrink-0 ${iconColor}`} />
                                                <span className="flex-1 truncate">{util.name}</span>
                                                <span className="shrink-0 ml-1">
                                                    {isVisible ?
                                                        <Eye className="h-3 w-3 text-primary" /> :
                                                        <EyeOff className="h-3 w-3 text-muted-foreground/40" />
                                                    }
                                                </span>
                                            </div>
                                        );
                                    })}
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
                                            <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5 text-slate-500 shrink-0" />
                                                <span className="flex-1 truncate">
                                                    {floor.parkingType || 'Basement'} ({floor.parkingCapacity || 0})
                                                </span>
                                                <span className="shrink-0 ml-1">
                                                    {componentVisibility.basements ? <Eye className="h-3 w-3 text-primary" /> : <EyeOff className="h-3 w-3 text-muted-foreground/40" />}
                                                </span>
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
                                        <Box className="h-3.5 w-3.5 mr-1.5 shrink-0" style={{ color: '#9370DB' }} />
                                        <span className="flex-1 truncate">Cores ({b.cores.length})</span>
                                        <span className="shrink-0 ml-1">
                                            {componentVisibility.cores ? <Eye className="h-3 w-3 text-primary" /> : <EyeOff className="h-3 w-3 text-muted-foreground/40" />}
                                        </span>
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
                                        <Grid className="h-3.5 w-3.5 mr-1.5 text-blue-400 shrink-0" />
                                        <span className="flex-1 truncate">Units ({b.units.length})</span>
                                        <span className="shrink-0 ml-1">
                                            {componentVisibility.units ? <Eye className="h-3 w-3 text-primary" /> : <EyeOff className="h-3 w-3 text-muted-foreground/40" />}
                                        </span>
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
    const metrics = useDevelopmentMetrics(activeProject as any);
    const currentCertRaw = activeProject?.greenCertification?.[0] || null;

    // Normalize displayed certification type: support both storing a doc id (from create dialog)
    // or storing the simple type string ('IGBC'|'GRIHA'|'LEED'). Prefer explicit type when available.
    const normalizedCertType: string | null = React.useMemo(() => {
        if (!currentCertRaw) return null;
        const simple = String(currentCertRaw).toUpperCase();
        if (['IGBC', 'GRIHA', 'LEED'].includes(simple)) return simple;
        // Try to resolve from fetched green regulations (they include certificationType)
        if (regulations && regulations.length > 0) {
            const found = regulations.find((r: any) => r.id === currentCertRaw || String(r.id) === String(currentCertRaw));
            if (found && found.certificationType) return String(found.certificationType).toUpperCase();
            // maybe the stored id contains the type as substring (e.g., 'griha-v2')
            const match = regulations.find((r: any) => String(r.certificationType || '').toUpperCase() === simple || String(r.name || '').toUpperCase().includes(simple));
            if (match && match.certificationType) return String(match.certificationType).toUpperCase();
        }
        // fallback: return raw value
        return String(currentCertRaw);
    }, [currentCertRaw, regulations]);

    const handleRegulationChange = (value: string) => {
        if (!activeProject) return;
        // Preserve existing behavior: store the selected simple type (single-selection)
        actions.updateProject(activeProject.id, { greenCertification: [value as any] });
    };

    const Container = embedded ? 'div' : Card;

    return (
        <div className={cn('w-full flex-1 min-h-0 flex flex-col', className)}>
            <Container className={cn("flex flex-col h-full", embedded ? "" : "bg-background/80 backdrop-blur-sm border-t-0 rounded-t-none rounded-b-xl shadow-none")}>
                <div className="px-3 py-2 border-b shrink-0">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5" />
                            Explorer
                        </h2>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn("h-6 w-6", uiState.ghostMode && "text-primary bg-primary/10")}
                            onClick={() => actions.toggleGhostMode()}
                            title="Ghost Mode"
                        >
                            <Ghost className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                    {/* Green Certification UI removed */}
                </div>
                <div className={cn("flex-1 overflow-hidden", embedded ? "" : "p-0")}>
                    <ScrollArea className="h-full">
                        <div className="space-y-1.5 p-2">
                            {plots.length > 0 ? (
                                plots.map(plot => <PlotItem key={plot.id} plot={plot} />)
                            ) : (
                                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-1.5">
                                    <LandPlot className="h-8 w-8 opacity-15" />
                                    <div className="text-[11px] max-w-[180px]">
                                        <p className="font-medium">No plots yet</p>
                                        <p className="opacity-60">Draw a plot boundary to start.</p>
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
