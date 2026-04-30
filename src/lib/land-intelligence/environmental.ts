import type { CountryCode, GeographyMarket } from "@/lib/types";

export type EnvironmentalRiskLevel =
  | "low"
  | "moderate"
  | "high"
  | "unknown";

export type NepaReviewLevel =
  | "unlikely"
  | "screening-recommended"
  | "elevated-review";

export interface EnvironmentalFacility {
  id: string;
  name: string;
  city?: string;
  state?: string;
  permitId?: string;
  program: "air" | "water";
  status?: string;
  complianceStatus?: string;
  recentViolations?: number | null;
  isHighPriorityViolator?: boolean;
  isCurrentViolator?: boolean;
}

export interface EnvironmentalSignal {
  status: EnvironmentalRiskLevel;
  summary: string;
  indicators: string[];
  source: string;
}

export interface WetlandScreeningSummary extends EnvironmentalSignal {
  nlcdClass?: string;
  nlcdCode?: string;
  latestYear?: number;
  isWetlandLike?: boolean;
  isWaterLike?: boolean;
}

export interface AirQualityScreeningSummary extends EnvironmentalSignal {
  facilityCount: number;
  currentViolationCount: number;
  significantViolationCount: number;
  formalEnforcementCount: number;
  totalPenalties?: string | null;
  sampleFacilities: EnvironmentalFacility[];
}

export interface WaterQualityScreeningSummary extends EnvironmentalSignal {
  facilityCount: number;
  currentViolationCount: number;
  significantViolationCount: number;
  recentViolationCount: number;
  formalEnforcementCount: number;
  totalPenalties?: string | null;
  permitStatuses: string[];
  sampleFacilities: EnvironmentalFacility[];
}

export interface NepaScreeningSummary {
  status: NepaReviewLevel;
  summary: string;
  triggers: string[];
  recommendedDocuments: string[];
  source: string;
}

export interface EnvironmentalDataSourceStatus {
  available: boolean;
  notes?: string[];
}

export interface EnvironmentalScreeningReport {
  market: GeographyMarket;
  countryCode: CountryCode;
  location: string;
  stateCode?: string;
  county?: string;
  wetlandScreening: WetlandScreeningSummary;
  airQuality: AirQualityScreeningSummary;
  waterQuality: WaterQualityScreeningSummary;
  nepa: NepaScreeningSummary;
  dataSources: {
    nlcd: EnvironmentalDataSourceStatus;
    echoAir: EnvironmentalDataSourceStatus;
    echoWater: EnvironmentalDataSourceStatus;
    attains?: EnvironmentalDataSourceStatus;
  };
  notes: string[];
}
