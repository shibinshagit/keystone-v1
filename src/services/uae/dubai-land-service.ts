import { inferRegulationGeography } from "@/lib/geography";
import { MapboxPlacesService } from "@/services/mapbox-places-service";

export type DubaiLandIntegrationStatus =
  | "live"
  | "onboarding-required"
  | "unavailable";

export type DubaiPulseDatasetRuntimeStatus =
  | "live"
  | "missing-credentials"
  | "permission-required"
  | "no-match"
  | "skipped"
  | "error";

export interface DubaiLandOfficialLink {
  label: string;
  url: string;
  mode: "manual-service" | "open-data-page" | "business-api";
}

export interface DubaiLandDatasetStatus {
  datasetKey:
    | "transactions"
    | "saleIndex"
    | "landRegistry"
    | "units"
    | "buildings"
    | "projects"
    | "valuations";
  label: string;
  endpoint: string;
  sourceUrl: string;
  status: DubaiPulseDatasetRuntimeStatus;
  detail: string;
  matchedFilter?: string;
  recordCount?: number;
}

export interface DubaiLandOnboardingRequirement {
  label: string;
  detail: string;
  sourceUrl: string;
}

export interface DubaiLandIdentifierHints {
  titleDeedNumber?: string;
  titleDeedYear?: string;
  propertyType?: string;
  ownerName?: string;
  landNumber?: string;
  landSubNumber?: string;
  buildingNumber?: string;
  municipalityNumber?: string;
  municipalitySubNumber?: string;
  unitNumber?: string;
  propertyNumber?: string;
  projectNumber?: string;
  projectName?: string;
  makaniNumber?: string;
}

export interface DubaiLandVerificationChannel {
  mode: "manual-dld-service";
  status: "identifiers-required" | "official-page-available";
  detail: string;
  requiredFields: string[];
  availableIdentifiers: string[];
  officialUrl: string;
}

export interface DubaiLandTransactionSummary {
  sampleCount: number;
  salesCount: number;
  mortgagesCount: number;
  giftsCount: number;
  latestTransactionDate?: string;
  averageAmountAed?: number;
  averageSalePricePerSqm?: number;
  recentAreas: string[];
  recentProjects: string[];
}

export interface DubaiLandPriceIndexSummary {
  latestMonth?: string;
  latestMonthlyPriceIndex?: number;
  previousMonthlyPriceIndex?: number;
  monthlyChangePct?: number | null;
  latestYearlyPriceIndex?: number;
  previousYearlyPriceIndex?: number;
  yearlyChangePct?: number | null;
}

export interface DubaiLandValuationSummary {
  sampleCount: number;
  latestTransactionDate?: string;
  averagePropertyTotalValueAed?: number;
  averageTransactionAmountAed?: number;
  averagePropertySizeSqm?: number;
}

export interface DubaiLandLandRecord {
  propertyId?: string;
  landNumber?: string;
  landSubNumber?: string;
  municipalityNumber?: string;
  parcelId?: string;
  areaName?: string;
  zone?: string;
  landType?: string;
  propertyType?: string;
  propertySubType?: string;
  actualAreaSqm?: number;
  isFreeHold?: boolean | null;
  isRegistered?: boolean | null;
  preRegistrationNumber?: string;
  projectName?: string;
  masterProject?: string;
  zipCode?: string;
}

export interface DubaiLandUnitRecord {
  propertyId?: string;
  unitNumber?: string;
  buildingNumber?: string;
  landNumber?: string;
  landSubNumber?: string;
  municipalityNumber?: string;
  areaName?: string;
  propertyType?: string;
  propertySubType?: string;
  actualAreaSqm?: number;
  isFreeHold?: boolean | null;
  isLeaseHold?: boolean | null;
  preRegistrationNumber?: string;
  projectName?: string;
  masterProject?: string;
}

export interface DubaiLandBuildingRecord {
  propertyId?: string;
  buildingNumber?: string;
  landNumber?: string;
  landSubNumber?: string;
  areaName?: string;
  landType?: string;
  propertySubType?: string;
  builtUpAreaSqm?: number;
  buildingLevels?: number;
  parkingCount?: number;
  isFreeHold?: boolean | null;
  isRegistered?: boolean | null;
  preRegistrationNumber?: string;
  projectName?: string;
  masterProject?: string;
}

export interface DubaiLandProjectRecord {
  projectNumber?: string;
  projectName?: string;
  developerName?: string;
  projectStatus?: string;
  completedPct?: number;
  areaName?: string;
  zone?: string;
  authority?: string;
  totalLands?: number;
  totalBuildings?: number;
  totalVillas?: number;
  totalUnits?: number;
  masterProject?: string;
}

