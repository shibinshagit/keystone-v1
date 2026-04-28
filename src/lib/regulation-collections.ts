import type { GeographyMarket, RegulationData } from '@/lib/types';

export const INDIA_REGULATIONS_COLLECTION = 'regulations';
export const US_REGULATIONS_COLLECTION = 'usRegulations';

export type RegulationCollectionName =
  | typeof INDIA_REGULATIONS_COLLECTION
  | typeof US_REGULATIONS_COLLECTION;

export function getRegulationCollectionNameForMarket(
  market?: GeographyMarket | null,
): RegulationCollectionName {
  return market === 'USA'
    ? US_REGULATIONS_COLLECTION
    : INDIA_REGULATIONS_COLLECTION;
}

export function getRegulationCollectionNameForRegulation(
  regulation?: Pick<RegulationData, 'market'> | null,
): RegulationCollectionName {
  return getRegulationCollectionNameForMarket(regulation?.market);
}

export function shouldUseNationalIndiaFallback(
  market?: GeographyMarket | null,
): boolean {
  return !market || market === 'India';
}
