'use client';
import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    AreaChart, Area, ReferenceLine, CartesianGrid, Cell,
} from 'recharts';
import type { SimBin, SensitivityVar, ProjectPhase, StandardTimeEstimation } from '@/lib/types';

// ─── SHARED STYLES ───────────────────────────────────────────────────────────
const CHART_COLORS = {
    primary: '#3b82f6',
    secondary: '#8b5cf6',
    accent: '#10b981',
    warn: '#f59e0b',
    danger: '#ef4444',
    muted: '#6b7280',
    bg: 'rgba(30,30,40,0.3)',
};

const chartMargin = { top: 8, right: 8, bottom: 4, left: 8 };

function fmtCr(v: number) { return `₹${(v / 10000000).toFixed(1)} Cr`; }
function fmtMo(v: number) { return `${v.toFixed(1)} mo`; }

// ─── HISTOGRAM ───────────────────────────────────────────────────────────────
interface HistogramProps {
    data: SimBin[];
    p10: number; p50: number; p90: number;
    formatFn?: (v: number) => string;
    title: string;
    color?: string;
}

export function SimHistogram({ data, p10, p50, p90, formatFn = fmtCr, title, color = CHART_COLORS.primary }: HistogramProps) {
    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
            <ResponsiveContainer width="100%" height={120}>
                <BarChart data={data} margin={chartMargin}>
                    <XAxis dataKey="x" tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={formatFn} interval="preserveStartEnd" />
                    <YAxis hide />
                    <Tooltip
                        contentStyle={{ background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        wrapperStyle={{ zIndex: 100 }}
                        formatter={(v: number) => [v, 'Simulations']}
                        labelFormatter={(l: number) => formatFn(l)}
                    />
                    <ReferenceLine x={p10} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'P10', fontSize: 12, fill: '#10b981', position: 'top' }} />
                    <ReferenceLine x={p50} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'P50', fontSize: 12, fill: '#f59e0b', position: 'top' }} />
                    <ReferenceLine x={p90} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'P90', fontSize: 12, fill: '#ef4444', position: 'top' }} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={0.7} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1 px-1">
                <span className="text-emerald-400">P10: {formatFn(p10)}</span>
                <span className="text-amber-400">P50: {formatFn(p50)}</span>
                <span className="text-red-400">P90: {formatFn(p90)}</span>
            </div>
        </div>
    );
}

// ─── CDF CURVE ───────────────────────────────────────────────────────────────
interface CDFProps {
    data: { x: number; y: number }[];
    p50: number; p90: number;
    formatFn?: (v: number) => string;
    title: string;
}

export function SimCDF({ data, p50, p90, formatFn = fmtCr, title }: CDFProps) {
    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
            <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data} margin={chartMargin}>
                    <defs>
                        <linearGradient id="cdfGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,100,0.15)" />
                    <XAxis dataKey="x" tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={formatFn} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} domain={[0, 100]} />
                    <Tooltip
                        contentStyle={{ background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        wrapperStyle={{ zIndex: 100 }}
                        formatter={(v: number) => [`${v.toFixed(1)}%`, 'Probability']}
                        labelFormatter={(l: number) => formatFn(l)}
                    />
                    <ReferenceLine x={p50} stroke="#f59e0b" strokeDasharray="3 3" />
                    <ReferenceLine x={p90} stroke="#ef4444" strokeDasharray="3 3" />
                    <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <Area type="monotone" dataKey="y" stroke={CHART_COLORS.primary} fill="url(#cdfGrad)" strokeWidth={2} />
                </AreaChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground justify-center">
                <span>50% chance ≤ <span className="text-amber-400">{formatFn(p50)}</span></span>
                <span>90% chance ≤ <span className="text-red-400">{formatFn(p90)}</span></span>
            </div>
        </div>
    );
}

// ─── TORNADO CHART ───────────────────────────────────────────────────────────
interface TornadoProps {
    data: SensitivityVar[];
    formatFn?: (v: number) => string;
    title: string;
}

