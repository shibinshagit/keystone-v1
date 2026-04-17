const MOSPI_PUBLIC_DASHBOARD_URL = 'https://ipm.mospi.gov.in/Home/PublicDashboard';
const MAX_SNIPPETS = 8;
const MATCH_WINDOW_CHARS = 180;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[_\-/,()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(html: string): string {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function uniqueTerms(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(String(value || '')))
        .filter(Boolean),
    ),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createWindowMatches(
  text: string,
  locationTerms: string[],
  infraTerms: string[],
): string[] {
  const snippets = new Set<string>();

  for (const location of locationTerms) {
    for (const infra of infraTerms) {
      const safeLocation = escapeRegex(location);
      const safeInfra = escapeRegex(infra);
      const patterns = [
        new RegExp(`${safeLocation}.{0,${MATCH_WINDOW_CHARS}}${safeInfra}`, 'g'),
        new RegExp(`${safeInfra}.{0,${MATCH_WINDOW_CHARS}}${safeLocation}`, 'g'),
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          snippets.add(match[0].trim());
          if (snippets.size >= MAX_SNIPPETS) {
            return Array.from(snippets);
          }
        }
      }
    }
  }

  return Array.from(snippets);
}

export interface ProposedInfraSignal {
  available: boolean;
  count: number;
  source: string;
  snippets: string[];
}

export const ProposedInfraService = {
  // This is a best-effort public-source parser for GP5, not a stable structured infra API.
  // We use it as a helpful signal for now, but it should eventually be replaced by a curated
  // planned-infrastructure dataset with locations and project metadata.
  async getMospiSignal({
    state,
    district,
  }: {
    state: string;
    district?: string;
  }): Promise<ProposedInfraSignal> {
    const response = await fetch(MOSPI_PUBLIC_DASHBOARD_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`MoSPI dashboard request failed with ${response.status}`);
    }

    const html = await response.text();
    const normalized = stripHtml(html);
    const sectionStart = normalized.indexOf('project overview');
    const section =
      sectionStart >= 0
        ? normalized.slice(sectionStart, sectionStart + 250000)
        : normalized;

    const locationTerms = uniqueTerms([
      state,
      district,
      district && `${district} ${state}`,
    ]);
    const infraTerms = uniqueTerms([
      'metro',
      'regional rapid transit',
      'urban public transport',
      'road',
      'highway',
      'aviation',
      'airport',
      'logistics hub',
      'integrated transport hub',
      'bus terminal',
      'railway',
      'roads and services development',
      'storm water drainage',
      'water treatment',
      'electricity transmission',
      'telecommunication',
    ]);

    const snippets = createWindowMatches(section, locationTerms, infraTerms);

    return {
      available: snippets.length > 0,
      count: snippets.length,
      source: 'MoSPI PAIMANA Public Dashboard',
      snippets,
    };
  },
};

export default ProposedInfraService;
