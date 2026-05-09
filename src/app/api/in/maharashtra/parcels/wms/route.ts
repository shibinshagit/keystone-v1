import { NextRequest } from "next/server";
import { proxyIndiaParcelWms } from "@/services/india/shared/wms-proxy";
import { MaharashtraParcelService } from "@/services/india/maharashtra";

const MAHARASHTRA_WMS_URL = "https://mahabhunakasha.mahabhumi.gov.in/WMS";

export async function GET(request: NextRequest) {
  return proxyIndiaParcelWms(
    request,
    MAHARASHTRA_WMS_URL,
    "Maharashtra Parcel WMS",
    (targetUrl) => MaharashtraParcelService.fetchWmsImage(targetUrl),
  );
}
