export type LandConversionCategory =
  | "agricultural"
  | "residential"
  | "commercial"
  | "industrial"
  | "mixed-use"
  | "institutional"
  | "open-space";

export type LandConversionRating =
  | "allowed"
  | "common"
  | "conditional"
  | "restricted"
  | "rare"
  | "rare-restricted"
  | "highly-restricted";

export type LandConversionMarket = "India" | "USA";

export interface LandConversionCell {
  label: string;
  tone: "good" | "caution" | "risk";
}

export const LAND_CONVERSION_CATEGORIES: Array<{
  id: LandConversionCategory;
  label: string;
}> = [
  { id: "agricultural", label: "Agricultural" },
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial" },
  { id: "industrial", label: "Industrial" },
  { id: "mixed-use", label: "Mixed Use" },
  { id: "institutional", label: "Institutional" },
  { id: "open-space", label: "Open Space" },
];

const CELL_META: Record<LandConversionRating, LandConversionCell> = {
  allowed: { label: "Allowed", tone: "good" },
  common: { label: "Common", tone: "good" },
  conditional: { label: "Conditional", tone: "caution" },
  restricted: { label: "Restricted", tone: "risk" },
  rare: { label: "Rare", tone: "risk" },
  "rare-restricted": { label: "Rare / Restricted", tone: "risk" },
  "highly-restricted": { label: "Highly Restricted", tone: "risk" },
};

type LandConversionMatrix = Record<
  LandConversionCategory,
  Record<LandConversionCategory, LandConversionRating | null>
>;

const INDIA_CONVERSION_MATRIX: LandConversionMatrix = {
  agricultural: {
    agricultural: null,
    residential: "conditional",
    commercial: "conditional",
    industrial: "conditional",
    "mixed-use": "conditional",
    institutional: "conditional",
    "open-space": "conditional",
  },
  residential: {
    agricultural: "rare",
    residential: null,
    commercial: "conditional",
    industrial: "rare-restricted",
    "mixed-use": "common",
    institutional: "conditional",
    "open-space": "conditional",
  },
  commercial: {
    agricultural: "rare",
    residential: "conditional",
    commercial: null,
    industrial: "conditional",
    "mixed-use": "common",
    institutional: "conditional",
    "open-space": "rare",
  },
  industrial: {
    agricultural: "rare",
    residential: "rare-restricted",
    commercial: "conditional",
    industrial: null,
    "mixed-use": "conditional",
    institutional: "conditional",
    "open-space": "rare",
  },
  "mixed-use": {
    agricultural: "rare",
    residential: "allowed",
    commercial: "allowed",
    industrial: "restricted",
    "mixed-use": null,
    institutional: "allowed",
    "open-space": "conditional",
  },
  institutional: {
    agricultural: "rare",
    residential: "conditional",
    commercial: "conditional",
    industrial: "rare",
    "mixed-use": "conditional",
    institutional: null,
    "open-space": "conditional",
  },
  "open-space": {
    agricultural: "highly-restricted",
    residential: "rare",
    commercial: "rare",
    industrial: "rare",
    "mixed-use": "rare",
    institutional: "conditional",
    "open-space": null,
  },
};

const USA_CONVERSION_MATRIX: LandConversionMatrix = {
  agricultural: {
    agricultural: null,
    residential: "common",
    commercial: "conditional",
    industrial: "conditional",
    "mixed-use": "conditional",
    institutional: "conditional",
    "open-space": "common",
  },
  residential: {
    agricultural: "rare",
    residential: null,
    commercial: "conditional",
    industrial: "rare",
    "mixed-use": "common",
    institutional: "conditional",
    "open-space": "conditional",
  },
  commercial: {
    agricultural: "rare",
    residential: "conditional",
    commercial: null,
    industrial: "conditional",
    "mixed-use": "common",
    institutional: "conditional",
    "open-space": "rare",
  },
  industrial: {
    agricultural: "rare",
    residential: "rare",
    commercial: "conditional",
    industrial: null,
    "mixed-use": "conditional",
    institutional: "conditional",
    "open-space": "rare",
  },
  "mixed-use": {
    agricultural: "rare",
    residential: "allowed",
    commercial: "allowed",
    industrial: "restricted",
    "mixed-use": null,
    institutional: "allowed",
    "open-space": "conditional",
  },
  institutional: {
    agricultural: "rare",
    residential: "conditional",
    commercial: "conditional",
    industrial: "rare",
    "mixed-use": "conditional",
    institutional: null,
    "open-space": "conditional",
  },
  "open-space": {
    agricultural: "highly-restricted",
    residential: "rare",
    commercial: "rare",
    industrial: "rare",
    "mixed-use": "rare",
    institutional: "conditional",
    "open-space": null,
  },
};

const FALLBACK_CELL: LandConversionCell = {
  label: "Unavailable",
  tone: "risk",
};

export function getLandConversionMatrix(market: LandConversionMarket): LandConversionMatrix {
  return market === "USA" ? USA_CONVERSION_MATRIX : INDIA_CONVERSION_MATRIX;
}

export function getLandConversionCell(
  market: LandConversionMarket,
  from: LandConversionCategory,
  to: LandConversionCategory,
): LandConversionCell {
  const rating = getLandConversionMatrix(market)[from][to];
  return rating ? CELL_META[rating] : { label: "—", tone: "good" };
}

export function normalizeLandConversionCategory(value: string | null | undefined): LandConversionCategory | null {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;
  if (normalized.includes("mixed")) return "mixed-use";
  if (normalized.includes("institution") || normalized.includes("school") || normalized.includes("hospital") || normalized.includes("civic")) return "institutional";
  if (normalized.includes("industrial") || normalized.includes("manufacturing") || normalized.includes("warehouse")) return "industrial";
  if (normalized.includes("commercial") || normalized.includes("retail") || normalized.includes("office") || normalized.includes("business") || normalized.includes("hospitality")) return "commercial";
  if (normalized.includes("residential") || normalized.includes("housing") || normalized.includes("urban") || normalized.includes("built up") || normalized.includes("settlement")) return "residential";
  if (normalized.includes("agric")) return "agricultural";
  if (normalized.includes("open space") || normalized.includes("protected") || normalized.includes("recreational") || normalized.includes("park") || normalized.includes("wetland") || normalized.includes("water") || normalized.includes("forest")) return "open-space";

  return null;
}

export function getLandConversionFallbackCell(label?: string | null): LandConversionCell {
  return label ? { label, tone: "caution" } : FALLBACK_CELL;
}
