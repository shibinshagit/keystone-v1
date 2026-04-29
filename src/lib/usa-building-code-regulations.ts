import { mergeRegulationRecords } from "@/lib/regulation-merge";
import type { CountryCode, GeographyMarket, RegulationData, RegulationValue } from "@/lib/types";

const USA_MARKET: GeographyMarket = "USA";
const USA_COUNTRY_CODE: CountryCode = "US";

const PILOT_CITY_METADATA = {
  Austin: {
    stateOrProvince: "Texas",
    codeFamily: "2024 IBC / 2024 IRC",
    adoptedCodeNote:
      "Austin adopted the 2024 technical building codes effective July 10, 2025.",
  },
  Phoenix: {
    stateOrProvince: "Arizona",
    codeFamily: "2024 PBCC (IBC / IRC 2024)",
    adoptedCodeNote:
      "Phoenix adopted the 2024 Phoenix Building Construction Code effective August 1, 2025.",
  },
  Seattle: {
    stateOrProvince: "Washington",
    codeFamily: "2021 Seattle Building Code / Seattle Residential Code",
    adoptedCodeNote:
      "Seattle currently enforces the 2021 Seattle Building Code and 2021 Seattle Residential Code with local amendments.",
  },
} as const;

const PILOT_CITIES = Object.keys(PILOT_CITY_METADATA) as Array<
  keyof typeof PILOT_CITY_METADATA
>;

function metersFromFeet(feet: number) {
  return Number((feet * 0.3048).toFixed(2));
}

function value(
  desc: string,
  unit: string,
  numericValue: number,
  extra: Partial<RegulationValue> = {},
): RegulationValue {
  return {
    desc,
    unit,
    value: numericValue,
    ...extra,
  };
}

function normalizeRegulationType(type: string) {
  return type.trim().toLowerCase().replace(/-/g, " ");
}

function buildResidentialTemplate(): Pick<
  RegulationData,
  "geometry" | "highrise" | "facilities" | "safety_and_services" | "sustainability" | "administration"
> {
  return {
    geometry: {},
    highrise: {
      highrise_threshold: value(
        "High-rise trigger for IBC life-safety rules",
        "m",
        metersFromFeet(75),
      ),
      fire_lift_threshold: value(
        "Fire service elevator trigger",
        "m",
        metersFromFeet(75),
      ),
      fire_command_center_threshold: value(
        "Fire command center trigger",
        "m",
        metersFromFeet(75),
      ),
      pressurized_staircase_threshold: value(
        "Stair pressurization trigger",
        "m",
        metersFromFeet(75),
      ),
    },
    facilities: {
      staircase_width: value(
        "IRC clear stair width baseline",
        "m",
        metersFromFeet(3),
      ),
      corridor_widths: value(
        "Residential corridor baseline",
        "m",
        metersFromFeet(3),
      ),
      staircase_count: value(
        "Minimum independent exit stairs for multifamily high-rise",
        "",
        2,
      ),
      lift_requirements: value(
        "At least one accessible passenger elevator above accessible entry level",
        "",
        1,
      ),
    },
    safety_and_services: {
      fire_exits_travel_distance: value(
        "Sprinklered exit access travel baseline",
        "m",
        metersFromFeet(250),
      ),
      fire_tender_access: value(
        "Fire apparatus access road baseline",
        "m",
        metersFromFeet(20),
      ),
      fire_tender_movement: value(
        "Fire apparatus turning / movement route baseline",
        "m",
        metersFromFeet(20),
      ),
      fire_command_center: value(
        "Fire command center required once high-rise threshold is reached",
        "",
        1,
      ),
      fire_fighting_systems: value(
        "Automatic sprinkler / standpipe baseline for high-rise",
        "",
        1,
      ),
      fire_safety: value(
        "IBC / IRC life-safety baseline mapped",
        "",
        1,
      ),
      staircases_by_height: value(
        "Two enclosed exit stairs once high-rise provisions apply",
        "",
        2,
      ),
    },
    sustainability: {},
    administration: {
      land_use_category: value(
        "Residential baseline uses IRC for detached / townhouse and IBC for multifamily",
        "",
        1,
      ),
      exit_compliance: value(
        "Means-of-egress requirements mapped from adopted code family",
        "",
        1,
      ),
    },
  };
}

function buildNonResidentialTemplate(): Pick<
  RegulationData,
  "geometry" | "highrise" | "facilities" | "safety_and_services" | "sustainability" | "administration"
