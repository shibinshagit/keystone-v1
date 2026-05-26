import { NextRequest, NextResponse } from "next/server";
import { MaharashtraParcelService } from "@/services/india/maharashtra";

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

    const parcel = await MaharashtraParcelService.getParcelAtCoordinate(coordinates);
    return NextResponse.json({
      success: true,
      parcel,
    });
  } catch (error: any) {
    console.error("[Maharashtra Parcel Click API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to fetch Maharashtra parcel.",
      },
      { status: 500 },
    );
  }
}
