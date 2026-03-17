import { useState, useEffect, useMemo } from 'react';
import {
    Project,
    AdvancedKPIs,
    CostRevenueParameters,
    TimeEstimationParameter,
    PlanningParameter,
    ProjectEstimates,
    FeasibilityParams,
    StandardTimeEstimation
} from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { runFullSimulation } from '@/lib/cost-time-simulation';
import { calculateStandardTimeEstimates, BuildingTimeInput } from '@/lib/standard-time-calc';

export function useProjectEstimates(project: Project | null, metrics: AdvancedKPIs | null) {
    const projectId = project?.id;
    const [costs, setCosts] = useState<CostRevenueParameters[]>([]);
    const [times, setTimes] = useState<TimeEstimationParameter[]>([]);
    const [planning, setPlanning] = useState<PlanningParameter[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch all parameters on mount
    useEffect(() => {
        const fetchAllParams = async () => {
            if (!project) return;
            setIsLoading(true);
            try {
                // Fetch in parallel
                // console.log("Fetching new project parameters...");
                const [costSnap, timeSnap, planningSnap] = await Promise.all([
                    getDocs(collection(db, 'cost_revenue_parameters')),
                    getDocs(collection(db, 'time_parameters')),
                    getDocs(collection(db, 'planning_parameters'))
                ]);

                // console.log(`Fetched: ${costSnap.size} costs, ${timeSnap.size} times, ${planningSnap.size} planning params`);

                setCosts(costSnap.docs.map(d => d.data() as CostRevenueParameters));
                setTimes(timeSnap.docs.map(d => d.data() as TimeEstimationParameter));
                setPlanning(planningSnap.docs.map(d => d.data() as PlanningParameter));
            } catch (error) {
                console.error("Error fetching project parameters:", error);
            } finally {
                setIsLoading(false);
            }
        };



        if (costs.length === 0 || times.length === 0 || planning.length === 0) {
            fetchAllParams();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run ONLY once on mount or if explicitly recalled

    // Calculate Estimates
    
    // Create a stable dependency string for the core metrics and building data
    // to prevent continuous recalculation when insignificant project properties (like selection/hover state) change
    const projectDepsStr = useMemo(() => {
        if (!project || !metrics) return '';
        
        // Trigger recalculation when building or utility geometry/data changes.
        const allBuildings = project.plots?.flatMap(p => p.buildings || []) || [];
        const buildingData = allBuildings.map(b => {
            const utilityTypes = (b.utilities || []).join(',');
            const internalUtilities = (b.internalUtilities || [])
                .map(u => `${u.id}-${u.type}-${u.area}`)
                .join(',');
            return `${b.id}-${b.area}-${b.numFloors}-${b.height}-${b.intendedUse}-${utilityTypes}-${internalUtilities}`;
        }).join('|');
        const plotUtilityData = (project.plots || [])
            .map(p => (p.utilityAreas || []).map(u => `${u.id}-${u.type}-${u.area}`).join(','))
            .join('|');
        const metricsData = `${metrics.totalBuiltUpArea}-${metrics.totalPlotArea}`;
        
        return `${project.id}-${buildingData}-${plotUtilityData}-${metricsData}`;
    }, [
        project?.id,
        project?.plots?.map(p => [
            p.buildings?.map(b => {
                const utilityTypes = (b.utilities || []).join(',');
                const internalUtilities = (b.internalUtilities || [])
                    .map(u => `${u.id}-${u.type}-${u.area}`)
                    .join(',');
                return `${b.id}-${b.area}-${b.numFloors}-${b.height}-${b.intendedUse}-${utilityTypes}-${internalUtilities}`;
            }).join(','),
            p.utilityAreas?.map(u => `${u.id}-${u.type}-${u.area}`).join(','),
        ].join('|')).join('||'),
        metrics?.totalBuiltUpArea,
        metrics?.totalPlotArea
    ]);

    const estimates: ProjectEstimates | null = useMemo(() => {
        if (!project || !metrics || isLoading) return null;

        const location = typeof project.location === 'string' ? project.location : "Delhi"; // Default
        const buildingType = project.intendedUse || "Residential";

        let heightCategory: TimeEstimationParameter['height_category'] = 'Mid-Rise (15-45m)';

        // console.log("Estimating for:", { location, buildingType, heightCategory });

        // 1. MATCH COST PARAMETERS
        const lookupType = buildingType === 'Mixed-Use' ? 'Mixed Use' : buildingType;
        let costParam = costs.find(c => c.location === location && c.building_type === lookupType);
        if (!costParam) {
            // console.log("Exact match not found. Trying Delhi fallback...");
            costParam = costs.find(c => c.location === 'Delhi' && c.building_type === lookupType);
        }
        if (!costParam) {
            // console.log("Delhi fallback not found. Using first available.");
            costParam = costs[0];
        }

        // console.log("Selected Cost Param:", costParam);

        // 2. MATCH TIME PARAMETERS
        const timeParam = times.find(t => t.building_type === buildingType && t.height_category === heightCategory)
            || times[0];
        // console.log("Selected Time Param:", timeParam);

        // 3. MATCH PLANNING PARAMETERS
        const planParam = planning.find(p => p.building_type === buildingType && p.height_category === heightCategory)
            || planning[0];
        // console.log("Selected Plan Param:", planParam);

        if (!costParam || !timeParam) {
            console.warn("CRITICAL: Missing cost or time params. Returning null.");
            return null;
        }

        // --- CALCULATIONS ---
        let totalCost = 0;
        let totalRev = 0;
        let totalEarthwork = 0;
        let totalStructure = 0;
        let totalFinishing = 0;
        let totalServices = 0;
        const perBuildingBreakdown: any[] = [];
        let maxTimelineMonths = 0;
        let criticalPathPhases = { excavation: 0, foundation: 0, structure: 0, finishing: 0, overlap: 0, contingency: 0 };
        let isPotential = false;

        // Iterate over all buildings to calculate specific costs
        let processedGFA = 0;
        const buildings = project.plots.flatMap(p => p.buildings);
        
        // Helper to get time param for a specific building
        const getTimeParam = (bType: string, height: number) => {
            let hCat: TimeEstimationParameter['height_category'] = 'Mid-Rise (15-45m)';
            if (height < 15) hCat = 'Low-Rise (<15m)';
            if (height > 45) hCat = 'High-Rise (>45m)';
            return times.find(t => t.building_type === bType && t.height_category === hCat) || timeParam;
        };

        const getCostParam = (bType: string) => {
            return costs.find(c => c.location === location && c.building_type === bType) || costParam;
        }

        if (buildings.length > 0) {
            buildings.forEach(b => {
                const bType = b.intendedUse || buildingType;
                const bCostParam = getCostParam(bType);
                const bTimeParam = getTimeParam(bType, b.height);
                
                // Estimate GFA for this building
                // Count above-ground floors + basement floors
                const aboveGroundFloors = b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3));
                const basementFloors = b.floors ? b.floors.filter(f => f.level !== undefined && f.level < 0).length : 0;
                const totalFloors = aboveGroundFloors + basementFloors;
                
                const footprint = b.area;
                const bGFA = footprint * totalFloors;

                // Height-based cost multiplier
                // Taller buildings require stronger structure/MEP systems
                let heightMultiplier = 1.0;
                if (b.height > 45) {
                    // High-Rise: +15% for additional structural/MEP complexity
                    heightMultiplier = 1.15;
                } else if (b.height > 15) {
                    // Mid-Rise: +5% for moderate complexity
                    heightMultiplier = 1.05;
                }
                // Low-Rise (<15m): standard cost

                processedGFA += bGFA;

                // Break down cost for this building with height multiplier
                const bEarthwork = bGFA * bCostParam.earthwork_cost_per_sqm;
                const bStructure = bGFA * bCostParam.structure_cost_per_sqm * heightMultiplier;
                const bFinishing = bGFA * bCostParam.finishing_cost_per_sqm;
                const bServices = bGFA * bCostParam.services_cost_per_sqm * heightMultiplier;
                
                // Basement cost adjustment (additional earthwork & waterproofing)
                // Each basement level adds ~15% to earthwork cost (deeper excavation, more waterproofing)
                let basementCostMultiplier = 1.0;
                if (basementFloors > 0) {
                    basementCostMultiplier = 1 + (basementFloors * 0.15); // +15% per basement level
                }
                const adjustedEarthwork = bEarthwork * basementCostMultiplier;
                
                const bCost = adjustedEarthwork + bStructure + bFinishing + bServices;
                const bRev = bGFA * bCostParam.sellable_ratio * bCostParam.market_rate_per_sqm;
                
                totalCost += bCost;
                totalRev += bRev;
                
                // Aggregate components
                totalEarthwork += adjustedEarthwork;
                totalStructure += bStructure;
                totalFinishing += bFinishing;
                totalServices += bServices;

                // Timeline
                const isTower = b.id.includes('-tower');
                let startOffset = 0;

                if (isTower) {
                    const podiumId = b.id.replace('-tower', '-podium');
                    const podium = buildings.find(p => p.id === podiumId);
                    if (podium) {
                        const pTimeParam = getTimeParam(podium.intendedUse || buildingType, podium.height);
                        const pAboveGroundFloors = podium.numFloors || Math.ceil(podium.height / (podium.typicalFloorHeight || 3));
                        const pBasementFloors = podium.floors ? podium.floors.filter(f => f.level !== undefined && f.level < 0).length : 0;
                        const pTotalFloors = pAboveGroundFloors + pBasementFloors;
                        // Tower starts after podium excavation, foundation, and structure
                        startOffset = pTimeParam.excavation_timeline_months + pTimeParam.foundation_timeline_months + ((pTotalFloors * pTimeParam.structure_per_floor_days) / 30);
                    }
                }

                // Parallel crews factor (same as standard-time-calc)
                const typicalFloorPlate = bGFA / (aboveGroundFloors || 1);
                const parallelCrews = Math.max(1, Math.ceil(typicalFloorPlate / 600));

                // Towers don't need their own excavation/foundation - they use the podium's
                // Use area-based calculation (matching Standard Timeline), but allow admin override if explicitly > 0
                const totalExcavationArea = footprint * (1 + (basementFloors * 0.5));
                const excDays = Math.max(7, Math.ceil((totalExcavationArea / 300) / (parallelCrews * 1.5)));
                const excMonthsCalc = excDays / 26;
                const excMonths = isTower ? 0 : (bTimeParam.excavation_timeline_months > 0 ? Math.min(bTimeParam.excavation_timeline_months, excMonthsCalc) : excMonthsCalc);
                const fndDays = Math.max(15, Math.ceil((footprint / 2.5) / (parallelCrews * 1.5)));
                const fndMonthsCalc = fndDays / 26;
                const fndMonths = isTower ? 0 : (bTimeParam.foundation_timeline_months > 0 ? Math.min(bTimeParam.foundation_timeline_months, fndMonthsCalc) : fndMonthsCalc);
                const basementMonths = basementFloors > 0
                    ? (footprint * basementFloors / 6.5 / (parallelCrews * 1.5)) / 26
                    : 0;

                const structureDays = totalFloors * bTimeParam.structure_per_floor_days;
                const finishingDays = totalFloors * bTimeParam.finishing_per_floor_days;
                const overlapMonths = (finishingDays / 30) * bTimeParam.services_overlap_factor;

                const totalDays = 
                    (excMonths * 30) +
                    (fndMonths * 30) +
                    (basementMonths * 26) +
                    structureDays +
                    finishingDays - 
                    (overlapMonths * 30) +
                    (bTimeParam.contingency_buffer_months * 30);
                
                const bMonths = totalDays / 30;
                const timelineEnd = startOffset + bMonths;
                
                // Track critical path (longest duration building)
                if (timelineEnd > maxTimelineMonths) {
                    maxTimelineMonths = timelineEnd;
                    criticalPathPhases = {
                        excavation: excMonths,
                        foundation: fndMonths,
                        structure: structureDays / 30,
                        finishing: finishingDays / 30,
                        overlap: overlapMonths,
                        contingency: bTimeParam.contingency_buffer_months
                    };
                }

                perBuildingBreakdown.push({
                    buildingId: b.id,
                    buildingName: b.name || `Building ${b.id.slice(0, 4)}`,
                    timeline: {
                        startOffset: startOffset,
                        total: bMonths,
                        excavation: excMonths,
                        foundation: fndMonths,
                        basement: basementMonths,
                        substructure: excMonths + fndMonths + basementMonths,
                        structure: structureDays / 30,
                        finishing: (finishingDays / 30) - overlapMonths,
                        contingency: bTimeParam.contingency_buffer_months
                    },
                    cost: {
                        total: bCost,
                        ratePerSqm: bCostParam.total_cost_per_sqm
                    },
                    gfa: bGFA,
                    floors: totalFloors,
                    utilities: Array.from(new Set([
                        ...(b.utilities || []),
                        ...(b.internalUtilities?.map(u => u.type) || [])
                    ]))
                });
            });
        } else {
             // Fallback if no buildings generated yet (use plot potential)
            isPotential = true;
            
            // Wait, if the user explicitly deleted all buildings on an active plot, we shouldn't show massive "potential" costs
            // No potential fallback if the plot is empty. User requested 0.
            let gfa = metrics.totalBuiltUpArea;
            
            totalEarthwork = gfa * costParam.earthwork_cost_per_sqm;
            totalStructure = gfa * costParam.structure_cost_per_sqm;
            totalFinishing = gfa * costParam.finishing_cost_per_sqm;
            totalServices = gfa * costParam.services_cost_per_sqm;
            totalCost = totalEarthwork + totalStructure + totalFinishing + totalServices;
            
            totalRev = gfa * costParam.sellable_ratio * costParam.market_rate_per_sqm;
            
            // Standard timeline for potential
            if (gfa > 0) {
                const floors = Math.ceil(metrics.achievedFAR / (metrics.groundCoveragePct / 100 || 0.4)) || 10;
                const structureDays = floors * timeParam.structure_per_floor_days;
                const finishingDays = floors * timeParam.finishing_per_floor_days;
                const overlapMonths = (finishingDays / 30) * timeParam.services_overlap_factor;
                 const totalDays =
                    (timeParam.excavation_timeline_months * 30) +
                    (timeParam.foundation_timeline_months * 30) +
                    structureDays +
                    finishingDays -
                    (overlapMonths * 30) +
                    (timeParam.contingency_buffer_months * 30);
                maxTimelineMonths = totalDays / 30;
                
                criticalPathPhases = {
                    excavation: timeParam.excavation_timeline_months,
                    foundation: timeParam.foundation_timeline_months,
                    structure: structureDays / 30,
                    finishing: finishingDays / 30,
                    overlap: overlapMonths,
                    contingency: timeParam.contingency_buffer_months
                };
            } else {
                maxTimelineMonths = 0;
                criticalPathPhases = {
                    excavation: 0,
                    foundation: 0,
                    structure: 0,
                    finishing: 0,
                    overlap: 0,
                    contingency: 0
                };
            }
            
            // Generate basic plot timeline if needed
            // (The variables above correctly set the maxTimeline and critical path)
        }

        // Add 5% contingency to total cost (if not already in param, but param usually has raw. Let's add project level soft cost buffer?)
        // The doc says "Soft Costs & Add-Ons... usually 5-10% of build cost". 
        // Our params have "total_cost_per_sqm", let's assume it includes construction but maybe not all soft costs.
        // Let's stick to the parameter's "total" for now to match admin panel expectation, 
        // OR add the contingency here as per previous logic.
        // Previous logic: constructionCost.contingency = subTotal * 0.05;
        // The params in Admin Panel show "Total Construction Cost" which sums up the components.
        // Let's apply limiting factors.
        
        // Add 5% contingency on top of everything
        const contingency = totalCost * 0.05;
        const finalTotalCost = totalCost + contingency; 

        // Profit
        const profit = totalRev - finalTotalCost; 
        const roi = finalTotalCost > 0 ? (profit / finalTotalCost) * 100 : 0;

        // D. Efficiency
        const achievedEfficiency = isPotential ? (planParam?.efficiency_target || 0.75) : metrics.efficiency;
        const targetEfficiency = planParam?.efficiency_target || 0.75;

        let effStatus: 'Optimal' | 'Inefficient' | 'Aggressive' = 'Optimal';
        if (!isPotential) {
            if (achievedEfficiency < targetEfficiency - 0.05) effStatus = 'Inefficient';
            if (achievedEfficiency > targetEfficiency + 0.05) effStatus = 'Aggressive';
        }

        // ─── UTILITIES PRESENT ─────────────────────────────────────────
        const utilitiesSet = new Set<string>();
        if (!isPotential && project.plots) {
            project.plots.forEach(p => {
                if (p.utilityAreas) p.utilityAreas.forEach(u => { utilitiesSet.add(u.type); if (u.name) utilitiesSet.add(u.name); });
            });
            buildings.forEach(b => {
                if (b.utilities) b.utilities.forEach(u => utilitiesSet.add(u));
                if (b.internalUtilities) b.internalUtilities.forEach(u => { utilitiesSet.add(u.type); if (u.name) utilitiesSet.add(u.name); });
                if (b.cores && b.cores.length > 0) {
                    utilitiesSet.add('Core');
                    utilitiesSet.add('Lifts');
                    utilitiesSet.add('Fire Fighting');
                }
            });
        }
        // If isPotential AND no built-up area, use empty array so hasUtility returns false for everything
        const utilitiesPresent = isPotential
            ? (metrics.totalBuiltUpArea > 0 ? undefined : [])
            : Array.from(utilitiesSet);

        // ─── MONTE CARLO SIMULATION ────────────────────────────────────
        // Run full simulation using the matched cost/time params
        const simGFA = isPotential
            ? metrics.totalBuiltUpArea
            : processedGFA;

        // If GFA is 0, floors should be 0 too (not fallback to 10)
        const simFloors = simGFA === 0 ? 0
            : isPotential
                ? (Math.ceil(metrics.achievedFAR / (metrics.groundCoveragePct / 100 || 0.4)) || 10)
                : (buildings.length > 0 ? Math.max(...buildings.map(b => b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3)))) : 10);

        // Count actual lifts from building core data for accurate budget
        const totalLiftCount = buildings.reduce((sum, b) => 
            sum + (b.cores ? b.cores.filter(c => c.type === 'Lift').length : 0), 0);

        // Accumulate surface parking for solar calculation
        let totalSurfaceParkingArea = 0;
        if (!isPotential && project.plots) {
            project.plots.forEach(p => {
                if (p.parkingAreas) {
                    totalSurfaceParkingArea += p.parkingAreas
                        .filter(pa => pa.type === 'Surface' || pa.type === 'Stilt' || pa.type === 'Podium')
                        .reduce((acc, pa) => acc + pa.area, 0);
                }
            });
        }

        let simulation;
        try {
            // Skip simulation entirely if nothing to simulate
            if (simGFA > 0) {
                simulation = runFullSimulation({
                    costParam,
                    timeParam,
                    gfa: simGFA,
                    floors: simFloors,
                    numPhases: 3, // Default; UI can override
                    iterations: 3000, // ~3000 for performance
                    numLifts: totalLiftCount > 0 ? totalLiftCount : undefined,
                    utilitiesPresent: utilitiesPresent,
                    perBuildingBreakdown: perBuildingBreakdown,
                    surfaceParkingArea: totalSurfaceParkingArea,
                });
            }
        } catch (e) {
            console.warn('Simulation failed:', e);
        }

        // ─── ALLOCATE UTILITY COSTS PER BUILDING ───────────────────────
        if (simulation && perBuildingBreakdown.length > 0) {
            const totalBuildingGFA = perBuildingBreakdown.reduce((s: number, b: any) => s + (b.gfa || 0), 0);
            perBuildingBreakdown.forEach((b: any) => {
                b.utilityCost = totalBuildingGFA > 0
                    ? simulation!.total_utility_cost * ((b.gfa || 0) / totalBuildingGFA)
                    : 0;
            });
        }

        // ─── AREA-BASED STANDARD TIME ──────────────────────────────────
        let standardTimeEstimates: StandardTimeEstimation | undefined;
        try {
            if (!isPotential && buildings.length > 0) {
                const bInputs: BuildingTimeInput[] = buildings.map(b => {
                    const floors = b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3));
                    const bGFA = b.area * floors;
                    const bsmntLevels = b.floors ? b.floors.filter(f => f.level !== undefined && f.level < 0).length : 0;
                    
                    return {
                        buildingId: b.id,
                        buildingName: b.name || `Building ${b.id.slice(0, 4)}`,
                        gfaSqm: bGFA,
                        footprintSqm: b.area,
                        floors: floors,
                        basements: bsmntLevels
                    };
                });
                standardTimeEstimates = calculateStandardTimeEstimates(bInputs, project.totalPlotArea || metrics.totalPlotArea);
                
                // Sync the calculated staggered offsets back to the legacy perBuildingBreakdown
                maxTimelineMonths = 0; // Reset to recalculate with proper staggering
                perBuildingBreakdown.forEach(pb => {
                    const matchedStandard = standardTimeEstimates?.buildings.find((sb: any) => sb.buildingId === pb.buildingId);
                    if (matchedStandard) {
                        pb.timeline.startOffset = matchedStandard.offsetMonths || 0;
                    }
                    const timelineEnd = pb.timeline.startOffset + pb.timeline.total;
                    if (timelineEnd > maxTimelineMonths) {
                        maxTimelineMonths = timelineEnd;
                    }
                });
            }
        } catch(e) {
            console.warn('Standard time calculation failed:', e);
        }

        return {
            isPotential,
            total_construction_cost: finalTotalCost,
            cost_breakdown: {
                earthwork: totalEarthwork,
                structure: totalStructure,
                finishing: totalFinishing,
                services: totalServices,
                contingency: contingency
            },
            total_revenue: totalRev,
            potential_profit: profit,
            roi_percentage: roi,
            timeline: {
                total_months: maxTimelineMonths,
                phases: criticalPathPhases
            },
            efficiency_metrics: {
                achieved: achievedEfficiency,
                target: targetEfficiency,
                status: effStatus
            },
            standardTimeEstimates,
            breakdown: perBuildingBreakdown,
            simulation,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectDepsStr, costs, times, planning, isLoading]);

    return { estimates, isLoading, params: { costs, times, planning } };
}
