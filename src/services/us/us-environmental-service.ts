/**
 * US Environmental & Topography Service
 * 
 * Fetches free, open-source environmental data from federal APIs:
 * 1. USGS National Map API for Elevation/Topography
 * 2. FEMA NFHL ArcGIS REST for Flood Zones
 * 3. EPA EJScreen for Environmental Justice indicators
 * 4. National Register of Historic Places (NPS) for historic districts
 */

export interface USEnvironmentalData {
    elevationMeters: number | null;
    floodZone: FEMAFloodZone | null;
    ejscreen: EPAEJScreenData | null;
    historicDistrict: HistoricDistrictData | null;
    source: 'usgs-api' | 'llm' | 'fallback';
}

export interface FEMAFloodZone {
    zone: string;            // A, AE, AH, AO, V, VE, X, D, etc.
    zoneDescription: string;
    isHighRisk: boolean;     // true for A/V zones (100-year flood)
    panelNumber: string;     // FIRM panel
    source: 'fema-nfhl' | 'fallback';
}

export interface EPAEJScreenData {
    /** Percentile (0-100) — higher = more environmental burden */
    ejIndex: number | null;
    /** PM2.5 level percentile */
    pm25Percentile: number | null;
    /** Proximity to hazardous waste sites percentile */
    hazWastePercentile: number | null;
    /** Lead paint indicator percentile */
    leadPaintPercentile: number | null;
    /** Water discharge proximity percentile */
    waterDischargePercentile: number | null;
    source: 'epa-ejscreen' | 'fallback';
}

export interface HistoricDistrictData {
    isInHistoricDistrict: boolean;
    districtName: string | null;
    nrhpStatus: string | null;  // 'Listed' | 'Eligible' | 'Not Listed'
    source: 'nps-api' | 'fallback';
}

const EPA_EJSCREEN_ENDPOINT = 'https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx';
const FEMA_NFHL_ENDPOINT = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';
let hasLoggedEPAEJScreenDnsFailure = false;
let hasLoggedFEMANetworkFailure = false;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDNSResolutionError(error: unknown, hostname: string): boolean {
    if (!isObject(error)) return false;

    const cause = isObject(error.cause) ? error.cause : error;
    return cause.code === 'ENOTFOUND' && cause.hostname === hostname;
}

function isTransientNetworkError(error: unknown, hostname: string): boolean {
    if (!isObject(error)) return false;

    const cause = isObject(error.cause) ? error.cause : error;
    return (
        cause.hostname === hostname &&
        (cause.code === 'ECONNRESET' || cause.code === 'ETIMEDOUT' || cause.code === 'UND_ERR_CONNECT_TIMEOUT')
    );
}

