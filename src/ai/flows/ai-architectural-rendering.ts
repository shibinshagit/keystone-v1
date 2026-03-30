'use server';
/**
 * @fileOverview Generates a photorealistic architectural rendering using NanoBanana API.
 *
 * Collects full building, plot, and design strategy details to create an accurate prompt.
 * Supports single or multi-building plots.
 * 
 * API: https://docs.nanobananaapi.ai/
 * Flow: POST /generate → get taskId → poll GET /record-info until done → return resultImageUrl
 */

import {
  type GenerateRenderingInput,
  type GenerateRenderingOutput,
  type RenderingProjectSummary,
} from '@/lib/types';

const NANO_BANANA_BASE = 'https://api.nanobananaapi.ai/api/v1/nanobanana';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60; // ~3 minutes max wait

/**
 * Creates a detailed architectural prompt from all building, plot and design parameters
 */
function createArchitecturalPrompt(input: GenerateRenderingInput): string {
  const { buildings, plot, design } = input;
  const numBuildings = buildings.length;
  const isSingle = numBuildings === 1;

  // Helper: describe floor count in terms AI image models understand better
  function floorCategory(n: number): string {
    if (n <= 2) return `very small ${n}-storey`;
    if (n <= 4) return `low-rise ${n}-storey`;
    if (n <= 6) return `low-rise ${n}-storey`;
    if (n <= 10) return `mid-rise ${n}-storey`;
    if (n <= 20) return `tall ${n}-storey`;
    return `high-rise ${n}-storey`;
  }

  // ── Building descriptions ────────────────────────────────────────
  const buildingDescriptions = buildings.map((b, i) => {
    const effectiveFloors = Math.max(1, b.numFloors);
    const floorH = (b.height / effectiveFloors).toFixed(1);
    const w = b.footprintWidth;
    const d = b.footprintDepth;
    const label = isSingle ? 'The building' : `Building ${i + 1} ("${b.name}")`;
    const positionDesc = b.position ? `, positioned on the ${b.position}` : '';

    let useStyle = '';
    if (b.intendedUse === 'Residential') useStyle = 'residential apartment';
    else if (b.intendedUse === 'Commercial' || b.intendedUse === 'Office') useStyle = 'commercial office';
    else if (b.intendedUse === 'Mixed-Use') useStyle = 'mixed-use (retail ground floor, residential upper)';
    else if (b.intendedUse === 'Retail') useStyle = 'retail';
    else if (b.intendedUse === 'Industrial') useStyle = 'industrial';
    else if (b.intendedUse === 'Public' || b.intendedUse === 'Hospitality') useStyle = 'public / hospitality';
    else useStyle = b.intendedUse;

    let typologyDesc = '';
    if (b.typology === 'point') typologyDesc = 'point tower (compact square/rectangular footprint)';
    else if (b.typology === 'slab') typologyDesc = 'slab block (elongated rectangular footprint)';
    else if (b.typology === 'lshaped') typologyDesc = 'L-shaped footprint';
    else if (b.typology === 'ushaped') typologyDesc = 'U-shaped footprint with courtyard';
    else if (b.typology === 'tshaped') typologyDesc = 'T-shaped footprint';
    else if (b.typology === 'hshaped') typologyDesc = 'H-shaped footprint';
    else if (b.typology === 'oshaped') typologyDesc = 'O-shaped (ring/donut) footprint with central courtyard';
    else typologyDesc = `${b.typology} shaped footprint`;

    let mixDesc = '';
    if (b.programMix) {
      const parts: string[] = [];
      if (b.programMix.residential > 0) parts.push(`${b.programMix.residential}% residential`);
      if (b.programMix.commercial > 0) parts.push(`${b.programMix.commercial}% commercial`);
      if (b.programMix.hospitality > 0) parts.push(`${b.programMix.hospitality}% hospitality`);
      if (b.programMix.institutional > 0) parts.push(`${b.programMix.institutional}% institutional`);
      if (parts.length > 1) mixDesc = ` Program mix: ${parts.join(', ')}.`;
    }

    // Describe floors explicitly so the AI model can "see" the count
    const floorLines: string[] = [];
    for (let f = 1; f <= b.numFloors; f++) {
      if (f === 1) floorLines.push('Ground floor (1st storey)');
      else if (f === b.numFloors) floorLines.push(`Top floor (${f}${f === 2 ? 'nd' : f === 3 ? 'rd' : 'th'} storey) with rooftop/terrace`);
    }
    let floorListDesc = '';
    if (b.numFloors === 1) {
      floorListDesc = ' It has 1 visible above-ground floor (single storey, ground level only).';
    } else if (b.numFloors <= 8) {
      const middleCount = b.numFloors - 2;
      floorListDesc = ` It has ${b.numFloors} visible above-ground floor slabs: ${floorLines.join(', ')}${middleCount > 0 ? `, and ${middleCount} middle floor${middleCount > 1 ? 's' : ''} between them` : ''}.`;
    }

    const basementDesc = b.basementFloors > 0
      ? ` The building has ${b.basementFloors} underground basement level${b.basementFloors > 1 ? 's' : ''} (not visible above ground — only the ramp entrance should be visible).`
      : '';

    const cat = floorCategory(b.numFloors);

    // Aspect ratio: building width vs height determines visual proportions
    const maxSide = Math.max(w, d);
    const proportionDesc = maxSide > b.height * 2 ? 'VERY WIDE and SHORT — the footprint is much larger than the height, it spreads horizontally'
      : maxSide > b.height ? 'wider than it is tall — a horizontally-oriented building'
      : 'taller than it is wide — a vertically-oriented tower';

    const footprintCoords = b.footprint
      ? ` Exact footprint polygon coordinates: ${JSON.stringify(b.footprint)}.`
      : '';
    const centerCoords = b.center
      ? ` Center point: (${b.center.x}, ${b.center.y}).`
      : '';
    const relativePosition = b.relativePosition
      ? ` Relative position from plot origin: (${b.relativePosition.x}, ${b.relativePosition.y}).`
      : '';
    const rotation = ` Orientation / rotation: ${b.rotation ?? 0} degrees.`;

    return `${label}: ${useStyle}, ${typologyDesc}, a ${cat} building${positionDesc}, ${Math.round(b.height)}m total height (${floorH}m floor-to-floor), footprint: ${w}m wide × ${d}m deep (~${Math.round(b.footprintArea)} sqm). The building is ${proportionDesc}.${floorListDesc}${basementDesc}${mixDesc}${footprintCoords}${centerCoords}${relativePosition}${rotation}`;
  }).join('\n');

  // ── Plot context ─────────────────────────────────────────────────
  const plotParts: string[] = [
    `Plot area: ${Math.round(plot.plotArea)} sqm`,
    `setback: ${plot.setback}m all sides`,
  ];
  if (plot.far) plotParts.push(`FAR: ${plot.far}`);
  if (plot.maxCoverage) plotParts.push(`max ground coverage: ${Math.round(plot.maxCoverage * 100)}%`);
  if (plot.greenAreas > 0) plotParts.push(`${plot.greenAreas} landscaped green area(s)`);
  if (plot.parkingAreas > 0) plotParts.push(`${plot.parkingAreas} parking zone(s)`);
  if (plot.regulationType) plotParts.push(`regulation: ${plot.regulationType}`);
  if (plot.origin) plotParts.push(`plot origin: (${plot.origin.x}, ${plot.origin.y})`);
  if (plot.footprint) plotParts.push(`plot footprint coordinates: ${JSON.stringify(plot.footprint)}`);
  const plotDesc = plotParts.join(', ');

  // ── Design strategy details ──────────────────────────────────────
  const designParts: string[] = [];
  if (design.hasPodium && design.podiumFloors > 0) {
    designParts.push(`The building sits on a ${design.podiumFloors}-floor podium base`);
  }
  if (design.parkingTypes.length > 0) {
    designParts.push(`Parking: ${design.parkingTypes.join(', ')}`);
  }
  if (design.selectedUtilities.length > 0) {
    designParts.push(`On-site utilities: ${design.selectedUtilities.join(', ')}`);
  }
  const unitMixEntries = Object.entries(design.unitMix).filter(([, v]) => v > 0);
  if (unitMixEntries.length > 0) {
    designParts.push(`Unit mix: ${unitMixEntries.map(([k, v]) => `${k} ${v}%`).join(', ')}`);
  }
  const designDesc = designParts.length > 0 ? designParts.join('. ') + '.' : '';

  // ── Materials based on primary use ───────────────────────────────
  const primaryUse = buildings[0].intendedUse;
  let materials = 'glass, concrete, modern facade materials';
  if (primaryUse === 'Residential') materials = 'glass, modern facade panels, warm lighting from windows, textured external finishes, balcony railings';
  else if (primaryUse === 'Commercial' || primaryUse === 'Office') materials = 'reflective glass curtain wall, aluminum frames, steel, contemporary signage';
  else if (primaryUse === 'Mixed-Use') materials = 'brick, glass, metal panels, vibrant street-level retail frontage';
  else if (primaryUse === 'Industrial') materials = 'concrete, metal cladding, industrial glass, minimal ornamentation';

  // ── Floor count emphasis ─────────────────────────────────────────
  const floorConstraints = buildings.map((b, i) => {
    const label = isSingle ? 'the building' : `building ${i + 1}`;
    if (b.numFloors <= 3) return `${label} is VERY SHORT — only ${b.numFloors} floors, barely taller than a house`;
    if (b.numFloors <= 6) return `${label} is LOW-RISE — only ${b.numFloors} floors, shorter than nearby trees`;
    if (b.numFloors <= 10) return `${label} is a MEDIUM building with ${b.numFloors} floors`;
    return `${label} has ${b.numFloors} floors`;
  }).join('; ');

  // ── Compose final prompt ─────────────────────────────────────────
  const buildingCountNote = `CRITICAL CONSTRAINT — BUILDING COUNT: There are EXACTLY ${numBuildings} building${isSingle ? '' : 's'} on this plot. Do NOT add extra buildings. Show ONLY ${numBuildings} building structure${isSingle ? '' : 's'}.`;
  const layoutConstraint = design.layoutConstraint || 'STRICT';

  const prompt = `Photorealistic 3D architectural rendering of a development site in ${plot.location}.

${buildingCountNote}
CRITICAL CONSTRAINT — LAYOUT: ${layoutConstraint}. Preserve exact building positions, spacing, orientation, scale, and layout based on the provided coordinates and footprint polygons. Do not rearrange, symmetrize, auto-place, or regularize the buildings.

BUILDINGS:
${buildingDescriptions}

PLOT: ${plotDesc}.

${designDesc}

Materials and finishes: ${materials}.
Rendering style: professional architectural visualization, photorealistic, daytime natural lighting,
clear blue sky, excellent detail clarity, high resolution 4K quality, depth of field, vibrant colors,
realistic shadows and reflections, professional architectural render, high-end visualization.
Camera angle: elevated 3/4 bird's-eye view showing the full plot with all buildings, landscaping, roads and context.

CRITICAL CONSTRAINT — FLOOR COUNT: ${floorConstraints}. Each above-ground floor must be clearly visible as a distinct horizontal band/slab on the facade. Basement floors are underground and NOT visible. Do NOT add extra floors. Do NOT make the building taller than specified. Count the visible floor lines carefully.
No watermarks or text overlay.`;

  return prompt;
}

