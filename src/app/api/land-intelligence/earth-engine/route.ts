import { NextRequest, NextResponse } from 'next/server';
import { EarthEngineService } from '@/services/land-intelligence/earth-engine-service';

/**
 * Land Intelligence: Google Earth Engine (Placeholder)
 * 
 * GET /api/land-intelligence/earth-engine?lat=28.59&lng=77.04&location=Dwarka
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = parseFloat(searchParams.get('lat') || '28.6139');
  const lng = parseFloat(searchParams.get('lng') || '77.2090');
  const location = searchParams.get('location') || 'Delhi';

  try {
    const [satelliteData, landChange, ndviSeries] = await Promise.all([
      EarthEngineService.getUrbanGrowthIndex([lng, lat], location),
      EarthEngineService.getLandChangeDetection([lng, lat], 5, location),
      EarthEngineService.getNDVITimeSeries([lng, lat], 5, location),
    ]);

    return NextResponse.json({
      success: true,
      isMockData: EarthEngineService.isMockMode(),
      location,
      coordinates: { lat, lng },
      satellite: satelliteData,
      landChange,
      ndviTimeSeries: ndviSeries,
    });
  } catch (error: any) {
    console.error('[Land Intel] Earth Engine error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch satellite data' },
      { status: 500 }
    );
  }
}
