import { GREEN_SCHEMA } from '@/lib/scoring/green.schema';
import evaluateSchema, { ItemResult, EngineOutput } from './schema-engine';
import buildGreenResults from './green-translator';
import { Plot, Building } from '@/lib/types';

export function evaluateGreen(results: Record<string, ItemResult | undefined>): EngineOutput {
  return evaluateSchema(GREEN_SCHEMA as any, results);
}

export function calculateGreenFromPlot(plot: Plot, buildings: Building[]): EngineOutput {
  const results = buildGreenResults(plot, buildings);
  return evaluateSchema(GREEN_SCHEMA as any, results);
}

export default evaluateGreen;
