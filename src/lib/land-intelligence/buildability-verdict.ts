import type { BuildingIntendedUse, LandZoningPreference, RegulationData } from "@/lib/types";

export interface BhuvanLayerSummary {
  layerLabel: string;
  landUseType: string;
}

export interface BhuvanLandUseSummary {
  primaryLandUse: string;
  historicLandUseChange?: string;
  stateCode: string;
  layers: BhuvanLayerSummary[];
}

export interface BuildabilityVerdict {
  status: "can-build" | "conditional" | "cannot-build";
  title: string;
  summary: string;
  suggestedAction: string;
  confidence: "high" | "medium" | "low";
  confidenceSummary: string;
  reasons: string[];
  signals: string[];
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function mapIntendedUseToCategory(intendedUse: BuildingIntendedUse | string): string {
  const value = normalizeText(intendedUse);

  if (includesAny(value, ["retail", "office", "commercial", "hospitality"])) {
    return "urban";
  }
  if (value.includes("mixed")) return "mixed";
  if (value.includes("industrial")) return "industrial";
  if (includesAny(value, ["public", "institution", "utility"])) return "civic";
  return "residential";
}

function mapPreferenceToCategory(
  zoningPreference: LandZoningPreference | string,
): string {
  const value = normalizeText(zoningPreference);
  if (value.includes("agric")) return "agricultural";
  if (value.includes("waste")) return "waste";
  if (value.includes("mixed")) return "mixed";
  if (value.includes("industrial")) return "industrial";
  return "built-up";
}

function mapBhuvanToCategory(primaryLandUse: string): string {
  const value = normalizeText(primaryLandUse);

  if (includesAny(value, ["water", "river", "lake", "wetland", "reservoir", "drain"])) {
    return "water";
  }
  if (includesAny(value, ["forest", "mangrove", "protected", "eco", "sanctuary"])) {
    return "protected";
  }
  if (includesAny(value, ["industrial", "factory", "manufacturing"])) {
    return "industrial";
  }
  if (includesAny(value, ["waste", "scrub", "barren", "rocky"])) {
    return "waste";
  }
  if (includesAny(value, ["agric", "crop", "plantation", "fallow", "orchard", "farm"])) {
    return "agricultural";
  }
  if (includesAny(value, ["built", "settlement", "urban", "residential", "commercial"])) {
    return "built-up";
  }
  return "unknown";
}

function getRegulationFields(regulation: RegulationData | null) {
  const zone = regulation?.geometry?.land_use_zoning?.value;
  const landUseCategory = regulation?.geometry?.land_use_category?.value;
  const conversionStatus = regulation?.geometry?.conversion_status?.value;
  const specialZones = regulation?.geometry?.special_zones?.value;

  return {
    zoneText: [zone, landUseCategory].filter(Boolean).map(normalizeText).join(" | "),
    conversionText: normalizeText(conversionStatus),
    specialZoneText: normalizeText(specialZones),
    zoneDisplay: zone ? String(zone) : landUseCategory ? String(landUseCategory) : null,
    conversionDisplay: conversionStatus ? String(conversionStatus) : null,
  };
}

function regulationAllowsUse(regulation: RegulationData | null, intendedUse: BuildingIntendedUse | string) {
  if (!regulation) return false;

  const intended = normalizeText(intendedUse);
  const category = mapIntendedUseToCategory(intendedUse);
  const regType = normalizeText(regulation.type);
  const { zoneText } = getRegulationFields(regulation);
  const haystack = `${regType} ${zoneText}`.trim();

  if (!haystack) return false;
  if (haystack.includes(intended)) return true;

  if (category === "residential") return includesAny(haystack, ["residential", "housing", "group housing"]);
  if (category === "urban") return includesAny(haystack, ["commercial", "retail", "office", "business", "hospitality", "mixed"]);
  if (category === "mixed") return includesAny(haystack, ["mixed", "commercial", "residential"]);
  if (category === "industrial") return includesAny(haystack, ["industrial", "warehouse", "logistics"]);
  if (category === "civic") return includesAny(haystack, ["public", "institution", "utility", "hospital", "school", "civic"]);

  return false;
}

function regulationBlocksUse(regulation: RegulationData | null) {
  if (!regulation) return false;
  const { specialZoneText, zoneText } = getRegulationFields(regulation);
  const haystack = `${specialZoneText} ${zoneText}`.trim();

  return includesAny(haystack, [
    "eco sensitive",
    "protected",
    "coastal regulation",
    "crz",
    "heritage",
    "no development",
    "green belt",
  ]);
}

function canPotentiallyConvert(regulation: RegulationData | null) {
  if (!regulation) return false;
  const { conversionText } = getRegulationFields(regulation);

  if (!conversionText) return false;
  if (includesAny(conversionText, ["not allowed", "not permitted", "prohibited"])) {
    return false;
  }

  return includesAny(conversionText, [
    "allowed",
    "permitted",
    "possible",
    "convert",
    "conversion",
    "clu",
    "change of land use",
    "approval",
  ]);
}

export function evaluateBuildabilityVerdict({
  intendedUse,
  zoningPreference,
  bhuvan,
  regulation,
  regulationSource,
}: {
  intendedUse: BuildingIntendedUse | string;
  zoningPreference: LandZoningPreference | string;
  bhuvan: BhuvanLandUseSummary | null;
  regulation: RegulationData | null;
  regulationSource?: string | null;
}): BuildabilityVerdict {
  const reasons: string[] = [];
  const signals: string[] = [];
  const intendedCategory = mapIntendedUseToCategory(intendedUse);
  const preferenceCategory = mapPreferenceToCategory(zoningPreference);
  const bhuvanCategory = mapBhuvanToCategory(bhuvan?.primaryLandUse || "");
  const regulationPermits = regulationAllowsUse(regulation, intendedUse);
  const regulationBlocked = regulationBlocksUse(regulation);
  const convertible = canPotentiallyConvert(regulation);
  const { zoneDisplay, conversionDisplay } = getRegulationFields(regulation);
  const isNationalFallback = regulationSource === "national-fallback";
  const hasLocalRegulation =
    regulationSource === "specific-id" ||
    regulationSource === "generic-id" ||
    regulationSource === "location-query";
  const hasExplicitZoningRule = Boolean(zoneDisplay);

  signals.push(`Bhuvan land use: ${bhuvan?.primaryLandUse || "Unavailable"}`);
  signals.push(`Matched zoning: ${zoneDisplay || "Unavailable"}`);
  if (conversionDisplay) signals.push(`Conversion status: ${conversionDisplay}`);
  if (bhuvan?.historicLandUseChange) {
    signals.push(`Historic change: ${bhuvan.historicLandUseChange}`);
  }
  if (regulationSource) signals.push(`Rule source: ${regulationSource}`);

  if (bhuvanCategory === "built-up") {
    reasons.push("Bhuvan classifies the plot as built-up / urban land.");
  } else if (bhuvanCategory === "agricultural") {
    reasons.push("Bhuvan indicates agricultural land use, so direct development is risky without land-use conversion.");
  } else if (bhuvanCategory === "waste") {
    reasons.push("Bhuvan indicates wasteland / barren land, so additional land-use and site clearance checks are likely required.");
  } else if (bhuvanCategory === "industrial") {
    reasons.push("Bhuvan indicates industrial land use, so non-industrial development may require conversion or a different zoning basis.");
  } else if (bhuvanCategory === "water" || bhuvanCategory === "protected") {
    reasons.push("Bhuvan indicates a protected or water-related land class, which is a strong blocker for normal construction.");
  } else {
    reasons.push("Bhuvan land use could not be mapped confidently, so this verdict needs manual zoning confirmation.");
  }

  if (preferenceCategory === "built-up" && bhuvanCategory === "built-up") {
    reasons.push("The chosen zoning preference aligns with the current Bhuvan classification.");
  } else if (preferenceCategory === bhuvanCategory) {
    reasons.push("The chosen zoning preference aligns with the current Bhuvan land-use category.");
  } else {
    reasons.push("The chosen zoning preference does not fully align with the current Bhuvan classification.");
  }

  if (regulationPermits) {
    reasons.push(`The matched regulation record supports ${String(intendedUse)} use.`);
  } else if (regulation) {
    reasons.push("A regulation record was found, but it does not clearly confirm the intended use.");
  } else {
    reasons.push("No matching zoning rule was found in the regulation set.");
  }

  if (isNationalFallback) {
    reasons.push("The zoning rule is coming from a National (NBC) fallback, not a clearly matched local regulation.");
  } else if (hasLocalRegulation) {
    reasons.push("The verdict is backed by a location-matched regulation record.");
  }

  const hardBlock = regulationBlocked || bhuvanCategory === "water" || bhuvanCategory === "protected";
  const mismatchedLandUse =
    !["unknown", "built-up"].includes(bhuvanCategory) &&
    !(
      (intendedCategory === "industrial" && bhuvanCategory === "industrial") ||
      preferenceCategory === bhuvanCategory
    );

  if (hardBlock) {
    return {
      status: "cannot-build",
      title: "Cannot Build",
      summary: "Current zoning signals indicate a hard conflict for the selected use.",
      suggestedAction:
        "Do not treat this plot as directly buildable until the parcel boundary and statutory land-use status are formally confirmed.",
      confidence: "high",
      confidenceSummary:
        "High confidence because the land-use signal indicates a strong blocker such as protected / water class or an explicit no-development restriction.",
      reasons,
      signals,
    };
  }

  if (!bhuvan || !regulation || bhuvanCategory === "unknown") {
    return {
      status: "conditional",
      title: "Conditional / Manual Review",
      summary: "The plot cannot be cleared automatically because one or more zoning signals are missing or unclear.",
      suggestedAction:
        "Review the Bhuvan classification and attach a clearer zoning rule before treating this land as buildable.",
      confidence: "low",
      confidenceSummary:
        "Low confidence because one or more core inputs are missing, fallback-only, or not classifiable.",
      reasons,
      signals,
    };
  }

  if (
    regulationPermits &&
    !mismatchedLandUse &&
    (bhuvanCategory === "built-up" ||
      intendedCategory === bhuvanCategory ||
      preferenceCategory === bhuvanCategory)
  ) {
    if (isNationalFallback || !hasExplicitZoningRule) {
      return {
        status: "conditional",
        title: "Conditional / Local Zoning Needed",
        summary:
          "The current signals look favorable, but the zoning evidence is not specific enough to clear the plot as fully buildable.",
        suggestedAction:
          "Confirm a city- or locality-specific zoning record before treating this parcel as a clean buildable site.",
        confidence: "medium",
        confidenceSummary:
          "Medium confidence because the land-use signal is supportive, but the zoning evidence is fallback-based or too generic.",
        reasons,
        signals,
      };
    }

    return {
      status: "can-build",
      title: "Can Build",
      summary: "The intended use is supported by the current Bhuvan land-use signal and the matched zoning rule.",
      suggestedAction:
        "Proceed with the plot as buildable and keep this result as the pre-project zoning check.",
      confidence: "high",
      confidenceSummary:
        "High confidence because both Bhuvan land use and a location-matched zoning rule support the selected use.",
      reasons,
      signals,
    };
  }

  if (convertible || mismatchedLandUse || preferenceCategory !== bhuvanCategory) {
    return {
      status: "conditional",
      title: "Conditional / CLU Required",
      summary: "The plot may be developable, but the current land-use signal does not fully match the intended use.",
      suggestedAction:
        "Treat the plot as conditional until CLU / conversion approval or a stronger zoning confirmation is available.",
      confidence: isNationalFallback ? "low" : "medium",
      confidenceSummary: isNationalFallback
        ? "Low confidence because the available rule is only a national fallback and the current land-use signal does not fully align."
        : "Medium confidence because there is enough evidence to flag a mismatch, but not enough to call the parcel a hard no-build case.",
      reasons,
      signals,
    };
  }

  return {
    status: "cannot-build",
    title: "Cannot Build",
    summary: "The matched zoning rule does not support the selected intended use.",
    suggestedAction:
      "Choose a different intended use or verify whether the parcel falls under a different zoning regulation.",
    confidence: hasLocalRegulation ? "medium" : "low",
    confidenceSummary: hasLocalRegulation
      ? "Medium confidence because the available zoning rule does not support the selected use."
      : "Low confidence because the verdict is relying on incomplete or fallback zoning evidence.",
    reasons,
    signals,
  };
}
