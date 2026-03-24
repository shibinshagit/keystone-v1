/**
 * Master Plan PDF Extractor
 * 
 * Uses Gemini Vision to extract zoning & FAR rules from municipal
 * master plan PDFs (e.g., Delhi Master Plan 2041).
 * 
 * Reuses the same Genkit AI instance and Gemini 2.5 Flash model
 * as the existing regulation extractor.
 */

import { ai } from '@/ai/genkit';
import type { MasterPlanData, MasterPlanZone } from '@/lib/types';

const MASTER_PLAN_PROMPT = `You are an expert urban planning document analyzer. Extract structured zoning and development regulation data from this Master Plan PDF.

TASK:
Extract ALL development zones defined in this master plan. For each zone, extract:
- Zone name and classification (e.g., "Residential Zone R1", "Commercial Zone C2")
- Permitted land uses (list of allowed activities)
- Conditional uses (uses allowed with special permission)
- Prohibited uses (explicitly banned activities)
- FAR / FSI (Floor Area Ratio — must be a decimal like 1.5, 2.0, 3.5)
- Maximum building height (in meters)
- Maximum ground coverage (as percentage 0-100)
- Minimum plot size (in sqm) if specified
- Density norms (dwelling units per hectare) if specified
- Setback requirements (front, rear, side — in meters)
- Change of Land Use (CLU) provisions or process notes
- Any special remarks or conditions

ALSO EXTRACT (at the plan level):
- City name
- Master plan name and year (e.g., "Delhi Master Plan 2041")
- General FAR rules or formulas that apply across zones
- Transit-Oriented Development (TOD) provisions
- Green belt or no-development zone rules

RULES:
- Only extract data EXPLICITLY stated in the document. Do NOT guess.
- FAR must be a decimal (e.g., 1.5, 2.0). If you see "150" it likely means 1.5 or 150%.
- Heights in meters. Setbacks in meters. Coverage as percentage.
- If the plan uses Indian terms (FSI instead of FAR), convert appropriately.
- If a zone has multiple sub-categories, merge them into the parent zone with the most permissive values and note differences in remarks.
- Search the ENTIRE document — data is often scattered across chapters, annexures, and tables.

Return ONLY a JSON object (no markdown fences) with this structure:
{
  "cityName": "...",
  "planName": "...",
  "planYear": 2041,
  "zones": [
    {
      "zoneName": "Residential Zone R1",
      "permittedUses": ["Group Housing", "Plotted Development", ...],
      "conditionalUses": ["Nursing Home", ...],
      "prohibitedUses": ["Industrial", ...],
      "far": 2.0,
      "maxHeight": 30,
      "maxCoverage": 40,
      "minPlotSize": 200,
      "densityDU": 500,
      "setbacks": { "front": 9, "rear": 3, "side": 3 },
      "cluProvisions": "CLU possible for mixed-use with DDA approval",
      "remarks": "..."
    }
  ],
  "generalFARRules": "...",
  "transitOrientedDev": "...",
  "greenBeltRules": "...",
  "confidence": 0.85
}`;

/**
 * Parse and sanitize the AI response for master plan data
 */
