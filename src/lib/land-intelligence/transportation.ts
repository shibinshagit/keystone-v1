import { inferRegulationGeography } from "@/lib/geography";
import type {
  BuildingIntendedUse,
  CountryCode,
  GeographyMarket,
} from "@/lib/types";

export type TransportationRiskLevel =
  | "low"
  | "moderate"
  | "high"
  | "unknown";

export type TiaLikelihood = "unlikely" | "possible" | "likely";
export type TransitAccessLevel = "strong" | "moderate" | "limited" | "unknown";
export type TripGenerationIntensity =
  | "low"
  | "moderate"
  | "high"
  | "very-high";

export interface TransportationDataSourceStatus {
  available: boolean;
  notes?: string[];
}

export interface TransportationWorkZone {
  id: string;
  name: string;
  roadNames: string[];
  direction?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  vehicleImpact?: string;
  distanceMeters: number;
  sourceOrganization?: string;
  feedName?: string;
}

export interface TransportationTransitAccessSummary {
  status: TransitAccessLevel;
  summary: string;
  nearestDistanceMeters: number | null;
  nearbyCount: number;
  sampleNames: string[];
}

export interface TransportationRoadwayContextSummary {
  status: TransportationRiskLevel;
  summary: string;
  roadAccessSideCount: number;
  centroidRoadDistanceMeters: number | null;
  boundaryRoadCoverageRatio: number | null;
  roadWidthMeters: number | null;
  frontageWidthMeters: number | null;
}

export interface TransportationTiaSummary {
  likelihood: TiaLikelihood;
  summary: string;
  estimatedTripIntensity: TripGenerationIntensity;
  triggers: string[];
  offSiteImprovementReviewLikely: boolean;
}

export interface TransportationAccessManagementSummary {
  status: TransportationRiskLevel;
  summary: string;
  triggers: string[];
}

export interface TransportationWorkZoneSummary {
  status: TransportationRiskLevel;
  summary: string;
  nearestDistanceMeters: number | null;
  countWithin1Km: number;
  countWithin5Km: number;
  sampleWorkZones: TransportationWorkZone[];
}

export interface TransportationApprovalSummary {
  authorities: string[];
  triggers: string[];
  recommendedDocuments: string[];
  notes: string[];
}

export interface TransportationScreeningReport {
  market: GeographyMarket;
  countryCode: CountryCode;
  location: string;
  city?: string;
  stateCode?: string;
  tia: TransportationTiaSummary;
  transitAccess: TransportationTransitAccessSummary;
  roadwayContext: TransportationRoadwayContextSummary;
  accessManagement: TransportationAccessManagementSummary;
  nearbyWorkZones: TransportationWorkZoneSummary;
  approvals: TransportationApprovalSummary;
  dataSources: {
    wzdxRegistry: TransportationDataSourceStatus;
    wzdxFeed: TransportationDataSourceStatus;
    googleTransit?: TransportationDataSourceStatus;
    googleRoads?: TransportationDataSourceStatus;
  };
  notes: string[];
}

export interface UsaTransportationContext {
  city?: string;
  stateCode: string;
  stateName: string;
  localAuthority: string;
  stateAuthority: string;
  registryIssuerPreferences: string[];
  stateRouteTriggerNote: string;
}

export interface TransportationHeuristicInput {
  location?: string;
  landSizeSqm?: number;
  intendedUse?: BuildingIntendedUse | string;
  roadAccessSides?: string[];
  nearestTransitDistanceMeters?: number | null;
  transitCountWithin5Km?: number;
  transitSampleNames?: string[];
  centroidRoadDistanceMeters?: number | null;
  boundaryRoadCoverageRatio?: number | null;
  roadWidthMeters?: number | null;
  frontageWidthMeters?: number | null;
  nearbyWorkZoneCountWithin1Km?: number;
  nearbyWorkZoneCountWithin5Km?: number;
  nearestWorkZoneDistanceMeters?: number | null;
  jurisdictionContext?: UsaTransportationContext | null;
}

export const USA_TRANSPORTATION_CITY_CONTEXT: Record<
  "Austin" | "Phoenix" | "Seattle",
  UsaTransportationContext
