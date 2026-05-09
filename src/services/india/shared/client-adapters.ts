import type { IndiaParcelSelection, IndiaViewportBounds } from "./types";

export type IndiaParcelClientAdapter = {
  id: "kerala" | "punjab" | "maharashtra";
  stateCode: string;
  stateName: string;
  overlayMinZoom: number;
  coverageBounds: IndiaViewportBounds;
  overlayResolvePath: string;
  parcelClickPath: string;
  wmsPath: string;
  transformClickCoordinates?: (coordinates: [number, number]) => [number, number];
  overlayAlignmentOffset?: {
    lng: number;
    lat: number;
  };
  buildOverlayParams: (args: {
    bounds: IndiaViewportBounds;
    gisCode: string;
    overlayCodes?: string | null;
    viewportWidth: number;
    viewportHeight: number;
  }) => URLSearchParams;
  buildParcelLocationLabel: (parcel: IndiaParcelSelection) => string;
};

function isInBounds(
  [lng, lat]: [number, number],
  bounds: IndiaViewportBounds,
) {
  return (
    lng >= bounds.west &&
    lng <= bounds.east &&
    lat >= bounds.south &&
    lat <= bounds.north
  );
}

export const INDIA_PARCEL_CLIENT_ADAPTERS: IndiaParcelClientAdapter[] = [
  {
    id: "kerala",
    stateCode: "32",
    stateName: "Kerala",
    overlayMinZoom: 14,
    coverageBounds: {
      west: 74.8,
      south: 8.0,
      east: 77.7,
      north: 12.9,
    },
    overlayResolvePath: "/api/in/kerala/overlay-resolve",
    parcelClickPath: "/api/in/kerala/parcel-click",
    wmsPath: "/api/in/kerala/parcels/wms",
    overlayAlignmentOffset: {
      lng: 0.0002,
      lat: -0.00006,
    },
    transformClickCoordinates: ([lng, lat]) => [lng - 0.0002, lat + 0.00006],
    buildOverlayParams: ({
      bounds,
      gisCode,
      viewportWidth,
      viewportHeight,
    }) => {
      const params = new URLSearchParams();
      params.set("service", "WMS");
      params.set("version", "1.1.1");
      params.set("request", "GetMap");
      params.set("layers", "OVERLAY_LAYER");
      params.set("overlay_codes", "TrQXZ8iXRXSU3ZhKFGRKDg,3Sod_6RQS1ylPMXWYXuw2w");
      params.set("styles", "");
      params.set("format", "image/png");
      params.set("transparent", "true");
      params.set("srs", "EPSG:4326");
      params.set("width", String(viewportWidth));
      params.set("height", String(viewportHeight));
      params.set("bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
      params.set("state", "32");
      params.set("gis_code", gisCode);
      params.set("giscode", gisCode);
      return params;
    },
    buildParcelLocationLabel: (parcel) => {
      const locality = [parcel.villageName, parcel.subdistrictName, parcel.districtName]
        .filter(Boolean)
        .join(", ");
      return parcel.parcelLabel && parcel.parcelLabel !== "Kerala Parcel"
        ? `${parcel.parcelLabel}${locality ? `, ${locality}` : ""}`
        : locality || "Kerala Parcel";
    },
  },
  {
    id: "punjab",
    stateCode: "03",
    stateName: "Punjab",
    overlayMinZoom: 14,
    coverageBounds: {
      west: 73.8,
      south: 29.5,
      east: 76.95,
      north: 32.55,
    },
    overlayResolvePath: "/api/in/punjab/overlay-resolve",
    parcelClickPath: "/api/in/punjab/parcel-click",
    wmsPath: "/api/in/punjab/parcels/wms",
    buildOverlayParams: ({
      bounds,
      gisCode,
      viewportWidth,
      viewportHeight,
    }) => {
      const params = new URLSearchParams();
      params.set("service", "WMS");
      params.set("version", "1.1.1");
      params.set("request", "GetMap");
      params.set("layers", "VILLAGE_MAP");
      params.set("styles", "VILLAGE_MAP");
      params.set("format", "image/png");
      params.set("transparent", "true");
      params.set("srs", "EPSG:4326");
      params.set("width", String(viewportWidth));
      params.set("height", String(viewportHeight));
      params.set("bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
      params.set("state", "03");
      params.set("gis_code", gisCode);
      params.set("giscode", gisCode);
      return params;
    },
    buildParcelLocationLabel: (parcel) =>
      [parcel.parcelLabel, parcel.villageName, parcel.subdistrictName, parcel.districtName]
        .filter(Boolean)
        .join(", ") || "Punjab Parcel",
  },
  {
    id: "maharashtra",
    stateCode: "27",
    stateName: "Maharashtra",
    overlayMinZoom: 14,
    coverageBounds: {
      west: 72.55,
      south: 15.6,
      east: 80.95,
      north: 22.1,
    },
    overlayResolvePath: "/api/in/maharashtra/overlay-resolve",
    parcelClickPath: "/api/in/maharashtra/parcel-click",
    wmsPath: "/api/in/maharashtra/parcels/wms",
    buildOverlayParams: ({
      bounds,
      gisCode,
      viewportWidth,
      viewportHeight,
    }) => {
      const params = new URLSearchParams();
      params.set("service", "WMS");
      params.set("version", "1.1.1");
      params.set("request", "GetMap");
      params.set("layers", "VILLAGE_MAP");
      params.set("styles", "VILLAGE_MAP");
      params.set("format", "image/png");
      params.set("transparent", "true");
      params.set("srs", "EPSG:4326");
      params.set("width", String(viewportWidth));
      params.set("height", String(viewportHeight));
      params.set("bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
      params.set("state", "27");
      params.set("gis_code", gisCode);
      params.set("giscode", gisCode);
      params.set("overlay_codes", "");
      params.set("crs", "");
      return params;
    },
    buildParcelLocationLabel: (parcel) =>
      [parcel.parcelLabel, parcel.villageName, parcel.subdistrictName, parcel.districtName]
        .filter(Boolean)
        .join(", ") || "Maharashtra Parcel",
  },
];

export function getIndiaParcelClientAdapter(
  coordinates: [number, number],
) {
  return (
    INDIA_PARCEL_CLIENT_ADAPTERS.find((adapter) =>
      isInBounds(coordinates, adapter.coverageBounds),
    ) || null
  );
}
