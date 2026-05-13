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
  { value: 'USA', label: 'USA (Pilot)' },
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
  Phoenix: 'Arizona',
  Seattle: 'Washington',
};

export const US_PILOT_REGULATION_LOCATIONS: GeographyLocationOption[] = [
  {
    location: 'Texas',
    label: 'Texas',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Texas',
    legacyCities: ['Austin'],
    jurisdictionLevel: 'state',
    codeFamily: 'State Regulations',
    projectSelectable: true,
  },
  {
    location: 'Arizona',
    label: 'Arizona',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Arizona',
    legacyCities: ['Phoenix'],
    jurisdictionLevel: 'state',
    codeFamily: 'State Regulations',
    projectSelectable: true,
  },
  {
    location: 'Washington',
    label: 'Washington',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Washington',
    legacyCities: ['Seattle'],
    jurisdictionLevel: 'state',
    codeFamily: 'State Regulations',
    projectSelectable: true,
  },
];

export const ALL_REGULATION_LOCATION_OPTIONS: GeographyLocationOption[] = [
  ...INDIA_REGULATION_LOCATIONS,
  ...US_PILOT_REGULATION_LOCATIONS,
];

function normalizeLocationFragment(value: string): string {
  return value
    .trim()
    .toLowerCase()
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

  const stateMatch = US_PILOT_REGULATION_LOCATIONS.find((option) => {
    const state = normalizeLocationFragment(option.stateOrProvince || option.location);
    const label = normalizeLocationFragment(option.label);
    return normalized === state || normalized === label || parts.includes(state) || parts.includes(label);
  });
  if (stateMatch) return stateMatch.stateOrProvince || stateMatch.location;

  const legacyCityMatch = Object.entries(US_CITY_TO_STATE).find(([city]) => {
    const cityName = normalizeLocationFragment(city);
    return normalized === cityName || parts.includes(cityName);
  });

  return legacyCityMatch?.[1];
}
