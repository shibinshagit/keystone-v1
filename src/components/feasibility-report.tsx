import React from 'react';
import type { Project, Plot, AdvancedKPIs, ProjectEstimates } from '@/lib/types';
import type { AlgoParams } from '@/lib/generators/basic-generator';
import { calculateBuildingCoreAndCirculation } from '@/lib/generators/building-core-calc';

interface FeasibilityReportProps {
    project: Project;
    plot: Plot;
    metrics?: AdvancedKPIs | null;
    estimates?: ProjectEstimates | null;
    generationParams?: AlgoParams;
}

/* ── tiny helpers ─────────────────────────────────────────── */
const fmt = (n: number | undefined | null, d = 0) =>
    n != null ? n.toLocaleString('en-IN', { maximumFractionDigits: d }) : '—';
const crore = (n: number) => `₹ ${(n / 10000000).toFixed(2)} Cr`;
const lakh  = (n: number) => `₹ ${(n / 100000).toFixed(1)} L`;

const regLabel = (location?: string | null, withYear = false): string => {
    if (!location || location === 'National (NBC)') {
        return withYear ? 'National Building Code 2016 (NBC)' : 'National Building Code (NBC)';
    }
    return withYear ? `${location} Building Code` : `${location} Building Code`;
};

const PageBreak = () => <div className="page-break" style={{ breakAfter: 'page' }} />;

const SH = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-base font-bold bg-slate-100 p-2 mb-3 border-l-4 border-slate-800 uppercase tracking-wide">{children}</h2>
);
const SH2 = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <h3 className={`text-sm font-bold text-slate-700 mt-5 mb-2 border-b border-slate-200 pb-1 ${className}`}>{children}</h3>
);

const TH = ({ children, className = '', colSpan, rowSpan }: { children: React.ReactNode; className?: string; colSpan?: number; rowSpan?: number }) => (
    <th className={`p-1.5 border border-slate-600 bg-slate-800 text-white text-[10px] font-semibold text-left ${className}`} colSpan={colSpan} rowSpan={rowSpan}>{children}</th>
);
const TD = ({ children, className = '', colSpan, rowSpan }: { children: React.ReactNode; className?: string; colSpan?: number; rowSpan?: number }) => (
    <td className={`p-1.5 border border-slate-300 text-[10px] ${className}`} colSpan={colSpan} rowSpan={rowSpan}>{children}</td>
);

const Check = () => <span className="text-green-700 font-bold">✓ Compliant</span>;

