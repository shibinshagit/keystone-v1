import { calculateGreenFromPlot } from '@/lib/scoring/green-engine';
import { Building, Plot } from '@/lib/types';

export function calculateGreenAnalysis(plot: Plot, buildings: Building[]) {
    return calculateGreenFromPlot(plot, buildings);
}

export default calculateGreenAnalysis;
