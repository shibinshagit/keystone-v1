
import { useMemo } from 'react';
import { Project, RegulationData } from '@/lib/types';

export interface GreenCreditCheckResult {
    status: 'pending' | 'achieved' | 'failed';
    score: number;
    metrics?: {
        achieved: number;
        target: number;
        unit: string;
    };
}

export function useGreenStandardChecks(
    project: Project | null,
    simulationResults: Project['simulationResults']
) {
    return useMemo(() => {
        const checks: Record<string, GreenCreditCheckResult> = {};

        if (!project) return checks;

        const totalPlotArea = project.totalPlotArea ?? project.plots.reduce((sum, p) => sum + (p.area || 0), 0);
        let totalBuiltUpArea = 0;
        let groundCoverageArea = 0;
        let providedParking = 0;
        let hasRWH = false, hasSolar = false, hasSTP = false, hasOWC = false, hasEV = false, hasFire = false, hasDG = false, hasHVAC = false;
        
        project.plots.forEach(plot => {
            plot.buildings.forEach(b => {
                if (b.visible !== false) {
                    groundCoverageArea += b.area;
                    let fsiFloors = b.floors.filter(f => f.type !== 'Parking').length;
                    if (fsiFloors === 0) fsiFloors = b.numFloors;
                    totalBuiltUpArea += (b.area * fsiFloors);
                }
                b.floors.forEach(f => {
                    if (f.type === 'Parking') providedParking += f.parkingCapacity || Math.floor(b.area / 30);
                    if (f.evStations && f.evStations > 0) hasEV = true;
                });
            });

            plot.parkingAreas.forEach(pa => {
                providedParking += pa.capacity || Math.floor(pa.area / 30);
            });

            (plot.utilityAreas || []).forEach(u => {
                const t = (u.type || '').toLowerCase();
                const n = (u.name || '').toLowerCase();
                if (t === 'rainwater harvesting' || t.includes('rainwater') || n.includes('rainwater')) hasRWH = true;
                if (t === 'solar pv' || t.includes('solar') || n.includes('solar')) hasSolar = true;
                if (t === 'stp' || t === 'wtp' || t.includes('treatment') || t.includes('sewage')) hasSTP = true;
                if (t === 'owc' || t === 'solid waste' || n.includes('waste') || n.includes('compost')) hasOWC = true;
                if (t === 'ev station' || n.includes('ev ') || n.includes('electric vehicle')) hasEV = true;
                if (t === 'fire' || n.includes('fire')) hasFire = true;
                if (t === 'dg set' || n.includes('generator')) hasDG = true;
                if (t === 'hvac' || n.includes('hvac') || n.includes('cooling')) hasHVAC = true;
            });
        });

        // 1. Site & Land Use (Always achieved if we have plots/buildings)
        const hasBuildings = project.plots.some(p => p.buildings.length > 0);
        checks['site_planning'] = { status: hasBuildings ? 'achieved' : 'pending', score: hasBuildings ? 1 : 0 };
        checks['land_use_planning'] = { status: project.intendedUse ? 'achieved' : 'pending', score: project.intendedUse ? 1 : 0 };

        if (totalPlotArea > 0) {
            // A. Green Cover Check
            const totalGreenArea = project.plots.reduce((sum, p) =>
                sum + (p.greenAreas?.reduce((gSum, g) => gSum + (g.area || 0), 0) || 0), 0);
            const greenPercentage = (totalGreenArea / totalPlotArea) * 100;
            checks['green_cover'] = {
                status: greenPercentage >= 15 ? 'achieved' : 'pending',
                score: greenPercentage >= 15 ? 4 : 0,
                metrics: { achieved: greenPercentage, target: 15, unit: '%' }
            };

            // B. Open Space Check
            const openSpacePercentage = ((totalPlotArea - groundCoverageArea) / totalPlotArea) * 100;
            checks['open_space'] = {
                status: openSpacePercentage >= 25 ? 'achieved' : 'pending',
                score: openSpacePercentage >= 25 ? 3 : 0,
                metrics: { achieved: openSpacePercentage, target: 25, unit: '%' }
            };

            // C. FAR & Coverage Compliance
            const achievedFAR = totalBuiltUpArea / totalPlotArea;
            const coveragePct = groundCoverageArea / totalPlotArea * 100;
            // Assuming default limits if no exact reg is found
            checks['far_compliance'] = { status: achievedFAR <= 2.5 ? 'achieved' : 'failed', score: achievedFAR <= 2.5 ? 2 : 0 };
            checks['ground_coverage'] = { status: coveragePct <= 45 ? 'achieved' : 'failed', score: coveragePct <= 45 ? 2 : 0 };
            
            // D. Parking
            const totalUnits = Math.floor(totalBuiltUpArea / 100);
            const reqParking = totalUnits * 1;
            checks['parking_compliance'] = { status: providedParking >= reqParking ? 'achieved' : 'pending', score: providedParking >= reqParking ? 2 : 0 };
        }

        // --- 2. SIMULATION-BASED CHECKS ---
        if (simulationResults) {
            const windAnalysis = simulationResults.wind || { compliantArea: 0 };
            const sunAnalysis = simulationResults.sun || { compliantArea: 0 };

            // Ventilation: 25% of building area has adequate airflow
            if (windAnalysis.compliantArea > 25) {
                checks['ventilation'] = { status: 'achieved', score: 2, metrics: { achieved: windAnalysis.compliantArea, target: 25, unit: '%' } };
            } else if (simulationResults.wind) {
                checks['ventilation'] = { status: 'failed', score: 0, metrics: { achieved: windAnalysis.compliantArea, target: 25, unit: '%' } };
            }

            // Daylighting: 25% of building area meets daylight factor
            if (sunAnalysis.compliantArea > 25) {
                checks['daylighting'] = { status: 'achieved', score: 3, metrics: { achieved: sunAnalysis.compliantArea, target: 25, unit: '%' } };
            } else if (simulationResults.sun) {
                checks['daylighting'] = { status: 'failed', score: 0, metrics: { achieved: sunAnalysis.compliantArea, target: 25, unit: '%' } };
            }
        }

        // --- 3. UTILITIES ---
        checks['rainwater_harvesting'] = { status: hasRWH ? 'achieved' : 'pending', score: hasRWH ? 3 : 0 };
        checks['solar_energy'] = { status: hasSolar ? 'achieved' : 'pending', score: hasSolar ? 5 : 0 };
        checks['water_recycling'] = { status: hasSTP ? 'achieved' : 'pending', score: hasSTP ? 4 : 0 };
        checks['waste_management'] = { status: hasOWC ? 'achieved' : 'pending', score: hasOWC ? 3 : 0 };
        checks['ev_charging'] = { status: hasEV ? 'achieved' : 'pending', score: hasEV ? 2 : 0 };
        checks['fire_safety'] = { status: hasFire ? 'achieved' : 'pending', score: hasFire ? 1 : 0 };
        checks['energy_efficiency'] = { status: hasHVAC && hasDG ? 'achieved' : (hasHVAC || hasDG ? 'pending' : 'pending'), score: hasHVAC && hasDG ? 4 : 0 };

        // --- 4. LOCATION & AMENITY CHECKS ---
        if (project.locationData?.amenities) {
            const amenities = project.locationData.amenities;

            const transit = amenities.some((a: any) => a.category === 'transit' && a.distance <= 800);
            if (transit) {
                checks['transit_access'] = { status: 'achieved', score: 3 };
            }

            const serviceTypes = new Set(
                amenities
                    .filter((a: any) => ['school', 'hospital', 'park', 'shopping', 'restaurant'].includes(a.category) && a.distance <= 1000)
                    .map((a: any) => a.category)
            );

            if (serviceTypes.size >= 3) {
                checks['amenity_proximity'] = { status: 'achieved', score: 3, metrics: { achieved: serviceTypes.size, target: 3, unit: 'types' } };
            }
        }

        return checks;
    }, [project, simulationResults]);
}
