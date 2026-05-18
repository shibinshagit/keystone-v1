import type { CountryCode, GeographyMarket, RegulationData } from '@/lib/types';

export function compactOptionalFields<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

export interface GeographyLocationOption {
  location: string;
  label: string;
  market: GeographyMarket;
  countryCode: CountryCode;
  stateOrProvince?: string;
  city?: string;
  legacyCities?: string[];
  jurisdictionLevel: 'national' | 'state' | 'city';
  codeFamily?: string;
  projectSelectable: boolean;
}

export const GEOGRAPHY_MARKETS: Array<{
  value: GeographyMarket;
  label: string;
}> = [
  { value: 'India', label: 'India' },
  { value: 'USA', label: 'USA' },
];

export const INDIA_REGULATION_LOCATIONS: GeographyLocationOption[] = [
  {
    location: 'National (NBC)',
    label: 'National (NBC)',
    market: 'India' as const,
    countryCode: 'IN' as const,
    jurisdictionLevel: 'national' as const,
    codeFamily: 'NBC',
    projectSelectable: false,
  },
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
].map((location) =>
  typeof location === 'string'
    ? {
        location,
        label: location,
        market: 'India' as const,
        countryCode: 'IN' as const,
        stateOrProvince: location,
        jurisdictionLevel: 'state' as const,
        codeFamily: 'State Development Rules',
        projectSelectable: true,
      }
    : location,
);

export const US_CITY_TO_STATE: Record<string, string> = {
  Austin: 'Texas',
  Chicago: 'Illinois',
  Dallas: 'Texas',
  Houston: 'Texas',
  'Los Angeles': 'California',
  Miami: 'Florida',
  'New York': 'New York',
  Orlando: 'Florida',
  Phoenix: 'Arizona',
  'San Francisco': 'California',
  Seattle: 'Washington',
  'Washington DC': 'District of Columbia',
  'Washington, D.C.': 'District of Columbia',
};

const US_STATE_LOCATION_CONFIG: Array<
  string | { location: string; legacyCities?: string[] }
> = [
  'Alabama',
  'Alaska',
  { location: 'Arizona', legacyCities: ['Phoenix'] },
  'Arkansas',
  { location: 'California', legacyCities: ['Los Angeles', 'San Francisco', 'San Diego'] },
  'Colorado',
  'Connecticut',
  'Delaware',
  { location: 'District of Columbia', legacyCities: ['Washington DC', 'Washington, D.C.'] },
  { location: 'Florida', legacyCities: ['Miami', 'Orlando', 'Tampa'] },
  'Georgia',
  'Hawaii',
  'Idaho',
  { location: 'Illinois', legacyCities: ['Chicago'] },
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  { location: 'New York', legacyCities: ['New York', 'NYC', 'Buffalo'] },
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  { location: 'Texas', legacyCities: ['Austin', 'Dallas', 'Houston'] },
  'Utah',
  'Vermont',
  'Virginia',
  { location: 'Washington', legacyCities: ['Seattle'] },
  'West Virginia',
  'Wisconsin',
  'Wyoming',
];

export const US_REGULATION_LOCATIONS: GeographyLocationOption[] =
  US_STATE_LOCATION_CONFIG.map((entry) => {
    const location = typeof entry === 'string' ? entry : entry.location;
    const legacyCities = typeof entry === 'string' ? undefined : entry.legacyCities;

    return {
      location,
      label: location,
      market: 'USA' as const,
      countryCode: 'US' as const,
      stateOrProvince: location,
      legacyCities,
      jurisdictionLevel: 'state' as const,
      codeFamily: 'State Regulations',
      projectSelectable: true,
    };
  });

export const US_STATE_NAME_TO_CODE: Readonly<Record<string, string>> = Object.freeze({
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
});

export const US_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

const US_STATE_TOKEN_TO_CODE: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(US_STATE_NAME_TO_CODE).flatMap(([stateName, code]) => [
      [normalizeLocationFragment(stateName), code],
      [code.toLowerCase(), code],
    ]),
  ),
  'washington dc': 'DC',
  'washington, dc': 'DC',
  'washington, dc, united states': 'DC',
  'washington d c': 'DC',
  'washington, d.c.': 'DC',
});

export const ALL_REGULATION_LOCATION_OPTIONS: GeographyLocationOption[] = [
  ...INDIA_REGULATION_LOCATIONS,
  ...US_REGULATION_LOCATIONS,
];

function normalizeLocationFragment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, " ");
}

