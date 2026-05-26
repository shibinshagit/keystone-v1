import { isUSStateToken } from '@/lib/geography';

export function inferScoreQueryLocation(location: string, coordinates?: [number, number]) {
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) =>
        !/^(india|usa|us|united states|uae|united arab emirates)$/i.test(part),
    );

  const district = parts[0] || location.trim() || "Unknown";
  const state = parts.length > 1 ? parts[parts.length - 1] : district;

  let isUS = parts.some(
    (p) =>
      /united states|usa|u\.s\.a/i.test(p) ||
      isUSStateToken(p),
  );

  // Coordinate-based fallback: check if within contiguous US
  if (!isUS && coordinates) {
    const [lng, lat] = coordinates;
    if (lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66) {
      isUS = true;
    }
  }

  return { state, district, isUS };
}
