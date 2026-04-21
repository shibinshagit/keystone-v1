/**
 * Developability Score Engine
 *
 * Thin wrapper around the generic schema engine, using the
 * Developability Score schema. Same pattern as dev-engine.ts.
 */

import { DEVELOPABILITY_SCHEMA } from './developability.schema';
import evaluateSchema, { ItemResult, EngineOutput } from './schema-engine';
import type {
  DevelopabilityScore,
  DevelopabilityScoreCategory,
  DevelopabilityScoreItem,
} from '@/lib/types';

export function evaluateDevelopability(results: Record<string, ItemResult | undefined>): EngineOutput {
  return evaluateSchema(DEVELOPABILITY_SCHEMA as any, results);
}

/**
 * Convert raw engine output to the user-facing DevelopabilityScore interface.
 * Also computes the data completeness metric and a human-readable rating.
 */
export function toDevelopabilityScore(
  engineOutput: EngineOutput,
  results: Record<string, ItemResult | undefined>,
): DevelopabilityScore {
  const score = engineOutput.overallScore;

  let rating: DevelopabilityScore['rating'];
  if (score >= 800) rating = 'Excellent';
  else if (score >= 600) rating = 'Good';
  else if (score >= 400) rating = 'Moderate';
  else if (score >= 200) rating = 'Poor';
  else rating = 'Not Viable';

  const definedItems = Object.values(results).filter((result) => result !== undefined && result !== null).length;
  const expectedItems = DEVELOPABILITY_SCHEMA.categories.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const dataCompleteness = Math.min(1, definedItems / expectedItems);

  const cats = engineOutput.categories;
  const getDetails = (cat: typeof cats[number]) =>
    cat.items
      .filter((item) => item.status !== 'neutral')
      .map((item) => `${item.title}: ${item.score}/${item.maxScore} (${item.status})`);
  const getItems = (cat: typeof cats[number]): DevelopabilityScoreItem[] =>
    cat.items.map((item) => ({
      id: item.id,
      title: item.title,
      score: item.score,
      maxScore: item.maxScore,
      status: item.status === 'neutral' ? 'pending' : item.status,
      detail: formatDevelopabilityItemDetail(item.id, results[item.id]),
    }));
  const toCategory = (
    cat: (typeof cats)[number] | undefined,
    fallbackMaxScore: number,
  ): DevelopabilityScoreCategory => ({
    score: cat?.score ?? 0,
    maxScore: cat?.maxScore ?? fallbackMaxScore,
    details: cat ? getDetails(cat) : [],
    items: cat ? getItems(cat) : [],
  });

  const growthCat = cats.find((cat) => cat.title === 'Growth Potential');
  const legalCat = cats.find((cat) => cat.title === 'Legal & Regulatory');
  const locationCat = cats.find((cat) => cat.title === 'Location & Connectivity');
  const marketCat = cats.find((cat) => cat.title === 'Market & Economics');

  let recommendation = '';
  if (engineOutput.fail) {
    recommendation = 'Not recommended. Mandatory compliance checks failed, so the parcel needs legal and zoning resolution first.';
  } else if (dataCompleteness < 0.4) {
    recommendation = 'Preliminary score only. Too many developability checks are still missing to treat this result as decision-ready.';
  } else if (dataCompleteness < 0.65) {
    recommendation = 'Provisional recommendation. Key checks are available, but additional parcel-level evidence is still needed before relying on this score.';
  } else if (rating === 'Excellent') {
    recommendation = 'Highly recommended for development. Strong growth signals, clear legal pathway, and favorable market conditions.';
  } else if (rating === 'Good') {
    recommendation = 'Recommended with due diligence. Positive indicators across most categories.';
  } else if (rating === 'Moderate') {
    recommendation = 'Proceed with caution. Mixed signals require a more detailed parcel feasibility review before committing.';
  } else if (rating === 'Poor') {
    recommendation = 'Not recommended at this time. Significant risk factors were identified.';
  } else {
    recommendation = 'Avoid. Multiple critical risk factors make development unviable.';
  }

  return {
    overallScore: score,
    rating,
    categories: {
      growthPotential: toCategory(growthCat, 300),
      legalRegulatory: toCategory(legalCat, 250),
      locationConnectivity: toCategory(locationCat, 250),
      marketEconomics: toCategory(marketCat, 200),
    },
    recommendation,
    dataCompleteness,
    timestamp: new Date().toISOString(),
  };
}

export default evaluateDevelopability;

