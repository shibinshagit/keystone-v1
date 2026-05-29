import type { IndiaParcelSelection, IndiaViewportBounds } from "./types";

export type IndiaParcelAdapterId =
  | "assam"
  | "kerala"
  | "punjab"
  | "maharashtra"
  | "haryana"
  | "rajasthan"
  | "goa";

export type IndiaParcelClientAdapter = {
  id: IndiaParcelAdapterId;
  stateCode: string;
  stateName: string;
  overlayMinZoom: number;
  coverageBounds: IndiaViewportBounds;
  overlaySourceType?: "wms" | "geojson";
  overlayRenderMode?: "image" | "tiles";
  overlayPaintPreset?: "default" | "strong";
  overlayResolvePath: string;
  overlayFeaturesPath?: string;
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

type WmsOverlayOptions = {
  layerName: string;
  styles: string;
  stateCode?: string;
  includeOverlayCodes?: boolean;
  defaultOverlayCodes?: string;
  includeBlankCrs?: boolean;
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

function boundsArea(bounds: IndiaViewportBounds) {
  return Math.max(0, bounds.east - bounds.west) * Math.max(0, bounds.north - bounds.south);
}

function createOverlayParamsBuilder(options: WmsOverlayOptions) {
  return ({
    bounds,
    gisCode,
    overlayCodes,
    viewportWidth,
    viewportHeight,
  }: {
    bounds: IndiaViewportBounds;
    gisCode: string;
    overlayCodes?: string | null;
    viewportWidth: number;
    viewportHeight: number;
  }) => {
    const params = new URLSearchParams();
    params.set("service", "WMS");
    params.set("version", "1.1.1");
    params.set("request", "GetMap");
    params.set("layers", options.layerName);
    params.set("styles", options.styles);
    params.set("format", "image/png");
    params.set("transparent", "true");
    params.set("srs", "EPSG:4326");
    params.set("width", String(viewportWidth));
    params.set("height", String(viewportHeight));
    params.set("bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
    if (options.stateCode !== undefined) {
      params.set("state", options.stateCode);
    }
    params.set("gis_code", gisCode);
    params.set("giscode", gisCode);
    if (options.includeOverlayCodes) {
      params.set("overlay_codes", overlayCodes || options.defaultOverlayCodes || "");
    }
    if (options.includeBlankCrs) {
      params.set("crs", "");
    }
    return params;
  };
}

function buildDefaultParcelLocationLabel(
  fallbackLabel: string,
  parcel: IndiaParcelSelection,
) {
  return [
    parcel.parcelLabel,
    parcel.villageName,
    parcel.subdistrictName,
    parcel.districtName,
  ]
    .filter(Boolean)
    .join(", ") || fallbackLabel;
}

export const INDIA_PARCEL_CLIENT_ADAPTERS: IndiaParcelClientAdapter[] = [
  {
    id: "assam",
    stateCode: "18",
    stateName: "Assam",
    overlayMinZoom: 14,
    overlaySourceType: "wms",
    overlayRenderMode: "image",
    overlayPaintPreset: "strong",
    overlayAlignmentOffset: {
      lng: 0.00024,
      lat: -0.00009,
    },
    coverageBounds: {
      west: 89.65,
      south: 24.0,
      east: 96.1,
      north: 28.4,
    },
    overlayResolvePath: "/api/in/assam/overlay-resolve",
    parcelClickPath: "/api/in/assam/parcel-click",
    wmsPath: "/api/in/assam/parcels/wms",
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
      params.set("format", "image/png");
      params.set("transparent", "true");
      params.set("layer_code", "ASSAM_PARCEL");
      params.set("map_type", "GENERIC_MAP");
      params.set("ignore_georef", "N");
      params.set("_overlay_version", "assam-v2");
      params.set("srs", "EPSG:4326");
      params.set("width", String(viewportWidth));
      params.set("height", String(viewportHeight));
      params.set(
        "bbox",
        `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
      );
      params.set("gis_code", gisCode);
      params.set("location_code", gisCode);
      return params;
    },
    transformClickCoordinates: ([lng, lat]) => [lng - 0.00024, lat + 0.00009],
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Assam Parcel", parcel),
  },
  {
    id: "kerala",
    stateCode: "32",
    stateName: "Kerala",
    overlayMinZoom: 14,
    overlaySourceType: "wms",
    overlayRenderMode: "image",
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
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "OVERLAY_LAYER",
      styles: "",
      stateCode: "32",
      includeOverlayCodes: true,
      defaultOverlayCodes:
        "TrQXZ8iXRXSU3ZhKFGRKDg,3Sod_6RQS1ylPMXWYXuw2w",
    }),
    buildParcelLocationLabel: (parcel) => {
      const locality = [
        parcel.villageName,
        parcel.subdistrictName,
        parcel.districtName,
      ]
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
    overlaySourceType: "wms",
    overlayRenderMode: "tiles",
    coverageBounds: {
      west: 73.8,
      south: 29.5,
      east: 76.95,
      north: 32.55,
    },
    overlayResolvePath: "/api/in/punjab/overlay-resolve",
    parcelClickPath: "/api/in/punjab/parcel-click",
    wmsPath: "/api/in/punjab/parcels/wms",
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "VILLAGE_MAP",
      styles: "VILLAGE_MAP",
      stateCode: "03",
    }),
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Punjab Parcel", parcel),
  },
  {
    id: "maharashtra",
    stateCode: "27",
    stateName: "Maharashtra",
    overlayMinZoom: 14,
    overlaySourceType: "wms",
    overlayRenderMode: "tiles",
    coverageBounds: {
      west: 72.55,
      south: 15.6,
      east: 80.95,
      north: 22.1,
    },
    overlayResolvePath: "/api/in/maharashtra/overlay-resolve",
    parcelClickPath: "/api/in/maharashtra/parcel-click",
    wmsPath: "/api/in/maharashtra/parcels/wms",
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "VILLAGE_MAP",
      styles: "VILLAGE_MAP",
      stateCode: "27",
      includeOverlayCodes: true,
      includeBlankCrs: true,
    }),
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Maharashtra Parcel", parcel),
  },
  {
    id: "rajasthan",
    stateCode: "08",
    stateName: "Rajasthan",
    overlayMinZoom: 14,
    overlaySourceType: "wms",
    overlayRenderMode: "tiles",
    coverageBounds: {
      west: 69.2,
      south: 23.0,
      east: 78.6,
      north: 30.95,
    },
    overlayResolvePath: "/api/in/rajasthan/overlay-resolve",
    parcelClickPath: "/api/in/rajasthan/parcel-click",
    wmsPath: "/api/in/rajasthan/parcels/wms",
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "VILLAGE_MAP",
      styles: "VILLAGE_MAP",
      stateCode: "08",
      includeOverlayCodes: true,
      includeBlankCrs: true,
    }),
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Rajasthan Parcel", parcel),
  },
  {
    id: "goa",
    stateCode: "30",
    stateName: "Goa",
    overlayMinZoom: 14,
    overlaySourceType: "wms",
    overlayRenderMode: "tiles",
    coverageBounds: {
      west: 73.6,
      south: 14.8,
      east: 74.45,
      north: 15.9,
    },
    overlayResolvePath: "/api/in/goa/overlay-resolve",
    parcelClickPath: "/api/in/goa/parcel-click",
    wmsPath: "/api/in/goa/parcels/wms",
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "VILLAGE_MAP",
      styles: "VILLAGE_MAP",
      stateCode: "30",
    }),
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Goa Parcel", parcel),
  },
  {
    id: "haryana",
    stateCode: "06",
    stateName: "Haryana",
    overlayMinZoom: 14,
    overlaySourceType: "geojson",
    coverageBounds: {
      west: 74.45,
      south: 27.65,
      east: 77.65,
      north: 30.95,
    },
    overlayResolvePath: "/api/in/haryana/overlay-resolve",
    overlayFeaturesPath: "/api/in/haryana/overlay-features",
    parcelClickPath: "/api/in/haryana/parcel-click",
    wmsPath: "/api/in/haryana/parcels/wms",
    buildOverlayParams: createOverlayParamsBuilder({
      layerName: "VILLAGE_MAP",
      styles: "VILLAGE_MAP",
      stateCode: "",
      includeOverlayCodes: true,
      includeBlankCrs: true,
    }),
    buildParcelLocationLabel: (parcel) =>
      buildDefaultParcelLocationLabel("Haryana Parcel", parcel),
  },
];

export function getIndiaParcelClientAdapter(coordinates: [number, number]) {
  return getIndiaParcelClientAdapters(coordinates)[0] || null;
}

export function getIndiaParcelClientAdapters(coordinates: [number, number]) {
  return INDIA_PARCEL_CLIENT_ADAPTERS.filter((adapter) =>
    isInBounds(coordinates, adapter.coverageBounds),
  ).sort(
    (a, b) =>
      boundsArea(a.coverageBounds) - boundsArea(b.coverageBounds),
  );
}

function normalizeStateName(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function prioritizeIndiaParcelClientAdapters(
  adapters: IndiaParcelClientAdapter[],
  stateName?: string | null,
) {
  const normalizedStateName = normalizeStateName(stateName);
  if (!normalizedStateName || adapters.length <= 1) {
    return adapters;
  }

  const matchingAdapters = adapters.filter(
    (adapter) => normalizeStateName(adapter.stateName) === normalizedStateName,
  );

  if (matchingAdapters.length === 0) {
    return adapters;
  }

  const matchingIds = new Set(matchingAdapters.map((adapter) => adapter.id));

  return [
    ...matchingAdapters,
    ...adapters.filter((adapter) => !matchingIds.has(adapter.id)),
  ];
}
