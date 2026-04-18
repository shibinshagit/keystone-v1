
import type { Feature, Polygon, Point } from 'geojson';
import { z } from 'zod';

export interface SoilData {
  ph: number | null | undefined;
  bd: number | null | undefined; // bulk density
}

export enum BuildingIntendedUse {
  Residential = 'Residential',
  Commercial = 'Commercial',
  Retail = 'Retail',
  Office = 'Office',
  MixedUse = 'Mixed-Use',
  Industrial = 'Industrial',
  Institutional = 'Institutional',
  Public = 'Public',
  Utility = 'Utility',
  Hospitality = 'Hospitality',
}

export enum LandPlotType {
  Vacant = 'vacant',
  Redevelopment = 'redevelopment',
  Both = 'both',
}

export enum LandZoningPreference {
  BuiltUp = 'built-up',
  Agricultural = 'agricultural',
  Waste = 'waste',
  MixedUse = 'mixed-use',
  Industrial = 'industrial',
}

export enum LandProximity {
  Metro = 'metro',
  Highway = 'highway',
  Airport = 'airport',
  Schools = 'schools',
  Hospitals = 'hospitals',
  Retail = 'retail',
  Employment = 'employment',
  Utilities = 'utilities',
}



export interface Core {
  id: string;
  type: 'Lift' | 'Stair' | 'Service' | 'Lobby' | 'Circulation';
  geometry: Feature<Polygon>;
  floorId?: string;
}

export interface Unit {
  id: string;
  type: string; // e.g. "2BHK", "Studio"
  geometry: Feature<Polygon>;
  color?: string; // e.g. "#ADD8E6"
  floorId?: string;
  targetArea?: number; // Hardcoded target sqm (e.g. 140 for 2BHK, 185 for 3BHK, 245 for 4BHK)
}

export interface Floor {
  id: string;
  height: number;
  color: string;
  type?: 'General' | 'Utility' | 'Parking';
  intendedUse?: BuildingIntendedUse; // Per-floor use type (for mixed-use vertical stacking)
  utilityType?: UtilityType;
  parkingType?: ParkingType;
  parkingCapacity?: number;
  level?: number;  // For basement: -1 = B1, -2 = B2, etc.
  evStations?: number; // Number of EV charging points on this floor
  units?: Unit[]; // Units on this floor (if applicable)
}

export interface Building {
  id: string;
  name: string;
  isPolygonClosed: boolean;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  originalGeometry?: Feature<Polygon>;
  originalCentroid?: Feature<Point>;
  originalCores?: Core[];
  originalUnits?: Unit[];
  originalInternalUtilities?: UtilityArea[];
  originalAlignmentRotation?: number;
  height: number;
  opacity: number;
  extrusion: boolean;
  soilData: SoilData | null;
  intendedUse: BuildingIntendedUse;
  floors: Floor[];
  cores?: Core[];
  units?: Unit[];
  entrances?: EntryPoint[];
  area: number;
  numFloors: number;
  typicalFloorHeight: number;
  groundFloorHeight?: number;
  visible: boolean;
  baseHeight?: number;
  utilities?: UtilityType[]; 
  internalUtilities?: UtilityArea[]; 
  programMix?: { residential: number; commercial: number; hospitality: number; institutional: number };
  internalsVisible?: boolean;
  alignmentRotation?: number;
  totalFloors?: number;
}

export interface GreenArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
}

export interface BuildableArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
  intendedUse: BuildingIntendedUse;
}

export interface ParkingArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
  type?: ParkingType;                                    // Type of parking
  capacity?: number;                                     // Number of parking spaces
  spaceSize?: number;                                    // Area per space (m²)
  efficiency?: number;                                   // Usable area ratio (0-1)
  level?: number;                                        // For basement: -1 = B1, -2 = B2, etc.
  originalGeometry?: Feature<Polygon>;                   // Pristine ring geometry (before utility subtraction)
}

export enum ParkingType {
  Surface = 'Surface',
  Basement = 'Basement',
  Stilt = 'Stilt',
  Podium = 'Podium',
}

export enum UtilityType {
  STP = 'STP',
  WTP = 'WTP',
  HVAC = 'HVAC',
  Electrical = 'Electrical',
  Water = 'Water',
  Fire = 'Fire',
  Gas = 'Gas',
  Roads = 'Roads',
  OWC = 'OWC',
  DGSet = 'DG Set',
  RainwaterHarvesting = 'Rainwater Harvesting',
  SolidWaste = 'Solid Waste',
  SolarPV = 'Solar PV',
  EVStation = 'EV Station',
  Admin = 'Admin',
}

export interface UtilityArea {
  id: string;
  name: string;
  type: UtilityType;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  targetArea?: number;
  visible: boolean;
  level?: number;
  height?: number;
}

export interface Label {
  id: string;
  text: string;
  position: [number, number];
}

export interface EntryPoint {
  id: string;
  type: 'Entry' | 'Exit' | 'Both';
  position: [number, number]; // [lng, lat]
  name?: string;
  color?: string;
}

