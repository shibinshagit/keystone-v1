import type { Feature, MultiPolygon, Polygon } from "geojson";

export type IndiaViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type IndiaParcelField = {
  label: string;
  value: string;
};

export type IndiaParcelAdminLevel = {
  code: string;
  label: string;
  value: string;
};

export interface IndiaParcelSelection {
  stateCode: string;
  stateName: string;
  sourceName: string;
  gisCode: string;
  plotId: string;
  plotNo?: string | null;
  parcelLabel: string;
  locationLabel?: string | null;
  districtName?: string | null;
  subdistrictName?: string | null;
  talukName?: string | null;
  villageName?: string | null;
  gisInfo?: string | null;
  vsrNo?: string | null;
  blockNo?: string | null;
  surveyNo?: string | null;
  subdivisionNo?: string | null;
  pniu?: string | null;
  areaSqm?: number | null;
  areaLabel?: string | null;
  owners?: string[];
  remarks?: string | null;
  infoHtml?: string | null;
  infoLinksHtml?: string | null;
  mapSketchUrl?: string | null;
  geometry?: Feature<Polygon | MultiPolygon> | null;
  extent?: IndiaViewportBounds | null;
  parcelFields: IndiaParcelField[];
  administrativeFields: IndiaParcelField[];
  sourceBadge?: string | null;
  plotReportUrl?: string | null;
  overlay?: {
    highlightType: "geometry" | "wms";
    wmsPath?: string;
    wmsParams?: Record<string, string>;
  } | null;
}

export type IndiaOverlayVillage = {
  stateCode: string;
  stateName: string;
  gisCode: string;
  overlayCodes?: string | null;
  extent: IndiaViewportBounds;
  administrativeLevels: IndiaParcelAdminLevel[];
  districtName?: string | null;
  subdistrictName?: string | null;
  villageName?: string | null;
};
