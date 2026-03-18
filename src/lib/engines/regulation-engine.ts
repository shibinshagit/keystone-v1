
import {
    Project,
    AdvancedKPIs,
    RegulationData,
    GreenRegulationData,
    VastuRegulationData,
    VASTU_ZONES_32,
    ComplianceItem,
    AdditiveScoreSummary
} from '../types';
import * as turf from '@turf/turf';
import { getVastuCenter } from '../vastu-utils';
// Default Vastu checklist used when no admin-uploaded rules are attached
import defaultVastuChecklist from '../../data/ultimate-vastu-checklist.json';

export class RegulationEngine {
    private project: Project;
    private regulations: RegulationData | null;
    private greenStandards: GreenRegulationData | null;
    private vastuRules: VastuRegulationData | null;

    constructor(
        project: Project,
        regulations: RegulationData | null = null,
        greenStandards: GreenRegulationData | null = null,
        vastuRules: VastuRegulationData | null = null
    ) {
        this.project = project;
        this.regulations = regulations;
        this.greenStandards = greenStandards;
    // If no explicit vastuRules provided, fall back to the bundled ultimate checklist JSON
    this.vastuRules = vastuRules || (defaultVastuChecklist as any);
    }

    public calculateMetrics(): AdvancedKPIs {
        // 1. Basic Area Metrics
        const areaMetrics = this.calculateAreaMetrics();

        // 2. Service & Amenities (Phase 3: Detailed Logic)
        const serviceMetrics = this.estimateServices(areaMetrics.totalBuiltUpArea);

        // 3. Green KPIs (Phase 3: Real Road Area)
        const greenMetrics = this.calculateGreenKPIs(areaMetrics.totalPlotArea);

        // 4. Housing & Parking
        const housingMetrics = this.calculateHousingMetrics(areaMetrics.totalBuiltUpArea);

        // 5. Compliance Scores
        const compliance = this.calculateCompliance(areaMetrics, greenMetrics);

        const netSaleable = areaMetrics.totalBuiltUpArea - areaMetrics.coreArea - areaMetrics.circulationArea - serviceMetrics.services.total - serviceMetrics.amenities.total;
        const efficiency = areaMetrics.totalBuiltUpArea > 0 ? netSaleable / areaMetrics.totalBuiltUpArea : 0;

        return {
            ...areaMetrics,
            ...serviceMetrics,
            ...greenMetrics,
            ...housingMetrics,
            compliance,
            efficiency,
        };
    }

    private calculateAreaMetrics() {
        let consumedPlotArea = 0;
        let totalBuiltUpArea = 0;
        let groundCoverageArea = 0;

        // Plot Area
        this.project.plots.forEach(plot => {
            consumedPlotArea += plot.area;

            // Building Areas
            plot.buildings.forEach(b => {
                if (b.visible === false) return;

                // Ground Coverage (Approximate by footprint area)
                groundCoverageArea += b.area;

                // Total Built-up (GFA) - Excluding parking floors if needed
                let fsiFloors = b.floors.filter(f => f.type !== 'Parking').length;
                if (fsiFloors === 0) fsiFloors = b.numFloors; // Fallback

                totalBuiltUpArea += (b.area * fsiFloors);
            });
        });



        const totalPlotArea = this.project.totalPlotArea || consumedPlotArea;

        // Achieved FAR
        const achievedFAR = totalPlotArea > 0 ? (totalBuiltUpArea / totalPlotArea) : 0;
        const groundCoveragePct = totalPlotArea > 0 ? (groundCoverageArea / totalPlotArea) * 100 : 0;

        return {
            totalPlotArea,
            consumedPlotArea,
            totalBuiltUpArea,
            achievedFAR,
            groundCoveragePct,

            // Estimates (will be refined by detailed calculation)
            sellableArea: totalBuiltUpArea * 0.70,
            circulationArea: totalBuiltUpArea * 0.15,
            coreArea: totalBuiltUpArea * 0.10,
        };
    }

    private estimateServices(totalBuiltUpArea: number) {
        // 1. Calculate Services based on Project Intent & Building Types
        // Standards: width ratios or percentage of GFA
        // Residential: ~5-7%, Commercial: ~10-12% (AHUs, Server rooms)

        let servicePct = 0.05; // Default Residential
        if (this.project.intendedUse === 'Commercial') servicePct = 0.10;
        if (this.project.intendedUse === 'Mixed-Use') servicePct = 0.08;

        const totalServices = totalBuiltUpArea * servicePct;

        return {
            services: {
                total: totalServices,
                electrical: totalServices * 0.35, // Substations, DG sets
                mech: totalServices * 0.40,      // HVAC, Pump rooms
                plumbing: totalServices * 0.25,  // STP/WTP internal parts
            },
            amenities: {
                total: totalBuiltUpArea * 0.03, // 3% for amenities (Clubhouse etc)
                definedList: {
                    'Gym': 100,
                    'Community Hall': 200,
                    'Swimming Pool': 80 // Equivalent built area
                }
            }
        };
    }

    private calculateGreenKPIs(totalPlotArea: number) {
        let greenAreaTotal = 0;

        // 1. Dedicated Green Zones
        this.project.plots.forEach(p => {
            p.greenAreas.forEach(g => {
                if (g.visible) greenAreaTotal += g.area;
            });
        });

        // 2. Road Area (Real calculation from 'Roads' utility zones)
        let roadArea = 0;
        this.project.plots.forEach(p => {
            // Look for UtilityAreas tagged as 'Roads'
            if (p.utilityAreas) {
                p.utilityAreas.forEach(u => {
                    if (u.type === 'Roads' && u.visible) roadArea += u.area;
                });
            }
        });

        // 3. Open Space
        // Open Space = Plot Area - Building Footprint of all Buildings
        let totalFootprint = 0;
        this.project.plots.forEach(p => {
            p.buildings.forEach(b => { if (b.visible) totalFootprint += b.area; });
        });

        const openSpace = Math.max(0, totalPlotArea - totalFootprint);

        return {
            greenArea: {
                total: greenAreaTotal,
                percentage: totalPlotArea > 0 ? (greenAreaTotal / totalPlotArea) * 100 : 0,
                perCapita: 5.5, // TODO: Link to Total Units * Avg Household Size
            },
            roadArea,
            openSpace
        };
    }

    private calculateHousingMetrics(totalBuiltUpArea: number) {
        // Use actual dwelling units from buildings
        let totalUnits = 0;
        this.project.plots.forEach(p => {
            p.buildings.forEach((b: any) => {
                if (b.visible !== false) {
                    totalUnits += b.units?.length || 0;
                }
            });
        });
        // Fallback to GFA estimate if no actual units exist
        if (totalUnits === 0) totalUnits = Math.floor(totalBuiltUpArea / 100);

        // Parking Norms: Defaults to 1 per unit if no regulations found
        let parkingRatio = 1;
        if (this.regulations && this.regulations.facilities && this.regulations.facilities.parking) {
            parkingRatio = this.regulations.facilities.parking.value;
        }

        const requiredParking = Math.ceil(totalUnits * parkingRatio);

        // Calculate Provided Parking
        let providedParking = 0;
        const breakdown = { stilt: 0, basement: 0, surface: 0, podium: 0 };

        this.project.plots.forEach(p => {
            // 1. Parking Areas
            p.parkingAreas.forEach(pa => {
                const cap = pa.capacity || Math.floor(pa.area / 30);
                providedParking += cap;
                if (pa.type === 'Basement') breakdown.basement += cap;
                else if (pa.type === 'Stilt') breakdown.stilt += cap;
                else if (pa.type === 'Podium') breakdown.podium += cap;
                else breakdown.surface += cap;
            });

            // 2. Building Floors (Stilt/Podium/Basement)
            p.buildings.forEach(b => {
                if (b.visible === false) return;
                b.floors.forEach(f => {
                    if (f.type === 'Parking') {
                        const cap = f.parkingCapacity || Math.floor(b.area / 30);
                        providedParking += cap;

                        // Categorize
                        if (f.parkingType === 'Basement') breakdown.basement += cap;
                        else if (f.parkingType === 'Stilt') breakdown.stilt += cap;
                        else if (f.parkingType === 'Podium') breakdown.podium += cap;
                        else breakdown.podium += cap; // Default to podium for structured parking
                    }
                });
            });
        });

        return {
            totalUnits,
            parking: {
                required: requiredParking,
                provided: providedParking,
                breakdown
            }
        };
    }

