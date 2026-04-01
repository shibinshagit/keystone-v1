import { NextRequest, NextResponse } from 'next/server';

/**
 * Temporary in-memory image store for control images.
 * Images auto-expire after TTL_MS.
 */
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const imageStore = new Map<string, { data: Buffer; contentType: string; expiresAt: number }>();

// Periodic cleanup (runs every 2 minutes)
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of imageStore) {
      if (now > entry.expiresAt) {
        imageStore.delete(id);
      }
    }
  }, 2 * 60 * 1000);
}

/**
 * POST /api/upload-temp-image
 * Accepts base64-encoded PNG, stores in memory, returns a URL.
 *
 * Body: { base64: string }
 * Returns: { url: string, id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const base64Data: string = body.base64;
    if (!base64Data) {
      return NextResponse.json({ error: 'Missing base64 field' }, { status: 400 });
    }

    // Strip data URI prefix if present
    const raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');

    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 });
    }

    const id = crypto.randomUUID();
    imageStore.set(id, {
      data: buffer,
      contentType: 'image/png',
      expiresAt: Date.now() + TTL_MS,
    });

    scheduleCleanup();

    // Build a full URL from the request
    const host = req.headers.get('host') || 'localhost:9002';
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const url = `${protocol}://${host}/api/upload-temp-image?id=${id}`;

    return NextResponse.json({ url, id });
  } catch (e) {
    console.error('[upload-temp-image] Error:', e);
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 });
  }
}

/**
 * GET /api/upload-temp-image?id=xxx
 * Serves a previously uploaded temporary image.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  const entry = imageStore.get(id);
  if (!entry) {
    return NextResponse.json({ error: 'Image not found or expired' }, { status: 404 });
  }

  if (Date.now() > entry.expiresAt) {
    imageStore.delete(id);
    return NextResponse.json({ error: 'Image expired' }, { status: 404 });
  }

  return new NextResponse(entry.data, {
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': 'no-cache',
    },
  });
}
