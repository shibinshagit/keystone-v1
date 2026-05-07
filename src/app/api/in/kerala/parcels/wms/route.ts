import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

const KERALA_WMS_URL = "https://emaps.kerala.gov.in/bhunaksha/WMS";
const US_BLUE = { r: 59, g: 130, b: 246 };

function metersToLatLng(mx: number, my: number): [number, number] {
  const R = 6378137;
  const lng = (mx / R) * (180 / Math.PI);
  const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-my / R))) * (180 / Math.PI);
  return [lat, lng];
}

export async function GET(request: NextRequest) {
  try {
    const target = new URL(KERALA_WMS_URL);
    const searchParams = request.nextUrl.searchParams;

    searchParams.forEach((value, key) => {
      if (key.toLowerCase() === "srs" || key.toLowerCase() === "crs") return;
      if (key.toLowerCase() === "bbox") return;
      target.searchParams.set(key.toUpperCase(), value);
    });

    const srs =
      searchParams.get("SRS") ||
      searchParams.get("srs") ||
      searchParams.get("CRS") ||
      searchParams.get("crs") ||
      "";
    const bbox = searchParams.get("BBOX") || searchParams.get("bbox") || "";

    if ((srs === "EPSG:3857" || srs === "EPSG:900913") && bbox) {
      const parts = bbox.split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        const [minLat, minLng] = metersToLatLng(parts[0], parts[1]);
        const [maxLat, maxLng] = metersToLatLng(parts[2], parts[3]);
        target.searchParams.set("BBOX", `${minLng},${minLat},${maxLng},${maxLat}`);
        target.searchParams.set("SRS", "EPSG:4326");
      }
    } else {
      if (bbox) target.searchParams.set("BBOX", bbox);
      target.searchParams.set("SRS", srs || "EPSG:4326");
    }

    const response = await fetch(target.toString(), {
      headers: {
        Accept: "image/png,*/*",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Kerala WMS responded with status ${response.status}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());

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

        // Keep only the strongest cadastral strokes prominent.
        if (brightness < 105) {
          nextAlpha = Math.round(alpha * 0.78);
        } else if (brightness < 150) {
          nextAlpha = Math.round(alpha * 0.42);
        } else if (brightness < 205) {
          // Mid-tone hatch/fill becomes a very faint parcel wash.
          nextAlpha = Math.round(alpha * 0.08);
        } else {
          // Near-white background should disappear completely.
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

    return new NextResponse(output, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error: any) {
    console.error("[Kerala Parcel WMS API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to proxy Kerala WMS." },
      { status: 500 },
    );
  }
}
