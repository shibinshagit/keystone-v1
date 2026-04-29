import { mergeRegulationRecords } from "@/lib/regulation-merge";
import type { CountryCode, GeographyMarket, RegulationData, RegulationValue } from "@/lib/types";

const USA_MARKET: GeographyMarket = "USA";
const USA_COUNTRY_CODE: CountryCode = "US";

function feetToMeters(feet: number) {
  return Number((feet * 0.3048).toFixed(2));
}

function sqftToSqm(squareFeet: number) {
  return Number((squareFeet * 0.092903).toFixed(2));
}

function value(
  desc: string,
  unit: string,
  rawValue: RegulationValue["value"],
  extra: Partial<RegulationValue> = {},
): RegulationValue {
  return {
    desc,
    unit,
    value: rawValue,
    ...extra,
  };
}

function normalizeRegulationType(type: string) {
  return type.trim().toLowerCase().replace(/-/g, " ");
}

type PilotCity = "Austin" | "Phoenix" | "Seattle";

const CITY_METADATA: Record<
  PilotCity,
  {
    stateOrProvince: string;
    codeFamily: string;
  }
> = {
  Austin: {
    stateOrProvince: "Texas",
    codeFamily: "City Zoning Baseline",
  },
  Phoenix: {
    stateOrProvince: "Arizona",
    codeFamily: "City Zoning Baseline",
  },
  Seattle: {
    stateOrProvince: "Washington",
    codeFamily: "City Zoning Baseline",
  },
};

function buildRecord(
  city: PilotCity,
  type: RegulationData["type"],
  geometry: RegulationData["geometry"],
  administration: RegulationData["administration"],
  facilities: RegulationData["facilities"] = {},
): RegulationData {
  const cityMeta = CITY_METADATA[city];
  return {
    id: `${city}-${type}-usa-zoning-baseline`
      .replace(/\s+/g, "-")
      .replace(/[()]/g, ""),
    location: city,
    market: USA_MARKET,
    countryCode: USA_COUNTRY_CODE,
    stateOrProvince: cityMeta.stateOrProvince,
    city,
    jurisdictionLevel: "city",
    codeFamily: cityMeta.codeFamily,
    type,
    geometry,
    highrise: {},
    facilities,
    sustainability: {},
    safety_and_services: {},
    administration,
  };
}

const AUSTIN_ZONING_BASELINES: RegulationData[] = [
  buildRecord(
    "Austin",
    "Residential",
    {
      floor_area_ratio: value("MF-4 maximum FAR", "", 0.75),
      max_ground_coverage: value("MF-4 max building coverage", "%", 60),
      max_height: value("MF-4 max height", "m", feetToMeters(60)),
      front_setback: value("MF-4 front yard", "m", feetToMeters(15)),
      rear_setback: value("MF-4 rear yard", "m", feetToMeters(10)),
      side_setback: value("MF-4 interior side yard", "m", feetToMeters(5)),
      setback: value("MF-4 representative base setback", "m", feetToMeters(10)),
      minimum_plot_size: value("MF-4 minimum lot size", "sqm", sqftToSqm(8000)),
      minimum_frontage_width: value("MF-4 minimum lot width", "m", feetToMeters(50)),
      units_per_acre: value("MF-4 units per acre range midpoint", "units/acre", 45, {
        min: 36,
        max: 54,
      }),
      density_norms: value("MF-4 density range midpoint", "DU/acre", 45, {
        min: 36,
        max: 54,
      }),
    },
    {
      land_use_zoning: value("Representative Austin residential district", "", "MF-4"),
      special_zones: value(
        "Source: Austin Zoning Guide MF-4 site development standards",
        "",
        "Austin Zoning Guide (MF-4)",
      ),
    },
  ),
  buildRecord(
    "Austin",
    "Commercial",
    {
      floor_area_ratio: value("GR maximum FAR", "", 1),
      max_ground_coverage: value("GR max building coverage", "%", 75),
      max_height: value("GR max height", "m", feetToMeters(60)),
      front_setback: value("GR front yard", "m", feetToMeters(10)),
      setback: value("GR representative front setback", "m", feetToMeters(10)),
      minimum_plot_size: value("GR minimum lot size", "sqm", sqftToSqm(5750)),
      minimum_frontage_width: value("GR minimum lot width", "m", feetToMeters(50)),
    },
    {
      land_use_zoning: value("Representative Austin commercial district", "", "GR"),
      special_zones: value(
        "Source: Austin Zoning Guide GR site development standards",
        "",
        "Austin Zoning Guide (GR)",
      ),
    },
  ),
  buildRecord(
    "Austin",
    "Mixed Use",
    {
      floor_area_ratio: value("GR-MU base FAR from underlying GR district", "", 1),
      max_ground_coverage: value("GR-MU base coverage from underlying GR district", "%", 75),
      max_height: value("GR-MU base height from underlying GR district", "m", feetToMeters(60)),
      front_setback: value("GR-MU front setback from underlying GR district", "m", feetToMeters(10)),
      setback: value("GR-MU representative front setback", "m", feetToMeters(10)),
      minimum_plot_size: value("GR-MU minimum lot size from underlying GR district", "sqm", sqftToSqm(5750)),
      minimum_frontage_width: value("GR-MU minimum lot width from underlying GR district", "m", feetToMeters(50)),
    },
    {
      land_use_zoning: value("Representative Austin mixed-use district", "", "GR-MU"),
      tod_rules: value(
        "Austin MU combines commercial base zoning with residential uses",
        "",
        "MU combining district uses underlying commercial standards",
      ),
      special_zones: value(
        "Source: Austin Zoning Guide GR and MU combining district tables",
        "",
        "Austin Zoning Guide (GR-MU)",
      ),
    },
  ),
  buildRecord(
    "Austin",
    "Industrial",
    {
      floor_area_ratio: value("LI maximum FAR", "", 1),
      max_ground_coverage: value("LI max building coverage", "%", 75),
      max_height: value("LI max height", "m", feetToMeters(60)),
      minimum_plot_size: value("LI minimum lot size", "sqm", sqftToSqm(5750)),
      minimum_frontage_width: value("LI minimum lot width", "m", feetToMeters(50)),
    },
    {
      land_use_zoning: value("Representative Austin industrial district", "", "LI"),
      special_zones: value(
        "Source: Austin Zoning Guide LI site development standards",
        "",
        "Austin Zoning Guide (LI)",
      ),
    },
  ),
  buildRecord(
    "Austin",
    "Public",
    {
      max_height: value("Austin public district often resolved through site plan review", "m", feetToMeters(60)),
    },
    {
      land_use_zoning: value("Austin public district", "", "P"),
      special_zones: value(
        "Austin P district is site-specific: adjoining district standards apply on sites under one acre; larger sites are set by conditional use site plan.",
        "",
        "Austin Zoning Guide (P district is site-specific)",
      ),
    },
  ),
];