export interface Plot {
  id: string;
  projectId: string; // The project this plot belongs to
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  setback: number; // Default inner setback
  buildings: Building[];
  greenAreas: GreenArea[];
  parkingAreas: ParkingArea[];
  buildableAreas: BuildableArea[];
  utilityAreas: UtilityArea[];
  entries: EntryPoint[];
  labels: Label[];
  visible: boolean;
  location: string | null;
  availableRegulations: RegulationData[] | null;
  selectedRegulationType: string | null;
  regulation: RegulationData | null;
  // Regulation-derived constraints
  maxBuildingHeight?: number; // Maximum building height in meters (from regulations)
  far?: number; // Floor Area Ratio (from regulations)
  maxCoverage?: number; // Maximum ground coverage percentage (from regulations)
  userFAR?: number; // User-defined target FAR override
  userGFA?: number; // User-defined target GFA override
  developmentStats?: DevelopmentStats;
  roadAccessSides?: string[]; // Detected road directions (N, S, E, W)
  complianceContext?: PlotComplianceContext;
}

export interface PlotComplianceContext {
  siteSlope?: 'north-east-lowest' | 'flat' | 'reverse' | 'unknown';
  internalCirculation?: 'clockwise' | 'anti-clockwise' | 'unknown';
  tJunctionCount?: number;
  idolFacing?: 'east' | 'west' | 'north' | 'south' | 'unknown';
  commonToiletsZone?: 'se' | 'nw' | 'other' | 'none' | 'unknown';
  hasToiletInNorthEast?: boolean;
  hasToiletInBrahmasthan?: boolean;
  northEastExtension?: 'present' | 'none' | 'cut';
  southWestExtension?: boolean;
  extensionRemediesApplied?: boolean;
  solarFacingRoof?: 'south' | 'other' | 'north' | 'unknown';
  basementUseInNorthEast?: 'parking-only' | 'other' | 'none' | 'unknown';
}


export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface UnderwritingData {
  // 1. Borrower / Corporate Data
  promoterName?: string;
  companyName?: string;
  legalEntity?: string;
  yearsInRealEstate?: number;
  creditRating?: string;
  completedProjectsCount?: number;
  totalAreaDelivered?: number;
  netWorthData?: {
    fy23?: { assets: number; liabilities: number; netWorth: number };
    fy24?: { assets: number; liabilities: number; netWorth: number };
    fy25?: { assets: number; liabilities: number; netWorth: number };
  };
  otherProjects?: Array<{ name: string; status: string; size: string; bankExposure: string }>;
  managementCapability?: string;

  // 2. Loan Request Specifics
  requestedLoanAmount?: number;
  promoterEquity?: number;
  targetInterestRate?: number; // e.g., 10 for 10%
  loanTenureMonths?: number;
  moratoriumMonths?: number;

  // 3. Legal & Regulatory Status
  approvals?: {
    buildingPlan?: 'Pending' | 'Approved' | 'Not Applicable';
    environmentClearance?: 'Pending' | 'Approved' | 'Not Applicable';
    fireNoc?: 'Pending' | 'Approved' | 'Not Applicable';
    utilityConnections?: 'Pending' | 'Approved' | 'Not Applicable';
    reraRegistration?: string; // "Pending" or the actual RERA number
  };

  // 4. Micro-Market & Competitors
  competitors?: Array<{
    name: string;
    sellingPricePerSqm: number;
    absorptionRate: string;
  }>;

  // 5. Land Cost & Additional Financials
  actualLandPurchaseCost?: number;
  stampDutyAndLegalFees?: number;
}

export interface EvaluateLandInput {
  projectName: string;
  location: string;
  landSize: number;
  intendedUse: BuildingIntendedUse;
  priceRange: string;
  plotType: LandPlotType;
  zoningPreference: LandZoningPreference;
  proximity: LandProximity[];
  notes?: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  plots: Plot[];
  lastModified: string;
  totalPlotArea?: number | null;
  designOptions?: string | DesignOption[]; // JSON string for Firestore storage, or parsed object in app
  intendedUse?: BuildingIntendedUse;
  location?: string | { lat: number; lng: number }; // e.g. "Delhi", "Maharashtra" or geocoded coordinates
  regulationId?: string; // Specific regulation document ID (e.g. "Delhi-Residential Group Housing")
  greenCertification?: ('IGBC' | 'GRIHA' | 'LEED' | 'Green Building')[];
  vastuCompliant?: boolean;
  feasibilityParams?: FeasibilityParams;
  simulationResults?: {
    wind?: { compliantArea: number; avgSpeed: number };
    sun?: { compliantArea: number; avgHours: number };
  };
  locationData?: {
    amenities: any[]; // Storing FeatureCollection or array of amenities
    score?: number;
  };
  evaluateLandInput?: EvaluateLandInput;
  generationParams?: any; // App settings, like setbacks
  underwriting?: UnderwritingData;
}

export interface UnitTypology {
  name: string; // e.g., '2BHK', '3BHK', '4BHK'
  area: number; // sqm
  mixRatio: number; // 0-1 (percentage of total units)
}

export interface FeasibilityParams {
  coreFactor: number; // 0.15 - 0.25 (15-25%)
  circulationFactor: number; // 0.10 - 0.15 (10-15%)
  unitMix: UnitTypology[];
  efficiencyTarget: number; // e.g., 0.70
  selectedUtilities?: string[]; // Optional list of enabled utilities
  exactTypologyAllocation?: boolean; // Force grid allocation based strictly on theoretical unit mix
  commercialMix?: { retail: number; office: number }; // Retail vs Office split
}