export interface DubaiLandContextResult {
  market: "UAE";
  emirate: "Dubai";
  integrationStatus: DubaiLandIntegrationStatus;
  summary: string;
  searchContext: {
    locationLabel: string;
    areaCandidates: string[];
    projectCandidates: string[];
    reverseGeocodedLabel?: string;
    identifiers: DubaiLandIdentifierHints;
  };
  transactions?: DubaiLandTransactionSummary;
  saleIndex?: DubaiLandPriceIndexSummary;
  valuations?: DubaiLandValuationSummary;
  landRecord?: DubaiLandLandRecord;
  unitRecord?: DubaiLandUnitRecord;
  buildingRecord?: DubaiLandBuildingRecord;
  projectRecord?: DubaiLandProjectRecord;
  titleDeedVerification: DubaiLandVerificationChannel;
  propertyStatus: DubaiLandVerificationChannel;
  projectStatus: DubaiLandVerificationChannel;
  datasetStatuses: DubaiLandDatasetStatus[];
  officialLinks: DubaiLandOfficialLink[];
  onboardingRequirements: DubaiLandOnboardingRequirement[];
}

export interface DubaiLandContextInput {
  location: string;
  rawLocation?: string;
  district?: string;
  coordinates?: [number, number];
}

interface DubaiPulseDatasetConfig {
  datasetKey: DubaiLandDatasetStatus["datasetKey"];
  label: string;
  endpoint: string;
  sourceUrl: string;
}

class DubaiPulseAccessError extends Error {
  constructor(
    message: string,
    public readonly kind: "permission-required" | "error",
  ) {
    super(message);
    this.name = "DubaiPulseAccessError";
  }
}

const DUBAI_PULSE_TOKEN_URL =
  "https://api.dubaipulse.gov.ae/oauth/client_credential/accesstoken?grant_type=client_credentials";

// These are the official DLD datasets currently exposed via Dubai Pulse.
// Access is not anonymous in practice: the app only queries them when
// approved client credentials are configured on the server.
const DATASET_CONFIG: Record<DubaiLandDatasetStatus["datasetKey"], DubaiPulseDatasetConfig> =
  {
    transactions: {
      datasetKey: "transactions",
      label: "DLD Transactions API",
      endpoint: "https://api.dubaipulse.gov.ae/open/dld/dld_transactions-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open-api",
    },
    saleIndex: {
      datasetKey: "saleIndex",
      label: "DLD Residential Sale Index API",
      endpoint:
        "https://api.dubaipulse.gov.ae/open/dld/dld_residential_sale_index-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-transactions/dld_residential_sale_index-open-api",
    },
    landRegistry: {
      datasetKey: "landRegistry",
      label: "DLD Land Registry API",
      endpoint:
        "https://api.dubaipulse.gov.ae/open/dld/dld_land_registry-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-registration/dld_land_registry-open-api",
    },
    units: {
      datasetKey: "units",
      label: "DLD Units API",
      endpoint: "https://api.dubaipulse.gov.ae/open/dld/dld_units-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-registration/dld_units-open-api",
    },
    buildings: {
      datasetKey: "buildings",
      label: "DLD Buildings API",
      endpoint: "https://api.dubaipulse.gov.ae/open/dld/dld_buildings-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-registration/dld_buildings-open-api",
    },
    projects: {
      datasetKey: "projects",
      label: "DLD Projects API",
      endpoint: "https://api.dubaipulse.gov.ae/open/dld/dld_projects-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-registration/dld_projects-open-api",
    },
    valuations: {
      datasetKey: "valuations",
      label: "DLD Valuations API",
      endpoint: "https://api.dubaipulse.gov.ae/open/dld/dld_valuation-open-api",
      sourceUrl:
        "https://www.dubaipulse.gov.ae/data/dld-valuations/dld_valuation-open-api",
    },
  };

const OFFICIAL_LINKS: DubaiLandOfficialLink[] = [
  {
    label: "DLD API Gateway",
    url: "https://dubailand.gov.ae/en/eservices/api-gateway/",
    mode: "business-api",
  },
  {
    label: "DLD Real Estate Data",
    url: "https://dubailand.gov.ae/en/open-data/real-estate-data/",
    mode: "manual-service",
  },
  {
    label: "DLD Verify Title Deed",
    url: "https://dubailand.gov.ae/en/eservices/title-deed-verification-overview/title-deed-verification",
    mode: "manual-service",
  },
  {
    label: "DLD Property Status Enquiry",
    url: "https://dubailand.gov.ae/en/eservices/property-status-overview/property-status",
    mode: "manual-service",
  },
  {
    label: "DLD Project Status Enquiry",
    url: "https://dubailand.gov.ae/en/eservices/real-estate-project-status-landing/?r=1",
    mode: "manual-service",
  },
  {
    label: "Dubai Pulse - Transactions",
    url: "https://www.dubaipulse.gov.ae/data/dld-transactions/dld_transactions-open-api",
    mode: "open-data-page",
  },
  {
    label: "Dubai Pulse - Land Registry",
    url: "https://www.dubaipulse.gov.ae/data/dld-registration/dld_land_registry-open-api",
    mode: "open-data-page",
  },
];

const ONBOARDING_REQUIREMENTS: DubaiLandOnboardingRequirement[] = [
  {
    label: "DLD business APIs are commercial and account-gated",
    detail:
      "The official DLD API Gateway lists subscription products with business-account prerequisites and AED 30,000 + 5% VAT yearly pricing on the public gateway page.",
    sourceUrl: "https://dubailand.gov.ae/en/eservices/api-gateway/",
  },
  {
    label: "Dubai Pulse APIs require dataset permission plus OAuth credentials",
    detail:
      "The official Dubai Pulse dataset pages state that users receive an API Key and API Secret after dataset grant / purchase, then must obtain a bearer token via the OAuth client-credentials endpoint.",
    sourceUrl:
      "https://www.dubaipulse.gov.ae/data/dld-registration/dld_units-open-api",
  },
  {
    label: "Title deed and property-status verification remain manual official services",
    detail:
      "The official DLD verification pages are available on the website and Dubai REST app, but they rely on interactive fields such as captcha and title-deed / property identifiers rather than a public server API.",
    sourceUrl:
      "https://dubailand.gov.ae/en/eservices/title-deed-verification-overview/title-deed-verification",
  },
];