> = {
  Austin: {
    city: "Austin",
    stateCode: "TX",
    stateName: "Texas",
    localAuthority: "Austin Transportation and Public Works Department",
    stateAuthority: "Texas Department of Transportation (TxDOT)",
    registryIssuerPreferences: ["City of Austin", "Texas DOT"],
    stateRouteTriggerNote:
      "TxDOT review becomes more likely if the site driveway ties into a state route, frontage road, or interchange influence area.",
  },
  Phoenix: {
    city: "Phoenix",
    stateCode: "AZ",
    stateName: "Arizona",
    localAuthority: "Phoenix Street Transportation Department",
    stateAuthority: "Arizona Department of Transportation (ADOT)",
    registryIssuerPreferences: ["Maricopa County DOT", "Phoenix", "ADOT"],
    stateRouteTriggerNote:
      "ADOT review becomes more likely if site access is proposed onto a state route, freeway frontage road, or interchange-adjacent arterial.",
  },
  Seattle: {
    city: "Seattle",
    stateCode: "WA",
    stateName: "Washington",
    localAuthority: "Seattle Department of Transportation (SDOT)",
    stateAuthority: "Washington State Department of Transportation (WSDOT)",
    registryIssuerPreferences: ["Washington State DOT"],
    stateRouteTriggerNote:
      "WSDOT review becomes more likely if the project touches a state route corridor, ramp terminal, or interchange access street.",
  },
};

const US_STATE_CONTEXT: Record<
  string,
  {
    code: string;
    stateAuthority: string;
    registryIssuerPreferences: string[];
    stateRouteTriggerNote: string;
  }
