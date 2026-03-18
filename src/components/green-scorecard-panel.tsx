
'use client';

import React, { useMemo, useState } from 'react';
import { useBuildingStore, useProjectData, useSelectedPlot } from '@/hooks/use-building-store';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { useGreenStandardChecks } from '@/hooks/use-green-standard-checks';
import { Project } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, Circle, XCircle, AlertCircle, Leaf, Wind, Sun, MapPin, Loader2, MousePointerClick, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const CREDIT_MATCH_RULES = [
    { keywords: ['ventilation', 'wind', 'air quality', 'natural ventilation', 'cross ventilation'], checkKey: 'ventilation' },
    { keywords: ['daylight', 'solar access', 'natural light'], checkKey: 'daylighting' },
    { keywords: ['landscape', 'green cover', 'vegetation', 'planting', 'tree', 'habitat', 'biodivers', 'topography'], checkKey: 'green_cover' },
    { keywords: ['open space', 'outdoor space'], checkKey: 'open_space' },
    { keywords: ['heat island', 'urban heat', 'uhie'], checkKey: 'heat_island' },
    { keywords: ['transit', 'transport', 'connectivity', 'bus', 'metro', 'bicycle', 'pedestrian', 'walkable'], checkKey: 'transit_access' },
    { keywords: ['amenity', 'proximity', 'community', 'basic service', 'social infrastructure'], checkKey: 'amenity_proximity' },
    { keywords: ['rainwater', 'rain water', 'water harvest', 'rwh', 'storm water'], checkKey: 'rainwater_harvesting' },
    { keywords: ['solar', 'photovoltaic', 'solar pv', 'on-site renewable', 'off-site renewable', 'off-site green', 'green power', 'renewable energy'], checkKey: 'solar_energy' },
    { keywords: ['stp', 'wtp', 'sewage', 'water recycl', 'water treatment', 'effluent', 'waste water', 'wastewater'], checkKey: 'water_recycling' },
    { keywords: ['waste', 'owc', 'solid waste', 'organic waste', 'compost', 'recyclable waste'], checkKey: 'waste_management' },
    { keywords: ['ev ', 'electric vehicle', 'ev charging', 'e-vehicle', 'low-emitting vehicle'], checkKey: 'ev_charging' },
    { keywords: ['parking', 'vehicle parking'], checkKey: 'parking_compliance' },
    { keywords: ['far', 'floor area ratio', 'fsi', 'fsr', 'capacity assessment', 'compact'], checkKey: 'far_compliance' },
    { keywords: ['coverage', 'ground cover', 'plot coverage'], checkKey: 'ground_coverage' },
    { keywords: ['orientation', 'building orient', 'passive architecture'], checkKey: 'building_orientation' },
    { keywords: ['depth', 'floor plate'], checkKey: 'floor_plate_depth' },
    { keywords: ['fire', 'fire safety', 'firefighting'], checkKey: 'fire_safety' },
    { keywords: ['energy efficien', 'hvac', 'cooling', 'heating', 'mechanical', 'thermal load'], checkKey: 'energy_efficiency' },
    { keywords: ['energy optimization', 'energy optim', 'energy performance', 'reduce peak'], checkKey: 'energy_optimization' },
    { keywords: ['site', 'master plan', 'site plan', 'zoning', 'sustainable design'], checkKey: 'site_planning' },
    { keywords: ['land use', 'mixed use', 'land utiliz', 'equitable development'], checkKey: 'land_use_planning' },
    { keywords: ['water efficien', 'water conserv', 'water manage', 'water meter', 'plumbing fixture'], checkKey: 'water_recycling' },
    { keywords: ['construction', 'material', 'embodied energy', 'fly ash', 'aac', 'indoor', 'iaq', 'low voc', 'tobacco', 'innovation', 'bonus', 'exceptional', 'leed ap', 'igbc accredited', 'housing typolog', 'employment', 'social', 'cultural', 'tenant', 'commissioning', 'process', 'operation and maintenance', 'green education', 'no smoking', 'refrigerant', 'odp', 'gwp', 'ozone', 'light pollution', 'soil erosion', 'topsoil', 'site disturbance', 'green building', 'decarbonization', 'health', 'wellbeing', 'universal design', 'differently abled', 'measurement', 'smart metering', 'local regulation', 'contaminated', 'fruit', 'vegetable', 'recycled content', 'local material', 'carbon footprint', 'carbon assessment', 'natural resource', 'non-motorized', 'community engagement', 'visual comfort', 'acoustic', 'air pollution', 'sanitation', 'accessibility', 'dedicated facilities', 'positive social', 'life cycle', 'green procurement', 'structural design', 'eco-friendly', 'wood', 'certified green', 'demolition', 'exterior', 'outdoor view', 'pollutant', 'low-emitting material', 'occupant', 'resilient', 'green lease', 'project priorities', 'electrification', 'grid interactive', 'road', 'street network'], checkKey: 'manual_tracking' },
];