function parseMasterPlanResponse(rawText: string, fileName: string): MasterPlanData {
  let text = rawText.trim();

  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
    text = text.trim();
  }

  // Find the JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Could not find JSON object in AI response');
  }

  const jsonStr = text.substring(firstBrace, lastBrace + 1);
  let parsed: any;

  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // Try recovery: find last complete zone entry
    const lastComplete = jsonStr.lastIndexOf('},');
    if (lastComplete > 0) {
      const recovered = jsonStr.substring(0, lastComplete + 1) + ']}';
      try {
        parsed = JSON.parse(recovered);
      } catch {
        throw new Error(`Failed to parse master plan JSON: ${(e as Error).message}`);
      }
    } else {
      throw new Error(`Failed to parse master plan JSON: ${(e as Error).message}`);
    }
  }

  // Sanitize zones
  const zones: MasterPlanZone[] = (parsed.zones || []).map((z: any) => {
    let far = parseFloat(z.far || '0');
    if (far > 20) far = far >= 100 ? far / 100 : 1.5;

    let maxCoverage = parseFloat(z.maxCoverage || z.max_coverage || '0');
    if (maxCoverage > 100) maxCoverage = 100;

    return {
      zoneName: z.zoneName || z.zone_name || 'Unknown Zone',
      permittedUses: Array.isArray(z.permittedUses) ? z.permittedUses : [],
      conditionalUses: Array.isArray(z.conditionalUses) ? z.conditionalUses : undefined,
      prohibitedUses: Array.isArray(z.prohibitedUses) ? z.prohibitedUses : undefined,
      far,
      maxHeight: parseFloat(z.maxHeight || z.max_height || '0'),
      maxCoverage,
      minPlotSize: z.minPlotSize ? parseFloat(z.minPlotSize) : undefined,
      densityDU: z.densityDU ? parseFloat(z.densityDU) : undefined,
      setbacks: z.setbacks ? {
        front: parseFloat(z.setbacks.front || '0'),
        rear: parseFloat(z.setbacks.rear || '0'),
        side: parseFloat(z.setbacks.side || '0'),
      } : undefined,
      cluProvisions: z.cluProvisions || z.clu_provisions || undefined,
      remarks: z.remarks || undefined,
    } satisfies MasterPlanZone;
  });

  return {
    cityName: parsed.cityName || parsed.city_name || 'Unknown',
    planName: parsed.planName || parsed.plan_name || fileName,
    planYear: parseInt(parsed.planYear || parsed.plan_year || '2024', 10),
    zones,
    generalFARRules: parsed.generalFARRules || parsed.general_far_rules || undefined,
    transitOrientedDev: parsed.transitOrientedDev || parsed.transit_oriented_dev || undefined,
    greenBeltRules: parsed.greenBeltRules || parsed.green_belt_rules || undefined,
    confidence: parseFloat(parsed.confidence || '0.5'),
    source: fileName,
  };
}

/**
 * Extract master plan data from a PDF using Gemini Vision
 */
export async function extractMasterPlanData(input: {
  pdfBase64: string;
  fileName: string;
  fallbackText?: string;
}): Promise<MasterPlanData> {
  console.log(`[MasterPlan] Extracting from: ${input.fileName}`);

  let responseText: string;

  try {
    // Try Gemini Vision first (best for tables and diagrams)
    let response = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      prompt: [
        { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
        { text: MASTER_PLAN_PROMPT },
      ],
      config: { maxOutputTokens: 65536, temperature: 0.1 },
    });
    responseText = response.text;
    console.log(`[MasterPlan] Gemini Vision response: ${responseText.length} chars`);

    // Retry if response is too short
    if (responseText.length < 3000) {
      console.warn(`[MasterPlan] Response too short (${responseText.length}), retrying...`);
      response = await ai.generate({
        model: 'googleai/gemini-2.5-flash',
        prompt: [
          { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
          { text: MASTER_PLAN_PROMPT },
        ],
        config: { maxOutputTokens: 65536, temperature: 0.2 },
      });
      responseText = response.text;
    }
  } catch (err: any) {
    console.warn('[MasterPlan] Vision failed, trying text fallback:', err.message);

    if (!input.fallbackText || input.fallbackText.length < 100) {
      throw new Error('Gemini Vision failed and no fallback text available');
    }

    const fullPrompt = MASTER_PLAN_PROMPT + `\n\nDocument Content:\n${input.fallbackText.slice(0, 120000)}`;
    const { text } = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      prompt: fullPrompt,
      config: { maxOutputTokens: 65536, temperature: 0.1 },
    });
    responseText = text;
  }

  const result = parseMasterPlanResponse(responseText, input.fileName);
  console.log(`[MasterPlan] Extracted ${result.zones.length} zones from ${result.planName} (${result.cityName})`);

  return result;
}

export default extractMasterPlanData;
