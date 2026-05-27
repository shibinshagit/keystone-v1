import { NextRequest } from "next/server";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";

const GOA_WMS_URL = "https://bhunaksha.goa.gov.in/bhunaksha/WMS";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(request, GOA_WMS_URL, "Goa Parcel WMS");
}
