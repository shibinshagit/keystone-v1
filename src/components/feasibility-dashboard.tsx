
'use client';
import React, { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useSelectedBuilding, useProjectData, useBuildingStore } from '@/hooks/use-building-store';
import { AreaChart, Scale, Building, Car, CheckCircle, AlertTriangle, ShieldCheck, DollarSign, LocateFixed, ChevronUp, ChevronDown, Compass, DoorOpen, Clock, TrendingUp, BarChart2 } from 'lucide-react';
import { useDevelopmentMetrics } from '@/hooks/use-development-metrics';
import { useRegulations } from '@/hooks/use-regulations';
import { useProjectEstimates } from '@/hooks/use-project-estimates';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { generateVastuGates } from '@/lib/vastu-gate-generator';
import * as turf from '@turf/turf';

function MetricsTab() {
    const building = useSelectedBuilding();
    const activeProject = useProjectData();
    const metrics = useDevelopmentMetrics(activeProject || null);

    if (!activeProject || !metrics) return <div className="p-4 text-center text-muted-foreground">No metrics available</div>;

    const kpis = [
        { icon: AreaChart, label: "Plot Area", value: metrics.totalPlotArea.toLocaleString(), unit: "sqm" },
        { icon: AreaChart, label: "Built-up Area", value: metrics.totalBuiltUpArea.toLocaleString(), unit: "sqm" },
        { icon: Scale, label: "Achieved FAR", value: metrics.achievedFAR.toFixed(2) },
        { icon: Building, label: "Units", value: metrics.totalUnits.toString() },
        { icon: Car, label: "Parking", value: `${metrics.parking.provided} / ${metrics.parking.required}` },
        { icon: Scale, label: "Efficiency", value: (metrics.efficiency * 100).toFixed(0), unit: "%" },
    ];
    return (
        <div className="grid grid-cols-2 gap-4">
            {kpis.map(kpi => (
                <Card key={kpi.label} className="bg-secondary/50">
                    <CardHeader className="p-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <kpi.icon className="h-4 w-4 text-primary" /> {kpi.label}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <span className="text-2xl font-bold">{kpi.value}</span>
                        {kpi.unit && <span className="text-sm text-muted-foreground ml-1">{kpi.unit}</span>}
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

// ─── COST SIMULATOR ──────────────────────────────────────────────────────────
interface SimulatorTabProps {
    estimates: any | null;
    isLoading: boolean;
}
function CostSimulatorTab({ estimates, isLoading }: SimulatorTabProps) {
    if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">Calculating cost simulation...</div>;
    if (!estimates) return <div className="p-6 text-center text-sm text-muted-foreground">Configure Admin Parameters to run cost simulation</div>;

    const bd = estimates.cost_breakdown;
    const totalCost = estimates.total_construction_cost;
    const totalRev = estimates.total_revenue;
    const profit = estimates.potential_profit;
    const roi = estimates.roi_percentage;

    const costCategories = [
        { label: 'Earthwork', value: bd.earthwork, color: '#f59e0b' },
        { label: 'Structure', value: bd.structure, color: '#3b82f6' },
        { label: 'Finishing', value: bd.finishing, color: '#8b5cf6' },
        { label: 'Services', value: bd.services, color: '#10b981' },
        { label: 'Contingency', value: bd.contingency, color: '#ef4444' },
    ];

    const totalParts = costCategories.reduce((s, c) => s + c.value, 0) || 1;

    // Build cumulative S-curve data (12-month construction spend, typical S-curve shape)
    const totalMonths = Math.max(6, Math.round(estimates.timeline?.total_months || 12));
    const sCurve: number[] = [];
    for (let m = 1; m <= totalMonths; m++) {
        const t = m / totalMonths; // 0-1
        // S-curve: logistic-ish ramp (slow start, fast middle, slow end)
        const spend = totalCost / (1 + Math.exp(-10 * (t - 0.5)));
        sCurve.push(spend);
    }
    const maxSpend = sCurve[sCurve.length - 1] || 1;

    const svgW = 280, svgH = 80;
    const points = sCurve.map((v, i) =>
        `${(i / (sCurve.length - 1)) * svgW},${svgH - (v / maxSpend) * (svgH - 6) - 2}`
    ).join(' ');
    // Revenue line — flat line once construction done (only appears at handover)
    const revY = svgH - (totalRev / maxSpend) * (svgH - 6) - 2;
    const revLineY = Math.max(2, revY);

    return (
        <div className="space-y-4 pb-4">

            {/* Summary Hero */}
            <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-lg border bg-slate-500/10 border-slate-500/20 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Cost</div>
                    <div className="text-base font-bold">{(totalCost / 10000000).toFixed(1)} Cr</div>
                </div>
                <div className="p-2.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Revenue</div>
                    <div className="text-base font-bold text-emerald-400">{(totalRev / 10000000).toFixed(1)} Cr</div>
                </div>
                <div className={cn("p-2.5 rounded-lg border text-center", profit > 0 ? "bg-blue-500/10 border-blue-500/20" : "bg-red-500/10 border-red-500/20")}>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">ROI</div>
                    <div className={cn("text-base font-bold", profit > 0 ? "text-blue-400" : "text-red-400")}>{roi.toFixed(1)}%</div>
                </div>
            </div>

            {/* Cost Breakdown Bar */}
            <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Cost Breakdown</div>
                {/* Stacked bar */}
                <div className="flex h-3 rounded-full overflow-hidden gap-[1px] mb-2">
                    {costCategories.map(c => (
                        <div
                            key={c.label}
                            className="transition-all duration-700"
                            style={{ width: `${(c.value / totalParts) * 100}%`, backgroundColor: c.color }}
                            title={`${c.label}: ₹${(c.value / 10000000).toFixed(2)} Cr`}
                        />
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                    {costCategories.map(c => (
                        <div key={c.label} className="flex items-center gap-1.5 text-[10px]">
                            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: c.color }} />
                            <span className="text-muted-foreground">{c.label}</span>
                            <span className="ml-auto font-medium">{(c.value / 10000000).toFixed(2)} Cr</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Cash-Flow S-Curve Chart */}
            <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
                <div className="flex items-center gap-1 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Construction Cash-Flow</span>
                    <span className="ml-auto text-[9px] text-muted-foreground">{totalMonths} months</span>
                </div>
                <svg width="100%" height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {/* Cost S-curve area */}
                    <polygon points={`0,${svgH} ${points} ${svgW},${svgH}`} fill="url(#costGrad)" />
                    <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    {/* Revenue horizontal line (at project end) */}
                    <line x1={0} y1={revLineY} x2={svgW} y2={revLineY} stroke="#10b981" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.7" />
                    {/* Labels */}
                    <text x="2" y={svgH - 3} fontSize="7" fill="#6b7280">Start</text>
                    <text x={svgW - 20} y={svgH - 3} fontSize="7" fill="#6b7280">End</text>
                    <text x="3" y={revLineY - 2} fontSize="7" fill="#10b981">Rev.</text>
                </svg>
                <div className="flex gap-3 mt-1">
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <div className="w-4 h-0.5 bg-blue-400 rounded" />
                        <span>Cumulative Cost</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <div className="w-4 h-0.5 bg-emerald-400 rounded opacity-70 border-dashed border-t border-emerald-400" />
                        <span>Revenue Line</span>
                    </div>
                </div>
            </div>

            {/* Per-Building Table */}
            {estimates.breakdown && estimates.breakdown.length > 0 && (
                <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
                    <div className="flex items-center gap-1.5 mb-2">
                        <Building className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Per-Building Cost</span>
                    </div>
                    <div className="space-y-1.5">
                        {estimates.breakdown.map((b: any, i: number) => {
                            const pct = (b.cost.total / totalCost) * 100;
                            return (
                                <div key={i} className="text-[10px]">
                                    <div className="flex justify-between mb-0.5">
                                        <span className="text-muted-foreground truncate mr-2">{b.buildingName}</span>
                                        <span className="font-semibold shrink-0">{(b.cost.total / 10000000).toFixed(2)} Cr</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                                        <div className="h-full rounded-full bg-blue-400/70 transition-all duration-700" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── TIME SIMULATOR ───────────────────────────────────────────────────────────
function TimeSimulatorTab({ estimates, isLoading }: SimulatorTabProps) {
    if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">Calculating time simulation...</div>;
    if (!estimates) return <div className="p-6 text-center text-sm text-muted-foreground">Configure Admin Parameters to run time simulation</div>;

    const phases = estimates.timeline?.phases;
    const totalMonths = estimates.timeline?.total_months || 0;

    const ganttPhases = [
        { label: 'Excavation', value: phases?.excavation || 0, color: '#f59e0b', startOffset: 0 },
        { label: 'Foundation', value: phases?.foundation || 0, color: '#ef4444', startOffset: phases?.excavation || 0 },
        { label: 'Structure', value: phases?.structure || 0, color: '#3b82f6', startOffset: (phases?.excavation || 0) + (phases?.foundation || 0) },
        { label: 'Finishing', value: phases?.finishing || 0, color: '#8b5cf6', startOffset: (phases?.excavation || 0) + (phases?.foundation || 0) + (phases?.structure || 0) },
        { label: 'Contingency', value: phases?.contingency || 0, color: '#6b7280', startOffset: totalMonths - (phases?.contingency || 0) },
    ].filter(p => p.value > 0);

    // Building timelines
    const maxBuildingMonths = estimates.breakdown?.reduce((m: number, b: any) => Math.max(m, b.timeline.total), 0) || totalMonths;

    return (
        <div className="space-y-4 pb-4">

            {/* Summary */}
            <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg border bg-blue-500/10 border-blue-500/20 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Total Duration</div>
                    <div className="text-xl font-bold text-blue-400">{totalMonths.toFixed(1)}</div>
                    <div className="text-[9px] text-muted-foreground">months (Critical Path)</div>
                </div>
                <div className="p-2.5 rounded-lg border bg-purple-500/10 border-purple-500/20 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Efficiency</div>
                    <div className={cn("text-xl font-bold",
                        estimates.efficiency_metrics.status === 'Optimal' ? "text-green-400" :
                            estimates.efficiency_metrics.status === 'Inefficient' ? "text-red-400" : "text-yellow-400"
                    )}>
                        {((estimates.efficiency_metrics?.achieved || 0) * 100).toFixed(0)}%
                    </div>
                    <div className="text-[9px] text-muted-foreground">{estimates.efficiency_metrics.status}</div>
                </div>
            </div>

            {/* Gantt Phase Bars */}
            <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
                <div className="flex items-center gap-1 mb-3">
                    <BarChart2 className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Phase Timeline (Gantt)</span>
                </div>
                <div className="space-y-2">
                    {ganttPhases.map((phase, i) => {
                        const leftPct = (phase.startOffset / totalMonths) * 100;
                        const widthPct = (phase.value / totalMonths) * 100;
                        return (
                            <div key={i} className="flex items-center gap-2">
                                <div className="text-[9px] text-muted-foreground w-16 shrink-0 text-right">{phase.label}</div>
                                <div className="flex-1 h-4 bg-secondary/40 rounded-full relative overflow-hidden">
                                    <div
                                        className="absolute top-0 h-full rounded-full transition-all duration-700 flex items-center px-1"
                                        style={{
                                            left: `${leftPct}%`,
                                            width: `${widthPct}%`,
                                            backgroundColor: phase.color,
                                            opacity: 0.85
                                        }}
                                    />
                                </div>
                                <div className="text-[9px] font-medium w-10 shrink-0">{phase.value.toFixed(1)}mo</div>
                            </div>
                        );
                    })}
                </div>
                {/* Month scale */}
                <div className="mt-2 ml-[70px] flex justify-between pr-10">
                    {Array.from({ length: 5 }, (_, i) => (
                        <span key={i} className="text-[8px] text-muted-foreground">
                            {((i / 4) * totalMonths).toFixed(0)}m
                        </span>
                    ))}
                </div>
            </div>

            {/* Per-Building Timeline */}
            {estimates.breakdown && estimates.breakdown.length > 0 && (
                <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
                    <div className="flex items-center gap-1.5 mb-2">
                        <Building className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Per-Building Timeline</span>
                    </div>
                    <div className="space-y-2">
                        {estimates.breakdown.map((b: any, i: number) => {
                            const pct = (b.timeline.total / maxBuildingMonths) * 100;
                            const structPct = (b.timeline.structure / b.timeline.total) * pct;
                            const finPct = (b.timeline.finishing / b.timeline.total) * pct;
                            return (
                                <div key={i} className="text-[10px]">
                                    <div className="flex justify-between mb-0.5">
                                        <span className="text-muted-foreground truncate mr-2">{b.buildingName}</span>
                                        <span className="font-semibold shrink-0">{b.timeline.total.toFixed(1)} mo</span>
                                    </div>
                                    {/* Segmented bar: foundation (amber) + structure (blue) + finishing (purple) */}
                                    <div className="h-2 rounded-full bg-secondary/40 overflow-hidden flex">
                                        <div className="h-full bg-amber-400/70 transition-all duration-700" style={{ width: `${pct - structPct - finPct}%` }} />
                                        <div className="h-full bg-blue-400/70 transition-all duration-700" style={{ width: `${structPct}%` }} />
                                        <div className="h-full bg-purple-400/70 transition-all duration-700" style={{ width: `${finPct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex gap-3 mt-2">
                        {[['#f59e0b', 'Sub/Foundation'], ['#3b82f6', 'Structure'], ['#8b5cf6', 'Finishing']].map(([c, l]) => (
                            <div key={l as string} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: c as string, opacity: 0.7 }} />
                                <span>{l}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}


function FeasibilityTab() {
    const activeProject = useProjectData();

    const metrics = useDevelopmentMetrics(activeProject);
    const { regulations, greenStandards, vastuRules } = useRegulations(activeProject);

    const uiState = useBuildingStore(state => state.uiState);
    const toggleVastuCompass = useBuildingStore(state => state.actions.toggleVastuCompass);
    const plots = useBuildingStore(state => state.plots);
    const actions = useBuildingStore(state => state.actions);
    const [isGeneratingGates, setIsGeneratingGates] = useState(false);
    const [gatesGenerated, setGatesGenerated] = useState(false);

    const handleSuggestVastuGates = () => {
        if (!plots || plots.length === 0) return;
        setIsGeneratingGates(true);
        try {
            plots.forEach(plot => {
                if (!plot.geometry) return;
                const bbox = turf.bbox(plot.geometry);
                const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
                const newGates = generateVastuGates(plot.geometry, center, plot.roadAccessSides || []);
                if (newGates.length > 0) {
                    // Remove existing auto-generated gates (standard and Vastu), keep manual ones
                    const existingEntries = (plot.entries || []).filter(e => !e.name?.toLowerCase().includes('gate'));
                    actions.updatePlot(plot.id, { entries: [...existingEntries, ...newGates] });
                }
            });
            setGatesGenerated(true);
        } finally {
            setIsGeneratingGates(false);
        }
    };

    const { estimates, isLoading: isLoadingEstimates } = useProjectEstimates(activeProject, metrics);



    if (!metrics) return <div className="p-4 text-center text-muted-foreground">Calculations pending...</div>;

    // Extract dynamic limits from regulations
    const maxFAR = regulations?.geometry?.floor_area_ratio?.value || activeProject?.feasibilityParams?.efficiencyTarget || 2.5;
    const minGreenCover = greenStandards?.constraints?.minGreenCover ? greenStandards.constraints.minGreenCover * 100 : 15;
    const minOpenSpace = greenStandards?.constraints?.minOpenSpace ? greenStandards.constraints.minOpenSpace * 100 : 30;
    const maxHeight = regulations?.geometry?.max_height?.value;
    const maxCoverage = regulations?.geometry?.max_ground_coverage?.value;

    const complianceCards = [
        {
            label: "Bylaw Compliance",
            score: metrics.compliance.bylaws,
            icon: ShieldCheck,
            items: [
                {
                    label: `FAR Check (≤${maxFAR})`,
                    status: metrics.achievedFAR <= maxFAR ? 'pass' : 'fail',
                    detail: `${metrics.achievedFAR.toFixed(2)} / ${maxFAR}`
                },
                {
                    label: maxHeight ? `Height Limit (≤${maxHeight}m)` : "Height Limit",
                    status: 'pass'
                },
                ...(maxCoverage ? [{
                    label: `Coverage (≤${maxCoverage}%)`,
                    status: 'pass'
                }] : [])
            ]
        },
        {
            label: activeProject?.greenCertification?.[0] ? `Green Building (${activeProject.greenCertification[0]})` : "Green Building",
            score: metrics.compliance.green,
            icon: CheckCircle,
            items: [
                {
                    label: `Green Cover (≥${minGreenCover.toFixed(0)}%)`,
                    status: metrics.greenArea.percentage >= minGreenCover ? 'pass' : 'fail',
                    detail: `${metrics.greenArea.percentage.toFixed(1)}%`
                },
                {
                    label: `Open Space (≥${minOpenSpace.toFixed(0)}%)`,
                    status: metrics.openSpace / metrics.totalPlotArea >= (minOpenSpace / 100) ? 'pass' : 'warn',
                    detail: `${((metrics.openSpace / metrics.totalPlotArea) * 100).toFixed(1)}%`
                },
            ]
        },
        ...(activeProject?.vastuCompliant ? [{
            label: "Vastu (Shakti Chakra)",
            score: metrics.compliance.vastu,
            icon: Compass,
            items: [
                { label: "Brahmasthan Open", status: 'pass' },
                { label: "Service Placement", status: metrics.compliance.vastu > 80 ? 'pass' : 'warn' },
            ],
            // Special Control for Vastu
            control: (
                <div className="space-y-2 mt-2 pt-2 border-t border-border/50">
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="vastu-compass"
                            checked={uiState.showVastuCompass}
                            onCheckedChange={toggleVastuCompass}
                        />
                        <Label htmlFor="vastu-compass" className="text-xs">Show Shakti Chakra Overlay</Label>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                        onClick={handleSuggestVastuGates}
                        disabled={isGeneratingGates}
                    >
                        <DoorOpen className="h-3.5 w-3.5" />
                        {gatesGenerated ? '✓ Vastu Gates Applied' : 'Suggest Vastu Gates (N3/N4, E3/E4, S3/S4, W3/W4)'}
                    </Button>
                    {gatesGenerated && (
                        <p className="text-xs text-muted-foreground text-center">
                            Gates placed at N3/N4, E3/E4, S3/S4, W3/W4 boundaries
                        </p>
                    )}
                </div>
            )
        }] : []),
        ...((metrics as any).greenAnalysis ? [{
            label: "Green Simulation (Beta)",
            score: (metrics as any).greenAnalysis.overall,
            icon: CheckCircle,
            items: (metrics as any).greenAnalysis.breakdown.map((b: any) => ({
                label: b.category,
                status: b.score > 70 ? 'pass' : b.score > 40 ? 'warn' : 'fail',
                detail: b.feedback
            }))
        }] : [])
    ];

    const getTrafficLight = (score: number) => {
        if (score >= 80) return "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]";
        if (score >= 50) return "bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.6)]";
        return "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]";
    };

    const getStatusIcon = (status: string) => {
        if (status === 'pass') return <CheckCircle className="h-3 w-3 text-green-500" />;
        if (status === 'fail') return <AlertTriangle className="h-3 w-3 text-red-500" />;
        return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
    };

    return (
        <div className="space-y-4 pb-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-secondary/30 rounded border text-center">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Green Cover</div>
                    <div className="font-bold text-xl text-green-600">{metrics.greenArea.percentage.toFixed(1)}%</div>
                </div>
                <div className="p-3 bg-secondary/30 rounded border text-center">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Road Area</div>
                    <div className="font-bold text-xl text-slate-500">{(metrics.roadArea / Math.max(1, metrics.totalPlotArea) * 100).toFixed(1)}%</div>
                </div>
            </div>

            <div className="space-y-3">
                {complianceCards.map((card, idx) => (
                    <Card key={idx} className="bg-secondary/20 border-border/50">
                        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <card.icon className="h-4 w-4" /> {card.label}
                            </CardTitle>
                            <div className={`h-3 w-3 rounded-full ${getTrafficLight(card.score)}`} />
                        </CardHeader>
                        <CardContent className="p-3 pt-0">
                            <div className="flex items-end gap-2 mb-2">
                                <span className="text-2xl font-bold">{card.score}</span>
                                <span className="text-xs text-muted-foreground mb-1">/ 100</span>
                            </div>
                            <div className="space-y-1">
                                {card.items.map((item: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground">{item.label}</span>
                                        {getStatusIcon(item.status)}
                                    </div>
                                ))}
                            </div>
                            {card.control}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Project Estimates Section */}
            {estimates ? (
                <div className="space-y-3">
                    <div className="rounded-lg border p-3 bg-slate-50/5 border-slate-200/20">
                        <div className="flex items-center gap-2 mb-3">
                            <DollarSign className="h-4 w-4 text-emerald-400" />
                            <span className="text-sm font-semibold">Financial Estimates {estimates.isPotential && "(Potential)"}</span>
                            <Badge variant={(estimates.roi_percentage || 0) > 15 ? 'default' : 'secondary'} className="ml-auto text-xs">
                                ROI: {(estimates.roi_percentage || 0).toFixed(1)}%
                            </Badge>
                        </div>
                        {estimates.isPotential && (
                            <div className="text-[10px] text-amber-500 mb-2 flex items-center gap-1 justify-center bg-amber-500/10 p-1 rounded">
                                <AlertTriangle className="h-3 w-3" /> Based on Max Potential (No Design)
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase">Construction Cost</div>
                                <div className="text-lg font-bold">
                                    {((estimates.total_construction_cost || 0) / 10000000).toFixed(2)} Cr
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    {metrics?.totalBuiltUpArea ? `₹${(estimates.total_construction_cost / metrics.totalBuiltUpArea).toFixed(0)}/sqm` : 'N/A'}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase">Potential Revenue</div>
                                <div className="text-lg font-bold text-emerald-500">
                                    {((estimates.total_revenue || 0) / 10000000).toFixed(2)} Cr
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                    Profit: ~{((estimates.potential_profit || 0) / 10000000).toFixed(2)} Cr
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border p-3 bg-blue-50/5 border-blue-200/20">
                        <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="h-4 w-4 text-blue-400" />
                            <span className="text-sm font-semibold">Timeline & Efficiency</span>
                            <Badge variant="outline" className="ml-auto text-xs">
                                {(estimates.timeline?.total_months || 0).toFixed(1)} Months
                            </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Substructure:</span>
                                <span>{((estimates.timeline?.phases?.excavation || 0) + (estimates.timeline?.phases?.foundation || 0)).toFixed(1)} mo</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Structure:</span>
                                <span>{(estimates.timeline?.phases?.structure || 0).toFixed(1)} mo</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Finishing:</span>
                                <span>{(estimates.timeline?.phases?.finishing || 0).toFixed(1)} mo</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Overlap w/ Services:</span>
                                <span className="text-amber-500">- {((
                                    (estimates.timeline?.phases?.excavation || 0) + 
                                    (estimates.timeline?.phases?.foundation || 0) + 
                                    (estimates.timeline?.phases?.structure || 0) + 
                                    (estimates.timeline?.phases?.finishing || 0) +
                                    (estimates.cost_breakdown?.contingency ? 2 : 2) // Assuming 2mo contingency
                                ) - (estimates.timeline?.total_months || 0)).toFixed(1)} mo</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Contingency:</span>
                                <span>2.0 mo</span>
                            </div>
                            <div className="pt-2 col-span-2 border-t border-border/10 flex justify-between items-center">
                                <span className="text-muted-foreground">Efficiency Target:</span>
                                <div>
                                    <span className={cn(
                                        "font-bold",
                                        estimates.efficiency_metrics.status === 'Optimal' ? "text-green-500" :
                                            estimates.efficiency_metrics.status === 'Inefficient' ? "text-red-500" : "text-yellow-500"
                                    )}>
                                        {((estimates.efficiency_metrics?.achieved || 0) * 100).toFixed(0)}%
                                    </span>
                                    <span className="text-muted-foreground ml-1">
                                        / {((estimates.efficiency_metrics?.target || 0) * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Per-Building Breakdown */}
                    {estimates.breakdown && estimates.breakdown.length > 0 && (
                        <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
                            <div className="flex items-center gap-2 mb-2">
                                <Building className="h-4 w-4 text-primary" />
                                <span className="text-sm font-semibold">Building Breakdown</span>
                            </div>
                            <div className="space-y-2 max-h-[150px] overflow-y-auto scrollbar-thin pr-1">
                                {estimates.breakdown.map((b: any, idx: number) => (
                                    <div key={idx} className="text-xs border-b border-border/10 pb-2 last:border-0 last:pb-0">
                                        <div className="flex justify-between font-medium mb-1">
                                            <span>{b.buildingName}</span>
                                            <span className="text-emerald-500">{((b.cost.total)/10000000).toFixed(2)} Cr</span>
                                        </div>
                                        <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>{b.timeline.total.toFixed(0)} months</span>
                                            <span>Start: Now</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-lg border p-4 bg-secondary/10 text-center text-xs text-muted-foreground">
                    {isLoadingEstimates ? "Calculating estimates..." : "Configure Admin Parameters to see estimates"}
                </div>
            )}
        </div>
    );
}



export function FeasibilityDashboard() {
    const selectedBuilding = useSelectedBuilding();
    const activeProject = useBuildingStore(state => state.projects.find(p => p.id === state.activeProjectId));
    const uiState = useBuildingStore(state => state.uiState);
    const setOpen = useBuildingStore(state => state.actions.setFeasibilityPanelOpen);

    // Default to open if not set
    const isOpen = uiState.isFeasibilityPanelOpen ?? true;

    // Fetch estimates ONCE here — shared by Cost & Time simulator tabs so they don't re-fetch on tab switch
    const activeProjectData = useProjectData();
    const metricsForSim = useDevelopmentMetrics(activeProjectData);
    const { estimates: simEstimates, isLoading: simLoading } = useProjectEstimates(activeProjectData, metricsForSim);

    if (!activeProject) return null;

    const cardClasses = "bg-background/95 backdrop-blur-md border border-border shadow-2xl";

    return (
        <div className={cn(
            "absolute bottom-0 left-0 right-0 z-40 overflow-hidden transition-all duration-300 ease-in-out",
            isOpen ? "h-[45vh]" : "h-[50px] hover:h-[60px]"
        )}>
            <Card className={`${cardClasses} w-full h-full rounded-none border-x-0 border-b-0 flex flex-col`}>
                <CardHeader className="flex flex-row items-center justify-between p-3 pb-2 h-[50px] shrink-0 border-b border-border/10">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-sm font-bold">{activeProject.name} Feasibility</CardTitle>
                        <Badge variant="secondary" className="text-xs font-normal">KPIs & Regulations</Badge>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-muted" onClick={() => setOpen(!isOpen)}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                </CardHeader>

                {/* Content Area - Only render/visible when open to save performance */}
                <div className={cn(
                    "flex-1 min-h-0 w-full transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}>
                    {isOpen && (
                        <CardContent className="p-0 h-full">
                            <Tabs defaultValue="feasibility" className="flex flex-col h-full w-full">
                                <div className="px-4 pt-2 shrink-0">
                                    <TabsList className="grid w-full grid-cols-4">
                                        <TabsTrigger value="feasibility" className="text-[11px]">Dashboard</TabsTrigger>
                                        <TabsTrigger value="metrics" className="text-[11px]">KPIs</TabsTrigger>
                                        <TabsTrigger value="cost" className="text-[11px]">Cost Sim</TabsTrigger>
                                        <TabsTrigger value="time" className="text-[11px]">Time Sim</TabsTrigger>
                                    </TabsList>
                                </div>

                                <div className="flex-1 min-h-0 overflow-hidden relative">
                                    <TabsContent value="feasibility" className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin">
                                        <FeasibilityTab />
                                    </TabsContent>
                                    <TabsContent value="metrics" className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin">
                                        <MetricsTab />
                                    </TabsContent>
                                    <TabsContent value="cost" className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin">
                                        <CostSimulatorTab estimates={simEstimates} isLoading={simLoading} />
                                    </TabsContent>
                                    <TabsContent value="time" className="h-full m-0 p-4 pt-2 overflow-y-auto scrollbar-thin">
                                        <TimeSimulatorTab estimates={simEstimates} isLoading={simLoading} />
                                    </TabsContent>
                                </div>
                            </Tabs>
                        </CardContent>
                    )}
                </div>
            </Card>
        </div>
    );
}
