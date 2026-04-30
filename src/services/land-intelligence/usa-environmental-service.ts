import { inferRegulationGeography } from "@/lib/geography";
import type {
  AirQualityScreeningSummary,
  EnvironmentalFacility,
  EnvironmentalRiskLevel,
  EnvironmentalScreeningReport,
  NepaReviewLevel,
  WaterQualityScreeningSummary,
  WetlandScreeningSummary,
} from "@/lib/land-intelligence/environmental";
import { UsgsNlcdService } from "@/services/land-intelligence/usgs-nlcd-service";

const ECHO_BASE_URL = "https://echodata.epa.gov/echo";

type EchoResults = {
  Message?: string;
  QueryRows?: string;
  SVRows?: string;
  CVRows?: string;
  V3Rows?: string;
  FEARows?: string;
  VioLast4QRows?: string;
  TotalPenalties?: string;
  Facilities?: Array<Record<string, unknown>>;
};

type EchoResponse = {
  Results?: EchoResults;
};

type PilotContext = {
  city: "Austin" | "Phoenix" | "Seattle";
  stateCode: "TX" | "AZ" | "WA";
  county: string;
};

const PILOT_CONTEXT: Record<PilotContext["city"], Omit<PilotContext, "city">> = {
  Austin: {
    stateCode: "TX",
    county: "Travis",
  },
  Phoenix: {
    stateCode: "AZ",
    county: "Maricopa",
  },
  Seattle: {
    stateCode: "WA",
    county: "King",
  },
};

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeLocationContext(location: string): PilotContext | null {
  const inferred = inferRegulationGeography(location);
  const city = inferred.city as PilotContext["city"] | undefined;

  if (city && city in PILOT_CONTEXT) {
    return {
      city,
      ...PILOT_CONTEXT[city],
    };
  }

  const normalized = location.toLowerCase();
  if (normalized.includes("austin")) {
    return { city: "Austin", ...PILOT_CONTEXT.Austin };
  }
  if (normalized.includes("phoenix")) {
    return { city: "Phoenix", ...PILOT_CONTEXT.Phoenix };
  }
  if (normalized.includes("seattle")) {
    return { city: "Seattle", ...PILOT_CONTEXT.Seattle };
  }

  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function buildEchoUrl(
  servicePath: "air_rest_services.get_facility_info" | "cwa_rest_services.get_facility_info",
  coordinates: [number, number],
  radiusMiles: number,
) {
  const [lng, lat] = coordinates;
  const params = new URLSearchParams({
    output: "JSON",
    p_lat: String(lat),
    p_long: String(lng),
    p_radius: String(radiusMiles),
  });

  return `${ECHO_BASE_URL}/${servicePath}?${params.toString()}`;
}

function parseAirFacilities(payload: EchoResponse): EnvironmentalFacility[] {
  const facilities = payload.Results?.Facilities || [];
  return facilities.slice(0, 8).map((facility, index) => {
    const recentViolations = toNumber(facility.AIRRecentViolCnt);
    const complianceStatus = String(facility.AIRComplStatus || "").trim();
    const hpvStatus = String(facility.AIRHpvStatus || "").trim();

    return {
      id: String(facility.RegistryID || facility.SourceID || index + 1),
      name: String(facility.AIRName || "Unnamed Air Facility"),
      city: typeof facility.AIRCity === "string" ? facility.AIRCity : undefined,
      state: typeof facility.AIRState === "string" ? facility.AIRState : undefined,
      permitId: typeof facility.SourceID === "string" ? facility.SourceID : undefined,
      program: "air",
      status: typeof facility.AIRStatus === "string" ? facility.AIRStatus : undefined,
      complianceStatus: complianceStatus || undefined,
      recentViolations,
      isHighPriorityViolator: /high priority violation/i.test(hpvStatus),
      isCurrentViolator:
        /violation/i.test(complianceStatus) &&
        !/no violation/i.test(complianceStatus),
    };
  });
}

function parseWaterFacilities(payload: EchoResponse): EnvironmentalFacility[] {
  const facilities = payload.Results?.Facilities || [];
  return facilities.slice(0, 8).map((facility, index) => {
    const permitStatus = String(facility.CWPPermitStatusDesc || "").trim();
    return {
      id: String(
        facility.MasterExternalPermitNmbr || facility.SourceID || index + 1,
      ),
      name: String(facility.CWPName || "Unnamed Water Facility"),
      city: typeof facility.CWPCity === "string" ? facility.CWPCity : undefined,
      state: typeof facility.CWPState === "string" ? facility.CWPState : undefined,
      permitId:
        typeof facility.MasterExternalPermitNmbr === "string"
          ? facility.MasterExternalPermitNmbr
          : typeof facility.SourceID === "string"
            ? facility.SourceID
            : undefined,
      program: "water",
      status: permitStatus || undefined,
      complianceStatus: permitStatus || undefined,
      recentViolations: null,
      isHighPriorityViolator: false,
      isCurrentViolator: /current|effective|active/i.test(permitStatus),
    };
  });
}

function buildWetlandSummary(
  nlcdClass: string | undefined,
  nlcdCode: string | undefined,
  latestYear?: number,
): WetlandScreeningSummary {
  const label = (nlcdClass || "").toLowerCase();
  const isWetlandLike = label.includes("wetland");
  const isWaterLike = label.includes("water");

  let status: EnvironmentalRiskLevel = "low";
  let summary =
    "No wetland-like land-cover class was detected at the analyzed point.";
  const indicators: string[] = [];

  if (isWetlandLike) {
    status = "high";
    summary =
      "The analyzed point falls inside an NLCD wetland land-cover class, so wetland delineation and permitting due diligence should happen early.";
    indicators.push(`NLCD class is ${nlcdClass}.`);
  } else if (isWaterLike) {
    status = "high";
    summary =
      "The analyzed point falls inside an open-water land-cover class, which is a strong environmental and buildability constraint.";
    indicators.push(`NLCD class is ${nlcdClass}.`);
  } else if (label.includes("forest") || label.includes("grass") || label.includes("pasture")) {
    status = "moderate";
    summary =
      "The point is not mapped as wetland, but the surrounding natural land-cover context still warrants environmental screening before entitlement.";
    indicators.push(`NLCD class is ${nlcdClass}.`);
  } else if (nlcdClass) {
    indicators.push(`NLCD class is ${nlcdClass}.`);
  }

  if (latestYear) {
    indicators.push(`Land-cover snapshot year: ${latestYear}.`);
  }

  return {
    status,
    summary,
    indicators,
    source: "USGS MRLC Annual NLCD",
    nlcdClass,
    nlcdCode,
    latestYear,
    isWetlandLike,
    isWaterLike,
  };
}

function buildAirSummary(payload: EchoResponse): AirQualityScreeningSummary {
  const results = payload.Results;
  const facilityCount = toNumber(results?.QueryRows);
  const currentViolationCount = toNumber(results?.CVRows);
  const significantViolationCount = toNumber(results?.SVRows);
  const formalEnforcementCount = toNumber(results?.FEARows);
  const facilities = parseAirFacilities(payload);

  let status: EnvironmentalRiskLevel = "low";
  if (significantViolationCount > 0 || currentViolationCount >= 8) {
    status = "high";
  } else if (facilityCount >= 20 || currentViolationCount > 0 || formalEnforcementCount > 0) {
    status = "moderate";
  }

  const indicators = [
    `${facilityCount} EPA-regulated air facility records within the search radius.`,
  ];

  if (currentViolationCount > 0) {
    indicators.push(`${currentViolationCount} facilities with current air violations.`);
  }
  if (significantViolationCount > 0) {
    indicators.push(
      `${significantViolationCount} facilities flagged for significant air violations.`,
    );
  }
  if (formalEnforcementCount > 0) {
    indicators.push(`${formalEnforcementCount} formal air enforcement actions in the result set.`);
  }

  let summary =
    "Nearby EPA-regulated air facilities do not show a strong immediate compliance burden in the current screening radius.";
  if (status === "high") {
    summary =
      "The nearby EPA air-facility profile indicates a meaningful compliance burden, so ambient air and emissions context should be reviewed during due diligence.";
  } else if (status === "moderate") {
    summary =
      "There is a moderate nearby air-regulatory footprint, so air-quality context should be reviewed before relying on a clean environmental narrative.";
  }

  return {
    status,
    summary,
    indicators,
    source: "EPA ECHO Air Facility Search",
    facilityCount,
    currentViolationCount,
    significantViolationCount,
    formalEnforcementCount,
    totalPenalties: results?.TotalPenalties || null,
    sampleFacilities: facilities,
  };
}

function buildWaterSummary(payload: EchoResponse): WaterQualityScreeningSummary {
  const results = payload.Results;
  const facilityCount = toNumber(results?.QueryRows);
  const currentViolationCount = toNumber(results?.CVRows);
  const significantViolationCount = toNumber(results?.SVRows);
  const recentViolationCount = toNumber(results?.VioLast4QRows);
  const formalEnforcementCount = toNumber(results?.FEARows);
  const facilities = parseWaterFacilities(payload);
  const permitStatuses = uniqueValues(
    facilities.map((facility) => facility.status || facility.complianceStatus),
  );

  let status: EnvironmentalRiskLevel = "low";
  if (significantViolationCount > 0 || recentViolationCount >= 10) {
    status = "high";
  } else if (facilityCount >= 15 || currentViolationCount > 0 || formalEnforcementCount > 0) {
    status = "moderate";
  }

  const indicators = [
    `${facilityCount} EPA-regulated water / wastewater facility records within the search radius.`,
  ];

  if (currentViolationCount > 0) {
    indicators.push(`${currentViolationCount} facilities with current water violations.`);
  }
  if (significantViolationCount > 0) {
    indicators.push(
      `${significantViolationCount} facilities flagged for significant water violations.`,
    );
  }
  if (recentViolationCount > 0) {
    indicators.push(`${recentViolationCount} facilities with water violations in recent quarters.`);
  }

  let summary =
    "Nearby EPA-regulated water facilities do not show a strong immediate compliance burden in the current screening radius.";
  if (status === "high") {
    summary =
      "The nearby EPA water-facility profile indicates elevated permitting or compliance complexity, so receiving-water and discharge context should be reviewed early.";
  } else if (status === "moderate") {
    summary =
      "There is a moderate nearby water-regulatory footprint, so stormwater and receiving-water due diligence should be included in pre-development screening.";
  }

  return {
    status,
    summary,
    indicators,
    source: "EPA ECHO Water Facility Search",
    facilityCount,
    currentViolationCount,
    significantViolationCount,
    recentViolationCount,
    formalEnforcementCount,
    totalPenalties: results?.TotalPenalties || null,
    permitStatuses,
    sampleFacilities: facilities,
  };
}

function buildNepaSummary({
  wetland,
  air,
  water,
}: {
  wetland: WetlandScreeningSummary;
  air: AirQualityScreeningSummary;
  water: WaterQualityScreeningSummary;
}) {
  const triggers: string[] = [];
  let status: NepaReviewLevel = "unlikely";

  if (wetland.status === "high") {
    triggers.push("Wetland or open-water land cover detected at the analyzed point.");
  }
  if (water.status === "high") {
    triggers.push("Elevated nearby Clean Water Act facility / violation burden.");
  } else if (water.status === "moderate") {
    triggers.push("Moderate nearby water-permitting footprint.");
  }
  if (air.status === "high") {
    triggers.push("Elevated nearby Clean Air Act facility / violation burden.");
  } else if (air.status === "moderate") {
    triggers.push("Moderate nearby air-permitting footprint.");
  }

  if (wetland.status === "high" || water.status === "high" || air.status === "high") {
    status = "elevated-review";
  } else if (triggers.length > 0) {
    status = "screening-recommended";
  }

  let summary =
    "No strong federal environmental trigger is visible from this first-pass screening, but NEPA-style due diligence may still be needed depending on funding, permits, or site conditions.";
  if (status === "elevated-review") {
    summary =
      "The first-pass EPA screening shows conditions that justify an early environmental review workstream, including NEPA-style screening if federal funding, federal permits, or federal land involvement appears later.";
  } else if (status === "screening-recommended") {
    summary =
      "The site does not show a clear federal blocker, but the current environmental profile is strong enough to justify a targeted NEPA / environmental-review screen during due diligence.";
  }

  return {
    status,
    summary,
    triggers,
    recommendedDocuments: [
      "Phase I ESA",
      "Wetland delineation / jurisdictional review (if applicable)",
      "Stormwater / NPDES review",
      "Air and water permitting screen",
      "Environmental assessment / NEPA review memo if federal nexus exists",
    ],
    source:
      "EPA ECHO + USGS NLCD screening, aligned with Phase 1.3 compliance checklist",
  };
}

export const UsaEnvironmentalService = {
  async getEnvironmentalScreening(
    coordinates: [number, number],
    location: string = "",
  ): Promise<EnvironmentalScreeningReport> {
    const locationContext = normalizeLocationContext(location);
    const notes: string[] = [];

    const [landUseResult, airResult, waterResult] = await Promise.allSettled([
      UsgsNlcdService.getLandUse(coordinates, location),
      fetchJson<EchoResponse>(
        buildEchoUrl("air_rest_services.get_facility_info", coordinates, 10),
      ),
      fetchJson<EchoResponse>(
        buildEchoUrl("cwa_rest_services.get_facility_info", coordinates, 5),
      ),
    ]);

    const wetlandSummary =
      landUseResult.status === "fulfilled"
        ? buildWetlandSummary(
            landUseResult.value.primaryLandUse,
            landUseResult.value.layers[0]?.landUseCode,
            landUseResult.value.latestYear,
          )
        : ({
            status: "unknown",
            summary:
              "Wetland screening could not be completed from the land-cover source.",
            indicators: [],
            source: "USGS MRLC Annual NLCD",
          } satisfies WetlandScreeningSummary);

    if (landUseResult.status !== "fulfilled") {
      notes.push("USGS land-cover screening was unavailable for this request.");
    }

    const airSummary =
      airResult.status === "fulfilled"
        ? buildAirSummary(airResult.value)
        : ({
            status: "unknown",
            summary:
              "EPA air-facility screening was unavailable for this request.",
            indicators: [],
            source: "EPA ECHO Air Facility Search",
            facilityCount: 0,
            currentViolationCount: 0,
            significantViolationCount: 0,
            formalEnforcementCount: 0,
            totalPenalties: null,
            sampleFacilities: [],
          } satisfies AirQualityScreeningSummary);

    if (airResult.status !== "fulfilled") {
      notes.push("EPA ECHO air-facility screening was unavailable for this request.");
    }

    const waterSummary =
      waterResult.status === "fulfilled"
        ? buildWaterSummary(waterResult.value)
        : ({
            status: "unknown",
            summary:
              "EPA water-facility screening was unavailable for this request.",
            indicators: [],
            source: "EPA ECHO Water Facility Search",
            facilityCount: 0,
            currentViolationCount: 0,
            significantViolationCount: 0,
            recentViolationCount: 0,
            formalEnforcementCount: 0,
            totalPenalties: null,
            permitStatuses: [],
            sampleFacilities: [],
          } satisfies WaterQualityScreeningSummary);

    if (waterResult.status !== "fulfilled") {
      notes.push("EPA ECHO water-facility screening was unavailable for this request.");
    } else {
      notes.push(
        "Water-quality screening currently relies on nearby EPA-regulated water facilities and permit burden rather than a parcel-indexed ATTAINS impairment lookup.",
      );
    }

    const nepa = buildNepaSummary({
      wetland: wetlandSummary,
      air: airSummary,
      water: waterSummary,
    });

    return {
      market: "USA",
      countryCode: "US",
      location: location || locationContext?.city || "USA pilot location",
      stateCode: locationContext?.stateCode,
      county: locationContext?.county,
      wetlandScreening: wetlandSummary,
      airQuality: airSummary,
      waterQuality: waterSummary,
      nepa,
      dataSources: {
        nlcd: {
          available: landUseResult.status === "fulfilled",
        },
        echoAir: {
          available: airResult.status === "fulfilled",
        },
        echoWater: {
          available: waterResult.status === "fulfilled",
        },
        attains: {
          available: false,
          notes: [
            "ATTAINS point-indexed integration is not wired yet in this first-pass USA environmental screen.",
          ],
        },
      },
      notes,
    };
  },
};

export default UsaEnvironmentalService;