> = {
  alabama: { code: "AL", stateAuthority: "Alabama Department of Transportation (ALDOT)", registryIssuerPreferences: ["Alabama Department of Transportation", "ALDOT"], stateRouteTriggerNote: "State DOT review becomes more likely if the site takes access from a state route, freeway frontage road, or interchange influence area." },
  alaska: { code: "AK", stateAuthority: "Alaska Department of Transportation & Public Facilities (DOT&PF)", registryIssuerPreferences: ["Alaska Department of Transportation", "DOT&PF"], stateRouteTriggerNote: "State DOT review becomes more likely if the site takes access from a state highway or interchange-adjacent facility." },
  arizona: { code: "AZ", stateAuthority: "Arizona Department of Transportation (ADOT)", registryIssuerPreferences: ["Arizona Department of Transportation", "ADOT", "Maricopa County DOT"], stateRouteTriggerNote: "ADOT review becomes more likely if site access is proposed onto a state route, freeway frontage road, or interchange-adjacent arterial." },
  arkansas: { code: "AR", stateAuthority: "Arkansas Department of Transportation (ARDOT)", registryIssuerPreferences: ["Arkansas Department of Transportation", "ARDOT"], stateRouteTriggerNote: "State DOT review becomes more likely if the project ties into a state highway corridor or interchange access street." },
  california: { code: "CA", stateAuthority: "California Department of Transportation (Caltrans)", registryIssuerPreferences: ["California Department of Transportation", "Caltrans"], stateRouteTriggerNote: "Caltrans review becomes more likely if the site touches a state highway, ramp terminal, or interchange area." },
  colorado: { code: "CO", stateAuthority: "Colorado Department of Transportation (CDOT)", registryIssuerPreferences: ["Colorado Department of Transportation", "CDOT"], stateRouteTriggerNote: "CDOT review becomes more likely if the site takes access from a state highway or interchange-adjacent corridor." },
  connecticut: { code: "CT", stateAuthority: "Connecticut Department of Transportation (CTDOT)", registryIssuerPreferences: ["Connecticut Department of Transportation", "CTDOT"], stateRouteTriggerNote: "CTDOT review becomes more likely if the site touches a state route or limited-access highway system." },
  delaware: { code: "DE", stateAuthority: "Delaware Department of Transportation (DelDOT)", registryIssuerPreferences: ["Delaware Department of Transportation", "DelDOT"], stateRouteTriggerNote: "DelDOT review becomes more likely if access is proposed onto a state-maintained roadway or interchange approach." },
  "district of columbia": { code: "DC", stateAuthority: "District Department of Transportation (DDOT)", registryIssuerPreferences: ["District Department of Transportation", "DDOT"], stateRouteTriggerNote: "DDOT review becomes more likely where the site affects a District arterial, curb lane, or major intersection." },
  florida: { code: "FL", stateAuthority: "Florida Department of Transportation (FDOT)", registryIssuerPreferences: ["Florida Department of Transportation", "FDOT"], stateRouteTriggerNote: "FDOT review becomes more likely if the site touches a state road, frontage road, or interchange area." },
  georgia: { code: "GA", stateAuthority: "Georgia Department of Transportation (GDOT)", registryIssuerPreferences: ["Georgia Department of Transportation", "GDOT"], stateRouteTriggerNote: "GDOT review becomes more likely if access is proposed onto a state route or interchange-influenced corridor." },
  hawaii: { code: "HI", stateAuthority: "Hawaii Department of Transportation (HDOT)", registryIssuerPreferences: ["Hawaii Department of Transportation", "HDOT"], stateRouteTriggerNote: "HDOT review becomes more likely where the site affects a state highway corridor or controlled-access roadway." },
  idaho: { code: "ID", stateAuthority: "Idaho Transportation Department (ITD)", registryIssuerPreferences: ["Idaho Transportation Department", "ITD"], stateRouteTriggerNote: "ITD review becomes more likely if the site accesses a state highway or interchange-adjacent street." },
  illinois: { code: "IL", stateAuthority: "Illinois Department of Transportation (IDOT)", registryIssuerPreferences: ["Illinois Department of Transportation", "IDOT"], stateRouteTriggerNote: "IDOT review becomes more likely if the site fronts a state route or affects interchange operations." },
  indiana: { code: "IN", stateAuthority: "Indiana Department of Transportation (INDOT)", registryIssuerPreferences: ["Indiana Department of Transportation", "INDOT"], stateRouteTriggerNote: "INDOT review becomes more likely if the project connects to a state highway or interchange influence area." },
  iowa: { code: "IA", stateAuthority: "Iowa Department of Transportation (Iowa DOT)", registryIssuerPreferences: ["Iowa Department of Transportation", "Iowa DOT"], stateRouteTriggerNote: "State DOT review becomes more likely if the parcel takes access from a state highway or major junction corridor." },
  kansas: { code: "KS", stateAuthority: "Kansas Department of Transportation (KDOT)", registryIssuerPreferences: ["Kansas Department of Transportation", "KDOT"], stateRouteTriggerNote: "KDOT review becomes more likely if the site affects a state highway access point or interchange area." },
  kentucky: { code: "KY", stateAuthority: "Kentucky Transportation Cabinet (KYTC)", registryIssuerPreferences: ["Kentucky Transportation Cabinet", "KYTC"], stateRouteTriggerNote: "KYTC review becomes more likely if the project touches a state-maintained corridor or interchange street." },
  louisiana: { code: "LA", stateAuthority: "Louisiana Department of Transportation and Development (LaDOTD)", registryIssuerPreferences: ["Louisiana Department of Transportation", "LaDOTD"], stateRouteTriggerNote: "LaDOTD review becomes more likely where the site affects a state route or freeway frontage condition." },
  maine: { code: "ME", stateAuthority: "Maine Department of Transportation (MaineDOT)", registryIssuerPreferences: ["Maine Department of Transportation", "MaineDOT"], stateRouteTriggerNote: "MaineDOT review becomes more likely if the site takes access from a state route or major junction corridor." },
  maryland: { code: "MD", stateAuthority: "Maryland Department of Transportation (MDOT)", registryIssuerPreferences: ["Maryland Department of Transportation", "MDOT"], stateRouteTriggerNote: "MDOT review becomes more likely if the project ties into a state highway or interchange-adjacent arterial." },
  massachusetts: { code: "MA", stateAuthority: "Massachusetts Department of Transportation (MassDOT)", registryIssuerPreferences: ["Massachusetts Department of Transportation", "MassDOT"], stateRouteTriggerNote: "MassDOT review becomes more likely if the site fronts a state highway or major state-controlled intersection." },
  michigan: { code: "MI", stateAuthority: "Michigan Department of Transportation (MDOT)", registryIssuerPreferences: ["Michigan Department of Transportation", "MDOT"], stateRouteTriggerNote: "MDOT review becomes more likely if the project affects a state trunkline or interchange area." },
  minnesota: { code: "MN", stateAuthority: "Minnesota Department of Transportation (MnDOT)", registryIssuerPreferences: ["Minnesota Department of Transportation", "MnDOT"], stateRouteTriggerNote: "MnDOT review becomes more likely if the site takes access from a state highway or interchange-influenced corridor." },
  mississippi: { code: "MS", stateAuthority: "Mississippi Department of Transportation (MDOT)", registryIssuerPreferences: ["Mississippi Department of Transportation", "MDOT"], stateRouteTriggerNote: "State DOT review becomes more likely if the parcel fronts a state route or affects major highway access." },
  missouri: { code: "MO", stateAuthority: "Missouri Department of Transportation (MoDOT)", registryIssuerPreferences: ["Missouri Department of Transportation", "MoDOT"], stateRouteTriggerNote: "MoDOT review becomes more likely if access is proposed onto a state route or freeway frontage road." },
  montana: { code: "MT", stateAuthority: "Montana Department of Transportation (MDT)", registryIssuerPreferences: ["Montana Department of Transportation", "MDT"], stateRouteTriggerNote: "MDT review becomes more likely where the site affects a state highway access point." },
  nebraska: { code: "NE", stateAuthority: "Nebraska Department of Transportation (NDOT)", registryIssuerPreferences: ["Nebraska Department of Transportation", "NDOT"], stateRouteTriggerNote: "NDOT review becomes more likely if the project touches a state-maintained route or major junction." },
  nevada: { code: "NV", stateAuthority: "Nevada Department of Transportation (NDOT)", registryIssuerPreferences: ["Nevada Department of Transportation", "NDOT"], stateRouteTriggerNote: "NDOT review becomes more likely if the site fronts a state route or interchange corridor." },
  "new hampshire": { code: "NH", stateAuthority: "New Hampshire Department of Transportation (NHDOT)", registryIssuerPreferences: ["New Hampshire Department of Transportation", "NHDOT"], stateRouteTriggerNote: "NHDOT review becomes more likely if access is proposed from a state highway or interchange street." },
  "new jersey": { code: "NJ", stateAuthority: "New Jersey Department of Transportation (NJDOT)", registryIssuerPreferences: ["New Jersey Department of Transportation", "NJDOT"], stateRouteTriggerNote: "NJDOT review becomes more likely if the project affects a state highway corridor or ramp terminal." },
  "new mexico": { code: "NM", stateAuthority: "New Mexico Department of Transportation (NMDOT)", registryIssuerPreferences: ["New Mexico Department of Transportation", "NMDOT"], stateRouteTriggerNote: "NMDOT review becomes more likely if the site takes access from a state-maintained corridor." },
  "new york": { code: "NY", stateAuthority: "New York State Department of Transportation (NYSDOT)", registryIssuerPreferences: ["New York State Department of Transportation", "NYSDOT"], stateRouteTriggerNote: "NYSDOT review becomes more likely where the project affects a state route, arterial, or interchange area." },
  "north carolina": { code: "NC", stateAuthority: "North Carolina Department of Transportation (NCDOT)", registryIssuerPreferences: ["North Carolina Department of Transportation", "NCDOT"], stateRouteTriggerNote: "NCDOT review becomes more likely if the site connects to a state-maintained road or freeway interchange area." },
  "north dakota": { code: "ND", stateAuthority: "North Dakota Department of Transportation (NDDOT)", registryIssuerPreferences: ["North Dakota Department of Transportation", "NDDOT"], stateRouteTriggerNote: "NDDOT review becomes more likely if access is proposed onto a state highway corridor." },
  ohio: { code: "OH", stateAuthority: "Ohio Department of Transportation (ODOT)", registryIssuerPreferences: ["Ohio Department of Transportation", "ODOT"], stateRouteTriggerNote: "ODOT review becomes more likely where the site affects a state route, frontage road, or interchange area." },
  oklahoma: { code: "OK", stateAuthority: "Oklahoma Department of Transportation (ODOT)", registryIssuerPreferences: ["Oklahoma Department of Transportation", "ODOT"], stateRouteTriggerNote: "State DOT review becomes more likely if the project fronts a state highway or major access-controlled corridor." },
  oregon: { code: "OR", stateAuthority: "Oregon Department of Transportation (ODOT)", registryIssuerPreferences: ["Oregon Department of Transportation", "ODOT"], stateRouteTriggerNote: "ODOT review becomes more likely if the site touches a state route or interchange-adjacent arterial." },
  pennsylvania: { code: "PA", stateAuthority: "Pennsylvania Department of Transportation (PennDOT)", registryIssuerPreferences: ["Pennsylvania Department of Transportation", "PennDOT"], stateRouteTriggerNote: "PennDOT review becomes more likely where the project affects a state highway corridor or interchange street." },
  "rhode island": { code: "RI", stateAuthority: "Rhode Island Department of Transportation (RIDOT)", registryIssuerPreferences: ["Rhode Island Department of Transportation", "RIDOT"], stateRouteTriggerNote: "RIDOT review becomes more likely if the site takes access from a state-maintained roadway or freeway approach." },
  "south carolina": { code: "SC", stateAuthority: "South Carolina Department of Transportation (SCDOT)", registryIssuerPreferences: ["South Carolina Department of Transportation", "SCDOT"], stateRouteTriggerNote: "SCDOT review becomes more likely if access is proposed onto a state route or interchange corridor." },
  "south dakota": { code: "SD", stateAuthority: "South Dakota Department of Transportation (SDDOT)", registryIssuerPreferences: ["South Dakota Department of Transportation", "SDDOT"], stateRouteTriggerNote: "SDDOT review becomes more likely if the site affects a state route access point." },
  tennessee: { code: "TN", stateAuthority: "Tennessee Department of Transportation (TDOT)", registryIssuerPreferences: ["Tennessee Department of Transportation", "TDOT"], stateRouteTriggerNote: "TDOT review becomes more likely if the project fronts a state route or interchange-influenced corridor." },
  texas: { code: "TX", stateAuthority: "Texas Department of Transportation (TxDOT)", registryIssuerPreferences: ["Texas Department of Transportation", "Texas DOT", "TxDOT", "City of Austin"], stateRouteTriggerNote: "TxDOT review becomes more likely if the site driveway ties into a state route, frontage road, or interchange influence area." },
  utah: { code: "UT", stateAuthority: "Utah Department of Transportation (UDOT)", registryIssuerPreferences: ["Utah Department of Transportation", "UDOT"], stateRouteTriggerNote: "UDOT review becomes more likely if the site touches a state route or interchange-adjacent access point." },
  vermont: { code: "VT", stateAuthority: "Vermont Agency of Transportation (VTrans)", registryIssuerPreferences: ["Vermont Agency of Transportation", "VTrans"], stateRouteTriggerNote: "VTrans review becomes more likely if the project affects a state highway or access-controlled corridor." },
  virginia: { code: "VA", stateAuthority: "Virginia Department of Transportation (VDOT)", registryIssuerPreferences: ["Virginia Department of Transportation", "VDOT"], stateRouteTriggerNote: "VDOT review becomes more likely where the site takes access from a state route or interchange area." },
  washington: { code: "WA", stateAuthority: "Washington State Department of Transportation (WSDOT)", registryIssuerPreferences: ["Washington State Department of Transportation", "Washington State DOT", "WSDOT"], stateRouteTriggerNote: "WSDOT review becomes more likely if the project touches a state route corridor, ramp terminal, or interchange access street." },
  "west virginia": { code: "WV", stateAuthority: "West Virginia Division of Highways (WVDOH)", registryIssuerPreferences: ["West Virginia Division of Highways", "WVDOH"], stateRouteTriggerNote: "State highway review becomes more likely if the project fronts a state-maintained corridor." },
  wisconsin: { code: "WI", stateAuthority: "Wisconsin Department of Transportation (WisDOT)", registryIssuerPreferences: ["Wisconsin Department of Transportation", "WisDOT"], stateRouteTriggerNote: "WisDOT review becomes more likely if the site affects a state trunk highway or interchange corridor." },
  wyoming: { code: "WY", stateAuthority: "Wyoming Department of Transportation (WYDOT)", registryIssuerPreferences: ["Wyoming Department of Transportation", "WYDOT"], stateRouteTriggerNote: "WYDOT review becomes more likely if access is proposed from a state route or interchange area." },
};

