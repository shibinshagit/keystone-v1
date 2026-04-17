export function inferScoreQueryLocation(location: string) {
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^india$/i.test(part));

  const district = parts[0] || location.trim() || 'Unknown';
  const state = parts.length > 1 ? parts[parts.length - 1] : district;

  return { state, district };
}
