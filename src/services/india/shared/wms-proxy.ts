import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { webMercatorToLngLat } from "./geometry";

const US_BLUE = { r: 59, g: 130, b: 246 };

export async function proxyIndiaParcelWms(
  request: NextRequest,
  remoteWmsUrl: string,
  errorLabel: string,
  remoteFetcher?: (targetUrl: string) => Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>,
) {
  try {
    const target = new URL(remoteWmsUrl);
    const searchParams = request.nextUrl.searchParams;
    const inboundSrs =
      searchParams.get("SRS") ||
      searchParams.get("srs") ||
      null;
    const inboundCrs =
      searchParams.get("CRS") ||
      searchParams.get("crs") ||
      null;

    searchParams.forEach((value, key) => {
      if (key.toLowerCase() === "srs" || key.toLowerCase() === "crs") return;
      if (key.toLowerCase() === "bbox") return;
      target.searchParams.set(key.toUpperCase(), value);
    });

    const srs = inboundSrs || inboundCrs || "";
    const bbox = searchParams.get("BBOX") || searchParams.get("bbox") || "";

    if ((srs === "EPSG:3857" || srs === "EPSG:900913") && bbox) {
      const parts = bbox.split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        const [minLng, minLat] = webMercatorToLngLat(parts[0], parts[1]);
        const [maxLng, maxLat] = webMercatorToLngLat(parts[2], parts[3]);
        target.searchParams.set("BBOX", `${minLng},${minLat},${maxLng},${maxLat}`);
        target.searchParams.set("SRS", "EPSG:4326");
        if (inboundCrs !== null) {
          target.searchParams.set("CRS", inboundCrs);
        }
      }
    } else {
      if (bbox) target.searchParams.set("BBOX", bbox);
      target.searchParams.set("SRS", srs || "EPSG:4326");
      if (inboundCrs !== null) {
        target.searchParams.set("CRS", inboundCrs);
      }
    }

    const response = remoteFetcher ? await remoteFetcher(target.toString()) : null;

    if (response) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return NextResponse.json(
          { error: `${errorLabel} responded with status ${response.statusCode}` },
          { status: response.statusCode },
        );
      }
    }

    const fetchResponse = response
      ? response
      : await fetch(target.toString(), {
          headers: {
            Accept: "image/png,*/*",
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        }).then(async (res) => ({
          statusCode: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: Buffer.from(await res.arrayBuffer()),
        }));

    if (fetchResponse.statusCode < 200 || fetchResponse.statusCode >= 300) {
      return NextResponse.json(
        { error: `${errorLabel} responded with status ${fetchResponse.statusCode}` },
        { status: fetchResponse.statusCode },
      );
    }

    const headerValue = fetchResponse.headers["content-type"];
    const contentType =
      (Array.isArray(headerValue) ? headerValue[0] : headerValue) || "image/png";
    const buffer = fetchResponse.body;

    let output = buffer;
    if (contentType.includes("png")) {
      const recolored = await sharp(buffer)
        .ensureAlpha()
        .sharpen({ sigma: 0.7, m1: 0.8, m2: 1.6, x1: 2, y2: 10, y3: 20 })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixels = recolored.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        if (alpha === 0) continue;

        const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        let nextAlpha = 0;

        if (brightness < 105) {
          nextAlpha = Math.round(alpha * 0.78);
        } else if (brightness < 150) {
          nextAlpha = Math.round(alpha * 0.42);
        } else if (brightness < 205) {
          nextAlpha = Math.round(alpha * 0.08);
        } else {
          nextAlpha = 0;
        }

        pixels[i] = US_BLUE.r;
        pixels[i + 1] = US_BLUE.g;
        pixels[i + 2] = US_BLUE.b;
        pixels[i + 3] = Math.max(0, Math.min(255, nextAlpha));
      }

      output = await sharp(pixels, {
        raw: {
          width: recolored.info.width,
          height: recolored.info.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();
    }

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error: any) {
    console.error(`[${errorLabel}] Error:`, error);
    return NextResponse.json(
      { error: error?.message || `Failed to proxy ${errorLabel}.` },
      { status: 500 },
    );
  }
}