const US_STATE_ALIASES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", dc: "district of columbia", fl: "florida",
  ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts",
  mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska",
  nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function formatDistance(distanceMeters: number | null) {
  if (distanceMeters == null) return "not available";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function getUseBucket(intendedUse?: BuildingIntendedUse | string) {
  const normalized = normalizeText(intendedUse);

  if (includesAny(normalized, ["retail", "hospitality"])) return "retail";
  if (includesAny(normalized, ["commercial", "office"])) return "office";
  if (normalized.includes("mixed")) return "mixed";
  if (normalized.includes("industrial")) return "industrial";
  if (includesAny(normalized, ["institution", "public", "utility"])) return "civic";
  return "residential";
}

function estimateTripIntensity({
  intendedUse,
  landSizeSqm,
  nearestTransitDistanceMeters,
  roadAccessSides,
}: Pick<
  TransportationHeuristicInput,
  | "intendedUse"
  | "landSizeSqm"
  | "nearestTransitDistanceMeters"
  | "roadAccessSides"
>): TripGenerationIntensity {
  const useBucket = getUseBucket(intendedUse);
  const size = Number(landSizeSqm || 0);
  const accessCount = Array.isArray(roadAccessSides) ? roadAccessSides.length : 0;

  let score =
    useBucket === "retail"
      ? 3
      : useBucket === "office" || useBucket === "mixed"
        ? 2
        : useBucket === "industrial" || useBucket === "civic"
          ? 2
          : 1;

  if (size >= 50000) score += 3;
  else if (size >= 20000) score += 2;
  else if (size >= 8000) score += 1;

  if (accessCount <= 1) score += 1;
  if (
    useBucket !== "residential" &&
    (nearestTransitDistanceMeters == null || nearestTransitDistanceMeters > 1500)
  ) {
    score += 1;
  } else if (nearestTransitDistanceMeters != null && nearestTransitDistanceMeters <= 800) {
    score -= 1;
  }

  if (score <= 1) return "low";
  if (score <= 3) return "moderate";
  if (score <= 5) return "high";
  return "very-high";
}

export function resolveUsaTransportationContext(
  location: string,
): UsaTransportationContext | null {
  const inferred = inferRegulationGeography(location || "");
  const city = typeof inferred.city === "string" ? inferred.city : undefined;
  const inferredState =
    typeof inferred.stateOrProvince === "string" ? inferred.stateOrProvince : undefined;

  if (city && city in USA_TRANSPORTATION_CITY_CONTEXT) {
    return USA_TRANSPORTATION_CITY_CONTEXT[city as "Austin" | "Phoenix" | "Seattle"];
  }

  const normalized = normalizeText(location);
  if (normalized.includes("austin")) {
    return USA_TRANSPORTATION_CITY_CONTEXT.Austin;
  }
  if (normalized.includes("phoenix")) {
    return USA_TRANSPORTATION_CITY_CONTEXT.Phoenix;
  }
  if (normalized.includes("seattle")) {
    return USA_TRANSPORTATION_CITY_CONTEXT.Seattle;
  }

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(usa|us|united states)$/i.test(part));
  const stateCandidate =
    normalizeText(inferredState) ||
    parts
      .slice()
      .reverse()
      .find((part) => part in US_STATE_CONTEXT || part in US_STATE_ALIASES || /\b[a-z]{2}\b/.test(part)) ||
    "";
  const stateKey =
    US_STATE_CONTEXT[stateCandidate]
      ? stateCandidate
      : US_STATE_ALIASES[stateCandidate] || "";

  if (!stateKey || !US_STATE_CONTEXT[stateKey]) {
    return null;
  }

  const stateContext = US_STATE_CONTEXT[stateKey];
  const localCity =
    city ||
    (parts.length > 1 ? toTitleCase(parts[0]) : undefined);

  return {
    city: localCity,
    stateCode: stateContext.code,
    stateName: toTitleCase(stateKey),
    localAuthority: localCity
      ? `${localCity} local transportation / public works reviewer`
      : `${toTitleCase(stateKey)} local transportation / public works reviewer`,
    stateAuthority: stateContext.stateAuthority,
    registryIssuerPreferences: uniqueStrings([
      ...(localCity ? [localCity] : []),
      ...stateContext.registryIssuerPreferences,
    ]),
    stateRouteTriggerNote: stateContext.stateRouteTriggerNote,
  };
}

