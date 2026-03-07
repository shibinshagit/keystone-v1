/**
 * Building Core Calculator
 * Computes exact lift sizes, staircases, corridors, and shafts based on population/floors.
 */

export interface BuildingCoreInputs {
  footprintArea: number; // area of one floor
  numFloors: number;
  avgUnitArea: number;
  intendedUse: 'Residential' | 'Commercial' | 'Institutional';
}

export interface CoreBreakdown {
  totalFloorArea: number;
  
  // Lifts Detail
  passLiftCount: number;
  passLiftArea: number;
  serviceLiftCount: number;
  serviceLiftArea: number;
  fireLiftCount: number;
  fireLiftArea: number;
  stretcherLiftCount: number;
  stretcherLiftArea: number;

  liftCount: number; // total
  liftArea: number; // total
  
  // Stairs
  stairCount: number;
  stairArea: number;
  
  // Circulation
  liftLobbyArea: number;
  corridorArea: number;
  
  // Shafts
  plumbingShaftArea: number;
  electricalShaftArea: number;
  fireRiserArea: number;
  garbageShaftArea: number;
  hvacShaftArea: number;
  medicalGasShaftArea: number;
  totalShaftArea: number;
  
  // Fire
  fireCheckLobbyArea: number;
  refugeAreaPerFloor: number;
  
  totalCoreAreaPerFloor: number;
  totalCirculationAreaPerFloor: number;
  efficiency: number; // BUA to Carpet (Net Usable / Total Floor Area)
  netUsableAreaPerFloor: number;
  estimatedUnitsPerFloor: number;
}

