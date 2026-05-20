import { NextRequest, NextResponse } from "next/server";
import { HaryanaParcelService } from "@/services/india/haryana";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const coordinates = body?.coordinates as [number, number] | undefined;

    if (
      !coordinates ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      !coordinates.every((value) => Number.isFinite(value))
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid coordinates payload." },
        { status: 400 },
      );
    }

    const parcel = await HaryanaParcelService.getParcelAtCoordinate(coordinates);
    return NextResponse.json({
      success: true,
      parcel,
    });
  } catch (error: any) {
    console.error("[Haryana Parcel Click API] Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to fetch Haryana parcel." },
      { status: 500 },
    );
  }
}
