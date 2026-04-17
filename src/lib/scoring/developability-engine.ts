/**
 * Developability Score Engine
 *
 * Thin wrapper around the generic schema engine, using the
 * Developability Score schema. Same pattern as dev-engine.ts.
 */

import { DEVELOPABILITY_SCHEMA } from './developability.schema';
import evaluateSchema, { ItemResult, EngineOutput } from './schema-engine';
import type { DevelopabilityScore } from '@/lib/types';

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
  const expectedItems = 18;
  const dataCompleteness = Math.min(1, definedItems / expectedItems);

  const cats = engineOutput.categories;
  const getDetails = (cat: typeof cats[number]) =>
    cat.items
      .filter((item) => item.status !== 'neutral')
      .map((item) => `${item.title}: ${item.score}/${item.maxScore} (${item.status})`);

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
      growthPotential: {
        score: growthCat?.score ?? 0,
        maxScore: growthCat?.maxScore ?? 300,
        details: growthCat ? getDetails(growthCat) : [],
      },
      legalRegulatory: {
        score: legalCat?.score ?? 0,
        maxScore: legalCat?.maxScore ?? 250,
        details: legalCat ? getDetails(legalCat) : [],
      },
      locationConnectivity: {
        score: locationCat?.score ?? 0,
        maxScore: locationCat?.maxScore ?? 250,
        details: locationCat ? getDetails(locationCat) : [],
      },
      marketEconomics: {
        score: marketCat?.score ?? 0,
        maxScore: marketCat?.maxScore ?? 200,
        details: marketCat ? getDetails(marketCat) : [],
      },
    },
    recommendation,
    dataCompleteness,
    timestamp: new Date().toISOString(),
  };
}

export default evaluateDevelopability;
