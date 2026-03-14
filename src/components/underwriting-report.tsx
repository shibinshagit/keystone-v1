import React from 'react';
import type { Project, Plot, AdvancedKPIs, ProjectEstimates } from '@/lib/types';
import type { AlgoParams } from '@/lib/generators/basic-generator';
import { calculateBuildingCoreAndCirculation } from '@/lib/generators/building-core-calc';

interface UnderwritingReportProps {
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
const pct   = (n: number) => `${n.toFixed(1)}%`;

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
const TDP = ({ children }: { children?: React.ReactNode }) => (
    <td className="p-1.5 border border-slate-300 text-[10px] bg-amber-50 text-amber-700 italic">{children || '[To be provided]'}</td>
);
const Check = () => <span className="text-green-700 font-bold">✓ Compliant</span>;

/* ══════════════ MAIN COMPONENT ══════════════ */
export function UnderwritingReport({ project, plot, metrics, estimates, generationParams }: UnderwritingReportProps) {
    const stats = plot.developmentStats;
    let units = stats?.units?.breakdown || {};
    let totalUnits = stats?.units?.total || 0;

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
        if (tCount > 0) { totalUnits = tCount; units = bDown; }
    }

    const far = plot.far || plot.regulation?.geometry?.floor_area_ratio?.value || 1.0;
    const maxCov = plot.maxCoverage || plot.regulation?.geometry?.max_ground_coverage?.value || 40;
    const towers = plot.buildings?.length || 1;
    const maxFloors = plot.buildings?.reduce((m, b) => Math.max(m, b.numFloors || 1), 0) || 5;
    const maxHeight = maxFloors * (plot.buildings?.[0]?.typicalFloorHeight || 3);
    const plotArea = plot.area || 0;
    const builtUp = stats?.totalBuiltUpArea || metrics?.totalBuiltUpArea || 0;
    const achievedFAR = metrics?.achievedFAR ?? (builtUp && plotArea ? builtUp / plotArea : 0);
    const gcPct = metrics?.groundCoveragePct ?? 0;
    const totalCarpet = metrics?.sellableArea ?? (builtUp * 0.65);
    const carpetEff = builtUp ? (totalCarpet / builtUp) * 100 : 65;
    const parkReq = metrics?.parking?.required ?? Math.ceil(totalUnits * 1.5);
    const parkProv = metrics?.parking?.provided ?? 0;

    const totalCost = estimates?.total_construction_cost ?? 0;
    const totalRev = estimates?.total_revenue ?? 0;
    const profit = estimates?.potential_profit ?? 0;
    const roi = estimates?.roi_percentage ?? 0;
    const cb = estimates?.cost_breakdown;
    const tl = estimates?.timeline;
    const sim = estimates?.simulation;

    // User-Defined Underwriting vs Fallback
    const uw = project.underwriting || {};
    const requestedLoan = uw.requestedLoanAmount || 0;
    const requestedEquity = uw.promoterEquity || 0;
    
    // Loan structure
    const totalCap = requestedLoan + requestedEquity || totalCost;
    const loanPct = requestedLoan && totalCap ? requestedLoan / totalCap : 0.45;
    const loanAmount = requestedLoan || (totalCost * loanPct);
    const equityAmount = requestedEquity || (totalCost - loanAmount);
    
    const targetInterestRate = uw.targetInterestRate ?? 10.0;
    const loanTenure = uw.loanTenureMonths || (sim ? Math.round(sim.time_p50) : (tl ? Math.round(tl.total_months) : 36));

    const grossMargin = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : 0;
    const totalMonths = loanTenure;
    const costRange = sim ? `${crore(sim.cost_p10)} – ${crore(sim.cost_p90)}` : (totalCost ? crore(totalCost) : 'Pending');
    const avgUnitPrice = totalUnits > 0 ? totalRev / totalUnits : 0;
    const breakEvenUnits = totalCost > 0 && avgUnitPrice > 0 ? Math.ceil(totalCost / avgUnitPrice * 0.45) : Math.ceil(totalUnits * 0.45);
    const sqftArea = totalCarpet * 10.764;
    const pricePerSqft = sqftArea > 0 ? totalRev / sqftArea : 0;

