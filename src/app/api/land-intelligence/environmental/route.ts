import { NextRequest, NextResponse } from "next/server";

import { EnvironmentalService } from "@/services/land-intelligence/environmental-service";
import type { CountryCode, GeographyMarket } from "@/lib/types";

/**
 * Generic environmental-screening query route.
 *
 * POST /api/land-intelligence/environmental
 * Body: {
 *   coordinates: [lng, lat],
 *   location?: string,
 *   market?: "India" | "USA" | "UAE",
 *   countryCode?: "IN" | "US" | "AE"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { coordinates, location, market, countryCode } = await request.json();

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return NextResponse.json(
        { error: "coordinates [lng, lat] required" },
        { status: 400 },
      );
    }

    const report = await EnvironmentalService.getEnvironmentalScreening({
      coordinates: coordinates as [number, number],
      location: typeof location === "string" ? location : "",
      market: market as GeographyMarket | undefined,
      countryCode: countryCode as CountryCode | undefined,
    });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error("[Environmental Screening] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch environmental screening" },
      { status: 500 },
    );
  }
}
