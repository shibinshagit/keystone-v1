import { ai } from "@/ai/genkit";
import { z } from "genkit";

function parseAndSanitize(rawText: string): any[] {
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "");
    text = text.replace(/\n?```\s*$/, "");
    text = text.trim();
  }

  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
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

  parsed = parsed.map((item: any) => {
    for (const category of [
      "geometry",
      "highrise",
      "facilities",
      "sustainability",
      "safety_and_services",
      "administration",
    ]) {
      if (item[category] && typeof item[category] === "object") {
        for (const key of Object.keys(item[category])) {
          const field = item[category][key];
          if (field && typeof field === "object" && "value" in field && typeof field.value === "string") {
            const match = field.value.match(/[\d.]+/);
            field.value = match ? parseFloat(match[0]) : null;
          }
        }
      }
    }

    if (item.geometry?.floor_area_ratio?.value > 20) {
      const far = item.geometry.floor_area_ratio.value;
      item.geometry.floor_area_ratio.value = far >= 100 && far <= 500 ? far / 100 : 1.5;
    }

    if (item.geometry?.floor_area_ratio?.value === 0) {
      item.geometry.floor_area_ratio.value = "";
    }

    if (item.geometry?.max_ground_coverage?.value > 100) {
      item.geometry.max_ground_coverage.value = 100;
    }

    if (item.highrise && typeof item.highrise === "object") {
      for (const key of Object.keys(item.highrise)) {
        const field = item.highrise[key];
        if (!field || typeof field !== "object") continue;

        if (key.startsWith("far_") && field.value > 20) {
          const far = field.value;
          field.value = far >= 100 && far <= 500 ? far / 100 : "";
        }

        if (key.startsWith("far_") && field.value === 0) {
          field.value = "";
        }

        if (key.startsWith("coverage_") && field.value > 100) {
          field.value = 100;
        }
      }
    }

    return item;
  });

  return parsed;
}

function recoverTruncatedJson(rawText: string): any[] {
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }

  const firstBracket = text.indexOf("[");
  if (firstBracket === -1) return [];

  let jsonString = text.substring(firstBracket);
  const lastComplete = jsonString.lastIndexOf("},");

  if (lastComplete > 0) {
    jsonString = jsonString.substring(0, lastComplete + 1) + "]";
  } else {
    const lastBrace = jsonString.lastIndexOf("}");
    if (lastBrace > 0) {
      jsonString = jsonString.substring(0, lastBrace + 1) + "]";
    }
  }

  try {
    const parsed = JSON.parse(jsonString);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.error(
      "[Regulation Extractor] Recovery JSON.parse also failed:",
      (error as Error).message,
    );
    console.error(
      "[Regulation Extractor] Attempted to parse:",
      jsonString.substring(0, 300),
    );
    return [];
  }
}

function isUsaPilotDocument(input: {
  documentText: string;
  fileName: string;
  overrideLocation?: string;
}) {
  const sample = `${input.overrideLocation || ""} ${input.fileName} ${input.documentText.slice(0, 6000)}`.toLowerCase();

  return [
    "austin",
    "phoenix",
    "seattle",
    "international building code",
    "international residential code",
    "ibc",
    "irc",
    "united states",
    "phoenix building construction code",
    "seattle building code",
    "zoning ordinance",
    "zoning code",
    "land development code",
    "municode",
    "arcgis",
    "site development standards",
    "development standards",
    "setback",
    "lot coverage",
    "floor area ratio",
  ].some((needle) => sample.includes(needle));
}

function isUsaPilotZoningDocument(input: {
  documentText: string;
  fileName: string;
  overrideLocation?: string;
}) {
  const sample = `${input.overrideLocation || ""} ${input.fileName} ${input.documentText.slice(0, 6000)}`.toLowerCase();

  return [
    "zoning ordinance",
    "zoning code",
    "land development code",
    "municode",
    "arcgis",
    "site development standards",
    "development standards",
    "dimensional standards",
    "lot coverage",
    "floor area ratio",
    "setback",
    "front yard",
    "rear yard",
    "side yard",
    "maximum height",
  ].some((needle) => sample.includes(needle));
}

function buildPrompt(input: {
  documentText: string;
  fileName: string;
  overrideLocation?: string;
}) {
  const usaMode = isUsaPilotDocument(input);
  const usaZoningMode = usaMode && isUsaPilotZoningDocument(input);
  const locationInstruction = input.overrideLocation
    ? `Use exactly "${input.overrideLocation}" as the location for every extracted entry.`
    : "Infer the location from the document title or body.";

  const commonSchema = `
Return a JSON array where each object has this shape:
{
  "location": "City / state name",
  "type": "Residential | Commercial | Industrial | Public | Mixed Use",
  "confidence": 0.9,
  "geometry": { "field_name": {"desc": "...", "unit": "...", "value": 1} },
  "highrise": { ... },
  "facilities": { ... },
  "sustainability": { ... },
  "safety_and_services": { ... },
  "administration": { ... }
}

Use exactly these 5 types:
- Residential
- Commercial
- Industrial
- Public
- Mixed Use

Do not create subtypes. Merge the document's specific subcategories into those 5 buckets.
Only extract values explicitly stated in the document. If a field is not clearly stated, omit it.
Never use null or 0 for missing FAR, setbacks, coverage, or key life-safety dimensions.
Keep desc fields short.

Supported fields:
geometry: setback, front_setback, rear_setback, side_setback, road_width, max_ground_coverage, floor_area_ratio, max_height, minimum_plot_size, minimum_frontage_width, density_norms, units_per_acre, population_load, premium_fsi_tdr, premium_far_purchasable, fungible_fsi_incentive, fungible_far_incentive, excluded_areas_calc, exclusions_basement_services, road_setback_building_line, highrise_setback_multiplier, based_on_road_width, based_on_building_height, based_on_plot_size, height_vs_road_width, aviation_clearance, shadow_skyline_control
highrise: highrise_threshold, front_setback_upto_15m, front_setback_15_to_24m, front_setback_24_to_45m, front_setback_above_45m, rear_setback_upto_15m, rear_setback_15_to_24m, rear_setback_24_to_45m, rear_setback_above_45m, side_setback_upto_15m, side_setback_15_to_24m, side_setback_24_to_45m, side_setback_above_45m, coverage_upto_15m, coverage_15_to_24m, coverage_24_to_45m, coverage_above_45m, far_upto_15m, far_15_to_24m, far_24_to_45m, far_above_45m, min_plot_area_highrise, min_road_width_highrise, max_floors, max_building_height, stilt_floor_height, floor_to_floor_height, basement_depth, basement_levels_allowed, podium_height, podium_coverage, setback_above_podium, tower_coverage_above_podium, green_building_mandate_height, structural_audit_threshold, helipad_required_height, refuge_floor_interval, refuge_floor_area, pressurized_staircase_threshold, fire_lift_threshold, fire_command_center_threshold
facilities: parking, open_space, entry_exit_width, internal_road_width, parking_ecs, visitor_parking, ramp_slope, turning_radius, staircase_width, staircase_count, lift_requirements, refuge_areas, corridor_widths, unit_size_compliance
safety_and_services: fire_safety, fire_tender_access, fire_tender_movement, staircases_by_height, fire_exits_travel_distance, refuge_floors, fire_fighting_systems, fire_command_center, water_supply_approval, sewer_connection_stp, stormwater_drainage, electrical_load_sanction, transformer_placement, backup_power_norms, gas_pipelines, telecom_infrastructure, sewage_treatment_plant, solid_waste_management, seismic_zone, wind_load, soil_bearing_capacity
administration: fee_rate, land_use_zoning, conversion_status, land_use_category, tod_rules, special_zones, saleable_vs_carpet_rera, exit_compliance, absorption_assumptions, infra_load_vs_financial_viability

Return only the JSON array and nothing else.
`;

  if (usaMode) {
    if (usaZoningMode) {
      return `You are an expert USA zoning regulation extractor for the Keystone USA pilot.

Document: ${input.fileName}
Location instruction: ${locationInstruction}

Focus on zoning ordinances, site development standards, dimensional tables, and official city summaries for Austin, Phoenix, and Seattle.
Priority order:
1. FAR, height, setbacks, lot coverage, minimum lot size, frontage, and units per acre.
2. Zoning district names and land-use notes that help explain which representative baseline is being extracted.
3. TOD, overlay, or special-zone rules only when explicitly described.
4. Open space requirements when clearly numeric.

USA zoning extraction rules:
- Convert feet and square feet to meters and square meters before returning numeric values.
- If the document is district-specific, map it into the closest of the 5 allowed use buckets and store the district name in administration.land_use_zoning.
- Prefer explicit zoning envelope values over narrative descriptions.
- Do not invent building-code life-safety values from zoning documents.
- If a value varies by district, frontage, adjacency, or height tier, prefer the representative baseline that is clearly stated for the district being discussed and mention the condition briefly in desc.

${commonSchema}`;
    }

    return `You are an expert USA building-code regulation extractor for the Keystone USA pilot.

Document: ${input.fileName}
Location instruction: ${locationInstruction}

Focus on IBC / IRC / locally adopted building-code amendments for Austin, Phoenix, and Seattle.
Priority order:
1. High-rise trigger and high-rise-only life-safety rules.
2. Stair width, stair count, corridor width, elevator / fire-service elevator requirements.
3. Exit access travel distance, fire command center trigger, fire apparatus access width.
4. Maximum building height or max floors only when explicitly stated in the building code or amendment.
5. Accessibility / egress dimensional requirements that fit the schema.

USA extraction rules:
- Convert feet and inches to meters before returning numeric values.
- If both sprinklered and unsprinklered values are given, prefer the sprinklered high-rise or multifamily baseline and mention that briefly in desc.
- Do not invent FAR, lot coverage, or zoning setbacks from building-code documents. Only populate those geometry fields if the document explicitly states them.
- For Residential, use IRC for one- and two-family / townhouse provisions, but use IBC provisions when the document clearly applies them to multifamily or high-rise residential.
- If a page only states the adopted code edition, you may map the code family context into administration or highrise notes, but do not fabricate dimensional numbers.

${commonSchema}`;
  }

  return `You are an expert high-rise development regulation extractor.

Document: ${input.fileName}
Location instruction: ${locationInstruction}

Primary focus:
1. Setbacks, coverage, FAR / FSI, and height restrictions.
2. High-rise tables that vary by height or road width.
3. Structural and fire requirements for taller buildings.
4. Minimum plot area or road width thresholds for larger buildings.

Rules:
- FAR must be a decimal like 1.5 or 2.25.
- If FAR, setbacks, or coverage are not clearly stated, omit them instead of guessing.
- For multiple values, prefer the strictest high-rise / tallest-building tier.
- Always extract actual numeric values when the document provides them.

${commonSchema}`;
}

export const extractRegulationData = ai.defineFlow(
  {
    name: "extractRegulationData",
    inputSchema: z.object({
      documentText: z.string().describe("The full text content of the regulation document"),
      fileName: z.string().describe("The name of the source file for context"),
      overrideLocation: z.string().optional(),
      pdfBase64: z
        .string()
        .optional()
        .describe("Base64-encoded raw PDF bytes for Gemini Vision"),
    }),
  },
  async (input) => {
    const prompt = buildPrompt(input);
    let responseText: string;

    if (input.pdfBase64) {
      console.log(`[Regulation Extractor] Using Gemini Vision for PDF: ${input.fileName}`);
      try {
        let visionResponse = await ai.generate({
          model: "googleai/gemini-3.1-pro-preview",
          prompt: [
            {
              media: {
                contentType: "application/pdf",
                url: `data:application/pdf;base64,${input.pdfBase64}`,
              },
            },
            { text: prompt },
          ],
          config: { maxOutputTokens: 65536, temperature: 0.1 },
        });
        responseText = visionResponse.text;
        console.log(`[Regulation Extractor] Gemini Vision response: ${responseText.length} chars`);

        if (responseText.length < 5000) {
          console.warn(
            `[Regulation Extractor] Response too short (${responseText.length} chars), retrying...`,
          );
          visionResponse = await ai.generate({
            model: "googleai/gemini-3.1-pro-preview",
            prompt: [
              {
                media: {
                  contentType: "application/pdf",
                  url: `data:application/pdf;base64,${input.pdfBase64}`,
                },
              },
              { text: prompt },
            ],
            config: { maxOutputTokens: 65536, temperature: 0.2 },
          });
          responseText = visionResponse.text;
          console.log(`[Regulation Extractor] Retry response: ${responseText.length} chars`);
        }
      } catch (error: any) {
        console.warn("[Regulation Extractor] Vision failed, falling back to text:", error.message);
        responseText = await textFallback(prompt, input.documentText);
      }
    } else {
      responseText = await textFallback(prompt, input.documentText);
    }

    let result = parseAndSanitize(responseText);
    if (result.length === 0) {
      console.error(
        "[Regulation Extractor] No entries parsed. Raw response (first 1000 chars):",
        responseText.substring(0, 1000),
      );

      if (input.documentText && input.documentText.length > 50) {
        console.log("[Regulation Extractor] Attempting text fallback...");
        const fallbackText = await textFallback(prompt, input.documentText);
        result = parseAndSanitize(fallbackText);
      }

      if (result.length === 0) {
        throw new Error("Could not extract any regulation data from the document");
      }
    }

    console.log(`[Regulation Extractor] Successfully extracted ${result.length} entries`);
    return result;
  },
);

async function textFallback(prompt: string, documentText: string): Promise<string> {
  console.log(`[Regulation Extractor] Using text-based extraction (${documentText.length} chars)`);
  const fullPrompt = `${prompt}\n\nDocument Content:\n${documentText.slice(0, 120000)}`;
  const { text } = await ai.generate({
    model: "googleai/gemini-3.1-pro-preview",
    prompt: fullPrompt,
    config: { maxOutputTokens: 65536, temperature: 0.1 },
  });
  return text;
}
