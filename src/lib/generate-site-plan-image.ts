/**
 * @fileOverview Client-side site plan image generator for AI rendering control.
 *
 * Creates an off-screen HTML Canvas image showing:
 *   - Plot boundary polygon (exact shape)
 *   - Setback lines (dashed)
 *   - Building footprints at exact positions (color-coded by type)
 *   - Building labels (name + floors)
 *   - Green / parking / utility zones
 *   - North arrow, scale bar, legend
 *
 * The resulting PNG is used as a reference image for NanoBanana's
 * IMAGETOIAMGE mode to ensure spatial accuracy.
 */

import type { RenderingBuildingInfo, RenderingPlotInfo, RenderingProjectSummary } from '@/lib/types';

// ── Color palette for building types ────────────────────────────────────────
const USE_COLORS: Record<string, string> = {
  Residential: '#4A90D9',
  Commercial: '#2ECC71',
  Office: '#27AE60',
  'Mixed-Use': '#E67E22',
  Retail: '#9B59B6',
  Industrial: '#95A5A6',
  Public: '#E74C3C',
  Hospitality: '#F39C12',
};

const ZONE_COLORS = {
  green: 'rgba(46, 204, 113, 0.35)',
  parking: 'rgba(149, 165, 166, 0.35)',
  utility: 'rgba(230, 126, 34, 0.35)',
  buildable: 'rgba(52, 152, 219, 0.15)',
};

interface SitePlanInput {
  buildings: (RenderingBuildingInfo & {
    id: string;
    parts?: Array<{ type: 'podium' | 'tower' | 'main'; footprint: number[][][]; height: number }>;
  })[];
  plot: RenderingPlotInfo & { boundary?: number[][][], footprint?: number[][][] };
  parkingPolygons?: number[][][][];
  roadPolygons?: number[][][][];
  summary?: RenderingProjectSummary;
}

/**
 * Generates a site plan PNG as a Blob using an off-screen HTML Canvas.
 */