async function fetchWithRetry(url: string, init: RequestInit, retries: number, delayMs: number): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fetch(url, init);
        } catch (error) {
            lastError = error;
            if (attempt === retries) break;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

export const USEnvironmentalService = {
    /**
     * Get all environmental data in parallel.
     */
    async getEnvironmentalData(coordinates: [number, number]): Promise<USEnvironmentalData> {
        const [lng, lat] = coordinates;

        const [elevation, floodZone, ejscreen, historicDistrict] = await Promise.allSettled([
            this.fetchUSGSElevation(lng, lat),
            this.fetchFEMAFloodZone(lng, lat),
            this.fetchEPAEJScreen(lng, lat),
            this.fetchHistoricDistrict(lng, lat),
        ]);
        
        return {
            elevationMeters: elevation.status === 'fulfilled' ? elevation.value : null,
            floodZone: floodZone.status === 'fulfilled' ? floodZone.value : null,
            ejscreen: ejscreen.status === 'fulfilled' ? ejscreen.value : null,
            historicDistrict: historicDistrict.status === 'fulfilled' ? historicDistrict.value : null,
            source: elevation.status === 'fulfilled' && elevation.value !== null ? 'usgs-api' : 'fallback',
        };
    },

    /**
     * Query USGS Elevation Point Query Service (EPQS)
     * https://epqs.nationalmap.gov/v1/json
     */
    async fetchUSGSElevation(lng: number, lat: number): Promise<number | null> {
        try {
            const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&output=json`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return null;
            
            const data = await res.json();
            const value = parseFloat(data.value);
            
            if (isNaN(value)) return null;
            return value;
        } catch (error) {
            console.warn('[USEnvironmentalService] USGS Elevation fetch failed:', error);
            return null;
        }
    },

    /**
     * Query FEMA National Flood Hazard Layer (NFHL) via ArcGIS REST.
     * This is the reliable endpoint — avoids the TLS issues with hazards.fema.gov direct.
     *
     * Endpoint: FEMA Map Service (public, no auth)
     * Layer 28 = Flood Hazard Zones (S_Fld_Haz_Ar)
     * https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer
     */
    async fetchFEMAFloodZone(lng: number, lat: number): Promise<FEMAFloodZone | null> {
        try {
            // Use a small envelope around the point (FEMA ArcGIS requires geometry queries)
            const buffer = 0.0005; // ~55m buffer
            const envelope = JSON.stringify({
                xmin: lng - buffer,
                ymin: lat - buffer,
                xmax: lng + buffer,
                ymax: lat + buffer,
                spatialReference: { wkid: 4326 },
            });

            const params = new URLSearchParams({
                geometry: envelope,
                geometryType: 'esriGeometryEnvelope',
                spatialRel: 'esriSpatialRelIntersects',
                outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,FIRM_PAN',
                returnGeometry: 'false',
                f: 'json',
            });

            // Layer 28 = S_Fld_Haz_Ar (Flood Hazard Areas)
            const url = `${FEMA_NFHL_ENDPOINT}?${params.toString()}`;

            const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(8000) }, 1, 300);
            if (!res.ok) {
                console.warn(`[USEnvironmentalService] FEMA NFHL HTTP ${res.status}`);
                return null;
            }

            const data = await res.json();

            if (data.error) {
                console.warn('[USEnvironmentalService] FEMA NFHL API error:', data.error);
                return null;
            }

            if (!data.features || data.features.length === 0) {
                // No FEMA data — likely outside mapped FIRM area
                return {
                    zone: 'X',
                    zoneDescription: 'Area of Minimal Flood Hazard (outside mapped FIRM panel)',
                    isHighRisk: false,
                    panelNumber: 'N/A',
                    source: 'fema-nfhl',
                };
            }

            const attrs = data.features[0].attributes;
            const zone = attrs.FLD_ZONE || 'X';
            const subtype = attrs.ZONE_SUBTY || '';
            const isSFHA = attrs.SFHA_TF === 'T';
            const panel = attrs.FIRM_PAN || attrs.DFIRM_ID || 'N/A';

            return {
                zone,
                zoneDescription: this.getFloodZoneDescription(zone, subtype),
                isHighRisk: isSFHA || /^(A|AE|AH|AO|AR|A99|V|VE)$/i.test(zone),
                panelNumber: panel,
                source: 'fema-nfhl',
            };
        } catch (error) {
            if (isTransientNetworkError(error, 'hazards.fema.gov')) {
                if (!hasLoggedFEMANetworkFailure) {
                    hasLoggedFEMANetworkFailure = true;
                    console.warn(
                        '[USEnvironmentalService] FEMA NFHL service is temporarily unreachable (TLS/network handshake failed at hazards.fema.gov); returning null and continuing without flood zone data.',
                    );
                }
                return null;
            }

            console.warn('[USEnvironmentalService] FEMA flood zone fetch failed:', error);
            return null;
        }
    },

    /**
     * Query EPA EJScreen REST API for environmental justice indicators.
     * https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx
     *
     * Returns percentiles (0-100) for various environmental indicators
     * at a 1-mile buffer around the point.
     */
    async fetchEPAEJScreen(lng: number, lat: number): Promise<EPAEJScreenData | null> {
        try {
            const params = new URLSearchParams({
                namestr: '',
                geometry: JSON.stringify({
                    x: lng,
                    y: lat,
                    spatialReference: { wkid: 4326 },
                }),
                distance: '1',
                unit: '9035',
                session: '',
                f: 'json',
            });
            const url = `${EPA_EJSCREEN_ENDPOINT}?${params.toString()}`;

            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) {
                console.warn(`[USEnvironmentalService] EPA EJScreen HTTP ${res.status}`);
                return null;
            }

            const data = await res.json();

            // EJScreen returns data in a nested structure
            const raw = data?.data?.[0] || data?.Results?.[0] || null;
            if (!raw) {
                console.warn('[USEnvironmentalService] EPA EJScreen no data returned');
                return null;
            }

            // Field names vary by API version — try common ones
            const getField = (obj: any, ...keys: string[]): number | null => {
                for (const key of keys) {
                    if (obj[key] != null) {
                        const v = parseFloat(obj[key]);
                        if (!isNaN(v)) return v;
                    }
                }
                return null;
            };

            return {
                ejIndex: getField(raw, 'T_OVR64PCT', 'EJ_PCT', 'VULEOPCT'),
                pm25Percentile: getField(raw, 'T_PM25', 'PM25_PER', 'P_PM25'),
                hazWastePercentile: getField(raw, 'T_TSDF', 'TSDF_PER', 'P_TSDF'),
                leadPaintPercentile: getField(raw, 'T_LDPNT', 'LDPNT_PER', 'P_LDPNT'),
                waterDischargePercentile: getField(raw, 'T_PWDIS', 'PWDIS_PER', 'P_PWDIS'),
                source: 'epa-ejscreen',
            };
        } catch (error) {
            if (isDNSResolutionError(error, 'ejscreen.epa.gov')) {
                if (!hasLoggedEPAEJScreenDnsFailure) {
                    hasLoggedEPAEJScreenDnsFailure = true;
                    console.warn(
                        '[USEnvironmentalService] EPA EJScreen host is unavailable (DNS lookup failed for ejscreen.epa.gov); returning null and continuing without EJScreen data.',
                    );
                }
                return null;
            }

            console.warn('[USEnvironmentalService] EPA EJScreen fetch failed:', error);
            return null;
        }
    },

    /**
     * Check if coordinates are within or near a National Register of Historic Places district.
     * Uses the NPS ArcGIS REST service.
     */
    async fetchHistoricDistrict(lng: number, lat: number): Promise<HistoricDistrictData | null> {
        try {
            const buffer = 0.002; // ~220m buffer
            const envelope = JSON.stringify({
                xmin: lng - buffer,
                ymin: lat - buffer,
                xmax: lng + buffer,
                ymax: lat + buffer,
                spatialReference: { wkid: 4326 },
            });

            const params = new URLSearchParams({
                geometry: envelope,
                geometryType: 'esriGeometryEnvelope',
                spatialRel: 'esriSpatialRelIntersects',
                outFields: 'RESNAME,NRIS_Refnum,STATUS',
                returnGeometry: 'false',
                f: 'json',
                resultRecordCount: '3',
            });

            // NPS Cultural Resources GIS — National Register of Historic Places boundaries
            const url = `https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0/query?${params.toString()}`;

            const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) return null;

            const data = await res.json();

            if (!data.features || data.features.length === 0) {
                return {
                    isInHistoricDistrict: false,
                    districtName: null,
                    nrhpStatus: 'Not Listed',
                    source: 'nps-api',
                };
            }

            const attrs = data.features[0].attributes;
            return {
                isInHistoricDistrict: true,
                districtName: attrs.RESNAME || 'Historic District',
                nrhpStatus: attrs.STATUS || 'Listed',
                source: 'nps-api',
            };
        } catch (error) {
            console.warn('[USEnvironmentalService] NPS Historic Places fetch failed:', error);
            return null;
        }
    },

    /**
     * Human-readable flood zone descriptions per FEMA designation.
     */
    getFloodZoneDescription(zone: string, subtype: string): string {
        const upper = zone.toUpperCase();
        switch (upper) {
            case 'A':
                return '100-Year Flood Zone — Special Flood Hazard Area (no BFE determined)';
            case 'AE':
                return '100-Year Flood Zone — Special Flood Hazard Area (Base Flood Elevation determined)';
            case 'AH':
                return '100-Year Flood Zone — Shallow flooding (1-3 ft ponding)';
            case 'AO':
                return '100-Year Flood Zone — Sheet flow flooding (1-3 ft)';
            case 'AR':
                return 'Flood Zone AR — Temporarily increased risk due to levee restoration';
            case 'A99':
                return 'Flood Zone A99 — Federal flood protection under construction';
            case 'V':
                return 'High-Risk Coastal Flood Zone — Wave action (no BFE)';
            case 'VE':
                return 'High-Risk Coastal Flood Zone — Wave action (BFE determined)';
            case 'X':
                if (subtype?.includes('500')) {
                    return 'Moderate Flood Risk — 500-Year Floodplain (0.2% annual chance)';
                }
                return 'Minimal Flood Risk — Outside 500-year floodplain';
            case 'D':
                return 'Flood Risk Undetermined — Possible but not studied';
            case 'B':
                return 'Moderate Flood Risk — Area between 100-year and 500-year floodplain';
            case 'C':
                return 'Minimal Flood Risk — Area outside 500-year floodplain';
            default:
                return `Flood Zone ${zone}${subtype ? ` (${subtype})` : ''}`;
        }
    },
};
