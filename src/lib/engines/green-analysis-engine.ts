import { Building, Plot } from '@/lib/types';
import * as turf from '@turf/turf';

interface GreenAnalysisScore {
    overallScore: number;
    rating: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    breakdown: {
        category: string;
        score: number;
        // new fields exposed for UI
        maxScore?: number;
        value?: number | string;
        threshold?: number | string;
        status?: boolean;
        feedback: string;
    }[];
}

/**
 * Calculates Passive Solar & Daylight Analysis Scores
 */
export function calculateGreenAnalysis(
    plot: Plot,
    buildings: Building[]
): GreenAnalysisScore {

    const result: GreenAnalysisScore = {
        overallScore: 0,
        rating: 'Poor',
        breakdown: []
    };

    if (buildings.length === 0) return result;

    let totalScore = 0;

    // 1. Orientation Analysis (Passive Solar)
    // Goal: Maximize North/South facade area to reduce heat gain (East/West).
    let orientationScore = 0;
    let orientationFeedback = "";
    let aspectRatio = 1;

    // For simplicity, check the largest building
    const mainBldg = buildings.reduce((a, b) => (a.area > b.area ? a : b));

    if (mainBldg) {
        // Find elongation
        const bbox = turf.bbox(mainBldg.geometry);
        const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]]);
        const height = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]]);

    aspectRatio = width / height;

        if (aspectRatio > 1.5) {
            orientationScore = 90;
            orientationFeedback = "Excellent: Building elongated East-West.";
        } else if (aspectRatio > 1.2) {
            orientationScore = 75;
            orientationFeedback = "Good: Slight East-West elongation.";
        } else if (aspectRatio < 0.8) {
            orientationScore = 40;
            orientationFeedback = "Poor: Building elongated North-South (Higher heat gain).";
        } else {
            orientationScore = 60;
            orientationFeedback = "Fair: Compact/Square form.";
        }
    }

    // Expose orientation-related values for UI without changing scoring logic
    const orientationThreshold = 1.5; // existing condition used in scoring branches
    result.breakdown.push({
        category: "Passive Solar Orientation",
        score: orientationScore,
        maxScore: 100,
        value: parseFloat(aspectRatio.toFixed(2)),
        threshold: orientationThreshold,
        status: aspectRatio > orientationThreshold,
        feedback: orientationFeedback
    });

    // 2. Daylight Potential (Building Depth)
    // Goal: Floor plates shallower than 12-14m allow good daylight penetration.
    // If buildings are massive blocks, score lowers.

    let depthScore = 0;
    let depthFeedback = "";

    // Heuristic: Area / Perimeter * 4 roughly gives "Thickness"? 
    // Or (2 * Area) / Perimeter ?
    // Depth ~ 2 * Area / Perimeter ? No.
    // For a Rectangle W*D: Area = WD, Perim = 2(W+D).
    // If W >> D, Perim ~ 2W. Ratio = WD / 2W = D/2. So 4 * Ratio = 2D = Depth? No.
    // Let's use Polylabel to find "Pole of Inaccessibility". distance from boundary.
    // If pole is > 6m-7m from edge, depth is > 12m-14m.

    let avgPoleDist = 0;
    buildings.forEach(b => {
        // Polylabel returns [x, y, dist]
        // turf.unkinkPolygon? turf ensures standard GeoJSON.
        // Unfortunately standard turf doesn't expose Polylabel directly as a simple function returning distance easily without setup.
        // But we can estimate "Shortest Axis" from BBox for now as a proxy.
        const bbox = turf.bbox(b.geometry);
        const w = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
        const h = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
        const minDim = Math.min(w, h);

        // If building is rotated 45deg, bbox is huge.
        // Correct approach: Area / LongestLength? 
        // Or specific wing depth?
        // We know our generator makes 'wings' of specific depth (e.g. 12m, 18m).
        // Let's assume the heuristic: Ideal depth < 15m.

        // If minDim of BBox is huge, it MIGHT be deep. 
        // Let's use a simpler check: If intendedUse is 'Commercial', we allow deeper.

        // Let's stick to BBox Min Dimension as a proxy for now.
        if (minDim > 20) {
            // Likely very deep block
            avgPoleDist += 30; // Score penalty proxy
        } else {
            avgPoleDist += 10;
        }
    });

    // Inverse scoring: Deeper = Worse (for daylight)
    // If "Depth" proxy is < 15m, Score High.
    const averageDepthProxy = buildings.length > 0 ? avgPoleDist / buildings.length : 20;

    if (averageDepthProxy <= 15) {
        depthScore = 95;
        depthFeedback = "High: Shallow floor plates maximize daylight.";
    } else if (averageDepthProxy <= 22) {
        depthScore = 70;
        depthFeedback = "Good: Moderate depth.";
    } else {
        depthScore = 40;
        depthFeedback = "Low: Deep floor plates may require artificial lighting.";
    }

    // Expose depth/daylight values for UI
    const depthThreshold = 15; // proxy threshold used to decide high/low depth
    result.breakdown.push({
        category: "Daylight Potential",
        score: depthScore,
        maxScore: 100,
        value: parseFloat(averageDepthProxy.toFixed(2)),
        threshold: depthThreshold,
        status: averageDepthProxy <= depthThreshold,
        feedback: depthFeedback
    });

    // 3. Overall
    result.overallScore = Math.round((orientationScore + depthScore) / 2);

    if (result.overallScore >= 85) result.rating = 'Excellent';
    else if (result.overallScore >= 70) result.rating = 'Good';
    else if (result.overallScore >= 50) result.rating = 'Fair';
    else result.rating = 'Poor';

    return result;
}
