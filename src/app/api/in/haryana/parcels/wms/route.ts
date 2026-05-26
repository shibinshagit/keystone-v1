import { NextRequest } from "next/server";
import { requestHttp } from "@/services/india/shared/bhunaksha-session";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";

const HARYANA_WMS_URL = "https://maps.revenueharyana.gov.in/bhunakshaserver/WMS/tile";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(
    request,
    HARYANA_WMS_URL,
    "Haryana Parcel WMS",
    (targetUrl) =>
      requestHttp({
        url: targetUrl,
        method: "GET",
        headers: {
          Accept: "image/png,*/*",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://maps.revenueharyana.gov.in/home",
        },
        rejectUnauthorized: false,
      }),
  );
}
