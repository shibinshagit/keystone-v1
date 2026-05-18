import { NextRequest, NextResponse } from 'next/server';
import { lookupRegulationForLocationAndUse } from '@/lib/regulation-lookup-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      location,
      intendedUse,
      regulationId,
      market,
      coordinates,
      address,
      zipCode,
      parcelId,
    } = body || {};

    if (!location || !intendedUse) {
      return NextResponse.json(
        { error: 'location and intendedUse are required' },
        { status: 400 },
      );
    }

    const result = await lookupRegulationForLocationAndUse({
      location: String(location),
      intendedUse: String(intendedUse),
      regulationId: regulationId ? String(regulationId) : undefined,
      market,
      coordinates: Array.isArray(coordinates) && coordinates.length === 2
        ? [Number(coordinates[0]), Number(coordinates[1])]
        : undefined,
      address: address ? String(address) : undefined,
      zipCode: zipCode ? String(zipCode) : undefined,
      parcelId: parcelId ? String(parcelId) : undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[RegulationsLookupAPI] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to look up regulations' },
      { status: 500 },
    );
  }
}
