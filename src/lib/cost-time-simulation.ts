import type {
    CostRevenueParameters,
    TimeEstimationParameter,
    SimBin,
    SensitivityVar,
    ProjectPhase,
    UtilityCostBreakdown,
    SimulationResults,
    DeliveryPhase,
    DeliveryPhaseBuilding,
} from './types';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Triangular distribution sample */
function triSample(min: number, mode: number, max: number): number {
    if (min >= max) return mode;
    const u = Math.random();
    const fc = (mode - min) / (max - min);
    if (u < fc) {
        return min + Math.sqrt(u * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** Percentile from sorted array */
function percentile(sorted: number[], p: number): number {
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Build histogram bins from data */
function buildHistogram(data: number[], numBins = 30): SimBin[] {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const binWidth = (max - min) / numBins || 1;
    const bins: SimBin[] = [];
    for (let i = 0; i < numBins; i++) {
        bins.push({ x: min + (i + 0.5) * binWidth, count: 0 });
    }
    data.forEach(v => {
        const idx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
        bins[idx].count++;
    });
    return bins;
}

/** Build CDF from data */
function buildCDF(data: number[], numPoints = 50): { x: number; y: number }[] {
    const sorted = [...data].sort((a, b) => a - b);
    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const idx = Math.floor((i / (numPoints - 1)) * (sorted.length - 1));
        result.push({ x: sorted[idx], y: ((idx + 1) / sorted.length) * 100 });
    }
    return result;
}

// ─── COST SIMULATION ─────────────────────────────────────────────────────────

interface CostSimInput {
    costParam: CostRevenueParameters;
    gfa: number;
    iterations?: number;
}

function runCostSimulation({ costParam, gfa, iterations = 5000 }: CostSimInput) {
    const cp = costParam;

    // Determine min/mode/max for each component
    const ranges = {
        earthwork: {
            min: cp.earthwork_cost_per_sqm_min ?? cp.earthwork_cost_per_sqm * 0.8,
            mode: cp.earthwork_cost_per_sqm,
            max: cp.earthwork_cost_per_sqm_max ?? cp.earthwork_cost_per_sqm * 1.25,
        },
        structure: {
            min: cp.structure_cost_per_sqm_min ?? cp.structure_cost_per_sqm * 0.85,
            mode: cp.structure_cost_per_sqm,
            max: cp.structure_cost_per_sqm_max ?? cp.structure_cost_per_sqm * 1.2,
        },
        finishing: {
            min: cp.finishing_cost_per_sqm_min ?? cp.finishing_cost_per_sqm * 0.8,
            mode: cp.finishing_cost_per_sqm,
            max: cp.finishing_cost_per_sqm_max ?? cp.finishing_cost_per_sqm * 1.3,
        },
        services: {
            min: cp.services_cost_per_sqm_min ?? cp.services_cost_per_sqm * 0.85,
            mode: cp.services_cost_per_sqm,
            max: cp.services_cost_per_sqm_max ?? cp.services_cost_per_sqm * 1.2,
        },
    };

    const totals: number[] = [];
    const components: Record<string, number[]> = {
        earthwork: [], structure: [], finishing: [], services: [],
    };

    for (let i = 0; i < iterations; i++) {
        const e = triSample(ranges.earthwork.min, ranges.earthwork.mode, ranges.earthwork.max) * gfa;
        const s = triSample(ranges.structure.min, ranges.structure.mode, ranges.structure.max) * gfa;
        const f = triSample(ranges.finishing.min, ranges.finishing.mode, ranges.finishing.max) * gfa;
        const sv = triSample(ranges.services.min, ranges.services.mode, ranges.services.max) * gfa;
        const contingency = (e + s + f + sv) * 0.05;
        const total = e + s + f + sv + contingency;
        totals.push(total);
        components.earthwork.push(e);
        components.structure.push(s);
        components.finishing.push(f);
        components.services.push(sv);
    }

    const sorted = [...totals].sort((a, b) => a - b);

    // Sensitivity analysis: vary one component at a time
    const baseTotal = gfa * (cp.earthwork_cost_per_sqm + cp.structure_cost_per_sqm +
        cp.finishing_cost_per_sqm + cp.services_cost_per_sqm) * 1.05;

    const sensitivity: SensitivityVar[] = Object.entries(ranges).map(([key, r]) => {
        const labelMap: Record<string, string> = {
            earthwork: 'Earthwork', structure: 'Structure',
            finishing: 'Finishing', services: 'MEP/Services',
        };
        const lowCost = r.min * gfa * 1.05;
        const highCost = r.max * gfa * 1.05;
        const basePart = r.mode * gfa * 1.05;
        return {
            label: labelMap[key] || key,
            low: baseTotal - basePart + lowCost,
            high: baseTotal - basePart + highCost,
            range: (highCost - lowCost),
        };
    }).sort((a, b) => b.range - a.range);

    return {
        histogram: buildHistogram(totals),
        cdf: buildCDF(totals),
        p10: percentile(sorted, 10),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        mean: totals.reduce((a, b) => a + b, 0) / totals.length,
        sensitivity,
        rawTotals: totals,
        rawComponents: components,
    };
}

// ─── TIME SIMULATION ─────────────────────────────────────────────────────────

interface TimeSimInput {
    timeParam: TimeEstimationParameter;
    floors: number;
    iterations?: number;
}

function runTimeSimulation({ timeParam, floors, iterations = 5000 }: TimeSimInput) {
    const tp = timeParam;

    const ranges = {
        excavation: {
            min: tp.excavation_timeline_months_min ?? tp.excavation_timeline_months * 0.7,
            mode: tp.excavation_timeline_months,
            max: tp.excavation_timeline_months_max ?? tp.excavation_timeline_months * 1.5,
        },
        foundation: {
            min: tp.foundation_timeline_months_min ?? tp.foundation_timeline_months * 0.7,
            mode: tp.foundation_timeline_months,
            max: tp.foundation_timeline_months_max ?? tp.foundation_timeline_months * 1.5,
        },
        structurePerFloor: {
            min: tp.structure_per_floor_days_min ?? tp.structure_per_floor_days * 0.7,
            mode: tp.structure_per_floor_days,
            max: tp.structure_per_floor_days_max ?? tp.structure_per_floor_days * 1.4,
        },
        finishingPerFloor: {
            min: tp.finishing_per_floor_days_min ?? tp.finishing_per_floor_days * 0.8,
            mode: tp.finishing_per_floor_days,
            max: tp.finishing_per_floor_days_max ?? tp.finishing_per_floor_days * 1.3,
        },
    };

    // Delay factor as weighted average (annual effect)
    const df = tp.delay_factors ?? {
        monsoon_pct: 30, summer_pct: 15, festival_pct: 12, winter_pct: 10, rework_pct: 15,
    };
    // Weighted annual delay: each season ~3 months, rework is constant
    // monsoon=3mo, summer=3mo, festival=1mo, winter=2mo → ~9mo seasonal + rework on 12
    const avgDelayFactor = 1 + (
        (df.monsoon_pct / 100) * (3 / 12) +
        (df.summer_pct / 100) * (3 / 12) +
        (df.festival_pct / 100) * (1 / 12) +
        (df.winter_pct / 100) * (2 / 12) +
        (df.rework_pct / 100)
    );

    const totals: number[] = [];
    const phaseData: Record<string, number[]> = {
        excavation: [], foundation: [], structure: [], finishing: [],
    };

    for (let i = 0; i < iterations; i++) {
        const exc = triSample(ranges.excavation.min, ranges.excavation.mode, ranges.excavation.max);
        const fnd = triSample(ranges.foundation.min, ranges.foundation.mode, ranges.foundation.max);
        const strDays = triSample(ranges.structurePerFloor.min, ranges.structurePerFloor.mode, ranges.structurePerFloor.max) * floors;
        const finDays = triSample(ranges.finishingPerFloor.min, ranges.finishingPerFloor.mode, ranges.finishingPerFloor.max) * floors;
        const strMonths = strDays / 30;
        const finMonths = finDays / 30;
        const overlapMonths = finMonths * tp.services_overlap_factor;

        const cleanTotal = exc + fnd + strMonths + finMonths - overlapMonths + tp.contingency_buffer_months;
        const delayMult = triSample(avgDelayFactor * 0.85, avgDelayFactor, avgDelayFactor * 1.15);
        const total = cleanTotal * delayMult;

        totals.push(total);
        phaseData.excavation.push(exc * delayMult);
        phaseData.foundation.push(fnd * delayMult);
        phaseData.structure.push(strMonths * delayMult);
        phaseData.finishing.push(finMonths * delayMult);
    }

    const sorted = [...totals].sort((a, b) => a - b);

    // Sensitivity
    const baseClean = tp.excavation_timeline_months + tp.foundation_timeline_months +
        (tp.structure_per_floor_days * floors / 30) + (tp.finishing_per_floor_days * floors / 30) -
        ((tp.finishing_per_floor_days * floors / 30) * tp.services_overlap_factor) +
        tp.contingency_buffer_months;
    const baseTotal = baseClean * avgDelayFactor;

    const sensitivity: SensitivityVar[] = [
        {
            label: 'Excavation',
            low: (baseTotal - tp.excavation_timeline_months * avgDelayFactor + ranges.excavation.min * avgDelayFactor),
            high: (baseTotal - tp.excavation_timeline_months * avgDelayFactor + ranges.excavation.max * avgDelayFactor),
            range: (ranges.excavation.max - ranges.excavation.min) * avgDelayFactor,
        },
        {
            label: 'Foundation',
            low: (baseTotal - tp.foundation_timeline_months * avgDelayFactor + ranges.foundation.min * avgDelayFactor),
            high: (baseTotal - tp.foundation_timeline_months * avgDelayFactor + ranges.foundation.max * avgDelayFactor),
            range: (ranges.foundation.max - ranges.foundation.min) * avgDelayFactor,
        },
        {
            label: 'Structure',
            low: (baseTotal - (tp.structure_per_floor_days * floors / 30) * avgDelayFactor + (ranges.structurePerFloor.min * floors / 30) * avgDelayFactor),
            high: (baseTotal - (tp.structure_per_floor_days * floors / 30) * avgDelayFactor + (ranges.structurePerFloor.max * floors / 30) * avgDelayFactor),
            range: ((ranges.structurePerFloor.max - ranges.structurePerFloor.min) * floors / 30) * avgDelayFactor,
        },
        {
            label: 'Finishing',
            low: (baseTotal - (tp.finishing_per_floor_days * floors / 30) * avgDelayFactor + (ranges.finishingPerFloor.min * floors / 30) * avgDelayFactor),
            high: (baseTotal - (tp.finishing_per_floor_days * floors / 30) * avgDelayFactor + (ranges.finishingPerFloor.max * floors / 30) * avgDelayFactor),
            range: ((ranges.finishingPerFloor.max - ranges.finishingPerFloor.min) * floors / 30) * avgDelayFactor,
        },
    ].sort((a, b) => b.range - a.range);

    // Delay breakdown
    const delay_breakdown = [
        { factor: 'Monsoon', pct: df.monsoon_pct, impactMonths: baseClean * (df.monsoon_pct / 100) * (3 / 12) },
        { factor: 'Summer Heat', pct: df.summer_pct, impactMonths: baseClean * (df.summer_pct / 100) * (3 / 12) },
        { factor: 'Festival', pct: df.festival_pct, impactMonths: baseClean * (df.festival_pct / 100) * (1 / 12) },
        { factor: 'Winter', pct: df.winter_pct, impactMonths: baseClean * (df.winter_pct / 100) * (2 / 12) },
        { factor: 'Rework', pct: df.rework_pct, impactMonths: baseClean * (df.rework_pct / 100) },
    ];

    return {
        histogram: buildHistogram(totals),
        cdf: buildCDF(totals),
        p10: percentile(sorted, 10),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        mean: totals.reduce((a, b) => a + b, 0) / totals.length,
        sensitivity,
        delay_breakdown,
        rawTotals: totals,
        phaseData,
    };
}

// ─── UTILITY COSTS ───────────────────────────────────────────────────────────

interface UtilityInput {
    costParam: CostRevenueParameters;
    totalGFA: number;
    floors: number;
    numLifts?: number;
    hvacTR?: number;
    solarKW?: number;
    electricalKVA?: number;
    utilitiesPresent?: string[];
}

function calculateUtilityCosts(input: UtilityInput): { items: UtilityCostBreakdown[]; total: number } {
    const uc = input.costParam.utility_costs;
    const items: UtilityCostBreakdown[] = [];

    // Default utility costs from standard reference if not provided
    const defaults = {
        ugt_pumping: 25000000,       // ₹2.5 crore
        stp_per_kld: 20000,          // ₹20,000 per KLD
        wtp_cost: 2000000,           // ₹20 lakh
        transformer_per_kva: 10000,  // ₹10,000 per kVA
        dg_per_kva: 8000,            // ₹8,000 per kVA
        fire_fighting: 50000000,     // ₹5 crore
        lifts_per_unit: 15000000,    // ₹1.5 crore per lift
        solar_per_kw: 52000,         // ₹52,000 per kW
        hvac_per_tr: 130000,         // ₹1.3 lakh per TR
    };

    const u = {
        ugt_pumping: uc?.ugt_pumping ?? defaults.ugt_pumping,
        stp_per_kld: uc?.stp_per_kld ?? defaults.stp_per_kld,
        wtp_cost: uc?.wtp_cost ?? defaults.wtp_cost,
        transformer_per_kva: uc?.transformer_per_kva ?? defaults.transformer_per_kva,
        dg_per_kva: uc?.dg_per_kva ?? defaults.dg_per_kva,
        fire_fighting: uc?.fire_fighting ?? defaults.fire_fighting,
        lifts_per_unit: uc?.lifts_per_unit ?? defaults.lifts_per_unit,
        solar_per_kw: uc?.solar_per_kw ?? defaults.solar_per_kw,
        hvac_per_tr: uc?.hvac_per_tr ?? defaults.hvac_per_tr,
    };

    const hasUtility = (matches: string[]) => {
        if (!input.utilitiesPresent) return true;
        return matches.some(m => input.utilitiesPresent!.some(u => u === m));
    };

    // UGT + Pumping (fixed cost) - Assume always required or basic site infrastructure
    if (hasUtility(['Water', 'UGT', 'WTP', 'STP'])) {
        items.push({ label: 'UGT + Pumping', amount: u.ugt_pumping, unit: 'Fixed' });
    }

    // STP: estimate 150 liters/person/day, 1 person per 15sqm GFA → KLD ≈ GFA/15 * 150/1000
    if (hasUtility(['STP', 'Sewage'])) {
        const kld = (input.totalGFA / 15) * 150 / 1000;
        items.push({ label: 'STP', amount: kld * u.stp_per_kld, unit: `${kld.toFixed(0)} KLD` });
    }

    // WTP
    if (hasUtility(['WTP', 'Water'])) {
        items.push({ label: 'WTP', amount: u.wtp_cost, unit: 'Fixed' });
    }

    // Transformer: estimate 20W/sqm → kVA ≈ GFA * 20 / 1000 / 0.8 PF
    const kva = input.electricalKVA ?? (input.totalGFA * 20 / 1000 / 0.8);
    if (hasUtility(['Transformer', 'Substation', 'Transformer Yard'])) {
        items.push({ label: 'Transformer + HT', amount: kva * u.transformer_per_kva, unit: `${kva.toFixed(0)} kVA` });
    }

    // DG Set: 30% of connected load as backup
    if (hasUtility(['DG Set'])) {
        const dgKva = kva * 0.3;
        items.push({ label: 'DG Set', amount: dgKva * u.dg_per_kva, unit: `${dgKva.toFixed(0)} kVA` });
    }

    // Fire Fighting
    if (hasUtility(['Fire Fighting', 'Fire'])) {
        items.push({ label: 'Fire Fighting', amount: u.fire_fighting, unit: 'Fixed' });
    }

    // Lifts: estimate based on floors. If utilities array is present, only include if 'Lifts' or 'Core' is specifically generated.
    if (hasUtility(['Lifts', 'Core']) || (input.floors > 3 && !input.utilitiesPresent)) {
        const numLifts = input.numLifts ?? Math.max(2, Math.ceil(input.floors / 8) * 2);
        items.push({ label: 'Lifts', amount: numLifts * u.lifts_per_unit, unit: `${numLifts} lifts` });
    }

    // Solar: estimate 5W/sqm roof area (top floor area ≈ GFA/floors)
    if (hasUtility(['Solar PV', 'Solar'])) {
        const solarKW = input.solarKW ?? ((input.totalGFA / Math.max(1, input.floors)) * 5 / 1000);
        items.push({ label: 'Solar PV', amount: solarKW * u.solar_per_kw, unit: `${solarKW.toFixed(0)} kW` });
    }

    // HVAC: estimate 1 TR per 200 sqft (18.6 sqm)
    if (hasUtility(['HVAC'])) {
        const hvacTR = input.hvacTR ?? (input.totalGFA / 18.6);
        items.push({ label: 'HVAC', amount: hvacTR * u.hvac_per_tr, unit: `${hvacTR.toFixed(0)} TR` });
    }

    const total = items.reduce((s, it) => s + it.amount, 0);
    return { items, total };
}

// ─── PHASE DIVISION ──────────────────────────────────────────────────────────

/**
 * Standard phase distribution based on industry norms.
 * Returns phase templates with share percentages.
 */
function getPhaseTemplates(numPhases: number): { name: string; share: number; activities: string[] }[] {
    if (numPhases <= 3) {
        return [
            { name: 'Phase 1: Pre-Construction & Substructure', share: 0.15, activities: ['Excavation', 'Foundation', 'Piling', 'Dewatering'] },
            { name: 'Phase 2: Construction & MEP', share: 0.60, activities: ['Superstructure', 'MEP Rough-In', 'Masonry', 'Facade'] },
            { name: 'Phase 3: Finishing & Handover', share: 0.25, activities: ['Finishing', 'External Works', 'Commissioning', 'Handover'] },
        ];
    }
    if (numPhases === 4) {
        return [
            { name: 'Phase 1: Pre-Construction', share: 0.10, activities: ['Site Clearance', 'Excavation', 'Dewatering'] },
            { name: 'Phase 2: Substructure', share: 0.15, activities: ['Foundation', 'Piling', 'Basement'] },
            { name: 'Phase 3: Superstructure & MEP', share: 0.50, activities: ['Structure', 'MEP Rough-In', 'Masonry', 'Facade'] },
            { name: 'Phase 4: Finishing & Handover', share: 0.25, activities: ['Finishing', 'External Works', 'Commissioning', 'Handover'] },
        ];
    }
    // 5+ phases
    const templates = [
        { name: 'Phase 1: Pre-Construction', share: 0.08, activities: ['Site Clearance', 'Mobilisation'] },
        { name: 'Phase 2: Excavation & Foundation', share: 0.12, activities: ['Excavation', 'Dewatering', 'Foundation'] },
        { name: 'Phase 3: Superstructure', share: 0.35, activities: ['RCC Frame', 'Columns', 'Slabs'] },
        { name: 'Phase 4: MEP & Masonry', share: 0.20, activities: ['MEP Rough-In', 'Masonry', 'Plastering'] },
        { name: 'Phase 5: Finishing & Handover', share: 0.25, activities: ['Finishing', 'Facade', 'External Works', 'Commissioning'] },
    ];
    // Add more phases if needed by subdividing
    while (templates.length < numPhases) {
        const biggest = templates.reduce((a, b, i) => b.share > templates[a].share ? i : a, 0);
        const orig = templates[biggest];
        const half = orig.share / 2;
        const splitActs = orig.activities.length > 1
            ? [orig.activities.slice(0, Math.ceil(orig.activities.length / 2)), orig.activities.slice(Math.ceil(orig.activities.length / 2))]
            : [orig.activities, orig.activities];
        templates.splice(biggest, 1,
            { name: `${orig.name}A`, share: half, activities: splitActs[0] },
            { name: `${orig.name}B`, share: half, activities: splitActs[1] },
        );
    }
    // Renumber
    return templates.slice(0, numPhases).map((t, i) => ({
        ...t,
        name: `Phase ${i + 1}: ${t.activities[0] || 'Works'}`,
    }));
}

function divideIntoPhases(
    totalMonths: number,
    totalCost: number,
    costP10: number,
    costP90: number,
    numPhases: number,
): ProjectPhase[] {
    const templates = getPhaseTemplates(numPhases);
    let cumulativeMonth = 0;

    return templates.map(t => {
        const dur = totalMonths * t.share;
        const phase: ProjectPhase = {
            name: t.name,
            durationMonths: dur,
            costShare: t.share,
            costAmount: totalCost * t.share,
            costAmountMin: costP10 * t.share,
            costAmountMax: costP90 * t.share,
            activities: t.activities,
        };
        cumulativeMonth += dur;
        return phase;
    });
}

// ─── S-CURVE BANDS ───────────────────────────────────────────────────────────

function generateSCurveBands(totalMonths: number, costP10: number, costP50: number, costP90: number, numPoints = 24) {
    const p10: number[] = [];
    const p50: number[] = [];
    const p90: number[] = [];
    const months = Math.max(6, Math.round(totalMonths));
    const points = Math.min(numPoints, months);

    for (let m = 1; m <= points; m++) {
        const t = m / points;
        // Logistic S-curve
        const s = 1 / (1 + Math.exp(-10 * (t - 0.5)));
        p10.push(costP10 * s);
        p50.push(costP50 * s);
        p90.push(costP90 * s);
    }

    return { p10, p50, p90 };
}

// ─── GANTT WITH UNCERTAINTY ──────────────────────────────────────────────────

function generateGanttUncertainty(timeParam: TimeEstimationParameter, floors: number, avgDelayFactor: number) {
    const tp = timeParam;
    const activities = [
        {
            activity: 'Excavation',
            minDur: (tp.excavation_timeline_months_min ?? tp.excavation_timeline_months * 0.7),
            expDur: tp.excavation_timeline_months,
            maxDur: (tp.excavation_timeline_months_max ?? tp.excavation_timeline_months * 1.5),
            color: '#f59e0b',
        },
        {
            activity: 'Foundation',
            minDur: (tp.foundation_timeline_months_min ?? tp.foundation_timeline_months * 0.7),
            expDur: tp.foundation_timeline_months,
            maxDur: (tp.foundation_timeline_months_max ?? tp.foundation_timeline_months * 1.5),
            color: '#ef4444',
        },
        {
            activity: 'Superstructure',
            minDur: ((tp.structure_per_floor_days_min ?? tp.structure_per_floor_days * 0.7) * floors) / 30,
            expDur: (tp.structure_per_floor_days * floors) / 30,
            maxDur: ((tp.structure_per_floor_days_max ?? tp.structure_per_floor_days * 1.4) * floors) / 30,
            color: '#3b82f6',
        },
        {
            activity: 'Finishing',
            minDur: ((tp.finishing_per_floor_days_min ?? tp.finishing_per_floor_days * 0.8) * floors) / 30,
            expDur: (tp.finishing_per_floor_days * floors) / 30,
            maxDur: ((tp.finishing_per_floor_days_max ?? tp.finishing_per_floor_days * 1.3) * floors) / 30,
            color: '#8b5cf6',
        },
        {
            activity: 'Contingency',
            minDur: tp.contingency_buffer_months * 0.5,
            expDur: tp.contingency_buffer_months,
            maxDur: tp.contingency_buffer_months * 1.5,
            color: '#6b7280',
        },
    ];

    let minCum = 0, expCum = 0, maxCum = 0;
    return activities.map(a => {
        const minDurD = a.minDur * avgDelayFactor;
        const expDurD = a.expDur * avgDelayFactor;
        const maxDurD = a.maxDur * avgDelayFactor;
        const item = {
            activity: a.activity,
            minStart: minCum,
            expectedStart: expCum,
            expectedEnd: expCum + expDurD,
            maxEnd: maxCum + maxDurD,
            color: a.color,
        };
        minCum += minDurD;
        expCum += expDurD;
        maxCum += maxDurD;
        return item;
    });
}

// ─── DELIVERY PHASES (Building Grouping) ─────────────────────────────────────

interface BuildingBreakdownInput {
    buildingId: string;
    buildingName: string;
    timeline: {
        startOffset: number;
        total: number;
        substructure: number;
        structure: number;
        finishing: number;
        contingency: number;
    };
    cost: {
        total: number;
        ratePerSqm: number;
    };
    gfa?: number;
    floors?: number;
}

/**
 * Groups buildings into delivery phases following standard construction practice:
 * - Sort by GFA descending (largest buildings = highest priority)
 * - Round-robin distribute into N phases
 * - Phase N+1 starts when Phase N reaches superstructure (stagger offset)
 * - "All" mode (numPhases = 0 or >= buildings.length) puts each building in its own phase
 */
export function generateDeliveryPhases(
    buildings: BuildingBreakdownInput[],
    numDeliveryPhases: number = 3,
): DeliveryPhase[] {
    if (!buildings || buildings.length === 0) return [];

    // "All" mode: each building is its own phase
    const effectivePhases = numDeliveryPhases <= 0 || numDeliveryPhases >= buildings.length
        ? buildings.length
        : numDeliveryPhases;

    // Sort buildings by cost descending (proxy for priority — largest projects first)
    const sorted = [...buildings].sort((a, b) => b.cost.total - a.cost.total);

    // Distribute buildings into phase buckets (round-robin)
    const phaseBuckets: BuildingBreakdownInput[][] = Array.from({ length: effectivePhases }, () => []);
    sorted.forEach((b, i) => {
        phaseBuckets[i % effectivePhases].push(b);
    });

    let phaseStartOffset = 0;

    const phases: DeliveryPhase[] = phaseBuckets
        .filter(bucket => bucket.length > 0)
        .map((bucket, idx) => {
            const longestDuration = Math.max(...bucket.map(b => b.timeline.total));
            const phaseEnd = phaseStartOffset + longestDuration;

            const phaseBuildings: DeliveryPhaseBuilding[] = bucket.map(b => ({
                buildingId: b.buildingId,
                buildingName: b.buildingName,
                gfa: b.gfa || 0,
                floors: b.floors || 0,
                startMonth: phaseStartOffset + (b.timeline.startOffset || 0),
                endMonth: phaseStartOffset + (b.timeline.startOffset || 0) + b.timeline.total,
                cost: b.cost.total,
            }));

            const phase: DeliveryPhase = {
                phaseNumber: idx + 1,
                phaseName: `Phase ${idx + 1}`,
                startMonth: phaseStartOffset,
                endMonth: phaseEnd,
                durationMonths: longestDuration,
                totalCost: bucket.reduce((sum, b) => sum + b.cost.total, 0),
                totalGFA: bucket.reduce((sum, b) => sum + (b.gfa || 0), 0),
                buildings: phaseBuildings,
            };

            const longestSubstructure = Math.max(...bucket.map(b => b.timeline.substructure));
            phaseStartOffset += Math.max(longestSubstructure, longestDuration * 0.3); 

            return phase;
        });

    return phases;
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export interface RunSimulationInput {
    costParam: CostRevenueParameters;
    timeParam: TimeEstimationParameter;
    gfa: number;
    floors: number;
    numPhases?: number; 
    numDeliveryPhases?: number; 
    numLifts?: number;
    hvacTR?: number;
    solarKW?: number;
    electricalKVA?: number;
    iterations?: number; 
    utilitiesPresent?: string[];
    perBuildingBreakdown?: BuildingBreakdownInput[];
}

export function runFullSimulation(input: RunSimulationInput): SimulationResults {
    const { costParam, timeParam, gfa, floors, numPhases = 3, iterations = 5000 } = input;

    // 1. Cost simulation
    const costSim = runCostSimulation({ costParam, gfa, iterations });

    // 2. Time simulation
    const timeSim = runTimeSimulation({ timeParam, floors, iterations });

    // 3. Utility costs (deterministic baseline for breakdown display)
    const utilities = calculateUtilityCosts({
        costParam,
        totalGFA: gfa,
        floors,
        numLifts: input.numLifts,
        hvacTR: input.hvacTR,
        solarKW: input.solarKW,
        electricalKVA: input.electricalKVA,
        utilitiesPresent: input.utilitiesPresent,
    });

    // Simulate utility costs with ±20% triangular uncertainty per iteration
    // so that utility variance is reflected in the P10-P90 band
    const utilityBase = utilities.total;
    const totalCostRaw = costSim.rawTotals.map(total => {
        const utilityMultiplier = utilityBase > 0
            ? triSample(0.80, 1.0, 1.20)
            : 0;
        return total + utilityBase * utilityMultiplier;
    });
    const totalCostSorted = [...totalCostRaw].sort((a, b) => a - b);
    const totalCostP10 = percentile(totalCostSorted, 10);
    const totalCostP50 = percentile(totalCostSorted, 50);
    const totalCostP90 = percentile(totalCostSorted, 90);
    const totalCostMean = totalCostRaw.reduce((sum, value) => sum + value, 0) / totalCostRaw.length;

    // 4. Phase division
    const phases = divideIntoPhases(
        timeSim.p50,
        totalCostP50,
        totalCostP10,
        totalCostP90,
        Math.max(3, numPhases),
    );

    // 5. S-curve bands
    const sCurves = generateSCurveBands(timeSim.p50, totalCostP10, totalCostP50, totalCostP90);

    // 6. Gantt uncertainty
    const df = timeParam.delay_factors ?? {
        monsoon_pct: 30, summer_pct: 15, festival_pct: 12, winter_pct: 10, rework_pct: 15,
    };
    const avgDelayFactor = 1 + (
        (df.monsoon_pct / 100) * (3 / 12) +
        (df.summer_pct / 100) * (3 / 12) +
        (df.festival_pct / 100) * (1 / 12) +
        (df.winter_pct / 100) * (2 / 12) +
        (df.rework_pct / 100)
    );
    const gantt = generateGanttUncertainty(timeParam, floors, avgDelayFactor);

    // 7. Delivery phases (building grouping)
    const deliveryPhases = input.perBuildingBreakdown && input.perBuildingBreakdown.length > 0
        ? generateDeliveryPhases(input.perBuildingBreakdown, input.numDeliveryPhases ?? 3)
        : [];

    // 8. Critical Path Probability — which activity contributes the most schedule uncertainty?
    const activityLabels = ['Excavation', 'Foundation', 'Structure', 'Finishing'];
    const criticalCounts = [0, 0, 0, 0];
    const numIter = timeSim.phaseData.excavation.length;
    // Calculate means for each phase
    const phaseMeans = [
        timeSim.phaseData.excavation.reduce((a, b) => a + b, 0) / numIter,
        timeSim.phaseData.foundation.reduce((a, b) => a + b, 0) / numIter,
        timeSim.phaseData.structure.reduce((a, b) => a + b, 0) / numIter,
        timeSim.phaseData.finishing.reduce((a, b) => a + b, 0) / numIter,
    ];
    for (let i = 0; i < numIter; i++) {
        // Compare deviation from mean — the activity with the biggest variance drives the critical path
        const deviations = [
            Math.abs(timeSim.phaseData.excavation[i] - phaseMeans[0]),
            Math.abs(timeSim.phaseData.foundation[i] - phaseMeans[1]),
            Math.abs(timeSim.phaseData.structure[i] - phaseMeans[2]),
            Math.abs(timeSim.phaseData.finishing[i] - phaseMeans[3]),
        ];
        const maxIdx = deviations.indexOf(Math.max(...deviations));
        criticalCounts[maxIdx]++;
    }
    const criticalPathProbability = activityLabels.map((label, i) => ({
        activity: label,
        criticalPct: Math.round((criticalCounts[i] / numIter) * 100),
    })).sort((a, b) => b.criticalPct - a.criticalPct);

    return {
        cost_histogram: buildHistogram(totalCostRaw),
        cost_cdf: buildCDF(totalCostRaw),
        cost_p10: totalCostP10,
        cost_p50: totalCostP50,
        cost_p90: totalCostP90,
        cost_mean: totalCostMean,
        cost_sensitivity: utilityBase > 0
            ? [...costSim.sensitivity, {
                label: 'Utilities',
                low: costSim.mean + utilityBase * 0.80,
                high: costSim.mean + utilityBase * 1.20,
                range: utilityBase * 0.40,
            }].sort((a, b) => b.range - a.range)
            : costSim.sensitivity,

        time_histogram: timeSim.histogram,
        time_cdf: timeSim.cdf,
        time_p10: timeSim.p10,
        time_p50: timeSim.p50,
        time_p90: timeSim.p90,
        time_mean: timeSim.mean,
        time_sensitivity: timeSim.sensitivity,

        phases,
        numPhases: Math.max(3, numPhases),

        utility_costs: utilities.items,
        total_utility_cost: utilities.total,

        scurve_p10: sCurves.p10,
        scurve_p50: sCurves.p50,
        scurve_p90: sCurves.p90,

        gantt,
        delay_breakdown: timeSim.delay_breakdown,
        delivery_phases: deliveryPhases,

        // New: raw arrays for advanced charts
        cost_raw: totalCostRaw,
        time_raw: timeSim.rawTotals,
        cost_components_raw: costSim.rawComponents as any,
        critical_path_probability: criticalPathProbability,
    };
}