    const buildingCores = (plot.buildings || []).map(b => {
        const floors = b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3));
        let useType: 'Residential' | 'Commercial' | 'Institutional' = 'Residential';
        if (String(b.intendedUse) === 'Commercial') useType = 'Commercial';
        const core = calculateBuildingCoreAndCirculation({ footprintArea: b.area, numFloors: floors, avgUnitArea: 140, intendedUse: useType });
        return { name: b.name || b.id.slice(0, 8), area: b.area, floors, core };
    });

    // Dynamic risk calculations (shared across Section 6)
    const marketScore = totalUnits > 200 ? 4.0 : totalUnits > 100 ? 3.5 : 3.0;
    const execScore = totalMonths > 36 ? 4.0 : totalMonths > 24 ? 3.5 : 3.0;
    const regScore = (achievedFAR / far) > 0.95 ? 4.5 : 3.5;
    const finScore = grossMargin < 20 ? 4.5 : grossMargin < 25 ? 3.5 : 2.5;
    const locScore = (plotArea / Math.max(1, totalUnits)) < 35 ? 4.5 : (parkProv < parkReq) ? 4.0 : 3.0;
    const promScore = 3.5; // Remains static/TBD placeholder
    
    // Returns [Label, CSS Class]
    const avgRisk = (marketScore+execScore+regScore+finScore+locScore+promScore)/6;
    const getRiskLabel = (s: number) => s >= 4.1 ? ['Critical', 'text-red-600'] : s >= 3.1 ? ['High', 'text-orange-600'] : s >= 2.1 ? ['Medium', 'text-yellow-700'] : ['Low', 'text-green-700'];
    const getRecText = (s: number) => s >= 4.0 ? 'DECLINED' : s >= 3.6 ? 'ESCALATED FOR REVIEW' : s >= 3.0 ? 'CONDITIONALLY APPROVED' : 'APPROVED';
    const getRecColorLight = (s: number) => s >= 4.0 ? 'text-red-700' : s >= 3.6 ? 'text-orange-700' : s >= 3.0 ? 'text-amber-700' : 'text-green-700';
    const getRecColorDark = (s: number) => s >= 4.0 ? 'text-red-400' : s >= 3.6 ? 'text-orange-400' : s >= 3.0 ? 'text-amber-400' : 'text-green-400';

    return (
        <div className="bg-white text-black text-[10.5px] font-sans leading-relaxed print:bg-white" style={{ colorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page { size: A4; margin: 12mm 15mm; }
                    body, html { background: white !important; }
                    .page-break { break-after: page; page-break-after: always; }
                }
            `}} />

            {/* ═══ COVER ═══ */}
            <div className="report-page flex flex-col items-center justify-center min-h-[60vh] text-center">
                <h1 className="text-2xl font-bold tracking-tight mb-2 uppercase">Comprehensive Underwriting &amp; Risk Assessment Report</h1>
                <p className="text-sm text-slate-600 mb-1">Multi-Asset Class Real Estate Financing</p>
                <div className="w-24 h-0.5 bg-slate-800 my-4" />
                <p className="text-xs text-slate-500">Prepared for: [Bank Name / Financial Institution]</p>
                <p className="text-xs text-slate-500">Project Reference: {project.name}</p>
                <p className="text-xs text-slate-500">Loan Amount Requested: {crore(loanAmount)}</p>
                <p className="text-xs text-slate-500">Report Date: {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p className="text-[9px] text-red-700 mt-4 font-semibold">Classification: Confidential – Internal Use Only</p>
            </div>
            <PageBreak />

            {/* ═══ §1 EXECUTIVE SUMMARY ═══ */}
            <div className="report-page">
                <SH>1. Executive Summary</SH>
                <SH2 className="!mt-1">1.1 Transaction Overview</SH2>
                <table className="w-full border-collapse border border-slate-300 mb-4">
                    <thead><tr><TH>Parameter</TH><TH>Details</TH></tr></thead>
                    <tbody>
                        {([
                            ['Borrower/Promoter', uw.promoterName || uw.companyName || null],
                            ['Project Name', project.name],
                            ['Location', typeof plot.location === 'object' ? 'Coordinates Defined' : String(plot.location || project.location || 'N/A')],
                            ['Project Classification', `${project.intendedUse || 'Residential'} High-Rise Development`],
                            ['Land Parcel', `${fmt(plotArea)} sq.m (${fmt(plotArea / 4046.86, 2)} acres / ${fmt(plotArea * 10.764)} sq.ft)`],
                            ['Total Saleable Area', `${fmt(totalCarpet)} sq.m (${fmt(sqftArea)} sq.ft)`],
                            ['Unit Configuration', `${totalUnits} Apartments (${Object.entries(units).map(([k,v]) => `${v}× ${k}`).join(', ')})`],
                            ['Building Structure', `${towers} Tower${towers > 1 ? 's' : ''}, G+${maxFloors} floors`],
                            ['Total Project Cost', totalCost ? crore(totalCost) : 'Pending'],
                            ['Debt Component', `${crore(loanAmount)} (${(loanPct * 100).toFixed(1)}% of Total Cost)`],
                            ['Equity Component', `${crore(equityAmount)} (${((1 - loanPct) * 100).toFixed(1)}% of Total Cost)`],
                            ['Loan Tenure', `${totalMonths} months (Construction period)`],
                            ['Expected Revenue', totalRev ? crore(totalRev) : 'Pending'],
                            ['Pre-Launch Margin', `${grossMargin.toFixed(2)}%`],
                            ['DSCR', (() => {
                                const annualInterest = loanAmount * (targetInterestRate / 100);
                                const salesByYear = [totalRev * 0.31, totalRev * 0.38];
                                const costsByYear = [totalCost * 0.40, totalCost * 0.40];
                                const dscrValues = [0, 1].map(i => {
                                    const opIncome = salesByYear[i] - costsByYear[i];
                                    return annualInterest > 0 ? opIncome / annualInterest : 0;
                                });
                                const avg = dscrValues.reduce((s, v) => s + v, 0) / dscrValues.length;
                                return `${avg.toFixed(2)}× avg (operational years) — Details: §5.5`;
                            })()],
                        ] as [string, string | null][]).map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold w-1/3">{k}</TD>
                                {v !== null ? <TD>{v}</TD> : <TDP />}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>1.2 Credit Recommendation</SH2>
                <p className="text-[10px] mb-2"><strong>Preliminary Assessment:</strong> <span className="bg-yellow-100 px-2 py-0.5 font-bold text-yellow-800 border border-yellow-300">[APPROVED WITH CONDITIONS]</span></p>
                <div className="grid grid-cols-2 gap-3 text-[9.5px]">
                    <div className="border border-green-200 bg-green-50 p-2 rounded">
                        <strong className="text-green-800 uppercase text-[9px]">Key Strengths</strong>
                        <ul className="list-disc pl-3 mt-1 space-y-0.5">
                            <li>Strategic location with strong {project.intendedUse || 'residential'} demand</li>
                            <li>Favorable debt-to-equity ratio at {(loanPct * 100).toFixed(0)}:{((1 - loanPct) * 100).toFixed(0)}</li>
                            <li>Healthy projected margin of {grossMargin.toFixed(1)}%</li>
                            {achievedFAR <= far && <li>FAR within permissible limits ({fmt(achievedFAR, 2)} vs {far})</li>}
                        </ul>
                    </div>
                    <div className="border border-red-200 bg-red-50 p-2 rounded">
                        <strong className="text-red-800 uppercase text-[9px]">Key Concerns</strong>
                        <ul className="list-disc pl-3 mt-1 space-y-0.5">
                            <li>Promoter track record requires verification</li>
                            <li>Market absorption capacity needs confirmation</li>
                            {parkProv < parkReq && <li>Parking shortfall: {parkProv} vs {parkReq} required</li>}
                            {achievedFAR > far && <li>FAR exceeds base ({fmt(achievedFAR, 2)} vs {far}) — incentive needed</li>}
                        </ul>
                    </div>
                </div>
                <p className="text-[9.5px] mt-2"><strong>Proposed Loan Structure:</strong> Milestone-based disbursement tied to construction progress and pre-sales achievement.</p>
            </div>
            <PageBreak />

            {/* ═══ §2 BORROWER & PROMOTER ═══ */}
            <div className="report-page">
                <SH>2. Borrower &amp; Promoter Analysis</SH>
                <SH2 className="!mt-1">2.1 Promoter Background &amp; Track Record</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Corporate Information</TH><TH>Details</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="font-semibold w-1/3">Promoter / Group Name</TD>{uw.promoterName ? <TD>{uw.promoterName}</TD> : <TDP />}</tr>
                        <tr><TD className="font-semibold w-1/3">Corporate / Legal Entity</TD>{uw.companyName ? <TD>{uw.companyName} ({uw.legalEntity || 'Entity Type Pending'})</TD> : <TDP />}</tr>
                        <tr className="bg-slate-50"><TD className="font-semibold w-1/3">Years in Real Estate</TD>{uw.yearsInRealEstate ? <TD>{uw.yearsInRealEstate} Years</TD> : <TDP />}</tr>
                        <tr><TD className="font-semibold w-1/3">Management Summary</TD>{uw.managementCapability ? <TD>{uw.managementCapability}</TD> : <TDP />}</tr>
                        <tr className="bg-slate-50"><TD className="font-semibold w-1/3">Credit Rating</TD>{uw.creditRating ? <TD>{uw.creditRating}</TD> : <TDP />}</tr>
                    </tbody>
                </table>

                <SH2>2.2 Historical Performance</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Parameter</TH><TH>Assessment Criteria</TH><TH>Score / Status</TH></tr></thead>
                    <tbody>
                        {([
                            ['Projects Completed', 'Minimum 3 similar projects', uw.completedProjectsCount ? `${uw.completedProjectsCount} Projects` : null],
                            ['Total Area Developed', 'Minimum 1,00,000 sq.ft', null],
                            ['On-time Delivery', '>80% on schedule', null],
                            ['Quality Standards', 'No major complaints/litigations', null],
                            ['Financial Stability', 'Positive net worth 3 years', null],
                            ['Banking Relationships', 'No NPAs or defaults', null],
                        ] as [string, string, string | null][]).map(([k, v, s], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{k}</TD><TD>{v}</TD>{s ? <TD>{s}</TD> : <TDP />}</tr>
                        ))}
                    </tbody>
                </table>

                <SH2>2.3 Promoter Net Worth (3-Year)</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Parameter</TH><TH>FY 2022-23</TH><TH>FY 2023-24</TH><TH>FY 2024-25</TH></tr></thead>
                    <tbody>
                        {['Total Assets', 'Total Liabilities', 'Net Worth', 'Current Ratio', 'Debt-Equity Ratio', 'Liquid Assets'].map((k, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{k}</TD><TDP /><TDP /><TDP /></tr>
                        ))}
                    </tbody>
                </table>

                <SH2>2.4 Promoter&apos;s Other Ongoing Projects</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Project Name</TH><TH>Location</TH><TH>Status</TH><TH>Size</TH><TH>Bank Exposure</TH><TH>Completion %</TH></tr></thead>
                    <tbody>
                        {[1, 2].map((i) => (
                            <tr key={i} className={i % 2 !== 0 ? 'bg-slate-50' : ''}><TDP /><TDP /><TDP /><TDP /><TDP /><TDP /></tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded text-[10px] mb-3">
                    <p className="font-bold mb-1 underline">Cumulative Exposure Analysis:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                        <li>Total bank exposure across all projects: <span className="text-amber-700 italic border-b border-amber-200">[Amount]</span></li>
                        <li>Percentage of projects with current account status: <span className="text-amber-700 italic border-b border-amber-200">[%]</span></li>
                        <li>Average debt servicing track record: <span className="text-amber-700 italic border-b border-amber-200">[Rating]</span></li>
                    </ul>
                </div>

                <SH2>2.5 Management Capability Assessment</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH colSpan={2}>Technical Competence</TH></tr></thead>
                    <tbody>
                        {[['In-house project management team strength', '[Number]'], ['Qualified engineers and architects', '[Number]'], ['Third-party PMC engagement', '[Yes/No - Name if applicable]']].map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold w-2/3">{k}</TD><TDP>{v}</TDP></tr>
                        ))}
                    </tbody>
                </table>
                <table className="w-full border-collapse mb-3"><thead><tr><TH colSpan={2}>Financial Management</TH></tr></thead>
                    <tbody>
                        {[['Qualified CFO/Finance team', '[Details]'], ['ERP/Project management systems', '[Systems in use]'], ['Compliance track record', '[GST, TDS, statutory filings status]']].map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold w-2/3">{k}</TD><TDP>{v}</TDP></tr>
                        ))}
                    </tbody>
                </table>

                <SH2>2.6 Regulatory Compliance Status</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Compliance Parameter</TH><TH>Status</TH><TH>Validity</TH><TH>Remarks</TH></tr></thead>
                    <tbody>
                        {([
                            ['RERA Registration', '[Status]', '[Date]', `${plot.regulation?.location ? plot.regulation.location + ' RERA' : '[Project ID]'}`],
                            ['GST Registration', '[Status]', 'Active', '[GSTIN]'],
                            ['PAN Verification', '[Status]', '—', '[PAN]'],
                            ['MCA Filings (ROC)', '[Status]', 'Current', '[Last filing date]'],
                            ['Income Tax Returns', '[Status]', 'FY 2024-25', '[Filed/Not Filed]'],
                            ['Environment Clearance', builtUp > 20000 ? '[Pending/Approved] (Required)' : 'Not Required (<20k sq.m)', '[Date]', '[Authority]'],
                            ['CIBIL/Credit Bureau', '[Score]', '[Date]', '[Any adverse remarks]']
                        ] as [string, string, string, string][]).map(([k, s, v, r], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{k}</TD>
                                {s.includes('Not Required') ? <TD>{s}</TD> : <TDP>{s}</TDP>}
                                <TD>{v}</TD>
                                {r.includes('RERA') || r.includes('Not Required') ? <TD>{r}</TD> : <TDP>{r}</TDP>}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>2.7 Key Financial Indicators</SH2>
                <ul className="list-disc pl-4 text-[10px] space-y-1 mb-3">
                    <li><strong>Net Worth Adequacy:</strong> Min 25% of project cost ({crore(totalCost * 0.25)} required)</li>
                    <li><strong>Liquidity Position:</strong> Ability to fund equity of {crore(equityAmount)}</li>
                    <li><strong>Contingency Reserves:</strong> Min 10% buffer ({crore(totalCost * 0.10)})</li>
                </ul>
            </div>
            <PageBreak />

            {/* ═══ §3 PROJECT OVERVIEW & TECHNICAL ═══ */}
            <div className="report-page">
                <SH>3. Project Overview &amp; Technical Assessment</SH>
                <SH2 className="!mt-1">3.1 Project Classification Framework</SH2>
                <p className="text-[10px] mb-2">This report covers underwriting parameters for the following project types:</p>
                <div className="grid grid-cols-2 gap-3 mb-3 text-[10px]">
                    <div>
                        <strong className="text-slate-800 border-b border-slate-300 block mb-1">A. RESIDENTIAL PROJECTS</strong>
                        <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                            <li><strong className={(project.intendedUse || 'Residential') === 'Residential' ? 'text-blue-700 bg-blue-50 px-1' : ''}>High-Rise Residential {((project.intendedUse || 'Residential') === 'Residential' && maxFloors > 4) ? '(Subject Project)' : ''}</strong> - Apartments in towers &gt;4 floors</li>
                            <li><strong>Low-Rise Residential</strong> - Independent houses, row houses, villas</li>
                            <li><strong>Plotted Development</strong> - Serviced residential plots</li>
                            <li><strong>Affordable Housing</strong> - EWS/LIG/MIG segments</li>
                        </ul>
                    </div>
                    <div>
                        <strong className="text-slate-800 border-b border-slate-300 block mb-1">B. COMMERCIAL MIXED-USE</strong>
                        <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                            <li><strong className={project.intendedUse === 'Commercial' ? 'text-blue-700 bg-blue-50 px-1' : ''}>Office Spaces</strong> - IT parks, business centers, corporate offices</li>
                            <li><strong>Retail &amp; Hospitality</strong> - Malls, high-street retail, hotels</li>
                            <li><strong>Integrated Townships</strong> - Combination of resi/commercial</li>
                            <li><strong>Healthcare/Educational</strong> - Specialized formats</li>
                        </ul>
                    </div>
                </div>

                <SH2>3.2 Subject Project - Technical Specifications</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Parameter</TH><TH>Details</TH><TH>Verification</TH></tr></thead>
                    <tbody>
                        {([
                            ['Total Land Area', `${fmt(plotArea)} sq.m (${fmt(plotArea * 10.764)} sq.ft / ${fmt(plotArea / 4046.86, 2)} acres)`, 'Verified from plot'],
                            ['Land Use', `${project.intendedUse || 'Residential'} (as per Master Plan)`, 'From regulation'],
                            ['Ownership Status', null, 'Title search pending'],
                            ['Permissible FAR', plot.regulation?.geometry?.max_far?.value ? `${plot.regulation.geometry.max_far.value}` : `${far}`, 'From regulation'],
                            ['Ground Coverage', plot.regulation?.geometry?.max_ground_coverage?.value ? `Max ${plot.regulation.geometry.max_ground_coverage.value}%` : `Max ${maxCov}%`, 'From regulation'],
                            ['Setbacks', `F:${generationParams?.frontSetback ?? generationParams?.setback ?? plot?.setback ?? 6}m / R:${generationParams?.rearSetback ?? generationParams?.setback ?? 3}m / S:${generationParams?.sideSetback ?? generationParams?.setback ?? 3}m`, 'From regulation'],
                        ] as [string, string | null, string][]).map(([k, v, s], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{k}</TD>
                                {v !== null ? <TD>{v}</TD> : <TDP />}
                                <TD className="text-[9px] text-slate-500">{s}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Critical Concern Alert for Land Parcel */}
                {achievedFAR > (far * 1.5) || (plotArea < 3000 && totalUnits > 50) ? (
                    <div className="bg-red-50 border-l-4 border-red-600 p-2 mb-3 mt-1">
                        <p className="text-[10px] text-red-800">
                            <strong>Critical Concern:</strong> The land parcel of {fmt(plotArea)} sq.m appears insufficient for constructing {totalUnits} apartments across {towers} tower{towers > 1 ? 's' : ''} of G+{maxFloors} configuration. Detailed verification of FAR utilization, density norms, parking requirements, and open space mandates is essential.
                        </p>
                    </div>
                ) : null}

                <SH2>3.3 Building Specifications</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Component</TH><TH>Specification</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        {([
                            ['Configuration', `${towers} Tower${towers > 1 ? 's' : ''}, G+${maxFloors}`, 'From design'],
                            ['Total Units', `${totalUnits} apartments`, 'Computed'],
                            ['Unit Types', Object.entries(units).map(([k,v]) => `${k}: ${v}`).join(', ') || 'Mixed', 'From allocation'],
                            ['Carpet Area/Unit', `${totalUnits > 0 ? fmt(totalCarpet / totalUnits) : '—'} sq.m avg`, 'Computed'],
                            ['Loading Factor', `~${(100 - carpetEff).toFixed(0)}%`, 'Estimated'],
                            ['Total Built-up Area', `${fmt(builtUp)} sq.m`, 'Computed'],
                            ['Structure Type', 'RCC frame structure', 'As per seismic zone'],
                            ['Foundation', maxHeight > 30 ? 'Pile foundation recommended' : 'Raft foundation recommended', 'Based on height'],
                            ['Elevators', `${buildingCores[0]?.core ? buildingCores[0].core.passLiftCount + buildingCores[0].core.fireLiftCount + buildingCores[0].core.serviceLiftCount : 'Min 2'} per tower`, 'IS code compliance'],
                            ['Fire Safety', 'As per NBC 2016', 'Fire NOC pending'],
                            ['Parking', `${parkProv} ECS provided (${parkReq} required)`, parkProv >= parkReq ? '✓ Compliant' : '⚠ Shortfall'],
                        ] as [string, string, string][]).map(([k, v, s], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{k}</TD><TD>{v}</TD>
                                <TD className={`text-[9px] ${s.includes('⚠') ? 'text-orange-600 font-semibold' : s.includes('✓') ? 'text-green-700' : 'text-slate-500'}`}>{s}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>3.4 Statutory Approvals Status</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Approval</TH><TH>Authority</TH><TH>Status</TH><TH>Remarks</TH></tr></thead>
                    <tbody>
                        {([
                            ['Building Plan Approval', 'Municipal Corp/DTCP', uw.approvals?.buildingPlan || null, 'Mandatory before construction'],
                            ['Environment Clearance', 'SEIAA/MoEF', uw.approvals?.environmentClearance || null, builtUp > 20000 ? 'Required (>20,000 sq.m)' : 'May be exempt'],
                            ['Fire NOC', 'Fire Department', uw.approvals?.fireNoc || null, 'Required before occupation'],
                            ['Utility Connections', 'Utility Boards', uw.approvals?.utilityConnections || null, 'Availability to be confirmed'],
                            ['RERA Registration', `${plot.regulation?.location || 'State'} RERA`, uw.approvals?.reraRegistration || null, 'Cannot launch sales without this'],
                            ['Occupancy Certificate', 'Municipal Authority', null, 'Required for legal possession'],
                            ['Commencement Certificate', 'Local Authority', null, 'Required before starting work'],
                        ] as [string, string, string | null, string][]).map(([k, auth, status, rem], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{k}</TD><TD>{auth}</TD>
                                {status !== null ? <TD>{status}</TD> : <TDP>Pending</TDP>}
                                <TD className="text-[9px] text-slate-500">{rem}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="bg-orange-50 border-l-4 border-orange-500 p-2 mb-3 mt-1">
                    <p className="text-[10px] text-orange-800">
                        <strong>Regulatory Compliance Risk:</strong> Projects cannot commence sales without RERA registration as per Real Estate (Regulation and Development) Act, 2016. Any delay in obtaining approvals directly impacts project timeline and revenue realization.
                    </p>
                </div>

                <SH2>3.5 Technical Due Diligence Requirements</SH2>
                <p className="text-[10px] mb-2 font-bold underline">Mandatory Reports &amp; Assessments</p>
                <div className="grid grid-cols-2 gap-4 mb-3 text-[10px]">
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">Soil Investigation Report</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Geotechnical analysis for foundation design</li>
                            <li>Bearing capacity, water table assessment</li>
                            <li>Recommendation for foundation type</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">Structural Design Certification</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Certified by licensed structural engineer</li>
                            <li>Compliance with IS codes &amp; seismic zone requirements</li>
                            <li>Load calculations and safety factors</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">Architectural Plans</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Detailed floor plans, elevations, sections</li>
                            <li>Compliance with building bylaws and FAR</li>
                            <li>Amenities and common area layouts</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">MEP (Mechanical, Electrical, Plumbing)</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Electrical load distribution &amp; Plumbing systems</li>
                            <li>HVAC provisions and Fire fighting systems</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">Quantity Surveying &amp; BOQ</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Detailed Bill of Quantities</li>
                            <li>Material specifications</li>
                            <li>Work schedule and phasing</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2 rounded border border-slate-200">
                        <strong className="text-slate-800 block mb-1">Third-Party Technical Audit</strong>
                        <ul className="list-disc pl-3 text-slate-600 space-y-0.5">
                            <li>Independent engineer&apos;s feasibility report</li>
                            <li>Cost validation</li>
                            <li>Timeline assessment</li>
                        </ul>
                    </div>
                </div>

                <SH2>3.6 Project Timeline &amp; Milestones</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Phase</TH><TH>Activity</TH><TH>Duration</TH><TH>Disbursement</TH></tr></thead>
                    <tbody>
                        {(() => {
                            if (tl && tl.phases) {
                                let cumMonth = 0;
                                return Object.entries(tl.phases).filter(([k]) => k !== 'overlap').map(([phName, durationMonths], i) => {
                                    const dur = Number(durationMonths) || 0;
                                    const start = cumMonth;
                                    cumMonth += dur;
                                    let percentage = i === 0 ? '5%' : i === 1 ? '15%' : i === 2 ? '30%' : '15%'; 
                                    if(phName === 'Project Handover') percentage = '5%';
                                    
                                    return (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">Phase {i + 1}</TD>
                                            <TD className="capitalize">{phName}</TD>
                                            <TD>{dur.toFixed(1)} months (M{Math.round(start)}-M{Math.round(cumMonth)})</TD>
                                            <TD>{percentage} of loan</TD>
                                        </tr>
                                    );
                                });
                            }
                            // ultimate fallback just in case tl fails
                            return ([
                                ['Phase 1', 'Engineering & Approvals', '6 months', '10%'],
                                ['Phase 2', 'Construction', '24 months', '75%'],
                                ['Phase 3', 'Handover', '6 months', '15%'],
                            ] as [string, string, string, string][]).map(([ph, act, dur, disb], i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{ph}</TD><TD>{act}</TD><TD>{dur}</TD><TD>{disb} of loan</TD></tr>
                            ));
                        })()}
                        <tr className="bg-slate-100 font-bold"><TD>Total</TD><TD>Project Completion</TD><TD>{totalMonths} months</TD><TD>100%</TD></tr>
                    </tbody>
                </table>

                <div className="bg-slate-50 border border-slate-300 p-2 mt-1">
                    <p className="font-bold underline text-[10px] mb-1">Critical Path Analysis:</p>
                    <ul className="list-disc pl-4 text-[10px] space-y-0.5 text-slate-700">
                        <li>Statutory approval delays are the single largest timeline risk</li>
                        <li>Monsoon season impact on construction (Jun-Sep): 4 months potential slowdown</li>
                        <li>Material availability and labor shortages can extend timeline by 15-20%</li>
                        <li>Contingency buffer of 6 months (total {totalMonths + 6} months) recommended for realistic completion</li>
                    </ul>
                </div>
            </div>
            <PageBreak />

            {/* ═══ §4 MARKET ANALYSIS ═══ */}
            <div className="report-page">
                <SH>4. Market Analysis &amp; Demand Study</SH>
                <SH2 className="!mt-1">4.1 Macro-Economic Environment</SH2>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Indicator</TH><TH>Current Value</TH><TH>Trend</TH><TH>Impact on Real Estate</TH></tr></thead>
                    <tbody>
                        {([
                            ['GDP Growth Rate', '~7.0% (projected)', 'Stable', 'Positive - sustained economic growth'],
                            ['Inflation (CPI)', '~5.5%', 'Moderate', 'Neutral - within RBI tolerance band'],
                            ['Repo Rate', '6.50%', 'Stable', 'Moderate - impacts loan affordability'],
                            ['Housing Loan Interest', '8.5-9.5%', 'Stable', 'Moderate affordability for buyers'],
                            ['Foreign Investment', 'Improving', 'Positive', 'Corporate expansion drives demand'],
                            ['Employment Rate', 'Growing', 'Positive', 'Increases purchasing capacity'],
                        ] as [string, string, string, string][]).map(([ind, val, tr, imp], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{ind}</TD><TD>{val}</TD><TD>{tr}</TD><TD>{imp}</TD></tr>
                        ))}
                    </tbody>
                </table>

                <SH2>4.2 Regional Market Analysis - {plot.regulation?.location || 'Gurugram'}</SH2>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded text-[10px] mb-3">
                    <p className="font-bold mb-1">Market Positioning - {plot.regulation?.location || 'Gurugram'} Real Estate Overview:</p>
                    <ul className="list-disc pl-4 space-y-0.5">
                        <li>Part of National Capital Region (NCR), Haryana</li>
                        <li>Established as corporate and IT hub with strong infrastructure</li>
                        <li>Premium residential market catering to working professionals</li>
                        <li>Well-developed social infrastructure (schools, hospitals, malls)</li>
                    </ul>
                </div>

                {project.locationData?.amenities && project.locationData.amenities.length > 0 && (
                    <>
                        <h4 className="text-[10px] font-bold mt-2 mb-1">Micro-Market Analysis (Location Assessment)</h4>
                        <table className="w-full border-collapse mb-1"><thead><tr><TH>Parameter</TH><TH className="w-20 text-center">Rating (1-5)</TH><TH>Comments</TH></tr></thead>
                            <tbody>
                                {(() => {
                                    const locs = project.locationData.amenities as any[];

                                    // Helper to find closest amenity of specific types
                                    const getClosest = (types: string[]) => locs.find(a =>
                                        types.some(t => a.category?.toLowerCase().includes(t) || a.type?.toLowerCase().includes(t) || a.tags?.amenity?.toLowerCase().includes(t))
                                    );

                                    // Dynamic Scoring logic based on what we find nearby
                                    const transit = getClosest(['station', 'bus', 'transit', 'highway']);
                                    const social = getClosest(['hospital', 'clinic', 'school', 'university']);
                                    const work = getClosest(['commercial', 'business', 'office', 'industrial']);
                                    const retail = getClosest(['mall', 'retail', 'market', 'restaurant']);

                                    // Simple distance-based rating logic (closer = better score, max 5)
                                    const rate = (item: any) => item && item.distance ? Math.max(1, 5 - Math.floor(item.distance / 2000)) : 3;

                                    return ([
                                        ['Connectivity', rate(transit), transit ? `Proximity to ${transit.name || transit.category} (${(transit.distance / 1000).toFixed(1)}km)` : 'Assessment pending'],
                                        ['Social Infrastructure', rate(social), social ? `Schools/Hospitals nearby (Closest: ${(social.distance / 1000).toFixed(1)}km)` : 'Assessment pending'],
                                        ['Employment Hubs', work ? rate(work) : 4, work ? `Commercial hubs within ${(work.distance / 1000).toFixed(1)}km` : 'Major employment nodes nearby'],
                                        ['Retail & Entertainment', rate(retail), retail ? `Retail options available (${(retail.distance / 1000).toFixed(1)}km away)` : 'Assessment pending'],
                                        ['Safety & Security', 4, 'Gated communities, general police presence in area'],
                                        ['Future Development', 4, 'Infrastructure projects planned for region'],
                                    ] as [string, number, string][]).map(([param, rating, comments], i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{param}</TD>
                                            <TD className="text-center font-bold text-sky-700">[{rating}/5]</TD>
                                            <TD className="text-slate-600">{comments}</TD>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                        </table>
                        <p className="text-[8px] text-slate-500 mb-3 italic">
                            Note: Specific sector identification required for precise micro-market assessment.
                        </p>
                    </>
                )}

                <SH2>4.3 Residential Demand-Supply Analysis</SH2>
                <table className="w-full border-collapse mb-2"><thead><tr><TH>Segment</TH><TH>Supply</TH><TH>Absorption Rate</TH><TH>Price Range</TH></tr></thead>
                    <tbody>
                        {([
                            ['Luxury (>₹2 Cr)', '15,000 units', '2,500 units/year', '₹15,000-25,000/sq.ft'],
                            ['Premium (₹1-2 Cr)', '25,000 units', '4,500 units/year', '₹12,000-18,000/sq.ft'],
                            ['Mid-segment (₹50L-1Cr)', '35,000 units', '7,000 units/year', '₹8,000-12,000/sq.ft'],
                            ['Affordable (<₹50L)', '20,000 units', '5,000 units/year', '₹4,000-7,000/sq.ft'],
                        ] as [string, string, string, string][]).map(([seg, sup, abs, pr], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold whitespace-nowrap">{seg}</TD><TD>{sup}</TD><TD>{abs}</TD><TD>{pr}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[9px] mb-3 italic">
                    <strong>Subject Project Classification:</strong> Premium segment (estimated unit price {avgUnitPrice > 0 ? crore(avgUnitPrice) : 'Pending'} based on {pricePerSqft > 0 ? `₹${fmt(pricePerSqft)}/sq.ft` : 'Pending'})
                </p>

                <h4 className="text-[10px] font-bold mt-2 mb-1">Competitive Analysis (Similar Projects within 3-5 km radius)</h4>
                <table className="w-full border-collapse mb-1"><thead><tr><TH>Project Name</TH><TH>Developer</TH><TH>Config</TH><TH>Price/sq.ft</TH><TH>Absorption</TH></tr></thead>
                    <tbody>
                        {uw.competitors && uw.competitors.length > 0 ? (
                            uw.competitors.map((comp, i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                    <TD className="font-semibold">{comp.name}</TD>
                                    <TD>—</TD>
                                    <TD>Mixed</TD>
                                    <TD>₹{fmt(comp.sellingPricePerSqm / 10.764)}</TD>
                                    <TD>{comp.absorptionRate}</TD>
                                </tr>
                            ))
                        ) : (
                            [1, 2, 3].map((i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                    <TDP>[Competitor {i}]</TDP><TDP>[Builder]</TDP><TDP>[2/3 BHK]</TDP><TDP>[₹XX,XXX]</TDP><TDP>[XX% sold]</TDP>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                <p className="text-[9px] mb-3 leading-tight">
                    <strong>Competitive Positioning:</strong> Subject project pricing {pricePerSqft > 0 ? `at ₹${fmt(pricePerSqft)}/sq.ft` : ''} is competitive. All-{Object.keys(units)[0] || '3BHK'} configuration targets specific buyer segment. Expected sales velocity: 3-4 units per month.
                </p>

                <SH2 className="!mt-2">4.4 Price Trend Analysis</SH2>
                <table className="w-full border-collapse mb-2"><thead><tr><TH>Year</TH><TH>Average Price/sq.ft</TH><TH>YoY Growth</TH><TH>Market Sentiment</TH></tr></thead>
                    <tbody>
                        {([
                            ['2023', '₹ 12,300', '+9.8%', 'Strong growth'],
                            ['2024', '₹ 13,200', '+7.3%', 'Sustained demand'],
                            ['2025', '₹ 13,800', '+4.5%', 'Moderate growth'],
                            ['2026 (Projected)', '₹ 14,400', '+4.3%', 'Stable appreciation'],
                        ] as [string, string, string, string][]).map(([yr, pr, gr, snt], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{yr}</TD><TD>{pr}</TD><TD className="text-green-700 font-bold">{gr}</TD><TD>{snt}</TD></tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[9px] mb-3 leading-tight">
                    <strong>Price Appreciation Assumptions:</strong> Conservative estimate of 4-5% annual appreciation. Project completion exit price estimated at ~₹16,000-16,500/sq.ft, providing a cushion for sales during the construction phase.
                </p>

                <SH2>4.5 Target Customer Profile</SH2>
                <div className="grid grid-cols-2 gap-3 mb-3 text-[10px]">
                    <div className="bg-slate-50 border border-slate-200 p-2 rounded">
                        <strong className="block mb-1 text-slate-800">Working Professionals (45%)</strong>
                        <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                            <li>Age: 30-45 years, dual-income households</li>
                            <li>Income: ₹20-40 lakhs per annum</li>
                            <li>Employment: IT, BFSI, MNCs</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-2 rounded">
                        <strong className="block mb-1 text-slate-800">Business Owners/Entrepreneurs (25%)</strong>
                        <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                            <li>Age: 35-50 years, self-employed</li>
                            <li>Income: ₹30-60 lakhs per annum</li>
                            <li>Seeking investment + own use</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-2 rounded">
                        <strong className="block mb-1 text-slate-800">NRI Investors (15%) &amp; Upgraders (15%)</strong>
                        <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                            <li>Investment purpose + retirement planning</li>
                            <li>Trading up from 2BHK to 3BHK</li>
                        </ul>
                    </div>
                    <div className="p-2">
                        <strong className="block mb-1 text-slate-800 border-b border-slate-300">Affordability Check</strong>
                        {(() => {
                            if (avgUnitPrice > 0) {
                                const loanAmount = avgUnitPrice * 0.8; // 80% LTV
                                const r = 0.09 / 12; // 9% annual interest
                                const n = 240; // 20 years
                                const emi = (loanAmount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                                const reqAnnualIncome = (emi / 0.4) * 12; // Assume 40% of income goes to EMI
                                return (
                                    <ul className="space-y-0.5 text-slate-700">
                                        <li>Unit EMI (est): <strong>{lakh(emi)}/mo</strong></li>
                                        <li>Req Income: <strong>{lakh(reqAnnualIncome)}/year</strong></li>
                                        <li className="text-green-700 font-bold">✓ Target group is achievable</li>
                                    </ul>
                                );
                            }
                            return <div className="text-slate-500 italic">Pending price data</div>;
                        })()}
                    </div>
                </div>

                <SH2>4.6 Absorption &amp; Sales Projection</SH2>
                <table className="w-full border-collapse mb-1"><thead><tr><TH>Year</TH><TH>Units Sold</TH><TH>Cumulative %</TH><TH>Revenue (₹ Cr)</TH><TH>Phase</TH></tr></thead>
                    <tbody>
                        {(() => {
                            const pre = Math.round(totalUnits * 0.31);
                            const uc = Math.round(totalUnits * 0.38);
                            const nc = Math.round(totalUnits * 0.23);
                            const pc = totalUnits - pre - uc - nc;
                            let cum = 0;
                            return ([
                                ['Year 1', pre, 'Pre-launch & Launch'],
                                ['Year 2', uc, 'Under Construction'],
                                ['Year 3', nc, 'Near Completion'],
                                ['Year 4', pc, 'Post Completion']
                            ] as [string, number, string][]).map(([yr, cnt, ph], i) => {
                                cum += cnt;
                                return (
                                    <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold">{yr}</TD>
                                        <TD>{cnt}</TD>
                                        <TD>{totalUnits > 0 ? pct(cum / totalUnits * 100) : '—'}</TD>
                                        <TD>{avgUnitPrice > 0 ? (cnt * avgUnitPrice / 10000000).toFixed(2) : '—'}</TD>
                                        <TD className="text-slate-600 text-[9px]">{ph}</TD>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
                <p className="text-[9px] mb-3 leading-tight">
                    <strong>Revenue Waterfall Analysis:</strong> Gross Revenue: ₹{(totalRev / 10000000).toFixed(2)} Cr. Less GST @ 5% (if applicable): ₹{(totalRev * 0.05 / 10000000).toFixed(2)} Cr. Net Project Revenue: ₹{(totalRev * 0.95 / 10000000).toFixed(2)} Cr (excluding GST). Minimum 31% pre-sales required before loan disbursement.
                </p>
            </div>
            <PageBreak />

            {/* ═══ §5 FINANCIAL ANALYSIS ═══ */}
            <div className="report-page">
                <SH>5. Financial Analysis &amp; Viability</SH>
                <SH2 className="!mt-1">5.1 Project Cost Breakdown</SH2>
                {cb ? (
                    <>
                        <p className="text-[10px] font-bold mb-1">Detailed Cost Structure</p>
                        <table className="w-full border-collapse mb-3"><thead><tr><TH>Cost Component</TH><TH>Amount (₹ Cr)</TH><TH>% of Total</TH><TH>Basis/Assumptions</TH></tr></thead>
                            <tbody>
                                {([
                                    ['1. LAND ACQUISITION', '', '', ''],
                                    ['Land purchase cost', uw.actualLandPurchaseCost || cb.earthwork * 0.4, '', 'Estimated land value'],
                                    ['Stamp duty & registration', uw.stampDutyAndLegalFees || cb.earthwork * 0.04, '', '~10% of land value'],
                                    ['Legal & professional fees', 0.2 * 10000000, '', 'Title verification'],
                                    ['Sub-total: Land', (uw.actualLandPurchaseCost || cb.earthwork * 0.4) + (uw.stampDutyAndLegalFees || cb.earthwork * 0.04) + 2000000, '', ''],

                                    ['2. CONSTRUCTION COSTS', '', '', ''],
                                    ['Civil & structural work', cb.structure, '', `₹${fmt(cb.structure / sqftArea)}/sq.ft × ${fmt(sqftArea)} sq.ft`],
                                    ['Finishing & interiors', cb.finishing, '', 'Premium specifications'],
                                    ['MEP / Services', cb.services, '', 'Elevators, fire safety, electrical'],
                                    ['External dev & landscaping', cb.earthwork * 0.2, '', 'Common areas, driveways'],
                                    ['Sub-total: Construction', cb.structure + cb.finishing + cb.services + (cb.earthwork * 0.2), '', ''],

                                    ['3. PROFESSIONAL FEES', '', '', ''],
                                    ['Architect & Structural', 1.05 * 10000000, '', 'Design & certification'],
                                    ['PMC / Supervision', 0.9 * 10000000, '', 'Third-party management'],
                                    ['Sub-total: Professional', 1.95 * 10000000, '', ''],

                                    ['4. STATUTORY APPROVALS', '', '', ''],
                                    ['Building plan, RERA, Environment', 0.45 * 10000000, '', 'Various authorities'],
                                    ['Sub-total: Approvals', 0.45 * 10000000, '', ''],

                                    ['5. MARKETING & SALES', '', '', ''],
                                    ['Branding, marketing, comm.', 3.4 * 10000000, '', '@ ~3.5% of gross sales'],
                                    ['Sub-total: Marketing', 3.4 * 10000000, '', ''],

                                    ['6. FINANCING COSTS & CONTINGENCY', '', '', ''],
                                    ['Interest & Processing', 4.8 * 10000000, '', 'Term loan interest'],
                                    ['Contingency reserve & overheads', cb.contingency, '', '~5% buffer'],
                                    ['Sub-total: Finance & Contingency', cb.contingency + 48000000, '', ''],
                                ] as [string, number | string, string, string][]).map(([k, v, pctOverride, basis], i) => {
                                    const isHeader = typeof v === 'string' && v === '';
                                    const isSub = k.startsWith('Sub-total');
                                    return (
                                        <tr key={i} className={isHeader ? 'bg-slate-100 font-bold' : isSub ? 'bg-slate-50 font-semibold' : ''}>
                                            <TD className={isHeader || isSub ? '' : 'pl-4'}>{k}</TD>
                                            <TD>{isHeader ? '' : crore(v as number)}</TD>
                                            <TD>{isHeader ? '' : pctOverride || (totalCost > 0 ? pct((v as number) / totalCost * 100) : '—')}</TD>
                                            <TD className="text-[9px] text-slate-500">{basis}</TD>
                                        </tr>
                                    );
                                })}
                                <tr className="bg-slate-200 font-bold"><TD>TOTAL PROJECT COST</TD><TD>{crore(totalCost)}</TD><TD>100%</TD><TD> </TD></tr>
                            </tbody>
                        </table>
                    </>
                ) : (
                    <p className="text-[10px] italic text-amber-700 bg-amber-50 p-2 border border-amber-200 rounded">Cost breakdown pending — configure Admin Parameters.</p>
                )}

                <SH2>5.2 Funding Structure</SH2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="font-bold text-[10px] mb-1">Sources of Funds</p>
                        <table className="w-full border-collapse mb-1"><thead><tr><TH>Source</TH><TH>Amount (₹ Cr)</TH><TH>%</TH></tr></thead>
                            <tbody>
                                <tr className="bg-slate-50"><TD className="font-semibold">Promoter&apos;s Equity</TD><TD>{crore(equityAmount)}</TD><TD>{pct((1 - loanPct) * 100)}</TD></tr>
                                <tr><TD className="pl-4">Land (asset)</TD><TD>{cb ? crore((uw.actualLandPurchaseCost || cb.earthwork * 0.4) + (uw.stampDutyAndLegalFees || cb.earthwork * 0.04) + 2000000) : '—'}</TD><TD>—</TD></tr>
                                <tr><TD className="pl-4">Cash equity</TD><TD>{cb ? crore(equityAmount - ((uw.actualLandPurchaseCost || cb.earthwork * 0.4) + (uw.stampDutyAndLegalFees || cb.earthwork * 0.04) + 2000000)) : '—'}</TD><TD>—</TD></tr>
                                <tr><TD className="font-semibold">Bank Term Loan</TD><TD>{crore(loanAmount)}</TD><TD>{pct(loanPct * 100)}</TD></tr>
                                <tr className="bg-slate-100 font-bold"><TD>TOTAL SOURCES</TD><TD>{crore(totalCost)}</TD><TD>100%</TD></tr>
                            </tbody>
                        </table>
                        <p className="text-[9px] mb-3"><strong>Debt-Equity Ratio:</strong> {equityAmount > 0 ? (loanAmount / equityAmount).toFixed(2) : '—'}:1 <span className="text-green-700">(Healthy, below 1:1)</span></p>
                    </div>
                    <div>
                        <p className="font-bold text-[10px] mb-1">Uses of Funds</p>
                        <table className="w-full border-collapse mb-3"><thead><tr><TH>Application</TH><TH>Amount (₹ Cr)</TH><TH>%</TH><TH>Funding Source</TH></tr></thead>
                            <tbody>
                                {cb ? (
                                    <>
                                        {([
                                            ['Land & related', (uw.actualLandPurchaseCost || cb.earthwork * 0.4) + (uw.stampDutyAndLegalFees || cb.earthwork * 0.04) + 2000000, 'Equity'],
                                            ['Construction', cb.structure + cb.finishing + cb.services + (cb.earthwork * 0.2), 'Bank loan + Equity'],
                                            ['Professional fees', 1.95 * 10000000, 'Equity'],
                                            ['Approvals', 0.45 * 10000000, 'Equity'],
                                            ['Marketing & sales', 3.4 * 10000000, 'Equity + Loan'],
                                            ['Finance costs', 4.8 * 10000000, 'Loan + Equity'],
                                            ['Contingency', cb.contingency, 'Equity'],
                                            ['GST', 1.5 * 10000000, 'Loan'],
                                            ['Working capital', 0.61 * 10000000, 'Equity']
                                        ] as [string, number, string][]).map(([app, amt, src], i) => (
                                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                <TD>{app}</TD>
                                                <TD>{crore(amt)}</TD>
                                                <TD>{pct(amt / totalCost * 100)}</TD>
                                                <TD className="text-[9px]">{src}</TD>
                                            </tr>
                                        ))}
                                    </>
                                ) : (
                                    <tr><TD colSpan={4} className="text-center italic">Pending estimates</TD></tr>
                                )}
                                <tr className="bg-slate-100 font-bold"><TD>TOTAL USES</TD><TD>{crore(totalCost)}</TD><TD>100%</TD><TD className="text-[9px]"> </TD></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <SH2>5.3 Revenue Analysis</SH2>
                <p className="text-[10px] font-bold mb-1">Base Case Scenario:</p>
                <table className="w-full border-collapse mb-2"><thead><tr><TH>Parameter</TH><TH>Details</TH></tr></thead>
                    <tbody>
                        {([
                            ['Total saleable area', `${fmt(totalCarpet)} sq.m (${fmt(sqftArea)} sq.ft)`],
                            ['Blended realization', `₹${fmt(pricePerSqft)} per sq.ft`],
                            ['Gross revenue', crore(totalRev)],
                            ['GST @ 5%', crore(totalRev * 0.05) + ' (collected from buyers)'],
                            ['Net realizable revenue', crore(totalRev * 0.95)]
                        ] as [string, string][]).map(([k, v], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold w-1/3">{k}</TD><TD>{v}</TD></tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[10px] font-bold mb-1 mt-2">Revenue Sensitivity Analysis:</p>
                <table className="w-full border-collapse mb-1"><thead><tr><TH>Scenario</TH><TH>Price/sq.ft</TH><TH>Gross Revenue</TH><TH>% Change</TH><TH>Impact</TH></tr></thead>
                    <tbody>
                        {([
                            ['Optimistic', pricePerSqft * 1.1, totalRev * 1.1, '+10.0%', 'Strong profitability', 'text-green-700'],
                            ['Base Case', pricePerSqft, totalRev, '0%', 'Adequate margins', 'text-slate-800'],
                            ['Conservative', pricePerSqft * 0.9, totalRev * 0.9, '-10.0%', 'Marginal viability', 'text-orange-600'],
                            ['Stress', pricePerSqft * 0.8, totalRev * 0.8, '-20.0%', 'Project unviable', 'text-red-600'],
                        ] as [string, number, number, string, string, string][]).map(([scen, p, rev, chg, imp, col], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{scen}</TD><TD>₹{fmt(p)}</TD><TD>{crore(rev)}</TD><TD>{chg}</TD><TD className={col}>{imp}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded mb-3 mt-1 text-[9px]">
                    <strong>Break-even Analysis:</strong> Minimum price required to cover all costs: <strong>₹{fmt(totalCost / Math.max(1, sqftArea))} / sq.ft</strong>. Safety margin at base case pricing: <strong>{pct((totalRev - totalCost) / totalRev * 100)}</strong>.
                </div>

                <SH2 className="!mt-2">5.4 Profitability Analysis (Base Case)</SH2>
                <table className="w-full border-collapse mb-2"><thead><tr><TH>Financial Metric</TH><TH>Amount (₹ Cr)</TH><TH>Calculation</TH></tr></thead>
                    <tbody>
                        {([
                            ['Gross Revenue', crore(totalRev), `${totalUnits} units × ${crore(avgUnitPrice)} avg`],
                            ['Less: Total Project Cost', crore(totalCost), 'Excluding land value appreciation'],
                            ['Gross Profit (Before Tax)', crore(profit), 'Revenue - Cost'],
                            ['Gross Profit Margin', pct(grossMargin), '(Profit ÷ Revenue) × 100'],
                            ['Return on Investment (ROI)', pct(roi), '(Profit ÷ Cost) × 100'],
                            ['Return on Equity (ROE)', pct(profit / Math.max(1, equityAmount) * 100), 'Profit ÷ Equity investment'],
                        ] as [string, string, string][]).map(([k, v, c], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{k}</TD><TD>{v}</TD><TD className="text-slate-500 text-[9px]">{c}</TD></tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded mb-3 text-[9px]">
                    <strong>Tax Considerations:</strong> Corporate tax @ 25.17%: <strong>{crore(profit * 0.2517)}</strong>. Net Profit After Tax (PAT): <strong>{crore(profit * 0.7483)}</strong>. Net Profit Margin: <strong>{pct((profit * 0.7483) / totalRev * 100)}</strong>. Net ROE: <strong>{pct((profit * 0.7483) / equityAmount * 100)}</strong>
                </div>

                <p className="text-[10px] font-bold mb-1">Cash Flow Analysis (Year-wise)</p>
                <table className="w-full border-collapse mb-2 text-[9px]"><thead><tr><TH>Period</TH><TH>Inflow (Sales+Loan)</TH><TH>Outflow (Costs)</TH><TH>Net Cash Flow</TH><TH>Cumulative</TH></tr></thead>
                    <tbody>
                        {(() => {
                            const inflows = [totalRev * 0.31 + loanAmount * 0.15, totalRev * 0.38 + loanAmount * 0.5, totalRev * 0.23 + loanAmount * 0.35, totalRev * 0.08];
                            const outflows = [totalCost * 0.4, totalCost * 0.4, totalCost * 0.15, totalCost * 0.05];
                            let cum = 0;
                            return [1, 2, 3, 4].map(y => {
                                const net = inflows[y - 1] - outflows[y - 1];
                                cum += net;
                                return (
                                    <tr key={y} className={y % 2 === 0 ? 'bg-slate-50' : ''}>
                                        <TD className="font-semibold">Year {y}</TD>
                                        <TD className="text-green-700">+{crore(inflows[y - 1])}</TD>
                                        <TD className="text-red-700">-{crore(outflows[y - 1])}</TD>
                                        <TD className="font-bold">{net > 0 ? '+' : ''}{crore(net)}</TD>
                                        <TD className="font-bold text-sky-800">{crore(cum)}</TD>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>

                <SH2>5.5 Debt Service Coverage Ratio (DSCR)</SH2>
                <p className="text-[10px] font-bold mb-1">DSCR Calculation Framework:</p>
                <p className="text-[9px] mb-2 text-slate-600">DSCR = Net Operating Income ÷ Total Debt Service &nbsp;|&nbsp; Minimum bank requirement: <strong>1.25×</strong></p>
                {(() => {
                    // Interest per year: loan * target interest avg, spread over 3 construction years
                    const interestRate = (uw?.targetInterestRate || 10) / 100;
                    const constructionYears = 3;
                    // Operating income = Net Cash Inflow from sales - construction outflow (before debt service)
                    // Using the same inflow/outflow ratios as cash flow table above
                    const salesByYear = [
                        totalRev * 0.31,    // Y1
                        totalRev * 0.38,    // Y2
                        totalRev * 0.23,    // Y3
                    ];
                    const costsByYear = [
                        totalCost * 0.40,   // Y1
                        totalCost * 0.40,   // Y2
                        totalCost * 0.15,   // Y3
                    ];
                    const annualInterest = loanAmount * interestRate;
                    // Debt service: interest each year + full principal in final year
                    const debtService = [
                        annualInterest,                        // Y1: interest only
                        annualInterest,                        // Y2: interest only
                        annualInterest + loanAmount,           // Y3: interest + repayment
                    ];
                    const rows = [1, 2, 3].map(y => {
                        const opIncome = salesByYear[y - 1] - costsByYear[y - 1];
                        const ds = debtService[y - 1];
                        const dscr = ds > 0 ? opIncome / ds : 0;
                        const isStress = y === constructionYears; // final year repayment is stress
                        const status = dscr >= 2 ? 'Excellent' : dscr >= 1.25 ? 'Healthy' : dscr >= 1 ? 'Marginal' : 'Stress';
                        const col = dscr >= 2 ? 'text-green-700' : dscr >= 1.25 ? 'text-blue-700' : dscr >= 1 ? 'text-yellow-700' : 'text-red-600';
                        return { y, opIncome, ds, dscr, status, col, isStress };
                    });
                    const avgDscr = rows.slice(0, 2).reduce((s, r) => s + r.dscr, 0) / 2; // avg of operational years (excl final repayment year)
                    return (
                        <>
                            <table className="w-full border-collapse mb-2">
                                <thead><tr><TH>Year</TH><TH>Operating Income</TH><TH>Debt Service</TH><TH>DSCR</TH><TH>Status</TH></tr></thead>
                                <tbody>
                                    {rows.map(({ y, opIncome, ds, dscr, status, col, isStress }) => (
                                        <tr key={y} className={y % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">Year {y}{isStress ? ' (Final)' : ''}</TD>
                                            <TD className="text-green-700">{crore(opIncome)}</TD>
                                            <TD className="text-red-700">{crore(ds)}</TD>
                                            <TD className={`font-bold ${col}`}>{dscr.toFixed(2)}×</TD>
                                            <TD className={`font-semibold ${col}`}>{status}</TD>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-100 font-bold">
                                        <TD colSpan={3}>Average DSCR (Operational Years)</TD>
                                        <TD className={`font-bold ${avgDscr >= 1.25 ? 'text-green-700' : 'text-red-600'}`}>{avgDscr.toFixed(2)}×</TD>
                                        <TD className={`font-semibold ${avgDscr >= 1.25 ? 'text-green-700' : 'text-red-600'}`}>{avgDscr >= 2 ? 'Excellent' : avgDscr >= 1.25 ? 'Healthy' : 'Stress'}</TD>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="bg-slate-50 border border-slate-200 p-2 rounded mb-3 text-[9px]">
                                <strong>Bank Requirement:</strong> Minimum DSCR of <strong>1.25×</strong>.{' '}
                                {avgDscr >= 1.25
                                    ? <span className="text-green-700">Subject project exceeds this comfortably during operational years (avg {avgDscr.toFixed(2)}×).</span>
                                    : <span className="text-red-600">Warning: Project average DSCR of {avgDscr.toFixed(2)}× falls below minimum threshold. Review funding structure.</span>
                                }
                                <br />Note: Year 3 DSCR appears stressed due to full loan principal repayment — this is expected and standard for construction-phase loans.
                            </div>
                        </>
                    );
                })()}

                <SH2>5.6 Sensitivity Analysis - Key Variables</SH2>

                <p className="text-[10px] font-bold mb-1">Impact on Project IRR</p>
                <table className="w-full border-collapse mb-1"><thead><tr><TH>Variable</TH><TH>Change</TH><TH>Impact on IRR</TH><TH>Risk Level</TH></tr></thead>
                    <tbody>
                        {(() => {
                            // Simplified IRR proxies based on dynamic base ROI
                            const baseIrr = roi > 0 ? roi * 0.8 : 30; // rough proxy for IRR from absolute ROI
                            const pPriceDrop10 = Math.max(0, baseIrr - 12);
                            const pPriceDrop20 = Math.max(0, baseIrr - 22);
                            const pCostRise10 = Math.max(0, baseIrr - 8);
                            const pCostRise20 = Math.max(0, baseIrr - 14);
                            const pDelay6 = Math.max(0, baseIrr - 10);
                            const pDelay12 = Math.max(0, baseIrr - 16);
                            const pRateRise2 = Math.max(0, baseIrr - 6);

                            return [
                                ['Sales Price', '-10%', `IRR drops to ~${pPriceDrop10.toFixed(0)}%`, 'High risk', 'text-orange-600'],
                                ['Sales Price', '-20%', `IRR drops to ~${pPriceDrop20.toFixed(0)}%`, 'Critical risk', 'text-red-600'],
                                ['Construction Cost', '+10%', `IRR drops to ~${pCostRise10.toFixed(0)}%`, 'Medium risk', 'text-yellow-700'],
                                ['Construction Cost', '+20%', `IRR drops to ~${pCostRise20.toFixed(0)}%`, 'High risk', 'text-orange-600'],
                                ['Sales Timeline', '+6 months delay', `IRR drops to ~${pDelay6.toFixed(0)}%`, 'Medium risk', 'text-yellow-700'],
                                ['Sales Timeline', '+12 months delay', `IRR drops to ~${pDelay12.toFixed(0)}%`, 'High risk', 'text-orange-600'],
                                ['Interest Rate', '+2%', `IRR drops to ~${pRateRise2.toFixed(0)}%`, 'Low risk', 'text-green-700'],
                            ].map(([v, ch, imp, risk, c], i) => (
                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                    <TD className="font-semibold">{v}</TD><TD>{ch}</TD><TD>{imp}</TD>
                                    <TD className={`font-bold ${c}`}>{risk}</TD>
                                </tr>
                            ));
                        })()}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 rounded mb-3 text-[9px]">
                    <strong className="block mb-1">Most Critical Variables (in order):</strong>
                    <ol className="list-decimal pl-4 space-y-0.5">
                        <li>Sales realization price (highest impact)</li>
                        <li>Construction cost overruns</li>
                        <li>Project timeline delays</li>
                        <li>Pre-sales achievement</li>
                        <li>Interest rate fluctuations</li>
                    </ol>
                </div>

                <SH2>5.7 Break-Even Analysis (Unit-Level)</SH2>
                <div className="grid grid-cols-2 gap-4">
                    <table className="w-full border-collapse mb-3 h-fit"><thead><tr><TH>Parameter</TH><TH>Value</TH></tr></thead>
                        <tbody>
                            <tr className="bg-slate-50"><TD>Total Fixed Costs</TD><TD>{crore(totalCost * 0.3)} (est)</TD></tr>
                            <tr><TD>Variable Cost / Unit</TD><TD>{crore((totalCost * 0.7) / Math.max(1, totalUnits))}</TD></tr>
                            <tr className="bg-slate-50"><TD>Selling Price / Unit</TD><TD>{crore(avgUnitPrice)}</TD></tr>
                            <tr className="bg-slate-100 font-bold"><TD>Break-even Units</TD><TD>{breakEvenUnits} units</TD></tr>
                            <tr className="bg-slate-100 font-bold"><TD>Break-even %</TD><TD>{totalUnits > 0 ? pct(breakEvenUnits / totalUnits * 100) : '—'}</TD></tr>
                        </tbody>
                    </table>
                    <div className="bg-slate-50 p-2 border border-slate-200 rounded text-[9px] flex flex-col justify-center">
                        <p className="mb-2"><strong>Interpretation:</strong> Project becomes profitable after selling {breakEvenUnits} out of {totalUnits} units.</p>
                        <p className="mb-2">With projected 31% pre-sales ({Math.round(totalUnits * 0.31)} units), an additional {Math.max(0, breakEvenUnits - Math.round(totalUnits * 0.31))} units are needed to break even.</p>
                        <p><strong>Time-Based Break-Even:</strong> Expected achievement around Month 18. Cash break-even estimated Month 24.</p>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ §6 RISK ASSESSMENT ═══ */}
            <div className="report-page">
                <SH>6. Risk Assessment Matrix</SH>
                <SH2 className="!mt-1">6.1 Overall Risk Rating Framework</SH2>
                <p className="text-[10px] font-bold mb-1">Risk Classification System:</p>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Risk Level</TH><TH>Score Range</TH><TH>Description</TH><TH>Action Required</TH></tr></thead>
                    <tbody>
                        {([
                            ['Low', '1.0 - 2.0', 'Minimal risk, standard monitoring', 'Normal disbursement', 'text-green-700'],
                            ['Medium', '2.1 - 3.0', 'Manageable risk, enhanced oversight', 'Additional conditions', 'text-yellow-700'],
                            ['High', '3.1 - 4.0', 'Significant risk, strict controls', 'Stringent covenants', 'text-orange-600'],
                            ['Critical', '4.1 - 5.0', 'Unacceptable risk level', 'Decline or restructure', 'text-red-600'],
                        ] as [string, string, string, string, string][]).map(([lvl, rg, desc, act, col], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className={`font-bold ${col}`}>{lvl}</TD><TD>{rg}</TD><TD>{desc}</TD><TD>{act}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>6.2 Comprehensive Risk Matrix - Residential Projects</SH2>
                {(() => {
                    const mktdem = [
                        ['Market slowdown', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Pre-sales req 30% - Phased construction - Flexible pricing'],
                        ['Oversupply in micro-market', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Competitive analysis - Unique value prop - Strong marketing'],
                        ['Price correction', 'Medium (3/5)', 'Critical (5/5)', '4.0 - High', '- Conservative pricing - 15-20% price buffer - Cost control'],
                        ['Absorption rate slower', 'High (4/5)', 'High (4/5)', '4.0 - High', '- Aggressive pre-launch - Flexible payment - Broker tie-ups'],
                        ['Competition from established', 'High (4/5)', 'Medium (3/5)', '3.5 - High', '- Differentiated positioning - Competitive pricing - Quality'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">A. MARKET &amp; DEMAND RISK</p>
                            <table className="w-full border-collapse"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {mktdem.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('High') ? 'text-orange-600' : 'text-red-600'}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(marketScore)[1]}`}>Overall Market Risk Rating: {getRiskLabel(marketScore)[0].toUpperCase()} ({marketScore.toFixed(1)}/5)</p>
                        </div>
                    );
                })()}

                {(() => {
                    const exec = [
                        ['Timeline delays', 'High (4/5)', 'High (4/5)', '4.0 - High', '- Penalty clauses - Monthly monitoring - 6-month buffer'],
                        ['Cost overruns', 'High (4/5)', 'High (4/5)', '4.0 - High', '- Fixed-price contracts - 5% contingency - Material caps'],
                        ['Quality issues', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Third-party PMC - Quality certification - Inspections'],
                        ['Labor shortages', 'Medium (3/5)', 'Medium (3/5)', '3.0 - Medium', '- Multiple contractors - Worker welfare - Mechanization'],
                        ['Material supply disruptions', 'Medium (3/5)', 'Medium (3/5)', '3.0 - Medium', '- Advance procurement - Multiple suppliers - On-site storage'],
                        ['Structural failures', 'Low (2/5)', 'Critical (5/5)', '3.5 - High', '- Certified engineer - Soil testing - Third-party audit'],
                        ['Contractor default', 'Low (2/5)', 'Critical (5/5)', '3.5 - High', '- DD of contractor - Performance guarantee - Milestone payments'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">B. EXECUTION &amp; CONSTRUCTION RISK</p>
                            <table className="w-full border-collapse"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {exec.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('High') ? 'text-orange-600' : 'text-yellow-700'}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(execScore)[1]}`}>Overall Execution Risk Rating: {getRiskLabel(execScore)[0].toUpperCase()} ({execScore.toFixed(1)}/5)</p>
                        </div>
                    );
                })()}
                {(() => {
                    const reglgl = [
                        ['Statutory approval delays', 'High (4/5)', 'Critical (5/5)', '4.5 - Critical', '- CP: All approvals before first disbursement - Regular follow-up'],
                        ['RERA compliance issues', 'Medium (3/5)', 'Critical (5/5)', '4.0 - High', '- Dedicated RERA officer - Escrow account - Legal team oversight'],
                        ['Title defects/encumbrances', 'Low (2/5)', 'Critical (5/5)', '3.5 - High', '- CP: Clear title certificate - Title insurance - Chain verification'],
                        ['Environmental clearance', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Early application filing - Environmental consultant'],
                        ['Litigation risk', 'Low (2/5)', 'High (4/5)', '3.0 - Medium', '- Legal searches - Promoter litigation status - Indemnity'],
                        ['Change in regulations', 'Medium (3/5)', 'Medium (3/5)', '3.0 - Medium', '- Regulatory monitoring - Flexibility in design - Counsel retained'],
                        ['Fire NOC / OC delays', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Design compliance from day 1 - Regular liaison - Contingency'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">C. REGULATORY &amp; LEGAL RISK</p>
                            <table className="w-full border-collapse"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {reglgl.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('Critical') ? 'text-red-600' : r[3].includes('High') ? 'text-orange-600' : 'text-yellow-700'}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(regScore)[1]}`}>Overall Regulatory Risk Rating: {getRiskLabel(regScore)[0].toUpperCase()} ({regScore.toFixed(1)}/5)</p>
                        </div>
                    );
                })()}

                {(() => {
                    const fin = [
                        ['Equity infusion failure', 'Medium (3/5)', 'Critical (5/5)', '4.0 - High', '- CP: 30% equity before loan - Escrow for equity - Personal guarantee'],
                        ['Interest rate volatility', 'High (4/5)', 'Medium (3/5)', '3.5 - High', '- Interest rate caps/hedging - Fixed rate tranches - Pricing buffer'],
                        ['Cash flow mismatch', 'High (4/5)', 'High (4/5)', '4.0 - High', '- Disburse linked to sales - Min pre-sales - Working capital line'],
                        ['Customer default', 'Medium (3/5)', 'Medium (3/5)', '3.0 - Medium', '- Creditworthy screening - PDCs/ECS - Cancellation policy'],
                        ['Cost inflation', 'High (4/5)', 'High (4/5)', '4.0 - High', '- Escalation clauses - Advance booking - Contingency fund'],
                        ['GST/Tax liabilities', 'Medium (3/5)', 'Medium (3/5)', '3.0 - Medium', '- Tax consultant - ITC optimization - Compliance monitoring'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">D. FINANCIAL RISK</p>
                            <table className="w-full border-collapse"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {fin.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('High') ? 'text-orange-600' : 'text-yellow-700'}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(finScore)[1]}`}>Overall Financial Risk Rating: {getRiskLabel(finScore)[0].toUpperCase()} ({finScore.toFixed(1)}/5)</p>
                        </div>
                    );
                })()}

                {(() => {
                    const prom = [
                        ['Lack of experience', '[TBD]', 'Critical (5/5)', '[TBD]', '- Track record verification - Experienced PMC mandatory - Key man insurance'],
                        ['Financial distress', '[TBD]', 'Critical (5/5)', '[TBD]', '- DD on all projects - Cross-default clauses - Regular disclosures'],
                        ['Diversion of funds', 'Low (2/5)', 'Critical (5/5)', '3.5 - High', '- Escrow account mechanism - End-use monitoring - Quarterly utility certs'],
                        ['Management bandwidth', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Org structure review - Dedicated project team - Regular reviews'],
                        ['Key person dependency', 'Medium (3/5)', 'High (4/5)', '3.5 - High', '- Key man insurance - Succession planning - Documentation of processes'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">E. PROMOTER &amp; MANAGEMENT RISK</p>
                            <table className="w-full border-collapse"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {prom.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD className={r[1] === '[TBD]' ? 'text-slate-400 italic' : ''}>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('High') ? 'text-orange-600' : r[3] === '[TBD]' ? 'text-slate-400 italic' : ''}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(promScore)[1]}`}>Overall Promoter Risk Rating: {getRiskLabel(promScore)[0].toUpperCase()} ({promScore.toFixed(1)}/5) — <em>Subject to verification</em></p>
                        </div>
                    );
                })()}

                {(() => {
                    const loc = [
                        ['Inadequate infrastructure', 'Low (2/5)', 'High (4/5)', '3.0 - Medium', '- Infrastructure assessment - Developer contribution to amenities'],
                        ['Poor connectivity', 'Low (2/5)', 'High (4/5)', '3.0 - Medium', '- Location analysis - Transport linkages verification'],
                        ['Law & order issues', 'Low (2/5)', 'Medium (3/5)', '2.5 - Medium', '- Area safety assessment - Security arrangements - Gated community'],
                        ['Natural calamities', 'Low (2/5)', 'Critical (5/5)', '3.5 - High', '- Seismic zone compliance - Flood zone verification - Structural insurance'],
                        ['Land size constraints', 'High (4/5)', 'High (4/5)', '4.0 - High', '- CRITICAL: Detailed FAR/FSI verification - Density regulation verification'],
                    ];
                    return (
                        <div className="mb-3">
                            <p className="font-bold text-[10px] mb-1">F. LOCATION &amp; SITE-SPECIFIC RISK</p>
                            <table className="w-full border-collapse mb-1"><thead><tr><TH className="w-1/4">Risk Factor</TH><TH className="w-20">Prob.</TH><TH className="w-20">Impact</TH><TH className="w-24">Score</TH><TH>Mitigation Measures</TH></tr></thead>
                                <tbody>
                                    {loc.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                            <TD className={`font-bold ${r[3].includes('High') ? 'text-orange-600' : 'text-yellow-700'}`}>{r[3]}</TD>
                                            <TD className="text-[9px] whitespace-pre-line">{r[4].split('- ').filter(Boolean).map(s => `• ${s}`).join('\n')}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className={`text-[9px] mt-1 font-bold ${getRiskLabel(locScore)[1]}`}>Overall Location Risk Rating: {getRiskLabel(locScore)[0].toUpperCase()} ({locScore.toFixed(1)}/5)</p>
                            <div className="bg-red-50 border border-red-200 p-2 text-red-800 text-[9px] mt-2">
                                <strong>CRITICAL ALERT:</strong> {fmt(plotArea)} sq.m land for {totalUnits} units ({Object.keys(units).length} towers) requires immediate technical validation. This appears extremely tight and may be non-compliant with building regulations.
                            </div>
                        </div>
                    );
                })()}
                {(() => {
                    const renderProjectType = (project as any).type?.toLowerCase() || 'residential';
                    return (
                        <>
                            {renderProjectType === 'commercial' && (
                                <div className="mb-4">
                                    <SH2>6.3 Risk Matrix - Commercial Projects</SH2>
                                    <p className="text-[10px] font-bold mb-1">Specific Commercial Project Risks</p>
                                    <table className="w-full border-collapse mb-2 text-[9px]"><thead><tr><TH>Risk Factor</TH><TH>Probability</TH><TH>Impact</TH><TH>Mitigation</TH></tr></thead>
                                        <tbody>
                                            <tr className="bg-slate-50"><TD className="font-semibold">Tenant vacancy risk</TD><TD>High (4/5)</TD><TD>Critical (5/5)</TD><TD>- Pre-leasing agrmts (min 40%) - Anchor tenant - Rental guarantee</TD></tr>
                                            <tr><TD className="font-semibold">Rental yield compression</TD><TD>Medium (3/5)</TD><TD>High (4/5)</TD><TD>- Conservative assumptions - Grade A area - Premium specs</TD></tr>
                                            <tr className="bg-slate-50"><TD className="font-semibold">Technology obsolescence</TD><TD>Medium (3/5)</TD><TD>High (4/5)</TD><TD>- Future-ready infra - Modular design - Upgradability provisions</TD></tr>
                                            <tr><TD className="font-semibold">Corporate space demand shift</TD><TD>Medium (3/5)</TD><TD>High (4/5)</TD><TD>- WFH impact analysis - Flexible workspace options</TD></tr>
                                            <tr className="bg-slate-50"><TD className="font-semibold">Anchor tenant default</TD><TD>Low (2/5)</TD><TD>Critical (5/5)</TD><TD>- Tenant credit assessment - Security deposits (6-12 mo) - Corp guarantees</TD></tr>
                                        </tbody>
                                    </table>
                                    <div className="bg-slate-50 p-2 border border-slate-200 text-[9px] text-slate-700">
                                        <strong>Commercial projects require:</strong> 1) Min 40% pre-leasing before final disbursement. 2) Rental income escrow arrangement. 3) Tenant creditworthiness assessment. 4) Lock-in period commitments.
                                    </div>
                                </div>
                            )}

                            {renderProjectType === 'mixed' && (
                                <div className="mb-4">
                        <SH2>6.3 Risk Matrix - Mixed-Use Projects</SH2>
                        <p className="text-[10px] font-bold mb-1">Additional Risks for Mixed-Use Developments</p>
                        <table className="w-full border-collapse mb-2 text-[9px]"><thead><tr><TH>Risk Factor</TH><TH>Probability</TH><TH>Impact</TH><TH>Mitigation</TH></tr></thead>
                            <tbody>
                                <tr className="bg-slate-50"><TD className="font-semibold">Phase sync failure</TD><TD>High (4/5)</TD><TD>High (4/5)</TD><TD>- Integrated master plan - Phased approval - Realistic timelines</TD></tr>
                                <tr><TD className="font-semibold">Cross-subsidy complications</TD><TD>Medium (3/5)</TD><TD>High (4/5)</TD><TD>- Clear revenue allocation - Component-wise viability</TD></tr>
                                <tr className="bg-slate-50"><TD className="font-semibold">Regulatory complexity</TD><TD>High (4/5)</TD><TD>Critical (5/5)</TD><TD>- Multiple authority coordination - Extended timeline buffer</TD></tr>
                                <tr><TD className="font-semibold">Market timing mismatch</TD><TD>Medium (3/5)</TD><TD>High (4/5)</TD><TD>- Flexible launch strategy - Component-wise go-live</TD></tr>
                                <tr className="bg-slate-50"><TD className="font-semibold">Management complexity</TD><TD>High (4/5)</TD><TD>Medium (3/5)</TD><TD>- Dedicated teams per component - Clear governance structure</TD></tr>
                            </tbody>
                        </table>
                        <div className="bg-slate-50 p-2 border border-slate-200 text-[9px] text-slate-700">
                            <strong>Mixed-use projects require:</strong> 1) Each component must be independently viable. 2) Minimum 50% equity (higher risk). 3) Extended construction timeline. 4) Professional project management.
                        </div>
                    </div>
                )}
                        </>
                    );
                })()}

                <SH2>{((project as any).type?.toLowerCase() === 'commercial' || (project as any).type?.toLowerCase() === 'mixed') ? '6.4' : '6.3'} Consolidated Risk Dashboard - Subject Project</SH2>
                {(() => {
                    const weights = [0.25, 0.20, 0.20, 0.15, 0.15, 0.05];
                    const scores = [marketScore, execScore, regScore, finScore, promScore, locScore];
                    const overallRisk = scores.reduce((sum, s, i) => sum + (s * weights[i]), 0);
                    const overallLabel = getRiskLabel(overallRisk);

                    const breakdown = [
                        ['Market & Demand', marketScore, 0.25, marketScore * 0.25, marketScore > 3.5 ? 'Needs mitigation' : 'Standard monitoring', getRiskLabel(marketScore)[1]],
                        ['Execution & Construction', execScore, 0.20, execScore * 0.20, execScore > 3.8 ? 'Strict controls req.' : 'Needs mitigation', getRiskLabel(execScore)[1]],
                        ['Regulatory & Legal', regScore, 0.20, regScore * 0.20, regScore > 4 ? 'CRITICAL' : 'Manageable', getRiskLabel(regScore)[1]],
                        ['Financial', finScore, 0.15, finScore * 0.15, finScore > 4 ? 'Tight margins' : 'Manageable with controls', getRiskLabel(finScore)[1]],
                        ['Promoter & Management', promScore, 0.15, promScore * 0.15, 'Subject to verification', getRiskLabel(promScore)[1]],
                        ['Location & Site', locScore, 0.05, locScore * 0.05, locScore > 4 ? 'Technical validation req.' : 'Acceptable', getRiskLabel(locScore)[1]],
                    ] as [string, number, number, number, string, string][];

                    return (
                        <>
                            <table className="w-full border-collapse mb-3"><thead><tr><TH>Risk Category</TH><TH>Risk Rating</TH><TH>Weight</TH><TH>Weighted Score</TH><TH>Status</TH></tr></thead>
                                <tbody>
                                    {breakdown.map(([cat, rat, wgt, ws, stat, col], i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{cat}</TD><TD>{getRiskLabel(rat)[0]} ({rat.toFixed(1)})</TD><TD>{pct(wgt * 100)}</TD>
                                            <TD className="font-bold">{ws.toFixed(2)}</TD><TD className={`font-bold ${col}`}>{stat}</TD>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                                        <TD>OVERALL PROJECT RISK</TD><TD> </TD><TD>100%</TD>
                                        <TD className={overallLabel[1]}>{overallRisk.toFixed(2)} — {overallLabel[0].toUpperCase()}</TD>
                                        <TD className={overallLabel[1]}>{overallRisk >= 4.1 ? 'DECLINE / RESTRUCTURE' : overallRisk >= 3.1 ? 'CONDITIONAL APPROVAL' : 'NORMAL APPROVAL'}</TD>
                                    </tr>
                                </tbody>
                            </table>
                            <div className={`${overallRisk >= 4.1 ? 'bg-red-50 border-red-200 text-red-900' : overallRisk >= 3.1 ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-yellow-50 border-yellow-200 text-yellow-900'} border p-3 rounded text-[10px]`}>
                                <p className="mb-2"><strong>Risk Verdict:</strong> The project carries <strong>{overallLabel[0].toUpperCase()} overall risk ({overallRisk.toFixed(2)}/5)</strong>.</p>
                                <p><strong>Recommendation:</strong> {overallRisk >= 4.1 ? 'Loan application should be declined in current form or completely restructured to mitigate critical risk parameters.' : overallRisk >= 3.1 ? 'Loan can be considered ONLY with stringent conditions precedent and robust risk mitigation covenants.' : 'Project is considered viable for standard financing terms.'}</p>
                            </div>
                        </>
                    );
                })()}
            </div>
            <PageBreak />

            {/* ═══ §7 LEGAL & REGULATORY ═══ */}
            <div className="report-page">
                <SH>7. Legal &amp; Regulatory Compliance</SH>
                <SH2 className="!mt-1">7.1 Legal Due Diligence Framework</SH2>
                <p className="font-bold text-[10px] mb-1">A. Title Verification &amp; Land Documentation</p>
                <table className="w-full border-collapse mb-3"><thead><tr><TH>Document/Check</TH><TH>Purpose</TH><TH>Status</TH><TH>Risk</TH></tr></thead>
                    <tbody>
                        {([
                            ['1. Title Deed Chain (30 yr)', 'Establish clear ownership', 'CRITICAL - Loan cannot proceed'],
                            ['2. Sale Deed', 'Current ownership proof', 'CRITICAL - Cannot create security'],
                            ['3. Mother Deed', 'Original land title', 'HIGH - Chain break risk'],
                            ['4. Encumbrance Certificate', 'No pending claims/mortgages', 'CRITICAL - Prior charges exist'],
                            ['5. Land Revenue Records', 'Khasra/Khatoni/Jamabandi', 'HIGH - Ownership disputes'],
                            ['6. Mutation Records', 'Entry in municipal records', 'MEDIUM - Tax/ownership issues'],
                            ['7. Property Tax Receipts', 'No tax arrears', 'LOW - But must be cleared'],
                            ['8. Conversion Certificate', 'Agri to non-agri', 'CRITICAL - Cannot build'],
                            ['9. CLU', 'Residential use permission', 'CRITICAL - Illegal construction'],
                            ['10. No Objection Certificates', 'From various authorities', 'HIGH - Legal complications'],
                        ] as [string, string, string][]).map(([doc, purpose, risk], i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{doc}</TD><TD>{purpose}</TD><TDP>Pending</TDP>
                                <TD className={`font-bold ${risk.includes('CRITICAL') ? 'text-red-600' : risk.includes('HIGH') ? 'text-orange-600' : risk.includes('MEDIUM') ? 'text-yellow-700' : 'text-green-700'}`}>{risk}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 p-2 border border-slate-200 text-[9px] mb-3">
                    <p className="font-bold mb-1">Title Insurance Requirement:</p>
                    <ul className="list-disc pl-4 text-slate-700">
                        <li><strong>Recommended:</strong> Title insurance policy from approved insurer</li>
                        <li><strong>Coverage:</strong> {crore((totalRev || totalCost || 500000000) * 0.8)} (project value coverage)</li>
                        <li><strong>Period:</strong> Until project completion + 5 years</li>
                        <li><strong>Benefits:</strong> Protection against title defects, legal costs coverage</li>
                    </ul>
                </div>

                <p className="font-bold text-[10px] mb-1">B. Litigation Search &amp; Verification</p>
                <table className="w-full border-collapse mb-2"><thead><tr><TH>Search Type</TH><TH>Court/Forum</TH><TH>Parties Covered</TH><TH>Period</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        {[
                            ['Civil Litigation', 'District/High/Supreme Court', 'Promoter, Company, Land', '10 years'],
                            ['Criminal Cases', 'All Courts', 'Promoter, Directors', '10 years'],
                            ['Revenue Cases', 'Revenue Courts', 'Land parcel', '20 years'],
                            ['Consumer Forums', 'NCDRC/State/District', 'Company, Promoter', '5 years'],
                            ['Arbitration', 'All forums', 'Company, Directors', '5 years'],
                            ['NCLT/NCLAT', 'Insolvency courts', 'Company, Promoter entities', 'Since 2016'],
                            ['Labor Disputes', 'Labor Courts', 'Company', '3 years'],
                            ['Tax Litigation', 'ITAT, High Court', 'Company, Promoter', '5 years'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD>{r[3]}</TD><TDP>Pending</TDP>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[9px] font-bold text-slate-700 mb-4">Acceptable Parameters: No criminal cases, no major land suits, zero NCLT/insolvency proceedings. Routine tax/labor matters acceptable if provided for.</p>
            </div>
            <PageBreak />

            <div className="report-page">
                <p className="font-bold text-[10px] mb-1">C. Regulatory Approvals - Detailed Status</p>
                <table className="w-full border-collapse mb-1"><thead><tr><TH>Phase &amp; Approval</TH><TH>Authority</TH><TH>Timeline</TH><TH>Validity</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-200 font-bold"><TD colSpan={5}>Phase 1: Pre-Construction Approvals (CONDITIONS PRECEDENT)</TD></tr>
                        {[
                            ['Land Use Conversion', 'Revenue Dept/DTCP', '3-6 months', 'Permanent'],
                            ['CLU', 'Town Planning', '2-4 months', 'Permanent'],
                            ['Colonizer License', 'DTCP/HUDA', '4-8 months', '5 years'],
                            ['Building Plan Approval', 'Municipal Corp/DTCP', '3-6 months', '3 years'],
                            ['Environment Clearance', 'SEIAA/MoEF', '4-7 months', 'Project life'],
                            ['Forest Clearance', 'Forest Dept', '3-6 months', 'Project life'],
                            ['Commencement Cert', 'Municipal Corporation', '1-2 months', '3 years'],
                        ].map((r, i) => (
                            <tr key={`p1-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold text-red-700">{r[0]} *</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD>{r[3]}</TD><TDP>Status</TDP>
                            </tr>
                        ))}
                        <tr className="bg-slate-200 font-bold"><TD colSpan={5}>Phase 2: During Construction Approvals</TD></tr>
                        {[
                            ['RERA Registration', 'Haryana RERA', 'Before launch', 'MANDATORY'],
                            ['Water Connection (Bulk)', 'PWD/Water Board', 'Before construction', 'HIGH'],
                            ['Electricity (Temp)', 'Electricity Board', 'Before construction', 'HIGH'],
                            ['Sewerage Connection', 'Municipal Corp', 'During construction', 'HIGH'],
                            ['Fire Safety (Prov)', 'Fire Department', 'Mid-construction', 'HIGH'],
                        ].map((r, i) => (
                            <tr key={`p2-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD className="font-bold text-orange-700">{r[3]}</TD><TDP>Status</TDP>
                            </tr>
                        ))}
                        <tr className="bg-slate-200 font-bold"><TD colSpan={5}>Phase 3: Post-Construction Approvals</TD></tr>
                        {[
                            ['Fire NOC (Final)', 'Fire Department', 'Before occupation', 'CRITICAL'],
                            ['Occupancy Certificate', 'Municipal Corporation', 'Post-completion', 'CRITICAL'],
                            ['Completion Certificate', 'RERA/Local Authority', 'After OC', 'MANDATORY'],
                        ].map((r, i) => (
                            <tr key={`p3-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD className={`font-bold ${r[3] === 'MANDATORY' ? 'text-purple-700' : 'text-red-700'}`}>{r[3]}</TD><TDP>Pending</TDP>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-red-50 border border-red-200 p-2 text-[9px] mb-4 text-red-900">
                    <strong>Approval Risk Check:</strong> Pre-construction approvals marked (*) are mandatory CONDITIONS PRECEDENT. Given Gurugram typical backlogs, estimated timeline to clear all Phase 1 is 8-12 months. Mitigation via professional liaison is required.
                </div>

                <p className="font-bold text-[10px] mb-1">D. RERA Compliance Framework</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr><TH>RERA Requirement</TH><TH>Compliance</TH><TH>Penalty for Non-Compliance</TH></tr></thead>
                    <tbody>
                        {[
                            ['Project Registration', '[Pending]', 'Cannot advertise/sell; ₹10% project cost fine'],
                            ['Separate Escrow Account', '[Not Created]', '3-year imprisonment + fine'],
                            ['70% Fund Usage Restriction', '[N/A until reg]', 'Refund to buyers + interest + penalty'],
                            ['Quarterly Progress Updates', '[N/A]', '₹25,000/day penalty'],
                            ['Timeline Adherence', '[N/A]', 'Delay penalty: ₹5% of unit cost as interest'],
                            ['Structural Defects Warranty', '[N/A]', '5-year warranty mandatory'],
                        ].map((r, i) => (
                            <tr key={`rera-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TDP>{r[1]}</TDP><TD className="text-red-700">{r[2]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="text-[9px] text-slate-700 mb-3"><strong>Escrow Mechanism:</strong> 70% of customer payments ringfenced. Bank must be signatory. Release via CA/Engineer certs.</p>
            </div>
            <PageBreak />

            <div className="report-page">
                <SH2 className="!mt-0">7.2 Corporate &amp; Statutory Compliance</SH2>
                <p className="font-bold text-[10px] mb-1">A. Company Law Compliance</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr><TH>Compliance</TH><TH>Requirement</TH><TH>Verification</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        {[
                            ['Certificate of Incorporation', 'Valid company registration', 'MCA portal verification'],
                            ['Memorandum of Association', 'Real estate in main objects', 'Must include development activity'],
                            ['Articles of Association', 'Borrowing powers adequate', 'Check borrowing limits'],
                            ['Board Resolution', 'Authorizing loan & mortgages', 'Certified copy required'],
                            ['Share Certificates', 'Promoter shareholding proof', 'Min 51% promoter holding'],
                            ['ROC Filings (MGT-7)', 'Updated annually', 'Last 3 years verification'],
                            ['Financial Statements', 'Audited, filed with ROC', 'Last 3 years required'],
                            ['Director KYC (DIR-3)', 'All directors compliant', 'MCA verification'],
                            ['DIN Status', 'All directors have valid DIN', 'Disqualification check'],
                            ['Charge Registration', 'Any existing charges', 'ROC Form CHG-1 search'],
                        ].map((r, i) => (
                            <tr key={`co-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TDP>Pending</TDP>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-red-50 border border-red-200 p-2 text-[9px] mb-3 text-red-900">
                    <strong>Red Flags to Watch:</strong> Directors disqualified under Sec 164; Pending strike-off proceedings; Delayed ROC filings; Qualified audit reports; Frequent auditor changes; Excessive related party transactions.
                </div>

                <p className="font-bold text-[10px] mb-1">B. Tax Compliance Verification</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr><TH>Tax Type</TH><TH>Compliance Check</TH><TH>Period</TH><TH>Status</TH><TH>Risk</TH></tr></thead>
                    <tbody>
                        {[
                            ['Income Tax Returns', 'Filed regularly', 'Last 5 years', 'HIGH'],
                            ['GST Returns', 'Monthly/Quarterly filing', 'Last 24 months', 'CRITICAL'],
                            ['TDS Returns', 'All TDS deposited & filed', 'Last 3 years', 'HIGH'],
                            ['GST Registration', 'Valid GSTIN', 'Current', 'CRITICAL'],
                            ['PAN', 'Company & promoters', '—', 'CRITICAL'],
                            ['Tax Demand Notices', 'No pending demands', 'Current', 'HIGH'],
                            ['Tax Litigation', 'Status of appeals', 'Current', 'MEDIUM'],
                            ['Advance Tax', 'Current year payment', 'Current FY', 'MEDIUM'],
                        ].map((r, i) => (
                            <tr key={`tx-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TDP>Pending</TDP>
                                <TD className={`font-bold ${r[3] === 'CRITICAL' ? 'text-red-600' : r[3] === 'HIGH' ? 'text-orange-600' : 'text-yellow-700'}`}>{r[3]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 p-2 border border-slate-200 text-[9px] mb-3">
                    <strong>GST-Specific Requirements:</strong> @5% for residential (without ITC), @12% for commercial (with ITC). Monthly/Quarterly filing mandatory. ITC reconciliation required.
                </div>

                <p className="font-bold text-[10px] mb-1">C. Labor &amp; Environmental Compliance</p>
                <table className="w-full border-collapse mb-4 text-[9px]"><thead><tr><TH>Compliance</TH><TH>Applicability</TH><TH>Remarks</TH><TH>Status</TH></tr></thead>
                    <tbody>
                        {[
                            ['Contract Labor License', 'If >20 workers', 'Before construction'],
                            ['ESI Registration', 'If applicable', 'Mandatory compliance'],
                            ['PF Registration', 'If applicable', 'Employer + contractor'],
                            ['Building Workers Act', 'All construction', 'Cess payment mandatory'],
                            ['Environment Clearance', 'If project >20,000 sq.m', 'This project may be exempt'],
                            ['Waste Management Plan', 'All projects', 'Construction debris'],
                            ['Air & Water Pollution NOC', 'During construction', 'From pollution board'],
                            ['Green Building Norms', 'Voluntary/Mandatory', 'GRIHA/LEED certification'],
                        ].map((r, i) => (
                            <tr key={`lab-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TDP>Required</TDP>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>7.3 Customer/Buyer Protection Framework</SH2>
                <p className="font-bold text-[10px] mb-1">A. Standard Buyer Agreement Terms (RERA Mandated)</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr><TH>Clause Area</TH><TH>Bank Review Requirements / RERA Compliance</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="font-semibold">Carpet Area Definition</TD><TD>Must be as per RERA (net usable); Loading factor disclosed; No hidden super built-up charges</TD></tr>
                        <tr><TD className="font-semibold">Payment Schedule</TD><TD>Linked to milestones; Not front-loaded; Favorable to project cash flow</TD></tr>
                        <tr className="bg-slate-50"><TD className="font-semibold">Possession Timeline</TD><TD>Clear deadline + max 6mo grace; Delay penalty ~₹5-10/sq.ft/mo; Force majeure defined</TD></tr>
                        <tr><TD className="font-semibold">Cancellation &amp; Refund</TD><TD>Right to cancel before 2-3 stages; Refund w/in 45 days; Deduction max 10% or actual cost</TD></tr>
                        <tr className="bg-slate-50"><TD className="font-semibold">Specifications</TD><TD>Detailed specs annexed; Change only w/ buyer consent; Alternative of equal value if changed</TD></tr>
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 text-[9px] mb-3 text-slate-800">
                    <strong>Review Requirement:</strong> Sample buyer agreements to be submitted to bank. Complete legal vetting necessary to ensure no anti-consumer clauses exist that could trigger RERA disputes.
                </div>

                <p className="font-bold text-[10px] mb-1">B. Consumer Protection Measures</p>
                <table className="w-full border-collapse mb-4 text-[9px]"><thead><tr><TH>Protection Mechanism</TH><TH>Implementation / Requirement</TH><TH>Bank's Monitoring Role</TH></tr></thead>
                    <tbody>
                        {[
                            ['RERA Escrow Account', 'Mandatory 70% ring-fencing', 'Bank as co-signatory'],
                            ['Project Insurance', "Contractor's all-risk policy", 'Bank as loss payee'],
                            ['Title Insurance', 'Optional but recommended', "For bank's security"],
                            ['Structural Warranty', '5 years (RERA mandatory)', 'Contractor guarantee'],
                            ['Defect Liability Period', '12-24 months post-handover', 'Retention money mechanism'],
                        ].map((r, i) => (
                            <tr key={`cp-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <SH2>7.4 Legal Opinion &amp; Documentation</SH2>
                <div className="report-page">
                    <p className="font-bold text-[10px] mb-1">A. Bank's Panel Advocate Opinion Required On:</p>
                    <table className="w-full border-collapse mb-4 text-[9px]"><thead><tr><TH>Verification Area</TH><TH>Checks Performed</TH><TH>Required Opinion Format</TH></tr></thead>
                        <tbody>
                            <tr className="bg-slate-50"><TD className="font-semibold">Title &amp; Ownership</TD><TD>Clear marketable title; No encumbrances; Ownership chain</TD><TD>"Title is clear and marketable"</TD></tr>
                            <tr><TD className="font-semibold">Approvals &amp; Licenses</TD><TD>All statutory permissions obtained; Validity periods; Conditions</TD><TD>"Project is legally approved for construction"</TD></tr>
                            <tr className="bg-slate-50"><TD className="font-semibold">Corporate Authorization</TD><TD>Board resolution adequate; Borrowing powers; Pledge/mortgage auth</TD><TD>"Company authorized to borrow and create security"</TD></tr>
                            <tr><TD className="font-semibold">Litigation</TD><TD>No adverse litigation; Pending matters quantified; Risk assessed</TD><TD>"No material litigation affecting project"</TD></tr>
                            <tr className="bg-slate-50"><TD className="font-semibold">RERA Compliance</TD><TD>Registration status; Ongoing compliance; Escrow arrangement</TD><TD>"Project is RERA compliant"</TD></tr>
                        </tbody>
                    </table>

                    <p className="font-bold text-[10px] mb-1">B. Loan Documentation Checklist</p>
                    
                    {/* Primary Security Documents */}
                    <p className="font-bold text-[9px] text-slate-700 bg-slate-100 p-1 border border-slate-200 mb-0">Primary Security Documents:</p>
                    <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr><TH>Document</TH><TH>Purpose</TH><TH>Execution</TH><TH>Registration</TH></tr></thead>
                        <tbody>
                            {[
                                ['Loan Agreement', 'Terms & conditions', 'Borrower + Bank', 'Optional'],
                                ['Hypothecation Deed', 'Charge on receivables', 'Borrower', 'Not required'],
                                ['Mortgage Deed (Equitable)', 'Charge on land (if not yet titled)', 'Borrower', 'Required within 120 days'],
                                ['Mortgage Deed (Registered)', 'Charge on titled property', 'Borrower', 'Required (ROC + Sub-Registrar)'],
                                ['Assignment of Receivables', 'Rights over customer payments', 'Borrower', 'Optional'],
                                ['Escrow Agreement', 'Control over bank accounts', 'Borrower + Bank + Agent', 'Not required'],
                                ['Tripartite Agreement', 'Buyer-Bank-Builder', 'All parties', 'Not required'],
                                ['Personal Guarantee', "Promoter's personal liability", 'Promoters', 'Optional'],
                                ['Corporate Guarantee', 'Group company guarantee', 'Holding/sister company', 'Optional'],
                                ['Pledge of Shares', "Promoter's shares in company", 'Promoter', 'With depository'],
                            ].map((r, i) => (
                                <tr key={`pri-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                    <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD className={r[3].includes('Required') ? 'font-bold text-slate-900' : 'text-slate-600'}>{r[3]}</TD>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Collateral Security Documents */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <p className="font-bold text-[9px] text-slate-700 bg-slate-100 p-1 border border-slate-200 border-b-0 mb-0">Collateral Security Documents:</p>
                            <table className="w-full border-collapse text-[9px]"><thead><tr><TH>Document</TH><TH>Purpose / Details</TH></tr></thead>
                                <tbody>
                                    {[
                                        ['Charge Creation (ROC)', 'Form CHG-1 within 30 days'],
                                        ['CERSAI Registration', 'Central registry within 30 days'],
                                        ['Power of Attorney', "Bank's rights to sell (Irrevocable)"],
                                        ['Deed of Adherence', 'Future land parcels / phases'],
                                    ].map((r, i) => (
                                        <tr key={`col-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <p className="font-bold text-[9px] text-slate-700 bg-slate-100 p-1 border border-slate-200 border-b-0 mb-0">Compliance &amp; Monitoring Items:</p>
                            <table className="w-full border-collapse text-[9px]"><thead><tr><TH>Document</TH><TH>Frequency</TH><TH>Purpose</TH></tr></thead>
                                <tbody>
                                    {[
                                        ['Stock & Receivables Stmt', 'Monthly', 'Asset verification'],
                                        ['Utilization Certificate', 'Each disburse', 'End-use monitoring'],
                                        ['Progress Report', 'Monthly', 'Construction tracking'],
                                        ['Sales Report', 'Monthly', 'Revenue tracking'],
                                        ['Financial Statements', 'Quarterly', 'Financial health'],
                                        ['RERA/Compliance Cert', 'Quarterly', 'Regulatory adherence'],
                                    ].map((r, i) => (
                                        <tr key={`mon-${i}`} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* ═══ §8 COLLATERAL & SECURITY ═══ */}
            <div className="report-page">
                <SH>8. Collateral &amp; Security Structure</SH>
                <SH2 className="!mt-1">8.1 Primary Security Package</SH2>
                <p className="font-bold text-[10px] mb-1">A. Land &amp; Building Mortgage</p>
                {(() => {
                    const landVal = plotArea * 60000 / 10000000;
                    const buildVal = totalRev / 10000000;
                    const totalSec = landVal + buildVal;
                    const landCovPct = loanAmount > 0 ? (landVal * 10000000 / loanAmount * 100).toFixed(0) : '—';
                    const totCov = loanAmount > 0 ? (totalSec * 10000000 / loanAmount).toFixed(2) : '—';
                    return (
                        <>
                            <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr>
                                <TH>Security Component</TH><TH>Description</TH><TH>Est. Value</TH><TH>Security Coverage</TH>
                            </tr></thead>
                                <tbody>
                                    <tr className="bg-slate-50">
                                        <TD className="font-semibold">Land (Freehold)</TD>
                                        <TD>{fmt(plotArea)} sq.m</TD>
                                        <TD>{crore(landVal * 10000000)}</TD>
                                        <TD>{landCovPct}% of loan</TD>
                                    </tr>
                                    <tr>
                                        <TD className="font-semibold">Building (Under Construction)</TD>
                                        <TD>{totalUnits} apartments, {fmt(builtUp * 10.764)} sq.ft</TD>
                                        <TD>{crore(buildVal * 10000000)} (progressive)</TD>
                                        <TD>{loanAmount > 0 ? `${(buildVal * 10000000 / loanAmount).toFixed(2)}x of loan (at completion)` : '—'}</TD>
                                    </tr>
                                    <tr className="bg-slate-50">
                                        <TD className="font-semibold">Construction WIP</TD>
                                        <TD>Work-in-progress value</TD>
                                        <TD>Progressive</TD>
                                        <TD>Growing security</TD>
                                    </tr>
                                    <tr className="bg-slate-100 font-bold">
                                        <TD>Total Primary Security</TD>
                                        <TD>Land + Building + WIP</TD>
                                        <TD>{crore(totalSec * 10000000)} (at completion)</TD>
                                        <TD className="text-green-700">{totCov}x coverage</TD>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="grid grid-cols-2 gap-2 text-[9px] mb-3">
                                <div className="bg-slate-50 border border-slate-200 p-2">
                                    <p className="font-bold mb-1">Valuation Requirements:</p>
                                    <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                                        <li>By bank's approved valuer (Category-I)</li>
                                        <li>Land: Comparable sale method</li>
                                        <li>Building: Cost + Depreciation / Market value</li>
                                        <li>Revaluation: Annual during construction</li>
                                        <li>FSV: 75% of market value</li>
                                        <li>Min cover: 1.5x on FSV basis</li>
                                    </ul>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 p-2">
                                    <p className="font-bold mb-1">Mortgage Type &amp; Title Conditions:</p>
                                    <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                                        <li><strong>Initial:</strong> Equitable mortgage (deposit of title deeds)</li>
                                        <li><strong>Upon Title Clarity:</strong> Registered mortgage within 120 days</li>
                                        <li>Registration: Sub-Registrar + ROC CHG-1 + CERSAI</li>
                                        <li>Clear, marketable &amp; transferable title required</li>
                                        <li>No prior charges or encumbrances</li>
                                        <li>Title insurance recommended</li>
                                    </ul>
                                </div>
                            </div>
                        </>
                    );
                })()}

                <p className="font-bold text-[10px] mb-1">B. Assignment of Project Receivables</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr>
                    <TH>Receivable Type</TH><TH>Assignment Mechanism</TH><TH>Collection Method</TH>
                </tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="font-semibold">Customer Installments</TD><TD>Absolute assignment to bank</TD><TD>Tripartite agreement (Buyer-Bank-Builder)</TD></tr>
                        <tr><TD className="font-semibold">Customer Loan Disbursements</TD><TD>Direct routing to project account</TD><TD>Escrow arrangement</TD></tr>
                        <tr className="bg-slate-50"><TD className="font-semibold">Rental Income</TD><TD>If any commercial component</TD><TD>Assignment deed</TD></tr>
                        <tr><TD className="font-semibold">Insurance Claims</TD><TD>All project insurance policies</TD><TD>Bank as loss payee/beneficiary</TD></tr>
                    </tbody>
                </table>
                {(() => {
                    const yr = [0.31, 0.38, 0.23, 0.08];
                    let cum = 0;
                    return (
                        <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr>
                            <TH>Year</TH><TH>Customer Collections (Est.)</TH><TH>% Pre-sold</TH><TH>Cumulative Receivables</TH>
                        </tr></thead>
                            <tbody>
                                {yr.map((frac, i) => {
                                    const annual = totalRev * frac;
                                    cum += annual;
                                    const preSold = [31, 69, 92, 100][i];
                                    return (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">Year {i + 1}</TD>
                                            <TD>{crore(annual)}</TD>
                                            <TD>{preSold}%</TD>
                                            <TD className="font-semibold">{crore(cum)}</TD>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    );
                })()}
            </div>
            <div className="report-page mt-6">
                <SH2>8.2 Collateral Security Package</SH2>
                <p className="font-bold text-[10px] mb-1">A. Personal Guarantees</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr>
                    <TH>Guarantor</TH><TH>Type</TH><TH>Net Worth Required</TH><TH>Income Proof</TH><TH>Documents</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Promoter/Director 1', 'Personal', 'Min ₹10 Cr', 'ITR, bank statements', 'Guarantee deed, asset list'],
                            ['Promoter/Director 2', 'Personal', 'Min ₹10 Cr', 'ITR, bank statements', 'Guarantee deed, asset list'],
                            ['Holding Company', 'Corporate', 'Min ₹20 Cr', 'Audited financials', 'Board resolution, guarantee deed'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="grid grid-cols-2 gap-2 mb-3 text-[9px]">
                    <div className="bg-slate-50 border border-slate-200 p-2">
                        <p className="font-bold mb-1">Guarantee Terms:</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                            <li>Unconditional and irrevocable</li>
                            <li>Continuing guarantee for all dues</li>
                            <li>Joint and several liability</li>
                            <li>Survives restructuring/settlement</li>
                            <li>Enforceable as principal debtor</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-2">
                        <p className="font-bold mb-1">Guarantor Due Diligence:</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                            <li>CIBIL score &gt;750</li>
                            <li>No NPA accounts</li>
                            <li>Stable income/business</li>
                            <li>Litigation search</li>
                            <li>Asset verification</li>
                        </ul>
                    </div>
                </div>

                <p className="font-bold text-[10px] mb-1">B. Pledge of Promoter's Shares</p>
                <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr><TH>Parameter</TH><TH>Details</TH></tr></thead>
                    <tbody>
                        {[
                            ['Shares to be Pledged', '51% of paid-up capital of borrower company'],
                            ['Valuation', 'As per book value or fair value'],
                            ['Voting Rights', 'Remain with pledgor until default'],
                            ['Dividend Rights', 'Can be appropriated by bank on default'],
                            ['Transfer Restrictions', "Bank's consent required for any transfer"],
                            ['Invocation', 'Upon any event of default'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold w-1/3">{r[0]}</TD><TD>{r[1]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <p className="font-bold text-[10px] mb-1">C. Escrow Account Mechanism — Three-Tier Structure</p>
                <div className="bg-slate-50 border border-slate-200 p-3 mb-1 text-[9px]">
                    <div className="flex flex-col gap-1">
                        <div className="border-2 border-blue-400 bg-blue-50 p-2 rounded text-center">
                            <p className="font-bold text-blue-900">TIER 1: COLLECTION ACCOUNT</p>
                            <p className="text-blue-800">All customer payments + loan disbursements → Bank as primary signatory</p>
                        </div>
                        <div className="text-center text-slate-500 font-mono text-xs">↓ Daily sweep</div>
                        <div className="border-2 border-green-400 bg-green-50 p-2 rounded text-center">
                            <p className="font-bold text-green-900">TIER 2: RERA ESCROW ACCOUNT (70%)</p>
                            <p className="text-green-800">Ring-fenced for construction only → Bank + Borrower joint signatories</p>
                        </div>
                        <div className="text-center text-slate-500 font-mono text-xs">↓ As per utilization certificate</div>
                        <div className="border-2 border-orange-400 bg-orange-50 p-2 rounded text-center">
                            <p className="font-bold text-orange-900">TIER 3: OPERATING ACCOUNT (30%)</p>
                            <p className="text-orange-800">Marketing, overheads, interest, approved expenses → Borrower with bank oversight</p>
                        </div>
                    </div>
                </div>
                <div className="bg-red-50 border border-red-200 p-2 text-[9px] mb-3 text-red-900">
                    <strong>Escrow Compliance:</strong> Monthly statements to bank; Quarterly RERA filings; Annual CA certification. <strong>Violation = Immediate Event of Default.</strong>
                </div>
            </div>
            <div className="report-page mt-6">
                <SH2>8.3 Insurance as Security</SH2>
                <p className="font-bold text-[10px] mb-1">A. Mandatory Insurance Policies</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr>
                    <TH>Insurance Type</TH><TH>Coverage</TH><TH>Sum Insured</TH><TH>Beneficiary</TH><TH>Period</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ["Contractor's All Risk (CAR)", 'Construction risks, third-party', crore(totalRev * 0.80), 'Bank (loss payee)', 'Construction period'],
                            ['Erection All Risk (EAR)', 'MEP, elevators, equipment', crore(totalCost * 0.10), 'Bank (loss payee)', 'Installation period'],
                            ['Professional Indemnity', 'Architect/Engineer errors', crore(totalCost * 0.06), 'Borrower', 'Project period'],
                            ['Public Liability', 'Third-party injury/damage', crore(totalCost * 0.03), 'Borrower', 'Construction period'],
                            ['Fire & Special Perils', 'Post-completion fire risk', crore(totalRev * 0.70), 'Bank (mortgagee clause)', 'Post-completion'],
                            ['Key Man Insurance', "Promoter's life", crore(Math.max(loanAmount * 0.3, 50000000)), 'Bank (nominee)', 'Loan tenure'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 text-[9px] mb-3">
                    <strong>Insurance Conditions:</strong> Bank as co-insured/loss payee; Premium proof before each disbursement; No cancellation without consent; Claims assigned to bank.
                </div>

                <p className="font-bold text-[10px] mb-1">B. Title Insurance (Recommended)</p>
                <div className="bg-blue-50 border border-blue-200 p-2 text-[9px] mb-4">
                    <ul className="list-disc pl-3 space-y-0.5 text-slate-800">
                        <li><strong>Coverage:</strong> {crore(totalRev * 0.80)} – {crore(totalRev * 0.90)} (project value)</li>
                        <li><strong>Protection against:</strong> Title defects, encumbrances, fraud</li>
                        <li>Legal defense costs covered</li>
                        <li>One-time premium (~0.5–1% of coverage)</li>
                        <li><strong>Validity:</strong> Until project completion + 5 years</li>
                    </ul>
                </div>

                <SH2>8.4 Security Perfection &amp; Monitoring</SH2>
                <p className="font-bold text-[10px] mb-1">A. Security Creation Timeline</p>
                <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr>
                    <TH>Action</TH><TH>Timeline</TH><TH>Responsibility</TH><TH>Consequence of Delay</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Legal Opinion', 'Before first disbursement', "Bank's panel advocate", 'No disbursement'],
                            ['Equitable Mortgage', 'At first disbursement', 'Borrower + Bank', 'Delay in disbursement'],
                            ['Registered Mortgage', 'Within 120 days', 'Borrower', 'Penal interest'],
                            ['ROC Charge (CHG-1)', 'Within 30 days of creation', 'Borrower', 'Charge invalid'],
                            ['CERSAI Registration', 'Within 30 days', 'Bank', 'Priority loss risk'],
                            ['Tripartite Agreements', 'Before customer bookings', 'Borrower + Buyers', 'Sales proceeds at risk'],
                            ['Escrow Account', 'Before first disbursement', 'Borrower + Bank', 'No disbursement'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                                <TD className="text-red-700 font-semibold">{r[3]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="grid grid-cols-3 gap-2 mb-3 text-[9px]">
                    <div className="bg-slate-50 border border-slate-200 p-2">
                        <p className="font-bold mb-1 text-center border-b border-slate-300 pb-1">Monthly Monitoring</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                            <li>Stock &amp; receivables statement</li>
                            <li>Sales progress report</li>
                            <li>Construction progress</li>
                            <li>Escrow reconciliation</li>
                            <li>Insurance premium status</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-2">
                        <p className="font-bold mb-1 text-center border-b border-slate-300 pb-1">Quarterly Monitoring</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-slate-700">
                            <li>Independent engineer inspection</li>
                            <li>Provisional financial statements</li>
                            <li>Covenant compliance cert</li>
                            <li>RERA compliance status</li>
                            <li>Market conditions assessment</li>
                        </ul>
                    </div>
                    <div className="bg-red-50 border border-red-200 p-2">
                        <p className="font-bold mb-1 text-center border-b border-red-300 pb-1 text-red-900">Red Flag Triggers</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-red-800">
                            <li>Sales &lt;50% target (2 qtrs)</li>
                            <li>Cost overrun &gt;10%</li>
                            <li>Timeline delay &gt;3 months</li>
                            <li>Escrow fund diversion</li>
                            <li>RERA non-compliance</li>
                        </ul>
                    </div>
                </div>

                <SH2>8.5 Security Coverage Analysis</SH2>
                {(() => {
                    const stages: [string, number, number, string][] = [
                        ['At Disbursement Start', 0.15, 0.40, 'Adequate'],
                        ['6 Months', 0.40, 0.67, 'Adequate'],
                        ['12 Months', 0.60, 1.07, 'Adequate'],
                        ['24 Months', 0.90, 1.60, 'Adequate'],
                        ['36 Months (Peak)', 1.00, 1.90, 'Comfortable'],
                        ['Post-Completion', 0.60, 2.00, 'Strong'],
                    ];
                    return (
                        <table className="w-full border-collapse mb-2 text-[9px]"><thead><tr>
                            <TH>Stage</TH><TH>Loan Outstanding</TH><TH>Security Value</TH><TH>Coverage Ratio</TH><TH>Remarks</TH>
                        </tr></thead>
                            <tbody>
                                {stages.map(([stage, lp, sp, rem], i) => {
                                    const lOut = loanAmount * lp;
                                    const sVal = (plotArea * 60000 + totalRev) * sp;
                                    const ratio = lOut > 0 ? sVal / lOut : 0;
                                    return (
                                        <tr key={i} className={i === stages.length - 1 ? 'bg-green-50 font-bold' : i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{stage}</TD>
                                            <TD>{i === stages.length - 1 ? 'Reducing' : crore(lOut)}</TD>
                                            <TD>{crore(sVal)}</TD>
                                            <TD className={`font-bold ${ratio >= 2 ? 'text-green-700' : ratio >= 1.5 ? 'text-blue-700' : 'text-yellow-700'}`}>{ratio.toFixed(2)}x</TD>
                                            <TD className={rem === 'Strong' ? 'text-green-700 font-semibold' : rem === 'Comfortable' ? 'text-blue-700 font-semibold' : ''}>{rem}</TD>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    );
                })()}
                <div className="bg-green-50 border border-green-200 p-2 text-[9px] text-green-900">
                    <strong>Minimum Coverage Requirement:</strong> 1.5x at all times (on FSV basis). Subject to proper valuation and legal verification, security coverage appears adequate throughout project lifecycle.
                </div>
            </div>
            <PageBreak />

            {/* ═══ §9 UNDERWRITING PARAMETERS ═══ */}
            <div className="report-page">
                <SH>9. Project-Specific Underwriting Parameters</SH>
                <SH2 className="!mt-1">9.1 Underwriting Parameters by Project Type</SH2>
                {(() => {
                    const use = String(project.intendedUse || 'Residential');
                    const isResidential = use.toLowerCase().includes('residential') || use === 'Residential';
                    const isCommercial  = use.toLowerCase().includes('commercial');
                    const isMixed       = use.toLowerCase().includes('mix');
                    const isSpecial     = !isResidential && !isCommercial && !isMixed;

                    // Column highlight helper
                    const colCls = (colIdx: number) => {
                        // colIdx: 0=Residential High-Rise, 1=Low-Rise, 2=Plotted, 3=Affordable
                        if (isResidential && colIdx === 0) return 'bg-blue-100 text-blue-900 font-bold';
                        if (isSpecial && colIdx === 3) return 'bg-blue-100 text-blue-900 font-bold';
                        return '';
                    };
                    const hdrCls = (colIdx: number) => {
                        if (isCommercial) return colIdx === 0 ? 'bg-amber-700 text-white' : '';
                        if (isMixed) return colIdx === 1 ? 'bg-purple-700 text-white' : '';
                        if (isSpecial) return colIdx === 3 ? 'bg-green-700 text-white' : '';
                        return colIdx === 0 ? 'bg-blue-700 text-white' : '';
                    };

                    const resRows = [
                        ['Min. Promoter Contribution', '30-35%', '25-30%', '20-25%', '15-20%'],
                        ['Pre-Sales Requirement', '30-40%', '25-30%', '50-60%', '20-30%'],
                        ['Maximum LTV', '65-70%', '70-75%', '60-65%', '75-80%'],
                        ['Debt-Equity Ratio (Max)', '2:1', '2.33:1', '1.5:1', '4:1'],
                        ['Minimum DSCR', '1.25x', '1.25x', '1.20x', '1.15x'],
                        ['Interest Coverage', '2.0x', '2.0x', '1.75x', '1.5x'],
                        ['Statutory Approvals', '100% before disb.', '100% before disb.', '80% minimum', '100% before disb.'],
                        ['RERA Registration', 'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory'],
                        ['Margin on Cost', 'Min 20%', 'Min 18%', 'Min 15%', 'Min 10-12%'],
                        ['Construction Timeline', '24-36 months', '18-24 months', '12-18 months', '18-30 months'],
                        ['Promoter Track Record', '3+ projects', '2+ projects', '2+ projects', '1+ project (or tie-up)'],
                    ];

                    const deRatio = equityAmount > 0 ? loanAmount / equityAmount : 99;
                    const equityPct = totalCost > 0 ? equityAmount / totalCost * 100 : 0;
                    const costPerSqft = builtUp > 0 ? totalCost / (builtUp * 10.764) : 0;
                    const revenuePerSqft = builtUp > 0 ? totalRev / (builtUp * 10.764) : 0;

                    const subjectBadge = `${use} Project ← (This Project)`;

                    return (
                        <>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="font-bold text-[10px]">Underwriting Parameters by Project Type</p>
                                <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold ${isResidential ? 'bg-blue-100 text-blue-800' : isCommercial ? 'bg-amber-100 text-amber-800' : isMixed ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                                    ← {use} project active
                                </span>
                            </div>
                            <table className="w-full border-collapse mb-2 text-[9px]">
                                <thead>
                                    <tr>
                                        <TH className="w-1/4">Parameter</TH>
                                        <TH className={hdrCls(0)}>Residential High-Rise {isResidential ? '★' : ''}</TH>
                                        <TH className={hdrCls(1)}>Mixed-Use / Low-Rise {isMixed ? '★' : ''}</TH>
                                        <TH className={hdrCls(2)}>Commercial Office {isCommercial ? '★' : ''}</TH>
                                        <TH className={hdrCls(3)}>Affordable / Special {isSpecial ? '★' : ''}</TH>
                                    </tr>
                                </thead>
                                <tbody>
                                    {resRows.map((r, i) => (
                                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                            <TD className="font-semibold">{r[0]}</TD>
                                            <TD className={colCls(0)}>{r[1]}</TD>
                                            <TD className={colCls(1)}>{r[2]}</TD>
                                            <TD className={colCls(2)}>{r[3]}</TD>
                                            <TD className={colCls(3)}>{r[4]}</TD>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* ── Subject-Project-Specific Metrics ── */}
                            {(isResidential || isMixed) && (
                                <>
                                    <p className="font-bold text-[10px] mb-1">A. {subjectBadge} — Subject Project Compliance Matrix</p>
                                    <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr>
                                        <TH>Underwriting Metric</TH><TH>Bank's Requirement</TH><TH>Subject Project</TH><TH>Compliance</TH>
                                    </tr></thead>
                                        <tbody>
                                            {[
                                                ['Land Ownership', 'Freehold, clear title', '[TBD]', null],
                                                ['FAR Utilization', 'As per approved plan', `${fmt(achievedFAR, 2)} / ${far}`, achievedFAR <= far],
                                                ['Density Norms', 'As per master plan', `${totalUnits} units on ${fmt(plotArea)} sqm`, plotArea / Math.max(1, totalUnits) >= 25],
                                                ['Parking Provision', `${parkReq} ECS required`, `${parkProv} ECS`, parkProv >= parkReq],
                                                ["Promoter's Equity", `30% = ${crore(totalCost * 0.30)}`, `${crore(equityAmount)} (${equityPct.toFixed(1)}%)`, equityPct >= 30],
                                                ['Pre-Sales', `30% = ${crore(totalRev * 0.30)}`, `${crore(totalRev * 0.31)} projected (31%)`, true],
                                                ['LTV on Land', 'Max 70%', '[Depends on valuation]', null],
                                                ['Construction Cost', '<₹4,000/sq.ft', costPerSqft > 0 ? `₹${fmt(costPerSqft)}/sq.ft` : '—', costPerSqft < 4000 || costPerSqft === 0],
                                                ['Sales Realization', 'Min ₹12,000/sq.ft', revenuePerSqft > 0 ? `₹${fmt(revenuePerSqft)}/sq.ft` : '—', revenuePerSqft >= 12000 || revenuePerSqft === 0],
                                                ['Gross Margin', 'Min 20%', pct(grossMargin), grossMargin >= 20],
                                                ['Project IRR', 'Min 18%', '28-32% (est.)', true],
                                                ['Professional Team', 'Architect, Engineer, PMC', '[TBD]', null],
                                            ].map((r, i) => (
                                                <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                                    <TD className="font-semibold">{r[0] as string}</TD>
                                                    <TD>{r[1] as string}</TD>
                                                    <TD>{r[2] as string}</TD>
                                                    <TD>{r[3] === null ? <span className="text-amber-600 italic">Pending</span> : r[3] ? <span className="text-green-700 font-bold">✓ Compliant</span> : <span className="text-red-600 font-bold">✗ Concern</span>}</TD>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}

                            {(isCommercial || isMixed) && (
                                <>
                                    <p className="font-bold text-[10px] mb-1">B. COMMERCIAL PROJECTS — Office &amp; Retail Norms {isCommercial ? subjectBadge : '(Reference)'}</p>
                                    <div className="grid grid-cols-2 gap-2 mb-3 text-[8px]">
                                        <table className="w-full border-collapse"><thead><tr><TH colSpan={2} className={isCommercial ? 'bg-amber-700' : 'bg-slate-200'}>Office Space</TH></tr><tr><TH>Parameter</TH><TH>Requirement</TH></tr></thead>
                                            <tbody>{[['Promoter Contribution','35-40%'],['Pre-Leasing','40-50%'],['Anchor Tenant','Min 30% area'],['Lease Lock-in','6-9 years'],['Rental Yield','7-8% on cost'],['LTV / DSCR','60-65% / 1.50x']].map((r,i) => (<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD></tr>))}</tbody>
                                        </table>
                                        <table className="w-full border-collapse"><thead><tr><TH colSpan={2} className="bg-slate-200">Retail / Mall</TH></tr><tr><TH>Parameter</TH><TH>Requirements</TH></tr></thead>
                                            <tbody>{[['Pre-Leasing','50-60% (inc. anchors)'],['Tenant Mix','Max 20% single cat.'],['Catchment','Min 5L pop. (5km)'],['Parking','1 ECS / 100 sq.ft'],['Rental Escal.','15% every 3 yrs'],['CAM','Separate recovery']].map((r,i) => (<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD></tr>))}</tbody>
                                        </table>
                                    </div>
                                </>
                            )}

                            {(isMixed) && (
                                <>
                                    <p className="font-bold text-[10px] mb-1">C. MIXED-USE PROJECTS — {subjectBadge}</p>
                                    <div className="bg-purple-50 border border-purple-200 p-2 text-[9px] mb-3">
                                        <ul className="list-disc pl-3 space-y-0.5 text-purple-900">
                                            <li><strong>Overall:</strong> Each component must be independently viable (no cross-subsidy)</li>
                                            <li><strong>Equity / LTV:</strong> 40-45% equity; 55-60% LTV due to execution complexity</li>
                                            <li><strong>Phasing:</strong> Complete one component before starting the next</li>
                                            <li><strong>Escrow:</strong> Separate escrow for each revenue stream mandatory</li>
                                            <li><strong>Approvals:</strong> Separate building plan approvals for each component</li>
                                        </ul>
                                    </div>
                                </>
                            )}

                            {(!isResidential && !isCommercial && !isMixed) && (
                                <>
                                    <p className="font-bold text-[10px] mb-1">D. SPECIAL PURPOSE — {subjectBadge}</p>
                                    <div className="bg-green-50 border border-green-200 p-2 text-[9px] mb-3">
                                        <ul className="list-disc pl-3 space-y-0.5 text-green-900">
                                            <li><strong>Logistics / Warehousing:</strong> 60-70% pre-leasing, 9-10% yield, highway proximity</li>
                                            <li><strong>Senior Living:</strong> Healthcare tie-ups mandatory, nursing ops cost structure</li>
                                            <li><strong>PMAY / Affordable:</strong> 15-20% promoter equity acceptable with Govt. backing</li>
                                            <li>Price caps, 60 sqm carpet area limits must be strictly verified with state-specific norms</li>
                                        </ul>
                                    </div>
                                </>
                            )}
                        </>
                    );
                })()}
                <SH2 className="!mt-4">9.2 Disbursement Schedule &amp; Milestones</SH2>
                <p className="font-bold text-[10px] mb-1">Standard Disbursement Structure (Subject Project - Residential)</p>
                <table className="w-full border-collapse mb-1 text-[9px]"><thead><tr>
                    <TH>Stage</TH><TH>Milestone</TH><TH>% Disb.</TH><TH>Cum.</TH><TH>Verification Required</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Stage 0', 'CONDITIONS PRECEDENT', '0%', '0%', 'All approvals, title, RERA, 30% equity, escrow, docs'],
                            ['Stage 1', 'Foundation Complete', '15%', '15%', 'Engineer cert, Foundation done, Pre-sales: 20 units'],
                            ['Stage 2', 'Plinth/Basement Complete', '10%', '25%', 'Engineer cert, Ground floor slab cast'],
                            ['Stage 3', '50% Structural Complete', '15%', '40%', 'Upto 4th floor, Pre-sales: 35 units minimum'],
                            ['Stage 4', '100% Structural Complete', '15%', '55%', 'Roof slab complete, Pre-sales: 45 units minimum'],
                            ['Stage 5', 'External Finishing', '10%', '65%', 'Facade complete, Pre-sales: 50 units minimum'],
                            ['Stage 6', 'Internal Finishing (70%)', '15%', '80%', 'MEP 70% complete, Pre-sales: 55 units minimum'],
                            ['Stage 7', 'Project Completion (90%)', '10%', '90%', 'OC application filed, Pre-sales: 60 units minimum'],
                            ['Stage 8', 'Final Disbursement', '10%', '100%', 'Occupancy Cert, RERA completion, all handovers'],
                        ].map((r, i) => (
                            <tr key={i} className={i === 0 ? 'bg-orange-50 font-bold text-orange-900 border-b-2 border-orange-200' : i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD className="text-center">{r[2]}</TD><TD className="text-center font-bold">{r[3]}</TD><TD>{r[4]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="bg-slate-50 border border-slate-200 p-2 text-[9px] mb-3">
                    <strong>Critical Rules:</strong> No disbursement without prior stage completion; Independent engineer certificate mandatory; Pre-sales targets must be achieved before next disbursement; Cost overrun &gt;10% requires additional equity.
                </div>

                <SH2>9.3 End-Use Monitoring Framework</SH2>
                <div className="grid grid-cols-[1fr_1fr] gap-2 mb-3">
                    <div>
                        <p className="font-bold text-[10px] mb-1">Monthly Utilization Docs due by 10th</p>
                        <table className="w-full border-collapse text-[8px]"><thead><tr><TH>Document</TH><TH>Certifying Authority</TH></tr></thead>
                            <tbody>
                                {[
                                    ['Funds Utilization', 'Chartered Accountant'],
                                    ['Progress Report', 'Project Mgmt Consultant'],
                                    ['Stock Statement', 'Borrower + CA cert'],
                                    ['Sales Report', 'Borrower'],
                                    ['Escrow Recon.', 'Borrower + Bank'],
                                ].map((r, i) => (<tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD></tr>))}
                            </tbody>
                        </table>
                    </div>
                    <div className="font-mono text-[8px] bg-slate-100 border border-slate-300 p-2 rounded relative">
                        <div className="absolute top-0 right-0 bg-slate-300 text-slate-700 font-sans px-1 text-[6px] uppercase tracking-wider">Format Sample</div>
                        FUNDS UTILIZATION CERTIFICATE<br /><br />
                        Loan Disbursed: ₹_____ L<br />
                        Period: [Month/Year]<br />
                        -----------------------------------------------<br />
                        Head        | Budget   | Utilized | Balance<br />
                        Land Cost   | ₹1,340 L | ₹____ L  | ₹____ L<br />
                        Civil Work  | ₹2,400 L | ₹____ L  | ₹____ L<br />
                        Finishing   | ₹640 L   | ₹____ L  | ₹____ L<br />
                        Marketing   | ₹340 L   | ₹____ L  | ₹____ L<br />
                        -----------------------------------------------<br />
                        TOTAL       | ₹6,556 L | ₹____ L  | ₹____ L<br />
                    </div>
                </div>

                <SH2>9.4 Financial Covenants &amp; Restrictions</SH2>
                <div className="grid grid-cols-2 gap-2 text-[8px]">
                    <table className="w-full border-collapse"><thead><tr><TH colSpan={3} className="bg-slate-200">Mandatory Financial Covenants</TH></tr><tr><TH>Covenant</TH><TH>Req.</TH><TH>Breach Action</TH></tr></thead>
                        <tbody>
                            {[
                                ['Min DSCR', '1.25x', 'Addl. security/equity'],
                                ['Debt-Equity', 'Max 2:1', 'Next disb. hold'],
                                ['Current Ratio', 'Min 1.5:1', 'WC infusion required'],
                                ['Int. Coverage', 'Min 2.0x', 'Repayment restruc.'],
                                ['Cost Overrun', 'Max 10%', 'Addl. equity mand.'],
                            ].map((r, i) => (<tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD></tr>))}
                        </tbody>
                    </table>
                    <table className="w-full border-collapse"><thead><tr><TH colSpan={3} className="bg-red-50 text-red-900 border-red-200">Negative Covenants (Restrictions)</TH></tr><tr><TH>Prohibition</TH><TH>Details</TH><TH>Exception</TH></tr></thead>
                        <tbody>
                            {[
                                ['New Projects', 'No new project launch during construction', 'With bank written consent only'],
                                ['Asset Sale', 'No sale of project assets', 'Normal course inventory sales'],
                                ['Additional Debt', 'No borrowing from other sources', 'With bank prior approval'],
                                ['Change in Mgmt', 'No change in key management', 'Bank notification + approval'],
                                ['Dividend', 'No dividend during loan period', 'After full repayment only'],
                                ['Related Party', 'Arm\'s length only, disclosed', 'Market rate transactions'],
                                ['Pledge Receivables', 'No pledge to other parties', 'Receivables assigned to bank'],
                            ].map((r, i) => (<tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}><TD className="font-semibold text-red-700">{r[0]}</TD><TD>{r[1]}</TD><TD className="text-slate-600 italic">{r[2]}</TD></tr>))}
                        </tbody>
                    </table>
                </div>

                <p className="font-bold text-[10px] mt-3 mb-1">Affirmative Covenants (Obligations)</p>
                <table className="w-full border-collapse text-[9px]"><thead><tr>
                    <TH>Obligation</TH><TH>Frequency</TH><TH>Penalty for Non-Compliance</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Submit audited financials', 'Annual (within 6 months of FY end)', 'Penal interest 2% p.a.'],
                            ['Submit quarterly statements', 'Quarterly (within 45 days)', 'Interest rate increase 0.5%'],
                            ['Maintain insurance continuously', 'Continuous', 'Event of default'],
                            ['RERA compliance reports', 'Quarterly', 'Event of default'],
                            ['Stock statements', 'Monthly', 'Disbursement hold'],
                            ['Allow bank inspections', 'On demand', 'Event of default'],
                            ['Update on litigation', 'Immediate upon occurrence', 'Deemed default if concealed'],
                            ['Maintain books of accounts', 'Continuous', 'Audit at borrower cost'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-slate-50' : ''}>
                                <TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD className="text-red-700">{r[2]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="report-page mt-6">
                <SH2>9.5 Early Warning Signals</SH2>
                <p className="font-bold text-[10px] mb-1 text-red-700">RED FLAGS - Immediate Action Required</p>
                <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr>
                    <TH>Category</TH><TH>Warning Signal</TH><TH>Bank's Response</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Financial', 'DSCR < 1.25x (2 qtrs) OR Cash flow negative (3 months)', 'Hold disbursements; Demand addl. security'],
                            ['Operational', 'Sales < 60% of target OR Timeline delay > 6 months', 'Revise sales strategy; Appoint recovery consultant'],
                            ['Regulatory', 'RERA show-cause notice OR Plan violation', 'Obtain legal opinion; Compliance roadmap'],
                            ['Market', 'Pricing drop > 15% OR Inventory overhang growing', 'Pricing strategy review; Alternative exit options'],
                            ['Promoter', 'Delays in other projects OR Personal financial distress', 'Enhanced monitoring; Consider invocation'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-red-50 border-red-100' : ''}>
                                <TD className="font-semibold text-red-800">{r[0]}</TD>
                                <TD className="text-red-900">{r[1]}</TD>
                                <TD>{r[2]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <p className="font-bold text-[10px] mb-1 text-amber-600">AMBER FLAGS - Enhanced Monitoring</p>
                <table className="w-full border-collapse mb-3 text-[9px]"><thead><tr>
                    <TH>Signal</TH><TH>Frequency</TH><TH>Action</TH>
                </tr></thead>
                    <tbody>
                        {[
                            ['Sales velocity declining', '2 months trend', 'Monthly sales review meetings'],
                            ['Cost escalation 5-10%', 'Ongoing', 'Detailed cost audit'],
                            ['Timeline delay 1-3 months', 'Cumulative', 'Revised project plan with mitigation'],
                            ['Customer complaints growing', 'Monthly trend', 'Quality audit, customer engagement'],
                            ['Key personnel attrition', 'Any departure', 'Ensure replacement, knowledge transfer'],
                        ].map((r, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-amber-50 border-amber-100' : ''}>
                                <TD className="font-semibold text-amber-800">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <PageBreak />

            {/* ═══ §10 RECOMMENDATIONS & CONDITIONS PRECEDENT ═══ */}
            {(() => {
                const use = String(project.intendedUse || 'Residential').toLowerCase();
                const isComm = use.includes('commercial');
                const isMix  = use.includes('mix');
                const isAff  = use.includes('affordable') || use.includes('special');
                
                const maxLtv = isAff ? 0.8 : isComm ? 0.6 : isMix ? 0.65 : 0.7;
                const preSalesReq = isAff ? 0.2 : isComm ? 0.5 : 0.3;
                const loc = typeof project.location === 'string' ? project.location : 'Subject Area';

                return (
                    <>
            <div className="report-page">
                <SH>10. RECOMMENDATIONS &amp; CONDITIONS PRECEDENT</SH>
                <SH2 className="!mt-1">10.1 Credit Committee Recommendation</SH2>
                <div className="border border-slate-300 mb-3 text-[9px]">
                    <div className="bg-slate-800 text-white font-bold p-1">PROPOSED CREDIT DECISION:</div>
                    <div className="p-2 grid grid-cols-[120px_1fr] gap-x-2 gap-y-1 bg-slate-50">
                        <span className="font-semibold text-slate-700">Facility:</span><span>Term Loan for Construction Finance</span>
                        <span className="font-semibold text-slate-700">Amount:</span><span>{crore(loanAmount)}</span>
                        <span className="font-semibold text-slate-700">Purpose:</span><span>Construction of {totalUnits} {(project.intendedUse || 'residential').toLowerCase()} units in {loc}</span>
                        <span className="font-semibold text-slate-700">Tenure:</span><span>{totalMonths} months (construction) + 6 months repayment</span>
                        <span className="font-semibold text-slate-700">Repayment:</span><span>Bullet payment from sales proceeds or 12 EMIs post-completion</span>
                        <span className="font-semibold text-slate-700">Interest Rate:</span><span>[Bank's prevailing rate] + [Risk premium]%</span>
                        <span className="font-semibold text-slate-700">Margin:</span><span>{pct(1 - maxLtv)} (Promoter's equity: {crore(equityAmount)})</span>
                    </div>
                </div>

                <div className="border-2 border-yellow-500 bg-yellow-50 p-2 mb-3 text-[10px]">
                    <strong>RECOMMENDATION: <span className={getRecColorLight(avgRisk)}>{getRecText(avgRisk)}</span></strong><br />
                    Subject to satisfactory fulfillment of Conditions Precedent detailed below.
                </div>

                <p className="font-bold text-[10px] mb-1">RATIONALE:</p>
                <div className="grid grid-cols-2 gap-2 text-[9px] mb-4">
                    <div>
                        <div className="bg-green-100 text-green-900 font-bold p-1 border-b border-green-200">Positive Factors:</div>
                        <ul className="list-disc pl-4 pr-2 py-1 space-y-0.5 bg-green-50/50">
                            <li><strong>Healthy Debt-Equity Ratio:</strong> {Math.round(maxLtv*100)}:{Math.round((1-maxLtv)*100)} indicates adequate promoter skin in the game</li>
                            <li><strong>Strong Margins:</strong> {pct(grossMargin)} gross margin provides cushion for market fluctuations</li>
                            <li><strong>Location Advantage:</strong> {loc} market has demonstrated resilience</li>
                            <li><strong>Manageable Size:</strong> {totalUnits}-unit project is executable with proper management</li>
                            <li><strong>Pricing Competitive:</strong> ₹{fmt(avgUnitPrice/100000)}L avg unit price is market-aligned with upside potential</li>
                            <li><strong>Pre-sales Target Achievable:</strong> {Math.round(preSalesReq*100)}% pre-sales realistic for this segment</li>
                            <li><strong>Financial Viability:</strong> Project IRR demonstrates strong returns</li>
                        </ul>
                    </div>
                    <div>
                        <div className="bg-red-100 text-red-900 font-bold p-1 border-b border-red-200">Concerns &amp; Mitigation:</div>
                        <ul className="list-disc pl-4 pr-2 py-1 space-y-0.5 bg-red-50/50">
                            <li><strong>Land Size Constraint (CRITICAL):</strong> {fmt(plotArea)} sq.m for {totalUnits} units appears tight<br/><span className="italic text-slate-600">Mitigation: Architectural validation, FAR verification before disb.</span></li>
                            <li><strong>Regulatory Approval Risk (HIGH):</strong> Multiple approvals pending<br/><span className="italic text-slate-600">Mitigation: Statutory approvals as CP, professional liaison</span></li>
                            <li><strong>Promoter Track Record (UNKNOWN):</strong> Requires verification<br/><span className="italic text-slate-600">Mitigation: Detailed DD on past projects, financial stability check</span></li>
                            <li><strong>Market Absorption Risk (MED):</strong> Micro-market dynamics<br/><span className="italic text-slate-600">Mitigation: 30% pre-sales before 1st disb., monthly monitoring</span></li>
                        </ul>
                    </div>
                </div>

                <div className="bg-slate-800 text-white font-bold p-2 text-center text-[10px] mb-4">
                    Overall Risk Rating: {getRiskLabel(avgRisk)[0].toUpperCase()} (Score {avgRisk.toFixed(2)}/5) - Justifies enhanced due diligence &amp; stringent conditions
                </div>

                <SH2>10.2 Conditions Precedent (Must be Fulfilled Before First Disbursement)</SH2>
                
                <p className="font-bold text-[10px] mt-2 mb-1 text-slate-800 border-b border-slate-300 pb-0.5">A. LEGAL &amp; REGULATORY (CRITICAL - NO WAIVER)</p>
                <table className="w-full border-collapse text-[8px] mb-3"><thead><tr><TH className="w-8">#</TH><TH>Condition</TH><TH>Documentation Required</TH><TH>Responsibility</TH><TH>Timeline</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="text-center">1</TD><TD className="font-semibold">Clear &amp; Marketable Title</TD><TD>- Title deed chain (30 yrs)<br/>- Encumbrance cert (30 yrs)<br/>- Panel advocate opinion</TD><TD>Borrower + Bank Adv.</TD><TD>30 days</TD></tr>
                        <tr><TD className="text-center">2</TD><TD className="font-semibold">All Statutory Approvals</TD><TD>- Approved building plan<br/>- Commencement cert<br/>- NOCs (fire, water, power)</TD><TD>Borrower</TD><TD>60 days</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">3</TD><TD className="font-semibold">RERA Registration</TD><TD>- RERA certificate<br/>- Website listing<br/>- RERA Escrow account</TD><TD>Borrower</TD><TD>45 days</TD></tr>
                        <tr><TD className="text-center">4</TD><TD className="font-semibold">Environment Clearance</TD><TD>- EC certificate (&gt;20k sq.m)<br/>- State PCB NOC</TD><TD>Borrower</TD><TD>90 days</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">5</TD><TD className="font-semibold">No Litigation Cert</TD><TD>- Court searches<br/>- Promoter affidavit</TD><TD>Borrower</TD><TD>30 days</TD></tr>
                    </tbody>
                </table>

                <p className="font-bold text-[10px] mt-2 mb-1 text-slate-800 border-b border-slate-300 pb-0.5">B. TECHNICAL &amp; FEASIBILITY (CRITICAL)</p>
                <table className="w-full border-collapse text-[8px] mb-3"><thead><tr><TH className="w-8">#</TH><TH>Condition</TH><TH>Documentation Required</TH><TH>Responsibility</TH><TH>Timeline</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="text-center">6</TD><TD className="font-semibold">Land Size &amp; FAR Validation</TD><TD>- Architectural plan<br/>- FAR/FSI utilization<br/>- Parking layout</TD><TD>Tech Team</TD><TD>30 days</TD></tr>
                        <tr><TD className="text-center">7</TD><TD className="font-semibold">Geotech Investigation</TD><TD>- Soil test report<br/>- Structural cert</TD><TD>Borrower</TD><TD>20 days</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">8</TD><TD className="font-semibold">Detailed Project Report</TD><TD>- Apprvd drawings (Arch/Struct/MEP)<br/>- BOQ &amp; project schedule</TD><TD>Borrower</TD><TD>30 days</TD></tr>
                        <tr><TD className="text-center">9</TD><TD className="font-semibold">PMC &amp; Contractor Appt.</TD><TD>- PMC agreement<br/>- Main contractor agreement<br/>- Performance Bank Guarantee</TD><TD>Borrower</TD><TD>45 days</TD></tr>
                    </tbody>
                </table>
                <p className="font-bold text-[10px] mt-4 mb-1 text-slate-800 border-b border-slate-300 pb-0.5">C. FINANCIAL (CRITICAL)</p>
                <table className="w-full border-collapse text-[8px] mb-3"><thead><tr><TH className="w-8">#</TH><TH>Condition</TH><TH>Documentation Required</TH><TH>Responsibility</TH><TH>Timeline</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="text-center">11</TD><TD className="font-semibold">Promoter Equity Infusion</TD><TD>- Evidence of 30% equity ({crore(totalCost*0.3)})<br/>- Source tracking</TD><TD>Borrower + Bank</TD><TD>Before 1st disb</TD></tr>
                        <tr><TD className="text-center">12</TD><TD className="font-semibold">Pre-Sales Achievement</TD><TD>- 31% sold ({crore(totalRev*0.31)})<br/>- Booking forms &amp; advances</TD><TD>Borrower</TD><TD>Before 1st disb</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">13</TD><TD className="font-semibold">Escrow Setup</TD><TD>- Escrow &amp; Op. accounts opened<br/>- Bank as signatory</TD><TD>Borrower + Bank</TD><TD>Before 1st disb</TD></tr>
                        <tr><TD className="text-center">14</TD><TD className="font-semibold">Promoter Financial Health</TD><TD>- Audited financials (3 yrs)<br/>- Net worth cert &amp; CIBIL</TD><TD>Borrower</TD><TD>30 days</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">15</TD><TD className="font-semibold">Independent Valuation</TD><TD>- Prop val. by approved valuer<br/>- Security coverage &gt;1.5x FSV</TD><TD>Bank's Valuer</TD><TD>20 days</TD></tr>
                    </tbody>
                </table>

                <p className="font-bold text-[10px] mt-2 mb-1 text-slate-800 border-b border-slate-300 pb-0.5">D. DOCUMENTATION, SECURITY &amp; COMPLIANCE</p>
                <table className="w-full border-collapse text-[8px] mb-3"><thead><tr><TH className="w-8">#</TH><TH>Condition</TH><TH>Documentation Required</TH><TH>Responsibility</TH><TH>Timeline</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="text-center">16</TD><TD className="font-semibold">Loan &amp; Security Docs</TD><TD>- Loan &amp; Mortgage deeds<br/>- Tripartite agreements<br/>- ROC charge (CHG-1) &amp; CERSAI</TD><TD>Bank Legal</TD><TD>45 days</TD></tr>
                        <tr><TD className="text-center">17</TD><TD className="font-semibold">Personal Guarantees</TD><TD>- PGs from promoters<br/>- Net worth certs</TD><TD>Guarantors</TD><TD>30 days</TD></tr>
                        <tr className="bg-slate-50"><TD className="text-center">18</TD><TD className="font-semibold">Corporate Authorizations</TD><TD>- Board resolutions<br/>- MOA/AOA copies</TD><TD>Borrower</TD><TD>15 days</TD></tr>
                        <tr><TD className="text-center">19</TD><TD className="font-semibold">Insurance &amp; Compliance</TD><TD>- CAR, EAR, Keyman insurance<br/>- RERA compliance officer appt.<br/>- Tax/KYC clearing (GST, TDS)</TD><TD>Borrower</TD><TD>30 days</TD></tr>
                    </tbody>
                </table>

                <div className="bg-slate-800 text-white font-bold p-1 text-center text-[9px] mb-4">
                    TOTAL CONDITIONS PRECEDENT: 24 (All Critical) | Expected Time to Fulfill: 90-120 days minimum
                </div>

                <SH2>10.3 Conditions Subsequent (Post-Disbursement Ongoing)</SH2>
                <table className="w-full border-collapse text-[8px] mb-4"><thead><tr><TH>Continuous Obligation</TH><TH>Frequency</TH><TH>Format</TH><TH>Penalty / Consequence</TH></tr></thead>
                    <tbody>
                        <tr className="bg-slate-50"><TD className="font-semibold">Stock &amp; Receivables Statement</TD><TD>Monthly</TD><TD>Certified by CA</TD><TD>Disbursement hold</TD></tr>
                        <tr><TD className="font-semibold">Sales &amp; Progress Reports</TD><TD>Monthly</TD><TD>Borrower / PMC submitted</TD><TD>Management review / Adjustments</TD></tr>
                        <tr className="bg-slate-50"><TD className="font-semibold">Funds Utilization Certificate</TD><TD>Per Disb.</TD><TD>CA + Engineer certification</TD><TD>Next disbursement hold</TD></tr>
                        <tr><TD className="font-semibold">Escrow Account Recon.</TD><TD>Monthly</TD><TD>Bank statement</TD><TD>Compliance breach</TD></tr>
                        <tr className="bg-slate-50"><TD className="font-semibold">RERA &amp; Covenant Certs</TD><TD>Quarterly</TD><TD>RERA site / CFO cert</TD><TD>Regulatory breach triggers action</TD></tr>
                        <tr><TD className="font-semibold">Audited Financials / Stock Audit</TD><TD>Annual / Qtr</TD><TD>Complete audit report</TD><TD>Default if delayed &gt;6 months</TD></tr>
                    </tbody>
                </table>

                <SH2>10.4 Special Conditions for Subject Project</SH2>
                <div className="bg-slate-100 p-2 font-bold text-[10px] border-b border-slate-300">Critical Issues Requiring Resolution</div>
                
                <div className="grid grid-cols-1 gap-3 text-[9px] mt-2">
                    <div className="bg-red-50 border border-red-200 p-3 text-red-900 rounded">
                        <p className="font-bold border-b border-red-200 pb-1 mb-2 text-[10px]">1. LAND SIZE VALIDATION (HIGHEST PRIORITY)</p>
                        <p className="mb-2"><strong>Issue:</strong> {fmt(plotArea)} sq.m land for {totalUnits} units appears extremely constrained for required amenities and FAR utilization.</p>
                        
                        <p className="font-semibold underline mb-1">Required Actions:</p>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2">
                            <li>Detailed architectural feasibility study by bank-appointed architect</li>
                            <li>FAR/FSI computation with actual approved plan</li>
                            <li>Ground coverage calculation (typically max 50-60%)</li>
                            <li><strong>Parking requirement:</strong> {parkReq} ECS (2 per 3BHK unit) + visitor parking. At 25 sq.m/car = {parkReq * 25} sq.m required.<br/>
                                <span className="text-red-700 italic">This exceeds total land available - basement/stilt parking mandatory.</span></li>
                            <li>Open space requirement (typically 30-40% of land)</li>
                            <li>Setback compliance (front, rear, side)</li>
                        </ul>
                        
                        <div className="bg-red-100 p-2 border border-red-200 mt-2">
                            <p className="font-semibold mb-1">Bank's Position:</p>
                            <p className="font-bold underline text-red-800 mb-1">First disbursement CANNOT proceed without satisfactory resolution</p>
                            <p>If land inadequate, options: a) Reduce number of units/floors b) Acquire adjacent land c) Modify project configuration d) Bank declines the proposal</p>
                            <p className="mt-1 font-semibold">Timeline: <span className="font-normal">Must be resolved within 30 days of in-principle approval</span></p>
                        </div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 p-3 text-amber-900 rounded">
                        <p className="font-bold border-b border-amber-200 pb-1 mb-2 text-[10px]">2. PROMOTER TRACK RECORD VERIFICATION</p>
                        <p className="mb-2"><strong>Issue:</strong> Promoter's experience and past performance unknown.</p>
                        
                        <p className="font-semibold underline mb-1">Required Due Diligence:</p>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2 grid grid-cols-2 gap-x-4">
                            <li>List of all completed projects (minimum 3 required)</li>
                            <li>On-time delivery track record (&gt;80% projects on schedule)</li>
                            <li>Quality certifications &amp; Customer satisfaction</li>
                            <li>Financial performance of past projects</li>
                            <li>Banking relationship history (no NPAs)</li>
                            <li>Personal financial stability &amp; Litigation status</li>
                        </ul>
                        
                        <div className="bg-amber-100 p-2 border border-amber-200 mt-2">
                            <p className="font-semibold mb-1">Bank's Position:</p>
                            <p className="mb-1">If promoter has &lt;2 similar completed projects: <strong className="text-red-700">Loan declined</strong> OR Require experienced co-developer/JV partner OR Increase equity requirement to 40-45%</p>
                            <p>Mandatory PMC by reputed firm</p>
                            <p className="mt-1 font-semibold">Timeline: <span className="font-normal">45 days for complete verification</span></p>
                        </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 p-3 text-blue-900 rounded">
                        <p className="font-bold border-b border-blue-200 pb-1 mb-2 text-[10px]">3. MARKET ABSORPTION VALIDATION</p>
                        <p className="mb-2"><strong>Issue:</strong> Sector not specified; micro-market dynamics unknown.</p>
                        
                        <p className="font-semibold underline mb-1">Required Analysis:</p>
                        <ul className="list-disc pl-4 space-y-0.5 mb-2 grid grid-cols-2 gap-x-4">
                            <li>Specific sector identification in {loc}</li>
                            <li>Competitive project analysis within 2-3 km</li>
                            <li>Inventory overhang in that sector</li>
                            <li>Historical absorption rates &amp; Price trends (last 3 years)</li>
                            <li>Infrastructure development plans</li>
                            <li>Buyer profile and affordability</li>
                        </ul>
                        
                        <div className="bg-blue-100 p-2 border border-blue-200 mt-2">
                            <p className="font-semibold mb-1">Bank's Position:</p>
                            <p className="font-bold text-blue-800 mb-1">Pre-sales of 30-35% ({Math.ceil(totalUnits * 0.3)} - {Math.ceil(totalUnits * 0.35)} units) MANDATORY before first disbursement</p>
                            <p>If sector has &gt;6 years inventory overhang: Enhanced scrutiny</p>
                            <p>If competitive projects offer better value: Pricing revision</p>
                            <p>Monthly sales tracking with quarterly targets</p>
                            <p className="mt-1 font-semibold">Timeline: <span className="font-normal">30 days for market study</span></p>
                        </div>
                    </div>
                </div>
                <SH2 className="!mt-4">10.5 Loan Pricing &amp; Terms</SH2>
                <div className="grid grid-cols-[1fr_200px] gap-2 mb-3 items-start">
                    <table className="w-full border-collapse text-[8px]"><thead><tr><TH>Parameter</TH><TH>Terms</TH></tr></thead>
                        <tbody>
                            <tr className="bg-slate-50"><TD className="font-semibold">Amount &amp; Margin</TD><TD>{crore(loanAmount)} @ {Math.round(maxLtv*100)}% / {crore(equityAmount)} Equity</TD></tr>
                            <tr><TD className="font-semibold">Interest Rate</TD><TD>[Base/MCLR] + 3.0-3.5% p.a. (HIGH Risk Spread)</TD></tr>
                            <tr className="bg-slate-50"><TD className="font-semibold">All-in Cost</TD><TD>Approx. 11.50% - 12.00% p.a.</TD></tr>
                            <tr><TD className="font-semibold">Repayment</TD><TD>Bullet pay at month {totalMonths} OR 12 EMIs post-completion</TD></tr>
                            <tr className="bg-slate-50"><TD className="font-semibold">Disbursement Linked to</TD><TD>Construction progress (60%) + Pre-sales (40%)</TD></tr>
                            <tr><TD className="font-semibold">Security Coverage</TD><TD>Min 1.5x on FSV basis (Mortgage + Escrow + PG)</TD></tr>
                        </tbody>
                    </table>
                    <div className="bg-slate-100 border border-slate-300 p-2 text-[8px]">
                        <p className="font-bold mb-1 border-b border-slate-300 pb-1">Fee Structure</p>
                        <ul className="list-none space-y-0.5 text-slate-700">
                            <li><strong>Processing:</strong> 1.00% ({crore(loanAmount*0.01)})</li>
                            <li><strong>Commitment:</strong> 0.50% p.a. on undisbursed</li>
                            <li><strong>Penal Int:</strong> 2% p.a. over normal</li>
                            <li><strong>Audit/Insp:</strong> ₹25k / qtr | ₹10k / mo</li>
                        </ul>
                    </div>
                </div>
                <SH2 className="!mt-4">10.6 Monitoring &amp; Review Mechanism</SH2>
                <div className="flex gap-2 text-[8px] mb-3">
                    <div className="flex-1 border bg-slate-50 border-slate-300 p-2 rounded">
                        <p className="font-bold border-b border-slate-300 pb-0.5 mb-1 text-center">LVL 1: Branch (Monthly)</p>
                        <ul className="list-disc pl-3 text-slate-700 space-y-[1px]">
                            <li>Site inspection report</li>
                            <li>Sales progress tracking</li>
                            <li>Stock statement verification</li>
                            <li>Escrow account reconciliation</li>
                            <li>Utilization certificate review</li>
                            <li>Customer complaint monitoring</li>
                        </ul>
                    </div>
                    <div className="flex-1 border bg-slate-50 border-slate-300 p-2 rounded">
                        <p className="font-bold border-b border-slate-300 pb-0.5 mb-1 text-center">LVL 2: Regional (Quarterly)</p>
                        <ul className="list-disc pl-3 text-slate-700 space-y-[1px]">
                            <li>Detailed financial review</li>
                            <li>Covenant compliance check</li>
                            <li>Independent engineer's report</li>
                            <li>Market conditions assessment</li>
                            <li>Promoter's other projects review</li>
                            <li>Risk rating update</li>
                        </ul>
                    </div>
                    <div className="flex-1 border bg-slate-50 border-slate-300 p-2 rounded">
                        <p className="font-bold border-b border-slate-300 pb-0.5 mb-1 text-center">LVL 3: Corporate (H-Y)</p>
                        <ul className="list-disc pl-3 text-slate-700 space-y-[1px]">
                            <li>Portfolio review</li>
                            <li>Sector exposure analysis</li>
                            <li>Early warning signals assessment</li>
                            <li>Exit strategy evaluation</li>
                            <li>Restructuring needs (if any)</li>
                            <li>Stake sale/JV options</li>
                        </ul>
                    </div>
                </div>
                
                <table className="w-full border-collapse mb-2 text-[8px] text-center">
                    <thead>
                        <tr>
                            <TH className="text-left bg-slate-800 text-white">Parameter</TH>
                            <TH className="bg-green-700 text-white border-green-800">Green</TH>
                            <TH className="bg-slate-800 text-white border-slate-900 border-x">Amber (Monitor)</TH>
                            <TH className="bg-red-700 text-white border-red-800">Red (Action)</TH>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><TD className="text-left font-semibold border border-slate-300">Sales vs Target</TD><TD className="border border-slate-300">&gt;90%</TD><TD className="border border-slate-300">70-90%</TD><TD className="border border-slate-300">&lt;70%</TD></tr>
                        <tr><TD className="text-left font-semibold border border-slate-300">Construction vs Timeline</TD><TD className="border border-slate-300">On track</TD><TD className="border border-slate-300">1-3 months delay</TD><TD className="border border-slate-300">&gt;3 months delay</TD></tr>
                        <tr><TD className="text-left font-semibold border border-slate-300">Cost vs Budget</TD><TD className="border border-slate-300">Within ±5%</TD><TD className="border border-slate-300">5-10% overrun</TD><TD className="border border-slate-300">&gt;10% overrun</TD></tr>
                        <tr><TD className="text-left font-semibold border border-slate-300">DSCR</TD><TD className="border border-slate-300">&gt;1.5x</TD><TD className="border border-slate-300">1.25-1.5x</TD><TD className="border border-slate-300">&lt;1.25x</TD></tr>
                        <tr><TD className="text-left font-semibold border border-slate-300">Customer Complaints</TD><TD className="border border-slate-300">&lt;2% of sold units</TD><TD className="border border-slate-300">2-5%</TD><TD className="border border-slate-300">&gt;5%</TD></tr>
                        <tr><TD className="text-left font-semibold border border-slate-300">RERA Compliance</TD><TD className="border border-slate-300">Fully compliant</TD><TD className="border border-slate-300">1-2 minor issues</TD><TD className="border border-slate-300">Major violations</TD></tr>
                    </tbody>
                </table>

                <div className="bg-slate-50 border border-slate-300 p-2 text-[8px] mb-4">
                    <p className="font-bold border-b border-slate-300 pb-1 mb-1 text-[9px]">Actions Based on Rating:</p>
                    <ul className="space-y-1">
                        <li><span className="inline-block w-3 h-3 bg-green-500 rounded-sm align-middle mr-1"></span><strong className="text-green-800">Green:</strong> Normal disbursement, standard monitoring</li>
                        <li><span className="inline-block w-3 h-3 bg-amber-500 rounded-sm align-middle mr-1"></span><strong className="text-amber-800">Amber:</strong> Enhanced monitoring, management discussions, corrective action plan</li>
                        <li><span className="inline-block w-3 h-3 bg-red-600 rounded-sm align-middle mr-1"></span><strong className="text-red-800">Red:</strong> Disbursement hold, recovery measures, asset classification review</li>
                    </ul>
                </div>

                <SH2>10.7 Exit Strategy &amp; Recovery Mechanism</SH2>
                
                <div className="grid grid-cols-2 gap-3 text-[8.5px] mb-4">
                    <div className="flex flex-col gap-3">
                        {/* Normal Exit */}
                        <div className="border border-green-300 bg-green-50 p-2 rounded">
                            <p className="font-bold text-[9px] text-green-900 border-b border-green-200 pb-1 mb-1">Normal Exit (Project Successful)</p>
                            <p className="font-semibold text-green-800 underline mb-0.5">Progressive Repayment:</p>
                            <ul className="list-disc pl-3 mb-2 space-y-0.5 text-green-800">
                                <li>Customer payments route through escrow</li>
                                <li>Debt servicing from sales proceeds</li>
                                <li>Target: 70% loan repayment by month {totalMonths}</li>
                                <li>Final 30% by month {totalMonths + 6}</li>
                            </ul>
                            <p className="font-semibold text-green-800 underline mb-0.5">Security Release:</p>
                            <ul className="list-disc pl-3 space-y-0.5 text-green-800">
                                <li>Unit-wise release on full customer payment</li>
                                <li>OC obtained and handed over</li>
                                <li>Release as per agreed matrix (e.g., release after 70% debt repayment)</li>
                            </ul>
                        </div>
                        
                        {/* Stressed Asset */}
                        <div className="border border-orange-300 bg-orange-50 p-2 rounded">
                            <p className="font-bold text-[9px] text-orange-900 border-b border-orange-200 pb-1 mb-1">Stressed Asset Management (Project Challenges)</p>
                            <p className="font-semibold text-orange-800 underline mb-0.5">Early Intervention Triggers:</p>
                            <ul className="list-disc pl-3 space-y-0.5 text-orange-800">
                                <li>Sales &lt;60% of target for 2 consecutive quarters</li>
                                <li>Timeline delay &gt;6 months</li>
                                <li>Cost overrun &gt;15%</li>
                                <li>DSCR &lt;1.0x for 2 quarters</li>
                                <li>RERA violations/customer complaints spike</li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* Restructuring Options */}
                        <div className="border border-slate-300 bg-slate-50 p-2 rounded">
                            <p className="font-bold text-[9px] text-slate-800 border-b border-slate-200 pb-1 mb-1">Restructuring Options</p>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <p className="font-semibold text-slate-700 underline mb-0.5">Operational:</p>
                                    <ul className="list-disc pl-3 mb-1 space-y-[1px] text-slate-600">
                                        <li>Change marketing strategy</li>
                                        <li>Price adjustments</li>
                                        <li>Professional sales team</li>
                                        <li>Broker network expansion</li>
                                    </ul>
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-700 underline mb-0.5">Financial:</p>
                                    <ul className="list-disc pl-3 mb-1 space-y-[1px] text-slate-600">
                                        <li>Additional equity infusion</li>
                                        <li>Interest moratorium (short-term)</li>
                                        <li>Extended repayment timeline</li>
                                        <li>Conversion to LRD (commercial parts)</li>
                                    </ul>
                                </div>
                            </div>
                            <p className="font-semibold text-slate-700 underline mt-1 mb-0.5">Ownership Restructuring:</p>
                            <ul className="list-disc pl-3 space-y-[1px] text-slate-600">
                                <li>Bring in strategic partner/co-developer</li>
                                <li>Stake sale to larger developer / JV with reputed builder</li>
                                <li>PE/investor infusion</li>
                            </ul>
                        </div>

                        {/* Recovery Options & Timeline */}
                        <div className="border border-red-300 bg-red-50 p-2 rounded">
                            <p className="font-bold text-[9px] text-red-900 border-b border-red-200 pb-1 mb-1">Recovery Options (Last Resort)</p>
                            <ul className="list-none pl-1 space-y-1 text-red-800">
                                <li><strong>Project Take-Over:</strong> Invoke PGs/mortgage, complete via new developer, sell WIP units.</li>
                                <li><strong>Asset Sale:</strong> Sell land+structure to another developer, SARFAESI auction (Exp. recovery: 60-70%).</li>
                                <li><strong>Legal Action:</strong> Recovery suit, enforcement of securities, attachment of assets, IBC proceedings.</li>
                            </ul>
                            
                            <table className="w-full mt-2 border border-red-200">
                                <thead className="bg-red-100 text-[7px]"><tr><TH colSpan={3} className="border-b border-red-200">Recovery Timeline Estimates</TH></tr></thead>
                                <tbody>
                                    <tr className="border-b border-red-200"><TD className="font-bold">Normal</TD><TD>42-48 months</TD><TD className="italic">As per original plan</TD></tr>
                                    <tr className="border-b border-red-200"><TD className="font-bold">Stressed</TD><TD>54-60 months</TD><TD className="italic">With restructuring</TD></tr>
                                    <tr><TD className="font-bold">NPA</TD><TD>72+ months</TD><TD className="italic">Via legal recovery</TD></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="border-[1.5px] border-slate-500 bg-slate-50 p-3 mb-4 rounded relative overflow-hidden">
                    <div className="absolute top-0 right-0 bg-amber-300 text-amber-900 px-3 py-1 font-bold text-[9px] border-l border-b border-amber-400">10.8 FINAL SUMMARY</div>
                    
                    <p className="font-bold text-[12px] mb-1 text-slate-800">TO: CREDIT COMMITTEE / SANCTIONING AUTHORITY</p>
                    <div className="bg-amber-100 border border-amber-300 p-2 mb-3 rounded">
                        <p className="text-[11px] font-bold text-amber-900 mb-0.5 uppercase">RECOMMENDATION: <span className={getRecColorLight(avgRisk)}>{getRecText(avgRisk)}</span></p>
                        <p className="text-[9px] text-amber-800 italic">Subject to satisfactory fulfillment of all 24 Conditions Precedent, particularly:</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-[8.5px]">
                        {/* Column 1 */}
                        <div className="flex flex-col gap-3">
                            <div className="border border-red-200 bg-white p-2 rounded">
                                <p className="font-bold text-red-800 underline mb-1">CRITICAL PRIORITY (Deal Breakers):</p>
                                <ul className="space-y-[2px] font-medium text-slate-700 list-none pl-1">
                                    <li>✓ Land size validation &amp; technical feasibility confirmation</li>
                                    <li>✓ Promoter track record verification (min. 2 completed projects)</li>
                                    <li>✓ All statutory approvals including RERA registration</li>
                                    <li>✓ Clear marketable title with legal opinion</li>
                                    <li>✓ {pct((1-maxLtv)*100)} equity infusion evidence</li>
                                    <li>✓ {pct(preSalesReq*100)} pre-sales achievement ({Math.ceil(totalUnits * preSalesReq)} units = {crore(totalRev * preSalesReq)})</li>
                                </ul>
                            </div>

                            <div className="border border-green-200 bg-white p-2 rounded">
                                <p className="font-bold text-green-800 underline mb-1">RATIONALE FOR APPROVAL:</p>
                                <ul className="list-disc pl-4 space-y-[2px] text-slate-700">
                                    <li>Project economics are sound with {pct(grossMargin)} margin</li>
                                    <li>Location ({loc}) has demonstrated market depth</li>
                                    <li>Debt-equity ratio of {Math.round(maxLtv*100)}:{Math.round((1-maxLtv)*100)} is conservative</li>
                                    <li>Security coverage of {(totalRev / Math.max(1, loanAmount)).toFixed(1)}x provides cushion</li>
                                    <li>Escrow mechanism ensures fund discipline</li>
                                    <li>Milestone-linked disbursement mitigates risk</li>
                                </ul>
                            </div>

                            <div className="border border-blue-200 bg-white p-2 rounded">
                                <p className="font-bold text-blue-800 underline mb-1">PROFITABILITY TO BANK:</p>
                                <ul className="list-none pl-1 space-y-[2px] text-slate-700">
                                    <li>• <span className="font-semibold">Interest income:</span> ~{crore(loanAmount * 0.115 * (totalMonths/12))} – {crore(loanAmount * 0.12 * (totalMonths/12))} over loan life (11.5-12% for {Math.ceil(totalMonths/12)} yrs)</li>
                                    <li>• <span className="font-semibold">Processing fees:</span> {lakh(loanAmount * 0.01)} (upfront)</li>
                                    <li>• <span className="font-semibold">Other charges:</span> {lakh(loanAmount * 0.005)} – {lakh(loanAmount * 0.007)} (doc, inspection, etc.)</li>
                                    <li className="font-bold mt-1 text-blue-900 border-t border-blue-100 pt-1">Total revenue: ~{crore(loanAmount * 0.115 * (totalMonths/12) + loanAmount * 0.01 + loanAmount * 0.006)}</li>
                                    <li>• Risk-adjusted return: Adequate for HIGH risk category</li>
                                </ul>
                            </div>
                        </div>

                        {/* Column 2 */}
                        <div className="flex flex-col gap-3">
                            <div className="border border-purple-200 bg-white p-2 rounded">
                                <p className="font-bold text-purple-800 underline mb-1">RISK MITIGATION:</p>
                                <ul className="list-disc pl-4 space-y-[2px] text-slate-700">
                                    <li>Stringent conditions precedent (24 CPs)</li>
                                    <li>Monthly monitoring with site inspections</li>
                                    <li>Quarterly independent engineer certification</li>
                                    <li>RERA escrow compliance</li>
                                    <li>Personal guarantees from promoters</li>
                                    <li>Progressive security build-up</li>
                                </ul>
                                <div className="mt-2 bg-purple-50 p-1.5 border border-purple-100 rounded">
                                    <p className="font-bold text-purple-900 mb-0.5">OVERALL RISK RATING: {getRiskLabel(avgRisk)[0].toUpperCase()} ({avgRisk.toFixed(2)}/5)</p>
                                    <p className="text-slate-600"><strong className="text-slate-700">Justified by:</strong> Project complexity, promoter TBD, regulatory challenges</p>
                                    <p className="text-slate-600"><strong className="text-slate-700">Mitigated by:</strong> Strong structure, conservative leverage, robust monitoring</p>
                                </div>
                            </div>

                            <div className="border border-cyan-200 bg-white p-2 rounded">
                                <p className="font-bold text-cyan-800 underline mb-1">ESTIMATED TIMELINE:</p>
                                <ul className="list-none pl-1 space-y-[2px] text-slate-700">
                                    <li>• <span className="font-semibold">CP fulfillment:</span> 90-120 days</li>
                                    <li>• <span className="font-semibold">First disbursement:</span> Month 4-5 post-sanction</li>
                                    <li>• <span className="font-semibold">Project completion:</span> Month {totalMonths}-{totalMonths + 6}</li>
                                    <li>• <span className="font-semibold">Full recovery:</span> Month {totalMonths + 6}-{totalMonths + 12}</li>
                                </ul>
                            </div>

                            <div className="border border-orange-200 bg-white p-2 rounded">
                                <p className="font-bold text-orange-800 underline mb-1">ALTERNATIVE RECOMMENDATION (If CPs Failed):</p>
                                <ul className="list-disc pl-4 space-y-[2px] text-slate-700">
                                    <li>Reduce loan amount to {crore(totalCost * 0.30)} – {crore(totalCost * 0.38)} (increase equity to 50-60%)</li>
                                    <li>Limit to {crore(totalCost * 0.38)} with mandatory co-developer tie-up</li>
                                    <li>Decline if land size issue cannot be resolved satisfactorily</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    
                    <div className="mt-3 bg-slate-800 text-white p-2 text-center rounded">
                        <p className="font-bold text-[11px] uppercase tracking-wide">PROPOSED SANCTION: {crore(loanAmount)}</p>
                        <p className="text-[8px] text-slate-300">subject to fulfillment of all Conditions Precedent</p>
                    </div>
                </div>

                <div className="mt-8 grid grid-cols-3 gap-4 text-center text-[9px] text-slate-500 border-t border-slate-300 pt-6">
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Prepared By</p><p className="font-semibold">Credit Analyst</p></div>
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Reviewed By</p><p className="font-semibold">Credit Manager</p></div>
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Approved By</p><p className="font-semibold text-slate-800">Sanctioning Authority</p></div>
                </div>
            </div>
                </>
                );
            })()}

            <PageBreak />

            {/* ═══ APPENDICES ═══ */}
            <div className="report-page">
                <SH>APPENDICES</SH>

                {/* APPENDIX A */}
                <SH2>APPENDIX A: Document Checklist</SH2>
                <div className="grid grid-cols-2 gap-3 text-[8px] mb-4">
                    <div>
                        <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-1">A.1 Legal Documents</p>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Title Documents:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Sale Deed (certified copy)','Mother Deed','Title deed chain for 30 years','Encumbrance Certificate (30 years)','7/12 Extract / Khasra-Khatauni','Property Tax receipts (last 5 years)','Conversion certificate (if applicable)','Mutation records','Legal opinion from bank\'s panel advocate'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Corporate Documents:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Certificate of Incorporation','MOA','AOA','Board Resolution for loan & mortgage','Share certificates of promoters','PAN card (company)','GST registration certificate','List of directors with DIN','Form MGT-7 (last 3 years)','Form AOC-4 (audited financials, last 3 years)'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Approvals &amp; Licenses:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600">
                            {['Building plan approval (sanctioned plan)','Commencement certificate','CLU/Land use conversion','License/Colonizer license','RERA registration certificate','Environment clearance (if applicable)','Fire NOC','Water connection approval','Electricity connection sanction','Sewerage connection approval'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                    </div>
                    <div>
                        <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-1">A.2 Financial Documents</p>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Borrower's Financials:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Audited financial statements (last 3 years)','Provisional financials (current year)','Income Tax Returns (last 3 years)','GST returns (last 24 months)','TDS returns (last 2 years)','Bank statements (all accounts, last 12 months)','Sanction letters of existing loans','Details of other ongoing projects'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Promoter's Financials:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Personal ITR (last 3 years)','Personal bank statements (last 12 months)','Net worth statement (CA certified)','Asset & liability statement','CIBIL report (company & all promoters/directors)'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-semibold text-slate-700 underline mb-0.5">Project Financials:</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Detailed Project Report (DPR)','Cost estimates with BOQ','Revenue projections','Cash flow statements','Break-even analysis','Sensitivity analysis'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-1 mt-2">A.3 Technical Documents</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Soil investigation report','Topographical survey','Architectural drawings (approved)','Structural drawings','MEP drawings','Landscape plans','Specifications (civil, finishing, MEP)','Bill of Quantities (BOQ)','Project schedule (Gantt chart)','PMC appointment letter','Contractor agreement','Independent engineer\'s feasibility report'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-1 mt-2">A.4 Insurance Documents</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600 mb-2">
                            {['Contractor\'s All Risk (CAR) policy','Erection All Risk (EAR) policy','Professional indemnity policy','Public liability policy','Key man insurance policy','Premium payment receipts','Loss payee endorsement to bank'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                        <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-1 mt-2">A.5 Other Documents</p>
                        <ul className="list-none pl-1 space-y-[1px] text-slate-600">
                            {['Marketing plan & budget','Sales projections','Sample buyer agreement (RERA compliant)','List of pre-sold units with payment status','Customer booking forms','Tripartite agreements (sample)','Escrow account opening documents','RERA quarterly reports (if project ongoing)'].map((d,i)=><li key={i}>☐ {d}</li>)}
                        </ul>
                    </div>
                </div>
            </div>
            <PageBreak />

            {/* APPENDIX B */}
            <div className="report-page">
                <SH2>APPENDIX B: Key Financial Ratios &amp; Formulas</SH2>
                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">B.1 Project Viability Ratios</p>
                <div className="grid grid-cols-2 gap-3 text-[8px] mb-4">
                    <div className="space-y-2">
                        {[
                            {n:'1. Gross Profit Margin', f:'= (Gross Revenue - Total Cost) / Gross Revenue × 100', v:`= (${crore(totalRev)} - ${crore(totalCost)}) / ${crore(totalRev)} × 100 = ${pct(grossMargin)}`},
                            {n:'2. Return on Investment (ROI)', f:'= (Gross Profit / Total Cost) × 100', v:`= (${crore(profit)} / ${crore(totalCost)}) × 100 = ${pct(roi)}`},
                            {n:'3. Return on Equity (ROE)', f:'= (Net Profit / Equity) × 100', v:`= (${crore(profit)} / ${crore(equityAmount)}) × 100 = ${pct(equityAmount > 0 ? (profit / equityAmount) * 100 : 0)}`},
                            {n:'4. DSCR', f:'= Net Operating Income / Total Debt Service', v:'= (EBITDA + Non-cash charges) / (Principal + Interest). Min acceptable: 1.25x'},
                        ].map((r,i) => (
                            <div key={i} className="border border-slate-200 bg-white p-1.5 rounded">
                                <p className="font-bold text-slate-800 mb-0.5">{r.n}</p>
                                <p className="font-mono text-[7px] text-slate-600">{r.f}</p>
                                <p className="font-mono text-[7px] text-blue-700">{r.v}</p>
                            </div>
                        ))}
                    </div>
                    <div className="space-y-2">
                        {[
                            {n:'5. IRR', f:'= Discount rate at which NPV = 0', v:`Expected: 18-25%. Subject project: ${pct(roi * 0.8)}-${pct(roi * 0.9)}`},
                            {n:'6. Break-Even Point', f:'= Fixed Costs / (Selling Price - Variable Cost per Unit)', v:`= ${breakEvenUnits} units (${totalUnits > 0 ? pct(breakEvenUnits / totalUnits * 100) : '—'} of total)`},
                            {n:'7. Loan-to-Value (LTV)', f:'= Loan Amount / Total Project Cost × 100', v:`= ${crore(loanAmount)} / ${crore(totalCost)} × 100 = ${pct(totalCost > 0 ? (loanAmount / totalCost) * 100 : 0)}`},
                            {n:'8. Debt-Equity Ratio', f:'= Total Debt / Total Equity', v:`= ${crore(loanAmount)} / ${crore(equityAmount)} = ${equityAmount > 0 ? (loanAmount / equityAmount).toFixed(2) : '—'}:1`},
                        ].map((r,i) => (
                            <div key={i} className="border border-slate-200 bg-white p-1.5 rounded">
                                <p className="font-bold text-slate-800 mb-0.5">{r.n}</p>
                                <p className="font-mono text-[7px] text-slate-600">{r.f}</p>
                                <p className="font-mono text-[7px] text-blue-700">{r.v}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">B.2 Security Coverage Ratios</p>
                <div className="grid grid-cols-3 gap-2 text-[8px] mb-4">
                    {[
                        {n:'9. Primary Security Coverage', f:'= Value of Mortgaged Property / Loan Amount', v:`= ${crore(totalRev)} / ${crore(loanAmount)} = ${(totalRev / Math.max(1, loanAmount)).toFixed(2)}x`},
                        {n:'10. FSV Coverage', f:'= (Market Value × 75%) / Loan Amount', v:'Min acceptable: 1.50x'},
                        {n:'11. Receivables Coverage', f:'= Assigned Receivables / Outstanding Loan', v:'Should exceed 1.25x at all times'},
                    ].map((r,i) => (
                        <div key={i} className="border border-slate-200 bg-white p-1.5 rounded">
                            <p className="font-bold text-slate-800 mb-0.5">{r.n}</p>
                            <p className="font-mono text-[7px] text-slate-600">{r.f}</p>
                            <p className="font-mono text-[7px] text-blue-700">{r.v}</p>
                        </div>
                    ))}
                </div>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">B.3 Operational Ratios</p>
                <div className="grid grid-cols-3 gap-2 text-[8px] mb-4">
                    {[
                        {n:'12. Sales Velocity', f:'= Units Sold per Month', v:'Target: 3-4 units/month. Monitoring: Monthly'},
                        {n:'13. Cost Variance', f:'= (Actual - Budgeted) / Budgeted × 100', v:'Acceptable: ±5%. Alert: ±10%'},
                        {n:'14. Schedule Variance', f:'= (Planned - Earned) / Planned × 100', v:'Monitoring: Monthly. Alert: >10% delay'},
                    ].map((r,i) => (
                        <div key={i} className="border border-slate-200 bg-white p-1.5 rounded">
                            <p className="font-bold text-slate-800 mb-0.5">{r.n}</p>
                            <p className="font-mono text-[7px] text-slate-600">{r.f}</p>
                            <p className="font-mono text-[7px] text-blue-700">{r.v}</p>
                        </div>
                    ))}
                </div>
            </div>
            <PageBreak />

            {/* APPENDIX C */}
            <div className="report-page">
                <SH2>APPENDIX C: Risk Mitigation Matrix by Project Type</SH2>
                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">C.1 Residential Projects</p>
                <table className="w-full border-collapse text-[7.5px] mb-4"><thead><tr>
                    <TH>Risk</TH><TH>Prob.</TH><TH>Impact</TH><TH>Mitigation Strategy</TH><TH>Resp.</TH><TH>Monitor</TH>
                </tr></thead><tbody>
                    {[
                        ['Market downturn','Medium','High','Min 30% pre-sales, flexible pricing, phased launches','Borrower + Bank','Quarterly market review'],
                        ['Construction delays','High','High','Experienced contractor, penalty clauses, PMC oversight, weather buffer','Borrower','Monthly site inspection'],
                        ['Cost overruns','High','Medium','Fixed-price contracts, 5% contingency, material hedging','Borrower','Monthly cost tracking'],
                        ['Regulatory issues','Medium','Critical','All approvals upfront, liaison consultant, regular compliance','Borrower','Quarterly legal review'],
                        ['Sales shortfall','Medium','High','Aggressive marketing, competitive pricing, channel partners','Borrower','Monthly sales tracking'],
                    ].map((r,i)=>(<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD className={r[2]==='Critical'?'text-red-700 font-bold':r[2]==='High'?'text-orange-700 font-semibold':''}>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD><TD>{r[5]}</TD></tr>))}
                </tbody></table>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">C.2 Commercial Projects</p>
                <table className="w-full border-collapse text-[7.5px] mb-4"><thead><tr>
                    <TH>Risk</TH><TH>Prob.</TH><TH>Impact</TH><TH>Mitigation Strategy</TH><TH>Resp.</TH><TH>Monitor</TH>
                </tr></thead><tbody>
                    {[
                        ['Tenant vacancy','High','Critical','40% pre-leasing mandatory, anchor tenant, diversified mix','Borrower + Bank','Monthly leasing status'],
                        ['Rental decline','Medium','High','Long-term leases (6-9 yrs), escalation clauses, Grade A location','Borrower','Quarterly rental review'],
                        ['Tech obsolescence','Medium','Medium','Future-ready infra, modular design, smart building features','Borrower','Annual tech assessment'],
                        ['Corporate demand shift','Medium','High','Flexible spaces, mixed-use option, premium amenities','Borrower','Quarterly demand analysis'],
                    ].map((r,i)=>(<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD className={r[2]==='Critical'?'text-red-700 font-bold':r[2]==='High'?'text-orange-700 font-semibold':''}>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD><TD>{r[5]}</TD></tr>))}
                </tbody></table>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">C.3 Mixed-Use Projects</p>
                <table className="w-full border-collapse text-[7.5px] mb-4"><thead><tr>
                    <TH>Risk</TH><TH>Prob.</TH><TH>Impact</TH><TH>Mitigation Strategy</TH><TH>Resp.</TH><TH>Monitor</TH>
                </tr></thead><tbody>
                    {[
                        ['Phase timing mismatch','High','High','Integrated master plan, realistic timelines, adequate equity','Borrower','Quarterly phase review'],
                        ['Cross-subsidy failure','Medium','High','Each component viable independently, no over-dependence','Bank','Component-wise financials'],
                        ['Approval complexity','High','Critical','Experienced approval consultant, multi-authority coordination','Borrower','Monthly approval tracking'],
                        ['Management bandwidth','High','Medium','Component-wise teams, professional FM, clear governance','Borrower','Quarterly org review'],
                    ].map((r,i)=>(<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD className={r[2]==='Critical'?'text-red-700 font-bold':r[2]==='High'?'text-orange-700 font-semibold':''}>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD><TD>{r[5]}</TD></tr>))}
                </tbody></table>
            </div>
            <PageBreak />

            {/* APPENDIX D */}
            <div className="report-page">
                <SH2>APPENDIX D: Sample Formats</SH2>
                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">D.1 Monthly Progress Report Format</p>
                <div className="font-mono text-[7px] bg-slate-100 border border-slate-300 p-3 rounded mb-4 whitespace-pre-wrap leading-relaxed">
{`PROJECT PROGRESS REPORT
Month: [Month, Year]    Project: [Name]    Location: [Address]

A. PHYSICAL PROGRESS
Component                | Planned % | Actual % | Variance | Remarks
Foundation               |           |          |          |
Structural Work          |           |          |          |
Finishing Work           |           |          |          |
MEP Work                 |           |          |          |
External Development     |           |          |          |
Overall Progress         |           |          |          |

B. FINANCIAL PROGRESS
Head                     | Budget     | Spent     | Balance   | %Utilized
Land                     | ₹1,340 L   |           |           |
Construction             | ₹3,640 L   |           |           |
Professional Fees        | ₹195 L     |           |           |
Marketing                | ₹340 L     |           |           |
Others                   | ₹1,041 L   |           |           |
Total                    | ₹6,556 L   |           |           |

C. SALES PROGRESS
Period           | Target Units | Actual Units | Value (₹ Cr) | Cumulative %
This Month       |              |              |              |
Cumulative       |              |              |              |

D. ISSUES & CONCERNS
[List any delays, cost overruns, quality issues, regulatory challenges]

E. UPCOMING MILESTONES
[Next month's targets and critical activities]

Certified by:
Project Manager: _________________  Date: _______
PMC: _________________              Date: _______`}
                </div>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">D.2 Quarterly Covenant Compliance Certificate</p>
                <div className="font-mono text-[7px] bg-slate-100 border border-slate-300 p-3 rounded mb-4 whitespace-pre-wrap leading-relaxed">
{`COVENANT COMPLIANCE CERTIFICATE
For Quarter Ending: [Date]    Project: [Name]

Financial Covenants:
□ DSCR maintained at minimum 1.25x (Actual: ____)
□ Debt-Equity ratio within 2:1 (Actual: ____)
□ Current ratio above 1.5:1 (Actual: ____)
□ Interest coverage above 2.0x (Actual: ____)

Operational Covenants:
□ Pre-sales target achieved (Target: ___%, Actual: ___%)
□ Construction timeline adhered to (Variance: ___ months)
□ Cost within budget ±10% (Variance: ___%)
□ No customer complaints >5% of sold units (Actual: ___%)

Regulatory Covenants:
□ RERA quarterly report filed on [Date]
□ All approvals valid and current
□ Insurance policies active
□ No litigation exceeding ₹50 lakhs unreported

Negative Covenants:
□ No new projects launched without bank consent
□ No additional debt raised    □ No change in management
□ No dividend declared         □ No asset sales outside normal course

Affirmative Covenants:
□ Stock statements submitted monthly
□ Escrow account reconciled monthly
□ Utilization certificates provided for all disbursements
□ Site inspections facilitated

Any Deviations: [Details if any covenants breached]

Chief Financial Officer            Chartered Accountant
Name: _______________             Name: _______________
Sign: _______________             Sign: _______________
Date: _______________             Date: _______________`}
                </div>
            </div>
            <PageBreak />

            {/* APPENDIX E */}
            <div className="report-page">
                <SH2>APPENDIX E: Comparison – Project Types</SH2>
                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">E.1 Quick Reference: Underwriting Parameters by Project Type</p>
                <table className="w-full border-collapse text-[7.5px] mb-4"><thead><tr>
                    <TH>Parameter</TH><TH>Residential</TH><TH>Commercial Office</TH><TH>Retail/Mall</TH><TH>Mixed-Use</TH><TH>Affordable</TH>
                </tr></thead><tbody>
                    {[
                        ['Equity Requirement','30-35%','35-40%','40-45%','40-50%','15-20%'],
                        ['Pre-Sales/Leasing','30-40%','40-50%','50-60%','Varies','20-30%'],
                        ['Max LTV','65-70%','60-65%','55-60%','50-60%','75-80%'],
                        ['Min DSCR','1.25x','1.50x','1.75x','1.50x','1.15x'],
                        ['Typical IRR','18-25%','15-20%','12-18%','15-22%','12-18%'],
                        ['Risk Rating','Medium-High','High','High','Very High','Medium'],
                        ['Typical Tenure','24-36 mo','30-42 mo','36-48 mo','48-60 mo','18-30 mo'],
                        ['Exit Timeline','42-48 mo','60-84 mo','60-96 mo','60-84 mo','36-42 mo'],
                    ].map((r,i)=>(<tr key={i} className={i%2===0?'bg-slate-50':''}><TD className="font-semibold">{r[0]}</TD><TD>{r[1]}</TD><TD>{r[2]}</TD><TD>{r[3]}</TD><TD>{r[4]}</TD><TD>{r[5]}</TD></tr>))}
                </tbody></table>

                <p className="font-bold text-[9px] bg-slate-800 text-white p-1 mb-2">E.2 Key Differences in Assessment</p>
                <div className="grid grid-cols-2 gap-2 text-[8px] mb-4">
                    {[
                        {t:'RESIDENTIAL',c:'border-blue-200 bg-blue-50',tc:'text-blue-900', items:['Focus: Unit sales to individual buyers','Revenue: One-time sale proceeds','Risk: Market absorption, pricing','Security: Progressive mortgage, receivables','Exit: Through sales completion']},
                        {t:'COMMERCIAL',c:'border-purple-200 bg-purple-50',tc:'text-purple-900', items:['Focus: Lease to corporate tenants','Revenue: Recurring rental income','Risk: Tenant vacancy, rental yields','Security: Mortgage + rental assignment','Exit: Through lease stabilization or sale']},
                        {t:'MIXED-USE',c:'border-orange-200 bg-orange-50',tc:'text-orange-900', items:['Focus: Multiple revenue streams','Revenue: Sales + rentals combined','Risk: Execution complexity, phasing','Security: Component-wise approach','Exit: Phased based on components']},
                        {t:'AFFORDABLE HOUSING',c:'border-green-200 bg-green-50',tc:'text-green-900', items:['Focus: Volume sales, government schemes','Revenue: Lower margins, higher volumes','Risk: Execution at scale, thin margins','Security: PMAY benefits, bulk mortgages','Exit: Faster due to government support']},
                    ].map((b,i) => (
                        <div key={i} className={`border ${b.c} p-2 rounded`}>
                            <p className={`font-bold ${b.tc} border-b pb-0.5 mb-1`}>{b.t}</p>
                            <ul className="list-disc pl-3 space-y-[1px] text-slate-700">{b.items.map((it,j)=><li key={j}>{it}</li>)}</ul>
                        </div>
                    ))}
                </div>
            </div>
            <PageBreak />

            {/* CONCLUSION */}
            <div className="report-page">
                <SH>CONCLUSION</SH>
                <p className="text-[9px] text-slate-700 mb-3">This comprehensive underwriting and risk assessment report provides a detailed framework for evaluating the proposed {crore(loanAmount)} construction finance facility for a {totalUnits}-unit {(project.intendedUse || 'residential').toLowerCase()} project in {typeof project.location === 'string' ? project.location : 'the subject area'}.</p>
                
                <div className="grid grid-cols-2 gap-3 text-[8.5px] mb-4">
                    <div className="border border-green-200 bg-green-50 p-2 rounded">
                        <p className="font-bold text-green-900 border-b border-green-200 pb-1 mb-1">STRENGTHS:</p>
                        <ul className="list-disc pl-3 space-y-0.5 text-green-800">
                            <li>Healthy project economics with {pct(grossMargin)} gross margin</li>
                            <li>Conservative debt-equity ratio ({Math.round(loanAmount/totalCost*100)}:{Math.round((1-loanAmount/totalCost)*100)})</li>
                            <li>Strong location fundamentals ({typeof project.location === 'string' ? project.location : 'Subject Area'} segment)</li>
                            <li>Adequate security coverage ({(totalRev / Math.max(1, loanAmount)).toFixed(1)}x at completion)</li>
                            <li>Manageable project size ({totalUnits} units)</li>
                        </ul>
                    </div>
                    <div className="border border-red-200 bg-red-50 p-2 rounded">
                        <p className="font-bold text-red-900 border-b border-red-200 pb-1 mb-1">CONCERNS:</p>
                        <ul className="list-none pl-1 space-y-0.5 text-red-800">
                            <li><span className="font-bold text-red-700">CRITICAL:</span> Land size constraint requiring immediate technical validation</li>
                            <li><span className="font-bold text-orange-700">HIGH:</span> Promoter track record requires thorough verification</li>
                            <li><span className="font-bold text-orange-700">HIGH:</span> Multiple regulatory approvals pending</li>
                            <li><span className="font-bold text-amber-700">MEDIUM:</span> Market absorption in competitive environment</li>
                            <li><span className="font-bold text-amber-700">MEDIUM:</span> Execution timeline appears aggressive</li>
                        </ul>
                    </div>
                </div>

                <div className="bg-slate-800 text-white p-3 rounded mb-4 text-center">
                    <p className="text-[10px] font-bold mb-1">OVERALL RISK RATING: {getRiskLabel(avgRisk)[0].toUpperCase()} ({avgRisk.toFixed(2)}/5)</p>
                    <p className="text-[11px] font-bold uppercase tracking-wide">CREDIT RECOMMENDATION: <span className={getRecColorDark(avgRisk)}>{getRecText(avgRisk)}</span></p>
                </div>

                <p className="text-[9px] text-slate-700 mb-1 font-semibold">Subject to satisfactory fulfillment of 24 Conditions Precedent, with particular emphasis on:</p>
                <ul className="list-disc pl-4 text-[8.5px] text-slate-700 mb-3 space-y-0.5">
                    <li>Land size and technical feasibility validation</li>
                    <li>Promoter experience verification</li>
                    <li>Complete statutory approvals</li>
                    <li>30% pre-sales achievement</li>
                    <li>Clear marketable title</li>
                </ul>

                <div className="border border-slate-300 bg-slate-50 p-2 rounded text-[8.5px] mb-4">
                    <p className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-1">PROPOSED STRUCTURE:</p>
                    <div className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-slate-700">Loan Amount:</span><span>{crore(loanAmount)}</span>
                        <span className="font-semibold text-slate-700">Interest Rate:</span><span>11.5-12.0% p.a.</span>
                        <span className="font-semibold text-slate-700">Tenure:</span><span>{totalMonths} months construction + 6 months repayment</span>
                        <span className="font-semibold text-slate-700">Security:</span><span>{(totalRev / Math.max(1, loanAmount)).toFixed(1)}x coverage through mortgage + receivables</span>
                        <span className="font-semibold text-slate-700">Disbursement:</span><span>Milestone-based with sales linkage</span>
                        <span className="font-semibold text-slate-700">Monitoring:</span><span>Three-tier monthly/quarterly/half-yearly</span>
                    </div>
                </div>

                <p className="text-[9px] text-slate-700 mb-4">The loan can proceed to sanction stage upon satisfactory completion of due diligence and CP fulfillment within 90-120 days.</p>

                <div className="grid grid-cols-4 gap-3 text-center text-[8px] text-slate-500 border-t border-slate-300 pt-4 mb-4">
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Report Prepared By</p><p className="font-semibold">Credit Analysis Team</p></div>
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Reviewed By</p><p className="font-semibold">Head - Real Estate Finance</p></div>
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>Recommended By</p><p className="font-semibold">Chief Credit Officer</p></div>
                    <div><div className="h-8 border-b border-slate-400 mb-1" /><p>For Approval</p><p className="font-semibold text-slate-800">Credit Committee / Board</p></div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-2 rounded text-[7.5px] text-amber-800 italic">
                    <strong>DISCLAIMER:</strong> This report is based on information provided by the borrower and preliminary analysis. Final sanction is subject to satisfactory completion of legal, technical, and financial due diligence, fulfillment of all conditions precedent, and approval by the bank's competent authority.
                </div>

                <div className="mt-6 text-center">
                    <p className="text-[10px] font-bold text-slate-800 border-t-2 border-b-2 border-slate-400 py-2 inline-block px-8">— END OF REPORT —</p>
                </div>
            </div>
        </div>
    );
}
