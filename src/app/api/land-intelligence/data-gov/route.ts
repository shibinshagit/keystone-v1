import { NextRequest, NextResponse } from 'next/server';
import { DataGovService } from '@/services/land-intelligence/data-gov-service';

/**
 * Land Intelligence: data.gov.in Proxy
 * 
 * GET /api/land-intelligence/data-gov?type=census|fdi|sez&state=Delhi&district=...
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'census';
  const state = searchParams.get('state') || 'Delhi';
  const district = searchParams.get('district') || undefined;
  const sector = searchParams.get('sector') || undefined;

  try {
    let data: any;

    switch (type) {
      case 'census':
        data = await DataGovService.getCensusData(state, district);
        break;
      case 'fdi':
        data = await DataGovService.getFDIData(state, sector);
        break;
      case 'sez':
        data = await DataGovService.getSEZData(state);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown data type: ${type}. Use census, fdi, or sez.` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      type,
      state,
      count: Array.isArray(data) ? data.length : 1,
      data,
    });
  } catch (error: any) {
    console.error('[Land Intel] data.gov.in error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch data from data.gov.in' },
      { status: 500 }
    );
  }
}
