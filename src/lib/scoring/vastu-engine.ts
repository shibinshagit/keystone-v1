import { VASTU_SCHEMA } from '@/lib/scoring/vastu.schema';
import evaluateSchema, { ItemResult, EngineOutput } from './schema-engine';
import buildVastuResults from './vastu-translator';
import { Plot, Building } from '@/lib/types';

export function evaluateVastu(results: Record<string, ItemResult | undefined>): EngineOutput {
  return evaluateSchema(VASTU_SCHEMA as any, results);
}

export function calculateVastuScoreFromPlot(plot: Plot, buildings: Building[]): EngineOutput {
  const results = buildVastuResults(plot, buildings);
  return evaluateSchema(VASTU_SCHEMA as any, results);
}

export default evaluateVastu;
