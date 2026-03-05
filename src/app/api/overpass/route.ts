import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for Overpass API queries.
 *
 * Why proxy?
 *  - The public Overpass API aggressively rate-limits browser requests (429)
 *  - Some mirrors (kumi) are blocked by CORS
 *  - Server-side allows longer timeouts and a single combined query
 *  - Avoids massive URL-encoded GET strings
 */

const SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter', // works server-side (no CORS)
];

export async function POST(req: NextRequest) {
    try {
        const { query } = await req.json();
        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Missing "query" field' }, { status: 400 });
        }

        for (let i = 0; i < SERVERS.length; i++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 60_000); // 60s hard timeout

                const res = await fetch(SERVERS[i], {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `data=${encodeURIComponent(query)}`,
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (res.status === 429) {
                    console.warn(`[Overpass Proxy] Server ${i + 1} rate-limited (429), trying next…`);
                    continue;
                }

                if (!res.ok) {
                    console.warn(`[Overpass Proxy] Server ${i + 1} returned ${res.status}, trying next…`);
                    continue;
                }

                const data = await res.json();
                return NextResponse.json(data);
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.warn(`[Overpass Proxy] Server ${i + 1} timed out, trying next…`);
                } else {
                    console.warn(`[Overpass Proxy] Server ${i + 1} error:`, err.message);
                }
            }
        }

        return NextResponse.json(
            { error: 'All Overpass servers failed', elements: [] },
            { status: 502 }
        );
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
