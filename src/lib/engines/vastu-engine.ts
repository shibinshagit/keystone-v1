import { Plot, Building } from '@/lib/types';
import * as turf from '@turf/turf';
import { getVastuCenter } from '@/lib/vastu-utils';
import { VASTU_SCHEMA } from "@/lib/scoring/vastu.schema";

export function calculateVastuScore(
  plot: Plot,
  buildings: Building[]
) {

  let totalScore = 0;
  const categories = [];

  // Direction helper (KEEP YOUR LOGIC ✅)
  const getDirection = (target: any, center: any): string => {
    const bearing = turf.bearing(center, target);
    const b = (bearing + 360) % 360;

    if (b >= 337.5 || b < 22.5) return 'N';
    if (b >= 22.5 && b < 67.5) return 'NE';
    if (b >= 67.5 && b < 112.5) return 'E';
    if (b >= 112.5 && b < 157.5) return 'SE';
    if (b >= 157.5 && b < 202.5) return 'S';
    if (b >= 202.5 && b < 247.5) return 'SW';
    if (b >= 247.5 && b < 292.5) return 'W';
    return 'NW';
  };

  const plotCenter = getVastuCenter(plot.geometry).geometry.coordinates;

  // MAIN BUILDING (reuse your logic ✅)
  const mainBldg = buildings.reduce((prev, current) =>
    prev.area > current.area ? prev : current
  );

  const mainDir = mainBldg
    ? getDirection(mainBldg.centroid.geometry.coordinates, plotCenter)
    : null;

  // LOOP THROUGH SCHEMA (🔥 NEW CORE)
  for (const category of VASTU_SCHEMA.categories) {

    let categoryScore = 0;
    const items = [];

    for (const item of category.items) {

      let score = 0;
      let status: "pass" | "fail" | "neutral" = "neutral";
      let feedback = "";

      // 🔥 RULE ENGINE (ONLY A & B FOR NOW)

      switch (item.id) {

        case "A1":
          // Assume rectangular plot for now
          score = item.maxScore;
          status = "pass";
          feedback = "Regular plot shape";
          break;

        case "A2":
          // TODO: slope logic later
          score = item.maxScore * 0.5;
          status = "neutral";
          feedback = "Slope data not available";
          break;

        case "A3":
          score = item.maxScore * 0.5;
          status = "neutral";
          feedback = "Open space distribution unknown";
          break;

        case "B1":
          if (item.type === "direction" && mainDir) {
            if (item.idealDirections?.includes(mainDir)) {
                score = item.maxScore;
                status = "pass";
                feedback = `Good direction (${mainDir})`;
            } else if (item.avoidDirections?.includes(mainDir)) {
                score = 0;
                status = "fail";
                feedback = `Avoid direction (${mainDir})`;
            } else {
                score = item.maxScore * 0.5;
                status = "neutral";
                feedback = `Neutral direction (${mainDir})`;
            }
    
          } else {
            score = 0;
            status = "fail";
            feedback = `Entrance not in good zone (${mainDir})`;
          }
          break;

        case "B2":
          if (mainDir === "SW") {
            score = 0;
            status = "fail";
            feedback = "Entrance in SW (bad)";
          } else {
            score = item.maxScore;
            status = "pass";
            feedback = "No SW entrance";
          }
          break;

        case "B3":
          score = item.maxScore * 0.5;
          status = "neutral";
          feedback = "Road alignment not checked";
          break;
      }

      categoryScore += score;

      items.push({
        id: item.id,
        title: item.title,
        score,
        maxScore: item.maxScore,
        status,
        feedback
      });
    }

    totalScore += categoryScore;

    categories.push({
      title: category.title,
      score: categoryScore,
      maxScore: category.maxScore,
      items
    });
  }

  const overallScore = Math.round(
    (totalScore / VASTU_SCHEMA.totalMaxScore) * 100
  );

  return {
    overallScore,
    totalScore,
    maxScore: VASTU_SCHEMA.totalMaxScore,
    categories
  };
}