export interface DevelopmentStats {
  totalBuiltUpArea: number; // Max based on FAR
  maxBuildableArea: number; // based on geometry/coverage
  achievedFAR: number;
  efficiency: number; // Net Saleable / Total Built-up
  areas: {
    core: number;
    circulation: number;
    saleable: number;
    services: number;
  };
  units: {
    total: number;
    breakdown: Record<string, number>; // "2BHK": 10
  };
  vastuScore?: {
    overall: number;
    rating: 'High' | 'Medium' | 'Low';
    breakdown: { category: string; score: number; maxScore?: number; feedback: string }[];
  };
  greenAnalysis?: {
    overall: number;
    rating: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    breakdown: { category: string; score: number; feedback: string }[];
  };
}

export interface GreenRegulationData {
  id?: string;
  name: string; // e.g., "IGBC Green Homes v3.0"
  certificationType: 'IGBC' | 'GRIHA' | 'LEED' | 'Green Building';
  // Legacy constraints for backward compatibility & easy access
  constraints: {
    minOpenSpace?: number; // 0.30 for 30%
    maxGroundCoverage?: number;
    minGreenCover?: number;
  };
  // Explicit analysis thresholds for visual analysis engine
  analysisThresholds?: {
    sunHours?: { min: number; target: number }; // e.g., { min: 2, target: 4 }
    daylightFactor?: { min: number; target: number }; // e.g., { min: 0.02, target: 0.04 }
    windSpeed?: { min: number; target: number }; // e.g., { min: 1, target: 2 } in m/s
  };
  // Comprehensive data structure
  categories?: CertificationCategory[];
  ratingBands?: CertificationRatingBand[];
  confidence?: number;
  lastModified?: number;
}

export interface CertificationRatingBand {
  label: string; // e.g. "Certified", "Silver", "Gold"
  minPoints: number;
  maxPoints?: number;
}

export interface CertificationCategory {
  name: string; // e.g. "Sustainable Design"
  credits: CertificationCredit[];
}

export interface CertificationCredit {
  code?: string; // e.g. "SD Credit 1"
  name: string; // e.g. "Natural Topography & Vegetation"
  points?: number;
  type?: 'mandatory' | 'credit' | 'prerequisite';
  requirements?: string[]; // Extracted text requirements
  intent?: string;
}

export interface VastuRegulationData {
  id?: string;
  name: string; // e.g. "Standard Vastu Guidelines"
  source?: string; // e.g. "Vastu Shastra PDF"
  recommendations: VastuRecommendation[];
  scorecardItems?: VastuScorecardItem[];
  verdictBands?: VastuVerdictBand[];
  totalPossibleScore?: number;
  complianceScore?: number;
  lastModified?: number;
}

export interface VastuRecommendation {
  category: 'Entrance' | 'Kitchen' | 'MasterBedroom' | 'Water' | 'Living' | 'General';
  idealDirections: string[]; // e.g. ["NE", "E"]
  avoidDirections: string[]; // e.g. ["SW"]
  description?: string;
  weight?: number; // Importance (1-10)
}

export interface VastuScorecardItem {
  id: string;
  code: string; // e.g. "B1"
  section: string; // e.g. "Main Entrance & Gate Placement"
  title: string;
  complianceBasis: string;
  maxMarks: number;
}

export interface VastuVerdictBand {
  label: string; // e.g. "VASTU COMPLIANT — Approved"
  minScore: number;
  maxScore?: number;
}

// 32-Zone Shakti Chakra Directions
export const VASTU_ZONES_32 = [
  'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8',
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'
] as const;
export type VastuZone32 = typeof VASTU_ZONES_32[number];

export interface AdvancedKPIs {
  // 1. Area Metrics
  totalPlotArea: number;
  totalBuiltUpArea: number;
  achievedFAR: number;
  groundCoveragePct: number;

  // 2. Specialized Areas
  sellableArea: number;
  circulationArea: number;
  coreArea: number;

  // 3. Service & Amenity Breakdown
  services: {
    total: number;
    electrical: number;
    mech: number;
    plumbing: number;
  };
  amenities: {
    total: number;
    definedList: Record<string, number>; // e.g. "Gym": 100
  };

  // 4. External Areas
  greenArea: {
    total: number;
    percentage: number;
    perCapita: number; // Green area per person
  };
  roadArea: number;
  openSpace: number; // Vacant + Green - Roads

  // 5. Efficiency
  efficiency: number; // Net / Gross

  // 6. Housing
  totalUnits: number;
  parking: {
    required: number;
    provided: number;
    breakdown: { stilt: number; basement: number; surface: number; podium: number; }
  };

  // 7. Compliance Scores (0-100)
  compliance: {
    bylaws: number;
    green: number;
  // If a project used an admin-selected green regulation (IGBC/GRIHA/LEED),
  // surface that structured data to consumers (optional).
  greenStandards?: GreenRegulationData | null;
    vastu: number;
    bylawScoreSummary?: AdditiveScoreSummary;
    greenScoreSummary?: AdditiveScoreSummary;
    vastuScoreSummary?: AdditiveScoreSummary;
    // Per-item breakdowns for dashboard display
    bylawItems: ComplianceItem[];
    greenItems: ComplianceItem[];
    vastuItems: ComplianceItem[];
  };
}

export interface AdditiveScoreSummary {
  totalScore: number;
  maxScore: number;
  percentage: number;
}

