
'use client';

import React, { useMemo, useState } from 'react';
import { VASTU_SCHEMA } from "@/lib/scoring/vastu.schema";
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
import { GREEN_SCHEMA } from '@/lib/scoring/green.schema';
import evaluateSchema, { ItemResult } from '@/lib/scoring/schema-engine';
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
    const [results, setResults] = useState<Record<string, ItemResult | undefined>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    // Use project's certification only for label — schema is always GREEN_SCHEMA
    // The project type stores certification under `greenCertification` (array). Use first entry if present.
    const certification = activeProject?.greenCertification ? activeProject.greenCertification[0] : undefined;
    const activeSchema = GREEN_SCHEMA;

    // Initialize expanded state and mandatory results whenever the active schema changes
    React.useEffect(() => {
        const expInit: Record<string, boolean> = {};
        (activeSchema.categories || []).forEach((cat: any) => {
            expInit[cat.id || cat.name || String(Math.random())] = true;
        });
        setExpanded(expInit);

        // Initialize mandatory items (including children) in results
        const initial: Record<string, ItemResult> = {};
        (activeSchema.categories || []).forEach((cat: any) => {
            (cat.items || []).forEach((item: any) => {
                if (item.mandatory) initial[item.id] = { status: 'pass' };
                if (item.children && Array.isArray(item.children)) {
                    item.children.forEach((child: any) => {
                        if (child.mandatory) initial[child.id] = { status: 'pass' };
                    });
                }
            });
        });

        setResults(initial);
    }, [activeSchema]);

    // Compute analysis from evaluateSchema using activeSchema and current results
    const analysis = useMemo(() => {
        try {
            return evaluateSchema(activeSchema as any, results as Record<string, ItemResult | undefined>);
        } catch (e) {
            console.error('evaluateSchema failed', e);
            return null as any;
        }
    }, [activeSchema, results]);

    // Debug logs to validate data flow
    React.useEffect(() => {
        console.log('CERT:', certification);
        console.log('SCHEMA:', activeSchema);
        console.log('RESULTS', results);
        console.log('ANALYSIS', analysis);
    }, [certification, activeSchema, results, analysis]);

    // Reset results when certification changes
    React.useEffect(() => {
        const initial: Record<string, ItemResult> = {};
        (activeSchema.categories || []).forEach((cat: any) => {
            (cat.items || []).forEach((item: any) => {
                if (item.mandatory) initial[item.id] = { status: 'pass' };
                if (item.children && Array.isArray(item.children)) {
                    item.children.forEach((child: any) => {
                        if (child.mandatory) initial[child.id] = { status: 'pass' };
                    });
                }
            });
        });
        setResults(initial);
    }, [certification]);

    if (!activeProject) return <div className="p-4 text-center text-muted-foreground">Select a project to view scorecard</div>;

    // If schema not available, show empty state (no fallback)
    if (!activeSchema) {
        return <div className="p-4 text-sm text-muted-foreground">No schema available for certification: {certification}</div>;
    }

    // We no longer require a created plot for schema-driven UI; render using `analysis` alone.
    if (!analysis) {
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
                            Scorecard data is not yet available.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Per strict UI rule: rely only on engine output (evaluateSchema).
    if (!analysis) return null;

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
                        {/* Removed regulation-based badges per strict engine-only UI rule */}
                    </div>
                </div>
                                <div className="mt-2">
                                                        {/* Certification label from project */}
                                                        <div className="text-sm text-muted-foreground mb-1"><strong>Certification:</strong> {certification || 'GRIHA'}</div>

                                                        {/* Header: show only overallScore / totalPoints from analysis */}
                                                        <div className="text-sm font-medium">{analysis.overallScore} / {analysis.maxScore || 100}</div>

                                        {/* Progress bar driven strictly by analysis values */}
                                        <div style={{ marginTop: 8 }}>
                                            {(() => {
                                                const percentage = analysis.maxScore > 0 ? (analysis.overallScore / analysis.maxScore) * 100 : 0;
                                                return (
                                                    <div style={{ height: '6px', width: '100%', background: '#eee', borderRadius: '4px' }}>
                                                        <div style={{ height: '6px', width: `${percentage}%`, background: '#22c55e', borderRadius: '4px' }} />
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                </div>
            </div>

            {/* Scrollable List */}
            <ScrollArea className="flex-1">
                <div className="p-4">
                    <div className="space-y-6">
                        <div className="space-y-3">
                            { (activeSchema.categories || []).map((category: any) => {
                                const catId = category.id || category.name || category.title;
                                const isExpanded = expanded[catId] !== false;
                                const catAnalysis = (analysis.categories || []).find((c: any) => c.title === category.name || c.title === category.title);

                                return (
                                    <div key={catId} className="space-y-2">
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                fontWeight: 600,
                                                marginTop: 10,
                                                cursor: 'pointer'
                                            }}
                                            onClick={() => setExpanded(prev => ({ ...prev, [catId]: !prev[catId] }))}
                                        >
                                            <span>{category.name || category.title}</span>
                                            <span style={{ textAlign: 'right' }}>{catAnalysis ? `${catAnalysis.score} / ${category.maxScore || 0}` : `0 / ${category.maxScore || 0}`}</span>
                                        </div>

                                        {isExpanded ? (
                                            <div className="rounded-lg border border-border/40 bg-secondary/10 p-3">
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    { (category.items || []).map((item: any) => {
                                                        const itemRes = results[item.id];
                                                        const isPass = !!itemRes && (itemRes.status === true || itemRes.status === 'pass');
                                                        const itemAnalysis = (analysis.categories || []).flatMap((c: any) => c.items).find((i: any) => i.id === String(item.id));

                                                        return (
                                                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', marginBottom: 6 }}>
                                                                {/* LEFT: TITLE */}
                                                                <span style={{ flex: 1 }}>{item.name || item.title}</span>

                                                                {/* CENTER-RIGHT: SCORE */}
                                                                <span style={{ width: '60px', textAlign: 'right', marginRight: 10 }}>{itemAnalysis ? `${itemAnalysis.score} / ${item.maxScore || 0}` : `0 / ${item.maxScore || 0}`}</span>

                                                                {/* RIGHT: TOGGLE */}
                                                                <div
                                                                    onClick={() => {
                                                                        const isActive = results[item.id]?.status === 'pass';
                                                                        setResults(prev => ({ ...prev, [item.id]: { status: isActive ? 'fail' : 'pass' } }));
                                                                    }}
                                                                    style={{ width: 34, height: 18, borderRadius: 20, background: results[item.id]?.status === 'pass' ? '#22c55e' : '#ccc', display: 'flex', alignItems: 'center', padding: 2, cursor: 'pointer' }}
                                                                >
                                                                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', transform: results[item.id]?.status === 'pass' ? 'translateX(16px)' : 'translateX(0px)', transition: '0.2s' }} />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Child items (if any) */}
                                                    { (category.items || []).map((item: any) => {
                                                        if (!item.children || !Array.isArray(item.children) || item.children.length === 0) return null;
                                                        return (
                                                            <div key={`${item.id}-children`} style={{ paddingLeft: 12, marginBottom: 6 }}>
                                                                {item.children.map((child: any) => {
                                                                    const childRes = results[child.id];
                                                                    const childPass = !!childRes && (childRes.status === true || childRes.status === 'pass');
                                                                    const childAnalysis = (analysis.categories || []).flatMap((c: any) => c.items).find((i: any) => i.id === String(child.id));
                                                                    return (
                                                                        <div key={child.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                                                                            <span style={{ flex: 1 }}>{child.name || child.title}</span>
                                                                            <span style={{ width: '60px', textAlign: 'right', marginRight: 10 }}>{childAnalysis ? `${childAnalysis.score} / ${child.maxScore || 0}` : `0 / ${child.maxScore || 0}`}</span>
                                                                            <div
                                                                                onClick={() => setResults(prev => ({ ...prev, [child.id]: { status: childPass ? 'fail' : 'pass' } }))}
                                                                                style={{ width: 34, height: 18, borderRadius: 20, background: results[child.id]?.status === 'pass' ? '#22c55e' : '#ccc', display: 'flex', alignItems: 'center', padding: 2, cursor: 'pointer' }}
                                                                            >
                                                                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', transform: results[child.id]?.status === 'pass' ? 'translateX(16px)' : 'translateX(0px)', transition: '0.2s' }} />
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
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



