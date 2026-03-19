import { NextRequest, NextResponse } from 'next/server';
import { extractRegulationData } from '@/ai/flows/ai-regulation-extractor';
import mammoth from 'mammoth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

async function extractTextFromFile(file: File): Promise<string> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.pdf')) {
        const data = await pdf(buffer);
        return data.text;
    } else if (fileName.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } else if (fileName.endsWith('.txt')) {
        return buffer.toString('utf-8');
    }

    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const overrideLocation = formData.get('overrideLocation') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const fileName = file.name.toLowerCase();
        const isPdf = fileName.endsWith('.pdf');

        let pdfBase64: string | undefined;
        let documentText: string | undefined;

        if (isPdf) {
            // For PDFs, send raw bytes to Gemini Vision for much better table extraction
            const buffer = Buffer.from(await file.arrayBuffer());
            pdfBase64 = buffer.toString('base64');
            
            // Also extract text as fallback
            try {
                const data = await pdf(buffer);
                documentText = data.text;
            } catch (e) {
                console.warn('pdf-parse fallback text extraction failed:', e);
            }
        } else {
            // For non-PDF files, extract text normally
            documentText = await extractTextFromFile(file);
        }

        if (!pdfBase64 && (!documentText || documentText.trim().length < 50)) {
            return NextResponse.json(
                { error: 'Could not extract sufficient content from document' },
                { status: 400 }
            );
        }

        // Use AI to extract regulation data
        const extractedData = await extractRegulationData({
            documentText: documentText || '',
            fileName: file.name,
            overrideLocation: overrideLocation === 'none' ? undefined : overrideLocation || undefined,
            pdfBase64,
        });

        return NextResponse.json({
            success: true,
            data: extractedData,
        });
    } catch (error: any) {
        console.error('Error processing regulation document:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to process document' },
            { status: 500 }
        );
    }
}