export interface ComplianceItem {
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'na';
  detail?: string; // e.g. "4.12 / 2.0"
  weight: number;  // legacy field, mirrored from maxScore for compatibility
  maxScore: number;
  achievedScore: number;
  achievedPoints?: number; // Normalized 0..1 point (1=pass, 0.5=warn, 0=fail)
}


export type LandUseType = 'residential' | 'commercial' | 'mixed' | 'institutional';

// AI Generation Payloads
export const AiGeneratedObjectSchema = z.object({
  name: z.string().describe('The name of the object (e.g., "Residential Tower A", "Main Park").'),
  type: z.enum(['Building', 'GreenArea', 'ParkingArea', 'UtilityArea']).describe('The type of the object.'),
  utilityType: z.nativeEnum(UtilityType).optional().describe('Specific type if this is a UtilityArea.'),
  placement: z.string().describe("A simple description of where to place this object within the plot (e.g., 'north side', 'center', 'south-west corner')."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe('The intended use of the building.'),
  numFloors: z.number().optional().describe('The number of floors for the building.'),
  massing: z.enum(['Simple', 'PodiumTower']).optional().describe('The massing strategy for the building. Use "PodiumTower" for tall buildings to create a more realistic look.'),
}).describe('A single object within the plot, like a building or a park.');
export type AiGeneratedObject = z.infer<typeof AiGeneratedObjectSchema>;

export const AiScenarioSchema = z.object({
  name: z.string().describe("A short, catchy name for this scenario (e.g., 'Balanced Urbanism', 'Green-First Approach')."),
  description: z.string().describe("A brief (1-2 sentence) description of this scenario's overall design philosophy."),
  objects: z.array(AiGeneratedObjectSchema).describe('An array of planned objects (buildings, green areas, etc.) for this specific scenario.'),
});
export type AiScenario = z.infer<typeof AiScenarioSchema>;


export const GenerateSiteLayoutInputSchema = z.object({
  plotGeometry: z.string().describe('A JSON string of the GeoJSON Feature<Polygon> for the parent plot. This is for context only.'),
  userDefinedAreas: z.string().describe('A JSON string of an array of user-defined areas within the plot. Each area has a geometry and an intendedUse (e.g., Residential, GreenArea). The AI should respect these zones.'),
  prompt: z.string().describe("The user's text prompt describing the desired layout, which can be used to refine the plan for the user-defined areas."),
  regulations: z.string().describe('A JSON string of the applicable development regulations for this plot\'s location. The AI MUST adhere to these rules.'),
});
export type GenerateSiteLayoutInput = z.infer<typeof GenerateSiteLayoutInputSchema>;

export const GenerateSiteLayoutOutputSchema = z.object({
  scenarios: z.array(AiScenarioSchema).min(2).max(2).describe('An array containing exactly two distinct layout scenarios for the user to choose from.'),
});
export type AiSiteLayout = z.infer<typeof GenerateSiteLayoutOutputSchema>;
export type GenerateSiteLayoutOutput = z.infer<typeof GenerateSiteLayoutOutputSchema>;


export const AiMassingGeneratedObjectSchema = z.object({
  name: z.string().describe('The name of the object (e.g., "Residential Tower A", "Main Park").'),
  type: z.enum(['Building']).describe('The type of the object.'),
  placement: z.string().describe("This should be the name of the user-defined zone it belongs to."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe('The intended use of the building.'),
  numFloors: z.number().optional().describe('The number of floors for the building.'),
  massing: z.enum(['Simple', 'PodiumTower']).optional().describe('The massing strategy for the building.'),
}).describe('A single building to be placed within the buildable area.');
export type AiMassingGeneratedObject = z.infer<typeof AiMassingGeneratedObjectSchema>;

export const AiMassingScenarioSchema = z.object({
  name: z.string().describe("A short, catchy name for this massing option (e.g., 'Maximum FAR Tower', 'Twin Towers', 'Courtyard Block')."),
  description: z.string().describe("A brief (1-2 sentence) description of this massing option's design philosophy."),
  objects: z.array(AiMassingGeneratedObjectSchema).describe('An array of planned buildings for this specific scenario.'),
});
export type AiMassingScenario = z.infer<typeof AiMassingScenarioSchema>;

export const GenerateMassingInputSchema = z.object({
  plot: z.string().describe('A JSON string of the plot. It has a geometry, name, and area. The AI should place new buildings inside this area, respecting the setback.'),
  regulations: z.string().describe('A JSON string of the applicable development regulations for this plot\'s location. The AI MUST adhere to these rules.'),
});
export type GenerateMassingInput = z.infer<typeof GenerateMassingInputSchema>;

export const GenerateMassingOutputSchema = z.object({
  scenarios: z.array(AiMassingScenarioSchema).min(2).max(2).describe('An array containing exactly two distinct massing scenarios for the user to choose from.'),
});
export type GenerateMassingOutput = z.infer<typeof GenerateMassingOutputSchema>;

// ─── AI RENDERING SCHEMAS ───────────────────────────────────────────────────
export interface RenderingBuildingInfo {
  name: string;
  height: number;
  numFloors: number;       // above-ground floors
  basementFloors: number;  // underground floors (B1, B2…)
  totalFloors: number;     // above + basement
  floorHeight: number;
  groundFloorHeight: number; // ground floor height (often taller, e.g. 4.5m)
  footprintArea: number;
  footprintWidth: number;  // meters — measured from polygon bounding box
  footprintDepth: number;  // meters — measured from polygon bounding box
  intendedUse: string;
  typology: string;
  gfa: number;             // gross floor area (footprint × totalFloors)
  programMix?: { residential: number; commercial: number; hospitality: number; institutional: number };
  /** Per-floor use allocation for mixed-use buildings, e.g. [{use:'Retail',floors:'1-2'},{use:'Office',floors:'3-5'}] */
  floorUseAllocation?: { use: string; floors: string; count: number }[];
  cores: { lifts: number; stairs: number; service: number; lobbies: number };
  unitCount: number;
  unitBreakdown: Record<string, number>;  // e.g. { '2BHK': 10, '3BHK': 8 }
  parkingFloors: number;
  parkingCapacity: number;
  evStations: number;
  position?: string;       // spatial placement on plot (e.g. "front-left", "back-right")
  footprint?: number[][][];
  center?: { x: number; y: number };
  relativePosition?: { x: number; y: number };
  rotation?: number;
}

export interface RenderingPlotInfo {
  plotArea: number;
  subPlotCount: number;    // number of plots/subplots in the project
  setback: number;
  location: string;
  greenAreas: number;
  parkingAreas: number;
  far?: number;
  maxCoverage?: number;
  maxBuildingHeight?: number;
  regulationType?: string;
  roadAccessSides?: string[];
  footprint?: number[][][];
  origin?: { x: number; y: number };
}

export interface RenderingDesignInfo {
  landUse: string;
  unitMix: Record<string, number>;
  selectedUtilities: string[];
  hasPodium: boolean;
  podiumFloors: number;
  parkingTypes: string[];
  layoutConstraint?: string;
}

export interface RenderingProjectSummary {
  // KPIs
  totalBuiltUpArea: number;    // GFA across all buildings
  achievedFAR: number;
  groundCoveragePct: number;   // %
  sellableArea: number;
  openSpace: number;           // sqm
  efficiency: number;          // 0–1
  totalUnits: number;
  // Parking
  parkingSummary: { type: string; count: number }[];
  // Utilities on site
  utilities: string[];
  // Compliance
  compliance: {
    bylaws: number;
    green: number;
    vastu: number;
    bylawScoreSummary?: AdditiveScoreSummary;
    greenScoreSummary?: AdditiveScoreSummary;
    vastuScoreSummary?: AdditiveScoreSummary;
  }; // 0-100 scores
  // Custom zones
  zones: {
    buildable: { name: string; area: number; intendedUse: string }[];
    green: { name: string; area: number }[];
    parking: { name: string; area: number; type?: string; capacity?: number }[];
    utility: { name: string; area: number; type: string }[];
  };
  // Design strategy
  designStrategy: {
    landUse: string;
    typology: string;
    unitMix: Record<string, number>;
    hasPodium: boolean;
    podiumFloors: number;
    parkingTypes: string[];
    selectedUtilities: string[];
  };
}

export interface GenerateRenderingInput {
  buildings: RenderingBuildingInfo[];
  plot: RenderingPlotInfo;
  design: RenderingDesignInfo;
  /** Base64-encoded site plan PNG for image-to-image rendering (uploaded to public host server-side) */
  controlImageBase64?: string;
  /** Optional free-text override from the user (mood, style, materials, camera angle, etc.) */
  userPrompt?: string;
}

export interface GenerateRenderingOutput {
  imageUrl: string;
  buildings: RenderingBuildingInfo[];
  plot: RenderingPlotInfo;
  summary: RenderingProjectSummary;
}


export const AiZoneSchema = z.object({
  name: z.string().describe("A descriptive name for the zone (e.g., 'Residential Block A', 'Community Park', 'Visitor Parking', 'STP Zone')."),
  type: z.enum(['BuildableArea', 'GreenArea', 'ParkingArea', 'UtilityArea']).describe("The classification of the zone."),
  utilityType: z.nativeEnum(UtilityType).optional().describe("Required if type is 'UtilityArea'."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe("If the zone is a 'BuildableArea', what is its primary purpose?"),
});
export type AiZone = z.infer<typeof AiZoneSchema>;

export const GenerateZonesInputSchema = z.object({
  plotGeometry: z.string().describe("A JSON string of the plot's GeoJSON geometry."),
  prompt: z.string().describe("The user's prompt describing the desired zones and layout."),
  regulations: z.string().describe("A JSON string of applicable development regulations."),
});
export type GenerateZonesInput = z.infer<typeof GenerateZonesInputSchema>;

export const GenerateZonesOutputSchema = z.object({
  zones: z.array(AiZoneSchema).describe("An array of generated zones that subdivide the plot."),
});
export type GenerateZonesOutput = z.infer<typeof GenerateZonesOutputSchema>;


export type DrawingObjectType = 'Plot' | 'Zone' | 'Building' | 'Road';

export type SelectableObjectType = 'Plot' | 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea' | 'Label' | 'EntryPoint' | 'Unit' | 'Core';


// Admin Panel Types
export interface RegulationValue {
  desc: string;
  unit: string;
  value: number | any;
  min?: number | any;
  max?: number | any;
  exampleStr?: string;
}

export interface RegulationData {
  id?: string;
  location: string;
  type: string;
  geometry: { [key: string]: RegulationValue };
  facilities: { [key: string]: RegulationValue };
  sustainability: { [key: string]: RegulationValue };
  safety_and_services: { [key: string]: RegulationValue };
  administration: { [key: string]: RegulationValue };
}

export const REGULATION_SUB_GROUPS: Record<string, string[]> = {
    "Zoning & Land": ["land_use_zoning", "minimum_plot_size", "minimum_frontage_width", "conversion_status", "land_use_category", "density_norms", "units_per_acre", "population_load", "tod_rules", "special_zones"],
    "FAR & FSI": ["floor_area_ratio", "premium_fsi_tdr", "premium_far_purchasable", "fungible_fsi_incentive", "fungible_far_incentive", "excluded_areas_calc", "exclusions_basement_services"],
    "Setbacks": ["setback", "front_setback", "rear_setback", "side_setback", "road_width", "road_setback_building_line", "highrise_setback_multiplier", "based_on_road_width", "based_on_building_height", "based_on_plot_size"],
    "Building Height": ["max_height", "height_vs_road_width", "aviation_clearance", "shadow_skyline_control"],
    "Parking & Traffic": ["parking", "entry_exit_width", "internal_road_width", "parking_ecs", "visitor_parking", "ramp_slope", "turning_radius"],
    "Building Planning": ["staircase_width", "staircase_count", "lift_requirements", "refuge_areas", "corridor_widths", "unit_size_compliance"],
    "Environment & Greens": ["open_space", "max_ground_coverage", "tree_plantation_green_cover", "leed_compliance", "igbc_compliance", "griha_compliance", "rainwater_harvesting", "solar_panels", "water_consumption_norm", "energy_efficiency"],
    "Fire & Life Safety": ["fire_safety", "fire_tender_access", "staircases_by_height", "fire_exits_travel_distance", "refuge_floors", "fire_fighting_systems", "fire_command_center", "fire_tender_movement"],
    "Utilities & MEP": ["water_supply_approval", "sewer_connection_stp", "stormwater_drainage", "electrical_load_sanction", "transformer_placement", "backup_power_norms", "gas_pipelines", "telecom_infrastructure", "sewage_treatment_plant", "solid_waste_management"],
    "Structural Engineering": ["seismic_zone", "wind_load", "soil_bearing_capacity"],
    "Financial & Legal": ["fee_rate", "saleable_vs_carpet_rera", "exit_compliance", "absorption_assumptions", "infra_load_vs_financial_viability"]
};

export interface DesignOption {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  data: {
    plots: Plot[];
    generationParams: any;
  };
}

// Unit Type Template for Admin Configuration
export interface UnitTemplate {
  id: string;
  name: string; // "Luxury 3BHK", "Compact 2BHK"
  bhk_type: '1BHK' | '2BHK' | '3BHK' | '4BHK' | '5BHK';
  location?: string; // Optional: "Delhi", "Mumbai", or undefined for generic/all locations
  carpet_area_sqm: number; // Net usable area
  builtup_area_sqm: number; // Including walls, balconies
  balcony_area_sqm: number;
  efficiency_ratio: number; // carpet / builtup (0.60 - 0.80)
  min_width_m: number; // Minimum unit width
  min_depth_m: number; // Minimum unit depth
  description?: string;
  created_at: string;
  updated_at: string;
}

// Cost & Revenue Parameters for Admin Configuration
export interface CostRevenueParameters {
  id: string;
  location: string; // "Delhi", "Mumbai", etc.
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';

  // Cost Parameters (per sqm in local currency) — mid/mode values
  earthwork_cost_per_sqm: number;
  structure_cost_per_sqm: number;
  finishing_cost_per_sqm: number;
  services_cost_per_sqm: number; // MEP
  total_cost_per_sqm: number; // Calculated field

  // Range fields for Monte Carlo simulation (min/max)
  earthwork_cost_per_sqm_min?: number;
  earthwork_cost_per_sqm_max?: number;
  structure_cost_per_sqm_min?: number;
  structure_cost_per_sqm_max?: number;
  finishing_cost_per_sqm_min?: number;
  finishing_cost_per_sqm_max?: number;
  services_cost_per_sqm_min?: number;
  services_cost_per_sqm_max?: number;

  // Utility Costs (absolute or per-unit)
  utility_costs?: {
    ugt_pumping?: number;
    ugt_pumping_min?: number;
    ugt_pumping_max?: number;
    
    stp_per_kld?: number;
    stp_per_kld_min?: number;
    stp_per_kld_max?: number;

    wtp_cost?: number;
    wtp_cost_min?: number;
    wtp_cost_max?: number;

    transformer_per_kva?: number;
    transformer_per_kva_min?: number;
    transformer_per_kva_max?: number;

    dg_per_kva?: number;
    dg_per_kva_min?: number;
    dg_per_kva_max?: number;

    fire_fighting?: number;
    fire_fighting_min?: number;
    fire_fighting_max?: number;

    lifts_per_unit?: number;
    lifts_per_unit_min?: number;
    lifts_per_unit_max?: number;

    solar_per_kw?: number;
    solar_per_kw_min?: number;
    solar_per_kw_max?: number;

    hvac_per_tr?: number;
    hvac_per_tr_min?: number;
    hvac_per_tr_max?: number;

    owc_per_kg_per_day?: number;
    owc_per_kg_per_day_min?: number;
    owc_per_kg_per_day_max?: number;
  };

  // Revenue Parameters
  market_rate_per_sqm: number; // Selling price per sqm
  sellable_ratio: number; // 0.70 - 0.85 (carpet/builtup)

  // Metadata
  currency: string; // "INR", "USD"
  last_updated: string;
  notes?: string;
}

// Time Estimation Parameter for Admin Configuration
export interface TimeEstimationParameter {
  id: string;
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';
  height_category: 'Low-Rise (<15m)' | 'Mid-Rise (15-45m)' | 'High-Rise (>45m)';

  // Durations (in months unless specified) — mid/mode values
  excavation_timeline_months: number;
  foundation_timeline_months: number;
  structure_per_floor_days: number;
  finishing_per_floor_days: number;
  services_overlap_factor: number; // 0.0 - 1.0 (overlap with structure)
  contingency_buffer_months: number;

  // Range fields for Monte Carlo simulation (min/max)
  excavation_timeline_months_min?: number;
  excavation_timeline_months_max?: number;
  foundation_timeline_months_min?: number;
  foundation_timeline_months_max?: number;
  structure_per_floor_days_min?: number;
  structure_per_floor_days_max?: number;
  finishing_per_floor_days_min?: number;
  finishing_per_floor_days_max?: number;

  // Delay factors (percentage of productivity loss)
  delay_factors?: {
    monsoon_pct: number;   // 25-40%
    summer_pct: number;    // 10-20%
    festival_pct: number;  // 10-15%
    winter_pct: number;    // 5-15%
    rework_pct: number;    // 10-20%
  };

  last_updated: string;
}

// Planning Parameter for Admin Configuration
export interface PlanningParameter {
  id: string;
  category_name: string; // e.g., "Grade A Office", "Luxury Residential"
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';
  height_category: 'Low-Rise (<15m)' | 'Mid-Rise (15-45m)' | 'High-Rise (>45m)';

  // Efficiency Targets
  core_to_gfa_ratio_min: number;
  core_to_gfa_ratio_max: number;
  circulation_to_gfa_ratio: number;
  efficiency_target: number; // Usage / GFA

  // Vertical Transport
  passenger_lifts_per_unit?: number; // Residential: lifts per unit
  passenger_lifts_per_sqm?: number; // Commercial: lifts per 1000sqm
  service_lifts_per_tower: number;

  description?: string;
  last_updated: string;
}

// Simulation histogram bin
export interface SimBin {
  x: number;     // bin center value
  count: number; // frequency
}

// Sensitivity variable for tornado chart
export interface SensitivityVar {
  label: string;
  low: number;   // impact when variable at min
  high: number;  // impact when variable at max
  range: number; // high - low
}

// Phase breakdown for multi-phase project division
export interface ProjectPhase {
  name: string;
  activities: string[];
  durationMonths: number;
  costShare: number;
  costAmount: number;
  costAmountMin: number;
  costAmountMax: number;
}

// ─── STANDARD AREA-BASED TIME ───────────────────────────────────────────────
export interface StandardTimePhase {
  name: string;
  durationDays: number;
  durationMonths: number;
}

export interface BuildingStandardTime {
  buildingId: string;
  buildingName: string;
  totalDurationDays: number;
  totalDurationMonths: number;
  offsetMonths?: number; 
  phases: StandardTimePhase[];
}

export interface StandardTimeEstimation {
  buildings: BuildingStandardTime[];
  totalProjectDurationDays: number; 
  totalProjectDurationMonths: number;
}
// ────────────────────────────────────────────────────────────────────────────

// Building delivery phase — groups buildings into construction phases
export interface DeliveryPhaseBuilding {
  buildingId: string;
  buildingName: string;
  gfa: number;
  floors: number;
  startMonth: number;
  endMonth: number;
  cost: number;
}

export interface DeliveryPhase {
  phaseNumber: number;
  phaseName: string;
  startMonth: number;
  endMonth: number;
  durationMonths: number;
  totalCost: number;
  totalGFA: number;
  buildings: DeliveryPhaseBuilding[];
}

export interface UtilityCostBreakdown {
  label: string;
  amount: number;
  unit: string;
  rateRange?: string; // e.g. "₹25K - ₹75K / KLD"
  minAmount?: number;
  maxAmount?: number;
}

// Simulation results from Monte Carlo
export interface SimulationResults {
  // Cost simulation
  cost_histogram: SimBin[];
  cost_cdf: { x: number; y: number }[];
  cost_p10: number;
  cost_p50: number;
  cost_p90: number;
  cost_mean: number;
  cost_sensitivity: SensitivityVar[];

  // Time simulation
  time_histogram: SimBin[];
  time_cdf: { x: number; y: number }[];
  time_p10: number;
  time_p50: number;
  time_p90: number;
  time_mean: number;
  time_sensitivity: SensitivityVar[];

  // Phase breakdown
  phases: ProjectPhase[];
  numPhases: number;

  // Utility costs
  utility_costs: UtilityCostBreakdown[];
  total_utility_cost: number;
  total_utility_cost_min?: number;
  total_utility_cost_max?: number;

  // S-curve bands
  scurve_p10: number[];
  scurve_p50: number[];
  scurve_p90: number[];

  // Gantt uncertainty (per construction activity)
  gantt: {
    activity: string;
    minStart: number;
    expectedStart: number;
    expectedEnd: number;
    maxEnd: number;
    color: string;
  }[];

  // Delay factor breakdown
  delay_breakdown?: {
    factor: string;
    pct: number;
    impactMonths: number;
  }[];

  // Building delivery phases
  delivery_phases?: DeliveryPhase[];

  // Raw simulation arrays for advanced charts
  cost_raw?: number[];
  time_raw?: number[];
  cost_components_raw?: {
    earthwork: number[];
    structure: number[];
    finishing: number[];
    services: number[];
  };
  critical_path_probability?: {
    activity: string;
    criticalPct: number;
  }[];
}

export interface ProjectEstimates {
  isPotential?: boolean;
  total_construction_cost: number;
  cost_breakdown: {
    earthwork: number;
    structure: number;
    finishing: number;
    services: number;
    contingency: number;
  };

  total_revenue: number;
  potential_profit: number;
  roi_percentage: number;
  /** Market rate from admin cost params (₹/sqm sellable) */
  market_rate_per_sqm?: number;
  sellable_ratio?: number;

  timeline: {
    total_months: number;
    phases: {
      excavation: number;
      foundation: number;
      structure: number;
      finishing: number;
      overlap?: number;
      contingency?: number;
    }
  };

  efficiency_metrics: {
    achieved: number; 
    target: number; 
    status: 'Optimal' | 'Inefficient' | 'Aggressive';
  };
  
  standardTimeEstimates?: StandardTimeEstimation;

  breakdown?: {
    buildingId: string;
    buildingName: string;
    timeline: {
        total: number;
        startOffset?: number;
        substructure?: number;
        structure: number;
        finishing: number;
        contingency?: number;
    };
    cost: {
        total: number;
        ratePerSqm: number;
    };
    gfa?: number;
    floors?: number;
    utilityCost?: number;
  }[];

  // Monte Carlo simulation results
  simulation?: SimulationResults;
}

// ─── LAND INTELLIGENCE TYPES (Phase 1.2) ─────────────────────────────────────

export interface LandIntelligenceQuery {
  location: string;                    // City/district name (e.g. "Delhi")
  coordinates?: [number, number];      // [lng, lat]
  plotGeometry?: Feature<Polygon>;     // Optional parcel polygon for parcel-level checks
  roadAccessSides?: string[];
  district?: string;                   // Sub-district/area
  landSizeSqm?: number;               // Plot area in sqm
  intendedUse?: BuildingIntendedUse;
  underwriting?: Pick<UnderwritingData, 'approvals' | 'competitors'>;
  locationAmenities?: any[];
  targetPriceRange?: { min: number; max: number }; // INR
}

// data.gov.in response types
export interface CensusData {
  state: string;
  district: string;
  totalPopulation: number;
  malePopulation: number;
  femalePopulation: number;
  literacyRate: number;
  populationDensity: number;  // per sq km
  decadalGrowthRate: number;  // percentage
  urbanPopulationPct: number;
  householdCount: number;
  source: string;
  year: number;
}

export interface FDIData {
  sector: string;
  amountInrCrores: number;
  amountUsdMillions: number;
  year: string;
  state?: string;
  source: string;
}

export interface SEZData {
  name: string;
  developer: string;
  state: string;
  district: string;
  sector: string;        // IT/ITES, Multi-product, etc.
  areaHectares: number;
  status: 'Operational' | 'Notified' | 'Formal Approval' | 'In-Principle';
  distanceKm?: number;   // From query location
  source: string;
}

// Google Earth Engine (satellite) types
export interface SatelliteChangeData {
  location: string;
  coordinates: [number, number];
  urbanGrowthIndex: number;       // 0-100: rate of urban expansion
  builtUpAreaPct: number;         // % of area that is built-up
  builtUpChange5yr: number;       // Change in built-up % over 5 years
  ndviTrend: 'increasing' | 'decreasing' | 'stable'; // vegetation trend
  ndviAverage: number;            // 0 to 1
  landSurfaceTempC: number;       // avg land surface temperature
  analysisDate: string;
  source: string;
}

// Master Plan extraction types
export interface MasterPlanZone {
  zoneName: string;              // e.g. "Residential Zone R1"
  permittedUses: string[];       // e.g. ["Residential", "Educational"]
  conditionalUses?: string[];
  prohibitedUses?: string[];
  far: number;                   // Floor Area Ratio
  maxHeight: number;             // meters
  maxCoverage: number;           // percentage
  minPlotSize?: number;          // sqm
  densityDU?: number;            // dwelling units per hectare
  setbacks?: {
    front: number;
    rear: number;
    side: number;
  };
  cluProvisions?: string;       // Change of Land Use notes
  remarks?: string;
}

export interface MasterPlanData {
  cityName: string;
  planName: string;              // e.g. "Delhi Master Plan 2041"
  planYear: number;
  zones: MasterPlanZone[];
  generalFARRules?: string;
  transitOrientedDev?: string;   // TOD provisions
  greenBeltRules?: string;
  confidence: number;            // 0-1
  source: string;                // filename
}

// Developability Score output
export interface DevelopabilityScore {
  overallScore: number;           // 0-1000
  rating: 'Excellent' | 'Good' | 'Moderate' | 'Poor' | 'Not Viable';
  categories: {
    growthPotential: { score: number; maxScore: number; details: string[] };
    legalRegulatory: { score: number; maxScore: number; details: string[] };
    locationConnectivity: { score: number; maxScore: number; details: string[] };
    marketEconomics: { score: number; maxScore: number; details: string[] };
  };
  recommendation: string;
  dataCompleteness: number;       // 0-1: how much data was available
  timestamp: string;
}
