import { Plot, Building } from '@/lib/types';
import * as turf from '@turf/turf';
import { ItemResult } from './schema-engine';

/**
 * Build per-item results for GREEN_SCHEMA from plot and buildings.
 * Only emit entries when measurable; do not invent defaults.
 */
export function buildGreenResults(plot: Plot, buildings: Building[]): Record<string, ItemResult | undefined> {
  const res: Record<string, ItemResult | undefined> = {};

  if (!plot) return res;

  // Example heuristic: transport access -> if plot has a 'roads' property or proximity to known transport nodes
  // We can't query external data, so look for a boolean flag in plot.properties.transportAccess
  try {
    const transportAccess = (plot as any)?.properties?.transportAccess;
    if (typeof transportAccess === 'boolean') {
      res['SS2'] = { status: transportAccess } as any;
    }
  } catch (e) {}

  // Water: check for rainwater harvesting metadata in plot.properties
  try {
    const rwh = (plot as any)?.properties?.rainwaterHarvesting;
    if (typeof rwh === 'boolean') {
      res['WE1'] = { status: rwh } as any;
    }
  } catch (e) {}

  // Green cover & Open space: use metadata fields if present (percentage values)
  try {
    const greenCover = (plot as any)?.properties?.greenCoverPercent;
    if (typeof greenCover === 'number') {
      res['SS1'] = { value: parseFloat(greenCover.toFixed(2)), threshold: 15, status: greenCover >= 15 } as any;
    }
  } catch (e) {}

  try {
    const openSpace = (plot as any)?.properties?.openSpacePercent;
    if (typeof openSpace === 'number') {
      res['SS3'] = { value: parseFloat(openSpace.toFixed(2)), threshold: 30, status: openSpace >= 30 } as any;
    }
  } catch (e) {}

  return res;
}

export default buildGreenResults;
