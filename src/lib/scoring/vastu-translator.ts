import { Plot, Building } from '@/lib/types';
import * as turf from '@turf/turf';
import { ItemResult } from './schema-engine';

/**
 * Build per-item results for VASTU_SCHEMA from plot and buildings.
 * Only emit entries when measurable; do not invent defaults.
 */
export function buildVastuResults(plot: Plot, buildings: Building[]): Record<string, ItemResult | undefined> {
  const res: Record<string, ItemResult | undefined> = {};

  if (!plot || !plot.geometry) return res;

  // Compute plot centroid
  try {
    const plotCenter = turf.centerOfMass(plot.geometry).geometry.coordinates;

    // MAIN BUILDING
    const mainBldg = (buildings || []).reduce((prev, cur) => (prev && prev.area > cur.area ? prev : cur), buildings && buildings[0]);

    // A1: Plot shape -> aspect ratio from bbox
    try {
      const bbox = turf.bbox(plot.geometry);
      const w = Math.max(1, Math.abs(bbox[2] - bbox[0]));
      const h = Math.max(1, Math.abs(bbox[3] - bbox[1]));
  const aspectRatio = w / h;
  // provide value and threshold when computable
  res['A1'] = { value: parseFloat(aspectRatio.toFixed(2)), threshold: 1.2, status: aspectRatio > 1.2 } as any;
    } catch (e) {
      // leave A1 undefined if computation fails
    }

    // B1/B2: Entrance direction based on main building centroid bearing from plot center
    if (mainBldg && mainBldg.centroid) {
      const bearing = turf.bearing(plotCenter, mainBldg.centroid.geometry.coordinates);
      const b = (bearing + 360) % 360;
      let dir = 'N';
      if (b >= 337.5 || b < 22.5) dir = 'N';
      else if (b >= 22.5 && b < 67.5) dir = 'NE';
      else if (b >= 67.5 && b < 112.5) dir = 'E';
      else if (b >= 112.5 && b < 157.5) dir = 'SE';
      else if (b >= 157.5 && b < 202.5) dir = 'S';
      else if (b >= 202.5 && b < 247.5) dir = 'SW';
      else if (b >= 247.5 && b < 292.5) dir = 'W';
      else dir = 'NW';

      // B1: if direction is in ideal list, status true; if in avoid list, status false
      const ideal = ['N', 'NE', 'E'];
      const avoid = ['SW'];
  if (ideal.includes(dir)) res['B1'] = { value: dir, threshold: 'Allowed: N/NE/E', status: true } as any;
  else if (avoid.includes(dir)) res['B1'] = { value: dir, threshold: 'Allowed: N/NE/E', status: false } as any;

  // B2: No SW entrance -> pass if dir !== SW
  res['B2'] = { value: dir, threshold: 'Avoid: SW', status: dir !== 'SW' } as any;
    }

  } catch (e) {
    // translator should not throw; just return what we have
  }

  return res;
}

export default buildVastuResults;
