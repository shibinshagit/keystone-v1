import { NextRequest } from "next/server";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";

const RAJASTHAN_WMS_URL = "https://bhunaksha.rajasthan.gov.in/Viewmap/WMS";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(request, RAJASTHAN_WMS_URL, "Rajasthan Parcel WMS");
}
