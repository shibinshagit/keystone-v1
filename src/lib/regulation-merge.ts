import type { RegulationData, RegulationValue } from "@/lib/types";

type RegulationSection = Record<string, RegulationValue>;

function hasMeaningfulScalar(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasMeaningfulRegulationValue(value?: RegulationValue) {
  if (!value) return false;

  return (
    hasMeaningfulScalar(value.value) ||
    hasMeaningfulScalar(value.min) ||
    hasMeaningfulScalar(value.max) ||
    hasMeaningfulScalar(value.exampleStr)
  );
}

function mergeRegulationValue(
  baseline?: RegulationValue,
  override?: RegulationValue,
): RegulationValue | undefined {
  if (!baseline) return override;
  if (!override) return baseline;
  if (!hasMeaningfulRegulationValue(override)) return baseline;

  const mergedValue =
    typeof baseline.value === "string" &&
    baseline.value.trim().length > 0 &&
    typeof override.value === "number"
      ? baseline.value
      : hasMeaningfulScalar(override.value)
        ? override.value
        : baseline.value;

  return {
    ...baseline,
    ...override,
    value: mergedValue,
    min: hasMeaningfulScalar(override.min) ? override.min : baseline.min,
    max: hasMeaningfulScalar(override.max) ? override.max : baseline.max,
    exampleStr: hasMeaningfulScalar(override.exampleStr)
      ? override.exampleStr
      : baseline.exampleStr,
    desc: hasMeaningfulScalar(override.desc) ? override.desc : baseline.desc,
    unit: hasMeaningfulScalar(override.unit) ? override.unit : baseline.unit,
  };
}

export function mergeRegulationSection(
  baselineSection: RegulationSection = {},
  overrideSection: RegulationSection = {},
): RegulationSection {
  const merged: RegulationSection = { ...baselineSection };

  for (const [key, overrideValue] of Object.entries(overrideSection)) {
    merged[key] = mergeRegulationValue(merged[key], overrideValue) ?? overrideValue;
  }

  return merged;
}

function mergeCodeFamily(
  baselineCodeFamily?: string,
  overrideCodeFamily?: string,
) {
  const baseline = baselineCodeFamily?.trim();
  const override = overrideCodeFamily?.trim();

  if (!baseline) return overrideCodeFamily;
  if (!override) return baselineCodeFamily;
  if (baseline === override) return baseline;
  if (override.toLowerCase() === "city zoning baseline") return baseline;
  if (baseline.toLowerCase().includes(override.toLowerCase())) return baseline;
  if (override.toLowerCase().includes(baseline.toLowerCase())) return override;

  return `${baseline} + ${override}`;
}

export function mergeRegulationRecords(
  baseline: RegulationData,
  override: RegulationData,
): RegulationData {
  return {
    ...baseline,
    ...override,
    codeFamily: mergeCodeFamily(baseline.codeFamily, override.codeFamily),
    geometry: mergeRegulationSection(baseline.geometry, override.geometry),
    highrise: mergeRegulationSection(baseline.highrise, override.highrise),
    facilities: mergeRegulationSection(baseline.facilities, override.facilities),
    sustainability: mergeRegulationSection(
      baseline.sustainability,
      override.sustainability,
    ),
    safety_and_services: mergeRegulationSection(
      baseline.safety_and_services,
      override.safety_and_services,
    ),
    administration: mergeRegulationSection(
      baseline.administration,
      override.administration,
    ),
  };
}