const PHOENIX_ZONING_BASELINES: RegulationData[] = [
  buildRecord(
    "Phoenix",
    "Residential",
    {
      max_ground_coverage: value("R-5 max lot coverage", "%", 50),
      max_height: value("R-5 max height", "m", feetToMeters(48)),
      front_setback: value("R-5 front yard baseline", "m", feetToMeters(20)),
      rear_setback: value("R-5 rear yard baseline", "m", feetToMeters(10)),
      side_setback: value("R-5 side yard baseline", "m", feetToMeters(10)),
      setback: value("R-5 representative base setback", "m", feetToMeters(10)),
      units_per_acre: value("R-5 max density", "units/acre", 43.5),
      density_norms: value("R-5 max density", "DU/acre", 43.5),
    },
    {
      land_use_zoning: value("Representative Phoenix residential district", "", "R-5"),
      special_zones: value(
        "Source: Phoenix staff report summarizing R-5 multifamily standards",
        "",
        "Phoenix R-5 baseline",
      ),
    },
  ),
  buildRecord(
    "Phoenix",
    "Commercial",
    {
      max_ground_coverage: value("C-2 max lot coverage", "%", 50),
      max_height: value("C-2 max height with standard height waiver path", "m", feetToMeters(56)),
      front_setback: value("C-2 street setback minimum", "m", feetToMeters(20)),
      rear_setback: value("C-2 interior setback", "m", 0),
      side_setback: value("C-2 interior side setback", "m", 0),
      setback: value("C-2 representative street setback", "m", feetToMeters(20)),
    },
    {
      land_use_zoning: value("Representative Phoenix commercial district", "", "C-2"),
      special_zones: value(
        "Source: Phoenix staff reports summarizing C-2 intermediate commercial standards",
        "",
        "Phoenix C-2 baseline",
      ),
    },
  ),
  buildRecord(
    "Phoenix",
    "Mixed Use",
    {
      max_ground_coverage: value("Phoenix mixed-use pilot baseline lot coverage", "%", 60),
      max_height: value("Phoenix mixed-use pilot baseline height", "m", feetToMeters(56)),
      front_setback: value("Phoenix mixed-use street setback baseline", "m", feetToMeters(12)),
      rear_setback: value("Phoenix mixed-use rear setback baseline", "m", feetToMeters(10)),
      side_setback: value("Phoenix mixed-use side setback baseline", "m", feetToMeters(5)),
      setback: value("Phoenix mixed-use representative base setback", "m", feetToMeters(10)),
      units_per_acre: value("Phoenix mixed-use residential component density baseline", "units/acre", 38),
      density_norms: value("Phoenix mixed-use residential component density baseline", "DU/acre", 38),
    },
    {
      land_use_zoning: value("Representative Phoenix mixed-use baseline", "", "C-2 / R-5 mixed-use"),
      tod_rules: value(
        "Pilot mixed-use baseline blends Phoenix C-2 commercial form with multifamily density precedent",
        "",
        "Mixed-use baseline derived from Phoenix mixed-use multifamily staff reports",
      ),
      special_zones: value(
        "Source: Phoenix mixed-use PUD and staff report comparisons tied to C-2 and R-5 standards",
        "",
        "Phoenix mixed-use baseline",
      ),
    },
  ),
  buildRecord(
    "Phoenix",
    "Industrial",
    {
      max_height: value("A-1 industrial max height without additional use permit", "m", feetToMeters(56)),
      front_setback: value("A-1 front setback", "m", feetToMeters(25)),
      rear_setback: value("A-1 rear setback", "m", 0),
      side_setback: value("A-1 side setback", "m", 0),
      setback: value("A-1 representative front setback", "m", feetToMeters(25)),
    },
    {
      land_use_zoning: value("Representative Phoenix industrial district", "", "A-1"),
      special_zones: value(
        "A-1 has no maximum lot coverage requirement in the cited staff report baseline; height can increase to 80 feet with use permit and site plan.",
        "",
        "Phoenix A-1 baseline",
      ),
    },
  ),
  buildRecord(
    "Phoenix",
    "Public",
    {
      max_ground_coverage: value("Civic-serving Phoenix public baseline lot coverage", "%", 50),
      max_height: value("Civic-serving Phoenix public baseline height", "m", feetToMeters(30)),
      front_setback: value("Civic-serving Phoenix public baseline street setback", "m", feetToMeters(20)),
      rear_setback: value("Civic-serving Phoenix public baseline rear setback", "m", 0),
      side_setback: value("Civic-serving Phoenix public baseline side setback", "m", 0),
      setback: value("Civic-serving Phoenix public representative setback", "m", feetToMeters(20)),
    },
    {
      land_use_zoning: value("Phoenix civic-serving public proxy", "", "C-2 civic proxy"),
      special_zones: value(
        "Phoenix public / institutional projects are highly site-specific in practice; this pilot uses a C-2 civic-serving baseline for runtime envelope checks.",
        "",
        "Phoenix public proxy baseline",
      ),
    },
  ),
];