export function calculateBuildingCoreAndCirculation(inputs: BuildingCoreInputs): CoreBreakdown {
  const { footprintArea, numFloors, avgUnitArea, intendedUse } = inputs;
  
  // 1. Initial rough estimate of units/occupants per floor
  const initialNetArea = footprintArea * 0.75;
  const initialUnitsPerFloor = Math.floor(initialNetArea / avgUnitArea);
  
  // Population
  let popPerFloor = 0;
  if (intendedUse === 'Residential') popPerFloor = initialUnitsPerFloor * 5;
  else if (intendedUse === 'Commercial') popPerFloor = footprintArea / 10;
  else if (intendedUse === 'Institutional') popPerFloor = footprintArea / 6;

  // --- 5. Lifts ---
  let passLiftCount = 0;
  let serviceLiftCount = 0;
  let fireLiftCount = 0;
  let stretcherLiftCount = 0;

  const height = numFloors * 3.5;

  if (intendedUse === 'Residential') {
    const totalUnits = initialUnitsPerFloor * numFloors;
    passLiftCount = Math.max(1, Math.ceil(totalUnits / 80));
    if (numFloors > 10) fireLiftCount = 1;
    if (numFloors > 20) serviceLiftCount = 1;
  } else if (intendedUse === 'Commercial') {
    const totalPop = popPerFloor * numFloors;
    passLiftCount = Math.max(1, Math.ceil(totalPop / 275)); // roughly 1 per 250-300
    if (numFloors > 10) fireLiftCount = 1;
    if (numFloors > 20) serviceLiftCount = 1; // mandatory for F > 20
  } else {
    passLiftCount = Math.max(1, Math.ceil((footprintArea * numFloors) / 2250));
    stretcherLiftCount = 1; // Min 1 stretcher mandatory
    if (numFloors > 10) fireLiftCount = 1;
    if (numFloors > 20) serviceLiftCount = 1;
  }

  // --- Reference Table Standard Benchmarks ---
  let benchmarkLifts = 1;
  let benchmarkStairs = 2;
  
  if (numFloors <= 3) {
    benchmarkLifts = 1;
    benchmarkStairs = 2;
  } else if (numFloors <= 6) {
    benchmarkLifts = 2;
    benchmarkStairs = 3;
  } else if (numFloors <= 10) {
    benchmarkLifts = 3; // Table: 2-3 (Using Max)
    benchmarkStairs = 3;
  } else if (numFloors <= 15) {
    benchmarkLifts = 4; // Table: 3-4 (Using Max)
    benchmarkStairs = 4;
  } else if (numFloors <= 20) {
    benchmarkLifts = 5; // Table: 4-5 (Using Max)
    benchmarkStairs = 4;
  } else {
    benchmarkLifts = 5; // Table: 4-5 (Using Max)
    benchmarkStairs = 4;
  }

  // Apply benchmark minimums (pad with passenger lifts if total is lower than benchmark)
  let totalLifts = passLiftCount + serviceLiftCount + fireLiftCount + stretcherLiftCount;
  if (totalLifts < benchmarkLifts) {
    passLiftCount += (benchmarkLifts - totalLifts);
    totalLifts = benchmarkLifts;
  }

  const passLiftArea = passLiftCount * (intendedUse === 'Residential' ? 2.25 : 2.5);
  const fireLiftArea = fireLiftCount * 4.5;
  const serviceLiftArea = serviceLiftCount * 4.5;
  const stretcherLiftArea = stretcherLiftCount * 5.5;

  const liftCount = totalLifts;
  const liftArea = passLiftArea + fireLiftArea + serviceLiftArea + stretcherLiftArea;

  const liftLobbyPerLift = intendedUse === 'Residential' ? 4 : intendedUse === 'Commercial' ? 7 : 7.5;
  const liftLobbyArea = liftCount * liftLobbyPerLift;

  // --- 6. Stairs ---
  let stairCount = 2; // Standard for most mid-rise
  if (popPerFloor <= 30 && height <= 20) stairCount = 1;
  else if (popPerFloor > 500) stairCount = 3;
  
  // Apply benchmark minimums
  stairCount = Math.max(stairCount, benchmarkStairs);
  
  let areaPerStair = 15; // default residential
  if (intendedUse === 'Commercial') areaPerStair = 21;
  else if (intendedUse === 'Institutional') areaPerStair = 28;
  
  const stairArea = stairCount * areaPerStair;

  // --- 7. Corridors ---
  let corridorArea = 0;
  if (intendedUse === 'Residential') {
      if (initialUnitsPerFloor <= 4) corridorArea = 8;
      else if (initialUnitsPerFloor <= 8) corridorArea = 16;
      else corridorArea = 28;
  } else if (intendedUse === 'Commercial') {
      corridorArea = footprintArea * 0.08;
  } else {
      corridorArea = footprintArea * 0.12;
  }

  // --- 8. Shafts ---
  let plumbingShaftCount = intendedUse === 'Residential' ? Math.max(1, Math.ceil(initialUnitsPerFloor / 4)) : 
                           intendedUse === 'Commercial' ? Math.max(1, Math.ceil(footprintArea / 750)) :
                           Math.max(1, Math.ceil(footprintArea / 500));
  const plumbingShaftArea = plumbingShaftCount * 0.85; // 0.7-1.0
  const electricalShaftArea = 0.6; // 1 per core, 0.5-0.7
  const fireRiserArea = 0.5; // 1 per core
  const garbageShaftArea = (intendedUse === 'Residential' && initialUnitsPerFloor >= 6) ? 0.7 : 0;
  
  let hvacShaftArea = 0;
  if (intendedUse === 'Commercial') {
      hvacShaftArea = (footprintArea / 1000) * 3;
  } else if (intendedUse === 'Institutional') {
      hvacShaftArea = 4.5; // ~3-6 sqm per core
  }

  const medicalGasShaftArea = intendedUse === 'Institutional' ? 1.5 : 0;

  const totalShaftArea = plumbingShaftArea + electricalShaftArea + fireRiserArea + garbageShaftArea + hvacShaftArea + medicalGasShaftArea;

  // --- 9. Fire Lobbies & Refuge ---
  const fireCheckLobbyArea = height > 24 ? 10 : 0; // 8-12 sqm if > 24m
  
  let refugeAreaPerFloor = 0;
  if (height > 24) {
      const numRefugeFloors = Math.floor(numFloors / 7);
      const pct = intendedUse === 'Residential' ? 0.04 : (intendedUse === 'Commercial' ? 0.06 : 0.07);
      const totalRefugeArea = numRefugeFloors * footprintArea * pct;
      refugeAreaPerFloor = totalRefugeArea / numFloors; // distributed
  }

  // --- Final Floor Math ---
  const totalCoreAreaPerFloor = liftArea + stairArea + totalShaftArea + fireCheckLobbyArea + refugeAreaPerFloor;
  const totalCirculationAreaPerFloor = liftLobbyArea + corridorArea;
  
  const deductionArea = totalCoreAreaPerFloor + totalCirculationAreaPerFloor;
  const netUsableAreaPerFloor = Math.max(0, footprintArea - deductionArea);
  const efficiency = (netUsableAreaPerFloor / footprintArea) * 100;

  // Re-verify unit count based on precise net usable area
  const finalUnitsPerFloor = Math.floor(netUsableAreaPerFloor / avgUnitArea);

  return {
    totalFloorArea: footprintArea,
    // Lifts
    passLiftCount,
    passLiftArea,
    serviceLiftCount,
    serviceLiftArea,
    fireLiftCount,
    fireLiftArea,
    stretcherLiftCount,
    stretcherLiftArea,
    liftCount,
    liftArea,
    // Stairs
    stairCount,
    stairArea,
    // Circulation
    liftLobbyArea,
    corridorArea,
    // Shafts
    plumbingShaftArea,
    electricalShaftArea,
    fireRiserArea,
    garbageShaftArea,
    hvacShaftArea,
    medicalGasShaftArea,
    totalShaftArea,
    // Fire
    fireCheckLobbyArea,
    refugeAreaPerFloor,
    // Final
    totalCoreAreaPerFloor,
    totalCirculationAreaPerFloor,
    efficiency,
    netUsableAreaPerFloor,
    estimatedUnitsPerFloor: finalUnitsPerFloor
  };
}
