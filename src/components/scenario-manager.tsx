'use client';

import { useBuildingStore } from '@/hooks/use-building-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, FolderOpen, History, Plus, Sparkles, LayoutTemplate } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ScenarioThumbnail } from './scenario-thumbnail';
import { Separator } from './ui/separator';
import { DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';

// Helper to calculate stats for a scenario
const getScenarioStats = (plots: any[], efficiencyFactor: number, weightedAvgUnitArea: number) => {
    let totalGFA = 0;
    let totalUnits = 0;

    plots.forEach(plot => {
        plot.buildings.forEach((b: any) => {
            if (b.visible) {
                totalGFA += b.area * (b.numFloors || 1);
                // b.units already contains instances for all floors
                if (b.units && b.units.length > 0) {
                    totalUnits += b.units.length;
                }
            }
        });
    });

    // Fallback: use weighted avg unit area from project params
    if (totalUnits === 0) {
        totalUnits = Math.floor((totalGFA * efficiencyFactor) / weightedAvgUnitArea);
    }
    return {
        GFA: Math.round(totalGFA),
        Units: totalUnits
    };
};

// Export just the content for embedding
export function ScenarioContent() {
    const {
        designOptions,
        actions,
        plots,
        activeProjectId,
        projects,
    } = useBuildingStore(state => ({
        designOptions: state.designOptions,
        actions: state.actions,
        plots: state.plots,
        activeProjectId: state.activeProjectId,
        projects: state.projects,
    }));

    const activeProject = projects.find(p => p.id === activeProjectId);
    const unitMix = activeProject?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;
    const weightedAvgUnitArea = unitMix.reduce((acc, u) => acc + u.area * u.mixRatio, 0) || 70;
    const coreFactor = activeProject?.feasibilityParams?.coreFactor ?? DEFAULT_FEASIBILITY_PARAMS.coreFactor;
    const circFactor = activeProject?.feasibilityParams?.circulationFactor ?? DEFAULT_FEASIBILITY_PARAMS.circulationFactor;
    const efficiencyFactor = 1 - coreFactor - circFactor;

    const [newScenarioName, setNewScenarioName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const handleSave = () => {
        if (!newScenarioName.trim()) return;
        actions.saveDesignOption(newScenarioName);
        setNewScenarioName('');
        setIsCreating(false);
    };

    // Mock "Generate 3 Scenarios" - strictly for demo
    const handleGenerateBatch = () => {
        // This would ideally call a backend or complex logic.
        // For now, we'll suggest Manual Save is the way, but we can animate/fake it if needed.
        // Or, we can trigger the generator with random params 3 times and save them?
        // Let's leave it as a placeholder for the "AI" or "Batch" step next.
        // User asked for the BUTTON, so let's add it.

        // Simple implementation: Generate one random variation
        // In a real app, this would be `actions.generateBatchScenarios()`

        // Logic: 
        // 1. Create Tower Option
        actions.setGenerationParams({ typology: 'tower', spacing: 20, width: 18 });
        actions.runAlgoMassingGenerator(plots[0]?.id || '');
        // actions.saveDesignOption("Auto: Tower Plan"); // Disabled: User should manually save scenarios

        // 2. Create Perimeter Option
        setTimeout(() => {
            actions.setGenerationParams({ typology: 'perimeter', width: 12 });
            actions.runAlgoMassingGenerator(plots[0]?.id || '');
            // actions.saveDesignOption("Auto: Courtyard"); // Disabled: User should manually save scenarios
        }, 500);

        // 3. Create High Density Option
        setTimeout(() => {
            actions.setGenerationParams({ typology: 'lamella', spacing: 10, width: 14, orientation: 45 });
            actions.runAlgoMassingGenerator(plots[0]?.id || '');
            // actions.saveDesignOption("Auto: High Density"); // Disabled: User should manually save scenarios
        }, 1000);
    };

    return (
        <div className="flex flex-col h-full relative">

            {/* Scenarios List */}
            <ScrollArea className="h-[400px] pr-2 -mr-2">
                {designOptions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
                        <LayoutTemplate className="h-12 w-12 text-muted-foreground/50 mb-2" />
                        <h4 className="font-semibold text-muted-foreground">No Scenarios Yet</h4>
                        <p className="text-xs text-muted-foreground px-8 mb-4">
                            Generate multiple options to compare stats and layouts.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4 pb-20">
                        {designOptions.map(option => {
                            const stats = getScenarioStats(option.data.plots, efficiencyFactor, weightedAvgUnitArea);
                            return (
                                <Card key={option.id}
                                    className="group relative overflow-hidden transition-all hover:ring-2 hover:ring-primary/50 cursor-pointer border-muted"
                                    onClick={() => actions.loadDesignOption(option.id)}
                                >
                                    <div className="flex flex-row h-28">
                                        {/* Left: Thumbnail */}
                                        <div className="w-1/3 bg-muted/20 p-2 border-r flex items-center justify-center">
                                            <ScenarioThumbnail
                                                features={option.data.plots.flatMap((p: any) => p.buildings ? p.buildings.map((b: any) => b.geometry) : [])}
                                                roadFeatures={option.data.plots.flatMap((p: any) =>
                                                    (p.utilityAreas || []).filter((u: any) => u.type === 'Roads' || u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                                                )}
                                                parkingFeatures={option.data.plots.flatMap((p: any) =>
                                                    (p.parkingAreas || []).map((pa: any) => pa.geometry)
                                                )}
                                                utilityFeatures={option.data.plots.flatMap((p: any) =>
                                                    (p.utilityAreas || []).filter((u: any) => u.type !== 'Roads' && !u.name.toLowerCase().includes('road')).map((u: any) => u.geometry)
                                                )}
                                                greenFeatures={option.data.plots.flatMap((p: any) =>
                                                    (p.greenAreas || []).map((ga: any) => ga.geometry)
                                                )}
                                                plotGeometry={option.data.plots[0]?.geometry}
                                                setback={option.data.plots[0]?.setback || 0}
                                                className="w-full h-full !bg-transparent !p-0"
                                            />
                                        </div>

                                        {/* Right: Info */}
                                        <div className="w-2/3 p-3 flex flex-col justify-between">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-semibold text-sm leading-tight">{option.name}</h4>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {formatDistanceToNow(option.createdAt, { addSuffix: true })}
                                                    </span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-destructive -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        actions.deleteDesignOption(option.id);
                                                    }}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>

                                            {/* KPIs */}
                                            <div className="grid grid-cols-2 gap-2 mt-2">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase text-muted-foreground font-bold">GFA</span>
                                                    <span className="text-xs font-mono">{stats.GFA.toLocaleString()}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] uppercase text-muted-foreground font-bold">Units</span>
                                                    <span className="text-xs font-mono">{stats.Units}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>

            {/* Bottom Actions */}
            <div className="absolute bottom-0 left-0 right-0 bg-background pt-2 border-t flex flex-col gap-2">
                {isCreating ? (
                    <div className="flex gap-2 items-center animate-in slide-in-from-bottom-2 fade-in">
                        <Input
                            placeholder="Scenario Name..."
                            value={newScenarioName}
                            onChange={(e) => setNewScenarioName(e.target.value)}
                            className="h-9 text-sm"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        />
                        <Button size="sm" onClick={handleSave} disabled={!newScenarioName}>Save</Button>
                        <Button variant="ghost" size="icon" onClick={() => setIsCreating(false)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => setIsCreating(true)}>
                            <Plus className="mr-2 h-4 w-4" /> Save Current
                        </Button>
                        <Button
                            /* variant="default" */
                            className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
                            size="sm"
                            onClick={handleGenerateBatch}
                            disabled={plots.length === 0}
                        >
                            <Sparkles className="mr-2 h-3 w-3" /> Generate 3
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function ScenarioManager() {
    return (
        <Card className="w-80 shadow-xl bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 mt-4">
            <CardHeader className="pb-3 pt-4">
                <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" />
                    <span>Scenarios</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ScenarioContent />
            </CardContent>
        </Card>
    );
}