let cachedAccessToken:
  | {
      accessToken: string;
      expiresAtMs: number;
    }
  | null = null;

function uniqueStrings(values: Array<string | undefined | null>) {
  return values.filter((value, index, list): value is string => {
    if (!value) return false;
    const normalized = value.trim();
    if (!normalized) return false;
    return (
      list.findIndex((candidate) => candidate?.trim().toLowerCase() === normalized.toLowerCase()) ===
      index
    );
  });
}

function toSafeString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[, ]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toBooleanFlag(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = toNumber(value);
  if (numeric !== undefined) return numeric === 1;
  const normalized = String(value).trim().toLowerCase();
  if (["yes", "true", "y"].includes(normalized)) return true;
  if (["no", "false", "n"].includes(normalized)) return false;
  return null;
}

function toIsoDate(value: unknown): string | undefined {
  const text = toSafeString(value);
  if (!text) return undefined;
  if (/^\d{2}-\d{2}-\d{4}$/.test(text)) {
    const [day, month, year] = text.split("-");
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function readField(record: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(record);
  for (const name of names) {
    if (name in record) return record[name];
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match) return match[1];
  }
  return undefined;
}

function escapeFilterValue(value: string) {
  return value.replace(/'/g, "''");
}

function buildStringFilter(field: string, value: string) {
  return `${field}='${escapeFilterValue(value)}'`;
}

function average(values: Array<number | undefined>) {
  const filtered = values.filter((value): value is number => value !== undefined);
  if (filtered.length === 0) return undefined;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function percentChange(current?: number, previous?: number) {
  if (
    current === undefined ||
    previous === undefined ||
    previous === 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function getConfiguredCredentials() {
  const clientId = process.env.DUBAI_PULSE_CLIENT_ID?.trim();
  const clientSecret = process.env.DUBAI_PULSE_CLIENT_SECRET?.trim();
  return {
    clientId: clientId || null,
    clientSecret: clientSecret || null,
  };
}

async function fetchJsonLoose(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload).slice(0, 240);
    if (response.status === 401 || response.status === 403) {
      throw new DubaiPulseAccessError(
        `Dubai Pulse rejected the request (${response.status}). ${detail}`,
        "permission-required",
      );
    }
    throw new DubaiPulseAccessError(
      `Dubai Pulse request failed (${response.status}). ${detail}`,
      "error",
    );
  }

  return payload;
}

async function getDubaiPulseAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAtMs - 60_000) {
    return cachedAccessToken.accessToken;
  }

  const { clientId, clientSecret } = getConfiguredCredentials();
  if (!clientId || !clientSecret) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  // Dubai Pulse uses a client-credentials OAuth exchange after the dataset
  // owner grants the account API access.
  const payload = (await fetchJsonLoose(DUBAI_PULSE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })) as Record<string, unknown> | null;

  const accessToken = toSafeString((payload || {}).access_token);
  if (!accessToken) {
    throw new DubaiPulseAccessError(
      "Dubai Pulse token response did not include an access_token.",
      "error",
    );
  }

  const expiresInSeconds = toNumber((payload || {}).expires_in) || 1800;
  cachedAccessToken = {
    accessToken,
    expiresAtMs: Date.now() + expiresInSeconds * 1000,
  };

  return accessToken;
}

function extractRecords(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const value = payload as Record<string, unknown>;
  const recordKeys = ["records", "result", "results", "data", "items"];
  for (const key of recordKeys) {
    const direct = value[key];
    if (Array.isArray(direct)) {
      return direct.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      );
    }

    if (direct && typeof direct === "object" && Array.isArray((direct as any).records)) {
      return (direct as any).records.filter(
        (item: unknown): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      );
    }
  }

  return [];
}