> {
  return {
    geometry: {},
    highrise: {
      highrise_threshold: value(
        "High-rise trigger for IBC life-safety rules",
        "m",
        metersFromFeet(75),
      ),
      fire_lift_threshold: value(
        "Fire service elevator trigger",
        "m",
        metersFromFeet(75),
      ),
      fire_command_center_threshold: value(
        "Fire command center trigger",
        "m",
        metersFromFeet(75),
      ),
      pressurized_staircase_threshold: value(
        "Stair pressurization trigger",
        "m",
        metersFromFeet(75),
      ),
    },
    facilities: {
      staircase_width: value(
        "IBC egress stair width baseline",
        "m",
        metersFromFeet(44 / 12),
      ),
      corridor_widths: value(
        "IBC corridor width baseline",
        "m",
        metersFromFeet(44 / 12),
      ),
      staircase_count: value(
        "Minimum enclosed exit stairs for high-rise floor plates",
        "",
        2,
      ),
      lift_requirements: value(
        "At least one passenger elevator for accessible multi-story buildings",
        "",
        1,
      ),
    },
    safety_and_services: {
      fire_exits_travel_distance: value(
        "Sprinklered exit access travel baseline",
        "m",
        metersFromFeet(250),
      ),
      fire_tender_access: value(
        "Fire apparatus access road baseline",
        "m",
        metersFromFeet(20),
      ),
      fire_tender_movement: value(
        "Fire apparatus turning / movement route baseline",
        "m",
        metersFromFeet(20),
      ),
      fire_command_center: value(
        "Fire command center required once high-rise threshold is reached",
        "",
        1,
      ),
      fire_fighting_systems: value(
        "Automatic sprinkler / standpipe baseline for high-rise",
        "",
        1,
      ),
      fire_safety: value(
        "IBC life-safety baseline mapped",
        "",
        1,
      ),
      staircases_by_height: value(
        "Two enclosed exit stairs once high-rise provisions apply",
        "",
        2,
      ),
    },
    sustainability: {},
    administration: {
      land_use_category: value(
        "Primary building-code family mapped from adopted local IBC edition",
        "",
        1,
      ),
      exit_compliance: value(
        "Means-of-egress requirements mapped from adopted code family",
        "",
        1,
      ),
    },
  };
}

function buildRegulation(
  city: keyof typeof PILOT_CITY_METADATA,
  type: RegulationData["type"],
  template: ReturnType<typeof buildResidentialTemplate>,
): RegulationData {
  const metadata = PILOT_CITY_METADATA[city];

  return {
    id: `${city}-${type}-usa-building-code-baseline`
      .replace(/\s+/g, "-")
      .replace(/[()]/g, ""),
    location: city,
    market: USA_MARKET,
    countryCode: USA_COUNTRY_CODE,
    stateOrProvince: metadata.stateOrProvince,
    city,
    jurisdictionLevel: "city",
    codeFamily: metadata.codeFamily,
    type,
    geometry: template.geometry,
    highrise: {
      ...template.highrise,
      structural_audit_threshold: value(
        metadata.adoptedCodeNote,
        "m",
        metersFromFeet(75),
      ),
    },
    facilities: template.facilities,
    sustainability: template.sustainability,
    safety_and_services: template.safety_and_services,
    administration: {
      ...template.administration,
      special_zones: value(metadata.adoptedCodeNote, "", 1),
    },
  };
}

const RESIDENTIAL_TEMPLATE = buildResidentialTemplate();
const NON_RESIDENTIAL_TEMPLATE = buildNonResidentialTemplate();

const USA_BUILDING_CODE_BASELINES: Record<string, RegulationData[]> = Object.fromEntries(
  PILOT_CITIES.map((city) => [
    city,
    [
      buildRegulation(city, "Residential", RESIDENTIAL_TEMPLATE),
      buildRegulation(city, "Commercial", NON_RESIDENTIAL_TEMPLATE),
      buildRegulation(city, "Industrial", NON_RESIDENTIAL_TEMPLATE),
      buildRegulation(city, "Public", NON_RESIDENTIAL_TEMPLATE),
      buildRegulation(city, "Mixed Use", NON_RESIDENTIAL_TEMPLATE),
    ],
  ]),
);

export function getUsaBuildingCodeBaselines(location?: string | null): RegulationData[] {
  if (!location) return [];

  const normalizedLocation = location.trim().toLowerCase();
  const match = PILOT_CITIES.find(
    (city) =>
      normalizedLocation === city.toLowerCase() ||
      normalizedLocation.includes(city.toLowerCase()),
  );

  if (!match) return [];

  return USA_BUILDING_CODE_BASELINES[match].map((regulation) => ({
    ...regulation,
    geometry: { ...regulation.geometry },
    highrise: { ...regulation.highrise },
    facilities: { ...regulation.facilities },
    sustainability: { ...regulation.sustainability },
    safety_and_services: { ...regulation.safety_and_services },
    administration: { ...regulation.administration },
  }));
}

function mergeTwoRegulations(
  baseline: RegulationData,
  override: RegulationData,
): RegulationData {
  return mergeRegulationRecords(baseline, override);
}

export function mergeUsaBuildingCodeBaselines(
  location: string | null | undefined,
  regulations: RegulationData[],
): RegulationData[] {
  const baselines = getUsaBuildingCodeBaselines(location);
  if (baselines.length === 0) return regulations;

  const merged = new Map<string, RegulationData>();

  for (const baseline of baselines) {
    merged.set(normalizeRegulationType(baseline.type), baseline);
  }

  for (const regulation of regulations) {
    const key = normalizeRegulationType(regulation.type);
    const baseline = merged.get(key);
    merged.set(key, baseline ? mergeTwoRegulations(baseline, regulation) : regulation);
  }

  return Array.from(merged.values());
}
