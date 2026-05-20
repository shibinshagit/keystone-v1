import { NextRequest, NextResponse } from "next/server";
import HaryanaParcelService from "@/services/india/haryana";

type OverlayFeaturesPayload = {
  bounds?: {
    west?: number;
    south?: number;
    east?: number;
    north?: number;
  };
  gisCode?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OverlayFeaturesPayload;
    const bounds = body?.bounds;
    const gisCode = body?.gisCode;

    if (
      !gisCode ||
      !bounds ||
      !isFiniteNumber(bounds.west) ||
      !isFiniteNumber(bounds.south) ||
      !isFiniteNumber(bounds.east) ||
      !isFiniteNumber(bounds.north)
    ) {
      return NextResponse.json(
        { success: false, error: "A valid bounds object and gisCode are required." },
        { status: 400 },
      );
    }

    const featureCollection = await HaryanaParcelService.buildParcelOverlay(
      {
        west: bounds.west,
        south: bounds.south,
        east: bounds.east,
        north: bounds.north,
      },
      gisCode,
    );

    return NextResponse.json({
      success: true,
      featureCollection,
    });
  } catch (error: any) {
    console.error("[Haryana Overlay Features API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to build Haryana overlay features.",
      },
      { status: 500 },
    );
  }
}