    private resolveLimit(
        regPath: (reg: RegulationData) => any,
        plotPaths: ((p: any) => any)[]
    ): number | undefined {
        if (this.regulations) {
            const val = regPath(this.regulations);
            if (val !== undefined && val !== null) return Number(val);
        }
        for (const plot of this.project.plots) {
            for (const accessor of plotPaths) {
                const val = accessor(plot);
                if (val !== undefined && val !== null) return Number(val);
            }
        }
        return undefined;
    }

    private getAzimuth(cx: number, cy: number, ux: number, uy: number): number {
        // Use turf.bearing for correct geographic bearing (handles lon/lat properly)
        const bearing = turf.bearing([cx, cy], [ux, uy]);
        return (bearing + 360) % 360; // Normalize to 0-360 compass bearing
    }

    private getVisibleBuildings() {
        return this.project.plots.flatMap((plot) => plot.buildings.filter((building) => building.visible !== false));
    }

    private getAllUtilities() {
        return this.project.plots.flatMap((plot) => plot.utilityAreas || []);
    }

    private getAllEntries() {
        return this.project.plots.flatMap((plot) => plot.entries || []);
    }

    private getApprovalStatus(key: 'buildingPlan' | 'environmentClearance' | 'fireNoc' | 'utilityConnections') {
        return this.project.underwriting?.approvals?.[key];
    }

    private getZoneBearing(plot: any, feature: any): number | null {
        try {
            const plotCenter = getVastuCenter(plot.geometry);
            const featureCenter = feature.centroid || turf.centroid(feature.geometry);
            return (turf.bearing(plotCenter, featureCenter) + 360) % 360;
        } catch {
            return null;
        }
    }

    private isBearingInRange(bearing: number, min: number, max: number): boolean {
        if (min <= max) return bearing >= min && bearing <= max;
        return bearing >= min || bearing <= max;
    }

    private getFeaturesInBearingRange(features: any[], plot: any, min: number, max: number, predicate?: (feature: any) => boolean) {
        return features.filter((feature) => {
            if (predicate && !predicate(feature)) return false;
            const bearing = this.getZoneBearing(plot, feature);
            return bearing !== null && this.isBearingInRange(bearing, min, max);
        });
    }

    private getLargestBuildingInRange(plot: any, min: number, max: number) {
        const buildings = this.getFeaturesInBearingRange(
            plot.buildings.filter((building: any) => building.visible !== false),
            plot,
            min,
            max
        ) as any[];

        return buildings.sort((a, b) => (b.height || b.area || 0) - (a.height || a.area || 0))[0];
    }

    private evaluatePlotShape(plot: any): 'pass' | 'warn' | 'fail' {
        try {
            const ring = plot.geometry.geometry.coordinates[0] || [];
            const vertexCount = Math.max(0, ring.length - 1);
            const bbox = turf.bbox(plot.geometry);
            const bboxArea = Math.max(0, turf.area(turf.bboxPolygon(bbox)));
            const plotArea = Math.max(0, turf.area(plot.geometry));
            const rectangularity = bboxArea > 0 ? plotArea / bboxArea : 0;

            if (vertexCount === 4 && rectangularity > 0.9) return 'pass';
            if (vertexCount <= 6 && rectangularity > 0.75) return 'warn';
            return 'fail';
        } catch {
            return 'warn';
        }
    }

    private createScoreItem(
        label: string,
        status: 'pass' | 'fail' | 'warn' | 'na',
        detail: string,
        maxScore: number
    ): ComplianceItem {
            // New additive scoring: each item contributes points rather than additive weights.
            // pass -> 1 point, warn -> 0.5 point, fail -> 0 point. We still keep maxScore for legacy point display,
            // but achievedPoints is the normalized 0-1 contribution used for ranking/percentage calculations.
            const achievedPoints = status === 'pass' ? 1 : status === 'warn' ? 0.5 : status === 'na' ? 0 : 0;

            return {
                label,
                status,
                detail,
                weight: maxScore,
                maxScore,
                // Legacy field kept for UI (points out of weight) - map to 0..maxScore scale for display
                achievedScore: Math.round((achievedPoints * maxScore) * 100) / 100,
                // expose normalized points for engine consumption
                achievedPoints
            } as any;
    }

    private calcAdditiveScore(items: ComplianceItem[]): AdditiveScoreSummary {
    // Eligible items: exclude 'na' and items that have no weight assigned
    const eligibleItems = items.filter((item) => item.status !== 'na' && item.maxScore > 0);

    // Sum of legacy displayed scores (achievedScore) and sum of weights
    const maxScore = eligibleItems.reduce((sum, item) => sum + item.maxScore, 0);
    const totalScore = eligibleItems.reduce((sum, item) => sum + (item.achievedScore || 0), 0);

    // Compute additive ranking points: use the achievedPoints field when present (1 for pass, 0.5 warn, 0 fail)
    const pointSum = eligibleItems.reduce((sum, item) => sum + ((item as any).achievedPoints ?? (item.achievedScore > 0 ? 1 : 0)), 0);
    const maxPoints = eligibleItems.length; // each eligible item contributes max 1 point

    const percentage = maxPoints > 0 ? Math.round((pointSum / maxPoints) * 100) : 0;

    return { totalScore, maxScore, percentage };
    }