const SEATTLE_ZONING_BASELINES: RegulationData[] = [
  buildRecord(
    "Seattle",
    "Residential",
    {
      floor_area_ratio: value("LR3 representative FAR", "", 1.8),
      max_height: value("LR3 representative height in growth areas", "m", feetToMeters(40)),
      front_setback: value("LR3 front setback average baseline", "m", feetToMeters(7)),
      rear_setback: value("LR3 rear setback baseline", "m", feetToMeters(7)),
      side_setback: value("LR3 side setback baseline", "m", feetToMeters(5)),
      setback: value("LR3 representative base setback", "m", feetToMeters(7)),
    },
    {
      land_use_zoning: value("Representative Seattle residential district", "", "LR3"),
      special_zones: value(
        "Seattle LR3 is primarily controlled by FAR and height rather than lot coverage; upper-level setbacks vary by height and adjacency to neighborhood residential zones.",
        "",
        "Seattle LR3 baseline",
      ),
    },
    {
      open_space: value("Seattle lowrise amenity area", "%", 25),
    },
  ),
  buildRecord(
    "Seattle",
    "Commercial",
    {
      floor_area_ratio: value("NC3-55 representative FAR", "", 3.75),
      max_height: value("NC3 representative height suffix", "m", feetToMeters(55)),
      front_setback: value("NC3-55 front setback baseline", "m", feetToMeters(10)),
      rear_setback: value("NC3-55 rear setback next to residential lot", "m", feetToMeters(10)),
      side_setback: value("NC3-55 side setback next to residential lot", "m", feetToMeters(15)),
      setback: value("NC3-55 representative base setback", "m", feetToMeters(10)),
    },
    {
      land_use_zoning: value("Representative Seattle commercial district", "", "NC3-55"),
      tod_rules: value(
        "Seattle commercial FAR varies by height suffix and station area status; pilot baseline uses NC3-55 mixed-use urban village form.",
        "",
        "NC3-55 baseline",
      ),
      special_zones: value(
        "Source: Seattle commercial zoning summary plus NC-55 illustrative building example.",
        "",
        "Seattle NC3-55 baseline",
      ),
    },
    {
      open_space: value("Residential amenity area in commercial zones", "%", 5),
    },
  ),
  buildRecord(
    "Seattle",
    "Mixed Use",
    {
      floor_area_ratio: value("NC3-55 mixed-use representative FAR", "", 3.75),
      max_height: value("NC3-55 mixed-use representative height", "m", feetToMeters(55)),
      front_setback: value("NC3-55 mixed-use front setback baseline", "m", feetToMeters(10)),
      rear_setback: value("NC3-55 mixed-use rear setback next to residential lot", "m", feetToMeters(10)),
      side_setback: value("NC3-55 mixed-use side setback next to residential lot", "m", feetToMeters(15)),
      setback: value("NC3-55 mixed-use representative base setback", "m", feetToMeters(10)),
    },
    {
      land_use_zoning: value("Representative Seattle mixed-use district", "", "NC3-55"),
      tod_rules: value(
        "Pilot mixed-use baseline uses Seattle NC3-55 urban village form where housing, offices, and retail are compatible.",
        "",
        "NC3-55 mixed-use baseline",
      ),
      special_zones: value(
        "Source: Seattle commercial zoning summary and NC-55 mixed-use illustrative example.",
        "",
        "Seattle NC3-55 mixed-use baseline",
      ),
    },
    {
      open_space: value("Residential amenity area in commercial zones", "%", 5),
    },
  ),
  buildRecord(
    "Seattle",
    "Industrial",
    {
      floor_area_ratio: value("Industrial Commercial FAR", "", 2.5),
      max_height: value("Industrial Commercial representative mapped height", "m", feetToMeters(85)),
      front_setback: value("IC street setback when across from residential / lowrise zone", "m", feetToMeters(5)),
      rear_setback: value("IC setback when abutting residential lot", "m", feetToMeters(5)),
      side_setback: value("IC setback when abutting residential lot", "m", feetToMeters(5)),
      setback: value("IC representative base setback", "m", feetToMeters(5)),
    },
    {
      land_use_zoning: value("Representative Seattle industrial district", "", "IC"),
      special_zones: value(
        "IC industrial uses may have no maximum height, but specified non-industrial uses follow mapped 30/45/65/85 foot limits; pilot uses 85-foot urban employment baseline.",
        "",
        "Seattle IC baseline",
      ),
    },
  ),
  buildRecord(
    "Seattle",
    "Public",
    {
      floor_area_ratio: value("Civic-serving Seattle public baseline FAR", "", 3.75),
      max_height: value("Civic-serving Seattle public baseline height", "m", feetToMeters(55)),
      front_setback: value("Civic-serving Seattle public front setback baseline", "m", feetToMeters(10)),
      rear_setback: value("Civic-serving Seattle public rear setback baseline", "m", feetToMeters(10)),
      side_setback: value("Civic-serving Seattle public side setback baseline", "m", feetToMeters(15)),
      setback: value("Civic-serving Seattle public representative setback", "m", feetToMeters(10)),
    },
    {
      land_use_zoning: value("Seattle civic-serving public proxy", "", "NC3-55 civic proxy"),
      special_zones: value(
        "Seattle public and institutional entitlements often follow zone-specific overlays or institutional rules; pilot uses an NC3-55 civic-serving urban baseline for runtime checks.",
        "",
        "Seattle public proxy baseline",
      ),
    },
    {
      open_space: value("Residential amenity area in commercial zones", "%", 5),
    },
  ),
];

const USA_ZONING_BASELINES: Record<PilotCity, RegulationData[]> = {
  Austin: AUSTIN_ZONING_BASELINES,
  Phoenix: PHOENIX_ZONING_BASELINES,
  Seattle: SEATTLE_ZONING_BASELINES,
};

function findCityMatch(location?: string | null): PilotCity | null {
  if (!location) return null;

  const normalized = location.trim().toLowerCase();
  for (const city of Object.keys(USA_ZONING_BASELINES) as PilotCity[]) {
    if (normalized === city.toLowerCase() || normalized.includes(city.toLowerCase())) {
      return city;
    }
  }

  return null;
}

export function getUsaZoningBaselines(location?: string | null): RegulationData[] {
  const city = findCityMatch(location);
  if (!city) return [];

  return USA_ZONING_BASELINES[city].map((regulation) => ({
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

export function mergeUsaZoningBaselines(
  location: string | null | undefined,
  regulations: RegulationData[],
): RegulationData[] {
  const baselines = getUsaZoningBaselines(location);
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

