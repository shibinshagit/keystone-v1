import { buildIndiaParcelWmsHandler } from "@/services/india/shared/wms-proxy";
import { MaharashtraParcelService } from "@/services/india/maharashtra";
import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";

export const GET = buildIndiaParcelWmsHandler({
  remoteWmsUrl: INDIA_STATE_ENDPOINTS.maharashtra.wmsUrl,
  errorLabel: "Maharashtra Parcel WMS",
  remoteFetcher: (targetUrl) => MaharashtraParcelService.fetchWmsImage(targetUrl),
});
