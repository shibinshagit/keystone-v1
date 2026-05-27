import { NextRequest, NextResponse } from "next/server";
import type { IndiaParcelSelection, IndiaViewportBounds } from "./types";

type IndiaParcelRouteService = {
  resolveVillageOverlay: (bounds: IndiaViewportBounds) => Promise<unknown>;
  getParcelAtCoordinate: (
    coordinates: [number, number],
  ) => Promise<IndiaParcelSelection | null>;
};

type BoundsPayload = {
  west?: number;
  south?: number;
  east?: number;
  north?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function readOptionalJson<T>(request: NextRequest): Promise<T | null> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return null;
  }

  return JSON.parse(rawBody) as T;
}

export async function handleIndiaOverlayResolve(
  request: NextRequest,
  service: IndiaParcelRouteService,
  label: string,
) {
  try {
    const body = await readOptionalJson<{ bounds?: BoundsPayload }>(request);
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

    const village = await service.resolveVillageOverlay({
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
    console.error(`[${label} Overlay Resolve API] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || `Failed to resolve ${label} overlay.`,
      },
      { status: 500 },
    );
  }
}

export async function handleIndiaParcelClick(
  request: NextRequest,
  service: IndiaParcelRouteService,
  label: string,
) {
  try {
    const body = await readOptionalJson<{ coordinates?: [number, number] }>(
      request,
    );
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

    const parcel = await service.getParcelAtCoordinate(coordinates);
    return NextResponse.json({
      success: true,
      parcel,
    });
  } catch (error: any) {
    console.error(`[${label} Parcel Click API] Error:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || `Failed to fetch ${label} parcel.`,
      },
      { status: 500 },
    );
  }
}