/** Extract a clean label like "GRIHA v6.0" from raw strings like "griha-griha-version-6.0" */
function getStandardLabel(raw: string | undefined): string {
    if (!raw) return 'Generic';
    const lower = raw.toLowerCase();
    const STANDARDS: Record<string, string> = {
        'igbc': 'IGBC',
        'griha': 'GRIHA',
        'leed': 'LEED',
        'well': 'WELL',
        'breeam': 'BREEAM',
        'edge': 'EDGE',
    };
    let label = 'Generic';
    for (const [key, name] of Object.entries(STANDARDS)) {
        if (lower.includes(key)) { label = name; break; }
    }
    // Extract version number if present e.g. "6.0", "2.0", "v4"
    const vMatch = raw.match(/(\d+\.\d+|\d+)(?:[^a-zA-Z]|$)/);
    if (vMatch) label += ` v${vMatch[1]}`;
    return label;
}

/** Return the canonical standard short name without version (used for UI display) */
function getStandardName(raw: string | undefined): string {
    if (!raw) return 'Generic';
    const lower = raw.toLowerCase();
    const STANDARDS: Record<string, string> = {
        'igbc': 'IGBC',
        'griha': 'GRIHA',
        'leed': 'LEED',
        'well': 'WELL',
        'breeam': 'BREEAM',
        'edge': 'EDGE',
    };
    for (const [key, name] of Object.entries(STANDARDS)) {
        if (lower.includes(key)) return name;
    }
    // fallback: return the raw string (trimmed)
    return String(raw).split(' ')[0];
}

