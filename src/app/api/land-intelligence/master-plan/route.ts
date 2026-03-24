import { NextRequest, NextResponse } from 'next/server';
import { extractMasterPlanData } from '@/services/land-intelligence/master-plan-extractor';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

/**
 * Land Intelligence: Master Plan PDF Extractor
 * 
 * POST /api/land-intelligence/master-plan
 * Body: multipart/form-data with 'file' field (PDF)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'Only PDF files are supported for master plan extraction' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfBase64 = buffer.toString('base64');

    // Also extract text as fallback
    let fallbackText: string | undefined;
    try {
      const data = await pdf(buffer);
      fallbackText = data.text;
    } catch (e) {
      console.warn('[Master Plan] Text extraction fallback failed:', e);
    }

    const masterPlanData = await extractMasterPlanData({
      pdfBase64,
      fileName: file.name,
      fallbackText,
    });

    return NextResponse.json({
      success: true,
      data: masterPlanData,
    });
  } catch (error: any) {
    console.error('[Land Intel] Master plan extraction error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to extract master plan data' },
      { status: 500 }
    );
  }
}
