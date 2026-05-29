import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { AssamParcelService } from "@/services/india/assam";
import {
  lngLatToUtm,
  webMercatorToLngLat,
} from "@/services/india/shared/geometry";

const ASSAM_UTM_ZONE = 46;
const ASSAM_BLUE = { r: 59, g: 130, b: 246 };

function getFiniteParam(
  searchParams: URLSearchParams,
  keys: string[],
  fallback: number,
) {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return fallback;
}

function parseProjectedBbox(searchParams: URLSearchParams) {
  const bboxValue =
    searchParams.get("BBOX") || searchParams.get("bbox") || "";
  const bboxParts = bboxValue.split(",").map(Number);
  if (bboxParts.length !== 4 || bboxParts.some((value) => Number.isNaN(value))) {
    return null;
  }

  const srs =
    (
      searchParams.get("SRS") ||
      searchParams.get("srs") ||
      searchParams.get("CRS") ||
      searchParams.get("crs") ||
      "EPSG:4326"
    ).toUpperCase();

  if (srs === "EPSG:32646") {
    return bboxParts as [number, number, number, number];
  }

  let sw: [number, number];
  let ne: [number, number];

  if (srs === "EPSG:3857" || srs === "EPSG:900913") {
    sw = webMercatorToLngLat(bboxParts[0], bboxParts[1]);
    ne = webMercatorToLngLat(bboxParts[2], bboxParts[3]);
  } else {
    sw = [bboxParts[0], bboxParts[1]];
    ne = [bboxParts[2], bboxParts[3]];
  }

  const [minX, minY] = lngLatToUtm(sw[0], sw[1], ASSAM_UTM_ZONE);
  const [maxX, maxY] = lngLatToUtm(ne[0], ne[1], ASSAM_UTM_ZONE);

  return [
    Math.min(minX, maxX),
    Math.min(minY, maxY),
    Math.max(minX, maxX),
    Math.max(minY, maxY),
  ] as [number, number, number, number];
}

async function recolorAssamParcelRaster(buffer: Buffer, contentType: string) {
  if (!contentType.includes("png")) {
    return buffer;
  }

  const image = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const alpha = pixels[i + 3];
    if (alpha === 0) continue;

    const brightness = (r + g + b) / 3;
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const colorSpread = maxChannel - minChannel;

    if (brightness < 8 && colorSpread < 8) {
      pixels[i + 3] = 0;
      continue;
    }

    let nextAlpha = alpha;
    if (colorSpread > 25 && maxChannel > 140) {
      nextAlpha = 255;
    } else if (maxChannel > 180) {
      nextAlpha = 220;
    } else if (maxChannel > 100) {
      nextAlpha = 180;
    } else {
      nextAlpha = 140;
    }

    pixels[i] = ASSAM_BLUE.r;
    pixels[i + 1] = ASSAM_BLUE.g;
    pixels[i + 2] = ASSAM_BLUE.b;
    pixels[i + 3] = Math.max(0, Math.min(255, nextAlpha));
  }

  return sharp(pixels, {
    raw: {
      width: image.info.width,
      height: image.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const locationCode =
      searchParams.get("location_code") ||
      searchParams.get("LOCATION_CODE") ||
      searchParams.get("gis_code") ||
      searchParams.get("GIS_CODE") ||
      searchParams.get("giscode") ||
      searchParams.get("GISCODE");

    if (!locationCode) {
      return NextResponse.json(
        { error: "A location_code or gis_code query parameter is required." },
        { status: 400 },
      );
    }

    const bbox = parseProjectedBbox(searchParams);
    if (!bbox) {
      return NextResponse.json(
        { error: "A valid BBOX query parameter is required." },
        { status: 400 },
      );
    }

    const width = getFiniteParam(searchParams, ["WIDTH", "width"], 256);
    const height = getFiniteParam(searchParams, ["HEIGHT", "height"], 256);
    const format =
      searchParams.get("FORMAT") ||
      searchParams.get("format") ||
      "image/png";
    const style =
      searchParams.get("style") ||
      searchParams.get("STYLE") ||
      searchParams.get("styles") ||
      searchParams.get("STYLES");

    const response = await AssamParcelService.fetchWmsImage({
      locationCode,
      bbox,
      width,
      height,
      layerCode:
        searchParams.get("layer_code") ||
        searchParams.get("LAYER_CODE") ||
        "ASSAM_PARCEL",
      mapType:
        searchParams.get("map_type") ||
        searchParams.get("MAP_TYPE") ||
        "GENERIC_MAP",
      style,
      transparent:
        searchParams.get("transparent") ||
        searchParams.get("TRANSPARENT") ||
        "true",
      format,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return NextResponse.json(
        { error: `Assam Parcel WMS responded with status ${response.statusCode}` },
        { status: response.statusCode },
      );
    }

    const headerValue = response.headers["content-type"];
    const contentType =
      (Array.isArray(headerValue) ? headerValue[0] : headerValue) || format;
    const output = await recolorAssamParcelRaster(response.body, contentType);

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error: any) {
    console.error("[Assam Parcel WMS] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to proxy Assam Parcel WMS." },
      { status: 500 },
    );
  }
}
