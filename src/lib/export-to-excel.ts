import * as XLSX from 'xlsx';
import type { Project, Plot, AdvancedKPIs, ProjectEstimates } from '@/lib/types';
import type { AlgoParams } from '@/lib/generators/basic-generator';

export function exportProjectToExcel(
    project: Project,
    plot: Plot,
    metrics?: AdvancedKPIs | null,
    estimates?: ProjectEstimates | null,
    generationParams?: AlgoParams
) {
    const wb = XLSX.utils.book_new();

    // --- SHEET 1: Plot & Project Details ---
    const plotArea = plot.area || 0;
    const stats = plot.developmentStats;
    const builtUp = stats?.totalBuiltUpArea || metrics?.totalBuiltUpArea || 0;
    const achievedFAR = metrics?.achievedFAR ?? (builtUp && plotArea ? builtUp / plotArea : 0);
    const maxFloors = plot.buildings?.reduce((m, b) => Math.max(m, b.numFloors || 1), 0) || 0;
    const totalUnits = stats?.units?.total || 0;
    const requiredParking = metrics?.parking?.required || 0;
    const providedParking = metrics?.parking?.provided || 0;
    const far = plot.far || plot.regulation?.geometry?.floor_area_ratio?.value || 1.0;
    const maxCov = plot.maxCoverage || plot.regulation?.geometry?.max_ground_coverage?.value || 40;
    const gcPct = metrics?.groundCoveragePct ?? (stats?.maxBuildableArea ? (stats.maxBuildableArea / plotArea) * 100 : 0);

    const projectData = [
        ['Parameter', 'Value', 'Unit/Notes'],
        ['Project Name', project.name || 'Untitled', ''],
        ['Development Type', project.intendedUse || 'Residential', ''],
        ['Location', typeof plot.location === 'object' ? 'Coordinates' : String(plot.location || project.location || 'N/A'), ''],
        ['Plot Area', plotArea.toFixed(2), 'sq.m'],
        ['Target FAR', far.toString(), 'Max Ratio'],
        ['Achieved FAR', achievedFAR.toFixed(2), 'Ratio'],
        ['Max Ground Coverage', maxCov.toString(), '%'],
        ['Achieved Ground Coverage', gcPct.toFixed(2), '%'],
        ['Total Built-Up Area', builtUp.toFixed(2), 'sq.m'],
        ['Total Units', totalUnits.toString(), 'Units'],
        ['Number of Towers', (plot.buildings?.length || 0).toString(), 'Towers'],
        ['Max Floors', maxFloors.toString(), 'Floors (Above Ground)'],
        ['Parking Required', requiredParking.toString(), 'ECS'],
        ['Parking Provided', providedParking.toString(), 'ECS']
    ];

    const wsProject = XLSX.utils.aoa_to_sheet(projectData);
    // Autofit columns for Sheet 1
    wsProject['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsProject, 'Project Summary');


    // --- SHEET 2: Unit Mix & Buildings ---
    const unitMixData: any[] = [['Building Name', 'Footprint (sq.m)', 'Floors', 'Unit Type', 'Target Area (sq.m)', 'Count']];
    let hasUnits = false;

    if (plot.buildings && plot.buildings.length > 0) {
        plot.buildings.forEach(b => {
            if (b.units && b.units.length > 0) {
                b.units.forEach(u => {
                    hasUnits = true;
                    unitMixData.push([
                        b.name || b.id.slice(0, 8),
                        b.area?.toFixed(2) || '0',
                        b.numFloors || 1,
                        u.type || 'Standard',
                        u.targetArea?.toFixed(2) || '0',
                        '1 (Per floor representation)'
                    ]);
                });
            } else {
                unitMixData.push([
                    b.name || b.id.slice(0, 8),
                    b.area?.toFixed(2) || '0',
                    b.numFloors || 1,
                    'N/A',
                    'N/A',
                    'N/A'
                ]);
            }
        });
    }

    if (!hasUnits && stats?.units?.breakdown) {
        // Fallback to aggregate breakdown
        unitMixData.push(['---', '---', '---', '---', '---', '---']);
        unitMixData.push(['Aggregate Unit Mix', '', '', '', '', '']);
        Object.entries(stats.units.breakdown).forEach(([type, count]) => {
             unitMixData.push(['All', 'N/A', 'N/A', type, 'N/A', count.toString()]);
        });
    }

    const wsUnits = XLSX.utils.aoa_to_sheet(unitMixData);
    wsUnits['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsUnits, 'Unit Mix Details');


    // --- SHEET 3: Financial Estimates ---
    const financialData: any[] = [['Category', 'Item', 'Amount (₹)', 'Percentage / Notes']];
    
    if (estimates) {
        const cost = estimates.total_construction_cost || 0;
        const rev = estimates.total_revenue || 0;
        const profit = estimates.potential_profit || 0;
        const roi = estimates.roi_percentage || 0;

        financialData.push(['Summary', 'Total Construction Cost', cost, '']);
        financialData.push(['Summary', 'Total Target Revenue', rev, '']);
        financialData.push(['Summary', 'Potential Profit', profit, '']);
        financialData.push(['Summary', 'Estimated ROI', roi.toFixed(2), '%']);
        financialData.push(['', '', '', '']);

        if (estimates.cost_breakdown) {
            financialData.push(['Cost Breakdown', 'Superstructure', estimates.cost_breakdown.superstructure || 0, '']);
            financialData.push(['Cost Breakdown', 'Finishes', estimates.cost_breakdown.finishes || 0, '']);
            financialData.push(['Cost Breakdown', 'MEP', estimates.cost_breakdown.mep || 0, '']);
            financialData.push(['Cost Breakdown', 'Site Works', estimates.cost_breakdown.site_works || 0, '']);
            financialData.push(['Cost Breakdown', 'Contingency', estimates.cost_breakdown.contingency || 0, '']);
            financialData.push(['', '', '', '']);
        }

        if (estimates.timeline) {
            financialData.push(['Timeline', 'Total Months', estimates.timeline.total_months || 0, 'Months']);
            financialData.push(['Timeline', 'Design & Permitting', estimates.timeline.design_and_permitting || 0, 'Months']);
            financialData.push(['Timeline', 'Excavation & Foundation', estimates.timeline.excavation_and_foundation || 0, 'Months']);
            financialData.push(['Timeline', 'Superstructure', estimates.timeline.superstructure || 0, 'Months']);
            financialData.push(['Timeline', 'Finishes & MEP', estimates.timeline.finishes_and_mep || 0, 'Months']);
            financialData.push(['Timeline', 'Handover', estimates.timeline.handover || 0, 'Months']);
        }
    } else {
        financialData.push(['No Estimates Available', '', '', '']);
    }

    const wsFinance = XLSX.utils.aoa_to_sheet(financialData);
    wsFinance['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsFinance, 'Financial Estimates');

    // Download the file
    XLSX.writeFile(wb, `${project.name || 'Keystone_Project'}_Export.xlsx`);
}
