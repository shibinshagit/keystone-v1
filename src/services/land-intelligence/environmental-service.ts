import { inferRegulationGeography } from "@/lib/geography";
import type { CountryCode, GeographyMarket } from "@/lib/types";
import type { EnvironmentalScreeningReport } from "@/lib/land-intelligence/environmental";
import { UsaEnvironmentalService } from "@/services/land-intelligence/usa-environmental-service";

function resolveGeography({
  market,
  countryCode,
  location,
}: {
  market?: GeographyMarket;
  countryCode?: CountryCode;
  location?: string;
}) {
  if (market || countryCode) {
    return { market, countryCode };
  }

  const inferred = inferRegulationGeography(location || "");
  return {
    market: inferred.market,
    countryCode: inferred.countryCode,
  };
}

export const EnvironmentalService = {
  async getEnvironmentalScreening({
    coordinates,
    location = "",
    market,
    countryCode,
  }: {
    coordinates: [number, number];
    location?: string;
    market?: GeographyMarket;
    countryCode?: CountryCode;
  }): Promise<EnvironmentalScreeningReport> {
    const geography = resolveGeography({ market, countryCode, location });

    if (geography.market === "USA" || geography.countryCode === "US") {
      return UsaEnvironmentalService.getEnvironmentalScreening(coordinates, location);
    }

    throw new Error(
      `Environmental screening is not supported yet for ${geography.market || geography.countryCode}.`,
    );
  },
};

export default EnvironmentalService;
