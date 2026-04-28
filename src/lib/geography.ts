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

export const US_PILOT_REGULATION_LOCATIONS: GeographyLocationOption[] = [
  {
    location: 'Austin',
    label: 'Austin, Texas',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Texas',
    city: 'Austin',
    jurisdictionLevel: 'city',
    codeFamily: 'City Zoning',
    projectSelectable: true,
  },
  {
    location: 'Phoenix',
    label: 'Phoenix, Arizona',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Arizona',
    city: 'Phoenix',
    jurisdictionLevel: 'city',
    codeFamily: 'City Zoning',
    projectSelectable: true,
  },
  {
    location: 'Seattle',
    label: 'Seattle, Washington',
    market: 'USA',
    countryCode: 'US',
    stateOrProvince: 'Washington',
    city: 'Seattle',
    jurisdictionLevel: 'city',
    codeFamily: 'City Zoning',
    projectSelectable: true,
  },
];

export const ALL_REGULATION_LOCATION_OPTIONS: GeographyLocationOption[] = [
  ...INDIA_REGULATION_LOCATIONS,
  ...US_PILOT_REGULATION_LOCATIONS,
];

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
        ? options.find((option) => option.location === 'Austin')
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
  const normalized = location.trim().toLowerCase();
  const match = ALL_REGULATION_LOCATION_OPTIONS.find(
    (option) => option.location.toLowerCase() === normalized,
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