export function SimTornado({ data, formatFn = fmtCr, title }: TornadoProps) {
    const sorted = [...data].sort((a, b) => b.range - a.range);
    const colors = [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.accent, CHART_COLORS.warn, CHART_COLORS.danger];

    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
            <div className="space-y-1.5">
                {sorted.map((s, i) => {
                    const maxRange = sorted[0]?.range || 1;
                    const widthPct = (s.range / maxRange) * 100;
                    return (
                        <div key={s.label} className="flex items-center gap-2">
                            <div className="text-[11px] text-muted-foreground w-16 shrink-0 text-right">{s.label}</div>
                            <div className="flex-1 h-4 bg-secondary/40 rounded relative overflow-hidden">
                                <div
                                    className="absolute top-0 left-0 h-full rounded transition-all duration-700"
                                    style={{ width: `${Math.min(100, widthPct)}%`, backgroundColor: colors[i % colors.length], opacity: 0.75 }}
                                />
                            </div>
                            <div className="text-xs text-muted-foreground w-20 shrink-0">
                                {formatFn(s.range)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── S-CURVE BAND ────────────────────────────────────────────────────────────
interface SCurveBandProps {
    p10: number[]; p50: number[]; p90: number[];
    totalMonths: number;
    revenueTarget?: number;
    title: string;
}

export function SimSCurveBand({ p10, p50, p90, totalMonths, revenueTarget, title }: SCurveBandProps) {
    const data = p50.map((_, i) => ({
        month: ((i + 1) / p50.length * totalMonths).toFixed(0),
        p10: p10[i] / 10000000,
        p50: p50[i] / 10000000,
        p90: p90[i] / 10000000,
    }));

    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
            <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={data} margin={chartMargin}>
                    <defs>
                        <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,100,0.15)" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                    <Tooltip
                        contentStyle={{ background: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        wrapperStyle={{ zIndex: 100 }}
                        formatter={(v: number) => [`₹${v.toFixed(1)} Cr`]}
                    />
                    <Area type="monotone" dataKey="p90" stroke="transparent" fill="url(#bandGrad)" tooltipType="none" />
                    <Area type="monotone" dataKey="p10" stroke="#10b981" fill="transparent" strokeWidth={1} strokeDasharray="4 3" />
                    <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="transparent" strokeWidth={2} />
                    <Area type="monotone" dataKey="p90" stroke="#ef4444" fill="transparent" strokeWidth={1} strokeDasharray="4 3" />
                    {revenueTarget && (
                        <ReferenceLine y={revenueTarget / 10000000} stroke="#10b981" strokeDasharray="6 3" strokeWidth={1.5}
                            label={{ value: 'Revenue', fontSize: 12, fill: '#10b981', position: 'right' }}
                        />
                    )}
                </AreaChart>
            </ResponsiveContainer>
            <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground justify-center">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" style={{ borderTop: '1px dashed' }} /> P10 (Best)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block rounded" /> P50 (Likely)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-400 inline-block rounded" style={{ borderTop: '1px dashed' }} /> P90 (Worst)</span>
            </div>
        </div>
    );
}

// ─── GANTT WITH UNCERTAINTY ──────────────────────────────────────────────────
interface GanttItem {
    activity: string;
    minStart: number;
    expectedStart: number;
    expectedEnd: number;
    maxEnd: number;
    color: string;
}

interface GanttProps {
    data: GanttItem[];
    title: string;
}

export function SimGanttUncertainty({ data, title }: GanttProps) {
    const maxEnd = Math.max(...data.map(d => d.maxEnd), 1);

    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">{title}</div>
            <div className="space-y-2">
                {data.map((item, i) => {
                    const minStartPct = (item.minStart / maxEnd) * 100;
                    const expStartPct = (item.expectedStart / maxEnd) * 100;
                    const expEndPct = (item.expectedEnd / maxEnd) * 100;
                    const maxEndPct = (item.maxEnd / maxEnd) * 100;
                    return (
                        <div key={i} className="flex items-center gap-2">
                            <div className="text-[11px] text-muted-foreground w-20 shrink-0 text-right">{item.activity}</div>
                            <div className="flex-1 h-5 bg-secondary/30 rounded-full relative overflow-hidden">
                                {/* Uncertainty range (light) */}
                                <div
                                    className="absolute top-0 h-full rounded-full opacity-25"
                                    style={{ left: `${minStartPct}%`, width: `${maxEndPct - minStartPct}%`, backgroundColor: item.color }}
                                />
                                {/* Expected range (solid) */}
                                <div
                                    className="absolute top-0.5 h-4 rounded-full opacity-85"
                                    style={{ left: `${expStartPct}%`, width: `${expEndPct - expStartPct}%`, backgroundColor: item.color }}
                                />
                            </div>
                            <div className="text-xs text-muted-foreground w-14 shrink-0">
                                {item.expectedStart.toFixed(0)}–{item.maxEnd.toFixed(0)}mo
                            </div>
                        </div>
                    );
                })}
            </div>
            {/* Month scale — 3-month intervals */}
            <div className="mt-2 ml-[88px] pr-14 relative h-4">
                {(() => {
                    const interval = 3;
                    const ticks: number[] = [];
                    for (let m = 0; m <= maxEnd; m += interval) ticks.push(m);
                    if (ticks[ticks.length - 1] < maxEnd) ticks.push(Math.ceil(maxEnd));
                    return ticks.map((m) => (
                        <span
                            key={m}
                            className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
                            style={{ left: `${(m / maxEnd) * 100}%` }}
                        >
                            {m}m
                        </span>
                    ));
                })()}
            </div>
        </div>
    );
}

// ─── PHASE BREAKDOWN ─────────────────────────────────────────────────────────
interface PhaseBreakdownProps {
    phases: ProjectPhase[];
    title: string;
    mode: 'cost' | 'time';
}

export function PhaseBreakdownChart({ phases, title, mode }: PhaseBreakdownProps) {
    const phaseColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
            <div className="space-y-2">
                {phases.map((phase, i) => {
                    const color = phaseColors[i % phaseColors.length];
                    const pct = phase.costShare * 100;
                    return (
                        <div key={i}>
                            <div className="flex justify-between text-[11px] mb-0.5">
                                <span className="text-muted-foreground truncate mr-2">{phase.name}</span>
                                <span className="font-medium shrink-0">
                                    {mode === 'cost'
                                        ? `₹${(phase.costAmount / 10000000).toFixed(1)} Cr`
                                        : `${phase.durationMonths.toFixed(1)} mo`}
                                </span>
                            </div>
                            <div className="h-2 bg-secondary/40 rounded-full overflow-hidden relative">
                                {/* Min-max range (light) */}
                                {mode === 'cost' && (
                                    <div
                                        className="absolute top-0 h-full rounded-full opacity-25"
                                        style={{
                                            left: `${(phase.costAmountMin / (phases.reduce((s, p) => s + p.costAmountMax, 0) || 1)) * 100}%`,
                                            width: `${((phase.costAmountMax - phase.costAmountMin) / (phases.reduce((s, p) => s + p.costAmountMax, 0) || 1)) * 100}%`,
                                            backgroundColor: color,
                                        }}
                                    />
                                )}
                                <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.8 }}
                                />
                            </div>
                            <div className="flex gap-1 mt-0.5">
                                {phase.activities.map(a => (
                                    <span key={a} className="text-[11px] text-muted-foreground bg-secondary/30 px-1 py-0.5 rounded">{a}</span>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── UTILITY COSTS TABLE ─────────────────────────────────────────────────────
interface UtilityCostsProps {
    items: { label: string; amount: number; unit: string }[];
    total: number;
}

export function UtilityCostsTable({ items, total }: UtilityCostsProps) {
    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Utility Costs</div>
            <div className="space-y-1">
                {items.map(item => (
                    <div key={item.label} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{item.label}</span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground/60">{item.unit}</span>
                            <span className="font-medium w-16 text-right">
                                {item.amount >= 10000000
                                    ? `₹${(item.amount / 10000000).toFixed(2)} Cr`
                                    : `₹${(item.amount / 100000).toFixed(1)} L`}
                            </span>
                        </div>
                    </div>
                ))}
                <div className="flex justify-between text-xs pt-1 border-t border-border/20 font-semibold">
                    <span>Total Utilities</span>
                    <span className="text-amber-400">₹{(total / 10000000).toFixed(2)} Cr</span>
                </div>
            </div>
        </div>
    );
}

// ─── DELAY FACTORS ───────────────────────────────────────────────────────────
interface DelayFactorsProps {
    delays: { factor: string; pct: number; impactMonths: number }[];
}

export function DelayFactorsDisplay({ delays }: DelayFactorsProps) {
    const maxImpact = Math.max(...delays.map(d => d.impactMonths), 0.1);
    return (
        <div className="rounded-lg border p-3 bg-secondary/10 border-border/30">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Standard Time Delays</div>
            <div className="space-y-1.5">
                {delays.map(d => (
                    <div key={d.factor} className="flex items-center gap-2">
                        <div className="text-[11px] text-muted-foreground w-16 shrink-0 text-right">{d.factor}</div>
                        <div className="flex-1 h-3 bg-secondary/40 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full bg-amber-400/70 transition-all duration-500"
                                style={{ width: `${(d.impactMonths / maxImpact) * 100}%` }}
                            />
                        </div>
                        <div className="text-xs text-muted-foreground w-20 shrink-0">
                            −{d.pct}% | {d.impactMonths.toFixed(1)}mo
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── DELIVERY PHASES CHART ───────────────────────────────────────────────────

import type { DeliveryPhase } from '@/lib/types';

const PHASE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];

interface DeliveryPhasesChartProps {
    phases: DeliveryPhase[];
    title?: string;
    numPhases: number;
    onNumPhasesChange?: (n: number) => void;
}

export function DeliveryPhasesChart({ phases, title = 'Project Delivery Phases', numPhases, onNumPhasesChange }: DeliveryPhasesChartProps) {
    if (!phases || phases.length === 0) return null;

    const maxMonth = Math.max(...phases.map(p => p.endMonth), 1);
    const totalCost = phases.reduce((s, p) => s + p.totalCost, 0);

    const phaseOptions = [
        { label: 'All', value: 0 },
        { label: '2', value: 2 },
        { label: '3', value: 3 },
        { label: '4', value: 4 },
        { label: '5', value: 5 },
    ];

    return (
        <div className="rounded-lg border p-3 bg-secondary/5 border-border/20">
            {/* Header with phase selector */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </svg>
                    <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{title}</span>
                </div>
                {onNumPhasesChange && (
                    <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted-foreground mr-1">Phases:</span>
                        {phaseOptions.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => onNumPhasesChange(opt.value)}
                                className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                                    numPhases === opt.value
                                        ? 'bg-primary text-primary-foreground font-semibold'
                                        : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/60'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Gantt-style timeline */}
            <div className="space-y-3">
                {phases.map((phase, phaseIdx) => {
                    const color = PHASE_COLORS[phaseIdx % PHASE_COLORS.length];
                    const startPct = (phase.startMonth / maxMonth) * 100;
                    const widthPct = ((phase.endMonth - phase.startMonth) / maxMonth) * 100;
                    const costShare = totalCost > 0 ? ((phase.totalCost / totalCost) * 100).toFixed(0) : '0';

                    return (
                        <div key={phaseIdx}>
                            {/* Phase header */}
                            <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
                                    <span className="text-xs font-semibold" style={{ color }}>{phase.phaseName}</span>
                                    <span className="text-[11px] text-muted-foreground">
                                        ({phase.buildings.length} building{phase.buildings.length > 1 ? 's' : ''})
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px]">
                                    <span className="text-muted-foreground">
                                        Mo {phase.startMonth.toFixed(0)}–{phase.endMonth.toFixed(0)}
                                    </span>
                                    <span className="font-semibold" style={{ color }}>
                                        {costShare}% cost
                                    </span>
                                </div>
                            </div>

                            {/* Phase timeline bar */}
                            <div className="relative h-5 bg-secondary/20 rounded overflow-hidden mb-1">
                                <div
                                    className="absolute top-0 h-full rounded transition-all duration-700"
                                    style={{
                                        left: `${startPct}%`,
                                        width: `${Math.max(widthPct, 1)}%`,
                                        backgroundColor: color,
                                        opacity: 0.3,
                                    }}
                                />
                                {/* Individual building bars within the phase */}
                                {phase.buildings.map((b, bIdx) => {
                                    const bStartPct = (b.startMonth / maxMonth) * 100;
                                    const bWidthPct = ((b.endMonth - b.startMonth) / maxMonth) * 100;
                                    return (
                                        <div
                                            key={bIdx}
                                            className="absolute h-full rounded transition-all duration-500"
                                            title={`${b.buildingName}: Mo ${b.startMonth.toFixed(1)}–${b.endMonth.toFixed(1)}`}
                                            style={{
                                                left: `${bStartPct}%`,
                                                width: `${Math.max(bWidthPct, 0.5)}%`,
                                                backgroundColor: color,
                                                opacity: 0.5 + (bIdx * 0.15),
                                                top: `${(bIdx / Math.max(phase.buildings.length, 1)) * 40}%`,
                                                height: `${Math.max(60 / Math.max(phase.buildings.length, 1), 30)}%`,
                                            }}
                                        />
                                    );
                                })}
                            </div>

                            {/* Building list */}
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                {phase.buildings.map((b, bIdx) => (
                                    <div key={bIdx} className="text-xs text-muted-foreground flex items-center gap-0.5">
                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, opacity: 0.5 + (bIdx * 0.15) }} />
                                        <span className="truncate max-w-[80px]">{b.buildingName}</span>
                                        <span className="text-muted-foreground/60">
                                            {b.endMonth.toFixed(1)}mo
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Timeline ruler */}
            <div className="mt-3 pt-1 border-t border-border/20">
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Month 0</span>
                    <span>Month {Math.ceil(maxMonth / 4)}</span>
                    <span>Month {Math.ceil(maxMonth / 2)}</span>
                    <span>Month {Math.ceil(maxMonth * 3 / 4)}</span>
                    <span>Month {Math.ceil(maxMonth)}</span>
                </div>
            </div>

            {/* Summary row */}
            <div className="mt-2 grid grid-cols-3 gap-2">
                {phases.map((phase, idx) => (
                    <div key={idx} className="text-center p-1.5 rounded bg-secondary/20">
                        <div className="text-[11px] font-semibold" style={{ color: PHASE_COLORS[idx % PHASE_COLORS.length] }}>
                            {phase.phaseName}
                        </div>
                        <div className="text-xs font-bold text-foreground">
                            {phase.totalCost >= 10000000
                                ? `₹${(phase.totalCost / 10000000).toFixed(1)} Cr`
                                : `₹${(phase.totalCost / 100000).toFixed(1)} L`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {phase.durationMonths.toFixed(1)} months
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── STANDARD AREA-BASED TIMELINE CHART ──────────────────────────────────────
export function StandardTimelineChart({ data }: { data: StandardTimeEstimation }) {
    if (!data || data.buildings.length === 0) return null;

    const maxMonths = data.totalProjectDurationMonths;
    const paddingMultiplier = 1.1; // 10% padding for the scale
    const displayMax = maxMonths * paddingMultiplier;

    // Hardcode a palette for standard phases
    const PHASE_COLORS: Record<string, string> = {
        'Earthwork & Excavation': '#fdd407',
        'Foundation': '#3b82f6',
        'Basement Levels': '#04f78e50',
        'Superstructure': '#10b981',
        'Finishes & MEP': '#f59e0b',
        'Risk & Weather Buffer': '#ef4444',
    };

    return (
        <div className="rounded-lg border p-3 bg-secondary/5 border-border/20 mt-4">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Standard Area-Based Timeline</div>
                <div className="text-[11px] bg-secondary/20 px-2 py-0.5 rounded text-foreground font-medium">
                    {data.totalProjectDurationMonths.toFixed(1)} Months Total
                </div>
            </div>

            <div className="space-y-4">
                {data.buildings.map((b, idx) => {
                    return (
                        <div key={idx} className="relative">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="font-medium">{b.buildingName}</span>
                                <span className="text-muted-foreground">{b.totalDurationMonths.toFixed(1)} mo</span>
                            </div>
                            
                            {/* The Phase Bar */}
                            <div className="h-4 bg-secondary/20 rounded-full overflow-hidden flex w-full relative">
                                {/* Invisible spacer for offset */}
                                {(b.offsetMonths || 0) > 0 && (
                                    <div 
                                        className="h-full shrink-0" 
                                        style={{ width: `${((b.offsetMonths || 0) / displayMax) * 100}%` }} 
                                    />
                                )}
                                
                                {b.phases.map((p, pIdx) => {
                                    // Scale width relative to the maximum project duration layout
                                    let widthPct = (p.durationMonths / displayMax) * 100;
                                    
                                    // Ensure tiny phases (like Earthworks) are at least somewhat visible (e.g. min 1%)
                                    if (widthPct > 0 && widthPct < 1) widthPct = 1;
                                    
                                    const color = PHASE_COLORS[p.name] || '#64748b';
                                    
                                    return (
                                        <div 
                                            key={pIdx} 
                                            style={{ width: `${widthPct}%`, backgroundColor: color }}
                                            className="h-full group relative transition-all duration-300 hover:brightness-110 shrink-0"
                                            title={`${p.name}: ${p.durationMonths.toFixed(1)} mo (${p.durationDays} days)`}
                                        >
                                            <div className="absolute inset-0 border-r border-background/20 last:border-0" />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-2 border-t border-border/10 flex flex-wrap gap-2">
                {Object.entries(PHASE_COLORS).map(([name, color]) => (
                    <div key={name} className="flex items-center gap-1.5 min-w-[120px]">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-[10px] text-muted-foreground truncate">{name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── BOX PLOT (Cost Component Variability) ─────────────────────────────────

interface BoxPlotProps {
    data: {
        earthwork: number[];
        structure: number[];
        finishing: number[];
        services: number[];
    };
    title?: string;
}

function computeBoxStats(arr: number[]) {
    const sorted = [...arr].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const min = sorted[Math.floor(sorted.length * 0.05)]; // P5
    const max = sorted[Math.floor(sorted.length * 0.95)]; // P95
    return { min, q1, median, q3, max };
}

export function SimBoxPlot({ data, title = 'Cost Component Variability' }: BoxPlotProps) {
    const components = [
        { label: 'Earthwork', color: '#f59e0b', stats: computeBoxStats(data.earthwork) },
        { label: 'Structure', color: '#3b82f6', stats: computeBoxStats(data.structure) },
        { label: 'Finishing', color: '#8b5cf6', stats: computeBoxStats(data.finishing) },
        { label: 'MEP/Services', color: '#10b981', stats: computeBoxStats(data.services) },
    ];

    const globalMax = Math.max(...components.map(c => c.stats.max));
    const scale = (v: number) => (v / globalMax) * 100;

    return (
        <div className="rounded-lg border p-4 bg-secondary/5 border-border/20">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4">{title}</div>
            <div className="space-y-4">
                {components.map(c => {
                    const { min, q1, median, q3, max } = c.stats;
                    return (
                        <div key={c.label} className="flex items-center gap-3">
                            <div className="w-24 text-[11px] font-medium text-right shrink-0">{c.label}</div>
                            <div
                                className="flex-1 relative h-6"
                                title={`${c.label} Breakdown:\n• P95 (Worst Case): ${fmtCr(max)}\n• Q3 (75th Percentile): ${fmtCr(q3)}\n• Median: ${fmtCr(median)}\n• Q1 (25th Percentile): ${fmtCr(q1)}\n• P5 (Best Case): ${fmtCr(min)}`}
                            >
                                {/* Whisker line (min to max) */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-muted-foreground/40"
                                    style={{ left: `${scale(min)}%`, width: `${scale(max) - scale(min)}%` }}
                                />
                                {/* Min cap */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3 bg-muted-foreground/60"
                                    style={{ left: `${scale(min)}%` }}
                                />
                                {/* Max cap */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3 bg-muted-foreground/60"
                                    style={{ left: `${scale(max)}%` }}
                                />
                                {/* Box (Q1 to Q3) */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 h-5 rounded-sm border border-border/30"
                                    style={{
                                        left: `${scale(q1)}%`,
                                        width: `${scale(q3) - scale(q1)}%`,
                                        backgroundColor: c.color + '40',
                                    }}
                                />
                                {/* Median line */}
                                <div
                                    className="absolute top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-sm"
                                    style={{ left: `${scale(median)}%`, backgroundColor: c.color }}
                                />
                            </div>
                            <div className="w-20 text-[10px] text-muted-foreground shrink-0">
                                {fmtCr(median)}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 pt-2 border-t border-border/10 flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>Whiskers: P5–P95</span>
                <span>Box: Q1–Q3 (IQR)</span>
                <span>Line: Median</span>
            </div>
        </div>
    );
}

// ─── SCATTER PLOT (Cost vs Time) ─────────────────────────────────────────────

import { ScatterChart, Scatter, ZAxis } from 'recharts';

interface ScatterCostTimeProps {
    costData: number[];
    timeData: number[];
    title?: string;
}

export function SimScatterCostTime({ costData, timeData, title = 'Cost vs Duration (Correlation)' }: ScatterCostTimeProps) {
    // Sample down to max 500 points for performance
    const maxPoints = 500;
    const step = Math.max(1, Math.floor(costData.length / maxPoints));
    const scatterData = [];
    for (let i = 0; i < costData.length; i += step) {
        scatterData.push({ cost: costData[i], time: timeData[i] });
    }

    // Calculate correlation coefficient
    const n = scatterData.length;
    const sumX = scatterData.reduce((s, d) => s + d.cost, 0);
    const sumY = scatterData.reduce((s, d) => s + d.time, 0);
    const sumXY = scatterData.reduce((s, d) => s + d.cost * d.time, 0);
    const sumX2 = scatterData.reduce((s, d) => s + d.cost * d.cost, 0);
    const sumY2 = scatterData.reduce((s, d) => s + d.time * d.time, 0);
    const corr = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)) || 0;

    return (
        <div className="rounded-lg border p-4 bg-secondary/5 border-border/20">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">{title}</div>
                <div className={`text-[11px] px-2 py-0.5 rounded font-medium ${corr > 0.3 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                    r = {corr.toFixed(2)}
                </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis
                        dataKey="cost"
                        type="number"
                        name="Cost"
                        tickFormatter={fmtCr}
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        label={{ value: 'Total Cost', position: 'bottom', fill: '#6b7280', fontSize: 10 }}
                    />
                    <YAxis
                        dataKey="time"
                        type="number"
                        name="Duration"
                        tickFormatter={fmtMo}
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        label={{ value: 'Duration (mo)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
                    />
                    <ZAxis range={[15, 15]} />
                    <Tooltip
                        formatter={(value: any, name: string) => [
                            name === 'Cost' ? fmtCr(value) : fmtMo(value),
                            name,
                        ]}
                        contentStyle={{
                            backgroundColor: 'rgba(20,20,30,0.95)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 8,
                            fontSize: 11,
                            color: '#e5e7eb',
                        }}
                        labelStyle={{ color: '#9ca3af' }}
                        itemStyle={{ color: '#e5e7eb' }}
                    />
                    <Scatter data={scatterData} fill="#8b5cf6" fillOpacity={0.4} />
                </ScatterChart>
            </ResponsiveContainer>
            <div className="mt-1 text-[10px] text-muted-foreground text-center">
                {corr > 0.5
                    ? 'Strong positive correlation: delays significantly increase cost'
                    : corr > 0.2
                    ? 'Moderate correlation: some delay-driven cost increase'
                    : 'Weak correlation: cost and time are mostly independent'}
            </div>
        </div>
    );
}

// ─── CRITICAL PATH PROBABILITY CHART ─────────────────────────────────────────

interface CriticalPathProps {
    data: { activity: string; criticalPct: number }[];
    title?: string;
}

export function CriticalPathProbabilityChart({ data, title = 'Critical Path Probability' }: CriticalPathProps) {
    const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#06b6d4'];

    return (
        <div className="rounded-lg border p-4 bg-secondary/5 border-border/20">
            <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">{title}</div>
            <div className="text-[10px] text-muted-foreground mb-3">
                Which construction activity most often determines the project's critical path?
            </div>
            <div className="space-y-2.5">
                {data.map((item, idx) => (
                    <div key={item.activity} className="flex items-center gap-3">
                        <div className="w-20 text-[11px] font-medium text-right shrink-0">{item.activity}</div>
                        <div className="flex-1 h-5 bg-secondary/20 rounded-full overflow-hidden relative">
                            <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                    width: `${item.criticalPct}%`,
                                    backgroundColor: colors[idx % colors.length],
                                    opacity: 0.8,
                                }}
                            />
                        </div>
                        <div className="w-12 text-[11px] font-semibold shrink-0" style={{ color: colors[idx % colors.length] }}>
                            {item.criticalPct}%
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-3 pt-2 border-t border-border/10 text-[10px] text-muted-foreground">
                Based on {data.length > 0 ? 'Monte Carlo simulation iterations' : 'no data'} — highest % = most schedule-critical activity
            </div>
        </div>
    );
}
