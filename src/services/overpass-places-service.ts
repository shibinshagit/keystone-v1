
import { Amenity, AmenityCategory } from './mapbox-places-service';

/**
 * Service to interact with OpenStreetMap (Overpass API) to find nearby amenities.
 */
export const OverpassPlacesService = {

    /**
     * Search for amenities around a central point using Overpass API.
     * @param center [lng, lat]
     * @param categories Single category or array of categories
     * @param radius Search radius in meters (default 5000m)
     */
    async searchNearby(
        center: [number, number],
        categories: AmenityCategory | AmenityCategory[],
        radius: number = 5000
    ): Promise<Amenity[]> {

        const categoryList = Array.isArray(categories) ? categories : [categories];
        if (categoryList.length === 0) return [];

        const [lng, lat] = center;

        const SERVERS = [
            'https://overpass-api.de/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
        ];
        const BATCH_SIZE = 2; // categories per HTTP request

        /** Build the Overpass QL body for a subset of categories */
        const buildQueryParts = (cats: AmenityCategory[]): string =>
            cats.map(cat => {
                if (cat === 'transit') {
                    return `
                      node["railway"~"station|halt"](around:${radius},${lat},${lng});
                      way["railway"~"station|halt"](around:${radius},${lat},${lng});
                      node["station"~"subway|light_rail"](around:${radius},${lat},${lng});
                      node["aeroway"="aerodrome"](around:${radius},${lat},${lng});
                      way["aeroway"="aerodrome"](around:${radius},${lat},${lng});
                      node["amenity"="bus_station"](around:${radius},${lat},${lng});
                    `;
                }
                const filterMap: Record<string, string> = {
                    school:      `["amenity"~"school|kindergarten"]`,
                    college:     `["amenity"~"college|university"]`,
                    hospital:    `["amenity"~"hospital|clinic|doctors|pharmacy"]`,
                    park:        `["leisure"~"park|garden|playground"]`,
                    restaurant:  `["amenity"~"restaurant|cafe|fast_food"]`,
                    shopping:    `["shop"~"supermarket|convenience"]`,
                    mall:        `["shop"~"mall|department_store"]`,
                    atm:         `["amenity"~"^(atm|bank)$"]`,
                    petrol_pump: `["amenity"="fuel"]`,
                };
                const f = filterMap[cat];
                if (!f) return '';
                return `
                  node${f}(around:${radius},${lat},${lng});
                  way${f}(around:${radius},${lat},${lng});
                  relation${f}(around:${radius},${lat},${lng});
                `;
            }).join('\n');

        /** Fetch one batch, trying each mirror in turn */
        const fetchBatch = async (cats: AmenityCategory[]): Promise<any[]> => {
            const parts = buildQueryParts(cats);
            if (!parts.trim()) return [];

            const query = `[out:json][timeout:30];\n(\n${parts}\n);\nout center;`;
            const encoded = encodeURIComponent(query);

            for (let i = 0; i < SERVERS.length; i++) {
                const url = `${SERVERS[i]}?data=${encoded}`;
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        console.warn(`[OverpassService] Server ${i + 1} returned ${response.status} for batch [${cats.join(',')}]`);
                        continue;
                    }
                    const contentType = response.headers.get('content-type') ?? '';
                    if (!contentType.includes('application/json')) {
                        console.warn(`[OverpassService] Server ${i + 1} returned non-JSON for batch [${cats.join(',')}]`);
                        continue;
                    }
                    const data = await response.json();
                    return data.elements ?? [];
                } catch (err) {
                    console.warn(`[OverpassService] Server ${i + 1} error for batch [${cats.join(',')}]:`, err);
                }
            }
            console.error(`[OverpassService] All servers failed for batch [${cats.join(',')}]`);
            return [];
        };

        // Split into batches and run in parallel
        const batches: AmenityCategory[][] = [];
        for (let i = 0; i < categoryList.length; i += BATCH_SIZE) {
            batches.push(categoryList.slice(i, i + BATCH_SIZE));
        }

        console.log(`[OverpassService] Fetching ${categoryList.length} categories in ${batches.length} batch(es)…`);
        const batchResults = await Promise.all(batches.map(fetchBatch));
        const elements: any[] = batchResults.flat();
        console.log(`[OverpassService] Found ${elements.length} elements total.`);

        // Deduplicate by OSM id (same element may appear in multiple batches if category overlaps)
        const seen = new Set<number>();

        const mapped: (Amenity | null)[] = elements
            .filter((el: any) => {
                if (seen.has(el.id)) return false;
                seen.add(el.id);
                return true;
            })
            .map((el: any): Amenity | null => {
                const elLat = el.lat ?? el.center?.lat;
                const elLng = el.lon ?? el.center?.lon;
                if (!elLat || !elLng) return null;

                let category: AmenityCategory = 'school';
                const tags = el.tags || {};

                if (tags.amenity?.match(/college|university/)) category = 'college';
                else if (tags.amenity?.match(/school|kindergarten/)) category = 'school';
                else if (tags.amenity?.match(/hospital|clinic|doctors|pharmacy/)) category = 'hospital';
                else if (tags.railway || tags.aeroway || tags.station || tags.amenity === 'bus_station' || tags.public_transport) category = 'transit';
                else if (tags.leisure?.match(/park|garden|playground/)) category = 'park';
                else if (tags.amenity?.match(/restaurant|cafe|fast_food/)) category = 'restaurant';
                else if (tags.shop?.match(/mall|department_store/)) category = 'mall';
                else if (tags.shop?.match(/supermarket|convenience/)) category = 'shopping';
                else if (tags.amenity?.match(/^(atm|bank)$/)) category = 'atm';
                else if (tags.amenity === 'fuel') category = 'petrol_pump';

                if (tags.amenity === 'blood_bank') return null;

                let name = tags.name || tags['name:en'] || tags.operator || tags.brand;
                if (!name) {
                    const subtype = tags.amenity || tags.leisure || tags.shop || tags.railway || tags.aeroway || category;
                    name = `${subtype.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`;
                }

                const addressParts = [
                    tags['addr:housenumber'],
                    tags['addr:street'],
                    tags['addr:city'],
                    tags['addr:postcode'],
                ].filter(Boolean);
                let address = addressParts.join(', ');
                if (!address) address = tags['addr:full'] || '';
                if (!address) address = 'Address not available';
                if (name === address) address = '';

                const distance = calculateDistanceInMeters(lat, lng, elLat, elLng);

                return { id: `osm-${el.id}`, name, category, distance: Math.round(distance), coordinates: [elLng, elLat] as [number, number], address };
            });

        return mapped
            .filter((a): a is Amenity => a !== null)
            .filter(a => a.distance < 10000)
            .sort((a, b) => a.distance - b.distance);
    },

    /**
     * Fetch road geometries within a bounding box.
     * @param bbox [minX, minY, maxX, maxY] (SW, NE)
     */
    async fetchRoads(bbox: [number, number, number, number]): Promise<any[]> {
        const [minX, minY, maxX, maxY] = bbox;
        const query = `
            [out:json][timeout:25];
            way["highway"](${minY},${minX},${maxY},${maxX});
            out geom;
        `;

        const servers = [
            'https://overpass-api.de/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter'
        ];

        console.log(`[OverpassService] Fetching roads in bbox...`);

        for (let i = 0; i < servers.length; i++) {
            const url = `${servers[i]}?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`[OverpassService] Server ${i + 1} failed: ${response.status}`);
                    continue;
                }

                const contentType = response.headers.get("content-type");
                let data: any;

                try {
                    if (contentType && !contentType.includes("application/json")) {
                        const text = await response.text();
                        console.error(`[OverpassService] Server ${i + 1} expected JSON but received ${contentType}. Body starts with: ${text.substring(0, 100)}`);
                        continue;
                    }
                    data = await response.json();
                } catch (e) {
                    const text = await response.clone().text().catch(() => "Could not read body");
                    console.error(`[OverpassService] Server ${i + 1} failed to parse JSON. Body starts with: ${text.substring(0, 100)}`);
                    continue;
                }

                if (!data || !data.elements) {
                    console.warn(`[OverpassService] Server ${i + 1} returned empty or invalid data structure.`);
                    continue;
                }

                const ways = data.elements.filter((el: any) => el.type === 'way' && el.geometry);
                console.log(`[OverpassService] Found ${ways.length} roads.`);

                return ways.map((way: any) => ({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: way.geometry.map((g: any) => [g.lon, g.lat])
                    },
                    properties: way.tags || {}
                }));
            } catch (error) {
                console.warn(`[OverpassService] Server ${i + 1} error:`, error);
                if (i === servers.length - 1) {
                    console.error(`[OverpassService] All servers failed`);
                    return [];
                }
            }
        }

        return [];
    }
};

function calculateDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}
