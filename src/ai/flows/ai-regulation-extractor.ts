import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateWithFallback } from '@/ai/model-fallback';

// Schema matching the RegulationData structure
const RegulationValueSchema = z.object({
  desc: z.string(),
  unit: z.string(),
  value: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const ExtractedRegulationSchema = z.object({
  location: z.string().describe('The geographic location this regulation applies to (e.g., "Kerala", "Mumbai", "Andhra Pradesh")'),
  type: z.string().describe('The regulation type/category (e.g., "Residential", "Commercial", "Mixed-Use")'),
  geometry: z.object({
    setback: RegulationValueSchema.optional(),
    front_setback: RegulationValueSchema.optional(),
    rear_setback: RegulationValueSchema.optional(),
    side_setback: RegulationValueSchema.optional(),
    road_width: RegulationValueSchema.optional(),
    max_ground_coverage: RegulationValueSchema.optional(),
    floor_area_ratio: RegulationValueSchema.optional(),
    max_height: RegulationValueSchema.optional(),
  }).describe('Geometric constraints and spatial requirements'),
  facilities: z.object({
    parking: RegulationValueSchema.optional(),
    open_space: RegulationValueSchema.optional(),
  }).describe('Facility and amenity requirements'),
  sustainability: z.object({
    rainwater_harvesting: RegulationValueSchema.optional(),
    solar_panels: RegulationValueSchema.optional(),
  }).describe('Environmental and sustainability requirements'),
  safety_and_services: z.object({
    fire_safety: RegulationValueSchema.optional(),
  }).describe('Safety standards and service requirements'),
  administration: z.object({
    fee_rate: RegulationValueSchema.optional(),
  }).describe('Administrative fees and processing costs'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this extraction (0-1)'),
});

export const extractRegulationData = ai.defineFlow(
  {
    name: 'extractRegulationData',
    inputSchema: z.object({
      documentText: z.string().describe('The full text content of the regulation document'),
      fileName: z.string().describe('The name of the source file for context'),
      overrideLocation: z.string().optional().describe('Force the AI to tag extracted rules with this precise location'),
    }),
    outputSchema: z.array(ExtractedRegulationSchema),
  },
  async (input) => {
    const prompt = `You are an expert at extracting structured building regulation data from documents.

Document: ${input.fileName}
Content:
${input.documentText.slice(0, 80000)}${input.documentText.length > 80000 ? '\n\n[Document truncated for processing...]' : ''}

Task:
1. **EXTRACT ALL** land use types and subtypes mentioned. Do NOT limit to a few examples.
   - Look for specific categories like "Residential Plotted", "Residential Group Housing", "Commercial Local Shopping", "Commercial General", "Industrial Light", etc.
   - If there are 20 different table columns for different uses, create 20 separate entries.
2. **SANITIZATION**:
   - **FAR**: Must be a small decimal (e.g. 1.5, 2.0, 3.5). If you see "225" and it represents area, IGNORE it. If you see "225" and it means 2.25, use 2.25.
   - **Coverage**: Must be Percentage (0-100).
   - **Setback**: 
     - Look for specific **Front**, **Rear**, and **Side** setbacks if mentioned.
     - If only a general "Setback" is mentioned, use the 'setback' field.
     - Values must be in meters.

Andaman and Nicobar Islands, Andhra Pradesh, Arunachal Pradesh, Assam, Bihar, Chandigarh, Chhattisgarh, Dadra and Nagar Haveli and Daman and Diu, Delhi, Goa, Gujarat, Haryana, Himachal Pradesh, Jammu and Kashmir, Jharkhand, Karnataka, Kerala, Ladakh, Lakshadweep, Madhya Pradesh, Maharashtra, Manipur, Meghalaya, Mizoram, Nagaland, Odisha, Puducherry, Punjab, Rajasthan, Sikkim, Tamil Nadu, Telangana, Tripura, Uttar Pradesh, Uttarakhand, West Bengal, National (NBC)

**CRITICAL LOCATION RULES**: 
${input.overrideLocation ? 
`🔥 USER OVERRIDE ACTIVE 🔥
You MUST set the \`location\` field to exactly "${input.overrideLocation}" for EVERY single extracted regulation in the JSON. Ignore the document's text/state if it contradicts this override.` 
: 
`- Determine the \`location\` based EXACTLY on the state or city mentioned in the Document name or the Document text.
- **DO NOT** lump "Telangana" and "Andhra Pradesh" together. If the document is for Telangana, the location MUST be "Telangana". If it is for Andhra Pradesh, it MUST be "Andhra Pradesh". Pay close attention to the file name.`}

**Type**: use the SPECIFIC ZONE NAME from the document (e.g. "Residential Plotted", "Residential Group Housing", "Commercial C-1").
**CRITICAL**: Do NOT simplify to just "Residential" or "Commercial" if distinct subtypes exist. We need separate entries for each subtype.

Return a JSON array of objects.
[
  {
    "location": "Delhi",
    "type": "Residential - Plotted",
    "geometry": {
      "front_setback": {"desc": "Min front setback", "unit": "m", "value": 3, "min": 2, "max": 6},
      "rear_setback": {"desc": "Min rear setback", "unit": "m", "value": 2, "min": 1, "max": 4},
      "side_setback": {"desc": "Min side setback", "unit": "m", "value": 2, "min": 1, "max": 4},
      "setback": {"desc": "General setback", "unit": "m", "value": 3, "min": 2, "max": 6},
      "road_width": {"desc": "Adjacent road width", "unit": "m", "value": 12, "min": 6, "max": 30},
      "max_ground_coverage": {"desc": "Maximum ground coverage", "unit": "%", "value": 60, "min": 10, "max": 80},
      "floor_area_ratio": {"desc": "FAR/FSI value", "unit": "", "value": 2.0, "min": 0.5, "max": 5},
      "max_height": {"desc": "Maximum building height", "unit": "m", "value": 15, "min": 10, "max": 100}
    },
    "facilities": {
      "parking": {"desc": "Parking spaces per unit", "unit": "spaces/unit", "value": 1, "min": 0.5, "max": 3},
      "open_space": {"desc": "Required open space", "unit": "%", "value": 20, "min": 5, "max": 50}
    },
    "sustainability": {
      "rainwater_harvesting": {"desc": "Capacity", "unit": "liters/sqm", "value": 50, "min": 10, "max": 100},
      "solar_panels": {"desc": "Solar coverage", "unit": "% of roof", "value": 30, "min": 0, "max": 100}
    },
    "safety_and_services": {
      "fire_safety": {"desc": "Compliance level", "unit": "", "value": 2, "min": 1, "max": 3}
    },
    "administration": {
      "fee_rate": {"desc": "Processing fee", "unit": "% of cost", "value": 0.5, "min": 0.05, "max": 1}
    },
    "confidence": 0.9
  }
]
`;

    // Use fallback mechanism with OpenAI as primary
    const text = await generateWithFallback(prompt);

    // Parse the JSON response
    try {
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');

      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        throw new Error('No JSON array found in response');
      }

      const jsonString = text.substring(firstBracket, lastBracket + 1);
      let parsed = JSON.parse(jsonString);

      // Ensure it's an array
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }

      // SANITIZATION STEP
      parsed = parsed.map((item: any) => {
        // Sanitize Geometry
        if (item.geometry) {
          // FAR Sanity Check
          if (item.geometry.floor_area_ratio) {
            let far = item.geometry.floor_area_ratio.value;
            // If FAR > 20, it's likely an error (e.g. 225) or percentage disguised as number
            if (far > 20) {
              if (far >= 100 && far <= 500) {
                // Maybe it's missing decimal? 225 -> 2.25
                far = far / 100;
              } else {
                // Reset to safe default or null
                far = 1.5;
              }
              item.geometry.floor_area_ratio.value = far;
            }
          }
          // Max Ground Coverage Check
          if (item.geometry.max_ground_coverage) {
            let cov = item.geometry.max_ground_coverage.value;
            if (cov > 100) cov = 100;
            item.geometry.max_ground_coverage.value = cov;
          }
        }

        // Ensure Location matches valid list or fallback
        // (Optional: Implement robust location mapping if needed)

        return item;
      });

      return parsed as z.infer<typeof ExtractedRegulationSchema>[];
    } catch (e) {
      console.error('Failed to parse AI response:', text);
      throw new Error('Failed to parse regulation data from AI response');
    }
  }
);