export async function generateArchitecturalRendering(
  input: GenerateRenderingInput
): Promise<GenerateRenderingOutput> {
  // Guard: Next.js server action serialization can lose nested structure
  if (!input?.buildings?.length) {
    throw new Error('No buildings provided for rendering.');
  }

  const apiKey = process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    throw new Error('NANO_BANANA_API_KEY is not configured in environment variables.');
  }

  const prompt = createArchitecturalPrompt(input);

  // Step 1: Submit generation task
  let submitData: any;
  try {
    const submitRes = await fetch(`${NANO_BANANA_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        type: 'TEXTTOIAMGE',
        numImages: 1,
        image_size: '16:9',
        callBackUrl: 'https://localhost/noop', // required field; we poll instead
      }),
    });

    if (!submitRes.ok) {
      throw new Error('Image generation service is temporarily unavailable. Please try again.');
    }

    submitData = await submitRes.json();
  } catch (e) {
    if (e instanceof Error && e.message.includes('Image generation service')) throw e;
    throw new Error('Could not connect to image generation service. Check your internet connection and try again.');
  }

  if (submitData.code !== 200 || !submitData.data?.taskId) {
    throw new Error('Failed to start image generation. Please try again.');
  }

  const taskId = submitData.data.taskId;

  // Step 2: Poll for completion
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    let pollData: any;
    try {
      const pollRes = await fetch(
        `${NANO_BANANA_BASE}/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }
      );

      if (!pollRes.ok) continue;
      pollData = await pollRes.json();
    } catch {
      // Network hiccup during polling — retry
      continue;
    }

    const flag = pollData?.data?.successFlag;

    if (flag === 1) {
      // SUCCESS
      const rawUrl = pollData.data.response?.resultImageUrl
        || pollData.data.response?.originImageUrl;
      if (!rawUrl) {
        throw new Error('Image generation completed but no image was returned. Please try again.');
      }
      // Proxy through our API route to avoid TLS/network issues with tempfile host
      const imageUrl = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
      return { imageUrl, buildings: input.buildings, plot: input.plot, summary: {} as RenderingProjectSummary };
    }

    if (flag === 2 || flag === 3) {
      throw new Error('Image generation failed. Please try again with different parameters.');
    }
    // flag === 0 means still generating — continue polling
  }

  throw new Error('Image generation timed out. Please try again.');
}
