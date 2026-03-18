// Generic schema-driven scoring engine
// Rules:
// - Schema is source of truth for maxScore and structure
// - Results must be provided per-item; engine does not invent defaults
// - If an item.result.score is a number, use it
// - Else if item.result.status === true, score = item.maxScore
// - Else if item.result.status === false, score = 0
// - If an item.result is missing entirely, item.score is null (no fallback)
// - If any mandatory item explicitly fails (status === false), the category and overall are marked failed

export interface SchemaItem {
  id: string;
  title: string;
  maxScore?: number;
  mandatory?: boolean;
  // ...other fields in schema are allowed but ignored by this engine
}

export interface SchemaCategory {
  id?: string;
  title: string;
  mandatory?: boolean;
  items: SchemaItem[];
}

export interface ScoringSchema {
  type?: string;
  totalMaxScore?: number;
  passThreshold?: number;
  categories: SchemaCategory[];
}

// Result provided to the engine per item
export interface ItemResult {
  score?: number; // explicit numeric score
  // Accept boolean or string status ('pass'|'fail') from translators or UI
  status?: boolean | 'pass' | 'fail';
  value?: any; // raw measured value (optional)
  threshold?: any; // optional threshold or target to display
}

// Engine output types
export interface EngineItemOutput {
  id: string;
  title: string;
  score: number | null;
  maxScore: number | null;
  status?: boolean | null;
}

export interface EngineCategoryOutput {
  title: string;
  score: number | null;
  maxScore: number | null;
  fail?: boolean; // true if any mandatory item of the category explicitly failed
  items: EngineItemOutput[];
}

// Strict output shape required by UI (numbers only, no nulls) plus compatibility breakdown
export interface EngineItemStrict {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'fail' | 'neutral';
}

export interface EngineCategoryStrict {
  title: string;
  score: number;
  maxScore: number;
  items: EngineItemStrict[];
}

export interface EngineOutput {
  overallScore: number;
  totalScore: number;
  maxScore: number;
  categories: EngineCategoryStrict[];
  fail?: boolean; // overall fail if any mandatory item failed
  // compatibility: breakdown used by some components (category per-item flattened)
  breakdown?: {
    category: string;
    score: number | null;
    maxScore: number | null;
    value?: any;
    threshold?: any;
    status?: boolean | null;
    feedback?: string;
  }[];
}

/**
 * Evaluate a scoring schema against provided results.
 * @param schema The scoring schema (source of truth for maxScore)
 * @param results Map of itemId -> ItemResult (engine uses only provided results)
 */
export function evaluateSchema(schema: ScoringSchema, results: Record<string, ItemResult | undefined>): EngineOutput {
  const categoriesOut: EngineCategoryOutput[] = [];

  let totalScoreAcc = 0;
  let anyScoreDefined = false;
  let totalMaxAcc = 0;
  let overallFail = false;

  for (const cat of schema.categories || []) {
    let catScoreAcc = 0;
    let catAnyScoreDefined = false;
    let catMaxAcc = 0;
    let catFail = false;

    const itemsOut: EngineItemOutput[] = [];

    for (const item of cat.items || []) {
      const itemId = String(item.id);
      const res = results ? results[itemId] : undefined;
      const itemMax = typeof item.maxScore === 'number' ? item.maxScore : null;
      let itemScore: number | null = null;
      let itemStatus: boolean | null = null;

      if (res !== undefined && res !== null) {
        if (typeof res.score === 'number') {
          itemScore = res.score;
        } else {
          // Accept both boolean status and string status ('pass'|'fail')
          const statusVal = res.status;
          const statusBool = (typeof statusVal === 'boolean') ? statusVal : (typeof statusVal === 'string' ? (statusVal === 'pass') : null);

          if (statusBool === true) {
            // explicit pass => full points
            itemScore = itemMax !== null ? itemMax : null;
          } else if (statusBool === false) {
            itemScore = itemMax !== null ? 0 : 0;
          }

          itemStatus = (typeof statusBool === 'boolean') ? statusBool : null;
        }
      }

      // If an item is mandatory and explicitly failed (status === false) mark category and overall fail
      if (item.mandatory === true && itemStatus === false) {
        catFail = true;
        overallFail = true;
      }

      if (itemScore !== null) {
        catScoreAcc += itemScore;
        catAnyScoreDefined = true;
      }

      if (itemMax !== null) {
        catMaxAcc += itemMax;
      }

      itemsOut.push({
        id: itemId,
        title: item.title,
        score: itemScore,
        maxScore: itemMax,
        status: itemStatus,
      });
    }

    // Accumulate totals only from schema max scores; totalScore sums only defined item scores
    if (catAnyScoreDefined) {
      totalScoreAcc += catScoreAcc;
      anyScoreDefined = true;
    }
    totalMaxAcc += catMaxAcc;

    categoriesOut.push({
      title: cat.title,
      score: catAnyScoreDefined ? catScoreAcc : null,
      maxScore: catMaxAcc > 0 ? catMaxAcc : null,
      fail: catFail || false,
      items: itemsOut,
    });
  }

  const output: EngineOutput = {
    // Strict numeric output: convert nulls to 0 to match required strict shape
    overallScore: anyScoreDefined ? totalScoreAcc : 0,
    totalScore: anyScoreDefined ? totalScoreAcc : 0,
    maxScore: totalMaxAcc > 0 ? totalMaxAcc : 0,
    categories: categoriesOut.map(cat => ({
      title: cat.title,
      score: cat.score !== null ? cat.score : 0,
      maxScore: cat.maxScore !== null ? cat.maxScore : 0,
      items: cat.items.map(it => ({
        id: it.id,
        title: it.title,
        score: it.score !== null ? it.score : 0,
        maxScore: it.maxScore !== null ? it.maxScore : 0,
        status: (it.status === true) ? 'pass' : (it.status === false) ? 'fail' : 'neutral'
      }))
    })),
    fail: overallFail || false,
    breakdown: []
  };

  // Build a compatibility breakdown array (flatten per-item) for components that expect it.
  const breakdown: EngineOutput['breakdown'] = [];
  for (const cat of categoriesOut) {
    for (const it of cat.items) {
      breakdown.push({
        category: it.title,
        score: it.score,
        maxScore: it.maxScore,
        value: undefined,
        threshold: undefined,
        status: it.status,
        feedback: undefined
      });
    }
  }

  output.breakdown = breakdown;

  return output;
}

export default evaluateSchema;
