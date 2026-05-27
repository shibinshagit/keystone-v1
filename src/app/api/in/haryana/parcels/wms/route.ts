import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";
import { requestHttp } from "@/services/india/shared/bhunaksha-session";
import { buildIndiaParcelWmsHandler } from "@/services/india/shared/wms-proxy";

export const GET = buildIndiaParcelWmsHandler({
  remoteWmsUrl: INDIA_STATE_ENDPOINTS.haryana.wmsUrl,
  errorLabel: "Haryana Parcel WMS",
  remoteFetcher: (targetUrl) =>
    requestHttp({
      url: targetUrl,
      method: "GET",
      headers: {
        Accept: "image/png,*/*",
        "User-Agent": "Mozilla/5.0",
        Referer: INDIA_STATE_ENDPOINTS.haryana.referer,
      },
      rejectUnauthorized: false,
    }),
});
