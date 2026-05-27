import { INDIA_STATE_ENDPOINTS } from "@/services/india/shared/state-endpoints";
import { buildIndiaParcelWmsHandler } from "@/services/india/shared/wms-proxy";

export const GET = buildIndiaParcelWmsHandler({
  remoteWmsUrl: INDIA_STATE_ENDPOINTS.punjab.wmsUrl,
  errorLabel: "Punjab Parcel WMS",
});