function formatDevelopabilityItemDetail(
  itemId: string,
  result: ItemResult | undefined,
): string | undefined {
  switch (itemId) {
    case 'LC1': {
      const distanceKm = toNumber(result?.value);
      return distanceKm == null
        ? undefined
        : `Nearest transit is ${distanceKm.toFixed(2)} km away.`;
    }
    case 'LC2': {
      const distanceMeters = toNumber(result?.value);
      return distanceMeters == null
        ? undefined
        : `Nearest mapped road edge is ${Math.round(distanceMeters)} m from the site centroid.`;
    }
    case 'LC3': {
      const value = toRecord(result?.value);
      if (!value) return undefined;
      return [
        `${safeCountLabel(value.schools, 'school')}`,
        `${safeCountLabel(value.hospitals, 'hospital')}`,
        `${safeCountLabel(value.malls, 'mall')}`,
        `${safeCountLabel(value.parks, 'park')}`,
      ].join(', ');
    }
    case 'LC4': {
      const value = toRecord(result?.value);
      if (!value) return undefined;
      const coverage = toNumber(value.boundaryCoverageRatio);
      const roadWidth = toNumber(value.roadWidth);
      const frontageWidth = toNumber(value.frontageWidth);
      const sides = Array.isArray(value.roadAccessSides) ? value.roadAccessSides.length : 0;
      const parts = [
        coverage != null ? `${Math.round(coverage * 100)}% boundary near roads` : null,
        sides > 0 ? `${sides} road-access side${sides === 1 ? '' : 's'}` : null,
        roadWidth != null ? `${roadWidth} m road width` : null,
        frontageWidth != null ? `${frontageWidth} m frontage norm` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' | ') : undefined;
    }
    case 'LC5': {
      const distanceKm = toNumber(result?.value);
      return distanceKm == null
        ? undefined
        : `Nearest airport is ${distanceKm.toFixed(2)} km away.`;
    }
    case 'GP2': {
      const totalFdi = toNumber(result?.value);
      return totalFdi == null
        ? undefined
        : `Visible FDI signals total about USD ${formatCompact(totalFdi)}M.`;
    }
    case 'GP3': {
      const builtUpChange = toNumber(result?.value);
      return builtUpChange == null
        ? undefined
        : `Satellite analysis shows ${builtUpChange.toFixed(1)}% built-up change over 5 years.`;
    }
    case 'GP4': {
      const growth = toNumber(result?.value);
      return growth == null
        ? undefined
        : `Average decadal population growth is ${growth.toFixed(1)}%.`;
    }
    case 'GP5': {
      const value = toRecord(result?.value);
      const count = toNumber(value?.count);
      const source = typeof value?.source === 'string' ? value.source : null;
      if (count == null && !source) return undefined;
      return `${count != null ? `${Math.round(count)} proposed infrastructure signal${count === 1 ? '' : 's'}` : 'Proposed infrastructure signal'}${source ? ` from ${source}` : ''}.`;
    }
    case 'LR1':
      return result?.status === false
        ? 'Current regulation does not match the selected intended use.'
        : 'Current regulation aligns with the selected intended use.';
    case 'LR2':
      return result?.score === 30
        ? 'Direct zoning match failed, but CLU text suggests conversion may be possible.'
        : result?.status === false
          ? 'No clear CLU pathway was found in the available regulation text.'
          : 'Current use is already permitted under the available regulation.';
    case 'LR3':
      return 'Pending dispute and litigation data source.';
    case 'LR4':
      return typeof result?.value === 'string'
        ? `RERA or approval reference: ${result.value as string}.`
        : undefined;
    case 'LR5':
      return 'Pending master plan extraction and conformity check.';
    case 'ME1':
      return 'Pending locality-level price trend data.';
    case 'ME2': {
      const value = toRecord(result?.value);
      if (!value) return undefined;
      const distanceKm = toNumber(value.distanceKm);
      const name = typeof value.name === 'string' ? value.name : null;
      const count = toNumber(value.count);
      if (name && distanceKm != null) {
        return `${name} is ${distanceKm.toFixed(2)} km away.`;
      }
      if (count != null) {
        return `${Math.round(count)} operational SEZ signal${count === 1 ? '' : 's'} found in the fallback dataset.`;
      }
      return undefined;
    }
    case 'ME3': {
      const absorption = toNumber(result?.value);
      return absorption == null
        ? undefined
        : `Absorption signal is ${absorption.toFixed(1)} based on available assumptions and competitor inputs.`;
    }
    case 'ME4': {
      const density = toNumber(result?.value);
      return density == null
        ? undefined
        : `Average population density is ${Math.round(density).toLocaleString('en-IN')} people/sq km.`;
    }
    default:
      return result ? undefined : 'Pending data source or scoring input.';
  }
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toRecord(value: unknown): Record<string, any> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, any>) : null;
}

function safeCountLabel(value: unknown, label: string) {
  const count = toNumber(value) ?? 0;
  return `${Math.round(count)} ${label}${count === 1 ? '' : 's'}`;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}
