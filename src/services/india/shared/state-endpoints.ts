export const INDIA_STATE_ENDPOINTS = {
  assam: {
    stateCode: "18" as const,
    baseUrl: "https://bhunaksha.assam.gov.in",
    mapWmsUrl: "https://bhunaksha.assam.gov.in/v1/map/wms",
  },
  kerala: {
    stateCode: "32" as const,
    baseUrl: "https://emaps.kerala.gov.in/bhunaksha",
    wmsUrl: "https://emaps.kerala.gov.in/bhunaksha/WMS",
  },
  punjab: {
    stateCode: "03" as const,
    baseUrl: "https://gisbhunaksha.punjab.gov.in",
    wmsUrl: "https://gisbhunaksha.punjab.gov.in/WMS",
  },
  maharashtra: {
    stateCode: "27" as const,
    baseUrl: "https://mahabhunakasha.mahabhumi.gov.in",
    landingPath: "/27/index.html",
    wmsUrl: "https://mahabhunakasha.mahabhumi.gov.in/WMS",
  },
  haryana: {
    stateCode: "06" as const,
    apiBaseUrl: "https://maps.revenueharyana.gov.in/bhunakshaserver",
    referer: "https://maps.revenueharyana.gov.in/home",
    wmsUrl: "https://maps.revenueharyana.gov.in/bhunakshaserver/WMS/tile",
  },
  rajasthan: {
    stateCode: "08" as const,
    baseUrl: "https://bhunaksha.rajasthan.gov.in/Viewmap",
    wmsUrl: "https://bhunaksha.rajasthan.gov.in/Viewmap/WMS",
  },
  goa: {
    stateCode: "30" as const,
    baseUrl: "https://bhunaksha.goa.gov.in/bhunaksha",
    wmsUrl: "https://bhunaksha.goa.gov.in/bhunaksha/WMS",
  },
} as const;