    private calculateCompliance(areaMetrics: any, greenMetrics: any) {
        const bylawItems: ComplianceItem[] = [];
        const greenItems: ComplianceItem[] = [];

        // ========== BYLAWS ==========

        const visibleBuildings = this.getVisibleBuildings();
        const allUtilities = this.getAllUtilities();
        const allEntries = this.getAllEntries();
        const tallestBuilding = visibleBuildings.reduce((tallest, building) => {
            const height = building.height || (building.numFloors * 3.5);
            return height > tallest ? height : tallest;
        }, 0);
        const roadAccessCount = this.project.plots.reduce((count, plot) => count + (plot.roadAccessSides?.length || 0), 0);
        const hasRoadUtility = allUtilities.some((utility: any) => String(utility.type || '').toLowerCase() === 'roads');
        const soilCoverage = visibleBuildings.length > 0 && visibleBuildings.every((building) =>
            building.soilData?.ph !== null && building.soilData?.ph !== undefined &&
            building.soilData?.bd !== null && building.soilData?.bd !== undefined
        );
        const basePlotArea = this.project.plots.reduce((sum, plot) => sum + (plot.area || 0), 0);
        if (basePlotArea > 0) {
            bylawItems.push(this.createScoreItem(
                'Minimum Plot Size',
                basePlotArea >= 60 ? 'pass' : basePlotArea >= 30 ? 'warn' : 'fail',
                `${Math.round(basePlotArea)} sqm`,
                150
            ));
        }

        if (allEntries.length > 0 || roadAccessCount > 0 || hasRoadUtility) {
            bylawItems.push(this.createScoreItem(
                'Plot Access / Frontage',
                allEntries.length > 0 || roadAccessCount > 0 ? 'pass' : 'warn',
                `${allEntries.length} entries, ${roadAccessCount} road sides`,
                120
            ));
        }

        const buildingPlanStatus = this.getApprovalStatus('buildingPlan');
        if (buildingPlanStatus) {
            bylawItems.push(this.createScoreItem(
                'Building Plan Approval',
                buildingPlanStatus === 'Approved' ? 'pass' : buildingPlanStatus === 'Pending' ? 'warn' : 'fail',
                buildingPlanStatus,
                120
            ));
        }

        const envClearanceStatus = this.getApprovalStatus('environmentClearance');
        if (envClearanceStatus && envClearanceStatus !== 'Not Applicable') {
            bylawItems.push(this.createScoreItem(
                'Environmental Clearance',
                envClearanceStatus === 'Approved' ? 'pass' : 'warn',
                envClearanceStatus,
                80
            ));
        }

        // FAR
        const maxFAR = this.resolveLimit(
            r => r.geometry?.floor_area_ratio?.value || r.geometry?.max_far?.value || r.geometry?.fsi?.value,
            [p => p.far, p => p.userFAR, p => p.regulation?.geometry?.floor_area_ratio?.value]
        );
        if (maxFAR !== undefined) {
            bylawItems.push(this.createScoreItem(
                `FAR (≤${maxFAR})`,
                areaMetrics.achievedFAR <= maxFAR ? 'pass' : 'fail',
                `${areaMetrics.achievedFAR.toFixed(2)} / ${maxFAR}`,
                80
            ));
        }

        // Height
        const maxHeight = this.resolveLimit(
            r => r.geometry?.max_height?.value,
            [p => p.maxBuildingHeight, p => p.regulation?.geometry?.max_height?.value]
        );
        if (maxHeight !== undefined) {
            bylawItems.push(this.createScoreItem(
                `Height (≤${maxHeight}m)`,
                tallestBuilding <= maxHeight ? 'pass' : 'fail',
                `${tallestBuilding.toFixed(1)}m / ${maxHeight}m`,
                60
            ));
        }

        bylawItems.push(this.createScoreItem(
            'High-Rise Definition Compliance',
            tallestBuilding > 15
                ? (hasRoadUtility ? 'pass' : 'warn')
                : 'pass',
            tallestBuilding > 15 ? 'High-rise checks depend on fire access + NOC' : 'Not a high-rise',
            30
        ));

        // Coverage
        const maxCov = this.resolveLimit(
            r => r.geometry?.max_ground_coverage?.value,
            [p => p.maxCoverage, p => p.regulation?.geometry?.max_ground_coverage?.value]
        );
        if (maxCov !== undefined) {
            bylawItems.push(this.createScoreItem(
                `Coverage (≤${maxCov}%)`,
                areaMetrics.groundCoveragePct <= maxCov ? 'pass' : 'fail',
                `${areaMetrics.groundCoveragePct.toFixed(1)}% / ${maxCov}%`,
                60
            ));
        }

        const openSpacePct = areaMetrics.totalPlotArea > 0 ? (greenMetrics.openSpace / areaMetrics.totalPlotArea) * 100 : 0;
        bylawItems.push(this.createScoreItem(
            'Open Space Ratio',
            openSpacePct >= 15 ? 'pass' : openSpacePct >= 10 ? 'warn' : 'fail',
            `${openSpacePct.toFixed(1)}% open space`,
            40
        ));

        // Setback (weight: 10)
        const reqSetback = this.resolveLimit(r => r.geometry?.setback?.value, [p => p.setback]) || 0;
        if (reqSetback > 0) {
            let setbackOk = true;
            this.project.plots.forEach(plot => {
                if (!plot.geometry) return;
                try {
                    const inner = turf.buffer(plot.geometry, -reqSetback / 1000, { units: 'kilometers' });
                    if (inner) {
                        plot.buildings.forEach((b: any) => {
                            if (b.visible !== false && b.centroid) {
                                if (!turf.booleanPointInPolygon(b.centroid, inner as any)) setbackOk = false;
                            }
                        });
                    }
                } catch { /* ignore */ }
            });
            bylawItems.push(this.createScoreItem(
                `Setback (≥${reqSetback}m)`,
                setbackOk ? 'pass' : 'fail',
                setbackOk ? 'Compliant' : 'Violation detected',
                40
            ));

            // Additional bylaw fallback checks to provide a richer scorecard
            // Drainage / Stormwater management
            let hasStorm = false;
            this.project.plots.forEach(p => {
                if (p.utilityAreas) p.utilityAreas.forEach((u: any) => { if ((u.type || '').toLowerCase().includes('drain') || (u.type || '').toLowerCase().includes('storm')) hasStorm = true; });
            });
            bylawItems.push(this.createScoreItem('Stormwater / Drainage Plan', hasStorm ? 'pass' : 'warn', hasStorm ? 'Plan present' : 'No dedicated drainage area', 40));

            // Waste management
            let hasWaste = false;
            this.project.plots.forEach(p => { if (p.utilityAreas) p.utilityAreas.forEach((u: any) => { if ((u.type || '').toLowerCase().includes('waste') || (u.type || '').toLowerCase().includes('solid')) hasWaste = true; }); });
            bylawItems.push(this.createScoreItem('Solid Waste Management Plan', hasWaste ? 'pass' : 'warn', hasWaste ? 'Plan present' : 'Not provided', 30));

            // Sewer / storm connectivity approvals
        const approvalsAny = this.project.underwriting?.approvals as any;
        const sewerOk = !!approvalsAny?.sewerConnection || !!approvalsAny?.drainagePlan;
            if (!sewerOk) {
                bylawItems.push(this.createScoreItem('Sewer / Drainage Connections', 'warn', 'No approvals found', 20));
            }

            // Utility easements / setbacks for services
            bylawItems.push(this.createScoreItem('Utility Easements & Service Corridors', 'warn', 'Check service easements & clearances', 30));
        }

        // Parking
        let totalUnits = 0;
        this.project.plots.forEach(p => {
            p.buildings.forEach((b: any) => {
                if (b.visible !== false) {
                    totalUnits += b.units?.length || 0;
                }
            });
        });
        if (totalUnits === 0) totalUnits = Math.floor(areaMetrics.totalBuiltUpArea / 100);
        const parkRatio = this.regulations?.facilities?.parking?.value;
        const reqParking = parkRatio !== undefined ? Math.ceil(totalUnits * parkRatio) : 0;
        let provParking = 0;
        this.project.plots.forEach(p => {
            p.parkingAreas.forEach((pa: any) => { provParking += pa.capacity || Math.floor(pa.area / 30); });
            p.buildings.forEach((b: any) => {
                if (b.visible !== false) b.floors.forEach((f: any) => {
                    if (f.type === 'Parking') provParking += f.parkingCapacity || Math.floor(b.area / 30);
                });
            });
        });
        if (reqParking > 0) {
            bylawItems.push(this.createScoreItem(
                `Parking (≥${reqParking})`,
                provParking >= reqParking ? 'pass' : provParking >= reqParking * 0.5 ? 'warn' : 'fail',
                `${provParking} / ${reqParking} slots`,
                50
            ));
        }

        if (hasRoadUtility || roadAccessCount > 0) {
            bylawItems.push(this.createScoreItem(
                'Internal Road / Fire Access',
                hasRoadUtility ? 'pass' : 'warn',
                hasRoadUtility ? 'Road utility defined' : `${roadAccessCount} road access sides`,
                30
            ));
        }

        const fireNocStatus = this.getApprovalStatus('fireNoc');
        if (tallestBuilding > 15 || fireNocStatus) {
            bylawItems.push(this.createScoreItem(
                'Fire NOC',
                fireNocStatus === 'Approved' ? 'pass' : fireNocStatus === 'Pending' ? 'warn' : 'fail',
                fireNocStatus || 'Missing',
                50
            ));
        }

        if (visibleBuildings.length > 0) {
            bylawItems.push(this.createScoreItem(
                'Soil Investigation Report',
                soilCoverage ? 'pass' : 'warn',
                soilCoverage ? 'Soil data available for all buildings' : 'Soil data missing for one or more buildings',
                50
            ));
        }

        const utilityConnectionStatus = this.getApprovalStatus('utilityConnections');
        if (utilityConnectionStatus && utilityConnectionStatus !== 'Not Applicable') {
            bylawItems.push(this.createScoreItem(
                'Utility Connections Approval',
                utilityConnectionStatus === 'Approved' ? 'pass' : 'warn',
                utilityConnectionStatus,
                20
            ));
        }

        const reraRegistration = this.project.underwriting?.approvals?.reraRegistration;
        if (reraRegistration) {
            bylawItems.push(this.createScoreItem(
                'RERA Registration',
                reraRegistration !== 'Pending' ? 'pass' : 'warn',
                reraRegistration,
                20
            ));
        }

        // ========== GREEN ==========

        // Expanded Green/FSD fallback items (covers common IGBC/GRIHA/LEED categories).
        // If `greenStandards` is present it can override these with exact credits/points.
        const tGreen = this.greenStandards?.constraints?.minGreenCover ? this.greenStandards.constraints.minGreenCover * 100 : 15;
        const openPct = areaMetrics.totalPlotArea > 0 ? (greenMetrics.openSpace / areaMetrics.totalPlotArea) * 100 : 0;
        const tOpen = this.greenStandards?.constraints?.minOpenSpace ? this.greenStandards.constraints.minOpenSpace * 100 : 30;

        // Core site-level items
        greenItems.push(this.createScoreItem(
            `Green Cover (≥${tGreen.toFixed(0)}%)`,
            greenMetrics.greenArea.percentage >= tGreen ? 'pass' : greenMetrics.greenArea.percentage >= tGreen * 0.7 ? 'warn' : 'fail',
            `${greenMetrics.greenArea.percentage.toFixed(1)}% / ${tGreen.toFixed(0)}%`,
            120
        ));
        greenItems.push(this.createScoreItem(
            `Open Space (≥${tOpen.toFixed(0)}%)`,
            openPct >= tOpen ? 'pass' : openPct >= tOpen * 0.7 ? 'warn' : 'fail',
            `${openPct.toFixed(1)}% / ${tOpen.toFixed(0)}%`,
            100
        ));

        // Water and rainwater
        let hasRain = false, hasSolar = false, hasSTP = false, hasWaterAudit = false, hasLowFlow = false;
        this.project.plots.forEach(p => {
            if (p.utilityAreas) {
                p.utilityAreas.forEach((u: any) => {
                    const t = (u.type || '').toLowerCase();
                    if (t.includes('rainwater')) hasRain = true;
                    if (t.includes('solar') || t === 'solar pv') hasSolar = true;
                    if (t === 'stp' || t === 'wtp' || t.includes('sewage') || t.includes('water treatment')) hasSTP = true;
                    if (t.includes('audit') || t.includes('water audit')) hasWaterAudit = true;
                    if (t.includes('low flow') || t.includes('efficient fixtures')) hasLowFlow = true;
                });
            }
        });

        greenItems.push(this.createScoreItem('Rainwater Harvesting', hasRain ? 'pass' : 'fail', hasRain ? 'Provided' : 'Not provided', 80));
        greenItems.push(this.createScoreItem('Water Recycling (STP/WTP)', hasSTP ? 'pass' : 'fail', hasSTP ? 'Provided' : 'Not provided', 120));
        greenItems.push(this.createScoreItem('Water Efficiency (Low-flow Fixtures / Audit)', hasLowFlow || hasWaterAudit ? 'pass' : 'warn', hasLowFlow ? 'Efficient fixtures detected' : hasWaterAudit ? 'Water audit present' : 'Not provided', 60));

        // Energy & renewable
        // Heuristics: look for 'Solar', 'PV', 'EV' utility entries or building-level flags
        this.project.plots.forEach(p => {
            p.buildings.forEach((b: any) => {
                if (b.utilities) {
                    b.utilities.forEach((u: any) => { if ((u || '').toString().toLowerCase().includes('solar')) hasSolar = true; });
                }
            });
        });

        greenItems.push(this.createScoreItem('On-site Renewable (Solar PV)', hasSolar ? 'pass' : 'fail', hasSolar ? 'Installed' : 'Not installed', 120));
        greenItems.push(this.createScoreItem('Energy Efficiency Measures', 'warn', 'Generic checks (lighting, HVAC efficiency) - refine with audit', 100));

        // Materials & waste
        greenItems.push(this.createScoreItem('Construction Waste Management', 'warn', 'No waste plan provided', 40));
        greenItems.push(this.createScoreItem('Sustainable Materials (low embodied carbon)', 'warn', 'No materials declaration', 60));

        // Indoor environment & amenity
        greenItems.push(this.createScoreItem('Daylight / Ventilation Targets', 'warn', 'Needs daylight analysis', 80));
        greenItems.push(this.createScoreItem('Thermal Comfort / Passive Design', 'warn', 'Passive design not analyzed', 60));

        // Site-level certification readiness (composite)
        greenItems.push(this.createScoreItem('Documentation & Certification Readiness', this.greenStandards ? 'pass' : 'warn', this.greenStandards ? `Using ${this.greenStandards.name}` : 'No standard attached', 100));

        // Replace synthetic bucket with a set of common fallback credits (modeled after IGBC/LEED categories)
        const fallbackCredits = [
            { code: 'E1', name: 'Optimized Energy Performance', points: 100 },
            { code: 'E2', name: 'On-site Renewable Energy', points: 80 },
            { code: 'W1', name: 'Water Use Reduction', points: 80 },
            { code: 'S1', name: 'Sustainable Site Planning', points: 60 },
            { code: 'M1', name: 'Materials & Resources', points: 60 },
            { code: 'ID1', name: 'Indoor Environmental Quality', points: 60 },
            { code: 'IW1', name: 'Innovation & Documentation', points: 40 }
        ];

        fallbackCredits.forEach(c => {
            // Default evaluation is 'warn' so they appear available but not achieved without audits
            // Avoid emitting legacy 'Mapped to standard' text; regulation engine is deprecated for scoring UI
            greenItems.push(this.createScoreItem(`${c.code} ${c.name}`, this.greenStandards ? 'pass' : 'warn', this.greenStandards ? 'Standard match' : 'Fallback credit', c.points));
        });

        // ========== VASTU ==========
        const vastuItems = this.calculateVastuItems();
        const bylawScoreSummary = this.calcAdditiveScore(bylawItems);
        const greenScoreSummary = this.calcAdditiveScore(greenItems);
        const vastuScoreSummary = this.calcAdditiveScore(vastuItems);

        return {
            bylaws: Math.max(0, bylawScoreSummary.percentage),
            green: Math.max(0, greenScoreSummary.percentage),
            vastu: Math.max(0, vastuScoreSummary.percentage),
            greenStandards: this.greenStandards || null,
            bylawScoreSummary,
            greenScoreSummary,
            vastuScoreSummary,
            bylawItems,
            greenItems,
            vastuItems,
        };
    }