export function resolveUsaTransportationCityContext(
  location: string,
): UsaTransportationContext | null {
  const context = resolveUsaTransportationContext(location);
  return context?.city ? context : null;
}

export function evaluateTransportationHeuristics(
  input: TransportationHeuristicInput,
) {
  const landSizeSqm = Number(input.landSizeSqm || 0);
  const roadAccessSideCount = Array.isArray(input.roadAccessSides)
    ? input.roadAccessSides.length
    : 0;
  const tripIntensity = estimateTripIntensity(input);
  const transitCount = Math.max(0, Number(input.transitCountWithin5Km || 0));
  const workZones1Km = Math.max(0, Number(input.nearbyWorkZoneCountWithin1Km || 0));
  const workZones5Km = Math.max(0, Number(input.nearbyWorkZoneCountWithin5Km || 0));
  const nearestTransitDistance =
    input.nearestTransitDistanceMeters == null
      ? null
      : Number(input.nearestTransitDistanceMeters);
  const nearestWorkZoneDistance =
    input.nearestWorkZoneDistanceMeters == null
      ? null
      : Number(input.nearestWorkZoneDistanceMeters);
  const centroidRoadDistance =
    input.centroidRoadDistanceMeters == null
      ? null
      : Number(input.centroidRoadDistanceMeters);
  const boundaryRoadCoverage =
    input.boundaryRoadCoverageRatio == null
      ? null
      : Number(input.boundaryRoadCoverageRatio);
  const roadWidth =
    input.roadWidthMeters == null ? null : Number(input.roadWidthMeters);
  const frontageWidth =
    input.frontageWidthMeters == null ? null : Number(input.frontageWidthMeters);

  let transitStatus: TransitAccessLevel = "unknown";
  if (nearestTransitDistance != null) {
    if (nearestTransitDistance <= 800 && transitCount >= 3) transitStatus = "strong";
    else if (nearestTransitDistance <= 1500 || transitCount >= 2) {
      transitStatus = "moderate";
    } else {
      transitStatus = "limited";
    }
  } else if (transitCount > 0) {
    transitStatus = transitCount >= 3 ? "moderate" : "limited";
  }

  const transitSummary =
    transitStatus === "strong"
      ? `Transit access is strong, with the nearest service about ${formatDistance(nearestTransitDistance)} from the site.`
      : transitStatus === "moderate"
        ? `Transit access is usable but not exceptional, with the nearest service about ${formatDistance(nearestTransitDistance)} from the site.`
        : transitStatus === "limited"
          ? `Transit access is limited, so site access may rely more heavily on private vehicles and curb management.`
          : "Transit access could not be scored reliably from the current inputs.";

  let tiaScore =
    tripIntensity === "very-high"
      ? 3
      : tripIntensity === "high"
        ? 2
        : tripIntensity === "moderate"
          ? 1
          : 0;

  if (landSizeSqm >= 30000) tiaScore += 2;
  else if (landSizeSqm >= 10000) tiaScore += 1;
  if (roadAccessSideCount <= 1) tiaScore += 1;
  if (boundaryRoadCoverage != null && boundaryRoadCoverage < 0.2) tiaScore += 1;
  if (centroidRoadDistance != null && centroidRoadDistance > 45) tiaScore += 1;
  if (workZones1Km > 0) tiaScore += 1;
  if (transitStatus === "strong" && roadAccessSideCount >= 2) tiaScore -= 1;

  const tiaLikelihood: TiaLikelihood =
    tiaScore >= 5 ? "likely" : tiaScore >= 3 ? "possible" : "unlikely";

  const tiaTriggers: string[] = [];
  if (landSizeSqm >= 10000) {
    tiaTriggers.push(`Site area is ${Math.round(landSizeSqm).toLocaleString("en-US")} sqm, which is large enough to justify transport scoping.`);
  }
  if (tripIntensity === "high" || tripIntensity === "very-high") {
    tiaTriggers.push(`Estimated trip intensity is ${tripIntensity}.`);
  }
  if (roadAccessSideCount <= 1) {
    tiaTriggers.push("The parcel appears to rely on a single clear road-access side.");
  }
  if (boundaryRoadCoverage != null && boundaryRoadCoverage < 0.2) {
    tiaTriggers.push("Only a small portion of the parcel edge appears road-adjacent.");
  }
  if (workZones1Km > 0) {
    tiaTriggers.push(
      `${workZones1Km} active or pending work-zone signal${workZones1Km === 1 ? "" : "s"} exist within 1 km.`,
    );
  }
  if (nearestTransitDistance == null || nearestTransitDistance > 1500) {
    tiaTriggers.push("The site does not appear to have very strong walk-up transit relief.");
  }

  let accessRiskScore = 0;
  if (roadAccessSideCount <= 1) accessRiskScore += 2;
  else if (roadAccessSideCount === 2) accessRiskScore += 1;
  if (centroidRoadDistance != null && centroidRoadDistance > 60) accessRiskScore += 2;
  else if (centroidRoadDistance != null && centroidRoadDistance > 30) accessRiskScore += 1;
  if (boundaryRoadCoverage != null && boundaryRoadCoverage < 0.15) accessRiskScore += 2;
  else if (boundaryRoadCoverage != null && boundaryRoadCoverage < 0.3) {
    accessRiskScore += 1;
  }
  if (roadWidth != null && roadWidth < 9) accessRiskScore += 2;
  else if (roadWidth != null && roadWidth < 12) accessRiskScore += 1;
  if (frontageWidth != null && frontageWidth < 9) accessRiskScore += 1;
  if (workZones1Km >= 3) accessRiskScore += 2;
  else if (workZones1Km > 0) accessRiskScore += 1;

  const accessStatus: TransportationRiskLevel =
    accessRiskScore >= 5
      ? "high"
      : accessRiskScore >= 3
        ? "moderate"
        : "low";

  const accessTriggers: string[] = [];
  if (roadAccessSideCount <= 1) {
    accessTriggers.push("Single-sided access will constrain driveway placement and ingress/egress flexibility.");
  }
  if (roadWidth != null && roadWidth < 12) {
    accessTriggers.push(`Mapped governing road width is only ${roadWidth} m.`);
  }
  if (frontageWidth != null && frontageWidth < 9) {
    accessTriggers.push(`Frontage width signal is limited at ${frontageWidth} m.`);
  }
  if (centroidRoadDistance != null && centroidRoadDistance > 30) {
    accessTriggers.push(
      `The parcel centroid is about ${formatDistance(centroidRoadDistance)} from the nearest snapped road edge.`,
    );
  }
  if (workZones1Km > 0) {
    accessTriggers.push("Nearby work zones may complicate temporary access management and haul routing.");
  }

  const roadwaySummary =
    accessStatus === "high"
      ? "Roadway access looks constrained enough that a formal access review should be assumed early."
      : accessStatus === "moderate"
        ? "Roadway access is workable but should be scoped early with transportation reviewers."
        : "Roadway access signals look generally manageable for first-pass screening.";

  let workZoneStatus: TransportationRiskLevel = "unknown";
  if (workZones5Km > 0) {
    if (workZones1Km >= 3 || (nearestWorkZoneDistance != null && nearestWorkZoneDistance <= 500)) {
      workZoneStatus = "high";
    } else if (workZones1Km > 0 || (nearestWorkZoneDistance != null && nearestWorkZoneDistance <= 2000)) {
      workZoneStatus = "moderate";
    } else {
      workZoneStatus = "low";
    }
  }

  const workZoneSummary =
    workZoneStatus === "high"
      ? "Active work-zone activity is close enough to the site that construction access and haul routing should be coordinated early."
      : workZoneStatus === "moderate"
        ? "There is meaningful nearby work-zone activity, so temporary access and construction traffic coordination should be checked."
        : workZoneStatus === "low"
          ? "Nearby work-zone activity exists but does not look like a dominant access constraint from this first-pass screen."
          : "No reliable nearby work-zone signal was available.";

  const jurisdictionContext = input.jurisdictionContext || null;
  const authorities = uniqueStrings([
    jurisdictionContext?.localAuthority,
    jurisdictionContext?.stateAuthority,
  ]);
  const approvalTriggers = uniqueStrings([
    tiaLikelihood !== "unlikely"
      ? "TIA or transportation scoping is likely to be requested during entitlement or site-plan review."
      : "Formal TIA may not be automatic, but transportation scoping should still be confirmed with the city reviewer.",
    accessStatus !== "low"
      ? "Driveway spacing, curb management, and site-access geometry should be reviewed early."
      : "Basic driveway/access review is still needed even if the first-pass access risk is low.",
    jurisdictionContext?.stateRouteTriggerNote,
    workZones1Km > 0
      ? "Nearby work zones make construction traffic management planning more important."
      : null,
  ]);

  const recommendedDocuments = uniqueStrings([
    "Traffic Impact Analysis (TIA) scoping memo",
    tiaLikelihood === "likely"
      ? "Full TIA with trip generation, distribution, assignment, and queue review"
      : "Transportation review memo confirming whether a full TIA is required",
    "Site access / driveway layout plan",
    "Parking, loading, and pick-up/drop-off study",
    workZones1Km > 0 ? "Construction traffic management / haul route plan" : null,
    transitStatus === "strong" || transitStatus === "moderate"
      ? "Pedestrian, curb, and transit-interface plan"
      : null,
  ]);

  const approvalNotes = uniqueStrings([
    jurisdictionContext
      ? `${jurisdictionContext.localAuthority} should be treated as the primary transportation reviewer for this mapped jurisdiction.`
      : "Primary local transportation review authority should be confirmed for this site.",
    jurisdictionContext
      ? `${jurisdictionContext.stateAuthority} review is conditional rather than automatic and usually depends on whether the project touches a state route or controlled-access system.`
      : null,
  ]);

  return {
    tripIntensity,
    transit: {
      status: transitStatus,
      summary: transitSummary,
      nearestDistanceMeters: nearestTransitDistance,
      nearbyCount: transitCount,
      sampleNames: input.transitSampleNames?.slice(0, 3) || [],
    } satisfies TransportationTransitAccessSummary,
    roadway: {
      status: accessStatus,
      summary: roadwaySummary,
      roadAccessSideCount,
      centroidRoadDistanceMeters: centroidRoadDistance,
      boundaryRoadCoverageRatio: boundaryRoadCoverage,
      roadWidthMeters: roadWidth,
      frontageWidthMeters: frontageWidth,
    } satisfies TransportationRoadwayContextSummary,
    tia: {
      likelihood: tiaLikelihood,
      summary:
        tiaLikelihood === "likely"
          ? "Transportation scoping should assume a full TIA or equivalent access study is likely."
          : tiaLikelihood === "possible"
            ? "A formal TIA is plausible, so the site should be screened with the transportation reviewer early."
            : "A full TIA does not look automatic from first-pass screening, but transportation review is still required.",
      estimatedTripIntensity: tripIntensity,
      triggers: tiaTriggers,
      offSiteImprovementReviewLikely:
        tiaLikelihood === "likely" || accessStatus === "high",
    } satisfies TransportationTiaSummary,
    accessManagement: {
      status: accessStatus,
      summary:
        accessStatus === "high"
          ? "Access management risk is high enough that driveway, queueing, and curb strategy should be scoped as a core entitlement issue."
          : accessStatus === "moderate"
            ? "Access management should be reviewed early, especially around driveway layout and curb operations."
            : "No major access-management blocker is visible from first-pass screening.",
      triggers: accessTriggers,
    } satisfies TransportationAccessManagementSummary,
    nearbyWorkZones: {
      status: workZoneStatus,
      summary: workZoneSummary,
      nearestDistanceMeters: nearestWorkZoneDistance,
      countWithin1Km: workZones1Km,
      countWithin5Km: workZones5Km,
      sampleWorkZones: [],
    } satisfies TransportationWorkZoneSummary,
    approvals: {
      authorities,
      triggers: approvalTriggers,
      recommendedDocuments,
      notes: approvalNotes,
    } satisfies TransportationApprovalSummary,
  };
}
