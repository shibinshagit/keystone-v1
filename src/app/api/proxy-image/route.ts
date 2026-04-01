import { NextRequest, NextResponse } from 'next/server';

/**
 * Image proxy route — works around TLS/network issues with external image hosts
 * (e.g. tempfile.aiquickdraw.com) by fetching server-side and returning the image.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Only allow proxying image URLs from known hosts
  const allowed = ['tempfile.aiquickdraw.com'];
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  if (!allowed.includes(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  // Try direct fetch first (with retries)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const directRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (directRes.ok) {
        const contentType = directRes.headers.get('content-type') || 'image/png';
        const buf = await directRes.arrayBuffer();
        return new NextResponse(buf, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch {
      // Retry after a short delay
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Fallback: use wsrv.nl image proxy
  try {
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(30000) });
    if (!proxyRes.ok) {
      return NextResponse.json({ error: 'Proxy fetch failed' }, { status: 502 });
    }
    const contentType = proxyRes.headers.get('content-type') || 'image/png';
    const buf = await proxyRes.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 });
  }
}