    private evaluateVastuScorecardItem(item: any): { status: 'pass' | 'warn' | 'fail' | 'na'; detail: string } {
        const code = String(item.code || '').toUpperCase();
        const primaryPlot = this.project.plots[0];
        if (!primaryPlot?.geometry) return { status: 'na', detail: 'No plot geometry' };
        const context = primaryPlot.complianceContext;

        const visibleBuildings = primaryPlot.buildings.filter((building: any) => building.visible !== false);
        const utilities = primaryPlot.utilityAreas || [];
        const parkingAreas = primaryPlot.parkingAreas || [];
        const entries = primaryPlot.entries || [];
        const greenAreas = primaryPlot.greenAreas || [];
        const roads = primaryPlot.roadAccessSides || [];

        const northeastBuildings = this.getFeaturesInBearingRange(visibleBuildings, primaryPlot, 22, 68);
        const southwestBuildings = this.getFeaturesInBearingRange(visibleBuildings, primaryPlot, 202, 248);
        const southeastUtilities = this.getFeaturesInBearingRange(utilities, primaryPlot, 112, 158);
        const northwestUtilities = this.getFeaturesInBearingRange(utilities, primaryPlot, 292, 338);

        const utilityInZone = (matcher: (value: any) => boolean, min: number, max: number) =>
            this.getFeaturesInBearingRange(utilities, primaryPlot, min, max, matcher);

        const namedBuildingInZone = (matcher: (value: any) => boolean, min: number, max: number) =>
            this.getFeaturesInBearingRange(visibleBuildings, primaryPlot, min, max, matcher);

        switch (code) {
            case 'A1': {
                const shape = this.evaluatePlotShape(primaryPlot);
                return { status: shape, detail: shape === 'pass' ? 'Square/rectangular plot' : shape === 'warn' ? 'Minor irregularity' : 'Irregular plot shape' };
            }
            case 'A2':
                if (!context?.siteSlope || context.siteSlope === 'unknown') return { status: 'na', detail: 'Site slope data not provided' };
                return {
                    status: context.siteSlope === 'north-east-lowest' ? 'pass' : context.siteSlope === 'flat' ? 'warn' : 'fail',
                    detail: context.siteSlope === 'north-east-lowest' ? 'NE lowest / SW highest' : context.siteSlope === 'flat' ? 'Flat site' : 'Reverse slope',
                };
            case 'A3': {
                const northEastOpenness = greenAreas.filter((area: any) => this.getZoneBearing(primaryPlot, area) !== null && this.isBearingInRange(this.getZoneBearing(primaryPlot, area)!, 0, 90)).reduce((sum: number, area: any) => sum + area.area, 0);
                const southWestMass = southwestBuildings.reduce((sum: number, building: any) => sum + building.area, 0);
                if (northEastOpenness === 0 && southWestMass === 0) return { status: 'na', detail: 'No clear NE/SW zoning data' };
                return { status: northEastOpenness >= southWestMass ? 'pass' : 'warn', detail: `NE open area ${Math.round(northEastOpenness)} sqm vs SW mass ${Math.round(southWestMass)} sqm` };
            }
            case 'B1': {
                if (entries.length === 0) return { status: 'na', detail: 'No entry gates placed' };
                const goodEntry = entries.some((entry: any) => {
                    const bearing = this.getZoneBearing(primaryPlot, { geometry: turf.point(entry.position) });
                    return bearing !== null && (
                        this.isBearingInRange(bearing, 330, 30) ||
                        this.isBearingInRange(bearing, 60, 120) ||
                        this.isBearingInRange(bearing, 150, 210) ||
                        this.isBearingInRange(bearing, 240, 300)
                    );
                });
                return { status: goodEntry ? 'pass' : 'warn', detail: goodEntry ? 'Gate placed in an auspicious side zone' : 'Gate not in preferred side zone' };
            }
            case 'B2': {
                if (entries.length === 0) return { status: 'na', detail: 'No entry gates placed' };
                const swEntry = entries.some((entry: any) => {
                    const bearing = this.getZoneBearing(primaryPlot, { geometry: turf.point(entry.position) });
                    return bearing !== null && this.isBearingInRange(bearing, 202, 248);
                });
                return { status: swEntry ? 'fail' : 'pass', detail: swEntry ? 'South-West gate detected' : 'No South-West gate' };
            }
            case 'B3': {
                if (entries.length === 0 || roads.length === 0) return { status: 'na', detail: 'Entry or road access data missing' };
                const aligned = entries.some((entry: any) => {
                    const name = String(entry.name || '').toUpperCase();
                    return roads.some((road) => name.includes(road));
                });
                return { status: aligned ? 'pass' : 'warn', detail: aligned ? 'Gate aligns with road-facing side' : 'Gate/road alignment not explicit' };
            }
            case 'C1': {
                const good = greenAreas.length > 0 || utilityInZone((u) => String(u.type).toLowerCase().includes('water'), 22, 68).length > 0;
                return { status: good ? 'pass' : 'warn', detail: good ? 'NE contains green/water uses' : 'NE preferred uses not clearly placed' };
            }
            case 'C2': {
                const tallestSW = this.getLargestBuildingInRange(primaryPlot, 202, 248);
                if (!tallestSW) return { status: 'na', detail: 'No SW building mass found' };
                const overallTallest = visibleBuildings.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
                return { status: tallestSW?.id === overallTallest?.id ? 'pass' : 'warn', detail: tallestSW?.id === overallTallest?.id ? 'Tallest mass is in SW' : 'Tallest mass not clearly in SW' };
            }
            case 'C3': {
                const good = southeastUtilities.some((utility: any) => ['electrical', 'fire', 'dg set', 'hvac', 'gas'].includes(String(utility.type || '').toLowerCase()));
                return { status: good ? 'pass' : 'warn', detail: good ? 'SE contains electrical/fire/service utilities' : 'SE service utilities not clearly placed' };
            }
            case 'C4': {
                const northCommercial = namedBuildingInZone((building) => {
                    const name = String(building.name || '').toLowerCase();
                    return name.includes('retail') || name.includes('office') || name.includes('club');
                }, 337, 22);
                return { status: northCommercial.length > 0 ? 'pass' : 'warn', detail: northCommercial.length > 0 ? 'North-side commercial/community block found' : 'North-side commercial/community block not explicit' };
            }
            case 'C5': {
                const eastBuilding = namedBuildingInZone(() => true, 68, 112);
                return { status: eastBuilding.length > 0 ? 'pass' : 'warn', detail: eastBuilding.length > 0 ? 'East-side building block found' : 'East-side zoning not explicit' };
            }
            case 'C6': {
                const nwParking = this.getFeaturesInBearingRange(parkingAreas, primaryPlot, 292, 338);
                return { status: nwParking.length > 0 ? 'pass' : 'warn', detail: nwParking.length > 0 ? 'NW parking/ancillary use found' : 'NW guest/parking use not explicit' };
            }
            case 'D1': {
                const tallestSW = this.getLargestBuildingInRange(primaryPlot, 202, 248);
                const tallestOverall = visibleBuildings.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
                if (!tallestOverall) return { status: 'na', detail: 'No buildings found' };
                return { status: tallestSW?.id === tallestOverall.id ? 'pass' : 'fail', detail: tallestSW?.id === tallestOverall.id ? 'Tallest building is in SW' : 'Tallest building is not in SW' };
            }
            case 'D2': {
                const lowNE = northeastBuildings.every((building: any) => (building.height || 0) <= (visibleBuildings.reduce((min: number, current: any) => Math.min(min, current.height || 0), Infinity)));
                return { status: northeastBuildings.length === 0 ? 'warn' : (lowNE ? 'pass' : 'warn'), detail: northeastBuildings.length === 0 ? 'No NE building mass found' : (lowNE ? 'NE has the lowest massing' : 'NE height/open-space balance is mixed') };
            }
            case 'D3':
                return { status: southwestBuildings.length > 0 && northeastBuildings.length >= 0 ? 'warn' : 'na', detail: 'Step-massing trend requires manual review' };
            case 'E1': {
                if (roads.length === 0) return { status: 'na', detail: 'No road access sides detected' };
                const good = roads.some((road) => road === 'N' || road === 'E');
                return { status: good ? 'pass' : roads.some((road) => road === 'S' || road === 'W') ? 'warn' : 'fail', detail: `Road access from ${roads.join(', ')}` };
            }
            case 'E2':
                if (!context?.internalCirculation || context.internalCirculation === 'unknown') return { status: 'na', detail: 'Internal circulation direction not provided' };
                return {
                    status: context.internalCirculation === 'clockwise' ? 'pass' : 'fail',
                    detail: context.internalCirculation === 'clockwise' ? 'Clockwise circulation' : 'Anti-clockwise circulation',
                };
            case 'E3':
                if (typeof context?.tJunctionCount !== 'number') return { status: 'na', detail: 'T-junction count not provided' };
                return {
                    status: context.tJunctionCount === 0 ? 'pass' : context.tJunctionCount === 1 ? 'warn' : 'fail',
                    detail: `${context.tJunctionCount} T-junction(s) affecting towers`,
                };
            case 'F1': {
                const water = utilityInZone((utility) => {
                    const type = String(utility.type || '').toLowerCase();
                    const name = String(utility.name || '').toLowerCase();
                    return type.includes('water') || name.includes('pool') || name.includes('fountain');
                }, 22, 68);
                return { status: water.length > 0 ? 'pass' : 'warn', detail: water.length > 0 ? 'Water utility/body in NE' : 'No NE water body found' };
            }
            case 'F2':
            case 'F4': {
                const water = utilityInZone((utility) => String(utility.type || '').toLowerCase().includes('water') || String(utility.name || '').toLowerCase().includes('bore'), 0, 112);
                return { status: water.length > 0 ? 'pass' : 'warn', detail: water.length > 0 ? 'Water source near NE/N/E' : 'No NE/N/E water source found' };
            }
            case 'F3': {
                const westWater = utilityInZone((utility) => String(utility.type || '').toLowerCase().includes('water'), 202, 292);
                return { status: westWater.length > 0 ? 'pass' : 'warn', detail: westWater.length > 0 ? 'Overhead/utility water mass in SW/West' : 'No SW/West water tank found' };
            }
            case 'G1': {
                const basementZones = this.getFeaturesInBearingRange(parkingAreas, primaryPlot, 180, 292);
                const badBasementZones = this.getFeaturesInBearingRange(parkingAreas, primaryPlot, 22, 112);
                if (parkingAreas.length === 0) return { status: 'na', detail: 'No parking areas modeled' };
                return { status: badBasementZones.length === 0 && basementZones.length > 0 ? 'pass' : badBasementZones.length === 0 ? 'warn' : 'fail', detail: badBasementZones.length === 0 ? 'Parking/basement kept to S/W zones' : 'Parking/basement extends into NE/E zone' };
            }
            case 'G2':
                if (!context?.basementUseInNorthEast || context.basementUseInNorthEast === 'unknown') return { status: 'na', detail: 'NE basement use not provided' };
                return {
                    status: context.basementUseInNorthEast === 'none' ? 'pass' : context.basementUseInNorthEast === 'parking-only' ? 'warn' : 'fail',
                    detail: context.basementUseInNorthEast === 'none' ? 'No NE basement' : context.basementUseInNorthEast === 'parking-only' ? 'NE basement limited to parking/open cuts' : 'NE basement used for non-parking purpose',
                };
            case 'H1': {
                const neGreen = this.getFeaturesInBearingRange(greenAreas, primaryPlot, 22, 68);
                return { status: neGreen.length > 0 ? 'pass' : 'warn', detail: neGreen.length > 0 ? 'NE has green/open landscape' : 'NE landscape not explicit' };
            }
            case 'H2': {
                const serviceInGoodZones = southeastUtilities.length + northwestUtilities.length;
                return { status: serviceInGoodZones > 0 ? 'pass' : 'warn', detail: serviceInGoodZones > 0 ? 'Service utilities found in SE/NW' : 'Service utility zoning not explicit' };
            }
            case 'I1': {
                const temple = namedBuildingInZone((building) => String(building.name || '').toLowerCase().includes('temple') || String(building.name || '').toLowerCase().includes('prayer'), 22, 68);
                return { status: temple.length > 0 ? 'pass' : 'na', detail: temple.length > 0 ? 'Temple/prayer block in NE' : 'Temple/prayer room not modeled' };
            }
            case 'I2':
                if (!context?.idolFacing || context.idolFacing === 'unknown') return { status: 'na', detail: 'Idol orientation not provided' };
                return {
                    status: context.idolFacing === 'east' || context.idolFacing === 'west' ? 'pass' : 'fail',
                    detail: `Idol facing ${context.idolFacing}`,
                };
            case 'J1': {
                const club = namedBuildingInZone((building) => String(building.name || '').toLowerCase().includes('club') || String(building.name || '').toLowerCase().includes('community'), 0, 338);
                return { status: club.length > 0 ? 'pass' : 'na', detail: club.length > 0 ? 'Club/community block present in a permitted zone' : 'Club/community hall not modeled' };
            }
            case 'K1': {
                const retail = namedBuildingInZone((building) => {
                    const name = String(building.name || '').toLowerCase();
                    return name.includes('retail') || name.includes('commercial');
                }, 0, 112);
                return { status: retail.length > 0 ? 'pass' : 'warn', detail: retail.length > 0 ? 'Retail/commercial block on North/East side' : 'Retail/commercial block not clearly on North/East side' };
            }
            case 'L1':
            case 'S1': {
                const electrical = utilityInZone((utility) => ['electrical', 'dg set'].includes(String(utility.type || '').toLowerCase()), 112, 248);
                return { status: electrical.length > 0 ? 'pass' : 'warn', detail: electrical.length > 0 ? 'Electrical/meter utility on SE/S/W side' : 'Electrical/meter utility not clearly in preferred zone' };
            }
            case 'L2': {
                const generator = utilityInZone((utility) => ['dg set'].includes(String(utility.type || '').toLowerCase()) || String(utility.name || '').toLowerCase().includes('generator'), 112, 338);
                return { status: generator.length > 0 ? 'pass' : 'warn', detail: generator.length > 0 ? 'Generator utility in SE/NW zone' : 'Generator utility not found in preferred zone' };
            }
            case 'L3':
            case 'N3': {
                const firePump = utilityInZone((utility) => {
                    const type = String(utility.type || '').toLowerCase();
                    const name = String(utility.name || '').toLowerCase();
                    return type === 'fire' || name.includes('pump');
                }, 112, 180);
                return { status: firePump.length > 0 ? 'pass' : 'warn', detail: firePump.length > 0 ? 'Fire pump / pump room in SE/South' : 'Fire pump / pump room not found in preferred zone' };
            }
            case 'L4': {
                const gas = utilityInZone((utility) => String(utility.type || '').toLowerCase() === 'gas' || String(utility.name || '').toLowerCase().includes('lpg'), 112, 158);
                return { status: gas.length > 0 ? 'pass' : 'na', detail: gas.length > 0 ? 'Gas utility in SE' : 'Gas bank not modeled' };
            }
            case 'M1': {
                const stp = utilityInZone((utility) => ['stp', 'wtp'].includes(String(utility.type || '').toLowerCase()), 112, 338);
                return { status: stp.length > 0 ? 'pass' : 'warn', detail: stp.length > 0 ? 'STP/WTP in NW/SE/West band' : 'STP/WTP not in preferred zone' };
            }
            case 'M2': {
                const septic = utilityInZone((utility) => String(utility.name || '').toLowerCase().includes('septic'), 248, 338);
                return { status: septic.length > 0 ? 'pass' : 'na', detail: septic.length > 0 ? 'Septic tank in NW/West' : 'Septic tank not modeled' };
            }
            case 'N1':
                return { status: 'na', detail: 'Lift machine room position not modeled as separate object' };
            case 'N2': {
                const chiller = utilityInZone((utility) => {
                    const type = String(utility.type || '').toLowerCase();
                    const name = String(utility.name || '').toLowerCase();
                    return type === 'hvac' || name.includes('chiller') || name.includes('cooling');
                }, 202, 292);
                return { status: chiller.length > 0 ? 'pass' : 'warn', detail: chiller.length > 0 ? 'HVAC/chiller in West/SW' : 'HVAC/chiller not in preferred zone' };
            }
            case 'O1':
                if (!context?.commonToiletsZone || context.commonToiletsZone === 'unknown') return { status: 'na', detail: 'Common toilet zone not provided' };
                return {
                    status: context.commonToiletsZone === 'se' || context.commonToiletsZone === 'nw' ? 'pass' : context.commonToiletsZone === 'other' ? 'warn' : 'na',
                    detail: context.commonToiletsZone === 'none' ? 'No common toilets' : `Common toilets in ${context.commonToiletsZone.toUpperCase()} zone`,
                };
            case 'O2':
                if (context?.hasToiletInNorthEast === undefined && context?.hasToiletInBrahmasthan === undefined) return { status: 'na', detail: 'NE/Brahmasthan toilet data not provided' };
                if (context?.hasToiletInNorthEast || context?.hasToiletInBrahmasthan) {
                    return { status: 'fail', detail: 'Toilet detected in NE or Brahmasthan' };
                }
                return { status: 'pass', detail: 'No toilets in NE or Brahmasthan' };
            case 'P1':
            case 'P2': {
                const center = getVastuCenter(primaryPlot.geometry);
                const radius = Math.sqrt(turf.area(primaryPlot.geometry) * 0.05 / Math.PI);
                const zone = turf.buffer(center, radius / 1000, { units: 'kilometers' });
                const intrusions = zone ? visibleBuildings.filter((building: any) => turf.booleanIntersects(building.geometry as any, zone as any)) : [];
                const pass = intrusions.length === 0;
                return { status: pass ? 'pass' : 'fail', detail: pass ? 'Brahmasthan is open' : `${intrusions.length} building mass(es) intersect Brahmasthan` };
            }
            case 'Q1':
                if (!context?.northEastExtension) return { status: 'na', detail: 'NE extension/cut data not provided' };
                return {
                    status: context.northEastExtension === 'present' ? 'pass' : context.northEastExtension === 'none' ? 'warn' : 'fail',
                    detail: context.northEastExtension === 'present' ? 'NE extension present' : context.northEastExtension === 'none' ? 'No NE extension / no cut' : 'NE cut present',
                };
            case 'Q2':
                if (context?.southWestExtension === undefined) return { status: 'na', detail: 'SW extension data not provided' };
                return {
                    status: context.southWestExtension ? 'fail' : 'pass',
                    detail: context.southWestExtension ? 'SW extension present' : 'No SW extension',
                };
            case 'Q3':
                if (context?.extensionRemediesApplied === undefined) return { status: 'na', detail: 'Extension remedy data not provided' };
                return {
                    status: context.extensionRemediesApplied ? 'warn' : 'fail',
                    detail: context.extensionRemediesApplied ? 'Extensions present with remedies applied' : 'Extensions present without remedies',
                };
            case 'R1':
                if (!context?.solarFacingRoof || context.solarFacingRoof === 'unknown') return { status: 'na', detail: 'Solar roof orientation not provided' };
                return {
                    status: context.solarFacingRoof === 'south' ? 'pass' : context.solarFacingRoof === 'other' ? 'warn' : 'fail',
                    detail: `Solar panels oriented to ${context.solarFacingRoof}-facing roof`,
                };
            case 'R2': {
                const rwh = utilityInZone((utility) => String(utility.type || '').toLowerCase().includes('rainwater'), 0, 112);
                return { status: rwh.length > 0 ? 'pass' : 'warn', detail: rwh.length > 0 ? 'Rainwater harvesting in NE/N/E band' : 'Rainwater harvesting pit not found in preferred zone' };
            }
            case 'S2': {
                const goodParking = this.getFeaturesInBearingRange(parkingAreas, primaryPlot, 202, 338);
                if (parkingAreas.length === 0) return { status: 'na', detail: 'No parking areas modeled' };
                return { status: goodParking.length === parkingAreas.length ? 'pass' : goodParking.length > 0 ? 'warn' : 'fail', detail: `${goodParking.length}/${parkingAreas.length} parking areas in NW/S/W` };
            }
            default:
                return { status: 'na', detail: item.complianceBasis || 'No automated rule mapped yet' };
        }
    }

