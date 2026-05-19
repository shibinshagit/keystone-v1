import { NextRequest, NextResponse } from "next/server";

import { DubaiLandService } from "@/services/uae/dubai-land-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { location, rawLocation, district, coordinates } = body || {};

    if (!location || typeof location !== "string") {
      return NextResponse.json(
        { success: false, error: "location is required" },
        { status: 400 },
      );
    }

    // Thin server wrapper around the shared Dubai service so credentials stay
    // server-side and the client gets one normalized UAE/Dubai payload.
    const result = await DubaiLandService.getContext({
      location,
      rawLocation: typeof rawLocation === "string" ? rawLocation : undefined,
      district: typeof district === "string" ? district : undefined,
      coordinates:
        Array.isArray(coordinates) && coordinates.length === 2
          ? [Number(coordinates[0]), Number(coordinates[1])]
          : undefined,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error("[DubaiLandContextAPI] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to fetch Dubai Land context",
      },
      { status: 500 },
    );
  }
}
