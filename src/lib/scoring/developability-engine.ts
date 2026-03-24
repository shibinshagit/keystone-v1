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
  results: Record<string, ItemResult | undefined>
): DevelopabilityScore {
  const score = engineOutput.overallScore;
  const maxScore = engineOutput.maxScore;

  // Rating bands
  let rating: DevelopabilityScore['rating'];
  if (score >= 800) rating = 'Excellent';
  else if (score >= 600) rating = 'Good';
  else if (score >= 400) rating = 'Moderate';
  else if (score >= 200) rating = 'Poor';
  else rating = 'Not Viable';

  // Data completeness: how many items actually had data
  const totalItems = Object.keys(results).length;
  const definedItems = Object.values(results).filter(r => r !== undefined && r !== null).length;
  const expectedItems = 18; // Total items in the schema
  const dataCompleteness = Math.min(1, definedItems / expectedItems);

  // Map categories from engine output
  const cats = engineOutput.categories;
  const getDetails = (cat: typeof cats[number]) =>
    cat.items
      .filter(it => it.status !== 'neutral')
      .map(it => `${it.title}: ${it.score}/${it.maxScore} (${it.status})`);

  const growthCat = cats.find(c => c.title === 'Growth Potential');
  const legalCat = cats.find(c => c.title === 'Legal & Regulatory');
  const locationCat = cats.find(c => c.title === 'Location & Connectivity');
  const marketCat = cats.find(c => c.title === 'Market & Economics');

  // Recommendation text
  let recommendation = '';
  if (engineOutput.fail) {
    recommendation = 'NOT RECOMMENDED — Mandatory compliance checks failed. Resolve legal/zoning issues before proceeding.';
  } else if (rating === 'Excellent') {
    recommendation = 'Highly recommended for development. Strong growth signals, clear legal pathway, and favorable market conditions.';
  } else if (rating === 'Good') {
    recommendation = 'Recommended with due diligence. Positive indicators across most categories.';
  } else if (rating === 'Moderate') {
    recommendation = 'Proceed with caution. Mixed signals — conduct detailed feasibility study before committing.';
  } else if (rating === 'Poor') {
    recommendation = 'Not recommended at this time. Significant risk factors identified.';
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
