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
      title: formatDevelopabilityItemTitle(item.id, item.title, results[item.id]),
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
    recommendation = 'System Verdict: FAILED. Mandatory compliance checks failed (e.g. zoning mismatch or severe legal risk). This parcel requires resolution before proceeding.';
  } else if (dataCompleteness < 0.4) {
    recommendation = 'System Verdict: INCOMPLETE. Less than 40% of the required data was found. We cannot confidently recommend this plot yet.';
  } else if (dataCompleteness < 0.65) {
    recommendation = 'System Verdict: PROVISIONAL. This is a preliminary mathematical score. More parcel-level evidence is required before making a final decision.';
  } else if (rating === 'Excellent') {
    recommendation = 'System Verdict: EXCELLENT. Strong mathematical indicators for growth, legal pathways, and market conditions. Please review the AI Investment Summary below for deep qualitative analysis.';
  } else if (rating === 'Good') {
    recommendation = 'System Verdict: GOOD. Positive metrics across most categories indicate a solid opportunity. Review the AI Investment Summary below for further qualitative details.';
  } else if (rating === 'Moderate') {
    recommendation = 'System Verdict: MODERATE. The data shows mixed signals. A detailed feasibility review is required before committing.';
  } else if (rating === 'Poor') {
    recommendation = 'System Verdict: POOR. Significant mathematical risk factors detected. Development is not recommended at this time.';
  } else {
    recommendation = 'System Verdict: AVOID. Multiple critical data flags make this plot unviable.';
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

function formatDevelopabilityItemTitle(
  itemId: string,
  defaultTitle: string,
  result: ItemResult | undefined,
): string {
  if (itemId === 'LR4') {
    const value = toRecord(result?.value);
    const isUsTitleSignal =
      result?.value === null ||
      (value != null && typeof value.ownerName === 'string');

    if (isUsTitleSignal) {
      return 'Approval status';
    }
  }

  return defaultTitle;
}

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
      const tiaLikelihood =
        typeof value.tiaLikelihood === 'string' ? value.tiaLikelihood : null;
      const accessRisk =
        typeof value.accessRisk === 'string' ? value.accessRisk : null;
      const nearbyWorkZones = toNumber(value.nearbyWorkZones);
      const parts = [
        coverage != null ? `${Math.round(coverage * 100)}% boundary near roads` : null,
        sides > 0 ? `${sides} road-access side${sides === 1 ? '' : 's'}` : null,
        roadWidth != null ? `${roadWidth} m road width` : null,
        frontageWidth != null ? `${frontageWidth} m frontage norm` : null,
        accessRisk ? `${accessRisk} access risk` : null,
        tiaLikelihood ? `TIA ${tiaLikelihood}` : null,
        nearbyWorkZones != null && nearbyWorkZones > 0
          ? `${Math.round(nearbyWorkZones)} nearby work-zone signal${nearbyWorkZones === 1 ? '' : 's'} within 1 km`
          : null,
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
      // US: economicHealthValue object { unemploymentRate, medianIncome, laborForce }
      const value = toRecord(result?.value);
      if (value) {
        const unemp = toNumber(value.unemploymentRate);
        const income = toNumber(value.medianIncome);
        const labor = toNumber(value.laborForce);
        if (unemp != null) {
          const parts = [
            `Unemployment: ${unemp}%`,
            income != null ? `Median Income: $${formatCompact(income)}` : null,
            labor != null ? `Labor Force: ${formatCompact(labor)}` : null,
          ].filter(Boolean);
          return parts.join(' | ');
        }
      }
      // India: raw FDI number
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
      const value = toRecord(result?.value);
      if (value) {
        // US: { population, medianAge, growthTier }
        const population = toNumber(value.population);
        const medianAge = toNumber(value.medianAge);
        const growthTier = typeof value.growthTier === 'string' ? value.growthTier : null;
        if (population != null && growthTier) {
          const parts = [
            `Population: ${formatCompact(population)}`,
            growthTier ? `Market Tier: ${growthTier}` : null,
            medianAge != null ? `Median Age: ${medianAge}` : null,
          ].filter(Boolean);
          return parts.join(' | ');
        }
        // India: { population2001, population2011, projectedPopulation2025, migrationDirection, confidence }
        const pop2001 = toNumber(value.population2001);
        const pop2011 = toNumber(value.population2011);
        const pop2025 = toNumber(value.projectedPopulation2025);
        const direction = typeof value.migrationDirection === 'string' ? value.migrationDirection : null;
        const confidence = toNumber(value.confidence);
        const parts = [
          pop2001 != null && pop2011 != null && pop2025 != null
            ? `${formatCompact(pop2001)} (2001) -> ${formatCompact(pop2011)} (2011) -> ${formatCompact(pop2025)} (2025)`
            : null,
          direction ? `${direction} migration signal` : null,
          confidence != null ? `${Math.round(confidence * 100)}% confidence` : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(' | ') : undefined;
      }
      const growth = toNumber(result?.value);
      return growth == null
        ? undefined
        : `Average decadal population growth is ${growth.toFixed(1)}%.`;
    }
    case 'GP5': {
      const value = toRecord(result?.value);
      // US: { count (totalUnits), source, permits: { totalUnits, singleFamily, multiFamily, valuation } }
      const permits = toRecord(value?.permits);
      if (permits) {
        const total = toNumber(permits.totalUnits);
        const sf = toNumber(permits.singleFamily);
        const mf = toNumber(permits.multiFamily);
        const source = typeof value?.source === 'string' ? value.source : 'US Census BPS';
        const parts = [
          total != null ? `${formatCompact(total)} permits/yr` : null,
          sf != null ? `SF: ${formatCompact(sf)}` : null,
          mf != null ? `MF: ${formatCompact(mf)}` : null,
          `Source: ${source}`,
        ].filter(Boolean);
        return parts.join(' | ');
      }
      // India: generic count + source
      const count = toNumber(value?.count);
      const source = typeof value?.source === 'string' ? value.source : null;
      if (count == null && !source) return undefined;
      return `${count != null ? `${Math.round(count)} proposed infrastructure signal${count === 1 ? '' : 's'}` : 'Proposed infrastructure signal'}${source ? ` from ${source}` : ''}.`;
    }
    case 'LR1': {
      // US: value is zoning object { zoningCode, zoningDescription, jurisdiction, floodZone }
      const value = toRecord(result?.value);
      if (value && typeof value.zoningCode === 'string') {
        return `Zoning: ${value.zoningCode} — ${value.zoningDescription || 'N/A'} (${value.jurisdiction || 'County'})`;
      }
      return result?.status === false
        ? 'Current regulation does not match the selected intended use.'
        : 'Current regulation aligns with the selected intended use.';
    }
    case 'LR2': {
      // US: value is { zoningCode, intendedUse, compatible }
      const value = toRecord(result?.value);
      if (value && typeof value.zoningCode === 'string' && typeof value.intendedUse === 'string') {
        return value.compatible
          ? `Zoning ${value.zoningCode} is compatible with ${value.intendedUse} use.`
          : `Zoning ${value.zoningCode} may not directly permit ${value.intendedUse} use — conversion or variance may be required.`;
      }
      return result?.score === 30
        ? 'Direct zoning match failed, but CLU text suggests conversion may be possible.'
        : result?.status === false
          ? 'No clear CLU pathway was found in the available regulation text.'
          : 'Current use is already permitted under the available regulation.';
    }
    case 'LR3': {
      // US: value is { encumbrances: [...], count }
      const value = toRecord(result?.value);
      if (value && Array.isArray(value.encumbrances)) {
        const enc = value.encumbrances as { type: string; description: string; status: string }[];
        if (enc.length === 0) return 'No encumbrances, liens, or easements on record. Title appears clean.';
        return enc.map(e => `${e.type}: ${e.description} (${e.status})`).join(' | ');
      }
      return 'Pending dispute and litigation data source.';
    }
    case 'LR4': {
      // US: value is title object { ownerName, ownerType, assessedValue, lastSaleDate, lastSalePrice }
      const value = toRecord(result?.value);
      if (value && typeof value.ownerName === 'string') {
        const parts = [
          `Owner: ${value.ownerName}`,
          value.ownerType ? `(${value.ownerType})` : null,
          toNumber(value.assessedValue) != null ? `Assessed: $${formatCompact(toNumber(value.assessedValue)!)}` : null,
          typeof value.lastSaleDate === 'string' ? `Last Sale: ${value.lastSaleDate}` : null,
          toNumber(value.lastSalePrice) != null ? `at $${formatCompact(toNumber(value.lastSalePrice)!)}` : null,
        ].filter(Boolean);
        return parts.join(' | ');
      }
      return typeof result?.value === 'string'
        ? `RERA or approval reference: ${result.value as string}.`
        : undefined;
    }
    case 'LR5': {
      // US: value is { altaSurveyAvailable, floodZone }
      const value = toRecord(result?.value);
      if (value && typeof value.floodZone === 'string') {
        const parts = [
          `Flood Zone: ${value.floodZone}`,
          value.altaSurveyAvailable ? 'ALTA Survey: Available' : 'ALTA Survey: Not Available',
        ];
        return parts.join(' | ');
      }
      return 'Pending master plan extraction and conformity check.';
    }
    case 'ME1':
      return 'Pending locality-level price trend data.';
    case 'ME2': {
      const value = toRecord(result?.value);
      if (!value) return undefined;
      // US: { tier, permitGrowthIndicator }
      const tier = typeof value.tier === 'string' ? value.tier : null;
      const indicator = typeof value.permitGrowthIndicator === 'string' ? value.permitGrowthIndicator : null;
      if (tier && indicator) {
        return `US Market Zone: ${tier} — ${indicator}.`;
      }
      // India: { distanceKm, name, count }
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
      // US: result.value is the absorptionRate number (units per 1K pop)
      const absorption = toNumber(result?.value);
      return absorption == null
        ? undefined
        : `Absorption rate: ${absorption.toFixed(1)} permitted units per 1,000 residents/year.`;
    }
    case 'ME4': {
      const value = toRecord(result?.value);
      if (value) {
        // US: { population, medianIncome, tier }
        const population = toNumber(value.population);
        const medianIncome = toNumber(value.medianIncome);
        const demandTier = typeof value.tier === 'string' ? value.tier : null;
        if (demandTier && population != null) {
          const parts = [
            `Demand Tier: ${demandTier}`,
            `Population: ${formatCompact(population)}`,
            medianIncome != null ? `Median Income: $${formatCompact(medianIncome)}` : null,
          ].filter(Boolean);
          return parts.join(' | ');
        }
        // India: { density2011, projectedDensity2025, migrationDirection, projectedUrbanPopulationPct2025 }
        const density2011 = toNumber(value.density2011);
        const density2025 = toNumber(value.projectedDensity2025);
        const direction = typeof value.migrationDirection === 'string' ? value.migrationDirection : null;
        const urbanPct = toNumber(value.projectedUrbanPopulationPct2025);
        const parts = [
          density2011 != null && density2025 != null
            ? `${Math.round(density2011).toLocaleString('en-IN')} -> ${Math.round(density2025).toLocaleString('en-IN')} people/sq km by 2025`
            : null,
          urbanPct != null ? `${urbanPct.toFixed(1)}% projected urban share` : null,
          direction ? `${direction} demand pressure` : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(' | ') : undefined;
      }
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
