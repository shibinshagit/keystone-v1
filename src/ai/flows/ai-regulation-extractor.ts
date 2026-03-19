import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Parse and sanitize the AI response
function parseAndSanitize(rawText: string): any[] {
  // Strip markdown code fences
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
    text = text.trim();
  }

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    // Try truncated recovery
    return recoverTruncatedJson(text);
  }

  const jsonString = text.substring(firstBracket, lastBracket + 1);
  let parsed: any;
  
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return recoverTruncatedJson(text);
  }

  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }

  // Sanitize string values to numbers
  parsed = parsed.map((item: any) => {
    for (const cat of ['geometry', 'facilities', 'sustainability', 'safety_and_services', 'administration']) {
      if (item[cat] && typeof item[cat] === 'object') {
        for (const key of Object.keys(item[cat])) {
          const obj = item[cat][key];
          if (obj && typeof obj === 'object') {
            if ('value' in obj && typeof obj.value === 'string') {
              const m = obj.value.match(/[\d.]+/);
              obj.value = m ? parseFloat(m[0]) : null;
            }
          }
        }
      }
    }
    // FAR sanity
    if (item.geometry?.floor_area_ratio?.value > 20) {
      let f = item.geometry.floor_area_ratio.value;
      item.geometry.floor_area_ratio.value = (f >= 100 && f <= 500) ? f / 100 : 1.5;
    }
    // Coverage sanity
    if (item.geometry?.max_ground_coverage?.value > 100) {
      item.geometry.max_ground_coverage.value = 100;
    }
    return item;
  });

  return parsed;
}

// Recover entries from truncated JSON
function recoverTruncatedJson(rawText: string): any[] {
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  const firstBracket = text.indexOf('[');
  if (firstBracket === -1) return [];

  let jsonStr = text.substring(firstBracket);
  const lastComplete = jsonStr.lastIndexOf('},');
  if (lastComplete > 0) {
    jsonStr = jsonStr.substring(0, lastComplete + 1) + ']';
  } else {
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error('[Regulation Extractor] Recovery JSON.parse also failed:', (e as Error).message);
    console.error('[Regulation Extractor] Attempted to parse:', jsonStr.substring(0, 300));
    return [];
  }
}

