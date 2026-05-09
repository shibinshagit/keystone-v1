import { NextRequest, NextResponse } from "next/server";
import MaharashtraParcelService from "@/services/india/maharashtra";

type BoundsPayload = {
  west?: number;
  south?: number;
  east?: number;
  north?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { bounds?: BoundsPayload };
    const bounds = body?.bounds;

    if (
      !bounds ||
      !isFiniteNumber(bounds.west) ||
      !isFiniteNumber(bounds.south) ||
      !isFiniteNumber(bounds.east) ||
      !isFiniteNumber(bounds.north)
    ) {
      return NextResponse.json(
        { success: false, error: "A valid bounds object is required." },
        { status: 400 },
      );
    }

    const village = await MaharashtraParcelService.resolveVillageOverlay({
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north,
    });

    return NextResponse.json({
      success: true,
      village,
    });
  } catch (error: any) {
    console.error("[Maharashtra Overlay Resolve API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to resolve Maharashtra overlay.",
      },
      { status: 500 },
    );
  }
}
