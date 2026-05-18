import { NextRequest, NextResponse } from 'next/server';
import { GridicsService } from '@/services/us/gridics-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      location,
      coordinates,
      address,
      zipCode,
      parcelId,
      intendedUse,
    } = body || {};

    const result = await GridicsService.getNormalizedResult({
      location: location ? String(location) : undefined,
      coordinates: Array.isArray(coordinates) && coordinates.length === 2
        ? [Number(coordinates[0]), Number(coordinates[1])]
        : undefined,
      address: address ? String(address) : undefined,
      zipCode: zipCode ? String(zipCode) : undefined,
      groupId: parcelId ? String(parcelId) : undefined,
      intendedUse: intendedUse ? String(intendedUse) : undefined,
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'No Gridics zoning data found for this parcel query.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      regulation: result.regulation,
      artifacts: result.artifacts,
    });
  } catch (error: any) {
    console.error('[GridicsZoningAPI] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch Gridics zoning data' },
      { status: 500 },
    );
  }
}