export const extractRegulationData = ai.defineFlow(
  {
    name: 'extractRegulationData',
    inputSchema: z.object({
      documentText: z.string().describe('The full text content of the regulation document'),
      fileName: z.string().describe('The name of the source file for context'),
      overrideLocation: z.string().optional(),
      pdfBase64: z.string().optional().describe('Base64-encoded raw PDF bytes for Gemini Vision'),
    }),
  },
  async (input) => {
    const prompt = `You are a building regulation data extractor. Extract structured data from this document.

Document: ${input.fileName}

TASK:
Extract regulation data for EXACTLY these 5 zone types (use these exact names as the "type" field):
1. "Residential"
2. "Commercial"
3. "Industrial"
4. "Public"
5. "Mixed-Use"

Do NOT create subtypes like "Residential (Plotted)" or "Commercial (Retail)". Merge all residential subtypes into one "Residential" entry, all commercial subtypes into one "Commercial" entry, etc.
⚠️ DO NOT extract Hotels, Motels, Resorts, Service Apartments, or electrical/voltage data as zones.

${input.overrideLocation ? 
`LOCATION: Use exactly "${input.overrideLocation}" for all entries.` 
: 
`LOCATION: Determine the state/city from the document name or content.`}

RULES:
- Only extract data EXPLICITLY stated in the document. Do NOT guess or hallucinate.
- FAR must be a decimal (e.g. 1.5, 2.0). If you see "225" it means 2.25.
- Setbacks in meters. Coverage as percentage (0-100).
- For EACH zone, search the ENTIRE document and fill ALL fields you can find.
- ⚠️ NEVER set value to null. If multiple values exist (e.g. by plot size), pick the most typical/middle value.
- ⚠️ ALWAYS extract the ACTUAL NUMBER from the document, not just 1 or 0. Examples:
  • seismic_zone → extract the zone number (e.g. 4 or 5)
  • wind_load → extract the speed in m/s (e.g. 39)
  • soil_bearing_capacity → extract in kN/sqm (e.g. 200)
  • electrical_load_sanction → extract in kVA (e.g. 500)
  • sewage_treatment_plant → extract capacity in KLD (e.g. 50)
  • fire_exits_travel_distance → extract distance in m (e.g. 22.5)
  Only use 1/0 when the document ONLY says "required/not required" with NO specific number.
- ⚠️ Keep "desc" fields SHORT — max 50 characters.

Return a JSON array. Each value = {"desc": "...", "unit": "...", "value": <number>}

COMPLETE LIST OF FIELDS TO SEARCH FOR IN EACH ZONE:

"geometry": {
  "setback" (m), "front_setback" (m), "rear_setback" (m), "side_setback" (m),
  "road_width" (m), "max_ground_coverage" (%), "floor_area_ratio" (),
  "max_height" (m), "minimum_plot_size" (sqm), "minimum_frontage_width" (m),
  "density_norms" (DU/acre), "units_per_acre" (units/acre), "population_load" (persons/hectare),
  "premium_fsi_tdr" (), "premium_far_purchasable" (), "fungible_fsi_incentive" (),
  "fungible_far_incentive" (), "excluded_areas_calc" (), "exclusions_basement_services" (),
  "road_setback_building_line" (m), "highrise_setback_multiplier" (),
  "based_on_road_width" (m), "based_on_building_height" (m), "based_on_plot_size" (sqm),
  "height_vs_road_width" (), "aviation_clearance" (m), "shadow_skyline_control" ()
}

"facilities": {
  "parking" (spaces/unit), "open_space" (%), "entry_exit_width" (m),
  "internal_road_width" (m), "parking_ecs" (ECS), "visitor_parking" (%),
  "ramp_slope" (%), "turning_radius" (m), "staircase_width" (m),
  "staircase_count" (), "lift_requirements" (), "refuge_areas" (sqm),
  "corridor_widths" (m), "unit_size_compliance" (sqm)
}

"sustainability": {
  "rainwater_harvesting" (liters/sqm), "solar_panels" (% of roof),
  "leed_compliance" (), "igbc_compliance" (), "griha_compliance" (),
  "tree_plantation_green_cover" (%), "water_consumption_norm" (lpcd),
  "energy_efficiency" ()
}

"safety_and_services": {
  "fire_safety" (), "fire_tender_access" (m), "fire_tender_movement" (m),
  "staircases_by_height" (), "fire_exits_travel_distance" (m), "refuge_floors" (),
  "fire_fighting_systems" (), "fire_command_center" (),
  "water_supply_approval" (), "sewer_connection_stp" (), "stormwater_drainage" (),
  "electrical_load_sanction" (kVA), "transformer_placement" (),
  "backup_power_norms" (kVA), "gas_pipelines" (), "telecom_infrastructure" (),
  "sewage_treatment_plant" (KLD), "solid_waste_management" (),
  "seismic_zone" (), "wind_load" (m/s), "soil_bearing_capacity" (kN/sqm)
}

"administration": {
  "fee_rate" (% of cost), "land_use_zoning" (), "conversion_status" (),
  "land_use_category" (), "tod_rules" (), "special_zones" (),
  "saleable_vs_carpet_rera" (), "exit_compliance" (),
  "absorption_assumptions" (%/year), "infra_load_vs_financial_viability" ()
}

EXAMPLE OUTPUT STRUCTURE:
[
  {
    "location": "<state>",
    "type": "<zone name>",
    "geometry": { "front_setback": {"desc": "Front setback (3m for plots <200sqm, 5m for >200sqm)", "unit": "m", "value": 3}, ... },
    "facilities": { "parking": {"desc": "...", "unit": "spaces/unit", "value": 1}, ... },
    "sustainability": { "rainwater_harvesting": {"desc": "Required for plots >200sqm", "unit": "", "value": 1}, ... },
    "safety_and_services": { "fire_safety": {"desc": "...", "unit": "", "value": 1}, ... },
    "administration": { "fee_rate": {"desc": "...", "unit": "% of cost", "value": 0.1}, ... },
    "confidence": 0.9
  }
]

Only include fields found in the document. Search thoroughly — data appears across different chapters/tables/annexures.
Return ONLY the JSON array — no markdown fences, no explanation.`;

    let responseText: string;

    if (input.pdfBase64) {
      console.log(`[Regulation Extractor] Using Gemini Vision for PDF: ${input.fileName}`);
      try {
        let visionResponse = await ai.generate({
          model: 'googleai/gemini-2.5-flash',
          prompt: [
            { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
            { text: prompt },
          ],
          config: { maxOutputTokens: 65536, temperature: 0.1 },
        });
        responseText = visionResponse.text;
        console.log(`[Regulation Extractor] Gemini Vision response: ${responseText.length} chars`);

        // If response is suspiciously short, retry once
        if (responseText.length < 5000) {
          console.warn(`[Regulation Extractor] Response too short (${responseText.length} chars), retrying...`);
          visionResponse = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            prompt: [
              { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
              { text: prompt },
            ],
            config: { maxOutputTokens: 65536, temperature: 0.2 },
          });
          responseText = visionResponse.text;
          console.log(`[Regulation Extractor] Retry response: ${responseText.length} chars`);
        }
      } catch (err: any) {
        console.warn('[Regulation Extractor] Vision failed, falling back to text:', err.message);
        responseText = await textFallback(prompt, input.documentText);
      }
    } else {
      responseText = await textFallback(prompt, input.documentText);
    }

    let result = parseAndSanitize(responseText);
    if (result.length === 0) {
      console.error('[Regulation Extractor] No entries parsed. Raw response (first 1000 chars):', responseText.substring(0, 1000));
      // One more retry with text fallback before giving up
      if (input.documentText && input.documentText.length > 50) {
        console.log('[Regulation Extractor] Attempting text fallback...');
        const fallbackText = await textFallback(prompt, input.documentText);
        result = parseAndSanitize(fallbackText);
      }
      if (result.length === 0) {
        throw new Error('Could not extract any regulation data from the document');
      }
    }
    console.log(`[Regulation Extractor] Successfully extracted ${result.length} entries`);
    return result;
  }
);

async function textFallback(prompt: string, documentText: string): Promise<string> {
  console.log(`[Regulation Extractor] Using text-based extraction (${documentText.length} chars)`);
  const fullPrompt = prompt + `\n\nDocument Content:\n${documentText.slice(0, 120000)}`;
  const { text } = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: fullPrompt,
    config: { maxOutputTokens: 65536, temperature: 0.1 },
  });
  return text;
}