    private calculateVastuItems(): ComplianceItem[] {
    const items: ComplianceItem[] = [];
    const vastuEnabled = !!this.project.vastuCompliant;

        if (this.vastuRules?.scorecardItems?.length) {
            return this.vastuRules.scorecardItems.map((item) => {
                const evaluation = this.evaluateVastuScorecardItem(item);
                return this.createScoreItem(
                    `${item.code} ${item.title}`,
                    evaluation.status,
                    evaluation.detail,
                    item.maxMarks
                );
            });
        }

        // Brahmasthan (weight: 25)
        let brahmFree = true;
        this.project.plots.forEach(plot => {
            const center = getVastuCenter(plot.geometry);
            const radius = Math.sqrt(turf.area(plot.geometry) * 0.05 / Math.PI);
            try {
                const zone = turf.buffer(center, radius / 1000, { units: 'kilometers' });
                if (zone) plot.buildings.forEach((b: any) => {
                    if (b.visible !== false && b.centroid) {
                        if (turf.booleanPointInPolygon(b.centroid, zone as any)) brahmFree = false;
                    }
                });
            } catch { /* */ }
        });
    items.push(this.createScoreItem('Brahmasthan (Center)', vastuEnabled ? (brahmFree ? 'pass' : 'fail') : 'na', vastuEnabled ? (brahmFree ? 'Center clear' : 'Building in center') : 'Vastu disabled in project settings', 25));

        // Helper: find ALL utilities for a category
        const findUtilities = (
            typeFilter: (u: any) => boolean,
            idealMin: number,
            idealMax: number,
        ): { names: string[]; bearings: string[]; found: boolean; allInRange: boolean; someInRange: boolean } => {
            const matches: { name: string, az: number, inRange: boolean }[] = [];
            
            this.project.plots.forEach(plot => {
                const vastuCenter = getVastuCenter(plot.geometry);
                (plot.utilityAreas || []).forEach((u: any) => {
                    if (!typeFilter(u)) return;

                    const uCentroid = turf.centroid(u.geometry);
                    const bearing = turf.bearing(vastuCenter, uCentroid);
                    const az = (bearing + 360) % 360;
                    
                    matches.push({
                        name: u.name || u.type,
                        az,
                        inRange: az >= idealMin && az <= idealMax
                    });
                });
            });

            if (matches.length === 0) return { names: [], bearings: [], found: false, allInRange: false, someInRange: false };

            const allInRange = matches.every(m => m.inRange);
            const someInRange = matches.some(m => m.inRange);
            
            // Format for display
            const names = matches.map(m => m.name);
            const bearings = matches.map(m => `${m.az.toFixed(0)}°`);

            return { names, bearings, found: true, allInRange, someInRange };
        };

        // Water NE (weight: 20)
        const waterResult = findUtilities(
            u => {
                const t = (u.type || '').toLowerCase();
                if (t === 'wtp' || t === 'stp' || t.includes('treatment') || t.includes('sewage')) return false; // Waste/Treatment goes NW, not NE
                return t === 'water' || t.includes('water') || t.includes('rainwater');
            },
            22, 68
        );
        if (waterResult.found) {
            items.push(this.createScoreItem(
                'Water Source (NE)',
                vastuEnabled ? (waterResult.allInRange ? 'pass' : waterResult.someInRange ? 'warn' : 'fail') : 'na',
                vastuEnabled ? `${waterResult.names.join(', ')}: ${waterResult.bearings.join(', ')} (need 22-68°)` : 'Vastu disabled in project settings',
                20
            ));
        } else {
            items.push(this.createScoreItem('Water Source (NE)', vastuEnabled ? 'na' : 'na', vastuEnabled ? 'No water utility' : 'Vastu disabled in project settings', 0));
        }

        // Fire SE (weight: 20)
        const fireResult = findUtilities(
            u => {
                const t = (u.type || '').toLowerCase();
                const name = (u.name || '').toLowerCase();
                if (name.includes('tank')) return false; // Exclude fire tanks as requested
                return t === 'fire' || t === 'hvac' || t === 'electrical' || t === 'dg set';
            },
            112, 158
        );
        if (fireResult.found) {
            items.push(this.createScoreItem(
                'Fire/Energy (SE)',
                vastuEnabled ? (fireResult.allInRange ? 'pass' : fireResult.someInRange ? 'warn' : 'fail') : 'na',
                vastuEnabled ? `${fireResult.names.join(', ')}: ${fireResult.bearings.join(', ')} (need 112-158°)` : 'Vastu disabled in project settings',
                20
            ));
        } else {
            items.push(this.createScoreItem('Fire/Energy (SE)', vastuEnabled ? 'na' : 'na', vastuEnabled ? 'No fire/HVAC utility' : 'Vastu disabled in project settings', 0));
        }

        // Entry (weight: 15)
        let entryStatus: 'pass' | 'fail' | 'warn' | 'na' = 'na', entryDetail = 'No entries placed';
        this.project.plots.forEach(plot => {
            if (plot.entries?.length > 0) {
                const good = plot.entries.some((e: any) => /N|E|NE/i.test(e.name || ''));
                entryStatus = good ? 'pass' : 'warn';
                entryDetail = good ? 'Entry from N/E/NE ✓' : 'Entry not from N/E/NE';
            }
        });
    items.push(this.createScoreItem('Entry (N/E/NE)', vastuEnabled ? entryStatus : 'na', vastuEnabled ? entryDetail : 'Vastu disabled in project settings', entryStatus === 'na' ? 0 : 15));

        // Service Placement (weight: 20)
        let svcGood = 0, svcTotal = 0;
        this.project.plots.forEach(plot => {
            const vastuCenter = getVastuCenter(plot.geometry);
            (plot.utilityAreas || []).filter((u: any) => u.visible).forEach((u: any) => {
                svcTotal++;
                const uCentroid = turf.centroid(u.geometry);
                const bearing = turf.bearing(vastuCenter, uCentroid);
                const az = (bearing + 360) % 360;
                const inNE = az >= 22 && az <= 68;
                const ut = (u.type || '').toLowerCase();
                // Water IN NE is great; Water elsewhere is ok-ish; Non-water outside NE is fine
                if (ut === 'water' || ut === 'wtp' || ut.includes('water')) {
                    if (inNE) svcGood++; // Ideal
                    else svcGood++; // Water anywhere is acceptable
                } else if (!inNE) {
                    svcGood++; // Non-water outside NE is correct
                }
            });
        });
        if (svcTotal > 0) {
            const pct = svcGood / svcTotal;
            items.push(this.createScoreItem('Service Placement', vastuEnabled ? (pct >= 0.8 ? 'pass' : pct >= 0.5 ? 'warn' : 'fail') : 'na', vastuEnabled ? `${svcGood}/${svcTotal} correct` : 'Vastu disabled in project settings', 20));
        }

        // --- Additional heuristic checks to expand Vastu scorecard ---
        // Main Mass (Prefer SW/South/West)
        try {
            const allBlds = this.getVisibleBuildings();
                if (allBlds.length > 0) {
                const main = allBlds.reduce((p: any, c: any) => (p.area > c.area ? p : c), allBlds[0]);
                const center = getVastuCenter(this.project.plots[0].geometry);
                const bCentroid = main.centroid || turf.centroid(main.geometry);
                const bearing = turf.bearing(center, bCentroid);
                const az = (bearing + 360) % 360;
                const isSW = az >= 202 && az <= 248;
                const isS = az > 157 && az < 202;
                const isW = az > 248 && az < 292;
                const status = isSW || isS || isW ? 'pass' : 'warn';
                items.push(this.createScoreItem('Main Mass Placement (SW preferred)', vastuEnabled ? status as any : 'na', vastuEnabled ? `Main mass at ${az.toFixed(0)}°` : 'Vastu disabled in project settings', 20));
            }
        } catch { /* ignore */ }

        // Puja Room (NE) - look for named internal utilities or units
        try {
            const matches: { name: string; az: number }[] = [];
            this.project.plots.forEach(plot => {
                const center = getVastuCenter(plot.geometry);
                (plot.buildings || []).forEach((b: any) => {
                    // search building name, unit names, internal utilities for keywords
                    const keywords = ((b.name || '') + ' ' + ((b.programMix && b.programMix.puja) || '')).toLowerCase();
                    if ((b.internalUtilities || []).some((u: any) => (u.name || '').toLowerCase().includes('puja') || (u.name || '').toLowerCase().includes('prayer'))) {
                        const az = (turf.bearing(center, turf.centroid(b.geometry)) + 360) % 360;
                        matches.push({ name: b.name || 'Building', az });
                    }
                });
            });
            if (matches.length > 0) {
                const someInRange = matches.some(m => m.az >= 22 && m.az <= 68);
                items.push(this.createScoreItem('Puja Room (NE)', vastuEnabled ? (someInRange ? 'pass' : 'warn') : 'na', vastuEnabled ? `${matches.map(m => `${m.name}@${m.az.toFixed(0)}°`).join(', ')}` : 'Vastu disabled in project settings', 15));
            } else {
                items.push(this.createScoreItem('Puja Room (NE)', vastuEnabled ? 'na' : 'na', vastuEnabled ? 'No puja room detected by name' : 'Vastu disabled in project settings', 0));
            }
        } catch { items.push(this.createScoreItem('Puja Room (NE)', 'na', 'Detection failed', 0)); }

        // Staircase not in Brahmasthan (shouldn't occupy center)
        try {
            const center = getVastuCenter(this.project.plots[0].geometry);
            const radius = Math.sqrt(turf.area(this.project.plots[0].geometry) * 0.05 / Math.PI);
            const zone = turf.buffer(center, radius / 1000, { units: 'kilometers' });
            let stairInCenter = false;
            this.project.plots.forEach(plot => {
                (plot.buildings || []).forEach((b: any) => {
                    (b.cores || []).forEach((c: any) => {
                        if (c.type === 'Stair') {
                            const pt = turf.centroid(c.geometry);
                            if (zone && turf.booleanPointInPolygon(pt, zone as any)) stairInCenter = true;
                        }
                    });
                });
            });
            items.push(this.createScoreItem('Staircase not in Brahmasthan', vastuEnabled ? (stairInCenter ? 'fail' : 'pass') : 'na', vastuEnabled ? (stairInCenter ? 'Stair in center' : 'No stair in center') : 'Vastu disabled in project settings', 20));
        } catch { /* */ }

        // Toilet placement (should avoid NE / Brahmasthan) — prefer context flags
        try {
            const ctx = this.project.plots[0].complianceContext;
            if (ctx?.hasToiletInNorthEast || ctx?.hasToiletInBrahmasthan) {
                items.push(this.createScoreItem('Toilet Placement (avoid NE/Brahmasthan)', vastuEnabled ? 'fail' : 'na', vastuEnabled ? 'Toilet detected in NE/Brahmasthan' : 'Vastu disabled in project settings', 25));
            } else if (ctx && (ctx.hasToiletInNorthEast === false && ctx.hasToiletInBrahmasthan === false)) {
                items.push(this.createScoreItem('Toilet Placement (avoid NE/Brahmasthan)', vastuEnabled ? 'pass' : 'na', vastuEnabled ? 'No toilets in critical zones' : 'Vastu disabled in project settings', 25));
            } else {
                items.push(this.createScoreItem('Toilet Placement (avoid NE/Brahmasthan)', vastuEnabled ? 'na' : 'na', vastuEnabled ? 'Toilet location data not provided' : 'Vastu disabled in project settings', 0));
            }
        } catch { items.push(this.createScoreItem('Toilet Placement (avoid NE/Brahmasthan)', 'na', 'Detection failed', 0)); }

        // Parking Placement (prefer NW/S/W)
        try {
            const pk = this.getFeaturesInBearingRange(this.project.plots[0].parkingAreas || [], this.project.plots[0], 202, 338);
            if ((this.project.plots[0].parkingAreas || []).length === 0) {
                items.push(this.createScoreItem('Parking Placement', 'na', 'No parking areas modeled', 0));
            } else {
                const allGood = pk.length === (this.project.plots[0].parkingAreas || []).length;
                const someGood = pk.length > 0;
                items.push(this.createScoreItem('Parking Placement (NW/S/W)', vastuEnabled ? (allGood ? 'pass' : someGood ? 'warn' : 'fail') : 'na', vastuEnabled ? `${pk.length}/${(this.project.plots[0].parkingAreas || []).length} in preferred zones` : 'Vastu disabled in project settings', 15));
            }
        } catch { /* */ }

        // Open NE availability (prefer open/green in NE)
        try {
            const center = getVastuCenter(this.project.plots[0].geometry);
            const neBuildings = this.getFeaturesInBearingRange(this.getVisibleBuildings(), this.project.plots[0], 22, 68);
            const neGreen = this.getFeaturesInBearingRange(this.project.plots[0].greenAreas || [], this.project.plots[0], 22, 68);
            const openOk = neGreen.length > 0 || (neBuildings.length === 0);
            items.push(this.createScoreItem('NE Open Space / Green', vastuEnabled ? (openOk ? 'pass' : 'warn') : 'na', vastuEnabled ? `${neGreen.length} green zones in NE` : 'Vastu disabled in project settings', 15));
        } catch { /* */ }

        // --- Additional expanded checks to cover more of the ultimate checklist ---
        try {
            const plot = this.project.plots[0];
            // Corner angles & irregular boundary
            const ring = plot.geometry?.geometry?.coordinates?.[0] || [];
            let irregular = false;
            let cornerAnglesMsg = '';
            if (ring.length > 3) {
                const coords = ring.slice(0, ring.length - 1);
                const angles: number[] = [];
                for (let i = 0; i < coords.length; i++) {
                    const p0 = coords[(i - 1 + coords.length) % coords.length];
                    const p1 = coords[i];
                    const p2 = coords[(i + 1) % coords.length];
                    try {
                        // turf.rhumbBearing returns degrees already — subtracting two bearings gives delta in degrees
                        const a = turf.rhumbBearing(turf.point(p1), turf.point(p0)) - turf.rhumbBearing(turf.point(p1), turf.point(p2));
                        const angle = Math.abs(((a + 540) % 360) - 180);
                        angles.push(Math.round(angle));
                    } catch { /* ignore */ }
                }
                const ninetyCount = angles.filter(a => Math.abs(a - 90) <= 8).length;
                if (ninetyCount < Math.max(3, Math.floor(coords.length * 0.6))) irregular = true;
                cornerAnglesMsg = `Detected corner angles: ${angles.slice(0,5).join(', ')}${angles.length>5?', ...':''}`;
            }
            items.push(this.createScoreItem('Plot Corner Angles / Regularity', vastuEnabled ? (irregular ? 'warn' : 'pass') : 'na', vastuEnabled ? (cornerAnglesMsg || 'Insufficient geometry') : 'Vastu disabled in project settings', irregular ? 6 : 8, ));

            // Plot tapering / extended corners
            try {
                const bbox = turf.bbox(plot.geometry);
                const bboxArea = turf.area(turf.bboxPolygon(bbox));
                const plotArea = turf.area(plot.geometry);
                const rectangularity = bboxArea > 0 ? plotArea / bboxArea : 0;
                const tapering = rectangularity < 0.6; // heuristic
                items.push(this.createScoreItem('Plot Tapering / Extended Corners', vastuEnabled ? (tapering ? 'warn' : 'pass') : 'na', vastuEnabled ? `Rectangularity ${rectangularity.toFixed(2)}` : 'Vastu disabled in project settings', tapering ? 4 : 6));
            } catch { items.push(this.createScoreItem('Plot Tapering / Extended Corners', 'na', 'Failed to evaluate', 4)); }

            // Adjacent building heights (context)
            try {
                const neighbours = this.getVisibleBuildings();
                const center = getVastuCenter(plot.geometry);
                const neighbourHeights = neighbours.map(b => ({ id: b.id, height: b.height || (b.numFloors || 0) * 3.5, az: ((turf.bearing(center, b.centroid || turf.centroid(b.geometry)) + 360) % 360) }));
                const highOnNE = neighbourHeights.some(h => h.az >= 22 && h.az <= 68 && h.height > 15);
                items.push(this.createScoreItem('Adjacent Building Heights (NE/SE/SW context)', vastuEnabled ? (highOnNE ? 'warn' : 'pass') : 'na', vastuEnabled ? `Sample neighbours: ${neighbourHeights.slice(0,3).map(n=>Math.round(n.height)).join(', ')}` : 'Vastu disabled in project settings', 6));
            } catch { items.push(this.createScoreItem('Adjacent Building Heights (NE/SE/SW context)', 'na', 'Not available', 6)); }

            // Flood susceptibility / groundwater flow (from complianceContext if available)
            try {
                const ctx = plot.complianceContext || {};
                const anyCtx = ctx as any;
                const floodRisk = anyCtx?.floodRisk || anyCtx?.floodSusceptibility || 'unknown';
                const gwFlow = anyCtx?.groundwaterFlowDirection || 'unknown';
                const floodStatus = floodRisk === 'high' ? 'fail' : floodRisk === 'medium' ? 'warn' : (floodRisk === 'low' ? 'pass' : 'na');
                items.push(this.createScoreItem('Flood Susceptibility', vastuEnabled ? (floodStatus as any) : 'na', vastuEnabled ? `Flood risk: ${floodRisk}` : 'Vastu disabled in project settings', floodStatus === 'na' ? 0 : 6));
                items.push(this.createScoreItem('Groundwater Flow Direction', vastuEnabled ? (gwFlow === 'towardsNE' ? 'pass' : gwFlow === 'unknown' ? 'na' : 'warn') : 'na', vastuEnabled ? `Flow: ${gwFlow}` : 'Vastu disabled in project settings', gwFlow === 'unknown' ? 0 : 4));
            } catch { items.push(this.createScoreItem('Flood Susceptibility', 'na', 'No data', 6)); }
        } catch { /* ignore */ }
        return items;
    }
}
