import { calculateVastuScoreFromPlot } from '@/lib/scoring/vastu-engine';
import { Plot, Building } from '@/lib/types';

/**
 * Backwards-compatible wrapper preserved. Now uses the translator layer to build
 * per-item results and evaluates schema-driven scoring.
 */
export function calculateVastuScore(plot: Plot, buildings: Building[], _projectVastu?: any) {
  return calculateVastuScoreFromPlot(plot, buildings);
}

export default calculateVastuScore;