export function GreenScorecardPanel() {
    const activeProject = useProjectData();
    const { regulations, isLoading } = useGreenRegulations(activeProject as unknown as Project);

    const creditStatusMap = useGreenStandardChecks(activeProject, activeProject?.simulationResults);
    const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});

    const scorecardDataList = useMemo(() => {
        if (!regulations?.length) return [];

        return regulations.map((regulation) => {
        if (!regulation?.categories?.length) return null;

        let totalPoints = 0;
        let achievedPoints = 0;

        const categories = regulation.categories.map((cat: any, catIdx: number) => {
            const credits = (cat.credits || []).map((credit: any, creditIdx: number) => {
                const maxPoints = credit.points || 0;
                let status: 'pending' | 'achieved' | 'failed' = 'pending';
                let score = 0;
                let isAuto = false;
                let isManualOnly = false;
                let dataKey = '';
                // Use category+index as fallback to handle duplicate credit names (e.g., 4x Innovation in Design)
                const overrideKey = credit.code || `${catIdx}-${creditIdx}-${credit.name}`;

                const nameLower = credit.name.toLowerCase();
                
                // Find matching rule
                const matchedRule = CREDIT_MATCH_RULES.find(rule => 
                    rule.keywords.some(kw => nameLower.includes(kw))
                );

                const isPrerequisite = credit.type === 'mandatory' || credit.type === 'prerequisite' || maxPoints === 0;

                if (matchedRule) {
                    if (matchedRule.checkKey === 'manual_tracking') {
                        isManualOnly = true;
                    } else if (matchedRule.checkKey === 'heat_island') {
                        if (creditStatusMap['ventilation']?.status === 'achieved' && creditStatusMap['green_cover']?.status === 'achieved') {
                            status = 'achieved';
                            score = maxPoints;
                            isAuto = true;
                            dataKey = matchedRule.checkKey;
                        }
                    } else if (matchedRule.checkKey === 'energy_optimization') {
                        // Energy optimization proven by good daylighting OR ventilation simulation
                        if (creditStatusMap['ventilation']?.status === 'achieved' || creditStatusMap['daylighting']?.status === 'achieved') {
                            status = 'achieved';
                            score = maxPoints;
                            isAuto = true;
                            dataKey = 'energy_optimization';
                        }
                    } else {
                        const engineStatus = creditStatusMap[matchedRule.checkKey];
                        if (engineStatus) {
                            status = engineStatus.status;
                            if (status === 'achieved') score = maxPoints;
                            isAuto = true;
                            dataKey = matchedRule.checkKey;
                        }
                    }
                } else {
                    isManualOnly = true;
                }

                if (isPrerequisite && !isAuto && !isManualOnly) {
                    isManualOnly = true;
                }

                // Final override: user toggle always takes precedence
                if (overrideKey in manualOverrides) {
                    if (manualOverrides[overrideKey]) {
                        status = 'achieved';
                        score = maxPoints;
                    } else {
                        status = 'pending';
                        score = 0;
                    }
                }

                totalPoints += maxPoints;
                achievedPoints += score;

                return { 
                    ...credit, 
                    status, 
                    score, 
                    maxPoints, 
                    isAuto, 
                    isManualOnly, 
                    dataKey,
                    overrideKey
                };
            });

            return { ...cat, credits };
        });

        return {
            id: regulation.id || regulation.certificationType,
            certificationType: regulation.certificationType,
            label: getStandardLabel(regulation.name || regulation.certificationType),
            categories,
            totalPoints,
            achievedPoints,
            ratingBands: regulation.ratingBands || [],
        };
        }).filter(Boolean) as Array<{
            id: string;
            certificationType: string;
            label: string;
            categories: any[];
            totalPoints: number;
            achievedPoints: number;
            ratingBands: { label: string; minPoints: number; maxPoints?: number }[];
        }>;
    }, [regulations, creditStatusMap, manualOverrides]);

    // UI-only: pick the first scorecard per certification for display purposes.
    // This does not mutate the underlying data; it only controls what is rendered.
    const visibleScorecards = useMemo(() => {
        const seen = new Set<string>();
        const res: typeof scorecardDataList = [] as any;
        for (const sc of scorecardDataList) {
            const key = getStandardName(sc.certificationType || sc.label || sc.id).toUpperCase();
            if (!seen.has(key)) {
                seen.add(key);
                res.push(sc);
            }
        }
        return res;
    }, [scorecardDataList]);

    const handleToggleManual = (overrideKey: string) => {
        setManualOverrides(prev => ({
            ...prev,
            [overrideKey]: !prev[overrideKey]
        }));
    };

    const plots = useBuildingStore(state => state.plots);
    const isPlotCreated = plots.length > 0;

    if (!activeProject) return <div className="p-4 text-center text-muted-foreground">Select a project to view scorecard</div>;

    if (!isPlotCreated) {
        return (
            <div className="flex flex-col h-full">
                <div className="px-3 py-2 border-b shrink-0">
                    <h2 className="text-xs font-semibold flex items-center gap-1.5">
                        <Leaf className="h-3.5 w-3.5 text-green-500" />
                        Green Scorecard
                    </h2>
                </div>
                <div className="flex-1 flex items-center justify-center p-6 text-center bg-muted/5">
                    <div className="space-y-2 flex flex-col items-center">
                        <div className="h-10 w-10 rounded-full bg-muted/20 flex items-center justify-center">
                            <MousePointerClick className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground max-w-[200px]">
                            Create a plot on the map to start tracking your green score.
                        </p>
                    </div>
                </div>
            </div>
        );
    }


    if (isLoading && scorecardDataList.length === 0) return (
        <div className="p-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading Green Regulations...
        </div>
    );
    if (scorecardDataList.length === 0) return <div className="p-4 text-center text-muted-foreground">No Green Regulation data found for this project.</div>;

    return (
        <div className="h-full flex flex-col w-full max-h-[calc(100vh-200px)]">
            {/* Header */}
            <div className="px-3 py-2 border-b shrink-0">
                    <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold flex items-center gap-1.5">
                        <Leaf className="h-3.5 w-3.5 text-green-500" />
                        Green Scorecard
                        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </h2>
                    <div className="flex gap-2 flex-wrap items-center justify-end">
                        {visibleScorecards.map((scorecard) => (
                            <Badge key={scorecard.id} variant="outline">{getStandardName(scorecard.certificationType || scorecard.label)}</Badge>
                        ))}
                    </div>
                </div>
                <div className="mt-2 space-y-2">
                    {visibleScorecards.map((scorecard) => {
                        const percentage = scorecard.totalPoints > 0 ? (scorecard.achievedPoints / scorecard.totalPoints) * 100 : 0;
                        const achievedBand = scorecard.ratingBands.find((band) =>
                            scorecard.achievedPoints >= band.minPoints &&
                            (band.maxPoints === undefined || scorecard.achievedPoints <= band.maxPoints)
                        );

                        return (
                            <div key={scorecard.id} className="space-y-1">
                                <div className="flex justify-between text-sm font-medium">
                                    <span>{getStandardName(scorecard.certificationType || scorecard.label)}: {scorecard.achievedPoints} / {scorecard.totalPoints}</span>
                                    <span>{percentage.toFixed(0)}%</span>
                                </div>
                                <Progress value={percentage} className="h-2" />
                                {achievedBand && (
                                    <div className="text-[11px] text-muted-foreground">
                                        Rating: {achievedBand.label}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Scrollable List */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    <div className="space-y-6">
                        {visibleScorecards.map((scorecard) => (
                            <div key={scorecard.id} className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-semibold">{getStandardName(scorecard.certificationType || scorecard.label)}</h3>
                                    <span className="text-xs text-muted-foreground">{scorecard.achievedPoints} / {scorecard.totalPoints}</span>
                                </div>
                                <Accordion type="multiple" defaultValue={scorecard.categories.map((c: any) => `${scorecard.id}-${c.name}`)} className="space-y-4">
                                    {scorecard.categories.map((cat: any, idx: number) => (
                                        <AccordionItem value={`${scorecard.id}-${cat.name}`} key={`${scorecard.id}-${idx}`} className="border rounded-lg px-3 bg-secondary/10">
                                            <AccordionTrigger className="hover:no-underline py-3">
                                                <div className="flex items-center gap-2 text-sm font-semibold">
                                                    {cat.name.includes("Location") ? <MapPin className="h-4 w-4 text-orange-500" /> :
                                                        cat.name.includes("Energy") ? <Sun className="h-4 w-4 text-yellow-500" /> :
                                                            cat.name.includes("Water") ? <Wind className="h-4 w-4 text-blue-500" /> :
                                                                <Circle className="h-3 w-3 text-muted-foreground" />}
                                                    {cat.name}
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="pb-3">
                                                <div className="space-y-1">
                                                    {cat.credits.map((credit: any, cIdx: number) => (
                                                        <div key={cIdx} className="flex items-center gap-2 p-2 rounded-md hover:bg-secondary/20 transition-colors group">
                                                            <div className="shrink-0">
                                                                {credit.status === 'achieved' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> :
                                                                    credit.status === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> :
                                                                        <Circle className="h-4 w-4 text-muted-foreground/30" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <span className={cn(
                                                                    "text-sm font-medium leading-tight",
                                                                    credit.status === 'achieved' && "text-green-700 dark:text-green-400"
                                                                )}>
                                                                    {credit.name}
                                                                </span>
                                                                {credit.isAuto && !credit.isManualOnly && (
                                                                    <span className="text-[10px] text-muted-foreground ml-1.5">
                                                                        {credit.dataKey === 'standard' ? '· Standard' :
                                                                         credit.dataKey === 'ventilation' || credit.dataKey === 'daylighting' || credit.dataKey === 'energy_optimization' ? '· Simulation' :
                                                                         credit.dataKey === 'transit' || credit.dataKey === 'amenity' ? '· Proximity' :
                                                                         ['green_cover', 'open_space', 'site_planning', 'land_use_planning'].includes(credit.dataKey) ? '· Plot Data' :
                                                                         ['far_compliance', 'ground_coverage', 'parking_compliance'].includes(credit.dataKey) ? '· KPIs' :
                                                                         ['rainwater_harvesting', 'solar_energy', 'water_recycling', 'waste_management', 'ev_charging', 'fire_safety', 'energy_efficiency'].includes(credit.dataKey) ? '· Utilities' : ''}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-xs font-mono text-muted-foreground">
                                                                    {credit.score}/{credit.maxPoints}
                                                                </span>
                                                                <Switch
                                                                    checked={credit.status === 'achieved'}
                                                                    onCheckedChange={() => handleToggleManual(credit.overrideKey)}
                                                                    className="scale-[0.6] origin-right"
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </div>
                        ))}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}

function Sparkles4Icon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9" />
            <path d="M10 14l2-2 2 2" />
        </svg>
    )
}
