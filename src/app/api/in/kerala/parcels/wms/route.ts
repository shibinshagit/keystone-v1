import { NextRequest } from "next/server";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";

const KERALA_WMS_URL = "https://emaps.kerala.gov.in/bhunaksha/WMS";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(request, KERALA_WMS_URL, "Kerala Parcel WMS");
}
