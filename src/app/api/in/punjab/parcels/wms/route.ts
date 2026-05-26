import { NextRequest } from "next/server";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";

const PUNJAB_WMS_URL = "https://gisbhunaksha.punjab.gov.in/WMS";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(request, PUNJAB_WMS_URL, "Punjab Parcel WMS");
}