async function queryDatasetRecords(
  accessToken: string,
  config: DubaiPulseDatasetConfig,
  options: {
    filter?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
  } = {},
) {
  const url = new URL(config.endpoint);
  if (options.filter) url.searchParams.set("filter", options.filter);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.offset) url.searchParams.set("offset", String(options.offset));
  if (options.orderBy) url.searchParams.set("order_by", options.orderBy);

  try {
    const payload = await fetchJsonLoose(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return extractRecords(payload);
  } catch (error) {
    if (options.orderBy) {
      const fallbackUrl = new URL(config.endpoint);
      if (options.filter) fallbackUrl.searchParams.set("filter", options.filter);
      if (options.limit) fallbackUrl.searchParams.set("limit", String(options.limit));
      if (options.offset) fallbackUrl.searchParams.set("offset", String(options.offset));
      const payload = await fetchJsonLoose(fallbackUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return extractRecords(payload);
    }
    throw error;
  }
}

async function queryWithFilterFallbacks(
  accessToken: string | null,
  config: DubaiPulseDatasetConfig,
  filters: string[],
  options: {
    limit?: number;
    orderBy?: string;
    allowUnfiltered?: boolean;
    credentialsConfigured?: boolean;
    accessFailureDetail?: string | null;
  } = {},
): Promise<{
  records: Array<Record<string, unknown>>;
  datasetStatus: DubaiLandDatasetStatus;
}> {
  // We intentionally report "missing-credentials" vs "permission-required"
  // separately so the UI can distinguish local setup gaps from real onboarding
  // or commercial-access blockers on the Dubai side.
  if (!accessToken) {
    return {
      records: [],
      datasetStatus: {
        datasetKey: config.datasetKey,
        label: config.label,
        endpoint: config.endpoint,
        sourceUrl: config.sourceUrl,
        status:
          options.credentialsConfigured && options.accessFailureDetail
            ? "permission-required"
            : "missing-credentials",
        detail:
          options.credentialsConfigured && options.accessFailureDetail
            ? options.accessFailureDetail
            : "DUBAI_PULSE_CLIENT_ID / DUBAI_PULSE_CLIENT_SECRET are not configured, so the official Dubai Pulse API cannot be queried from the server.",
      },
    };
  }

  const candidateFilters =
    filters.length > 0
      ? filters
      : options.allowUnfiltered
        ? [""]
        : [];

  if (candidateFilters.length === 0) {
    return {
      records: [],
      datasetStatus: {
        datasetKey: config.datasetKey,
        label: config.label,
        endpoint: config.endpoint,
        sourceUrl: config.sourceUrl,
        status: "skipped",
        detail: "No reliable Dubai area / project identifiers were available for this dataset query.",
      },
    };
  }

  let lastError: unknown = null;
  for (const filter of candidateFilters) {
    try {
      const records = await queryDatasetRecords(accessToken, config, {
        filter: filter || undefined,
        limit: options.limit || 10,
        orderBy: options.orderBy,
      });

      if (records.length > 0) {
        return {
          records,
          datasetStatus: {
            datasetKey: config.datasetKey,
            label: config.label,
            endpoint: config.endpoint,
            sourceUrl: config.sourceUrl,
            status: "live",
            detail: "Official Dubai Pulse dataset returned matching records.",
            matchedFilter: filter || undefined,
            recordCount: records.length,
          },
        };
      }
    } catch (error) {
      lastError = error;
      if (error instanceof DubaiPulseAccessError && error.kind === "permission-required") {
        return {
          records: [],
          datasetStatus: {
            datasetKey: config.datasetKey,
            label: config.label,
            endpoint: config.endpoint,
            sourceUrl: config.sourceUrl,
            status: "permission-required",
            detail:
              "The official endpoint rejected the request. This usually means the Dubai Pulse dataset grant or business onboarding is still missing for these credentials.",
            matchedFilter: filter || undefined,
          },
        };
      }
    }
  }

  if (lastError) {
    return {
      records: [],
      datasetStatus: {
        datasetKey: config.datasetKey,
        label: config.label,
        endpoint: config.endpoint,
        sourceUrl: config.sourceUrl,
        status: "error",
        detail:
          lastError instanceof Error
            ? lastError.message
            : "Unknown Dubai Pulse query error.",
      },
    };
  }

  return {
    records: [],
    datasetStatus: {
      datasetKey: config.datasetKey,
      label: config.label,
      endpoint: config.endpoint,
      sourceUrl: config.sourceUrl,
      status: "no-match",
      detail:
        "The official dataset is reachable, but no matching records were found for the current Dubai search criteria.",
    },
  };
}

function parseIdentifierHints(text: string): DubaiLandIdentifierHints {
  const compact = text.replace(/\s+/g, " ").trim();
  const get = (pattern: RegExp) => compact.match(pattern)?.[1]?.trim();

  return {
    titleDeedNumber: get(/title deed(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    titleDeedYear: get(/title deed year[:# ]+(\d{4})/i),
    propertyType: get(/property type[:# ]+([A-Za-z ]+)/i),
    ownerName: get(/owner[:# ]+([A-Za-z .'-]+)/i),
    landNumber: get(/land(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    landSubNumber: get(/sub land(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    buildingNumber: get(/building(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    municipalityNumber: get(/municipality(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    municipalitySubNumber: get(/municipality sub(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    unitNumber: get(/unit(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    propertyNumber: get(/property(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    projectNumber: get(/project(?: no\.?| number)?[:# ]+([A-Za-z0-9-]+)/i),
    projectName: get(/project name[:# ]+([A-Za-z0-9 '&-]+)/i),
    makaniNumber: get(/makani(?: no\.?| number)?[:# ]+([\d ]{5,})/i)?.replace(/\s+/g, ""),
  };
}

function buildAreaCandidates(input: DubaiLandContextInput, reverseLabel?: string) {
  // DLD datasets are queried most reliably with area / project names or
  // explicit land-unit identifiers. We derive lightweight candidates from the
  // user search string and reverse-geocoded label rather than guessing exact IDs.
  const baseText = [input.rawLocation, input.district, input.location, reverseLabel]
    .filter(Boolean)
    .join(", ");

  const parts = baseText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) =>
        !/^(dubai|uae|united arab emirates|deira|emirate of dubai)$/i.test(part),
    );

  return uniqueStrings(parts);
}

function buildProjectCandidates(
  identifiers: DubaiLandIdentifierHints,
  input: DubaiLandContextInput,
) {
  const locationParts = [input.rawLocation, input.location]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.split(" ").length >= 2);

  return uniqueStrings([identifiers.projectName, ...locationParts]);
}

function buildAvailableIdentifiers(identifiers: DubaiLandIdentifierHints, fields: string[]) {
  return fields.filter((field) => {
    const value = (identifiers as Record<string, unknown>)[field];
    return toSafeString(value) !== undefined;
  });
}

function buildVerificationChannel(args: {
  detail: string;
  requiredFields: string[];
  officialUrl: string;
  identifiers: DubaiLandIdentifierHints;
}) {
  const availableIdentifiers = buildAvailableIdentifiers(
    args.identifiers,
    args.requiredFields,
  );

  return {
    mode: "manual-dld-service" as const,
    status:
      availableIdentifiers.length > 0
        ? ("official-page-available" as const)
        : ("identifiers-required" as const),
    detail: args.detail,
    requiredFields: args.requiredFields,
    availableIdentifiers,
    officialUrl: args.officialUrl,
  };
}

function normalizeTransactionSummary(records: Array<Record<string, unknown>>): DubaiLandTransactionSummary | undefined {
  if (records.length === 0) return undefined;

  const sales = records.filter((record) =>
    /sale/i.test(String(readField(record, ["trans_group_en", "procedure_name_en"]) || "")),
  );
  const mortgages = records.filter((record) =>
    /mortgage/i.test(String(readField(record, ["trans_group_en", "procedure_name_en"]) || "")),
  );
  const gifts = records.filter((record) =>
    /gift/i.test(String(readField(record, ["trans_group_en", "procedure_name_en"]) || "")),
  );

  return {
    sampleCount: records.length,
    salesCount: sales.length,
    mortgagesCount: mortgages.length,
    giftsCount: gifts.length,
    latestTransactionDate: toIsoDate(readField(records[0], ["instance_date"])),
    averageAmountAed: average(records.map((record) => toNumber(readField(record, ["actual_worth"])))),
    averageSalePricePerSqm: average(
      sales.map((record) => toNumber(readField(record, ["meter_sale_price"]))),
    ),
    recentAreas: uniqueStrings(
      records.slice(0, 5).map((record) => toSafeString(readField(record, ["area_name_en"]))),
    ),
    recentProjects: uniqueStrings(
      records
        .slice(0, 5)
        .map((record) => toSafeString(readField(record, ["project_name_en", "project_name"]))),
    ),
  };
}

function normalizeSaleIndex(records: Array<Record<string, unknown>>): DubaiLandPriceIndexSummary | undefined {
  if (records.length === 0) return undefined;
  const [latest, previous] = records;
  const latestMonthlyPriceIndex = toNumber(
    readField(latest, ["all_monthly_price_index", "flat_monthly_price_index"]),
  );
  const previousMonthlyPriceIndex = previous
    ? toNumber(readField(previous, ["all_monthly_price_index", "flat_monthly_price_index"]))
    : undefined;
  const latestYearlyPriceIndex = toNumber(
    readField(latest, ["all_yearly_price_index", "flat_yearly_price_index"]),
  );
  const previousYearlyPriceIndex = previous
    ? toNumber(readField(previous, ["all_yearly_price_index", "flat_yearly_price_index"]))
    : undefined;

  return {
    latestMonth: toIsoDate(readField(latest, ["first_date_of_month"])),
    latestMonthlyPriceIndex,
    previousMonthlyPriceIndex,
    monthlyChangePct: percentChange(latestMonthlyPriceIndex, previousMonthlyPriceIndex),
    latestYearlyPriceIndex,
    previousYearlyPriceIndex,
    yearlyChangePct: percentChange(latestYearlyPriceIndex, previousYearlyPriceIndex),
  };
}

function normalizeValuationSummary(records: Array<Record<string, unknown>>): DubaiLandValuationSummary | undefined {
  if (records.length === 0) return undefined;
  return {
    sampleCount: records.length,
    latestTransactionDate: toIsoDate(readField(records[0], ["instance_date"])),
    averagePropertyTotalValueAed: average(
      records.map((record) => toNumber(readField(record, ["property_total_value"]))),
    ),
    averageTransactionAmountAed: average(
      records.map((record) => toNumber(readField(record, ["actual_worth"]))),
    ),
    averagePropertySizeSqm: average(
      records.map((record) => toNumber(readField(record, ["actual_area"]))),
    ),
  };
}

function normalizeLandRecord(record?: Record<string, unknown>): DubaiLandLandRecord | undefined {
  if (!record) return undefined;
  return {
    propertyId: toSafeString(readField(record, ["property_id"])),
    landNumber: toSafeString(readField(record, ["land_number"])),
    landSubNumber: toSafeString(readField(record, ["land_sub_number"])),
    municipalityNumber: toSafeString(readField(record, ["munc_number", "municipality_number"])),
    parcelId: toSafeString(readField(record, ["parcel_id"])),
    areaName: toSafeString(readField(record, ["area_name_en"])),
    zone: toSafeString(readField(record, ["zone", "zone_en", "zone_id"])),
    landType: toSafeString(readField(record, ["land_type_en"])),
    propertyType: toSafeString(readField(record, ["property_type_en"])),
    propertySubType: toSafeString(readField(record, ["property_sub_type_en"])),
    actualAreaSqm: toNumber(readField(record, ["actual_area"])),
    isFreeHold: toBooleanFlag(readField(record, ["is_free_hold"])),
    isRegistered: toBooleanFlag(readField(record, ["is_registered"])),
    preRegistrationNumber: toSafeString(readField(record, ["pre_registration_number"])),
    projectName: toSafeString(readField(record, ["project_name_en", "project_name"])),
    masterProject: toSafeString(readField(record, ["master_project_en", "master_project"])),
    zipCode: toSafeString(readField(record, ["munc_zip_code", "zip_code"])),
  };
}

function normalizeUnitRecord(record?: Record<string, unknown>): DubaiLandUnitRecord | undefined {
  if (!record) return undefined;
  return {
    propertyId: toSafeString(readField(record, ["property_id"])),
    unitNumber: toSafeString(readField(record, ["unit_number"])),
    buildingNumber: toSafeString(readField(record, ["building_number"])),
    landNumber: toSafeString(readField(record, ["land_number"])),
    landSubNumber: toSafeString(readField(record, ["land_sub_number"])),
    municipalityNumber: toSafeString(readField(record, ["munc_number", "municipality_number"])),
    areaName: toSafeString(readField(record, ["area_name_en"])),
    propertyType: toSafeString(readField(record, ["property_type_en"])),
    propertySubType: toSafeString(readField(record, ["property_sub_type_en"])),
    actualAreaSqm: toNumber(readField(record, ["actual_area", "property_size"])),
    isFreeHold: toBooleanFlag(readField(record, ["is_free_hold"])),
    isLeaseHold: toBooleanFlag(readField(record, ["is_lease_hold"])),
    preRegistrationNumber: toSafeString(readField(record, ["pre_registration_number"])),
    projectName: toSafeString(readField(record, ["project_name_en", "project_name"])),
    masterProject: toSafeString(readField(record, ["master_project_en", "master_project"])),
  };
}

function normalizeBuildingRecord(record?: Record<string, unknown>): DubaiLandBuildingRecord | undefined {
  if (!record) return undefined;
  return {
    propertyId: toSafeString(readField(record, ["property_id"])),
    buildingNumber: toSafeString(readField(record, ["building_number"])),
    landNumber: toSafeString(readField(record, ["land_number"])),
    landSubNumber: toSafeString(readField(record, ["land_sub_number"])),
    areaName: toSafeString(readField(record, ["area_name_en"])),
    landType: toSafeString(readField(record, ["land_type_en"])),
    propertySubType: toSafeString(readField(record, ["property_sub_type_en"])),
    builtUpAreaSqm: toNumber(readField(record, ["built_up_area"])),
    buildingLevels: toNumber(readField(record, ["bld_levels", "levels"])),
    parkingCount: toNumber(readField(record, ["car_parks"])),
    isFreeHold: toBooleanFlag(readField(record, ["is_free_hold"])),
    isRegistered: toBooleanFlag(readField(record, ["is_registered"])),
    preRegistrationNumber: toSafeString(readField(record, ["pre_registration_number"])),
    projectName: toSafeString(readField(record, ["project_name_en", "project_name"])),
    masterProject: toSafeString(readField(record, ["master_project_en", "master_project"])),
  };
}

function normalizeProjectRecord(record?: Record<string, unknown>): DubaiLandProjectRecord | undefined {
  if (!record) return undefined;
  return {
    projectNumber: toSafeString(readField(record, ["project_number"])),
    projectName: toSafeString(readField(record, ["project_name_en", "project_name"])),
    developerName: toSafeString(readField(record, ["developer_name_en", "developer_name"])),
    projectStatus: toSafeString(readField(record, ["project_status", "project_status_en"])),
    completedPct: toNumber(readField(record, ["completed_pct", "completed", "completed_percentage"])),
    areaName: toSafeString(readField(record, ["area_name_en", "area"])),
    zone: toSafeString(readField(record, ["zone", "zone_en"])),
    authority: toSafeString(readField(record, ["authority"])),
    totalLands: toNumber(readField(record, ["total_lands"])),
    totalBuildings: toNumber(readField(record, ["total_buildings"])),
    totalVillas: toNumber(readField(record, ["total_villas"])),
    totalUnits: toNumber(readField(record, ["total_units"])),
    masterProject: toSafeString(readField(record, ["master_project_en", "master_project"])),
  };
}

function buildSummary(args: {
  liveData: boolean;
  transactions?: DubaiLandTransactionSummary;
  landRecord?: DubaiLandLandRecord;
  unitRecord?: DubaiLandUnitRecord;
  projectRecord?: DubaiLandProjectRecord;
}) {
  if (!args.liveData) {
    return (
      "Official Dubai Land data routes are wired in, but live records still depend on Dubai Pulse dataset approval and credentials. " +
      "Public DLD pages for title-deed verification, property status, and project status are available as manual official fallbacks."
    );
  }

  const parts: string[] = [
    "Official Dubai Pulse / DLD data returned live Dubai context.",
  ];
  if (args.transactions) {
    parts.push(
      `${args.transactions.sampleCount} recent transaction record(s) matched the current Dubai search context.`,
    );
  }
  if (args.landRecord?.landNumber) {
    parts.push(`Land ${args.landRecord.landNumber} was matched from the land registry feed.`);
  }
  if (args.unitRecord?.unitNumber) {
    parts.push(`Unit ${args.unitRecord.unitNumber} was matched from the units feed.`);
  }
  if (args.projectRecord?.projectName) {
    parts.push(`Project context resolved to ${args.projectRecord.projectName}.`);
  }
  parts.push(
    "Title-deed and property-status verification still flow through official DLD website / Dubai REST service pages rather than a public server API.",
  );
  return parts.join(" ");
}

export const DubaiLandService = {
  async getContext(input: DubaiLandContextInput): Promise<DubaiLandContextResult> {
    const rawLocationText = [input.rawLocation, input.district, input.location]
      .filter(Boolean)
      .join(", ");
    const inferred = inferRegulationGeography(rawLocationText);
    const inferredEmirate = inferred.stateOrProvince || "";
    if (inferredEmirate && inferredEmirate.toLowerCase() !== "dubai") {
      // Keep non-Dubai UAE requests explicit instead of silently returning
      // empty Dubai data. This avoids confusing other emirate flows later.
      return {
        market: "UAE",
        emirate: "Dubai",
        integrationStatus: "unavailable",
        summary:
          "Dubai Land integration only applies to Dubai. The current UAE request resolved to a different emirate, so no DLD lookup was attempted.",
        searchContext: {
          locationLabel: rawLocationText || input.location,
          areaCandidates: [],
          projectCandidates: [],
          identifiers: parseIdentifierHints(rawLocationText || input.location),
        },
        titleDeedVerification: buildVerificationChannel({
          detail:
            "The DLD title deed verification page is only relevant for Dubai properties and requires title-deed identifiers plus captcha in the official interface.",
          requiredFields: ["titleDeedNumber", "titleDeedYear", "propertyType"],
          officialUrl:
            "https://dubailand.gov.ae/en/eservices/title-deed-verification-overview/title-deed-verification",
          identifiers: parseIdentifierHints(rawLocationText || input.location),
        }),
        propertyStatus: buildVerificationChannel({
          detail:
            "The DLD property status enquiry page is only relevant for Dubai properties and requires property identifiers in the official interface.",
          requiredFields: ["propertyNumber", "landNumber", "makaniNumber", "municipalityNumber"],
          officialUrl:
            "https://dubailand.gov.ae/en/eservices/property-status-overview/property-status",
          identifiers: parseIdentifierHints(rawLocationText || input.location),
        }),
        projectStatus: buildVerificationChannel({
          detail:
            "The DLD project status page is only relevant for Dubai projects and requires project/land identifiers in the official interface.",
          requiredFields: ["projectNumber", "projectName", "landNumber"],
          officialUrl:
            "https://dubailand.gov.ae/en/eservices/real-estate-project-status-landing/?r=1",
          identifiers: parseIdentifierHints(rawLocationText || input.location),
        }),
        datasetStatuses: [],
        officialLinks: OFFICIAL_LINKS,
        onboardingRequirements: ONBOARDING_REQUIREMENTS,
      };
    }

    let reverseGeocodedLabel: string | undefined;
    if (input.coordinates) {
      try {
        const reverse = await MapboxPlacesService.reverseGeocode(input.coordinates);
        reverseGeocodedLabel = reverse.locationLabel;
      } catch {
        reverseGeocodedLabel = undefined;
      }
    }

    const identifiers = parseIdentifierHints(rawLocationText || input.location);
    const areaCandidates = buildAreaCandidates(input, reverseGeocodedLabel);
    const projectCandidates = buildProjectCandidates(identifiers, input);

    const { clientId, clientSecret } = getConfiguredCredentials();
    const credentialsConfigured = Boolean(clientId && clientSecret);
    let accessFailureDetail: string | null = null;
    const accessToken = await getDubaiPulseAccessToken().catch((error) => {
      console.warn("[DubaiLandService] Failed to obtain Dubai Pulse access token:", error);
      accessFailureDetail =
        error instanceof Error
          ? `Dubai Pulse authentication failed before dataset lookup. ${error.message}`
          : "Dubai Pulse authentication failed before dataset lookup.";
      return null;
    });

    // We try specific identifiers first, then area / project fallbacks, because
    // the official datasets vary in how strict their filters are.
    const transactionsFilters = uniqueStrings([
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
    ]);

    const landFilters = uniqueStrings([
      identifiers.landNumber ? buildStringFilter("land_number", identifiers.landNumber) : undefined,
      identifiers.municipalityNumber
        ? buildStringFilter("munc_number", identifiers.municipalityNumber)
        : undefined,
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
    ]);

    const unitFilters = uniqueStrings([
      identifiers.unitNumber ? buildStringFilter("unit_number", identifiers.unitNumber) : undefined,
      identifiers.buildingNumber
        ? buildStringFilter("building_number", identifiers.buildingNumber)
        : undefined,
      identifiers.landNumber ? buildStringFilter("land_number", identifiers.landNumber) : undefined,
      identifiers.municipalityNumber
        ? buildStringFilter("munc_number", identifiers.municipalityNumber)
        : undefined,
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
    ]);

    const buildingFilters = uniqueStrings([
      identifiers.buildingNumber
        ? buildStringFilter("building_number", identifiers.buildingNumber)
        : undefined,
      identifiers.landNumber ? buildStringFilter("land_number", identifiers.landNumber) : undefined,
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
    ]);

    const projectFilters = uniqueStrings([
      identifiers.projectNumber
        ? buildStringFilter("project_number", identifiers.projectNumber)
        : undefined,
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
    ]);

    const valuationFilters = uniqueStrings([
      ...areaCandidates.map((area) => buildStringFilter("area_name_en", area)),
      ...projectCandidates.map((project) => buildStringFilter("project_name_en", project)),
    ]);

    const [
      transactionsResult,
      saleIndexResult,
      landRegistryResult,
      unitsResult,
      buildingsResult,
      projectsResult,
      valuationsResult,
    ] = await Promise.all([
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.transactions, transactionsFilters, {
        limit: 25,
        orderBy: "instance_date desc",
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.saleIndex, [], {
        limit: 2,
        orderBy: "first_date_of_month desc",
        allowUnfiltered: true,
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.landRegistry, landFilters, {
        limit: 5,
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.units, unitFilters, {
        limit: 5,
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.buildings, buildingFilters, {
        limit: 5,
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.projects, projectFilters, {
        limit: 5,
        credentialsConfigured,
        accessFailureDetail,
      }),
      queryWithFilterFallbacks(accessToken, DATASET_CONFIG.valuations, valuationFilters, {
        limit: 10,
        orderBy: "instance_date desc",
        credentialsConfigured,
        accessFailureDetail,
      }),
    ]);

    const transactions = normalizeTransactionSummary(transactionsResult.records);
    const saleIndex = normalizeSaleIndex(saleIndexResult.records);
    const valuations = normalizeValuationSummary(valuationsResult.records);
    const landRecord = normalizeLandRecord(landRegistryResult.records[0]);
    const unitRecord = normalizeUnitRecord(unitsResult.records[0]);
    const buildingRecord = normalizeBuildingRecord(buildingsResult.records[0]);
    const projectRecord = normalizeProjectRecord(projectsResult.records[0]);

    const liveData = Boolean(
      transactions ||
        saleIndex ||
        valuations ||
        landRecord ||
        unitRecord ||
        buildingRecord ||
        projectRecord,
    );

    return {
      market: "UAE",
      emirate: "Dubai",
      integrationStatus: liveData
        ? "live"
        : accessToken
          ? "onboarding-required"
          : "onboarding-required",
      summary: buildSummary({
        liveData,
        transactions,
        landRecord,
        unitRecord,
        projectRecord,
      }),
      searchContext: {
        locationLabel: rawLocationText || input.location,
        areaCandidates,
        projectCandidates,
        reverseGeocodedLabel,
        identifiers,
      },
      transactions,
      saleIndex,
      valuations,
      landRecord,
      unitRecord,
      buildingRecord,
      projectRecord,
      // These remain official DLD service-page fallbacks because we did not
      // find a safe public backend API for automated title/property verification.
      titleDeedVerification: buildVerificationChannel({
        detail:
          "Official title deed verification is available on the DLD website and Dubai REST app, but it still requires interactive DLD fields such as title deed number, year, property type, and captcha.",
        requiredFields: ["titleDeedNumber", "titleDeedYear", "propertyType", "ownerName"],
        officialUrl:
          "https://dubailand.gov.ae/en/eservices/title-deed-verification-overview/title-deed-verification",
        identifiers,
      }),
      propertyStatus: buildVerificationChannel({
        detail:
          "Official property-status enquiry is available on the DLD website and Dubai REST app, with lookup modes such as title deed number, property number, Makani number, municipality number, and map selection.",
        requiredFields: [
          "propertyNumber",
          "landNumber",
          "buildingNumber",
          "unitNumber",
          "makaniNumber",
          "municipalityNumber",
        ],
        officialUrl:
          "https://dubailand.gov.ae/en/eservices/property-status-overview/property-status",
        identifiers,
      }),
      projectStatus: buildVerificationChannel({
        detail:
          "Official DLD project-status enquiry supports land number, project number, or project name through the website, Dubai REST app, and WhatsApp.",
        requiredFields: ["projectNumber", "projectName", "landNumber"],
        officialUrl:
          "https://dubailand.gov.ae/en/eservices/real-estate-project-status-landing/?r=1",
        identifiers,
      }),
      datasetStatuses: [
        transactionsResult.datasetStatus,
        saleIndexResult.datasetStatus,
        landRegistryResult.datasetStatus,
        unitsResult.datasetStatus,
        buildingsResult.datasetStatus,
        projectsResult.datasetStatus,
        valuationsResult.datasetStatus,
      ],
      officialLinks: OFFICIAL_LINKS,
      onboardingRequirements: ONBOARDING_REQUIREMENTS,
    };
  },
};

export default DubaiLandService;
