import type { BuildingStandardTime, StandardTimeEstimation, StandardTimePhase } from './types';

// Median Productivity Rates (from standard time table)
// Expressed in square meters completed per day
export const StandardProductivityRates = {
  // Substructure
  EarthworkAndExcavation: 300,
  Foundation: 2.5,             // 1.67-4.00 m²/day (based on total GFA proxy)
  BasementPerLevel: 6.5,       // ~6-7 m²/day (based on footprint area per level)
  
  // Superstructure
  StructurePerFloor: 24.3,     // 20-28.6 m²/day (based on typical floor plate)
  
  // Finishes & MEP
  Plastering: 2.08,            // 1.67-2.50 m²/day (based on GFA)
  Flooring: 3.52,              // 2.70-4.35 m²/day (based on GFA)
  Painting: 1.66,              // 1.33-2.00 m²/day (based on GFA)
  FalseCeiling: 2.45,          // 1.96-2.94 m²/day (based on GFA)
  MEPComplete: 0.94,           // 0.77-1.11 m²/day (based on GFA)
  
  // External
  ExternalDevelopment: 53.3,   // 40-66.7 m²/day (based on site area)
} as const;

export interface BuildingTimeInput {
  buildingId: string;
  buildingName: string;
  gfaSqm: number;
  footprintSqm: number;
  floors: number;
  basements: number;
}

const DAYS_PER_MONTH = 26;

/**
 * Calculates deterministic construction timelines based on area/productivity rates.
 */
export function calculateStandardTimeEstimates(
  buildings: BuildingTimeInput[],
  plotAreaSqm: number
): StandardTimeEstimation {
  const buildingEstimates: BuildingStandardTime[] = buildings.map(b => {
    const phases: StandardTimePhase[] = [];
    const typicalFloorPlate = b.gfaSqm / (b.floors || 1);

    const parallelCrews = Math.max(1, Math.ceil(typicalFloorPlate / 600));

    // 1. Earthwork & Excavation
    const totalExcavationArea = b.footprintSqm * (1 + (b.basements * 0.5));
    const excDays = Math.max(7, Math.ceil((totalExcavationArea / StandardProductivityRates.EarthworkAndExcavation) / (parallelCrews * 1.5)));
    phases.push({ name: 'Earthwork & Excavation', durationDays: excDays, durationMonths: excDays / DAYS_PER_MONTH });

    // 2. Foundation (uses footprint area — foundation is only at ground level)
    const fndDays = Math.max(15, Math.ceil((b.footprintSqm / StandardProductivityRates.Foundation) / (parallelCrews * 1.5)));
    phases.push({ name: 'Foundation', durationDays: fndDays, durationMonths: fndDays / DAYS_PER_MONTH });

    // 3. Basements
    let bsmntDays = 0;
    if (b.basements > 0) {
        bsmntDays = Math.ceil((b.footprintSqm * b.basements / StandardProductivityRates.BasementPerLevel) / (parallelCrews * 1.5));
        phases.push({ name: 'Basement Levels', durationDays: bsmntDays, durationMonths: bsmntDays / DAYS_PER_MONTH });
    }

    // 4. Superstructure
    const daysPerFloor = Math.max(4, Math.ceil(typicalFloorPlate / (StandardProductivityRates.StructurePerFloor * parallelCrews)));
    const strDays = Math.max(15, daysPerFloor * (b.floors || 1));
    phases.push({ name: 'Superstructure', durationDays: strDays, durationMonths: strDays / DAYS_PER_MONTH });

    // 5. Finishes & MEP
    const finishesDays = Math.max(45, Math.ceil(strDays * 0.5));
    
    phases.push({ name: 'Finishes & MEP', durationDays: finishesDays, durationMonths: finishesDays / DAYS_PER_MONTH });

    const totalDaysRaw = excDays + fndDays + bsmntDays + strDays + finishesDays;

    // ─── STANDARD TIME DELAYS ───
    const bufferDays = Math.ceil(totalDaysRaw * 0.2885);
    phases.push({ name: 'Risk & Weather Buffer', durationDays: bufferDays, durationMonths: bufferDays / DAYS_PER_MONTH });

    const totalDays = totalDaysRaw + bufferDays;

    return {
      buildingId: b.buildingId,
      buildingName: b.buildingName,
      totalDurationDays: totalDays,
      totalDurationMonths: totalDays / DAYS_PER_MONTH,
      phases,
    };
  });

  const totalFootprint = buildings.reduce((sum, b) => sum + b.footprintSqm, 0);
  const externalArea = Math.max(0, plotAreaSqm - totalFootprint);
  let extDays = 0;
  if (externalArea > 0) {
      extDays = Math.max(30, Math.min(120, Math.ceil(externalArea / StandardProductivityRates.ExternalDevelopment)));
  }

  const numProjectPhases = Math.min(3, Math.max(1, Math.ceil(buildingEstimates.length / 3)));
  const buildingsPerPhase = Math.ceil(buildingEstimates.length / numProjectPhases);
  
  let maxCompletionDay = 0;

  buildingEstimates.forEach((b, idx) => {
      const phaseIndex = Math.floor(idx / buildingsPerPhase);
      const indexInPhase = idx % buildingsPerPhase;
      
      const phaseStartDay = phaseIndex * 180; 

      const intraPhaseStartDay = indexInPhase * DAYS_PER_MONTH;
      
      const currentStartDay = phaseStartDay + intraPhaseStartDay;
      
      b.offsetMonths = currentStartDay / DAYS_PER_MONTH;

      const bCompletionEndDay = currentStartDay + b.totalDurationDays;
      if (bCompletionEndDay > maxCompletionDay) {
          maxCompletionDay = bCompletionEndDay;
      }
  });

  const totalProjectDays = maxCompletionDay + extDays;

  return {
    buildings: buildingEstimates,
    totalProjectDurationDays: totalProjectDays,
    totalProjectDurationMonths: totalProjectDays / DAYS_PER_MONTH
  };
}