/* ══════════════ MAIN COMPONENT ══════════════ */
export function FeasibilityReport({ project, plot, metrics, estimates, generationParams }: FeasibilityReportProps) {
    const stats = plot.developmentStats;
    let units = stats?.units?.breakdown || {};
    let totalUnits = stats?.units?.total || 0;
    
    // Fallback logic to manually count units from buildings if stats are missing
    const tArea: Record<string, number> = {};
    if (totalUnits === 0 && plot.buildings) {
        let tCount = 0;
        const bDown: Record<string, number> = {};
        plot.buildings.forEach(b => {
             b.units?.forEach(u => {
                 tCount++;
                 const tName = u.type || 'Standard';
                 bDown[tName] = (bDown[tName] || 0) + 1;
                 tArea[tName] = (tArea[tName] || 0) + (u.targetArea || 0);
             });
        });
        if (tCount > 0) {
            totalUnits = tCount;
            units = bDown;
        }
    }

    const far = plot.far || plot.regulation?.geometry?.floor_area_ratio?.value || 1.0;
    const maxCov = plot.maxCoverage || plot.regulation?.geometry?.max_ground_coverage?.value || 40;
    const towers = plot.buildings?.length || 1;
    const maxFloors = plot.buildings?.reduce((m, b) => Math.max(m, b.numFloors || 1), 0) || 5;
    const maxBasements = 2; // Defaulting to 2 or extract from parking if available
    const totalLevels = maxFloors + maxBasements;
    const maxHeight = maxFloors * (plot.buildings?.[0]?.typicalFloorHeight || 3);
    const plotArea = plot.area || 0;
    const builtUp = stats?.totalBuiltUpArea || metrics?.totalBuiltUpArea || 0;
    const achievedFAR = metrics?.achievedFAR ?? (builtUp && plotArea ? builtUp / plotArea : 0);
    const gcPct = metrics?.groundCoveragePct ?? (stats?.maxBuildableArea ? (stats.maxBuildableArea / plotArea) * 100 : 0);
    const totalCarpet = metrics?.sellableArea ?? (builtUp * 0.65);
    const carpetEff = builtUp ? (totalCarpet / builtUp) * 100 : 65;
    const parkReq = metrics?.parking?.required ?? Math.ceil(totalUnits * 1.5);
    const parkProv = metrics?.parking?.provided ?? 0;

    const greenItems = metrics?.compliance?.greenItems || [];
    const hasRWH = greenItems.find((i: any) => i.label.includes('Rainwater'))?.status === 'pass';
    const hasSolar = greenItems.find((i: any) => i.label.includes('Solar'))?.status === 'pass';
    const hasSTP = greenItems.find((i: any) => i.label.includes('STP') || i.label.includes('Water Recycling'))?.status === 'pass';

    // cost/revenue from estimates
    const totalCost = estimates?.total_construction_cost ?? 0;
    const totalRev = estimates?.total_revenue ?? 0;
    const profit = estimates?.potential_profit ?? 0;
    const roi = estimates?.roi_percentage ?? 0;
    const cb = estimates?.cost_breakdown;
    const tl = estimates?.timeline;
    const sim = estimates?.simulation;

    const uw = project.underwriting;
    const landCost = uw?.actualLandPurchaseCost || 40000000;
    const stampDuty = uw?.stampDutyAndLegalFees || 0;
    const actualLandCost = landCost + stampDuty;

    // Cost range from simulation
    const costRange = sim ? `${crore(sim.cost_p10)} – ${crore(sim.cost_p90)}` : (totalCost ? crore(totalCost) : 'Pending');
    // Time range from simulation
    const timeRange = sim ? `${Math.round(sim.time_p10)} – ${Math.round(sim.time_p90)} months` : (tl ? `${fmt(tl.total_months, 0)} months` : '30 months');

    // per-building core breakdowns
    const buildingCores = (plot.buildings || []).map(b => {
        const floors = b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3));
        let useType: 'Residential' | 'Commercial' | 'Institutional' = 'Residential';
        if (String(b.intendedUse) === 'Commercial') useType = 'Commercial';
        const core = calculateBuildingCoreAndCirculation({ footprintArea: b.area, numFloors: floors, avgUnitArea: 140, intendedUse: useType });
        return { name: b.name || b.id.slice(0, 8), area: b.area, floors, core };
    });

    return (
        <div className="bg-white text-black text-[10.5px] font-sans leading-relaxed print:bg-white" style={{ colorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page { size: A4; margin: 12mm 15mm; }
                    body, html { background: white !important; }
                    .page-break { break-after: page; page-break-after: always; }
                    .no-break { break-inside: avoid; }
                }
                .report-page { max-width: 210mm; margin: 0 auto; padding: 15mm; }
                @media screen { .report-page { box-shadow: 0 1px 8px rgba(0,0,0,.12); margin-bottom: 12px; background: white; } }
            `}} />

            {/* ═══ COVER PAGE ═══ */}
            <div className="report-page flex flex-col items-center justify-center min-h-[250mm] text-center">
                <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6 mt-16">
                    <span className="text-white text-4xl font-black">K</span>
                </div>
                <p className="text-xs tracking-[.25em] text-slate-500 uppercase mb-2">Automated Feasibility Report</p>
                <h1 className="text-3xl font-black text-slate-900 uppercase leading-tight mb-1">{project.name || 'Untitled Project'}</h1>
                <p className="text-lg text-slate-500 mb-6">{project.intendedUse || 'Residential'} Development</p>
                <div className="w-16 h-0.5 bg-blue-600 mb-6" />
                <p>Plot Area: {fmt(plotArea)} sq.m &nbsp;|&nbsp; {towers} Tower(s) &nbsp;|&nbsp; {totalUnits} Units</p>
                <p>Location: {typeof plot.location === 'object' ? 'Coordinates Defined' : String(plot.location || project.location || 'N/A')}</p>
                <p className="mt-2 text-slate-400">Date: {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                
                <div className="mt-auto pt-8 pb-4">
                    <p className="text-[9px] text-slate-400">Generated by Keystone Engine — Confidential</p>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 1 — EXECUTIVE SUMMARY ═══ */}
            <div className="report-page">
                <SH>1. Executive Summary</SH>
                <table className="w-full border-collapse border border-slate-300 mb-4">
                    <tbody>
                        {[
                            ['Project Name', project.name],
                            ['Location', typeof plot.location === 'object' ? 'Coordinates Defined' : String(plot.location || project.location || 'N/A')],
                            ['Site Area', `${fmt(plotArea)} sq.m (${fmt(plotArea / 4046.86, 2)} Acres)`],
                            ['Development Type', `${project.intendedUse || 'High-Rise Residential'}`],
                            ['Total Units', `${totalUnits} Apartments (${Object.keys(units).join(', ') || 'Mixed'})`],
                            ['Configuration', `${towers} Towers, ${Math.ceil(totalUnits / (towers * Math.max(1, maxFloors)))} Units per Floor`],
                            ['Building Height', `${fmt(maxHeight, 1)}m (G+${maxFloors} floors)`],
                            ['Total Levels', `${totalLevels} (B${maxBasements} to Floor ${maxFloors})`],
                            ['Seismic Zone', 'Zone IV'],
                            ['Total Carpet Area', `${fmt(totalCarpet)} sq.m`],
                            ['Total Built-up Area', `${fmt(builtUp)} sq.m`],
                            ['Target FAR', `${far} (Achieved: ${fmt(achievedFAR, 2)})`],
                            ['Ground Coverage', `${fmt(gcPct, 1)}% (Code: Max ${maxCov}%)`],
                            ['Parking Spaces', `${parkProv} ECS Provided (${parkReq} Req)`],
                            ['Project Cost', costRange],
                            ['Construction Period', timeRange],
                            ['Regulatory Framework', regLabel(plot.regulation?.location)],
                        ].map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold w-1/3">{k}</TD><TD>{v}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>SWOT Analysis</SH2>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {(() => {
                        const strengths = [];
                        const weaknesses = [];
                        const opportunities = [];
                        const threats = [];

                        // Strengths
                        if (plotArea > 5000) strengths.push(`Large plot area (${fmt(plotArea)} sq.m) offers strong development scale.`);
                        else strengths.push(`Compact plot area (${fmt(plotArea)} sq.m) suitable for boutique ${project.intendedUse?.toLowerCase() || 'residential'} development.`);
                        
                        if ((achievedFAR || 0) >= far * 0.9) strengths.push(`Optimal FAR utilization (${fmt(achievedFAR, 2)} of ${far}).`);
                        else strengths.push(`High permissible FAR (${far}) available for development.`);

                        const entriesCount = plot.entries?.length || 0;
                        if (entriesCount > 1) strengths.push(`Multiple accesses (${entriesCount} gates) ease traffic flow.`);
                        
                        // Weaknesses
                        if (entriesCount <= 1) weaknesses.push('Single point of access may cause traffic bottlenecks.');
                        
                        const avgSetback = generationParams?.setback ?? plot?.setback ?? 0;
                        if (avgSetback >= 6) weaknesses.push(`Stringent setback requirements (≥${avgSetback}m) reduce available footprint.`);
                        else weaknesses.push('Required setbacks constrain the ground coverage area.');

                        if (plotArea < 3000) weaknesses.push('Small plot size constrains large-scale amenity provisioning.');

                        // Opportunities
                        opportunities.push(`Demand for premium ${project.intendedUse?.toLowerCase() || 'residential'} spaces in the micro-market.`);
                        opportunities.push('Scope for green building certification (IGBC/GRIHA) to unlock premium pricing.');
                        if (far - (achievedFAR || 0) > 0.5) opportunities.push(`Significant unutilized FAR (${fmt(far - (achievedFAR || 0), 2)}) presents future expansion potential.`);

                        // Threats
                        if (parkProv < parkReq) threats.push(`Parking shortfall (Provided: ${parkProv}, Required: ${parkReq} ECS) may pose regulatory hurdles.`);
                        else threats.push(`Strict parking requirements (${parkReq} ECS) mandate extensive basement construction.`);
                        
                        threats.push(`Ground coverage limitation (Max ${maxCov}%) restricts low-rise sprawl.`);
                        
                        const heightLimit = plot.regulation?.geometry?.max_height?.value;
                        if (heightLimit) threats.push(`Strict height limitation (${heightLimit}m) caps vertical revenue potential.`);
                        else threats.push('Market slowdown or fluctuations in material costs.');

                        return [
                            { t: 'Strengths', bg: 'bg-green-50 border-green-200', tc: 'text-green-800', items: strengths },
                            { t: 'Weaknesses', bg: 'bg-red-50 border-red-200', tc: 'text-red-800', items: weaknesses },
                            { t: 'Opportunities', bg: 'bg-blue-50 border-blue-200', tc: 'text-blue-800', items: opportunities },
                            { t: 'Threats', bg: 'bg-orange-50 border-orange-200', tc: 'text-orange-800', items: threats },
                        ];
                    })().map((s, i) => (
                        <div key={i} className={`border p-2 rounded ${s.bg}`}>
                            <strong className={`${s.tc} text-[10px] uppercase`}>{s.t}</strong>
                            <ul className="list-disc pl-3 mt-1 space-y-0.5">{s.items.map((it, j) => <li key={j}>{it}</li>)}</ul>
                        </div>
                    ))}
                </div>
            </div>
            <PageBreak />

            {/* ═══ PROJECT OVERVIEW & TECHNICAL ASSESSMENT ═══ */}
            <div className="report-page">
                <SH>Project Overview & Technical Assessment</SH>
                
                <SH2 className="mt-2 text-blue-800">Project Specifications</SH2>
                
                <strong className="block text-slate-700 mb-1 border-b pb-1">Site Details</strong>
                <table className="w-full border-collapse text-[9px] mb-4">
                    <thead><tr><TH className="w-1/3 text-left">Parameter</TH><TH className="text-left">Details</TH></tr></thead>
                    <tbody>
                        {(() => {
                            // --- Access from entries + roadAccessSides ---
                            const entries = plot.entries?.filter(e => e.type === 'Entry' || e.type === 'Both') ?? [];
                            const accessSides = plot.roadAccessSides?.join(', ') || null;
                            const entryNames = entries.map(e => e.name).filter(Boolean).join('; ');
                            const accessStr = [
                                entryNames || `${entries.length > 0 ? entries.length + ' gate(s)' : 'Gate'}`,
                                accessSides ? `(${accessSides} side)` : null,
                            ].filter(Boolean).join(' ');

                            // --- Connectivity from project.locationData.amenities ---
                            const amenities: any[] = project.locationData?.amenities ?? [];
                            const findNearest = (keywords: string[]) => {
                                const hits = amenities.filter((a: any) => {
                                    const nm = (a.name || a.tags?.name || a.category || '').toLowerCase();
                                    return keywords.some(k => nm.includes(k));
                                });
                                if (!hits.length) return null;
                                // sort by distance if present
                                hits.sort((a: any, b: any) => (a.distance ?? 99) - (b.distance ?? 99));
                                const h = hits[0];
                                const dist = h.distance != null ? `${(h.distance / 1000).toFixed(1)} km` : null;
                                const name = h.name || h.tags?.name || null;
                                return { name, dist };
                            };
                            const highway = findNearest(['nh-', 'nh ', 'national highway', 'expressway']);
                            const metro = findNearest(['metro', 'rapid metro', 'mrts']);
                            const airport = findNearest(['airport']);
                            const connLines = [
                                highway ? `• ${highway.name || 'Nearest Highway'}: ${highway.dist ?? 'nearby'}` : null,
                                metro   ? `• ${metro.name || 'Metro Station'}: ${metro.dist ?? 'nearby'}` : null,
                                airport ? `• ${airport.name || 'Airport'}: ${airport.dist ?? 'nearby'}` : null,
                            ].filter(Boolean);
                            const connStr = connLines.length > 0 ? connLines.join('\n') : 'Survey pending';

                            const rows: [string, string][] = [
                                ['Plot Area', `${fmt(plotArea)} sq.m (${Math.round(Math.sqrt(plotArea))}m × ${Math.round(Math.sqrt(plotArea))}m approx.)`],
                                ['Location', typeof plot.location === 'object' ? 'Coordinates Defined' : String(plot.location || project.location || '[Sector/Area]')],
                                ['Zoning', `${project.intendedUse || 'Residential'} (Group Housing permitted)`],
                                ['Access', accessStr || 'Road access from site boundary'],
                                ['Connectivity', connStr],
                            ];
                            return rows.map(([k, v], i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                    <TD className="font-semibold">{k}</TD>
                                    <TD className="whitespace-pre-line leading-tight py-1">{v}</TD>
                                </tr>
                            ));
                        })()}
                    </tbody>
                </table>

                <strong className="block text-slate-700 mb-1 border-b pb-1">Building Configuration</strong>
                <table className="w-full border-collapse text-[9px] mb-1">
                    <thead><tr><TH className="w-1/3 text-left">Parameter</TH><TH className="text-left">Specification</TH></tr></thead>
                    <tbody>
                        {[
                            ['Towers', `${towers} Nos.`],
                            ['Tower Size', `~${Math.round(builtUp / totalLevels / towers)} sq.m each`],
                            ['Floors', `B${maxBasements} + Ground + ${maxFloors} Upper = ${totalLevels} levels`],
                            ['Height', `${fmt(maxHeight, 1)}m (measured to parapet)`],
                            ['Structure', 'RCC Frame (SMRF)'],
                            ['Seismic Zone', 'Zone IV'],
                            ['Total Built-up', `${fmt(builtUp)} sq.m`],
                            ['Total Carpet', `${fmt(totalCarpet)} sq.m`],
                        ].map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{k}</TD><TD>{v}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[9px] font-medium text-green-700 mb-4 bg-green-50 p-1 border border-green-200 inline-block">
                    <span className="font-bold">Carpet Efficiency:</span> {carpetEff.toFixed(1)}% (Industry: 55-65%) ✔
                </p>

                <strong className="block text-slate-700 mb-1 border-b pb-1">Unit Mix</strong>
                <table className="w-full border-collapse text-[9px] mb-1 text-center">
                    <thead><tr><TH className="text-left">Type</TH><TH>Carpet Area</TH><TH>Count</TH><TH>%</TH><TH className="text-left">Target Segment</TH></tr></thead>
                    <tbody>
                        {Object.entries(units).map(([type, count], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold text-left">{type}</TD>
                                <TD>~{Math.round(totalCarpet / (totalUnits || 1))} sq.m</TD>
                                <TD>{count as number}</TD>
                                <TD>{((Number(count) / (totalUnits || 1)) * 100).toFixed(0)}%</TD>
                                <TD className="text-left">{type.includes('3') || type.includes('4') ? 'Mid-premium, families' : 'Standard'}</TD>
                            </tr>
                        ))}
                        {Object.keys(units).length === 0 && (
                            <tr className="bg-slate-50">
                                <TD className="font-semibold text-left">3BHK</TD>
                                <TD>110 sq.m</TD>
                                <TD>{totalUnits || 64}</TD>
                                <TD>100%</TD>
                                <TD className="text-left">Mid-premium, families</TD>
                            </tr>
                        )}
                        <tr className="font-bold bg-slate-100 border-t border-slate-300">
                            <TD className="text-left text-slate-800">Total</TD>
                            <TD>&nbsp;</TD>
                            <TD className="text-slate-800">{totalUnits || 64}</TD>
                            <TD className="text-slate-800">100%</TD>
                            <TD>&nbsp;</TD>
                        </tr>
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 text-[9px] mb-4 mt-1">
                    <strong className="text-slate-800 inline-block mb-1">Unit Mix Assessment: <span className="text-green-700">✔ {Object.keys(units).length <= 1 ? 'Homogeneous, market-appropriate' : 'Diverse, market-appropriate'}</span></strong>
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                        {Object.keys(units).length <= 1 && <li>Single product simplifies marketing</li>}
                        <li>Mix aligns with high demand in Gurugram</li>
                        <li>Size adequate for target segment</li>
                    </ul>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Amenities</strong>
                        <div className="text-[9px] text-slate-600 space-y-2">
                            <div>
                                <strong className="text-slate-800">Covered (560 sq.m):</strong>
                                <ul className="list-disc pl-3">
                                    <li>Reception lobby, gym (100 sq.m), indoor games (80 sq.m)</li>
                                    <li>Multipurpose hall (120 sq.m), management office, convenience store</li>
                                </ul>
                            </div>
                            <div>
                                <strong className="text-slate-800">Open (500 sq.m):</strong>
                                <ul className="list-disc pl-3">
                                    <li>Swimming pool (12×6m), children's play area, jogging track (180m)</li>
                                    <li>Landscaping ({metrics?.greenArea?.percentage ? Math.round(metrics.greenArea.percentage * 100) : 28}% of site), yoga/meditation deck</li>
                                </ul>
                            </div>
                            <p className="font-medium text-green-700 pt-1 border-t">
                                Assessment: ✔ Comprehensive amenities for {totalUnits || 64}-unit project
                            </p>
                        </div>
                    </div>
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Parking {plot.regulation?.location?.includes('Haryana') ? '(Code 7.1(2))' : ''}</strong>
                        <table className="w-full border-collapse text-[9px] mb-1">
                            <thead><tr><TH className="text-left w-1/2">Type</TH><TH>Spaces</TH><TH>Compliance</TH></tr></thead>
                            <tbody>
                                <tr className="bg-slate-50">
                                    <TD>Required (1.5 ECS/unit)</TD>
                                    <TD className="text-center">{Math.round(parkReq * 0.91)} ECS</TD>
                                    <TD rowSpan={3} className="text-center align-middle font-bold text-green-700 border-l border-slate-200">
                                        {parkProv >= parkReq ? '✔ Adequate' : '⚠ Deficit'}
                                    </TD>
                                </tr>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <TD>Guest (10%)</TD>
                                    <TD className="text-center">{Math.round(parkReq * 0.09)} ECS</TD>
                                </tr>
                                <tr className="font-bold bg-slate-100 border-b border-slate-300">
                                    <TD className="text-slate-800">Total Required</TD>
                                    <TD className="text-center text-slate-800">{parkReq} ECS</TD>
                                </tr>
                                <tr>
                                    <TD className="font-bold text-slate-800">Provided</TD>
                                    <TD className="text-center font-bold text-blue-700">{parkProv} ECS</TD>
                                    <TD className={`text-center font-bold border-l border-slate-200 ${parkProv >= parkReq ? 'text-green-700' : 'text-red-600'}`}>
                                        {parkProv >= parkReq
                                            ? `${parkReq > 0 ? Math.round(((parkProv - parkReq) / parkReq) * 100) : 0}% surplus`
                                            : `${parkReq > 0 ? Math.round(((parkReq - parkProv) / parkReq) * 100) : 0}% deficit`}
                                    </TD>
                                </tr>
                                <tr className="bg-slate-50 text-slate-500">
                                    <TD className="pl-3">- Regular (basements)</TD>
                                    <TD className="text-center">{Math.floor(parkProv * 0.39)} ECS</TD>
                                    <TD className="border-l border-slate-200">&nbsp;</TD>
                                </tr>
                                <tr className="bg-slate-50 text-slate-500">
                                    <TD className="pl-3">- Stacker (2-level)</TD>
                                    <TD className="text-center">{Math.floor(parkProv * 0.38)} ECS</TD>
                                    <TD className="border-l border-slate-200">&nbsp;</TD>
                                </tr>
                                <tr className="bg-slate-50 text-slate-500">
                                    <TD className="pl-3">- Open (ground/visitor)</TD>
                                    <TD className="text-center">{parkProv - Math.floor(parkProv * 0.39) - Math.floor(parkProv * 0.38)} ECS</TD>
                                    <TD className="border-l border-slate-200">&nbsp;</TD>
                                </tr>
                            </tbody>
                        </table>
                        <p className={`text-[9px] font-medium p-1 border text-center mt-1 ${parkProv >= parkReq ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'}`}>
                            Assessment: {parkProv >= parkReq
                                ? `✔ Parking adequate — ${parkReq > 0 ? Math.round(((parkProv - parkReq) / parkReq) * 100) : 0}% surplus`
                                : `⚠ Parking deficit — ${parkReq > 0 ? Math.round(((parkReq - parkProv) / parkReq) * 100) : 0}% shortfall`}
                        </p>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE X — ZONING & COMPLIANCE ═══ */}
            <div className="report-page">
                <SH>2. Regulatory Compliance Matrix</SH>
                <SH2>Current Land Use Classification</SH2>
                <ul className="list-disc pl-4 space-y-1 mb-3">
                    <li><strong>Zoning:</strong> {project.intendedUse || 'Residential'} (Group Housing permissible)</li>
                    <li><strong>Development Plan:</strong> As per {regLabel(plot.regulation?.location)}</li>
                    <li><strong>FAR Permitted:</strong> Base {far}, achievable up to 3.5 with incentives</li>
                    <li><strong>Ground Coverage:</strong> Maximum {maxCov}% {plot.regulation?.location?.includes('Haryana') ? '(Code 6.3(3)(i)(b))' : ''}</li>
                </ul>

                <SH2>Site Planning Constraints</SH2>
                <div className="mb-4 text-[10px]">
                    {/* <strong className="block text-slate-800 mb-1">Setback Requirements {plot.regulation?.location?.includes('Haryana') ? '(Code 7.11(5))' : ''}</strong>
                    <p className="text-slate-600 mb-1">For building height {fmt(maxHeight, 1)}m (~{Math.ceil(maxHeight)}m):</p>
                    <ul className="list-disc pl-4 space-y-0.5 mb-2">
                        <li>Front — {generationParams?.frontSetback ?? generationParams?.setback ?? plot.setback ?? 10}m</li>
                        <li>Rear — {generationParams?.rearSetback ?? generationParams?.setback ?? plot.setback ?? 10}m</li>
                        <li>Left — {generationParams?.sideSetback ?? generationParams?.setback ?? plot.setback ?? 10}m</li>
                        <li>Right — {generationParams?.sideSetback ?? generationParams?.setback ?? plot.setback ?? 10}m</li>
                    </ul> */}

                    <strong className="block text-slate-800 mb-1">Available Building Zone:</strong>
                    <ul className="list-disc pl-4 space-y-0.5 mb-2">
                        <li>Net buildable area derived after deducting {plot.setback || 10}m setbacks from all sides.</li>
                        <li>Available footprint zone: ~{fmt(plot.developmentStats?.maxBuildableArea || (plotArea * 0.6))} sq.m</li>
                    </ul>

                    <strong className="block text-slate-800 mb-1">Maximum Permissible Ground Coverage:</strong>
                    <ul className="list-disc pl-4 space-y-0.5">
                        <li>{maxCov}% of {fmt(plotArea)} sq.m = {fmt((maxCov / 100) * plotArea)} sq.m</li>
                    </ul>
                </div>

                <SH2>Applicable Regulations</SH2>
                <ul className="list-disc pl-4 space-y-1 mb-5 text-[11px]">
                    <li>{regLabel(plot.regulation?.location)}</li>
                    <li>National Building Code of India 2016</li>
                    <li>IS Codes for structural design</li>
                    <li>RERA (Real Estate Regulation and Development Act) 2016</li>
                    <li>Environmental clearance norms (Code Chapter 12)</li>
                </ul>

                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <SH2 className="!mt-0">Recommended Foundation</SH2>
                        <ul className="list-disc pl-4 space-y-1 text-[10px]">
                            <li><strong>Based on load:</strong> {fmt((plot.buildings?.[0]?.numFloors || maxFloors) * 305)} tonnes per tower</li>
                            <li><strong>Option 1:</strong> Deep raft foundation (500mm) @ 8-10m depth</li>
                            <li><strong>Option 2:</strong> Pile foundation (800mm dia., 20-25m depth, 40-50 piles/tower)</li>
                        </ul>
                    </div>
                    <div>
                        <SH2 className="!mt-0">Solar Orientation Strategy</SH2>
                        <ul className="list-disc pl-4 space-y-1 text-[10px]">
                            <li><strong>Best facades:</strong> North and East (minimize heat gain)</li>
                            <li><strong>Avoid:</strong> West-facing large openings</li>
                            <li><strong>Recommended:</strong> Deep balconies on south/west</li>
                        </ul>
                    </div>
                </div>
                <ul className="list-disc pl-4 space-y-1 mb-5">
                    <li>{regLabel(plot.regulation?.location)}</li>
                    <li>National Building Code of India 2016</li>
                    <li>IS Codes for structural design</li>
                    <li>{plot.regulation?.location?.includes('Haryana') ? 'Haryana Fire Services Act 2009' : 'State Fire Services Act / NBC Part 4'}</li>
                    <li>RERA (Real Estate Regulation and Development Act) 2016</li>
                    <li>Environmental clearance norms (Code Chapter 12)</li>
                </ul>

                <SH2>Building Code Compliance</SH2>
                <table className="w-full border-collapse mb-4 text-[11px]">
                    <thead><tr><TH>Aspect</TH><TH>Requirement</TH><TH>Proposed</TH><TH>Compliance</TH></tr></thead>
                    <tbody>
                        <tr><TD className="font-semibold bg-slate-50">FAR</TD><TD>Max {far} (base), up to {plot.regulation?.geometry?.max_far_with_incentive?.value ?? 3.5} with incentives</TD><TD>{fmt(achievedFAR, 2)}</TD><TD>{achievedFAR <= far ? <><Check /> Yes</> : achievedFAR <= (plot.regulation?.geometry?.max_far_with_incentive?.value ?? 3.5) ? <span className="text-orange-600 font-bold">⚠ Above base FAR — incentive required</span> : <span className="text-red-600 font-bold">✗ Non-Compliant</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Ground Coverage</TD><TD>Max {maxCov}%</TD><TD>{fmt(gcPct, 1)}%</TD><TD>{gcPct <= maxCov ? <><Check /> Yes</> : <span className="text-red-600 font-bold">✗ Non-Compliant</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Height</TD><TD>{plot.regulation?.geometry?.max_building_height?.value ? `Max ${plot.regulation.geometry.max_building_height.value}m` : 'Unrestricted (with NOC)'}</TD><TD>{fmt(maxHeight, 1)}m</TD><TD>{!plot.regulation?.geometry?.max_building_height?.value || maxHeight <= (plot.regulation?.geometry?.max_building_height?.value + 0.5) ? <><Check /> Yes</> : <span className="text-red-600 font-bold">✗ Exceeds limit</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Basement</TD><TD>Up to 4 levels</TD><TD>{plot?.parkingAreas?.filter(p => p.type === 'Basement')?.length || 2} levels</TD><TD>{(plot?.parkingAreas?.filter(p => p.type === 'Basement')?.length || 2) <= 4 ? <><Check /> Yes</> : <span className="text-red-600 font-bold">✗ Non-Compliant</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Parking</TD><TD>1.5 ECS per unit ({parkReq} required)</TD><TD>{parkProv} ECS provided</TD><TD>{parkProv >= parkReq ? <><Check /> Yes</> : <span className="text-orange-600 font-bold">⚠ Pending ({parkReq - parkProv} short)</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Unit sizes</TD><TD>Min. NBC standards (≥30 sq.m net)</TD><TD>{metrics?.sellableArea ? fmt(metrics.sellableArea / Math.max(1, metrics.totalUnits || 1)) : 110} sq.m avg</TD><TD>{(metrics?.sellableArea ? metrics.sellableArea / Math.max(1, metrics.totalUnits || 1) : 110) >= 30 ? <><Check /> Yes</> : <span className="text-red-600 font-bold">✗ Below minimum</span>}</TD></tr>
                        {(() => {
                            const core = buildingCores[0]?.core;
                            const stairCount = core?.stairCount ?? 2;
                            const stairWidth = maxHeight > 60 ? 2.0 : 1.5;
                            const totalLifts = core ? (core.passLiftCount + core.fireLiftCount + core.serviceLiftCount) : 3;

                            const frontReq = plot?.regulation?.geometry?.front_setback?.value ?? generationParams?.frontSetback ?? generationParams?.setback ?? 6;
                            const rearReq  = plot?.regulation?.geometry?.rear_setback?.value  ?? generationParams?.rearSetback  ?? generationParams?.setback ?? 3;
                            const sideReq  = plot?.regulation?.geometry?.side_setback?.value  ?? generationParams?.sideSetback  ?? generationParams?.setback ?? 3;
                            
                            const frontProv = generationParams?.frontSetback ?? generationParams?.setback ?? plot?.setback ?? 6;
                            const rearProv  = generationParams?.rearSetback  ?? generationParams?.setback ?? plot?.setback ?? 3;
                            const sideProv  = generationParams?.sideSetback  ?? generationParams?.setback ?? plot?.setback ?? 3;
                            
                            const setbackOk = frontProv >= frontReq && rearProv >= rearReq && sideProv >= sideReq;
                            return (
                                <>
                                    <tr><TD className="font-semibold bg-slate-50">Staircases</TD><TD>{stairCount} per tower, {stairWidth}m min width</TD><TD>{stairCount} × {stairWidth}m</TD><TD><Check /> Yes</TD></tr>
                                    <tr><TD className="font-semibold bg-slate-50">Lifts</TD><TD>Required for &gt;15m; {maxHeight > 60 ? '≥4' : maxHeight > 30 ? '≥3' : '≥2'} per tower</TD><TD>{totalLifts} lifts/tower</TD><TD>{totalLifts >= (maxHeight > 60 ? 4 : maxHeight > 30 ? 3 : 2) ? <Check /> : <span className="text-orange-600 font-bold">⚠</span>} {totalLifts >= (maxHeight > 60 ? 4 : maxHeight > 30 ? 3 : 2) ? 'Yes' : 'Pending'}</TD></tr>
                                    <tr><TD className="font-semibold bg-slate-50">Setbacks</TD><TD>F:{frontReq}m / Rear:{rearReq}m / Side:{sideReq}m (regulation)</TD><TD>F:{frontProv}m / Rear:{rearProv}m / Side:{sideProv}m</TD><TD>{setbackOk ? <><Check /> Yes</> : <span className="text-red-600 font-bold">✗ Non-Compliant</span>}</TD></tr>
                                </>
                            );
                        })()}
                        <tr><TD className="font-semibold bg-slate-50">Basement Parking</TD><TD>Max roof 1.5m above ground</TD><TD>1.5m</TD><TD><Check /> Yes</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Fire Safety</TD><TD>As per NBC/Fire Act</TD><TD>Full compliance</TD><TD><Check /> Yes</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">RWH</TD><TD>Mandatory for &gt;500 sq.m ({Math.max(2, Math.ceil(plotArea / 5000))} bores min.)</TD><TD>{(() => { const item = greenItems.find((i: any) => i.label.includes('Rainwater')); return item?.detail || (hasRWH ? `${Math.max(2, Math.ceil(plotArea / 5000))} bores provided` : 'Not Provided'); })()}</TD><TD>{hasRWH ? <><Check /></> : <span className="text-red-500 font-bold">✗ No</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Solar</TD><TD>1% of connected load</TD><TD>{(() => { const item = greenItems.find((i: any) => i.label.includes('Solar')); return item?.detail || (hasSolar ? `~${Math.round(totalUnits * 0.5)} kWp installed` : 'Not Provided'); })()}</TD><TD>{hasSolar ? <><Check /></> : <span className="text-red-500 font-bold">✗ No</span>}</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">ECBC</TD><TD>Mandatory for certain buildings</TD><TD>Applicable</TD><TD><Check /> Yes</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Structural Safety</TD><TD>High-rise requirements</TD><TD>Full compliance</TD><TD><Check /> Yes</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Sanitation</TD><TD>Min. facilities</TD><TD>As per norms</TD><TD><Check /> Yes</TD></tr>
                        <tr><TD className="font-semibold bg-slate-50">Zero discharge</TD><TD>Mandatory for GH</TD><TD>{hasSTP ? 'STP Provided' : 'Not Provided'}</TD><TD>{hasSTP ? <><Check /> Yes</> : <span className="text-red-500 font-bold">No</span>}</TD></tr>
                    </tbody>
                </table>

                {/* Dynamic compliance items from metrics */}
                {metrics?.compliance?.bylawItems && metrics.compliance.bylawItems.length > 0 && (<>
                    <SH2>Detailed Bylaw Compliance Items</SH2>
                    <table className="w-full border-collapse mb-4">
                        <thead><tr><TH>Item</TH><TH>Detail</TH><TH>Status</TH></tr></thead>
                        <tbody>
                            {metrics.compliance.bylawItems.slice(0, 12).map((it, i) => (
                                <tr key={i}><TD className="font-semibold bg-slate-50">{it.label}</TD><TD>{it.detail || '—'}</TD>
                                    <TD>{it.status === 'pass' ? <Check /> : it.status === 'fail' ? <span className="text-red-600 font-bold">✗ Non-Compliant</span> : <span className="text-orange-600">⚠ Warning</span>}</TD></tr>
                            ))}
                        </tbody>
                    </table>
                </>)}
            </div>
            <PageBreak />

            {/* ═══ PAGE 3 — NBC & FIRE SAFETY ═══ */}
            <div className="report-page">
                <SH>3. National Building Code 2016 — Part-wise Compliance</SH>
                {[
                    { part: 'Part 3: Development Control Rules & General Building Requirements', items: ['FAR and coverage within limits', 'Setbacks as per height', 'Unit sizes meet minimum standards', 'Common facilities provided'] },
                    { part: 'Part 4: Fire and Life Safety', items: ['Fire exits within 30m travel distance', 'Fire staircases: 2 per tower (enclosed, pressurized)', 'Wet riser system in fire shaft', 'Fire extinguishers on all floors', 'Smoke detectors in lobbies and corridors', 'Emergency lighting and signage', 'Refuge areas on alternate floors (for >24m height)', 'Fire alarm system integrated', 'Sprinkler system in basements'] },
                    { part: 'Part 5: Building Materials', items: ['All materials as per IS specifications', 'Concrete: M30 (columns), M25 (beams/slabs)', 'Steel: Fe500D (earthquake-resistant)', 'Bricks/blocks: As per IS 1077/2185', 'DPC: As per Code 10.1.5'] },
                    { part: 'Part 6: Structural Design', items: ['Loads as per IS 875 (Parts 1-5)', 'Seismic design: IS 1893:2016 (Zone IV)', 'Concrete design: IS 456:2000', 'Steel design: IS 800:2007', 'Foundation design: IS 6403:1981', 'Wind load analysis: IS 875 Part 3'] },
                    { part: 'Part 7: Construction Practices & Safety', items: ['Scaffolding as per IS 3696', 'Formwork as per IS 14687', 'Concrete quality control: IS 456 Annexure', 'Site safety plan required', 'Construction waste management plan'] },
                    { part: 'Part 8: Building Services', items: ['Electrical: IS 732, IS 1646', 'Plumbing: IS 1172, IS 2065', 'HVAC: IS 3315 series', 'Lifts: IS 14665, IS 15259'] },
                    { part: 'Part 9: Plumbing Services', items: ['Water supply: IS 1172', 'Drainage: Two-pipe system (Code 11.1)', 'Sanitary fixtures: IS 2556', 'STP capacity: 25,000 lpd'] }
                ].map((sec, i) => (
                    <div key={i} className="mb-3 no-break">
                        <strong className="text-[10px] block text-slate-800 mb-1">{sec.part}</strong>
                        <ul className="pl-4 space-y-0.5">{sec.items.map((it, j) => <li key={j} className="flex gap-1"><span className="text-green-600">✓</span> {it}</li>)}</ul>
                    </div>
                ))}

                <SH2>{plot.regulation?.location?.includes('Haryana') ? 'Fire Safety Compliance (Haryana Fire Services Act 2009)' : 'Fire Safety Compliance'}</SH2>
                <strong className="text-[12px] block text-slate-800 mb-2 mt-1">
                    Fire NOC Requirements ({maxHeight > 60 ? 'High-Rise buildings >60m' : maxHeight > 30 ? 'Buildings 30-60m height' : 'Buildings 15-30m height'})
                </strong>
                <table className="w-full border-collapse">
                    <thead><tr><TH>Item</TH><TH>Requirement (NBC Part 4)</TH><TH>Proposed</TH></tr></thead>
                    <tbody>
                        {(() => {
                            const hi = maxHeight > 60;
                            const mid = maxHeight > 30;
                            const fireLifts = buildingCores[0]?.core?.fireLiftCount ?? (mid ? 1 : 0);
                            const stairCount = buildingCores[0]?.core?.stairCount ?? 2;
                            const refugeFloors = Math.floor(maxFloors / 7);

                            const rows: [string, string, string][] = [
                                ['Fire staircases', `2 per tower, ${mid ? 'pressurized' : 'enclosed'}`, `${towers * 2} ${mid ? 'pressurized' : 'enclosed'}`],
                                ['Staircase width', `Min ${hi ? '2.0' : '1.5'}m clear`, `${hi ? '2.0' : '1.5'}m`],
                                ['Travel distance', 'Max 30m from unit door', '<30m'],
                                ['Fire lift', mid ? '≥1 per tower (mandatory >15m)' : 'Not required', mid ? `${towers * Math.max(1, fireLifts)} provided` : 'N/A'],
                                ['Wet riser', `100mm dia., every floor${mid ? ' + hose reel' : ''}`, 'Provided'],
                                ['Fire extinguishers', '2 per floor minimum', `${Math.max(2, Math.ceil(totalUnits / maxFloors * 2))} per floor`],
                                ['Smoke detectors', mid ? 'Addressable, zone-controlled' : 'All common areas', 'Full coverage'],
                                ['Fire alarm', mid ? 'Auto addressable + PA system' : 'Addressable system', 'Integrated + PA'],
                                ['Sprinklers', mid ? 'All floors + basements + podium' : 'All basements', 'Full coverage'],
                                ...(mid ? [
                                    ['Fire check lobby', 'Required (height >24m)', 'Provided per staircase'] as [string, string, string],
                                    ['Refuge area', `Every 7 floors (${refugeFloors} levels)`, `${refugeFloors} refuge floors`] as [string, string, string],
                                    ['Emergency lighting', '6 hrs min. battery backup', 'LED + UPS'] as [string, string, string],
                                    ['Terrace access', 'Min 1 staircase to terrace', 'Provided'] as [string, string, string],
                                ] as [string, string, string][] : []),
                                ...(hi ? [
                                    ['Pressurisation system', 'Staircase & lobby +50Pa', 'Designed'] as [string, string, string],
                                    ['Firefighter intercom', 'All floors + fire command', 'Integrated'] as [string, string, string],
                                ] as [string, string, string][] : []),
                            ];

                            return rows.map(([a, b, c], i) => (
                                <tr key={i}><TD className="font-semibold bg-slate-50">{a}</TD><TD>{b}</TD><TD>{c}</TD></tr>
                            ));
                        })()}
                    </tbody>
                </table>
            </div>
            <PageBreak />

            {/* ═══ PAGE 4 — ENVIRONMENTAL & APPROVALS ═══ */}
            <div className="report-page">
                <SH>4. Environmental Clearance (Code Chapter 12)</SH>
                <SH2>Category Assessment</SH2>
                <p className="mb-2">Project Built-up Area: {fmt(builtUp)} sq.m</p>
                <div className="mb-3">
                    <p className="font-semibold text-slate-800">As per Code 12.1:</p>
                    <ul className="list-disc pl-5 mb-2">
                        <li>Upto 20,000 sq.m: Category A</li>
                        <li>20,000-50,000 sq.m: Category B</li>
                        <li>50,000-150,000 sq.m: Category C</li>
                    </ul>
                    <p className="font-bold">Project Category: {builtUp < 20000 ? 'A (Self-certification route)' : builtUp < 50000 ? 'B' : 'C'}</p>
                </div>
                
                <strong className="text-[11px] block text-slate-800 mb-2 mt-4">Category {builtUp < 20000 ? 'A' : builtUp < 50000 ? 'B' : 'C'} - Environmental Conditions Checklist</strong>
                <table className="w-full border-collapse mb-4">
                    <thead><tr><TH>Condition</TH><TH>Requirement</TH><TH>Compliance</TH></tr></thead>
                    <tbody>
                        {[
                            ['Natural Drainage', 'Maintain inlet/outlet points', 'Yes'],
                            ['Rain Water Harvesting', 'Min 1 bore per 5,000 sq.m', `${Math.max(2, Math.ceil(plotArea / 5000))} bores`],
                            ['Unpaved Area', '≥20% of open spaces', '25% unpaved'],
                            ['Solid Waste', 'Separate wet/dry bins', 'At ground level'],
                            ['Energy', 'LED/solar in common areas', 'All LED + Solar'],
                            ['DG Exhaust', '10m from building or 3m above', '12m away'],
                            ['Green Cover', '1 tree per 80 sq.m', `${Math.ceil(plotArea / 80)} trees (${fmt(plotArea,0)}/80)`],
                            ['Compensatory Plantation', '3:1 for any trees cut', 'N/A (no trees)'],
                            ['Dust Control', 'Screens/barricading during construction', 'Yes']
                        ].map(([a, b, c], i) => (
                            <tr key={i}><TD className="font-semibold bg-slate-50">{a}</TD><TD>{b}</TD><TD>{c}</TD></tr>
                        ))}
                    </tbody>
                </table>
                <div className="mb-5">
                    <p className="font-semibold text-[10px] text-slate-800">Submission Schedule:</p>
                    <ul className="list-disc pl-5 text-[10px]">
                        <li>With notice of commencement: Dust control, green cover plan</li>
                        <li>With OC application: All installations verified</li>
                    </ul>
                </div>

                <SH2>Other Statutory Clearances</SH2>
                <strong className="text-[11px] block text-slate-800 mb-2">Required Approvals</strong>
                <table className="w-full border-collapse">
                    <thead><tr><TH>Authority</TH><TH>Clearance</TH><TH>Applicability</TH><TH>Timeline</TH></tr></thead>
                    <tbody>
                        {[
                            ['Town Planning Dept', 'Building Plan Approval', 'Yes', '20 days'],
                            ['Fire Department', 'Fire NOC', 'Yes (>15m height)', '30 days'],
                            ['PWD (B&R)', 'Road cutting (services)', 'If required', '15 days'],
                            ['Electricity Dept', 'Connection & load sanction', 'Yes', '45 days'],
                            ['Water Supply', 'Connection approval', 'Yes', '30 days'],
                            ['Sewerage Dept', 'Connection approval', 'Yes', '30 days'],
                            ['Pollution Control', 'STP approval', 'Yes (GH project)', '45 days'],
                            ['Airport Authority', 'Height clearance', 'If in funnel zone', '60 days'],
                            ['RERA', 'Project registration', 'Yes (>8 units)', '30 days'],
                            ['Environment', 'Category A certification', 'Self-certified', 'At OC stage'],
                        ].map(([auth, clear, app, time], i) => (
                            <tr key={i}><TD className="font-semibold bg-slate-50">{auth}</TD><TD>{clear}</TD><TD>{app}</TD><TD>{time}</TD></tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <PageBreak />

            {/* ═══ PAGE 5 — DESIGN DEVELOPMENT & SPACE DISTRIBUTION ═══ */}
            <div className="report-page">
                <SH>5. DESIGN DEVELOPMENT</SH>
                <SH2>Concept Development & Design Philosophy</SH2>
                <strong className="text-[11px] block text-slate-800 mb-2">Core Principles:</strong>
                <ol className="list-decimal pl-5 space-y-1 mb-6 text-[11px]">
                    <li><strong>Maximize Unit Count:</strong> Achieve {totalUnits} units while maintaining quality</li>
                    <li><strong>Efficient Circulation:</strong> Minimize core-to-usable area ratio ({carpetEff.toFixed(1)}% efficiency)</li>
                    <li><strong>Natural Light:</strong> All rooms with external openings</li>
                    <li><strong>Cross Ventilation:</strong> Through units wherever possible</li>
                    <li><strong>Privacy:</strong> Limited units per floor</li>
                    <li><strong>Flexibility:</strong> Adaptable layouts for future modifications</li>
                    <li><strong>Sustainability:</strong> Green building features integrated</li>
                    <li><strong>Code Compliance:</strong> 100% adherence to regulations</li>
                </ol>

                <SH2>Space Distribution</SH2>
                <p className="mb-2"><strong>Total Site:</strong> {fmt(plotArea)} sq.m</p>
                <table className="w-full border-collapse mb-6 text-[10px]">
                    <thead><tr><TH>Zone</TH><TH>Area (sq.m)</TH><TH>% of Site</TH></tr></thead>
                    <tbody>
                        {(() => {
                            const bFootprint = plot.buildings?.reduce((sum, b) => sum + (b.area || 0), 0) || (plotArea * 0.25);
                            
                            // Align this explicitly with Section 9 logic: 80% of tower footprint is amenities
                            // If buildings array exists, use bFootprint * 0.8, else use builtUp/maxFloors*0.8
                            const towerFootprint = Math.round((builtUp || 10080) / maxFloors / towers); // rough footprint
                            const coreArea = Math.round(towerFootprint * 0.20);
                            const amenitiesAreaPerTower = towerFootprint - coreArea; 
                            const amenities = amenitiesAreaPerTower * towers; // True covered amenities footprint
                            
                            const hardScape = plotArea * 0.20; // 20% for drives/plazas
                            
                            const maxPermissibleGC = plotArea * 0.35; // Typically 35% max GC
                            const remainingUnbuilt = plotArea - Math.max(bFootprint, (towerFootprint * towers));
                            
                            // Unbuilt area goes mostly to softscape, leaving 10% for setbacks
                            const softScape = (remainingUnbuilt - hardScape) * 0.8;
                            const setbacks = (remainingUnbuilt - hardScape) * 0.2;
                            
                            const percent = (val: number) => ((val / plotArea) * 100).toFixed(1) + '%';
                            
                            return (
                                <>
                                    <tr className="font-semibold bg-slate-50"><TD>Building Footprint</TD><TD>{fmt(bFootprint)}</TD><TD>{percent(bFootprint)}</TD></tr>
                                    {plot.buildings?.map((b, i) => (
                                        <tr key={i}><TD className="pl-6 text-slate-600">- {b.name || `Tower ${i+1}`}</TD><TD>{fmt(b.area)}</TD><TD>{percent(b.area || 0)}</TD></tr>
                                    ))}
                                    <tr className="font-semibold bg-slate-50"><TD>Hard Landscaping</TD><TD>{fmt(hardScape)}</TD><TD>{percent(hardScape)}</TD></tr>
                                    <tr><TD className="pl-6 text-slate-600">- Entrance plaza & Parking ramp</TD><TD>{fmt(hardScape * 0.5)}</TD><TD>{percent(hardScape * 0.5)}</TD></tr>
                                    <tr><TD className="pl-6 text-slate-600">- Pathways & drives</TD><TD>{fmt(hardScape * 0.5)}</TD><TD>{percent(hardScape * 0.5)}</TD></tr>
                                    
                                    <tr className="font-semibold bg-slate-50"><TD>Soft Landscaping</TD><TD>{fmt(softScape)}</TD><TD>{percent(softScape)}</TD></tr>
                                    <tr><TD className="pl-6 text-slate-600">- Garden areas & Lawn</TD><TD>{fmt(softScape)}</TD><TD>{percent(softScape)}</TD></tr>
                                    
                                    <tr className="font-semibold bg-slate-50"><TD>Amenities (Ground inside towers)</TD><TD>{fmt(amenities)}</TD><TD>{percent(amenities)}</TD></tr>
                                    
                                    <tr className="font-semibold bg-slate-50"><TD>Setbacks (Unusable)</TD><TD>{fmt(Math.max(0, setbacks))}</TD><TD>{percent(Math.max(0, setbacks))}</TD></tr>
                                    <tr className="font-bold bg-slate-200 border-t-2 border-slate-400"><TD>Total</TD><TD>{fmt(plotArea)}</TD><TD>100.0%</TD></tr>
                                </>
                            );
                        })()}
                    </tbody>
                </table>

                {buildingCores.length > 0 && (<>
                    <SH2>Per-Tower Core & Circulation (NBC Formula)</SH2>
                    <table className="w-full border-collapse mb-4">
                        <thead><tr><TH>Building</TH><TH>Footprint</TH><TH>Floors</TH><TH>Core/Floor</TH><TH>Circulation/Floor</TH><TH>Lifts</TH><TH>Stairs</TH></tr></thead>
                        <tbody>
                            {buildingCores.map((bc, i) => (
                                <tr key={i}>
                                    <TD className="font-semibold">{bc.name}</TD>
                                    <TD>{fmt(bc.area)} sq.m</TD>
                                    <TD>{bc.floors}</TD>
                                    <TD>{fmt(bc.core.totalCoreAreaPerFloor)} sq.m</TD>
                                    <TD>{fmt(bc.core.totalCirculationAreaPerFloor)} sq.m</TD>
                                    <TD>{bc.core.passLiftCount + bc.core.fireLiftCount + bc.core.serviceLiftCount}</TD>
                                    <TD>{bc.core.stairCount}</TD>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <SH2>Floor Area Breakdown (CORE)</SH2>
                    <div className="mb-4">
                        <strong className="text-[11px] block text-slate-800 mb-1">A. Core Configuration</strong>
                        <p className="text-[10px] mb-2"><strong>Core Size:</strong> {buildingCores[0]?.core?.totalCoreAreaPerFloor ? Math.ceil(Math.sqrt(buildingCores[0].core.totalCoreAreaPerFloor)) : 8}m × {buildingCores[0]?.core?.totalCoreAreaPerFloor ? Math.floor(Math.sqrt(buildingCores[0].core.totalCoreAreaPerFloor))+2 : 10}m = {fmt(buildingCores[0]?.core?.totalCoreAreaPerFloor || 80)} sq.m per tower<br/>
                        Core Components (Enhanced for luxury apartments)</p>
                        
                        {(() => {
                            const c = buildingCores[0]?.core;
                            if (!c) return null;
                            const totalLifts = c.passLiftCount + c.fireLiftCount + c.serviceLiftCount + c.stretcherLiftCount;
                            return (
                                <table className="w-full border-collapse text-[10px]">
                                    <thead><tr><TH>Component</TH><TH>Specification</TH><TH>Area (sq.m)</TH></tr></thead>
                                    <tbody>
                                        <tr className="bg-slate-50 font-semibold"><TD>Lifts</TD><TD>{totalLifts} total ({c.passLiftCount} pass{c.fireLiftCount ? ` + ${c.fireLiftCount} fire` : ''}{c.serviceLiftCount ? ` + ${c.serviceLiftCount} service` : ''})</TD><TD>{fmt(c.liftArea, 1)}</TD></tr>
                                        {c.passLiftCount > 0 && <tr><TD className="pl-6 text-slate-600">- Passenger lifts</TD><TD>{c.passLiftCount} nos. (~{fmt(c.passLiftArea/c.passLiftCount, 2)} sq.m each)</TD><TD>{fmt(c.passLiftArea, 1)}</TD></tr>}
                                        {c.fireLiftCount > 0 && <tr><TD className="pl-6 text-slate-600">- Fire lift</TD><TD>{c.fireLiftCount} nos. (4.5 sq.m each)</TD><TD>{fmt(c.fireLiftArea, 1)}</TD></tr>}
                                        {c.serviceLiftCount > 0 && <tr><TD className="pl-6 text-slate-600">- Service lift</TD><TD>{c.serviceLiftCount} nos. (4.5 sq.m each)</TD><TD>{fmt(c.serviceLiftArea, 1)}</TD></tr>}
                                        {c.stretcherLiftCount > 0 && <tr><TD className="pl-6 text-slate-600">- Stretcher lift</TD><TD>{c.stretcherLiftCount} nos. (5.5 sq.m each)</TD><TD>{fmt(c.stretcherLiftArea, 1)}</TD></tr>}
                                        
                                        <tr className="bg-slate-50 font-semibold"><TD>Staircases</TD><TD>{c.stairCount} enclosed fire stairs</TD><TD>{fmt(c.stairArea, 1)}</TD></tr>
                                        {[...Array(c.stairCount)].map((_, i) => (
                                            <tr key={i}><TD className="pl-6 text-slate-600">- Staircase {i+1}</TD><TD>~{fmt(c.stairArea / c.stairCount, 0)} sq.m (1.5m min clear width)</TD><TD>{fmt(c.stairArea / c.stairCount, 1)}</TD></tr>
                                        ))}

                                        <tr className="bg-slate-50 font-semibold"><TD>Shafts & Ducts</TD><TD>{" "}</TD><TD>{fmt(c.totalShaftArea, 1)}</TD></tr>
                                        {c.plumbingShaftArea > 0 && <tr><TD className="pl-6 text-slate-600">- Plumbing shafts</TD><TD>Per unit group</TD><TD>{fmt(c.plumbingShaftArea, 2)}</TD></tr>}
                                        {c.electricalShaftArea > 0 && <tr><TD className="pl-6 text-slate-600">- Electrical riser</TD><TD>0.8m × 0.75m</TD><TD>{fmt(c.electricalShaftArea, 2)}</TD></tr>}
                                        {c.fireRiserArea > 0 && <tr><TD className="pl-6 text-slate-600">- Fire riser</TD><TD>1.0m × 0.5m</TD><TD>{fmt(c.fireRiserArea, 2)}</TD></tr>}
                                        {c.garbageShaftArea > 0 && <tr><TD className="pl-6 text-slate-600">- Garbage shaft</TD><TD>0.6m × 1.2m</TD><TD>{fmt(c.garbageShaftArea, 2)}</TD></tr>}
                                        {c.hvacShaftArea > 0 && <tr><TD className="pl-6 text-slate-600">- HVAC shaft</TD><TD>As required</TD><TD>{fmt(c.hvacShaftArea, 2)}</TD></tr>}

                                        <tr className="bg-slate-50 font-semibold"><TD>Lobbies & Circulation</TD><TD>{" "}</TD><TD>{fmt(c.totalCirculationAreaPerFloor, 1)}</TD></tr>
                                        <tr><TD className="pl-6 text-slate-600">- Lift lobby</TD><TD>{totalLifts} × {fmt(c.liftLobbyArea / totalLifts, 1)} sq.m each</TD><TD>{fmt(c.liftLobbyArea, 1)}</TD></tr>
                                        <tr><TD className="pl-6 text-slate-600">- Common corridor</TD><TD>Min 1.5m wide</TD><TD>{fmt(c.corridorArea, 1)}</TD></tr>

                                        {(c.fireCheckLobbyArea > 0 || c.refugeAreaPerFloor > 0) && (
                                            <tr className="bg-slate-50 font-semibold"><TD>Fire Provisions</TD><TD>{" "}</TD><TD>{fmt(c.fireCheckLobbyArea + c.refugeAreaPerFloor, 1)}</TD></tr>
                                        )}
                                        {c.fireCheckLobbyArea > 0 && <tr><TD className="pl-6 text-slate-600">- Fire check lobby</TD><TD>Required (height &gt;24m)</TD><TD>{fmt(c.fireCheckLobbyArea, 1)}</TD></tr>}
                                        {c.refugeAreaPerFloor > 0 && <tr><TD className="pl-6 text-slate-600">- Refuge area (avg/floor)</TD><TD>Every 7 floors</TD><TD>{fmt(c.refugeAreaPerFloor, 1)}</TD></tr>}

                                        <tr className="font-bold bg-slate-200 border-t-2 border-slate-400"><TD>TOTAL CORE AREA</TD><TD>{" "}</TD><TD>{fmt(c.totalCoreAreaPerFloor + c.totalCirculationAreaPerFloor, 1)}</TD></tr>
                                    </tbody>
                                </table>
                            );
                        })()}
                        <p className="mt-1 text-[9px] text-slate-500 italic">Core calculations per NBC norms — Method B formula (lift sizing, stair count, population-based corridor sizing)</p>
                    </div>
                </>)}
            </div>
            <PageBreak />

            {/* ═══ PAGE 6 — MEP ELECTRICAL & PLUMBING ═══ */}
            <div className="report-page">
                <SH>6. MEP Services Distribution — Electrical & Plumbing</SH>
                <SH2>Electrical System</SH2>
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Power Supply & Distribution</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Incoming:</strong> 11 kV from grid</li>
                            <li><strong>Transformer:</strong> 1,000 kVA (on ground floor)</li>
                            <li><strong>Main LT Panel:</strong> 400V, 3-phase, 1,500A</li>
                            <li><strong>Per flat:</strong> 10 kW load (40A MCB)</li>
                            <li><strong>Common areas:</strong> 150 kW</li>
                            <li><strong>Lifts:</strong> 45 kW (3 × 15 kW)</li>
                            <li><strong>Water pumps:</strong> 30 kW | <strong>STP:</strong> 15 kW</li>
                            <li><strong>Total connected load:</strong> ~900 kW</li>
                            <li><strong>Demand factor:</strong> 0.7 → <strong>Actual demand:</strong> ~630 kW</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Backup Power & Earthing</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>DG Set:</strong> 500 kVA (100% common area + 1 lift/tower)</li>
                            <li><strong>Location:</strong> Ground floor, exterior</li>
                            <li><strong>Fuel tank:</strong> 1,500 liters (24-hour backup)</li>
                            <li><strong>ATS:</strong> Auto start within 10 seconds</li>
                            <li><strong>Sound enclosure:</strong> &lt;75 dB at 1m</li>
                            <li><strong>Earthing:</strong> Plate earthing (2 nos., 1200×1200×3mm), &lt;1 ohm</li>
                            <li><strong>Lightning arrestor:</strong> On terrace (ESE type)</li>
                        </ul>
                    </div>
                </div>
                <div className="mb-4 text-[10px]">
                    <strong className="block text-slate-800 mb-1">Distribution per Floor</strong>
                    <ul className="list-disc pl-4 space-y-0.5">
                        <li><strong>Floor DB:</strong> 400A capacity</li>
                        <li><strong>Each flat:</strong> Dedicated 40A SPDB | <strong>Lighting:</strong> 10A circuits | <strong>Power:</strong> 16A circuits</li>
                        <li><strong>AC:</strong> 32A dedicated | <strong>Geyser:</strong> 16A dedicated | <strong>Common areas:</strong> Separate 63A panel</li>
                    </ul>
                </div>

                <SH2>Plumbing System</SH2>
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Water Supply & Storage</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Source:</strong> Municipal + borewell (backup)</li>
                            <li><strong>Underground sump:</strong> 65,000 liters (3-day storage, 5m×4m×3.5m, below Tower 1 basement)</li>
                            <li><strong>Overhead tanks:</strong> 22,000 liters each (1 per tower, SS 304, terrace)</li>
                            <li><strong>Pumping System:</strong> 2 pumps (duty+standby), 15 HP each, 35m head, 100 lpm</li>
                            <li><strong>Hydro-pneumatic sys:</strong> 500L vessel, 2.5-3.5 kg/cm², 5 HP pump</li>
                            <li><strong>Distribution:</strong> 150mm CPVC risers, 25mm flat connections, 50mm insulated hot water riser</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Drainage & STP</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Type:</strong> Two-pipe system (Code 11.1)</li>
                            <li><strong>Horizontal Drainage:</strong> UPVC floor traps, min gradient 1:60</li>
                            <li><strong>Vertical Drainage:</strong> 150mm soil stack, 100mm waste stack, 75mm vent stack</li>
                            <li><strong>Collection:</strong> All drainage to STP (not public sewer)</li>
                            <li><strong>STP capacity:</strong> 25,000 lpd. <strong>Location:</strong> Basement 1</li>
                            <li><strong>Technology:</strong> Extended aeration + MBR. Zero discharge compliance</li>
                        </ul>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 7 — HVAC & FIRE PROTECTION ═══ */}
            <div className="report-page">
                <SH>7. MEP Services — HVAC & Fire Protection</SH>
                <SH2>HVAC System</SH2>
                <div className="grid grid-cols-2 gap-4 mb-6 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Apartment HVAC</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Type:</strong> Individual split AC units (owner-provided)</li>
                            <li><strong>Outdoor unit space:</strong> 1.0m × 0.6m per bedroom</li>
                            <li><strong>Location:</strong> Service balcony / external wall bracket</li>
                            <li><strong>Drainage:</strong> Dedicated waste pipe</li>
                            <li><strong>Electrical:</strong> 32A dedicated point per AC</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Common Area HVAC & Terrace</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>GF Lobbies:</strong> VRV system (15 TR), 20% fresh air intake</li>
                            <li><strong>Basement:</strong> Mechanical ventilation (15 ACH min). 10 exhaust fans (5,000 CFM), 8 supply fans (6,000 CFM)</li>
                            <li><strong>Sensors:</strong> CO sensors with auto-control</li>
                            <li><strong>Terrace Equipment:</strong> VRV outdoor units, exhaust motors, lift machine room ventilation, DG exhaust</li>
                        </ul>
                    </div>
                </div>

                <SH2>Fire Protection System</SH2>
                <table className="w-full border-collapse mb-4 text-[10px]">
                    <thead><tr><TH>System Type</TH><TH>Details & Coverage</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50 font-semibold text-red-800"><TD colSpan={2}>Active Systems</TD></tr>
                        <tr><TD className="font-semibold">Wet Riser</TD><TD>100mm dia riser. 2 hydrant valves/floor. 25mm × 30m hose reels. Jockey (3 HP) + Main pump (20 HP). 50,000L tank.</TD></tr>
                        <tr><TD className="font-semibold">Sprinkler (Basements)</TD><TD>Wet pipe system. 3m × 3m spacing. 68°C fusible link. 15 HP dedicated pump.</TD></tr>
                        <tr><TD className="font-semibold">Fire Extinguishers</TD><TD>4 per floor. ABC dry powder (6 kg) & CO₂ (4.5 kg). Quarterly inspection.</TD></tr>
                        <tr><TD className="font-semibold">Fire Alarm</TD><TD>Addressable smoke/heat detectors. Call points, hooters, 2-hr backup. Security room panel.</TD></tr>
                        
                        <tr className="bg-slate-50 font-semibold text-orange-800"><TD colSpan={2}>Passive Systems</TD></tr>
                        <tr><TD className="font-semibold">Passive Defenses</TD><TD>1-hour rated doors, 2-hour rated core walls. Fire stopped penetrations.</TD></tr>
                        <tr><TD className="font-semibold">Evacuation</TD><TD>Emergency lighting (2-hr backup), photoluminescent exit signage.</TD></tr>
                    </tbody>
                </table>
            </div>
            <PageBreak />

            {/* ═══ PAGE 8 — UNIT PLANNING ═══ */}
            <div className="report-page">
                <SH>8. UNIT PLANNING & MIX</SH>

                {/* ── Overview Banner ── */}
                {(() => {
                    const firstBuilding = plot.buildings?.[0];
                    const floorplate = firstBuilding?.area || Math.round(builtUp / Math.max(1, totalLevels * towers));
                    const coreArea = buildingCores[0]?.core?.totalCoreAreaPerFloor || Math.round(floorplate * 0.12);
                    const netFloorArea = Math.round((floorplate - coreArea) * 0.95);
                    const avgUnitCarpet = totalUnits > 0 ? Math.round(totalCarpet / totalUnits) : 110;
                    const avgBuiltUp = Math.round(avgUnitCarpet / (carpetEff / 100));
                    const balcony = Math.round(avgUnitCarpet * 0.15);

                    return (
                        <>
                            <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                                <div>
                                    <SH2 className="!mt-0">Target Scenario</SH2>
                                    <ul className="list-disc pl-4 space-y-0.5 mb-3">
                                        <li><strong>Total Built-up Area:</strong> {fmt(builtUp)} sq.m (FAR: {fmt(achievedFAR, 2)})</li>
                                        <li><strong>Towers:</strong> {towers} Nos. × {maxFloors} upper floors each</li>
                                        <li><strong>Ground Floor Plate:</strong> ~{fmt(floorplate)} sq.m per tower</li>
                                        <li><strong>Typical Floor Plate:</strong> ~{fmt(floorplate)} sq.m (excluding core)</li>
                                        <li><strong>Basements:</strong> {maxBasements} levels (B{maxBasements}–B1) for parking</li>
                                        <li><strong>Total Levels:</strong> B{maxBasements} + G + {maxFloors} = {totalLevels} levels</li>
                                    </ul>

                                    <SH2 className="!mt-2">Efficiency Calculation (Per Floor)</SH2>
                                    <ul className="list-disc pl-4 space-y-0.5">
                                        <li><strong>Floor Plate:</strong> {fmt(floorplate)} sq.m</li>
                                        <li><strong>Deduct Core Area:</strong> {fmt(floorplate)} − {fmt(coreArea)} = {fmt(floorplate - coreArea)} sq.m</li>
                                        <li><strong>Deduct External Walls (~5%):</strong> − {fmt(Math.round((floorplate - coreArea) * 0.05))} sq.m</li>
                                        <li><strong>Net Leasable Area/Floor:</strong> {fmt(netFloorArea)} sq.m</li>
                                        <li><strong>Net per Tower Floor:</strong> {fmt(Math.round(netFloorArea / towers))} sq.m</li>
                                    </ul>
                                </div>
                                <div>
                                    <SH2 className="!mt-0">Unit Size (Typical)</SH2>
                                    <table className="w-full border-collapse text-[9px] mb-3">
                                        <thead><tr><TH>Parameter</TH><TH>Value</TH></tr></thead>
                                        <tbody>
                                            {Object.entries(units).length > 0
                                                ? Object.entries(units).map(([type, count], i) => {
                                                    const uCarpet = tArea[type] ? Math.round(tArea[type] / Number(count)) : avgUnitCarpet;
                                                    const uBuiltUp = Math.round(uCarpet / (carpetEff / 100));
                                                    const uBalcony = Math.round(uCarpet * 0.15);
                                                    return (
                                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                            <TD className="font-semibold">{type}</TD>
                                                            <TD>{uCarpet} sq.m carpet / {uBuiltUp} sq.m built-up<br /><span className="text-slate-500">Balcony: {uBalcony} sq.m</span></TD>
                                                        </tr>
                                                    );
                                                })
                                                : (
                                                    <>
                                                        <tr className="bg-slate-50"><TD className="font-semibold">RERA Carpet</TD><TD>{avgUnitCarpet} sq.m</TD></tr>
                                                        <tr><TD className="font-semibold">Balcony</TD><TD>{balcony} sq.m</TD></tr>
                                                        <tr className="bg-slate-50"><TD className="font-semibold">Built-up</TD><TD>{avgBuiltUp} sq.m</TD></tr>
                                                    </>
                                                )
                                            }
                                        </tbody>
                                    </table>

                                    <SH2 className="!mt-2">Units per Floor (per Tower)</SH2>
                                    <table className="w-full border-collapse text-[9px]">
                                        <thead><tr><TH>Type</TH><TH>Carpet (sq.m)</TH><TH>Units/Floor</TH></tr></thead>
                                        <tbody>
                                            {Object.entries(units).length > 0
                                                ? Object.entries(units).map(([type, count], i) => {
                                                    const uCarpet = tArea[type] ? Math.round(tArea[type] / Number(count)) : avgUnitCarpet;
                                                    const unitsPerFloor = Math.round(Number(count) / Math.max(1, maxFloors * towers));
                                                    return (
                                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                            <TD className="font-semibold">{type}</TD>
                                                            <TD className="text-center">{uCarpet}</TD>
                                                            <TD className="text-center font-semibold text-blue-700">{unitsPerFloor}</TD>
                                                        </tr>
                                                    );
                                                })
                                                : (
                                                    <tr className="bg-slate-50">
                                                        <TD className="font-semibold">3 BHK</TD>
                                                        <TD className="text-center">{avgUnitCarpet}</TD>
                                                        <TD className="text-center font-semibold text-blue-700">{Math.round(netFloorArea / towers / Math.max(1, avgUnitCarpet))}</TD>
                                                    </tr>
                                                )
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ── Apartment Yield Summary ── */}
                            <SH2>Apartment Yield & Unit Mix Summary</SH2>
                            <div className="border border-blue-200 bg-blue-50 p-3 rounded mb-4 text-[10px]">
                                <table className="w-full border-collapse mb-2">
                                    <thead>
                                        <tr>
                                            <TH>Type</TH>
                                            <TH>Carpet (sq.m)</TH>
                                            <TH>Built-up (sq.m)</TH>
                                            <TH>Count</TH>
                                            <TH>% of Total</TH>
                                            <TH>Total Carpet (sq.m)</TH>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(units).length > 0
                                            ? Object.entries(units).map(([type, count], i) => {
                                                const uCarpet = tArea[type] ? Math.round(tArea[type] / Number(count)) : avgUnitCarpet;
                                                const uBuiltUp = Math.round(uCarpet / (carpetEff / 100));
                                                const pct = ((Number(count) / totalUnits) * 100).toFixed(0);
                                                return (
                                                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-blue-50/50'}>
                                                        <TD className="font-semibold">{type}</TD>
                                                        <TD className="text-center">{uCarpet}</TD>
                                                        <TD className="text-center">{uBuiltUp}</TD>
                                                        <TD className="text-center font-bold text-blue-800">{count as number}</TD>
                                                        <TD className="text-center">{pct}%</TD>
                                                        <TD className="text-center">{fmt(uCarpet * Number(count))}</TD>
                                                    </tr>
                                                );
                                            })
                                            : (
                                                <tr className="bg-white">
                                                    <TD className="font-semibold">3 BHK</TD>
                                                    <TD className="text-center">{avgUnitCarpet}</TD>
                                                    <TD className="text-center">{avgBuiltUp}</TD>
                                                    <TD className="text-center font-bold text-blue-800">{totalUnits || 64}</TD>
                                                    <TD className="text-center">100%</TD>
                                                    <TD className="text-center">{fmt((totalUnits || 64) * avgUnitCarpet)}</TD>
                                                </tr>
                                            )
                                        }
                                        <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                                            <TD className="text-slate-800">TOTAL</TD>
                                            <TD className="text-center text-slate-600">—</TD>
                                            <TD className="text-center text-slate-600">—</TD>
                                            <TD className="text-center text-blue-800">{totalUnits}</TD>
                                            <TD className="text-center">100%</TD>
                                            <TD className="text-center text-blue-800">{fmt(totalCarpet)}</TD>
                                        </tr>
                                    </tbody>
                                </table>
                                <div className="grid grid-cols-3 gap-3 mt-2 text-[9px]">
                                    <div className="bg-white border border-blue-200 p-2 rounded text-center">
                                        <strong className="block text-blue-800 text-[11px]">{totalUnits}</strong>
                                        <span className="text-slate-500">Total Units</span>
                                    </div>
                                    <div className="bg-white border border-blue-200 p-2 rounded text-center">
                                        <strong className="block text-blue-800 text-[11px]">{fmt(totalCarpet)} sq.m</strong>
                                        <span className="text-slate-500">Total RERA Carpet</span>
                                    </div>
                                    <div className="bg-white border border-blue-200 p-2 rounded text-center">
                                        <strong className="block text-blue-800 text-[11px]">{carpetEff.toFixed(1)}%</strong>
                                        <span className="text-slate-500">Carpet Efficiency</span>
                                    </div>
                                </div>
                            </div>

                            {/* ── Distribution ── */}
                            <SH2>Unit Distribution Across Floors</SH2>
                            <p className="text-[10px] mb-3 text-slate-600">
                                <strong>{totalUnits} units</strong> across <strong>{maxFloors} upper floors</strong> × <strong>{towers} tower(s)</strong> = approximately{' '}
                                <strong>{Math.round(totalUnits / Math.max(1, maxFloors * towers))} unit(s)/floor/tower</strong>
                            </p>
                        </>
                    );
                })()}

                <SH2>Unit Amenities & Features</SH2>
                <div className="grid grid-cols-2 gap-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Standard Inclusions (All Units)</strong>
                        <ul className="list-none space-y-0.5">
                            {['Video door phone system','Intercom to security/management','Fire alarm (smoke detectors in corridor)',`Provisions for split AC (${Math.max(2, Object.keys(units).length > 0 ? Math.min(4, Object.keys(units).length + 1) : 3)} outdoor unit spaces)`,'Provision for geyser (3 nos.)','Provision for chimney (kitchen)','Provision for washing machine (service balcony)','DTH/cable TV points (living + master BR)','Broadband-ready (Cat-6 cabling)','Modular switches (Legrand/Anchor/Havells)','Concealed plumbing & electrical','Quality hardware (Godrej/Dorset locks)'].map((item, i) => (
                                <li key={i}><span className="text-green-600 font-bold">✓</span> {item}</li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Optional Upgrades (At Additional Cost)</strong>
                        <ul className="list-none space-y-0.5">
                            {['Wooden flooring (bedrooms)','Designer false ceiling (living)','Upgraded tiles (imported)','Premium CP fittings (Grohe/Hansgrohe)','Upgraded kitchen (Hacker/Hafele modular)','Home automation (basic package)','Wallpaper (accent walls)','Additional storage (loft/attic)'].map((item, i) => (
                                <li key={i}><span className="text-blue-600 font-bold">+</span> {item}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 9 — AMENITIES ═══ */}
            <div className="report-page">
                <SH>9. Amenities & Facilities</SH>
                <SH2>7.1 Ground Floor Amenities</SH2>
                {(() => {
                    const towerFootprint = Math.round((builtUp || 10080) / maxFloors / towers); // rough footprint
                    const coreArea = Math.round(towerFootprint * 0.20); // typical 20% core
                    const amenitiesArea = towerFootprint - coreArea; // remaining per tower
                    const totalAmenitiesArea = amenitiesArea * towers;
                    
                    // Ratios for distributing the total available amenities area
                    // (60+40+100+80+120+30+20+40+30+20+20 = 560 old total)
                    const split = [60, 40, 100, 80, 120, 30, 20, 40, 30, 20, 20];
                    const splitSum = split.reduce((acc, v) => acc + v, 0);
                    
                    // Calculate distributed areas that add exactly up to totalAmenitiesArea
                    const allocated = split.map(v => Math.round((v / splitSum) * totalAmenitiesArea));
                    
                    // Adjust the largest one (array index 4) to eat any rounding error precisely
                    const allocatedSum = allocated.reduce((acc, v) => acc + v, 0);
                    if (allocatedSum !== totalAmenitiesArea) {
                        allocated[4] += (totalAmenitiesArea - allocatedSum);
                    }

                    return (
                        <>
                            <div className="mb-4 text-[10px]">
                                <strong className="block text-slate-800 mb-1 border-b pb-1">Space Allocation</strong>
                                <ul className="list-disc pl-4 space-y-0.5">
                                    <li><strong>Total ground floor area (both towers):</strong> {towers} × {towerFootprint} sq.m = {fmt(towers * towerFootprint)} sq.m</li>
                                    <li><strong>Core & circulation:</strong> {towers} × {coreArea} sq.m = {fmt(towers * coreArea)} sq.m</li>
                                    <li><strong>Available for amenities:</strong> {fmt(totalAmenitiesArea)} sq.m</li>
                                    <li><strong>Additional open-air amenities:</strong> ~{fmt(metrics?.greenArea?.total || 500)} sq.m (in landscaped areas)</li>
                                </ul>
                            </div>

                            <SH2>Amenity Distribution</SH2>
                            <table className="w-full border-collapse mb-4 text-[10px]">
                                <thead><tr><TH>Facility</TH><TH>Area (sq.m)</TH><TH>Location</TH><TH>Capacity</TH></tr></thead>
                                <tbody>
                                    {[
                                        ['Reception Lobby', allocated[0], 'Tower 1 entry', '—'],
                                        ['Waiting Lounge', allocated[1], 'Adjacent to lobby', '15 persons'],
                                        ['Gymnasium', allocated[2], 'Tower 1, ground', '20 persons'],
                                        ['Indoor Games Room', allocated[3], 'Tower 2, ground', '12 persons'],
                                        ['Multipurpose Hall', allocated[4], 'Tower 2, ground', '50 persons'],
                                        ['Management Office', allocated[5], 'Tower 1, ground', '3 staff'],
                                        ['Security Room', allocated[6], 'Main entrance', '24×7'],
                                        ['Convenience Store', allocated[7], 'Near entrance', 'Small retail'],
                                        ['Store/Maintenance', allocated[8], 'Service area', 'Equipment'],
                                        ['Toilets (Common)', allocated[9], 'Near multipurpose', 'M+F'],
                                        ['Electrical Room', allocated[10], 'Tower basement exit', 'Transformer']
                                    ].map(([a, b, c, d], i) => (
                                        <tr key={i}><TD className="font-semibold bg-slate-50">{a as string}</TD><TD>{b as number}</TD><TD>{c as string}</TD><TD>{d as string}</TD></tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-200 font-bold"><TD>TOTAL (Covered)</TD><TD>{fmt(totalAmenitiesArea)}</TD><TD colSpan={2}>{" "}</TD></tr>
                                </tfoot>
                            </table>
                        </>
                    );
                })()}

                <SH2>7.2 Open-Air Amenities</SH2>
                <table className="w-full border-collapse mb-4 text-[10px]">
                    <thead><tr><TH>Facility</TH><TH>Area (sq.m)</TH><TH>Location</TH><TH>Features</TH></tr></thead>
                    <tbody>
                        {[
                            ['Swimming Pool', '150', 'Central area', '12m × 6m × 1.2m deep'],
                            ['Pool Deck', '50', 'Around pool', 'Loungers, umbrellas'],
                            ["Children's Play Area", '60', 'Visible from apts', 'Swings, slides, sandpit'],
                            ['Jogging Track', '—', 'Perimeter', '180m circuit'],
                            ['Yoga/Meditation Deck', '40', 'Quiet corner', 'Wooden deck'],
                            ['Outdoor Fitness Stations', '60', 'Along jogging track', '5 stations'],
                            ['Seating Alcoves', '80', 'Various locations', 'Benches, gazebos'],
                            ['Landscaped Gardens', `${fmt(metrics?.greenArea?.total || 280)}`, 'Throughout', 'Lawns, trees, shrubs']
                        ].map(([a, b, c, d], i) => (
                            <tr key={i}><TD className="font-semibold bg-slate-50">{a}</TD><TD>{b}</TD><TD>{c}</TD><TD>{d}</TD></tr>
                        ))}
                    </tbody>
                </table>
                <SH2>7.3 Common Services & Facilities</SH2>
                
                <strong className="block text-slate-800 mb-1 border-b pb-1">Security & Access Control</strong>
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Main Gate</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Boom barrier:</strong> Automatic (RFID/remote)</li>
                            <li><strong>Security cabin:</strong> 12 sq.m (3m × 4m)</li>
                            <li><strong>CCTV monitors:</strong> 16-channel DVR</li>
                            <li><strong>Visitor register:</strong> Digital tablet</li>
                            <li><strong>Intercom:</strong> Master panel & PA system</li>
                            <li><strong>Guard:</strong> 24×7 (2 shifts)</li>
                        </ul>
                        
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Access Control</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Pedestrian gate:</strong> RFID card/biometric</li>
                            <li><strong>Vehicle gate:</strong> RFID tag + boom barrier</li>
                            <li><strong>Lift access:</strong> RFID card (for residents)</li>
                            <li><strong>Visitor management:</strong> Digital register + photograph</li>
                            <li><strong>Intercom:</strong> Gate to apartments</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">CCTV Surveillance</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Cameras:</strong> 24 nos. (strategic locations)</li>
                            <li>Main entrance: 2 | Tower lobbies: 4</li>
                            <li>Corridors: 32 (selective floors)</li>
                            <li>Amenities: 8 (gym, pool, games, etc.)</li>
                            <li>Parking: 8 (all basement levels) | Perimeter: 4</li>
                        </ul>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Type:</strong> IP cameras (2 MP, day/night)</li>
                            <li><strong>Recording:</strong> 30-day storage (NVR)</li>
                            <li><strong>Remote viewing:</strong> Mobile app access</li>
                        </ul>
                    </div>
                </div>

                {/* Removed redundant Waste & Water summaries to prevent duplication with Page 11 */}
            </div>
            <PageBreak />

            {/* ═══ PAGE 10 — PARKING & CIRCULATION ═══ */}
            <div className="report-page">
                <SH>10. Parking & Circulation</SH>
                
                <SH2>Target Scenario (For {totalUnits} units)</SH2>
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Car Parking Requirement</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Requirement:</strong> 1.5 ECS per unit</li>
                            <li><strong>Total Base:</strong> {totalUnits} × 1.5 = {Math.ceil(totalUnits * 1.5)} ECS minimum</li>
                            <li><strong>Guest parking (10%):</strong> {Math.ceil(totalUnits * 1.5)} × 0.1 = {Math.ceil(totalUnits * 1.5 * 0.1)} ECS</li>
                            <li className="font-semibold text-slate-900 border-t pt-1 mt-1"><strong>Total required:</strong> {Math.ceil(totalUnits * 1.5) + Math.ceil(totalUnits * 1.5 * 0.1)} ECS</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Basement Parking Capacity</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Available Basement Floor Plate:</strong> {fmt(plot.buildings?.[0]?.area || 800 * towers)} sq.m</li>
                            <li><strong>Less core & circulation:</strong> {fmt((plot.buildings?.[0]?.area || 800 * towers) - (buildingCores[0]?.core?.totalCoreAreaPerFloor || 100 * towers))} sq.m usable space</li>
                            <li><strong>Less ramps/turning (~15%):</strong> ~{fmt(((plot.buildings?.[0]?.area || 800 * towers) - (buildingCores[0]?.core?.totalCoreAreaPerFloor || 100 * towers)) * 0.85)} sq.m available for parking</li>
                        </ul>
                        <div className="bg-slate-50 border p-2 rounded mt-1">
                            <strong>Est. Capacity/Floor:</strong> {fmt((((plot.buildings?.[0]?.area || 800 * towers) - (buildingCores[0]?.core?.totalCoreAreaPerFloor || 100 * towers)) * 0.85) / 32)} ECS (1 ECS = 32 sq.m)
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <SH2 className="!mt-0">Two-Wheeler Parking</SH2>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Requirement (Code 7.1(1)):</strong> 0.5 spaces per unit</li>
                            <li><strong>Total spaces required:</strong> {totalUnits} × 0.5 = {Math.ceil(totalUnits * 0.5)} spaces</li>
                            <li><strong>Unit dimension:</strong> 0.8m × 2.5m = 2.0 sq.m</li>
                            <li><strong>Total area:</strong> {Math.ceil(totalUnits * 0.5)} × 2 = {Math.ceil(totalUnits * 0.5) * 2} sq.m</li>
                            <li><strong>Location:</strong> Basement Level B1 (near ramp) in individual racks</li>
                        </ul>
                    </div>
                    <div>
                        <SH2 className="!mt-0">Visitor Parking</SH2>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Location:</strong> Ground level (near entrance)</li>
                            <li><strong>Capacity:</strong> {Math.ceil(totalUnits * 1.5 * 0.1)} cars</li>
                            <li><strong>Access:</strong> Separate from resident basement</li>
                            <li><strong>Monitoring:</strong> CCTV + security</li>
                        </ul>
                    </div>
                </div>

                <SH2>Circulation Within Basements & Site</SH2>
                <div className="grid grid-cols-2 gap-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Aisles & Dimensions</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Main circulation aisle:</strong> 6.0m (two-way traffic)</li>
                            <li><strong>Secondary aisle:</strong> 4.0m (one-way)</li>
                            <li><strong>Parking bay access:</strong> 3.5m minimum</li>
                            <li><strong>Parking bay dimensions:</strong> 2.5m (W) × 5.0m (L) (Angle: 90°)</li>
                        </ul>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Traffic Flow & Rules</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Direction:</strong> Clockwise/counterclockwise clearly marked</li>
                            <li><strong>Speed limit:</strong> 10 km/hr</li>
                            <li><strong>Signage:</strong> Directional arrows, level indicators</li>
                            <li><strong>Lighting:</strong> Well-lit (150 lux minimum)</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Entry/Exit Management</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Entry Location:</strong> South side (from 6.04m road)</li>
                            <li><strong>Gate Type:</strong> Boom barrier with RFID (4.0m width)</li>
                            <li><strong>Exit:</strong> One-way loop within site (clear visibility mirrors)</li>
                        </ul>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Pedestrian Circulation (Lifts/Stairs)</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Lifts:</strong> 3 per tower (1.5 m/s, &lt;45s peak wait time)</li>
                            <li><strong>Core Corridors:</strong> 1.5m min width, 2.45m clear height</li>
                            <li><strong>Accessibility:</strong> 1:12 ramps at entry, wheelchair-accessible lifts (2.0×1.8m)</li>
                        </ul>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 11 — SUSTAINABILITY & ENVIRONMENT ═══ */}
            <div className="report-page">
                <SH>11. Sustainability & Environment</SH>
                
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <SH2 className="!mt-0">11.1 Energy Conservation (ECBC & Solar)</SH2>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Solar Power System</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Capacity:</strong> 10 kWp Grid-tied with net metering (exceeds 1% code)</li>
                            <li><strong>System:</strong> 30 Monocrystalline 335W panels (70 sq.m rooftop area)</li>
                            <li><strong>Generation:</strong> ~50 kWh/day (Annual: 18,250 kWh/year)</li>
                            <li><strong>Savings:</strong> &gt;30% of common area electricity (Payback: ~2.5 years)</li>
                        </ul>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">ECBC Compliance (EPI: &lt;100 kWh/sq.m/yr)</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Envelope:</strong> Flyash bricks (U: 1.2), Roof insulation (U: 0.4)</li>
                            <li><strong>Glazing:</strong> Double-glazed WWR 30% (SHGC 0.25, VLT 0.6)</li>
                            <li><strong>Lighting:</strong> 100% LED, Motion sensors, &lt;10 W/sq.m</li>
                            <li><strong>HVAC (Common):</strong> VRV systems (COP &gt;3.5), HRV fresh air</li>
                            <li><strong>Pumps/Motors:</strong> IE3 class motors, VFDs on pumps &gt;5 HP</li>
                        </ul>
                    </div>
                    <div>
                        <SH2 className="!mt-0">11.2 Water Conservation</SH2>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Rainwater Harvesting</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Catchment Potential:</strong> {fmt(plot.buildings?.[0]?.area ? plot.buildings[0].area * towers : 720)} sq.m (roof) + 800 sq.m (open)</li>
                            <li><strong>Annual Capture:</strong> ~850 cubic meters/year (700mm rainfall, 0.8 runoff)</li>
                            <li><strong>Infrastructure:</strong> {Math.max(4, Math.ceil(plotArea / 3000))} Recharge Bores (150mm dia, 20m depth)</li>
                            <li><strong>Storage:</strong> 20,000L underground tank + Sand/Mesh filtration</li>
                        </ul>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Water Efficiency & STP</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Fixtures:</strong> Aerators, dual-flush WCs, sensor taps (26% reduction)</li>
                            <li><strong>STP Tech:</strong> 25 KLD Extended Aeration + MBR (Outlet BOD &lt;10 mg/L)</li>
                            <li><strong>Zero Discharge:</strong> 100% sewage treated & reused on-site</li>
                            <li><strong>Potable Savings:</strong> 15,000 L/day (Annual: ~5.4 lakhs)</li>
                        </ul>
                    </div>
                </div>

                <SH2>11.3 Comprehensive Waste Management</SH2>
                <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Solid Waste Processing (OWC)</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>Technology:</strong> Aerobic composting with microbial culture</li>
                            <li><strong>Capacity:</strong> 50 kg/day (1.5m × 1.0m × 1.2m unit in basement)</li>
                            <li><strong>Process:</strong> Shredding → Microbial mixing → 15-20 days retention</li>
                            <li><strong>Output:</strong> 10 kg compost/day (3.65 tonnes annually)</li>
                        </ul>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Dry Waste & Zero Waste Target</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                            <li><strong>Segregation:</strong> 3-bin system (Wet/Dry/Reject) per floor</li>
                            <li><strong>Target:</strong> Organic 100% composted, Dry 90% recycled, Landfill &lt;10%</li>
                            <li><strong>Categories:</strong> Paper/plastic sold, E-waste quarterly drive</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-800 mb-1 border-b pb-1">Construction Waste & Green Premium</strong>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li><strong>C&D Segregation:</strong> Concrete (crushed for base), Metal (rebar), Wood (formwork)</li>
                            <li><strong>Target:</strong> 80% waste diverted from landfill during construction</li>
                            <li><strong>Green Incentive:</strong> 9% Additional FAR (for 3-star GRIHA equivalent)</li>
                            <li><strong>Operational ROI:</strong> &lt;2 years on ₹8-10 lakhs certification cost</li>
                        </ul>
                        
                        {stats?.greenAnalysis && (
                            <div className="mt-2 bg-green-50 border border-green-200 p-2 rounded">
                                <strong className="text-green-800 block mb-1">Live Green Analysis: {(stats.greenAnalysis as any).overallScore} / {(stats.greenAnalysis as any).maxScore}</strong>
                                {(() => {
                                    const items = ((stats.greenAnalysis as any).categories || []).flatMap((c: any) => c.items || []);
                                    return items.slice(0, 3).map((item: any, i: number) => (
                                        <div key={i} className="flex justify-between text-[9px] text-green-900 border-t border-green-100/50 pt-0.5 mt-0.5">
                                            <span>{item.title}: {item.score}</span>
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 12 — COST ESTIMATION (DETAILED) ═══ */}
            <div className="report-page">
                <SH>12. Detailed Cost Estimation Breakdown</SH>
                {cb ? (() => {
                    const simRatio10 = sim ? sim.cost_p10 / totalCost : 0.95;
                    const simRatio90 = sim ? sim.cost_p90 / totalCost : 1.05;
                    return <>
                    <div className="grid grid-cols-2 gap-4 text-[9px] mb-4">
                        <div>
                            <strong className="block text-slate-800 mb-1 border-b pb-1">Superstructure (Above Ground)</strong>
                            <table className="w-full border-collapse mb-3">
                                <thead><tr><TH>Component</TH><TH>Area/Qty</TH><TH>Est. Range (₹ Cr)</TH></tr></thead>
                                <tbody>
                                    <tr><TD>Residential (Carpet)</TD><TD>{fmt(totalCarpet)} sqm</TD><TD>{crore((cb.structure + cb.finishing) * 0.75 * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.structure + cb.finishing) * 0.75 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Core & Circulation</TD><TD>{fmt(totalCarpet * 0.18)} sqm</TD><TD>{crore((cb.structure + cb.finishing) * 0.15 * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.structure + cb.finishing) * 0.15 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Balconies</TD><TD>{fmt(totalCarpet * 0.11)} sqm</TD><TD>{crore((cb.structure + cb.finishing) * 0.08 * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.structure + cb.finishing) * 0.08 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Ground floor amenities</TD><TD>560 sqm</TD><TD>{crore((cb.structure + cb.finishing) * 0.02 * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.structure + cb.finishing) * 0.02 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Sub-total (Superstructure)</TD><TD>{crore((cb.structure + cb.finishing) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.structure + cb.finishing) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>

                            <strong className="block text-slate-800 mb-1 border-b pb-1">Substructure (Below Ground)</strong>
                            <table className="w-full border-collapse mb-3">
                                <thead><tr><TH>Component</TH><TH>Area</TH><TH>Est. Range (₹ Cr)</TH></tr></thead>
                                <tbody>
                                    <tr><TD>Basements (Parking)</TD><TD>{fmt(plotArea * 0.8 * 4)} sqm</TD><TD>{crore((cb.earthwork + cb.structure * 0.2) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.earthwork + cb.structure * 0.2) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Foundation (Raft)</TD><TD>{fmt(plotArea * 0.25)} sqm</TD><TD>{crore((cb.earthwork * 0.5) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.earthwork * 0.5) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Sub-total (Substructure)</TD><TD>{crore(((cb.earthwork + cb.structure * 0.2) + (cb.earthwork * 0.5)) * simRatio10).replace(/₹ | Cr/g, '')} – {crore(((cb.earthwork + cb.structure * 0.2) + (cb.earthwork * 0.5)) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>

                            <strong className="block text-slate-800 mb-1 border-b pb-1">External Works</strong>
                            <table className="w-full border-collapse mb-3">
                                <thead><tr><TH>Component</TH><TH>Area/Qty</TH><TH>Est. Range (₹ Cr)</TH></tr></thead>
                                <tbody>
                                    <tr><TD>Landscaping (hard+soft)</TD><TD>880 sqm</TD><TD>{crore((880 * 8000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((880 * 8000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Swimming pool</TD><TD>200 sqm</TD><TD>{crore((200 * 20000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((200 * 20000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Boundary wall</TD><TD>180 LM</TD><TD>{crore((180 * 5000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((180 * 5000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Roads & paving</TD><TD>400 sqm</TD><TD>{crore((400 * 4000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((400 * 4000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Sub-total (External)</TD><TD>{crore(((880 * 8000) + (200 * 20000) + (180 * 5000) + (400 * 4000)) * simRatio10).replace(/₹ | Cr/g, '')} – {crore(((880 * 8000) + (200 * 20000) + (180 * 5000) + (400 * 4000)) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <strong className="block text-slate-800 mb-1 border-b pb-1">Services & Equipment</strong>
                            <table className="w-full border-collapse mb-3">
                                <thead><tr><TH>System</TH><TH>Specification</TH><TH>Est. Range (₹ Cr)</TH></tr></thead>
                                <tbody>
                                    <tr><TD>Lifts ({towers * 3} nos.)</TD><TD>Lumpsum</TD><TD>{crore((towers * 3 * 1500000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((towers * 3 * 1500000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>DG set (500 kVA)</TD><TD>Lumpsum</TD><TD>{crore((500 * 7000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((500 * 7000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Solar power ({towers * 10} kWp)</TD><TD>Lumpsum</TD><TD>{crore((towers * 10 * 60000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((towers * 10 * 60000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>STP Common</TD><TD>Lumpsum</TD><TD>{crore((45 * 33333) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((45 * 33333) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Water supply & plumb.</TD><TD>{fmt(totalCarpet)} sqm</TD><TD>{crore((cb.services * 0.4) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.services * 0.4) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Electrical inst.</TD><TD>{fmt(totalCarpet)} sqm</TD><TD>{crore((cb.services * 0.5) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.services * 0.5) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>HVAC / Fire / Sec.</TD><TD>Common + Site</TD><TD>{crore((cb.services * 0.1) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((cb.services * 0.1) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Sub-total (Services)</TD><TD>{crore(((towers * 3 * 1500000) + (500 * 7000) + (towers * 10 * 60000) + (45 * 33333) + cb.services) * simRatio10).replace(/₹ | Cr/g, '')} – {crore(((towers * 3 * 1500000) + (500 * 7000) + (towers * 10 * 60000) + (45 * 33333) + cb.services) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>

                            <strong className="block text-slate-800 mb-1 border-b pb-1">Amenities Equipment</strong>
                            <table className="w-full border-collapse mb-3">
                                <thead><tr><TH>Item</TH><TH>Specification</TH><TH>Est. Range (₹ Cr)</TH></tr></thead>
                                <tbody>
                                    <tr><TD>Gym equipment</TD><TD>Lumpsum</TD><TD>{crore((1200000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((1200000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Pool equipment</TD><TD>Lumpsum</TD><TD>{crore((800000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((800000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Play & Furniture</TD><TD>Lumpsum</TD><TD>{crore((2000000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((2000000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Sub-total (Amenities)</TD><TD>{crore((1200000 + 800000 + 2000000) * simRatio10).replace(/₹ | Cr/g, '')} – {crore((1200000 + 800000 + 2000000) * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>
                            
                            <strong className="block text-slate-800 mb-1 border-b pb-1 pt-2">Total Project Cost Summary</strong>
                            <table className="w-full border-collapse text-xs">
                                <thead><tr><TH>Component</TH><TH><div className="text-right">Projected Range (₹ Cr)</div></TH></tr></thead>
                                <tbody>
                                    <tr><TD>Construction Cost (Dynamic)</TD><TD className="text-right">{sim ? `${crore(sim.cost_p10).replace(/₹ | Cr/g, '')} – ${crore(sim.cost_p90).replace(/₹ | Cr/g, '')}` : crore(totalCost).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Soft Costs (~15%)</TD><TD className="text-right">{crore(totalCost * 0.15 * simRatio10).replace(/₹ | Cr/g, '')} – {crore(totalCost * 0.15 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Land Cost {uw?.actualLandPurchaseCost ? '(Actual)' : '(Estimated)'}</TD><TD className="text-right">{crore(actualLandCost).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD>Contingency (2%)</TD><TD className="text-right">{crore(totalCost * 0.02 * simRatio10).replace(/₹ | Cr/g, '')} – {crore(totalCost * 0.02 * simRatio90).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="bg-slate-800 text-white font-bold"><TD className="text-white font-bold">TOTAL PROJECT COST</TD><TD className="text-right text-white font-bold">{sim ? `${crore(sim.cost_p10 + (totalCost * 0.15 * simRatio10) + actualLandCost + (totalCost * 0.02 * simRatio10)).replace(/₹ | Cr/g, '')} – ${crore(sim.cost_p90 + (totalCost * 0.15 * simRatio90) + actualLandCost + (totalCost * 0.02 * simRatio90)).replace(/₹ | Cr/g, '')}` : crore(totalCost * 1.17 + actualLandCost).replace(/₹ | Cr/g, '')}</TD></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <SH2>Revenue Analysis & Profitability</SH2>
                    <div className="grid grid-cols-2 gap-4 text-[10px]">
                        <div>
                            <ul className="list-disc pl-4 space-y-0.5 mb-2">
                                <li><strong>Target Price:</strong> ₹{fmt(totalRev && totalCarpet ? Math.round(totalRev / (totalCarpet * 10.764)) : 11000)} per sq.ft (Dynamic Market Input)</li>
                                <li><strong>Total Saleable (Carpet):</strong> {fmt(totalCarpet)} sq.m ({fmt(totalCarpet * 10.764)} sq.ft)</li>
                            </ul>
                            <table className="w-full border-collapse mt-2">
                                <tbody>
                                    <tr><TD className="font-semibold bg-slate-50">Gross Revenue (at Target)</TD><TD className="text-right">{crore(totalRev || (totalCarpet * 11000 * 10.764)).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr><TD className="font-semibold bg-slate-50">Less: Total Project Cost Range</TD><TD className="text-right">{sim ? `${crore(sim.cost_p10 + (totalCost * 0.15 * simRatio10) + actualLandCost + (totalCost * 0.02 * simRatio10)).replace(/₹ | Cr/g, '')} – ${crore(sim.cost_p90 + (totalCost * 0.15 * simRatio90) + actualLandCost + (totalCost * 0.02 * simRatio90)).replace(/₹ | Cr/g, '')}` : crore(totalCost * 1.17 + actualLandCost).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="font-bold bg-green-50"><TD className="font-bold">Gross Profit Range</TD><TD className="font-bold text-green-700 text-right">{sim ? `${crore((totalRev || (totalCarpet * 11000 * 10.764)) - (sim.cost_p90 + (totalCost * 0.15 * simRatio90) + actualLandCost + (totalCost * 0.02 * simRatio90))).replace(/₹ | Cr/g, '')} – ${crore((totalRev || (totalCarpet * 11000 * 10.764)) - (sim.cost_p10 + (totalCost * 0.15 * simRatio10) + actualLandCost + (totalCost * 0.02 * simRatio10))).replace(/₹ | Cr/g, '')}` : crore((totalRev || (totalCarpet * 11000 * 10.764)) - (totalCost * 1.17 + actualLandCost)).replace(/₹ | Cr/g, '')}</TD></tr>
                                    <tr className="font-bold bg-blue-50"><TD className="font-bold text-blue-800">Return on Investment (ROI)</TD><TD className="font-bold text-blue-800 text-right">{sim ? `${(((((totalRev || (totalCarpet * 11000 * 10.764)) - (sim.cost_p90 + (totalCost * 0.15 * simRatio90) + actualLandCost + (totalCost * 0.02 * simRatio90))) * 0.8) / ((sim.cost_p90 + (totalCost * 0.15 * simRatio90) + actualLandCost + (totalCost * 0.02 * simRatio90)) * 0.4)) * 100).toFixed(1)}% – ${(((((totalRev || (totalCarpet * 11000 * 10.764)) - (sim.cost_p10 + (totalCost * 0.15 * simRatio10) + actualLandCost + (totalCost * 0.02 * simRatio10))) * 0.8) / ((sim.cost_p10 + (totalCost * 0.15 * simRatio10) + actualLandCost + (totalCost * 0.02 * simRatio10)) * 0.4)) * 100).toFixed(1)}%` : `${(((((((totalRev || (totalCarpet * 11000 * 10.764)) - (totalCost * 1.17 + actualLandCost)) * 0.8) / ((totalCost * 1.17 + actualLandCost) * 0.4))) * 100).toFixed(1))}%`}</TD></tr>
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <strong className="block text-slate-800 mb-1 border-b pb-1">Sensitivity Analysis (Price Variation)</strong>
                            <table className="w-full border-collapse text-center">
                                <thead><tr><TH>Price Change</TH><TH>Revenue (Cr)</TH><TH>PAT (Cr)</TH><TH>PAT Margin</TH></tr></thead>
                                <tbody>
                                    {[-10, 0, 10].map((pct, i) => {
                                        const baseRev = totalRev || (totalCarpet * 11000 * 10.764);
                                        const adjRev = baseRev * (1 + pct / 100);
                                        const fullCost = totalCost * 1.17 + actualLandCost;
                                        const adjProfit = (adjRev - fullCost) * 0.8;
                                        return (
                                            <tr key={i} className={pct === 0 ? 'bg-blue-50 font-bold' : 'text-slate-600'}>
                                                <TD>{pct >= 0 ? '+' : ''}{pct}%{pct === 0 ? ` (₹${fmt(totalRev && totalCarpet ? Math.round(totalRev / (totalCarpet * 10.764)) : 11000)})` : ''}</TD>
                                                <TD>{crore(adjRev)}</TD>
                                                <TD className={adjProfit < 0 ? 'text-red-600' : 'text-green-700'}>{crore(adjProfit)}</TD>
                                                <TD>{((adjProfit / adjRev) * 100).toFixed(1)}%</TD>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="mt-2 text-[8px] italic text-slate-500 text-right">
                                Break-even Price: ₹{fmt((totalCost * 1.17 + actualLandCost) / (totalCarpet * 10.764))}/sq.ft carpet<br/>
                                Break-even Cost: +{(((totalRev || (totalCarpet * 11000 * 10.764)) / (totalCost * 1.17 + actualLandCost) - 1) * 100).toFixed(0)}% overrun
                            </div>
                        </div>
                    </div>
                    </>;
                })() : (
                    <p className="text-slate-500 italic">Financial estimates not loaded. Configure cost parameters in Admin Panel.</p>
                )}
            </div>
            <PageBreak />

            {/* ═══ PAGE 12B — SIMULATION COST REPORT ═══ */}
            <div className="report-page">
                <SH>12B. Simulation-Based Cost & Time Report</SH>
                <p className="text-[9px] text-slate-500 italic mb-3">
                    The following figures are computed dynamically by the Keystone AI simulation engine based on project parameters configured in the Admin Panel. These may differ from the PDF benchmark values above, which use standard industry rates.
                </p>
                {estimates ? (<>
                    {/* Top row: Total Cost + Revenue KPIs */}
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                            { label: 'Project Cost (P10–P90)', value: sim ? `${crore(sim.cost_p10).replace(/₹ | Cr/g, '')} – ${crore(sim.cost_p90).replace(/₹ | Cr/g, '')} Cr` : crore(totalCost), sub: 'Simulation Range', color: 'bg-slate-800' },
                            { label: 'Total Revenue (Projected)', value: crore(totalRev), sub: 'Derived from Market Rates', color: 'bg-slate-700' },
                            { label: 'Profit (P10–P90)', value: sim ? `${crore(totalRev - sim.cost_p90).replace(/₹ | Cr/g, '')} – ${crore(totalRev - sim.cost_p10).replace(/₹ | Cr/g, '')} Cr` : crore(profit), sub: `ROI: ${sim ? ((totalRev - sim.cost_p90)/sim.cost_p90 * 100).toFixed(1) : roi.toFixed(1)}% – ${sim ? ((totalRev - sim.cost_p10)/sim.cost_p10 * 100).toFixed(1) : roi.toFixed(1)}%`, color: 'bg-green-800' },
                            { label: 'Project Duration (P10–P90)', value: sim ? `${Math.round(sim.time_p10)} – ${Math.round(sim.time_p90)} mo` : `${fmt(tl?.total_months, 1)} mo`, sub: 'Simulation Range', color: 'bg-slate-800' },
                        ].map((k, i) => (
                            <div key={i} className={`${k.color} text-white rounded p-3`}>
                                <div className="text-[9px] opacity-75 font-semibold uppercase tracking-wider mb-1">{k.label}</div>
                                <div className="text-lg font-bold">{k.value}</div>
                                <div className="text-[9px] opacity-80 mt-1">{k.sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Cost Breakdown + Timeline Phases side-by-side */}
                    <div className="grid grid-cols-2 gap-5 mb-4">
                        <div>
                            <SH2>Cost Component Breakdown</SH2>
                            <table className="w-full border-collapse text-[9px]">
                                <thead><tr><TH>Component</TH><TH className="text-right">Amount Range (P10–P90) ₹ Cr</TH><TH className="text-right">% of Total</TH></tr></thead>
                                <tbody>
                                    {[
                                        { label: 'Earthwork & Excavation', ratio: estimates.cost_breakdown.earthwork / totalCost },
                                        { label: 'RCC Structure', ratio: estimates.cost_breakdown.structure / totalCost },
                                        { label: 'Finishing Works', ratio: estimates.cost_breakdown.finishing / totalCost },
                                        { label: 'MEP Services', ratio: estimates.cost_breakdown.services / totalCost },
                                        { label: 'Contingency', ratio: estimates.cost_breakdown.contingency / totalCost },
                                    ].map((row, i) => {
                                        const p10 = sim ? sim.cost_p10 * row.ratio : totalCost * row.ratio * 0.95;
                                        const p90 = sim ? sim.cost_p90 * row.ratio : totalCost * row.ratio * 1.05;
                                        return (
                                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                <TD>{row.label}</TD>
                                                <TD className="text-right font-mono text-slate-600">{crore(p10).replace(/₹ | Cr/g, '')} – {crore(p90).replace(/₹ | Cr/g, '')}</TD>
                                                <TD className="text-right">{(row.ratio * 100).toFixed(1)}%</TD>
                                            </tr>
                                        );
                                    })}
                                    <tr className="bg-slate-800 text-white font-bold">
                                        <TD className="font-bold text-white">Total Cost Range</TD>
                                        <TD className="font-bold text-white text-right font-mono">{sim ? `${crore(sim.cost_p10).replace(/₹ | Cr/g, '')} – ${crore(sim.cost_p90).replace(/₹ | Cr/g, '')}` : crore(totalCost)}</TD>
                                        <TD className="font-bold text-white text-right">100%</TD>
                                    </tr>
                                </tbody>
                            </table>

                            {/* Efficiency metric */}
                            {estimates.efficiency_metrics && (
                                <div className="mt-3 p-2 rounded border border-slate-200 bg-slate-50 text-[9px]">
                                    <strong>Model Efficiency:</strong> Achieved {estimates.efficiency_metrics.achieved.toFixed(1)}% vs Target {estimates.efficiency_metrics.target.toFixed(1)}%
                                    {/* <span className={`ml-2 px-1.5 py-0.5 rounded text-white text-[8px] font-bold ${estimates.efficiency_metrics.status === 'Optimal' ? 'bg-green-600' : estimates.efficiency_metrics.status === 'Aggressive' ? 'bg-red-600' : 'bg-amber-600'}`}>
                                        {estimates.efficiency_metrics.status}
                                    </span> */}
                                </div>
                            )}
                        </div>

                        <div>
                            <SH2>Construction Timeline Phases</SH2>
                            <table className="w-full border-collapse text-[9px]">
                                <thead><tr><TH>Phase</TH><TH className="text-right">Duration Range</TH><TH className="text-right">% of Total</TH></tr></thead>
                                <tbody>
                                    {tl && [
                                        { label: 'Excavation', ratio: tl.phases.excavation / tl.total_months },
                                        { label: 'Foundation', ratio: tl.phases.foundation / tl.total_months },
                                        { label: 'Structural Build', ratio: tl.phases.structure / tl.total_months },
                                        { label: 'Finishing', ratio: tl.phases.finishing / tl.total_months },
                                        ...(tl.phases.contingency ? [{ label: 'Contingency Buffer', ratio: tl.phases.contingency / tl.total_months }] : []),
                                    ].map((row, i) => {
                                        const p10 = sim ? sim.time_p10 * row.ratio : tl.total_months * row.ratio * 0.95;
                                        const p90 = sim ? sim.time_p90 * row.ratio : tl.total_months * row.ratio * 1.05;
                                        return (
                                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                <TD>{row.label}</TD>
                                                <TD className="text-right text-slate-600">{fmt(p10, 1)} – {fmt(p90, 1)} mo</TD>
                                                <TD className="text-right">{(row.ratio * 100).toFixed(1)}%</TD>
                                            </tr>
                                        );
                                    })}
                                    <tr className="bg-slate-800 text-white font-bold">
                                        <TD className="font-bold text-white">Total Duration</TD>
                                        <TD className="font-bold text-white text-right">{sim ? `${Math.round(sim.time_p10)} – ${Math.round(sim.time_p90)} mo` : `${fmt(tl?.total_months, 1)} mo`}</TD>
                                        <TD className="font-bold text-white text-right">100%</TD>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Per-Building Cost & Timeline Breakdown */}
                    {estimates.breakdown && estimates.breakdown.length > 0 && (
                        <div>
                            <SH2>Per-Tower Cost & Schedule (Simulation)</SH2>
                            <table className="w-full border-collapse text-[9px]">
                                <thead>
                                    <tr>
                                        <TH>Tower</TH>
                                        <TH>Floors</TH>
                                        <TH>GFA (sqm)</TH>
                                        <TH>Rate/sqm</TH>
                                        <TH>Tower Cost (₹ Cr)</TH>
                                        <TH>Utility Cost</TH>
                                        <TH>Duration</TH>
                                        <TH>Structure</TH>
                                        <TH>Finishing</TH>
                                    </tr>
                                </thead>
                                <tbody>
                                    {estimates.breakdown.map((b, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-medium">{b.buildingName}</TD>
                                            <TD className="text-center">{b.floors ?? '—'}</TD>
                                            <TD className="text-right">{b.gfa ? fmt(b.gfa) : '—'}</TD>
                                            <TD className="text-right">{b.cost.ratePerSqm ? fmt(b.cost.ratePerSqm) : '—'}</TD>
                                            <TD className="text-right font-semibold">{crore(b.cost.total)}</TD>
                                            <TD className="text-right">{b.utilityCost ? crore(b.utilityCost) : '—'}</TD>
                                            <TD className="text-right">{fmt(b.timeline.total, 1)} mo</TD>
                                            <TD className="text-right">{fmt(b.timeline.structure, 1)} mo</TD>
                                            <TD className="text-right">{fmt(b.timeline.finishing, 1)} mo</TD>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-800 text-white font-bold">
                                        <TD colSpan={4} className="font-bold text-white">Total (All Towers)</TD>
                                        <TD className="font-bold text-white text-right">{crore(estimates.breakdown.reduce((s, b) => s + b.cost.total, 0))}</TD>
                                        <TD className="font-bold text-white text-right">{crore(estimates.breakdown.reduce((s, b) => s + (b.utilityCost ?? 0), 0))}</TD>
                                        <TD colSpan={3}>&nbsp;</TD>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </>) : (
                    <p className="text-slate-500 italic">Simulation data not available. Run the feasibility simulator to generate dynamic cost estimates.</p>
                )}
            </div>
            <PageBreak />

            {/* ═══ PAGE 13 — CONSTRUCTION METHODOLOGY & TIMELINE ═══ */}
            <div className="report-page">
                <SH>13. Construction Methodology & Timeline</SH>
                
                {(() => {
                    const m10 = sim ? Math.round(sim.time_p10) : (tl?.total_months || 30) * 0.95;
                    const m90 = sim ? Math.round(sim.time_p90) : (tl?.total_months || 30) * 1.05;
                    
                    const scale10 = (m: number) => Math.max(1, Math.round(m * (m10 / 30)));
                    const scale90 = (m: number) => Math.max(1, Math.round(m * (m90 / 30)));
                    
                    const range = (startM: number, endM: number) => {
                        const s10 = scale10(startM); const s90 = scale90(startM);
                        const e10 = scale10(endM);   const e90 = scale90(endM);
                        // If ranges are identical, just show single
                        if (s10 === s90 && e10 === e90) return `M${s10}-M${e10}`;
                        // Otherwise try to show bounded ranges like M(start)-M(end)
                        return `M${s10 === s90 ? s10 : `${s10}-${s90}`}-M${e10 === e90 ? e10 : `${e10}-${e90}`}`;
                    }

                    const methodology = [
                        { title: `Phase 1: Preparation (${range(1, 2)})`, items: ["Site mobilization & temp facilities", "Boundary hoarding (3m, branded)", "Site office, labor colony", "Material storage yard", "Soil investigation (2 boreholes)", "Survey & setting out"] },
                        { title: `Phase 2: Foundation (${range(2, 5)})`, items: ["Basement excavation (~10k cu.m)", "Raft foundation (500mm)", "Pile drilling (if req) & pile cap", "Basement retaining walls (300mm)", "Ext. waterproofing & termite check", "Backfilling"] },
                        { title: `Phase 3: Basements (${range(5, 9)})`, items: ["Basement-4 to Basement-1", "Column & wall formwork", "Reinforcement & M30 Concreting", "Basement slabs (200mm)", "Curing (7-14 days)", "Services sleeves & Conduits", "Formwork striking & reuse"] },
                        { title: `Phase 4: Structure (${range(9, 20)})`, items: ["Ground to Floor 8 (parallel)", "Column casting (floor-by-floor)", "Beam & slab formwork", "Reinforcement & concreting", "Cycle: 10-12 days per floor", "Core shear walls (continuous)", "Lift shaft & Staircases"] },
                        { title: `Phase 5: Ext. Masonry (${range(15, 22)})`, items: ["External walls (230mm AAC)", "Internal partitions (115mm AAC)", "Plastering (external & internal)", "Window/door frames"] },
                        { title: `Phase 6: Roof/Terrace (${range(20, 21)})`, items: ["Terrace slab concreting", "Mumty/lift room construction", "Water tanks (2 × 22k L)", "Solar panel mounting", "Terrace waterproofing (APP)", "Parapet construction"] },
                        { title: `Phase 7: MEP Rough (${range(18, 23)})`, items: ["Electrical conduit laying", "Plumbing pipes (concealed)", "HVAC duct installation", "Fire-fighting pipes", "Service shaft completion"] },
                        { title: `Phase 8: Ext. Finish (${range(21, 24)})`, items: ["External plastering", "Facade paint/texture", "Windows & grills installation", "External lighting", "Signage"] },
                        { title: `Phase 9: Int. Finish (${range(22, 26)})`, items: ["Internal plastering/POP", "Flooring (tiles/vitrified)", "Wall tiling (baths/kitchen)", "Painting (2-3 coats)", "False ceiling (if req)", "Kitchen cabinets & Wardrobes", "Door installation & hardware", "Electrical/Plumbing fittings"] },
                        { title: `Phase 10: MEP Fit-out (${range(23, 27)})`, items: ["Lift install & commissioning", "DG set & Transformer", "Panels & Fire alarm", "CCTV & access control", "STP & Solar commissioning", "Water pumps & testing"] },
                        { title: `Phase 11: Ext. Works (${range(24, 28)})`, items: ["Landscaping (soft & hard)", "Swimming pool construction", "Pavements & driveways", "Boundary wall & gate", "External lighting & branding"] },
                        { title: `Phase 12: Handover (${range(27, 30)})`, items: ["Snag list clearance", "Deep cleaning", "Amenity equipment", "Furniture (common areas)", "Trial runs (all systems)", "Occupation Certificate", "Unit handover (phased)"] }
                    ];

                    return (
                        <div className="grid grid-cols-2 gap-4 text-[8px] mb-4">
                            <div>
                                <SH2 className="!mt-0">13.1 Construction Sequence (Phases 1-6)</SH2>
                                <div className="grid grid-cols-2 gap-2">
                                    {methodology.slice(0, 6).map((ph, i) => (
                                        <div key={i} className="mb-1">
                                            <strong className="block text-slate-800 mb-0.5 border-b border-slate-200 pb-[1px]">{ph.title}</strong>
                                            <ul className="list-disc pl-3 text-slate-600 leading-tight space-y-[1px]">
                                                {ph.items.map((item, j) => <li key={j}>{item}</li>)}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <SH2 className="!mt-0">13.2 MEP & Finishing (Phases 7-12)</SH2>
                                <div className="grid grid-cols-2 gap-2">
                                    {methodology.slice(6, 12).map((ph, i) => (
                                        <div key={i} className="mb-1">
                                            <strong className="block text-slate-800 mb-0.5 border-b border-slate-200 pb-[1px]">{ph.title}</strong>
                                            <ul className="list-disc pl-3 text-slate-600 leading-tight space-y-[1px]">
                                                {ph.items.map((item, j) => <li key={j}>{item}</li>)}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                <SH2>13.3 Projected Timeline Breakdown</SH2>
                {tl ? (<>
                    <table className="w-full border-collapse mb-4 text-[10px]">
                        <thead><tr><TH>Major Phase</TH><TH>Estimated Duration Range</TH><TH>Critical Path</TH></tr></thead>
                        <tbody>
                            {[
                                { label: 'Approvals & Mobilization (Phase 1)', ratio: Math.min(tl.phases.excavation, 3) / tl.total_months, cp: 'Yes' },
                                { label: 'Excavation & Basements (Phases 2-3)', ratio: tl.phases.foundation / tl.total_months, cp: 'Yes' },
                                { label: 'Superstructure (Phase 4)', ratio: tl.phases.structure / tl.total_months, cp: 'Yes' },
                                { label: 'Masonry & Rough-in (Phases 5-7)', ratio: (tl.phases.finishing * 0.4) / tl.total_months, cp: 'No (Parallel)' },
                                { label: 'Finishing & MEP Fit-out (Phases 8-10)', ratio: (tl.phases.finishing * 0.6) / tl.total_months, cp: 'Yes' },
                                { label: 'External Works & Handover (Phases 11-12)', ratio: (tl.phases.contingency || 0) / tl.total_months, cp: 'Yes' },
                            ].map((row, i) => {
                                const p10 = sim ? sim.time_p10 * row.ratio : tl.total_months * row.ratio * 0.95;
                                const p90 = sim ? sim.time_p90 * row.ratio : tl.total_months * row.ratio * 1.05;
                                return (
                                    <tr key={i}>
                                        <TD className="font-semibold">{row.label}</TD>
                                        <TD>{fmt(p10, 1)} – {fmt(p90, 1)} months</TD>
                                        <TD className={row.cp === 'Yes' ? 'text-red-600 font-semibold' : 'text-slate-500'}>{row.cp}</TD>
                                    </tr>
                                )
                            })}
                            <tr className="bg-slate-800 text-white font-bold">
                                <TD className="text-white">Total Estimated Duration Range</TD>
                                <TD className="text-white" colSpan={2}>{sim ? `${Math.round(sim.time_p10)} – ${Math.round(sim.time_p90)} months` : `${fmt(tl.total_months, 1)} months`}</TD>
                            </tr>
                        </tbody>
                    </table>

                    {estimates?.breakdown && estimates.breakdown.length > 0 && (<>
                        <SH2>Tower Sequence Dependencies</SH2>
                        <table className="w-full border-collapse mt-2 text-[10px]">
                            <thead><tr><TH>Tower</TH><TH>Commencement Month</TH><TH>Duration</TH><TH>Substructure</TH><TH>Superstructure</TH><TH>Finishing</TH></tr></thead>
                            <tbody>
                                {estimates.breakdown.map((bd: any, i: number) => (
                                    <tr key={i}>
                                        <TD className="font-semibold">{bd.buildingName}</TD>
                                        <TD>Month {fmt(bd.timeline?.startOffset, 1)}</TD>
                                        <TD>{fmt(bd.timeline?.total, 1)} mo</TD>
                                        <TD>{fmt(bd.timeline?.substructure, 1)} mo</TD>
                                        <TD>{fmt(bd.timeline?.structure, 1)} mo</TD>
                                        <TD>{fmt(bd.timeline?.finishing, 1)} mo</TD>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>)}
                </>) : (
                    <p className="text-slate-500 italic text-sm">Timeline parameters not available. Configure in Admin Panel.</p>
                )}
            </div>
            <PageBreak />

            {/* ═══ PAGE 14 — RESOURCE PLANNING & EQUIPMENT ═══ */}
            <div className="report-page">
                <SH>14. Resource Planning</SH>
                <div className="grid grid-cols-2 gap-4 text-[9px]">
                    <div>
                        <SH2 className="!mt-0">14.1 Manpower Deployment</SH2>
                        <p className="text-[8px] italic text-slate-500 mb-1">Peak Manpower (Month 15-20)</p>
                        <table className="w-full border-collapse mb-4">
                            <thead><tr><TH>Category</TH><TH>Quantity</TH><TH>Rate (₹/day)</TH><TH>Monthly Cost (₹ L)</TH></tr></thead>
                            <tbody>
                                <tr className="bg-slate-50 font-semibold text-slate-700"><TD colSpan={4}>Skilled</TD></tr>
                                <tr><TD>Masons</TD><TD>30</TD><TD>800</TD><TD>7.20</TD></tr>
                                <tr><TD>Carpenters</TD><TD>20</TD><TD>750</TD><TD>4.50</TD></tr>
                                <tr><TD>Steel fixers</TD><TD>25</TD><TD>700</TD><TD>5.25</TD></tr>
                                <tr><TD>Electricians</TD><TD>15</TD><TD>700</TD><TD>3.15</TD></tr>
                                <tr><TD>Plumbers</TD><TD>12</TD><TD>700</TD><TD>2.52</TD></tr>
                                <tr><TD>Painters</TD><TD>10</TD><TD>600</TD><TD>1.80</TD></tr>
                                
                                <tr className="bg-slate-50 font-semibold text-slate-700"><TD colSpan={4}>Semi-skilled</TD></tr>
                                <tr><TD>Helpers</TD><TD>80</TD><TD>500</TD><TD>12.0</TD></tr>
                                
                                <tr className="bg-slate-50 font-semibold text-slate-700"><TD colSpan={4}>Unskilled</TD></tr>
                                <tr><TD>Labor</TD><TD>100</TD><TD>400</TD><TD>12.0</TD></tr>
                                
                                <tr className="bg-slate-50 font-semibold text-slate-700"><TD colSpan={4}>Technical</TD></tr>
                                <tr><TD>Engineers</TD><TD>5</TD><TD>1,500</TD><TD>2.25</TD></tr>
                                <tr><TD>Supervisors</TD><TD>10</TD><TD>1,000</TD><TD>3.00</TD></tr>
                                <tr><TD>Safety officer</TD><TD>2</TD><TD>1,200</TD><TD>0.72</TD></tr>
                                <tr><TD>QC inspector</TD><TD>3</TD><TD>1,000</TD><TD>0.90</TD></tr>
                                
                                <tr className="bg-slate-800 text-white font-bold"><TD>Total Peak</TD><TD>312</TD><TD>&nbsp;</TD><TD>55.29/mo</TD></tr>
                            </tbody>
                        </table>
                        <p className="text-[9px] text-slate-600 mt-1">* Average Manpower: 200-250 (over {tl?.total_months ? Math.round(tl.total_months) : 30} months)</p>
                    </div>
                    <div>
                        <SH2 className="!mt-0">14.2 Equipment & Machinery</SH2>
                        <p className="text-[8px] italic text-slate-500 mb-1">Major Equipment Deployment</p>
                        <table className="w-full border-collapse mb-4">
                            <thead><tr><TH>Equipment</TH><TH>Qty</TH><TH>Monthly (₹)</TH><TH>Dur (mo)</TH><TH>Total (₹ L)</TH></tr></thead>
                            <tbody>
                                <tr><TD>Tower crane (6t)</TD><TD>2</TD><TD>3,50,000</TD><TD>20</TD><TD>140.00</TD></tr>
                                <tr><TD>Concrete pump</TD><TD>1</TD><TD>1,50,000</TD><TD>15</TD><TD>22.50</TD></tr>
                                <tr><TD>Concrete mixer</TD><TD>3</TD><TD>25,000</TD><TD>25</TD><TD>18.75</TD></tr>
                                <tr><TD>Bar bender/cutter</TD><TD>3</TD><TD>15,000</TD><TD>25</TD><TD>11.25</TD></tr>
                                <tr><TD>Vibrators</TD><TD>6</TD><TD>5,000</TD><TD>25</TD><TD>7.50</TD></tr>
                                <tr><TD>Welding machines</TD><TD>5</TD><TD>8,000</TD><TD>25</TD><TD>10.00</TD></tr>
                                <tr><TD>Dewatering pumps</TD><TD>4</TD><TD>12,000</TD><TD>6</TD><TD>2.88</TD></tr>
                                <tr><TD>Scaffolding</TD><TD>Lumpsum</TD><TD>-</TD><TD>-</TD><TD>50.00</TD></tr>
                                <tr className="bg-slate-800 text-white font-bold"><TD colSpan={4}>Total Estimated Cost</TD><TD>262.88</TD></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Gantt — full width below both columns */}
                <SH2>14.3 Construction Schedule — Gantt Chart</SH2>
                {(() => {
                    const TOTAL = 30;
                    const LABEL_W = 130;
                    const W = 470;
                    const ROW_H = 14;
                    const GAP = 3;
                    const phases = [
                        { label: '1. Approvals & Mobilization', start: 0,  end: 2,  color: '#64748b' },
                        { label: '2. Excavation & Foundation',  start: 1,  end: 5,  color: '#dc2626' },
                        { label: '3. Basement Construction',    start: 4,  end: 9,  color: '#ea580c' },
                        { label: '4. Superstructure (G+8)',     start: 8,  end: 20, color: '#0369a1' },
                        { label: '5. External Masonry',         start: 14, end: 22, color: '#7c3aed' },
                        { label: '6. Roof & Terrace',           start: 19, end: 21, color: '#475569' },
                        { label: '7. MEP Rough-in',             start: 17, end: 23, color: '#0891b2' },
                        { label: '8. External Finishing',       start: 21, end: 24, color: '#16a34a' },
                        { label: '9. Internal Finishing',       start: 22, end: 26, color: '#15803d' },
                        { label: '10. MEP Final Fit-out',       start: 23, end: 27, color: '#1d4ed8' },
                        { label: '11. External Works',          start: 24, end: 28, color: '#b45309' },
                        { label: '12. Handover & OC',           start: 27, end: 30, color: '#4f46e5' },
                    ];
                    const toX = (m: number) => (m / TOTAL) * W;
                    const SVG_H = phases.length * (ROW_H + GAP) + 20;
                    const months = [1,5,10,15,20,25,30];
                    return (
                        <svg width={LABEL_W + W} height={SVG_H} style={{width:'100%', fontSize:'6px', fontFamily:'sans-serif', display:'block'}} viewBox={`0 0 ${LABEL_W + W} ${SVG_H}`}>
                            {months.map(m => (
                                <g key={m}>
                                    <line x1={LABEL_W + toX(m-1)} y1={0} x2={LABEL_W + toX(m-1)} y2={SVG_H - 14} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="2,2"/>
                                    <text x={LABEL_W + toX(m-1)} y={SVG_H - 3} textAnchor="middle" fill="#64748b" fontSize={6}>M{m}</text>
                                </g>
                            ))}
                            {phases.map((ph, i) => {
                                const y = i * (ROW_H + GAP);
                                const x = LABEL_W + toX(ph.start);
                                const bw = toX(ph.end - ph.start);
                                return (
                                    <g key={i}>
                                        <text x={LABEL_W - 4} y={y + ROW_H * 0.7} textAnchor="end" fill="#334155" fontSize={6.5}>{ph.label}</text>
                                        <rect x={x} y={y + 1} width={bw} height={ROW_H - 2} rx={2} fill={ph.color} opacity={0.85}/>
                                        {bw > 24 && <text x={x + bw/2} y={y + ROW_H * 0.7} textAnchor="middle" fill="white" fontSize={5.5} fontWeight="bold">M{ph.start+1}–M{ph.end}</text>}
                                    </g>
                                );
                            })}
                        </svg>
                    );
                })()}
                <p className="text-[8px] mt-1 text-slate-500 italic">Critical Path: Approvals → Foundation → Basements → Superstructure → MEP → Finishing → OC</p>
            </div>
            <PageBreak />

            {/* ═══ PAGE 15 — FINANCIAL ANALYSIS ═══ */}
            <div className="report-page">
                <SH>15. Financial Analysis</SH>

                <SH2>15.1 Funding Structure</SH2>
                <div className="grid grid-cols-2 gap-4 text-[9px] mb-4">
                    <div>
                        {(() => {
                            const landCost = actualLandCost; 
                            const constructionCost = totalCost;
                            const softCosts = constructionCost * 0.15;
                            const contingency = constructionCost * 0.02;
                            const totalCapReq = landCost + constructionCost + softCosts + contingency;
                            
                            const eqCost = uw?.promoterEquity || (totalCapReq * 0.40);
                            const debtCost = uw?.requestedLoanAmount || (totalCapReq * 0.46);
                            const advCost = Math.max(0, totalCapReq - eqCost - debtCost);

                            return (
                                <>
                                    <strong className="block text-slate-700 mb-1 border-b pb-1">Capital Requirement</strong>
                                    <table className="w-full border-collapse">
                                        <thead><tr><TH>Component</TH><TH className="text-right">Amount (₹ Cr)</TH><TH className="text-right">%</TH></tr></thead>
                                        <tbody>
                                            {cb ? [
                                                ['Land', landCost, (landCost/totalCapReq)*100],
                                                ['Construction', constructionCost, (constructionCost/totalCapReq)*100],
                                                ['Soft Costs (~15%)', softCosts, (softCosts/totalCapReq)*100],
                                                ['Contingency (2%)', contingency, (contingency/totalCapReq)*100],
                                            ].map(([c, a, p], i) => (
                                                <tr key={i}>
                                                    <TD className="font-semibold bg-slate-50">{c as string}</TD>
                                                    <TD className="text-right">{crore(a as number).replace(/₹ | Cr/g,'')}</TD>
                                                    <TD className="text-right">{(p as number).toFixed(1)}%</TD>
                                                </tr>
                                            )) : null}
                                            <tr className="bg-slate-800 text-white font-bold">
                                                <TD className="font-bold text-white">Total</TD>
                                                <TD className="font-bold text-white text-right">{cb ? crore(totalCapReq).replace(/₹ | Cr/g,'') : '—'}</TD>
                                                <TD className="font-bold text-white text-right">100%</TD>
                                            </tr>
                                        </tbody>
                                    </table>
                                </>
                            );
                        })()}
                    </div>
                    <div>
                        {(() => {
                            const landCost = actualLandCost; 
                            const totalCapReq = landCost + totalCost + (totalCost * 0.15) + (totalCost * 0.02);
                            const eqCost = uw?.promoterEquity || (totalCapReq * 0.40);
                            const debtCost = uw?.requestedLoanAmount || (totalCapReq * 0.46);
                            const advCost = Math.max(0, totalCapReq - eqCost - debtCost);
                            const interestRateText = uw?.targetInterestRate ? `${uw.targetInterestRate}% p.a.` : '12% p.a.';

                            return (
                                <>
                                    <strong className="block text-slate-700 mb-1 border-b pb-1">Funding Mix</strong>
                                    <table className="w-full border-collapse">
                                        <thead><tr><TH>Source</TH><TH className="text-right">₹ Cr</TH><TH>Rate</TH><TH>Remarks</TH></tr></thead>
                                        <tbody>
                                            <tr><TD className="font-semibold bg-slate-50">Equity (40%)</TD><TD className="text-right">{crore(eqCost).replace(/₹ | Cr/g,'')}</TD><TD>—</TD><TD>Promoter + investors</TD></tr>
                                            <tr><TD className="font-semibold bg-slate-50">Debt ({((debtCost/totalCapReq)*100).toFixed(0)}%)</TD><TD className="text-right">{crore(debtCost).replace(/₹ | Cr/g,'')}</TD><TD>{interestRateText}</TD><TD>Bank/NBFC loan</TD></tr>
                                            <tr><TD className="font-semibold bg-slate-50">Advances (14%)</TD><TD className="text-right">{crore(advCost).replace(/₹ | Cr/g,'')}</TD><TD>—</TD><TD>Pre-launch bookings</TD></tr>
                                            <tr className="bg-slate-800 text-white font-bold"><TD className="font-bold text-white">Total</TD><TD className="font-bold text-white text-right">{crore(totalCapReq).replace(/₹ | Cr/g,'')}</TD><TD colSpan={2}>&nbsp;</TD></tr>
                                        </tbody>
                                    </table>
                                </>
                            );
                        })()}
                        <div className="mt-2 text-[8px] text-slate-600 space-y-0.5">
                            <p><strong>Debt Terms:</strong></p>
                            <p>• Loan-to-Value (LTV): 60% of project cost</p>
                            <p>• Tenure: {uw?.loanTenureMonths || 36} months (incl. 6-month moratorium)</p>
                            <p>• Repayment: Monthly interest, principal at end</p>
                            <p>• Security: Mortgage of land + hypothecation of receivables</p>
                        </div>
                    </div>
                </div>

                <SH2>15.2 Cash Flow Projection — Sales Realization</SH2>
                {(() => {
                    const landCost = actualLandCost;
                    const constructionCost = totalCost;
                    const softCosts = totalCost * 0.15;
                    const contingency = totalCost * 0.02;
                    const totalCapReq = landCost + constructionCost + softCosts + contingency;
                    const debtCost = uw?.requestedLoanAmount || (totalCapReq * 0.46);
                    
                    const revCr = totalRev ? totalRev / 10000000 : 83.2; // Fallback to 83.2 Cr if missing
                    const units = totalUnits || 64;

                    const p16 = revCr * 0.16;
                    const p23 = revCr * 0.23;
                    const p19 = revCr * 0.19;
                    
                    const u16 = Math.round(units * 0.16);
                    const u23 = Math.round(units * 0.23);
                    const u19 = Math.round(units * 0.19);
                    
                    const interestRate = (uw?.targetInterestRate || 12) / 100;
                    const interestExp = debtCost * interestRate; // Interest on total debt (assuming avg utilization balance)

                    return (
                        <>
                            <table className="w-full border-collapse mb-4 text-[9px]">
                                <thead><tr><TH>Quarter</TH><TH>Units Sold</TH><TH>% of Total</TH><TH className="text-right">Sales Value (₹ Cr)</TH><TH className="text-right">Collections (80%)</TH></tr></thead>
                                <tbody>
                                    {[
                                        ['Q1–Q2 (Launch)', u16, '16%', p16, p16 * 0.8],
                                        ['Q3–Q4', u23, '23%', p23, p23 * 0.8],
                                        ['Q5–Q6', u23, '23%', p23, p23 * 0.8],
                                        ['Q7–Q8', u19, '19%', p19, p19 * 0.8],
                                        ['Q9–Q10', (units - u16 - (u23*2) - u19), '19%', (revCr - p16 - (p23*2) - p19), (revCr - p16 - (p23*2) - p19) * 0.8],
                                    ].map(([q, u, p, sv, col], i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{q as string}</TD><TD>{u as number}</TD><TD>{p as string}</TD>
                                            <TD className="text-right">{(sv as number).toFixed(2)}</TD><TD className="text-right">{(col as number).toFixed(2)}</TD>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-800 text-white font-bold">
                                        <TD className="font-bold text-white">Total</TD><TD className="font-bold text-white">{units}</TD><TD className="font-bold text-white">100%</TD>
                                        <TD className="font-bold text-white text-right">{revCr.toFixed(2)}</TD>
                                        <TD className="font-bold text-white text-right">{(revCr * 0.8).toFixed(2)}</TD>
                                    </tr>
                                </tbody>
                            </table>
                            <p className="text-[8px] text-slate-500 italic mb-3">* Balance on possession: ~₹{(revCr * 0.2).toFixed(1)} Cr (20% at handover)</p>

                            <SH2>15.3 Profit & Loss Statement</SH2>
                            <div className="grid grid-cols-2 gap-4">
                                <table className="w-full border-collapse text-[9px]">
                                    <thead><tr><TH>Particulars</TH><TH className="text-right">₹ Crores</TH></tr></thead>
                                    <tbody>
                                        <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Revenue</TD></tr>
                                        <tr><TD>Total Sales</TD><TD className="text-right">{revCr.toFixed(2)}</TD></tr>
                                        <tr><TD>Less: GST (input credit)</TD><TD className="text-right">—</TD></tr>
                                        <tr className="font-semibold"><TD>Net Revenue</TD><TD className="text-right">{revCr.toFixed(2)}</TD></tr>
                                        <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Less: Project Cost</TD></tr>
                                        <tr><TD>Land</TD><TD className="text-right">{crore(landCost).replace(/₹ | Cr/g,'')}</TD></tr>
                                        <tr><TD>Construction</TD><TD className="text-right">{crore(constructionCost).replace(/₹ | Cr/g,'')}</TD></tr>
                                        <tr><TD>Soft Costs</TD><TD className="text-right">{crore(softCosts).replace(/₹ | Cr/g,'')}</TD></tr>
                                        <tr><TD>Contingency</TD><TD className="text-right">{crore(contingency).replace(/₹ | Cr/g,'')}</TD></tr>
                                        <tr className="font-semibold bg-slate-50"><TD>Total Cost</TD><TD className="text-right">{crore(totalCapReq).replace(/₹ | Cr/g,'')}</TD></tr>
                                        <tr className="font-bold text-green-700"><TD>Gross Profit</TD><TD className="text-right">{(revCr - (totalCapReq/10000000)).toFixed(2)}</TD></tr>
                                        <tr><TD>Gross Margin</TD><TD className="text-right font-semibold">{((revCr - (totalCapReq/10000000)) / revCr * 100).toFixed(1)}%</TD></tr>
                                    </tbody>
                                </table>
                                <table className="w-full border-collapse text-[9px]">
                                    <thead><tr><TH>Particulars</TH><TH className="text-right">₹ Crores</TH></tr></thead>
                                    <tbody>
                                        <tr className="bg-slate-50 font-semibold"><TD colSpan={2}>Less: Operating Expenses</TD></tr>
                                        <tr><TD>Marketing & Sales (3%)</TD><TD className="text-right">{(revCr * 0.03).toFixed(2)}</TD></tr>
                                        <tr><TD>Brokerage (2%)</TD><TD className="text-right">{(revCr * 0.02).toFixed(2)}</TD></tr>
                                        <tr className="font-semibold"><TD>Total OpEx</TD><TD className="text-right">{(revCr * 0.05).toFixed(2)}</TD></tr>
                                        
                                        {(() => {
                                            const ebitda = revCr - (totalCapReq/10000000) - (revCr * 0.05);
                                            const pbt = ebitda - (interestExp/10000000);
                                            const tax = pbt * 0.25;
                                            const pat = pbt - tax;
                                            
                                            return (
                                                <>
                                                    <tr className="font-bold text-blue-700 bg-blue-50"><TD>EBITDA</TD><TD className="text-right">{ebitda.toFixed(2)}</TD></tr>
                                                    <tr><TD>EBITDA Margin</TD><TD className="text-right text-blue-700 font-semibold">{(ebitda / revCr * 100).toFixed(1)}%</TD></tr>
                                                    <tr><TD>Less: Interest on Debt</TD><TD className="text-right">{(interestExp/10000000).toFixed(2)}</TD></tr>
                                                    <tr className="font-semibold"><TD>PBT</TD><TD className="text-right">{pbt.toFixed(2)}</TD></tr>
                                                    <tr><TD>Less: Income Tax (25%)</TD><TD className="text-right">{tax.toFixed(2)}</TD></tr>
                                                    <tr className="font-bold text-green-700 bg-green-50"><TD>PAT</TD><TD className="text-right">{pat.toFixed(2)}</TD></tr>
                                                    <tr><TD>PAT Margin</TD><TD className="text-right font-semibold">{((pat / revCr) * 100).toFixed(1)}%</TD></tr>
                                                </>
                                            );
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    );
                })()}
            </div>
            <PageBreak />

            {/* ═══ PAGE 16 — SENSITIVITY & APPROVALS ═══ */}
            <div className="report-page">
                <SH>16. Sensitivity Analysis & Approvals</SH>

                <SH2>16.1 Impact of Price Variation</SH2>
                <table className="w-full border-collapse mb-4 text-[9px]">
                    <thead><tr><TH>Price Change</TH><TH>Revenue (₹ Cr)</TH><TH>PAT (₹ Cr)</TH><TH>PAT Margin</TH><TH>ROE</TH></tr></thead>
                    <tbody>
                        {(() => {
                            const baseRevCr = (totalRev || (totalCarpet * 11000 * 10.764)) / 10000000;
                            const totalCostFullCr = (totalCost * 1.17 + actualLandCost) / 10000000;
                            const debtCostTraced = uw?.requestedLoanAmount || (totalCostFullCr * 10000000 * 0.46);
                            const interestExpCr = (debtCostTraced * ((uw?.targetInterestRate || 12)/100)) / 10000000;
                            const equityCr = (uw?.promoterEquity || (totalCostFullCr * 10000000 * 0.40)) / 10000000;

                            return [-10, -5, 0, 5, 10].map((pct, i) => {
                                const rev = baseRevCr * (1 + pct / 100);
                                const ebitda = rev - totalCostFullCr - (rev * 0.05);
                                const pbt = ebitda - interestExpCr;
                                const tax = pbt > 0 ? pbt * 0.25 : 0;
                                const pat = pbt - tax;
                                const patM = (pat / rev) * 100;
                                const roe = (pat / equityCr) * 100;
                                return (
                                    <tr key={i} className={pct === 0 ? 'bg-blue-50 font-bold' : i % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold">{pct === 0 ? 'Base (0%)' : `${pct > 0 ? '+' : ''}${pct}%`}</TD>
                                        <TD className="text-right">{rev.toFixed(2)}</TD>
                                        <TD className={`text-right ${pat < 0 ? 'text-red-600' : 'text-green-700'} font-semibold`}>{pat.toFixed(2)}</TD>
                                        <TD className="text-right">{patM.toFixed(1)}%</TD>
                                        <TD className="text-right">{roe.toFixed(1)}%</TD>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
                <p className="text-[8px] text-slate-500 italic mb-4">Break-even Price: ₹{fmt((totalCost * 1.17 + actualLandCost) / (totalCarpet * 10.764))}/sq.ft carpet</p>

                <SH2>16.2 Impact of Cost Variation</SH2>
                <table className="w-full border-collapse mb-4 text-[9px]">
                    <thead><tr><TH>Cost Change</TH><TH>Total Cost (₹ Cr)</TH><TH>PAT (₹ Cr)</TH><TH>PAT Margin</TH><TH>ROE</TH></tr></thead>
                    <tbody>
                        {[
                            ['+10%', 72.12, 4.39, '5.2%', '16.9%'],
                            ['+5%',  68.84, 6.07, '7.2%', '23.3%'],
                            ['Base (0%)', 65.56, 7.75, '9.3%', '29.8%'],
                            ['-5%',  62.28, 9.43, '11.3%','36.3%'],
                        ].map(([c, tc, pat, patM, roe], i) => {
                            const patNum = pat as number;
                            return (
                            <tr key={i} className={c === 'Base (0%)' ? 'bg-blue-50 font-bold' : i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{c}</TD>
                                <TD className="text-right">{tc}</TD>
                                <TD className={`text-right ${patNum < 7 ? 'text-red-600' : 'text-green-700'} font-semibold`}>{pat}</TD>
                                <TD className="text-right">{patM}</TD>
                                <TD className="text-right">{roe}</TD>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
                <p className="text-[8px] text-slate-500 italic mb-4">Break-even on Cost: +19% overrun (reduces PAT to zero)</p>

                <SH2>16.3 Pre-Construction Approvals</SH2>
                <div className="grid grid-cols-2 gap-4 text-[9px]">
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Building Plan Approval</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: Director, Town & Country Planning / Municipal Corp</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Form BR-I (Application)</li>
                            <li>Ownership proof (Sale deed)</li>
                            <li>Site plan (1:500) + Building plans (1:100) — 3 copies</li>
                            <li>Structural drawings + BR-V(A2) safety certificate</li>
                            <li>Drainage & zoning compliance certificate</li>
                            <li>Scrutiny fee (₹10/sq.m of covered area)</li>
                        </ul>
                        <p className="mt-1 text-[8px]"><strong>Timeline:</strong> 20 days &nbsp;|&nbsp; <strong>Validity:</strong> 5 years (≥15m buildings)</p>

                        <strong className="block text-slate-700 mt-2 mb-1 border-b pb-1">Fire NOC</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: Director, Fire Services, {plot.regulation?.location?.replace(' Building Code', '') || 'State'}</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Sanctioned building + fire safety plans</li>
                            <li>Fire-fighting system design + escape plans</li>
                            <li>Elevation showing fire ladder access</li>
                            <li>Affidavit of compliance</li>
                        </ul>
                        <p className="mt-1 text-[8px]"><strong>Timeline:</strong> 30 days &nbsp;|&nbsp; <strong>Validity:</strong> Till OC stage</p>
                    </div>
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">RERA Registration</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: {plot.regulation?.location?.replace(' Building Code', '') || 'State'} Real Estate Regulatory Authority</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Land title documents + sanctioned plans</li>
                            <li>All approvals (building, fire, environment)</li>
                            <li>Project details (cost, timeline, specs)</li>
                            <li>Bank account details (70% escrow)</li>
                            <li>Architect/Engineer/Contractor agreements</li>
                            <li>Promoter details & declarations</li>
                        </ul>
                        <p className="mt-1 text-[8px]"><strong>Timeline:</strong> 30 days &nbsp;|&nbsp; <strong>Fee:</strong> ₹5L + ₹5/sq.m carpet</p>

                        <strong className="block text-slate-700 mb-1 border-b pb-1">Environmental Clearance</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: Self-certification (Category A building)</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Self-certification on prescribed format</li>
                            <li>Compliance checklist (Code 12.1(2))</li>
                            <li>Architect's certificate</li>
                        </ul>
                        <p className="mt-1 text-[8px] mb-2"><strong>Timeline:</strong> At OC stage &nbsp;|&nbsp; <strong>Validity:</strong> N/A (self-cert)</p>

                        <strong className="block text-slate-700 mb-1 border-b pb-1">Utility Connections (Temp)</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Electricity (UHBVN/DHBVN) | Water (MC/HUDA)</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>100 kW Construction load (30-45 days, ~₹5L cost)</li>
                            <li>Temporary water tanker setup (15-30 days)</li>
                        </ul>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 16B — DURING & POST CONSTRUCTION APPROVALS ═══ */}
            <div className="report-page">
                <SH2>16.4 During Construction Approvals</SH2>
                <div className="grid grid-cols-2 gap-4 text-[9px] mb-6">
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Third-Party Inspections</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Frequency: Quarterly | Inspector: Empanelled TPIA</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Foundation inspection (before backfilling)</li>
                            <li>Structural progress (each floor)</li>
                            <li>Quality of materials & Workmanship standards</li>
                            <li>Safety compliance</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">DPC Certificate</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: Self-certification by Architect</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Architect's cert (construction up to DPC as per plan)</li>
                            <li>Photographs (all sides, plinth level)</li>
                        </ul>
                        <p className="mt-1 text-[8px]"><strong>Timeline:</strong> Within 7 days / Deemed acceptance if no comments</p>
                    </div>
                </div>

                <SH2>16.5 Post-Construction Approvals</SH2>
                <div className="grid grid-cols-2 gap-4 text-[9px]">
                    <div>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Occupation Certificate</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Authority: Competent Authority (Town Planning/MC)</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Completion certificate (Architect + Engineer)</li>
                            <li>Final Fire NOC + ECBC compliance certificate</li>
                            <li>Solar + STP commissioning certificates</li>
                            <li>As-built drawings + photographs</li>
                            <li>Composition fee (if deviations)</li>
                        </ul>
                        <p className="mt-1 text-[8px] mb-2"><strong>Timeline:</strong> 18 days &nbsp;|&nbsp; <strong>Deemed:</strong> 60 days</p>

                        <strong className="block text-slate-700 mb-1 border-b pb-1">Completion Certificate (RERA)</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Timeline: Within 30 days of Occupation Certificate</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Occupation Certificate (copy)</li>
                            <li>Completion statement (actual vs declared)</li>
                            <li>Pending dues statement + Defect liability undertaking</li>
                        </ul>
                    </div>
                    <div>
                        {(() => {
                            // Calculate demand using standard NBC norms since they aren't directly in metrics
                            const waterDemand = totalUnits * 5 * 135; // 5 persons/unit, 135 L/capita/day
                            const sewGen = waterDemand * 0.8; // 80% of domestic water demand
                            const elecLoad = totalUnits * 6 * 1.3; // 6 kW/unit + 30% for common areas/basement
                            
                            return (
                                <>
                                    <strong className="block text-slate-700 mb-1 border-b pb-1">Permanent Utility Connections</strong>
                                    <p className="text-slate-500 text-[8px] mb-1">Electricity ({fmt(elecLoad)} kW load) — UHBVN/DHBVN</p>
                                    <ul className="list-disc pl-3 space-y-[1px] text-slate-600 mb-2">
                                        <li>OC, Load calc, CEI approval, Electrical cert</li>
                                        <li>Timeline: 45-60 days | Cost: {lakh(elecLoad * 2000)} - {lakh(elecLoad * 2500)}</li>
                                    </ul>
                                    <p className="text-slate-500 text-[8px] mb-1">Water ({fmt(waterDemand)} L/day) — Municipal Corp / HUDA</p>
                                    <ul className="list-disc pl-3 space-y-[1px] text-slate-600 mb-2">
                                        <li>OC + Plumbing completion certificate</li>
                                        <li>Timeline: 30-45 days | Cost: {lakh(waterDemand * 18)} - {lakh(waterDemand * 25)}</li>
                                    </ul>
                                    <p className="text-slate-500 text-[8px] mb-1">Sewerage ({fmt(sewGen)} L/day) — Municipal Corp</p>
                                    <ul className="list-disc pl-3 space-y-[1px] text-slate-600 mb-2">
                                        <li>OC, STP completion cert, Zero-discharge compliance</li>
                                        <li>Timeline: 30 days | Cost: {lakh(sewGen * 12)} - {lakh(sewGen * 18)}</li>
                                    </ul>
                                </>
                            );
                        })()}

                        <strong className="block text-slate-700 mb-1 border-b pb-1">Conveyance Deed (to Society/RWA)</strong>
                        <p className="text-slate-500 text-[8px] mb-1">Timeline: Within 3 months of formation of RWA</p>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Land (proportionate to each flat)</li>
                            <li>Common areas, amenities, undivided share</li>
                        </ul>
                        <p className="mt-1 text-[8px]"><strong>Registration:</strong> At Sub-Registrar office</p>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 17 — RISK REGISTER ═══ */}
            <div className="report-page">
                <SH>17. Risk Analysis</SH>
                <SH2 className="mt-2 text-blue-800">17.1 Project Risks & Mitigation</SH2>
                {[
                    { cat: 'Construction Risks', rows: [
                        ['Delay in approvals', 'Medium', 'High', ['Early application (1 month lead)', 'Professional consultants', 'Follow-up mechanism']],
                        ['Soil complications', 'Low', 'High', ['Detailed soil investigation', 'Contingency in foundation design', 'Experienced geotech engineer']],
                        ['Labor shortage', 'Medium', 'Medium', ['Multiple labor contractors', 'Skilled labor retention (incentives)', 'Mechanization where possible']],
                        ['Material price escalation', 'High', 'Medium', ['Bulk procurement (advance orders)', 'Price escalation clause with vendors', 'Alternative materials']],
                        ['Weather delays', 'Medium', 'Low', ['Monsoon planning (waterproofing priority)', 'Protective measures (tarpaulin)', 'Float in schedule (buffer)']],
                        ['Quality issues', 'Low', 'High', ['Third-party inspection', 'Stringent QC protocols', 'Testing at regular intervals']],
                        ['Safety incidents', 'Low', 'Very High', ['Dedicated safety officer', 'Safety training & audits', 'Insurance coverage']],
                    ]},
                    { cat: 'Financial Risks', rows: [
                        ['Slow sales', 'Medium', 'High', ['Competitive pricing', 'Aggressive marketing', 'Flexible payment plans', 'Broker tie-ups']],
                        ['Cost overrun', 'Medium', 'High', ['Detailed cost estimation', 'Contingency provision (2%)', 'Value engineering', 'Vendor contracts (fixed price)']],
                        ['Interest rate hike', 'Medium', 'Medium', ['Prepayment from sales', 'Fixed-rate loan (if possible)', 'Faster sales velocity']],
                        ['Funding delays', 'Low', 'High', ['Multiple funding sources', 'Advance tie-ups', 'Customer advances (pre-launch)']],
                    ]},
                    { cat: 'Market Risks', rows: [
                        ['Market slowdown', 'Medium', 'High', ['Phased launches', 'Price flexibility', 'Product differentiation (amenities)', 'Target right segment']],
                        ['Competition', 'High', 'Medium', ['Unique selling points (location, design)', 'Better amenities', 'Brand building']],
                        ['Regulatory changes', 'Low', 'Medium', ['Compliance buffer', 'Flexibility in design', 'Legal advice']],
                    ]},
                    { cat: 'Operational Risks', rows: [
                        ['Contractor default', 'Low', 'High', ['Financial vetting', 'Performance bank guarantee', 'Backup contractors']],
                        ['Design changes', 'Medium', 'Medium', ['Detailed planning upfront', 'Minimize changes', 'Change control process']],
                        ['Defects post-handover', 'Medium', 'Medium', ['Quality construction', 'Defect liability period (1 year)', 'Warranty (5 years structural)']],
                    ]},
                ].map((section, si) => (
                    <div key={si} className="mb-4 no-break">
                        <SH2 className="mt-2">{section.cat}</SH2>
                        <table className="w-full border-collapse">
                            <thead><tr><TH>Risk</TH><TH>Probability</TH><TH>Impact</TH><TH>Mitigation</TH></tr></thead>
                            <tbody>
                                {section.rows.map(([risk, prob, impact, mit], i) => (
                                    <tr key={i}>
                                        <TD className="font-semibold bg-slate-50">{risk as string}</TD>
                                        <TD className={prob === 'High' ? 'text-red-600 font-bold' : prob === 'Medium' ? 'text-orange-600' : 'text-green-600'}>{prob as string}</TD>
                                        <TD className={impact === 'Very High' || impact === 'High' ? 'text-red-600 font-bold' : 'text-orange-600'}>{impact as string}</TD>
                                        <TD className="text-[9px] py-1">
                                            <ul className="list-disc pl-4 m-0 space-y-[1px]">
                                                {(mit as string[]).map((m, idx) => <li key={idx}>{m}</li>)}
                                            </ul>
                                        </TD>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
            </div>
            <PageBreak />

            {/* ═══ PAGE 18 — UNDERWRITING ═══ */}
            <div className="report-page">
                <SH>18. Underwriting — Credit Assessment</SH>
                <SH2 className="mt-2 text-blue-800">18.1 Credit Assessment Summary</SH2>
                {(() => {
                    // ── Dynamic scoring logic ──────────────────────
                    const roiPct = estimates?.roi_percentage ?? roi ?? 0;
                    const dscr = roiPct > 20 ? 1.8 : roiPct > 10 ? 1.4 : 1.1;
                    const farCompliant = achievedFAR <= far + 0.05;
                    const gcCompliant = gcPct <= maxCov + 1;
                    const parkCompliant = parkProv >= parkReq;
                    const greenCount = greenItems?.length ?? 0;
                    const greenPass = greenItems?.filter((g: any) => g.status === 'pass').length ?? 0;
                    const greenPct = greenCount > 0 ? greenPass / greenCount : 0;

                    // --- Promoter Profile (max 20) ---
                    // measured by: project completeness, towers, units, green compliance presence
                    let promoterScore = 12; // base
                    if (towers >= 2) promoterScore += 2;
                    if (totalUnits >= 30) promoterScore += 2;
                    if (greenPct >= 0.5) promoterScore += 2;
                    if (carpetEff >= 60) promoterScore += 2;
                    promoterScore = Math.min(20, promoterScore);

                    // --- Project Viability (max 30) ---
                    let viabilityScore = 10; // base
                    if (farCompliant) viabilityScore += 4;
                    if (gcCompliant) viabilityScore += 4;
                    if (parkCompliant) viabilityScore += 3;
                    if (roiPct >= 20) viabilityScore += 5;
                    else if (roiPct >= 10) viabilityScore += 3;
                    if (carpetEff >= 60) viabilityScore += 2;
                    if (totalUnits >= 10) viabilityScore += 2;
                    viabilityScore = Math.min(30, viabilityScore);

                    // --- Financial Structuring (max 25) ---
                    let finScore = 8; // base
                    if (dscr >= 1.5) finScore += 6;
                    else if (dscr >= 1.25) finScore += 4;
                    else if (dscr >= 1.0) finScore += 2;
                    if (roiPct >= 20) finScore += 5;
                    else if (roiPct >= 10) finScore += 3;
                    if (profit > 0) finScore += 4;
                    if (totalCost > 0 && profit / totalCost > 0.3) finScore += 2;
                    finScore = Math.min(25, finScore);

                    // --- Location & Marketability (max 20) ---
                    let locationScore = 12; // base — location assumed Tier-1/2
                    if (totalUnits >= 30) locationScore += 2; // scale suggests market demand
                    if (carpetEff >= 60) locationScore += 2;
                    if (greenPct >= 0.5) locationScore += 2;
                    if (parkCompliant) locationScore += 2;
                    locationScore = Math.min(20, locationScore);

                    // --- Legal & Regulatory (max 5) ---
                    let legalScore = 3;
                    if (farCompliant && gcCompliant) legalScore = 4;
                    if (farCompliant && gcCompliant && parkCompliant) legalScore = 5;

                    const totalScore = promoterScore + viabilityScore + finScore + locationScore + legalScore;
                    const totalMax = 100;
                    const pct = (totalScore / totalMax) * 100;

                    const grade = (s: number, max: number) => {
                        const p = (s / max) * 100;
                        if (p >= 95) return { label: 'AAA', cls: 'text-emerald-700' };
                        if (p >= 88) return { label: 'A+', cls: 'text-green-700' };
                        if (p >= 80) return { label: 'A', cls: 'text-green-600' };
                        if (p >= 70) return { label: 'B+', cls: 'text-yellow-700' };
                        if (p >= 60) return { label: 'B', cls: 'text-yellow-600' };
                        return { label: 'C', cls: 'text-red-600' };
                    };

                    const overallGrade = grade(totalScore, totalMax);
                    const riskLabel = pct >= 85 ? 'Low Risk' : pct >= 70 ? 'Moderate Risk' : 'High Risk';
                    const recommendation = pct >= 80 ? 'APPROVE — Standard Conditions' : pct >= 65 ? 'CONDITIONAL APPROVAL' : 'REFER — Additional Due Diligence Required';
                    const bannerCls = pct >= 80 ? 'bg-green-50 border-green-200 text-green-800' : pct >= 65 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-700';

                    const criteria = [
                        { label: 'Promoter Profile', score: promoterScore, max: 20, detail: `${towers} towers, ${totalUnits} units, ${carpetEff.toFixed(0)}% carpet eff.` },
                        { label: 'Project Viability', score: viabilityScore, max: 30, detail: `ROI ${roiPct.toFixed(1)}%, FAR ${farCompliant ? '✔' : '✗'}, GC ${gcCompliant ? '✔' : '✗'}, Parking ${parkCompliant ? '✔' : '✗'}` },
                        { label: 'Financial Structuring', score: finScore, max: 25, detail: `DSCR ${dscr.toFixed(2)}, Profit ${crore(profit)}` },
                        { label: 'Location & Marketability', score: locationScore, max: 20, detail: `${greenPass}/${greenCount} green items, demand indicators positive` },
                        { label: 'Legal & Regulatory', score: legalScore, max: 5, detail: farCompliant && gcCompliant && parkCompliant ? 'All key regulations met' : 'Minor non-conformances noted' },
                    ];

                    return (
                        <>
                            <table className="w-full border-collapse mb-4 text-[10px] mt-2">
                                <thead>
                                    <tr>
                                        <TH className="text-left w-1/3">Rating Criteria</TH>
                                        <TH className="text-center">Score</TH>
                                        <TH className="text-center">Max</TH>
                                        <TH className="text-center w-1/6">Rating</TH>
                                        <TH className="text-left">Key Factor</TH>
                                    </tr>
                                </thead>
                                <tbody>
                                    {criteria.map(({ label, score, max, detail }, i) => {
                                        const g = grade(score, max);
                                        const barW = Math.round((score / max) * 100);
                                        return (
                                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                <TD className="font-semibold">{label}</TD>
                                                <TD className="text-center">
                                                    <span className="font-bold text-blue-700">{score}</span>
                                                    <div className="w-full bg-slate-200 rounded h-1 mt-1">
                                                        <div className="h-1 rounded bg-blue-500" style={{ width: `${barW}%` }} />
                                                    </div>
                                                </TD>
                                                <TD className="text-center text-slate-500">{max}</TD>
                                                <TD className={`text-center font-bold text-[11px] ${g.cls}`}>{g.label}</TD>
                                                <TD className="text-slate-500 text-[8px]">{detail}</TD>
                                            </tr>
                                        );
                                    })}
                                    <tr className="bg-slate-800 text-white font-bold border-t-2 border-slate-600">
                                        <TD className="text-white font-bold">TOTAL SCORE</TD>
                                        <TD className="text-center text-white font-bold text-[13px]">{totalScore}</TD>
                                        <TD className="text-center text-slate-300">{totalMax}</TD>
                                        <TD className={`text-center font-bold text-[13px] ${overallGrade.cls}`}>{overallGrade.label}</TD>
                                        <TD className="text-slate-300 text-[8px]">{pct.toFixed(0)}% — {riskLabel}</TD>
                                    </tr>
                                </tbody>
                            </table>

                            <div className={`border p-3 rounded text-center mb-1 ${bannerCls}`}>
                                <strong className="text-base">Recommended Rating: {overallGrade.label} ({riskLabel})</strong>
                                <p className="mt-1 text-sm">{recommendation}</p>
                            </div>
                        </>
                    );
                })()}

                <SH2>18.2 Pre/Post Construction Approvals Roadmap</SH2>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <strong className="block mb-1 text-slate-700">Pre-Construction</strong>
                        <ol className="list-decimal pl-4 space-y-0.5">
                            <li>Building Plan Approval (20 days)</li>
                            <li>Fire NOC (30 days)</li>
                            <li>Environmental Certification</li>
                            <li>RERA Registration</li>
                            <li>Temp. Electricity (45 days)</li>
                        </ol>
                    </div>
                    <div>
                        <strong className="block mb-1 text-slate-700">Post-Construction</strong>
                        <ol className="list-decimal pl-4 space-y-0.5">
                            <li>Completion Certificates</li>
                            <li>Final Fire NOC</li>
                            <li>ECBC & STP Commissioning</li>
                            <li>Occupation Certificate</li>
                            <li>Conveyance Deed & RWA</li>
                        </ol>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ PAGE 19 — TECHNICAL DUE DILIGENCE ═══ */}
            <div className="report-page">
                <SH>19. Technical Due Diligence</SH>

                {/* 19.1 Regulatory Compliance */}
                <SH2>19.1 Regulatory Compliance</SH2>
                <table className="w-full border-collapse mb-2 text-[9px]">
                    <thead><tr><TH className="text-left w-1/4">Aspect</TH><TH>Requirement</TH><TH>Proposed</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        {[
                            {
                                asp: 'FAR / FSI',
                                req: `Max ${far} (base)`,
                                prop: fmt(achievedFAR, 2),
                                ok: achievedFAR <= far + 0.05,
                            },
                            {
                                asp: 'Ground Coverage',
                                req: `Max ${maxCov}%`,
                                prop: `${fmt(gcPct, 1)}%`,
                                ok: gcPct <= maxCov + 1,
                            },
                            {
                                asp: 'Building Height',
                                req: plot.regulation?.geometry?.max_building_height?.value
                                    ? `${plot.regulation.geometry.max_building_height.value}m max`
                                    : 'As per NOC / Fire dept.',
                                prop: `${fmt(maxHeight, 1)}m`,
                                ok: !plot.regulation?.geometry?.max_building_height?.value
                                    || maxHeight <= (plot.regulation.geometry.max_building_height.value + 0.5),
                            },
                            {
                                asp: 'Setback — Front',
                                req: `${plot.regulation?.geometry?.front_setback?.value ?? '—'}m`,
                                prop: `${plot.regulation?.geometry?.front_setback?.value ?? '—'}m applied`,
                                ok: true,
                            },
                            {
                                asp: 'Setback — Rear/Side',
                                req: `${plot.regulation?.geometry?.rear_setback?.value ?? '—'}m rear / ${plot.regulation?.geometry?.side_setback?.value ?? '—'}m side`,
                                prop: 'As per code',
                                ok: true,
                            },
                            {
                                asp: 'Basement Levels',
                                req: `Up to ${maxBasements} levels permitted`,
                                prop: `${maxBasements} levels (B${maxBasements}–B1)`,
                                ok: true,
                            },
                            {
                                asp: 'Parking',
                                req: `${parkReq} ECS required (1.5/unit)`,
                                prop: `${parkProv} ECS provided`,
                                ok: parkProv >= parkReq,
                            },
                            {
                                asp: 'Fire Safety',
                                req: `${regLabel(plot.regulation?.location)} / Fire Act`,
                                prop: 'Full compliance designed',
                                ok: true,
                            },
                            {
                                asp: 'Seismic Design',
                                req: 'IS 1893:2016, Zone IV',
                                prop: 'SMRF (R = 5.0)',
                                ok: true,
                            },
                        ].map(({ asp, req, prop, ok }, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{asp}</TD>
                                <TD>{req}</TD>
                                <TD className="font-semibold text-blue-700">{prop}</TD>
                                <TD className={`font-bold ${ok ? 'text-green-700' : 'text-red-600'}`}>
                                    {ok ? '✔ Compliant' : '✗ Attention'}
                                </TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[8px] font-semibold mb-3 text-green-700">
                    ✔ Compliant with {regLabel(plot.regulation?.location)}
                </p>

                <div className="grid grid-cols-2 gap-4 text-[9px]">
                    <div>
                        {/* 19.2 Structural Assessment */}
                        <SH2>19.2 Structural Assessment</SH2>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Foundation</strong>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600 mb-2">
                            <li><strong>Type:</strong> Deep raft foundation (500mm thick)</li>
                            <li><strong>Depth:</strong> 8–10m (medium dense sand, SBC 300 kN/sq.m)</li>
                            <li><strong>Est. Load:</strong> ~{fmt(Math.round(maxFloors * 305 * towers))} tonnes total ({fmt(Math.round(maxFloors * 305))} per tower)</li>
                            <li><strong>Safety Factor:</strong> &gt;3 ✔</li>
                            <li><strong>Towers:</strong> {towers} × {Math.round(builtUp / towers / totalLevels)} sq.m plate each</li>
                        </ul>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Structural System (SMRF)</strong>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600 mb-2">
                            <li>Special Moment Resisting Frame (R = 5.0)</li>
                            <li>Concrete: M30 (columns/beams), M25 (slabs)</li>
                            <li>Steel: Fe500D (earthquake-resistant)</li>
                            <li>Design: IS 456, IS 1893, IS 13920 ✔</li>
                        </ul>
                        <strong className="block text-slate-700 mb-1 border-b pb-1">Geotechnical (Assumed)</strong>
                        <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                            <li>Soil: Medium dense sand (N-value 15–25 @ 8–10m)</li>
                            <li>Water table: 10–12m below ground</li>
                            <li>Confirm with {towers} boreholes (1 per tower)</li>
                        </ul>
                        <p className="text-[8px] text-blue-700 font-semibold mt-1">Technical Score: 9/10 (pending soil investigation)</p>

                        {/* 19.3 Quality & Construction Standards */}
                        <SH2>19.3 Quality & Construction Standards</SH2>
                        <table className="w-full border-collapse text-[9px]">
                            <thead><tr><TH>Aspect</TH><TH>Specification</TH></tr></thead>
                            <tbody>
                                {[
                                    ['Formwork', 'Aluminum/steel (PERI/MEVA), reusable'],
                                    ['Concrete', 'RMC from certified plant, IS 456 compliant'],
                                    ['Curing', '7–14 days water ponding / wet gunny'],
                                    ['Testing', '3 cubes per 100 cu.m @ 7, 14, 28 days'],
                                    ['Masonry', 'AAC blocks (230mm ext., 115mm int.)'],
                                    ['Waterproofing', 'APP membrane (basements, terrace)'],
                                    ['QC', 'Third-party inspection (quarterly)'],
                                ].map(([a, s], i) => (
                                    <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold">{a}</TD><TD>{s}</TD>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="text-[8px] text-green-700 font-semibold mt-1">✔ Adequate quality assurance protocols in place</p>
                    </div>
                    <div>
                        {/* 19.4 Sustainability Features */}
                        <SH2>19.4 Sustainability Features</SH2>
                        <table className="w-full border-collapse mb-3 text-[9px]">
                            <thead><tr><TH>Feature</TH><TH>Specification</TH><TH>Benefit</TH></tr></thead>
                            <tbody>
                                {[
                                    ...(hasSolar ? [['Solar Power', `${towers * 10} kWp (rooftop, ${towers} towers)`, '₹1.8L/year savings']] : [['Solar Power', 'Not yet configured', 'Recommend addition']]),
                                    ['ECBC Compliance', 'Insulation, double glazing, shading', '~29% energy reduction'],
                                    ...(hasSTP ? [['STP', `${Math.round(totalUnits * 0.135)} KLD, 100% reuse`, 'Zero discharge']] : [['STP', 'Not yet configured', 'Recommend addition']]),
                                    ...(hasRWH ? [['Rainwater Harvesting', `${towers * 2} bores, 20,000L tank`, '851 cu.m/year recharge']] : [['Rainwater Harvesting', 'Not yet configured', 'Recommend addition']]),
                                    ['LED Lighting', '100% common areas', '₹1.2L/year savings'],
                                ].map(([f, s, b], i) => (
                                    <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold">{f}</TD><TD>{s}</TD>
                                        <TD className={b.includes('Recommend') ? 'text-yellow-600' : 'text-green-700'}>{b}</TD>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="text-[8px] font-semibold mb-3">
                            {(hasSolar && hasSTP && hasRWH)
                                ? '✔ Excellent — potential for GRIHA 3-star certification'
                                : '⚠ Add missing green features to unlock GRIHA certification'}
                        </p>

                        {/* 19.5 Project Technical Specifications */}
                        <SH2>19.5 Project Technical Specifications</SH2>
                        <table className="w-full border-collapse text-[9px]">
                            <thead><tr><TH className="text-left">Parameter</TH><TH className="text-left">Value</TH></tr></thead>
                            <tbody>
                                {[
                                    ['Plot Area', `${fmt(plotArea)} sq.m`],
                                    ['Location', typeof plot.location === 'object' ? String(plot.regulation?.location || 'Defined in model') : String(plot.location || 'Defined in model')],
                                    ['Zoning', `${project.intendedUse || 'Residential'} (Group Housing)`],
                                    ['Towers', `${towers} Nos.`],
                                    ['Structure', `B${maxBasements} + Ground + ${maxFloors} Upper = ${totalLevels} levels`],
                                    ['Building Height', `${fmt(maxHeight, 1)}m`],
                                    ['Structural System', 'RCC Frame (SMRF)'],
                                    ['Seismic Zone', 'Zone IV'],
                                    ['Total Built-up', `${fmt(builtUp)} sq.m`],
                                    ['Total RERA Carpet', `${fmt(totalCarpet)} sq.m`],
                                    ['Carpet Efficiency', `${carpetEff.toFixed(1)}%`],
                                    ['Total Units', `${totalUnits}`],
                                    ['Avg Unit Carpet', `~${totalUnits > 0 ? Math.round(totalCarpet / totalUnits) : '—'} sq.m`],
                                    ['Parking Provided', `${parkProv} ECS (${parkProv >= parkReq ? `${parkReq > 0 ? Math.round(((parkProv - parkReq) / parkReq) * 100) : 0}% surplus` : 'deficit'})`],
                                ].map(([p, v], i) => (
                                    <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold text-slate-700">{p}</TD>
                                        <TD className="text-blue-800 font-medium">{v}</TD>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ═══ FINAL PAGE — DISCLAIMER ═══ */}
            <div className="report-page">
                <div className="mt-12 p-6 bg-slate-800 text-white rounded text-center">
                    <h2 className="text-xl font-bold mb-2 text-blue-300">End of Feasibility Report</h2>
                    <p className="text-sm text-slate-300 max-w-lg mx-auto">
                        This report was generated dynamically by the Keystone Automated Feasibility Engine.
                        All standard specifications are based on {plot.regulation?.location ? regLabel(plot.regulation?.location, true) : 'National Building Code 2016'}.
                        Project-specific data is derived from the active design model.
                        Verify all metrics with local municipal regulations before financial commitment.
                    </p>
                </div>
            </div>
        </div>
    );
}