export async function generateSitePlanImage(input: SitePlanInput): Promise<Blob> {
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const PADDING = 120;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // ── Background — PURE WHITE for maximum contrast with buildings ──────────
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // NO grid pattern — it confuses the AI into seeing extra structures

  // ── Gather all coordinates to compute viewport ──────────────────────────
  const allPoints: [number, number][] = [];

  // Plot footprint — MUST use `footprint` (normalized) not `boundary` (absolute GeoJSON),
  // because building footprints are also normalized to the plot centroid.
  const plotCoords = input.plot.footprint?.[0] || [];
  plotCoords.forEach((p: number[]) => allPoints.push([p[0], p[1]]));

  // Building footprints (also normalized)
  input.buildings.forEach(b => {
    const outerRing = b.footprint?.[0];
    if (outerRing && outerRing.length >= 3) {
      outerRing.forEach((p: number[]) => allPoints.push([p[0], p[1]]));
    } else if (b.center) {
      // Fallback: use building center if footprint is missing
      allPoints.push([b.center.x, b.center.y]);
    }
  });

  console.log(`[SitePlan] Plot coords: ${plotCoords.length} points, Buildings: ${input.buildings.length}, Total points: ${allPoints.length}`);

  if (allPoints.length < 3) {
    // No usable geometry — return a blank image with text
    ctx.fillStyle = '#000000';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No geometry available for site plan', WIDTH / 2, HEIGHT / 2);
    return canvasToBlob(canvas);
  }

  // Compute bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  allPoints.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });

  const dataW = maxX - minX || 1;
  const dataH = maxY - minY || 1;
  const drawW = WIDTH - PADDING * 2;
  const drawH = HEIGHT - PADDING * 2;
  const scale = Math.min(drawW / dataW, drawH / dataH) * 0.9;
  const offsetX = PADDING + (drawW - dataW * scale) / 2;
  const offsetY = PADDING + (drawH - dataH * scale) / 2;

  // Transform function: data coords → canvas coords
  // We flip Y because canvas Y grows downward, but geo coords Y (lat) grows upward
  const tx = (x: number) => offsetX + (x - minX) * scale;
  const ty = (y: number) => offsetY + (maxY - y) * scale; // flip Y

  // Helper: draw polygon from coordinate ring
  const drawPolygon = (ring: number[][], fill?: string, stroke?: string, lineWidth = 2, dash: number[] = []) => {
    if (!ring || ring.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(tx(ring[0][0]), ty(ring[0][1]));
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(tx(ring[i][0]), ty(ring[i][1]));
    }
    ctx.closePath();
    ctx.setLineDash(dash);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
    ctx.setLineDash([]);
  };

  // ── Draw plot boundary — light gray outline ────────────────────────────
  if (plotCoords.length >= 3) {
    drawPolygon(plotCoords, '#F5F5F5', '#CCCCCC', 2);
  }

  // ── LAYER 1: Parking zones — light beige, clearly different from buildings ──
  if (input.parkingPolygons) {
    input.parkingPolygons.forEach(polygon => {
      const ring = polygon[0];
      if (ring && ring.length >= 3) {
        drawPolygon(ring, '#E8DCC8', '#C8B898', 1);
      }
    });
  }

  // ── LAYER 2: Road zones — medium gray ──────────────────────────────────
  if (input.roadPolygons) {
    input.roadPolygons.forEach(polygon => {
      const ring = polygon[0];
      if (ring && ring.length >= 3) {
        drawPolygon(ring, '#AAAAAA', '#888888', 1);
      }
    });
  }

  // ── LAYER 3: Green/open areas — fill center as light green ─────────────
  // Empty central area will naturally remain white, signaling "no building here"

  // ── LAYER 4: Building footprints — SOLID BLACK with thick white borders ──
  // This creates maximum contrast: black = building, white = not building
  const sortedBuildings = [...input.buildings].sort((a, b) => {
    const aIsPodium = typeof a.id === 'string' && a.id.includes('podium') ? -1 : 1;
    const bIsPodium = typeof b.id === 'string' && b.id.includes('podium') ? -1 : 1;
    return aIsPodium - bIsPodium;
  });

  sortedBuildings.forEach((b) => {
    const ring = b.footprint?.[0];
    const isPodium = typeof b.id === 'string' && b.id.includes('podium');

    if (ring && ring.length >= 3) {
      // Podiums: dark gray (#444), Towers: solid black (#111)
      const fillColor = isPodium ? '#555555' : '#111111';
      // THICK white border (5px) forces AI to see clear separation between buildings
      drawPolygon(ring, fillColor, '#FFFFFF', 5);
    } else if (b.center) {
      // Fallback: draw a solid dark circle
      const radius = Math.max(15, Math.sqrt(b.footprintArea) * scale * 0.3);
      ctx.beginPath();
      ctx.arc(tx(b.center.x), ty(b.center.y), radius, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  });

  // ── Building numbers: large white text on each building ─────────────────
  // These help the AI count buildings accurately
  const logicalBuildingIds = new Set(input.buildings.map(b => {
    if (typeof b.id === 'string') return b.id.replace(/-podium$/, '').replace(/-tower$/, '');
    return String(b.id);
  }));
  const logicalBuildingCount = logicalBuildingIds.size;

  let buildingNumber = 0;
  sortedBuildings.forEach((b) => {
    const isPodium = typeof b.id === 'string' && b.id.includes('podium');
    if (isPodium) return; // Don't number podiums separately

    buildingNumber++;
    const ring = b.footprint?.[0];
    let cx: number, cy: number;

    if (ring && ring.length >= 3) {
      cx = ring.reduce((s: number, p: number[]) => s + p[0], 0) / ring.length;
      cy = ring.reduce((s: number, p: number[]) => s + p[1], 0) / ring.length;
    } else if (b.center) {
      cx = b.center.x;
      cy = b.center.y;
    } else {
      return;
    }

    // Large, bold number centered on each building footprint  
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(buildingNumber), tx(cx), ty(cy));
  });

  // ── NO title, no scale bar, no north arrow ─────────────────────────────
  // All text decorations are visual noise that confuses the AI.
  // The building count is already in the prompt text.

  // ── NO legend — it adds visual noise that the AI misinterprets as structures ──

  return canvasToBlob(canvas);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
      1.0
    );
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
