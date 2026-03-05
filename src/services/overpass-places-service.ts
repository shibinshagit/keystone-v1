
import { Amenity, AmenityCategory } from './mapbox-places-service';

/**
 * Service to interact with OpenStreetMap (Overpass API) to find nearby amenities.
 *
 * All queries are proxied through /api/overpass to avoid CORS and rate-limiting.
 * A single combined query fetches all categories in one request.
 */
export const OverpassPlacesService = {

    /**
     * Search for amenities around a central point using Overpass API.
     * @param center [lng, lat]
     * @param categories Single category or array of categories
     * @param radius Search radius in meters (default 2000m = 2 km)
     */
    async searchNearby(
        center: [number, number],
        categories: AmenityCategory | AmenityCategory[],
        radius: number = 2000
    ): Promise<Amenity[]> {

        const categoryList = Array.isArray(categories) ? categories : [categories];
        if (categoryList.length === 0) return [];

        // Clamp radius between 500 m and 5 km
        const r = Math.max(500, Math.min(radius, 5000));
        const [lng, lat] = center;

        // ── Build ONE combined Overpass QL query for all categories ────
        const parts = categoryList.map(cat => {
            if (cat === 'transit') {
                return [
                    `node["railway"~"station|halt"](around:${r},${lat},${lng});`,
                    `way["railway"~"station|halt"](around:${r},${lat},${lng});`,
                    `node["aeroway"="aerodrome"](around:${r},${lat},${lng});`,
                    `way["aeroway"="aerodrome"](around:${r},${lat},${lng});`,
                    `node["amenity"="bus_station"](around:${r},${lat},${lng});`,
                    `way["amenity"="bus_station"](around:${r},${lat},${lng});`,
                    `node["highway"="bus_stop"](around:${r},${lat},${lng});`,
                    `node["public_transport"](around:${r},${lat},${lng});`,
                    `way["public_transport"](around:${r},${lat},${lng});`,
                ].join('\n');
            }
            const filterMap: Record<string, string> = {
                school:      '["amenity"~"school|kindergarten"]',
                college:     '["amenity"~"college|university"]',
                hospital:    '["amenity"~"hospital|clinic|doctors|pharmacy"]',
                park:        '["leisure"~"park|garden|playground"]',
                restaurant:  '["amenity"~"restaurant|cafe|fast_food"]',
                shopping:    '["shop"~"supermarket|convenience"]',
                mall:        '["shop"~"mall|department_store"]',
                atm:         '["amenity"~"^(atm|bank)$"]',
                petrol_pump: '["amenity"="fuel"]',
            };
            const f = filterMap[cat];
            if (!f) return '';
            return [
                `node${f}(around:${r},${lat},${lng});`,
                `way${f}(around:${r},${lat},${lng});`,
                `relation${f}(around:${r},${lat},${lng});`,
            ].join('\n');
        }).filter(Boolean).join('\n');

        const query = `[out:json][timeout:60];\n(\n${parts}\n);\nout center;`;

        console.log(`[Overpass] Scanning ${categoryList.length} categories within ${r}m via server proxy…`);

        // ── Send through server-side proxy (single request) ───────────
        let elements: any[] = [];
        try {
            const res = await fetch('/api/overpass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                console.error(`[Overpass] Proxy returned ${res.status}:`, errBody.error || '');
                // Return empty gracefully rather than throwing
                return [];
            }

            const data = await res.json();
            elements = data.elements || [];
            console.log(`[Overpass] ✓ Received ${elements.length} raw elements`);
        } catch (err) {
            console.error('[Overpass] Proxy request failed:', err);
            return [];
        }

        // ── De-duplicate by OSM id ────────────────────────────────────
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
                else if (tags.railway || tags.aeroway || tags.station || tags.amenity === 'bus_station' || tags.public_transport || tags.highway === 'bus_stop') category = 'transit';
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

        // Keep only results within the requested radius (+10% tolerance)
        const maxDist = r * 1.1;
        return mapped
            .filter((a): a is Amenity => a !== null)
            .filter(a => a.distance <= maxDist)
            .sort((a, b) => a.distance - b.distance);
    },

    /**
     * Fetch road geometries within a bounding box.
     * @param bbox [minX, minY, maxX, maxY] (SW, NE)
     */
    async fetchRoads(bbox: [number, number, number, number]): Promise<any[]> {
        const [minX, minY, maxX, maxY] = bbox;
        const query = `[out:json][timeout:30];way["highway"](${minY},${minX},${maxY},${maxX});out geom;`;

        console.log(`[Overpass] Fetching roads in bbox via server proxy…`);

        try {
            const res = await fetch('/api/overpass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });

            if (!res.ok) {
                console.error(`[Overpass] Road proxy returned ${res.status}`);
                return [];
            }

            const data = await res.json();
            if (!data || !data.elements) {
                console.warn('[Overpass] Road proxy returned empty data');
                return [];
            }

            const ways = data.elements.filter((el: any) => el.type === 'way' && el.geometry);
            console.log(`[Overpass] Found ${ways.length} roads.`);

            return ways.map((way: any) => ({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: way.geometry.map((g: any) => [g.lon, g.lat])
                },
                properties: way.tags || {}
            }));
        } catch (error) {
            console.error('[Overpass] Road fetch failed:', error);
            return [];
        }
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
