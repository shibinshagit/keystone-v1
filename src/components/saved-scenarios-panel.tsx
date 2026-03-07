
import { useBuildingStore } from "@/hooks/use-building-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, BookX, Calculator, Building2, Home, Bookmark } from "lucide-react";
import { ScenarioThumbnail } from "./scenario-thumbnail";
import { cn } from "@/lib/utils";
import { DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';

interface SavedScenariosPanelProps {
    embedded?: boolean;
}

export function SavedScenariosPanel({ embedded = false }: SavedScenariosPanelProps) {
    const {
        designOptions,
        plots,
        selectedObjectId,
        actions,
        activeProjectId,
        projects,
    } = useBuildingStore(state => ({
        designOptions: state.designOptions,
        plots: state.plots,
        selectedObjectId: state.selectedObjectId,
        actions: state.actions,
        activeProjectId: state.activeProjectId,
        projects: state.projects,
    }));

    const activeProject = projects.find(p => p.id === activeProjectId);
    const unitMix = activeProject?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;
    const weightedAvgUnitArea = unitMix.reduce((acc, u) => acc + u.area * u.mixRatio, 0) || 70;
    const coreFactor = activeProject?.feasibilityParams?.coreFactor ?? DEFAULT_FEASIBILITY_PARAMS.coreFactor;
    const circFactor = activeProject?.feasibilityParams?.circulationFactor ?? DEFAULT_FEASIBILITY_PARAMS.circulationFactor;
    const efficiencyFactor = 1 - coreFactor - circFactor;

    // Derive the truly selected plot based on user selection
    const selectedPlot = selectedObjectId?.type === 'Plot'
        ? plots.find(p => p.id === selectedObjectId.id)
        : selectedObjectId
            ? plots.find(p => p.buildings.some(b => b.id === selectedObjectId.id) || p.greenAreas.some(g => g.id === selectedObjectId.id) || p.parkingAreas.some(pk => pk.id === selectedObjectId.id))
            : undefined;

    const hasGeneratedBuildings = selectedPlot?.buildings && selectedPlot.buildings.length > 0;



    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        actions.deleteDesignOption(id);
    };

    const handleLoad = (id: string) => {
        actions.loadDesignOption(id);
    };

    return (
        <div className={cn("flex flex-col h-full", embedded ? "" : "p-0")}>
            {/* Header */}
            <div className="p-4 border-b shrink-0">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Bookmark className="h-5 w-5 text-yellow-500" />
                    Saved Scenarios
                </h2>
            </div>

            {/* Save Current Action */}
            <div className="mb-4 px-1">
            </div>

            {/* Scenarios List */}
            <ScrollArea className="flex-1 -mx-2 px-3">
                <div className="space-y-4 pb-4">
                    {designOptions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
                            <BookX className="h-10 w-10 opacity-20" />
                            <div className="text-xs">
                                <p className="font-medium">No scenarios saved yet</p>
                                <p className="opacity-70">Generate a design and click 'Save' to see it here.</p>
                            </div>
                        </div>
                    ) : (
                        [...designOptions].sort((a, b) => b.createdAt - a.createdAt).map((option) => {
                            // Calculate Stats for each option
                            let totalGFA = 0;
                            let totalUnits = 0;
                            let totalBuildings = 0;

                            // Check if data structure is valid
                            if (option.data && option.data.plots) {
                                option.data.plots.forEach((plot: any) => {
                                    if (plot.buildings) {
                                        totalBuildings += plot.buildings.length;
                                        plot.buildings.forEach((b: any) => {
                                            if (b.visible) {
                                                totalGFA += b.area * (b.numFloors || 1);
                                                // Use actual unit counts from exact typology
                                                if (b.units && b.units.length > 0) {
                                                    totalUnits += b.units.length;
                                                }
                                            }
                                        });
                                    }
                                });
                                // Fallback: use weighted avg unit area from project params
                                if (totalUnits === 0) {
                                    totalUnits = Math.floor((totalGFA * efficiencyFactor) / weightedAvgUnitArea);
                                }
                            }

                            // Get geometry for thumbnail
                            const plots = option.data?.plots || [];
                            const thumbnailFeatures = plots.flatMap((p: any) =>
                                p.buildings ? p.buildings.map((b: any) => b.geometry) : []
                            );
                            const roadFeatures = plots.flatMap((p: any) =>
                                (p.utilityAreas || []).filter((u: any) => u.type === 'Roads' || u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                            );
                            const parkingFeatures = plots.flatMap((p: any) =>
                                (p.parkingAreas || []).map((pa: any) => pa.geometry)
                            );
                            const utilityFeatures = plots.flatMap((p: any) =>
                                (p.utilityAreas || []).filter((u: any) => u.type !== 'Roads' && !u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                            );
                            const greenFeatures = plots.flatMap((p: any) =>
                                (p.greenAreas || []).map((ga: any) => ga.geometry)
                            );
                            const plotGeometry = plots[0]?.geometry;
                            const setback = plots[0]?.setback || 0;

                            return (
                                <Card
                                    key={option.id}
                                    className="group relative overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 hover:shadow-md border-muted"
                                    onClick={() => handleLoad(option.id)}
                                >
                                    {/* Thumbnail Header */}
                                    <div className="relative h-32 bg-muted/20 border-b">
                                        <ScenarioThumbnail
                                            features={thumbnailFeatures}
                                            roadFeatures={roadFeatures}
                                            parkingFeatures={parkingFeatures}
                                            utilityFeatures={utilityFeatures}
                                            greenFeatures={greenFeatures}
                                            plotGeometry={plotGeometry}
                                            setback={setback}
                                            className="w-full h-full !bg-transparent !p-2"
                                        />

                                        {/* Overlay Actions */}
                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="destructive"
                                                size="icon"
                                                className="h-7 w-7 shadow-sm"
                                                onClick={(e) => handleDelete(e, option.id)}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="p-3">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-semibold text-sm truncate pr-2" title={option.name}>
                                                    {option.name}
                                                </h4>

                                            </div>
                                        </div>

                                        {/* Mini Stats Grid */}
                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <Calculator className="h-3 w-3" />
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] uppercase font-bold text-muted-foreground/70">GFA</span>
                                                    <span className="text-xs font-mono text-foreground">{Math.round(totalGFA).toLocaleString()} m²</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <Home className="h-3 w-3" />
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] uppercase font-bold text-muted-foreground/70">Units</span>
                                                    <span className="text-xs font-mono text-foreground">{totalUnits}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <Building2 className="h-3 w-3" />
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] uppercase font-bold text-muted-foreground/70">Buildings</span>
                                                    <span className="text-xs font-mono text-foreground">{totalBuildings}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <div className="h-3 w-3 flex items-center justify-center font-bold text-[10px] border border-current rounded-sm">F</div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] uppercase font-bold text-muted-foreground/70">Avg. Floors</span>
                                                    <span className="text-xs font-mono text-foreground">
                                                        {Math.round(
                                                            plots.reduce((sum: number, p: any) =>
                                                                sum + (p.buildings ? p.buildings.reduce((s: number, b: any) => s + (b.numFloors || 1), 0) : 0), 0
                                                            ) / Math.max(1, totalBuildings)
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