export function getLocationOptionsForMarket(
  market: GeographyMarket,
  {
    projectSelectableOnly = false,
  }: {
    projectSelectableOnly?: boolean;
  } = {},
): GeographyLocationOption[] {
  return ALL_REGULATION_LOCATION_OPTIONS.filter((option) => {
    if (option.market !== market) return false;
    if (projectSelectableOnly && !option.projectSelectable) return false;
    return true;
  });
}

export function getDefaultLocationForMarket(
  market: GeographyMarket,
  {
    projectSelectableOnly = false,
  }: {
    projectSelectableOnly?: boolean;
  } = {},
): string {
  const options = getLocationOptionsForMarket(market, { projectSelectableOnly });
  const preferredLocation =
    market === 'India'
      ? options.find((option) => option.location === 'Delhi')
      : market === 'USA'
        ? options.find((option) => option.location === 'Texas')
        : undefined;

  return preferredLocation?.location || options[0]?.location || '';
}

export function inferRegulationGeography(
  location: string,
): Partial<
  Pick<
    RegulationData,
    | 'market'
    | 'countryCode'
    | 'stateOrProvince'
    | 'city'
    | 'jurisdictionLevel'
    | 'codeFamily'
  >
> {
  const normalized = normalizeLocationFragment(location);
  const parts = normalized
    .split(",")
    .map((part) => normalizeLocationFragment(part))
    .filter(Boolean)
    .filter((part) => !/^(india|usa|us|uae|united states|united arab emirates)$/.test(part));
  const match = ALL_REGULATION_LOCATION_OPTIONS.find(
    (option) => {
      const optionLocation = normalizeLocationFragment(option.location);
      const optionLabel = normalizeLocationFragment(option.label);
      const optionCity = normalizeLocationFragment(option.city || "");
      const optionState = normalizeLocationFragment(option.stateOrProvince || "");
      const legacyCities = (option.legacyCities || []).map(normalizeLocationFragment);

      return (
        optionLocation === normalized ||
        optionLabel === normalized ||
        parts.includes(optionLocation) ||
        parts.includes(optionLabel) ||
        (optionCity && parts.includes(optionCity)) ||
        (optionState && parts.includes(optionState)) ||
        legacyCities.includes(normalized) ||
        legacyCities.some((city) => parts.includes(city)) ||
        normalized.includes(optionLabel) ||
        normalized.includes(optionLocation)
      );
    },
  );

  if (!match) return {};

  return compactOptionalFields({
    market: match.market,
    countryCode: match.countryCode,
    stateOrProvince: match.stateOrProvince,
    city: match.city,
    jurisdictionLevel: match.jurisdictionLevel,
    codeFamily: match.codeFamily,
  });
}

export function getStateForUSLocation(location?: string | null): string | undefined {
  if (!location) return undefined;

  const normalized = normalizeLocationFragment(location);
  const parts = normalized
    .split(",")
    .map((part) => normalizeLocationFragment(part))
    .filter(Boolean);

  const legacyCityMatch = Object.entries(US_CITY_TO_STATE).find(([city]) => {
    const cityName = normalizeLocationFragment(city);
    return normalized === cityName || parts.includes(cityName);
  });
  if (legacyCityMatch) return legacyCityMatch[1];

  const stateMatch = US_REGULATION_LOCATIONS.find((option) => {
    const state = normalizeLocationFragment(option.stateOrProvince || option.location);
    const label = normalizeLocationFragment(option.label);
    return normalized === state || normalized === label || parts.includes(state) || parts.includes(label);
  });
  if (stateMatch) return stateMatch.stateOrProvince || stateMatch.location;

  return legacyCityMatch?.[1];
}

export function getUSStateCode(value?: string | null): string | undefined {
  if (!value) return undefined;

  const normalized = normalizeLocationFragment(value);
  if (!normalized) return undefined;

  const directMatch = US_STATE_TOKEN_TO_CODE[normalized];
  if (directMatch) return directMatch;

  const parts = normalized
    .split(",")
    .map((part) => normalizeLocationFragment(part))
    .filter(Boolean);

  for (const part of parts) {
    const partMatch = US_STATE_TOKEN_TO_CODE[part];
    if (partMatch) return partMatch;
  }

  const resolvedState = getStateForUSLocation(value);
  return resolvedState ? US_STATE_NAME_TO_CODE[resolvedState] : undefined;
}

export function isUSStateToken(value?: string | null): boolean {
  return Boolean(getUSStateCode(value));
}
