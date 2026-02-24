/**
 * ═══════════════════════════════════════════════════════════════════════
 * WEATHER DATA SERVICE — Open-Meteo API Integration
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Fetches real-time weather data from the Open-Meteo API .
 * Data is cached in memory (keyed by lat/lng rounded to 2 decimals).
 * Falls back to estimated values if the API is unavailable.
 * 
 * API: https://open-meteo.com/
 * Rate limit: 10,000 requests/day 
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface HourlyWeatherData {
    time: string[];                // ISO8601 timestamps
    temperature: number[];         // °C at 2m
    windSpeed: number[];           // km/h at 10m
    windDirection: number[];       // degrees (0=N, 90=E, 180=S, 270=W)
    shortwaveRadiation: number[];  // W/m² (total solar on horizontal surface)
    directRadiation: number[];     // W/m² (beam/direct normal irradiance)
    diffuseRadiation: number[];    // W/m² (sky diffuse)
    relativeHumidity: number[];    // % at 2m
}

export interface WeatherData {
    latitude: number;
    longitude: number;
    elevation: number;             // meters above sea level
    timezone: string;
    hourly: HourlyWeatherData;
    fetchedAt: Date;
    isLive: boolean;               // true = from API, false = estimated fallback
}

export interface CurrentConditions {
    temperature: number;           // °C
    windSpeed: number;             // m/s (converted from km/h)
    windDirection: number;         // degrees
    windDirectionLabel: string;    // "NE", "SW", etc.
    solarRadiation: number;        // W/m²
    humidity: number;              // %
    isLive: boolean;
}

// ─── Cache ────────────────────────────────────────────────────────────

const weatherCache = new Map<string, WeatherData>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCacheKey(lat: number, lng: number, dateStr?: string): string {
    return `${lat.toFixed(2)}_${lng.toFixed(2)}${dateStr ? '_' + dateStr : ''}`;
}

// ─── Helper: today date string ────────────────────────────────────────
function toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();
}

// ─── API Fetch ────────────────────────────────────────────────────────

/**
 * Fetch weather data for a specific date.
 * - If date is today → uses Open-Meteo forecast API (real-time).
 * - If date is in the past or different month → uses ERA5 historical archive API.
 */
export async function fetchWeatherData(lat: number, lng: number, date?: Date): Promise<WeatherData> {
    const effectiveDate = date || new Date();
    const dateStr = toDateStr(effectiveDate);
    const useHistorical = !isToday(effectiveDate);
    const key = getCacheKey(lat, lng, dateStr);

    // Check cache
    const cached = weatherCache.get(key);
    if (cached && (Date.now() - cached.fetchedAt.getTime()) < CACHE_TTL_MS) {
        console.log('[WEATHER] Using cached data for', key);
        return cached;
    }

    if (useHistorical) {
        return fetchHistoricalWeatherData(lat, lng, effectiveDate);
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
            `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,` +
            `shortwave_radiation,direct_radiation,diffuse_radiation,relative_humidity_2m` +
            `&forecast_days=1&timezone=auto`;

        console.log('[WEATHER] Fetching from Open-Meteo (today):', url);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Open-Meteo API returned ${response.status}`);
        }

        const json = await response.json();

        const data: WeatherData = {
            latitude: json.latitude,
            longitude: json.longitude,
            elevation: json.elevation || 0,
            timezone: json.timezone || 'UTC',
            hourly: {
                time: json.hourly.time,
                temperature: json.hourly.temperature_2m,
                windSpeed: json.hourly.wind_speed_10m,
                windDirection: json.hourly.wind_direction_10m,
                shortwaveRadiation: json.hourly.shortwave_radiation,
                directRadiation: json.hourly.direct_radiation,
                diffuseRadiation: json.hourly.diffuse_radiation,
                relativeHumidity: json.hourly.relative_humidity_2m || [],
            },
            fetchedAt: new Date(),
            isLive: true,
        };

        // Cache it
        weatherCache.set(key, data);
        console.log('[WEATHER] ✅ Live data fetched:', {
            lat: data.latitude,
            lng: data.longitude,
            elevation: data.elevation,
            hours: data.hourly.time.length,
            peakSolar: Math.max(...data.hourly.shortwaveRadiation),
            maxWind: Math.max(...data.hourly.windSpeed),
            maxTemp: Math.max(...data.hourly.temperature),
        });

        return data;

    } catch (error) {
        console.warn('[WEATHER] ⚠️ API failed, using estimated data:', error);
        return generateEstimatedData(lat, lng);
    }
}

/**
 * Fetch historical weather data from Open-Meteo ERA5 archive for a specific date.
 * This covers ANY past date, enabling month slider to show real historical conditions.
 */
export async function fetchHistoricalWeatherData(lat: number, lng: number, date: Date): Promise<WeatherData> {
    const dateStr = toDateStr(date);
    const key = getCacheKey(lat, lng, dateStr);

    // Check cache
    const cached = weatherCache.get(key);
    if (cached && (Date.now() - cached.fetchedAt.getTime()) < CACHE_TTL_MS) {
        console.log('[WEATHER] Using cached historical data for', key);
        return cached;
    }

    try {
        // ERA5 reanalysis archive — free, no key, goes back to 1940
        // ERA5 has a ~5 day lag. If the requested date is in the future or very recent past,
        // we must subtract years to get a valid historical estimate for the same time of year.
        const targetDate = new Date(date);
        const now = new Date();
        const safeArchiveEnd = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
        
        if (targetDate > safeArchiveEnd) {
            // If the date is too recent or in the future, we use the same day from 
            // the most recent fully completed year as a climatological estimate.
            // This ensures consistent behavior (e.g. clicking Jun 2026 will fetch Jun 2025).
            const lastCompleteYear = now.getFullYear() - 1;
            targetDate.setFullYear(lastCompleteYear);
            console.log(`[WEATHER] Requested date ${dateStr} is too recent for ERA5. Using historical data from ${toDateStr(targetDate)} as an estimate.`);
        }
        
        const fetchDateStr = toDateStr(targetDate);

        const url = `https://archive-api.open-meteo.com/v1/archive` +
            `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
            `&start_date=${fetchDateStr}&end_date=${fetchDateStr}` +
            `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,` +
            `shortwave_radiation,direct_radiation,diffuse_radiation,relative_humidity_2m` +
            `&timezone=auto`;

        console.log('[WEATHER] Fetching ERA5 historical data:', url);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Open-Meteo ERA5 API returned ${response.status}`);
        }

        const json = await response.json();

        const data: WeatherData = {
            latitude: json.latitude,
            longitude: json.longitude,
            elevation: json.elevation || 0,
            timezone: json.timezone || 'UTC',
            hourly: {
                time: json.hourly.time,
                temperature: json.hourly.temperature_2m,
                windSpeed: json.hourly.wind_speed_10m,
                windDirection: json.hourly.wind_direction_10m,
                shortwaveRadiation: json.hourly.shortwave_radiation,
                directRadiation: json.hourly.direct_radiation,
                diffuseRadiation: json.hourly.diffuse_radiation,
                relativeHumidity: json.hourly.relative_humidity_2m || [],
            },
            fetchedAt: new Date(),
            isLive: true, // ERA5 is real measured data, not estimated
        };

        weatherCache.set(key, data);
        console.log('[WEATHER] ✅ ERA5 historical data:', { date: dateStr, hours: data.hourly.time.length });
        return data;

    } catch (error) {
        console.warn('[WEATHER] ⚠️ ERA5 failed, using estimated data:', error);
        return generateEstimatedData(lat, lng);
    }
}

/**
 * Get conditions at a specific hour (for the data panel to show the selected time).
 */
export function getConditionsAtHour(weather: WeatherData, hour: number): CurrentConditions {
    const idx = Math.min(Math.max(0, Math.floor(hour)), weather.hourly.time.length - 1);
    const windSpeedKmh = weather.hourly.windSpeed[idx] || 0;
    const windDir = weather.hourly.windDirection[idx] || 0;
    return {
        temperature: weather.hourly.temperature[idx] || 25,
        windSpeed: parseFloat((windSpeedKmh / 3.6).toFixed(1)),
        windDirection: windDir,
        windDirectionLabel: getWindDirectionLabel(windDir),
        solarRadiation: weather.hourly.shortwaveRadiation[idx] || 0,
        humidity: weather.hourly.relativeHumidity[idx] || 50,
        isLive: weather.isLive,
    };
}

/**
 * Get current conditions from weather data for the current hour.
 */
export function getCurrentConditions(weather: WeatherData): CurrentConditions {
    const now = new Date();
    const currentHour = now.getHours();

    // Find the closest hour index
    const idx = Math.min(currentHour, weather.hourly.time.length - 1);

    const windSpeedKmh = weather.hourly.windSpeed[idx] || 0;
    const windDir = weather.hourly.windDirection[idx] || 0;

    return {
        temperature: weather.hourly.temperature[idx] || 25,
        windSpeed: parseFloat((windSpeedKmh / 3.6).toFixed(1)), // km/h → m/s
        windDirection: windDir,
        windDirectionLabel: getWindDirectionLabel(windDir),
        solarRadiation: weather.hourly.shortwaveRadiation[idx] || 0,
        humidity: weather.hourly.relativeHumidity[idx] || 50,
        isLive: weather.isLive,
    };
}

/**
 * Get the wind speed (m/s) at a specific hour from weather data.
 * Converts from km/h to m/s.
 */
export function getWindAtHour(weather: WeatherData, hour: number): { speed: number; direction: number } {
    const idx = Math.min(Math.max(0, Math.floor(hour)), weather.hourly.time.length - 1);
    return {
        speed: (weather.hourly.windSpeed[idx] || 0) / 3.6, // km/h → m/s
        direction: weather.hourly.windDirection[idx] || 0,
    };
}

/**
 * Get solar radiation (W/m²) at a specific hour from weather data.
 */
export function getSolarAtHour(weather: WeatherData, hour: number): {
    shortwave: number;
    direct: number;
    diffuse: number;
} {
    const idx = Math.min(Math.max(0, Math.floor(hour)), weather.hourly.time.length - 1);
    return {
        shortwave: weather.hourly.shortwaveRadiation[idx] || 0,
        direct: weather.hourly.directRadiation[idx] || 0,
        diffuse: weather.hourly.diffuseRadiation[idx] || 0,
    };
}

/**
 * Calculate Heating Degree Days and Cooling Degree Days from real temperature data.
 * Base temperature: 18°C (typical for India/ASHRAE)
 */
export function calculateDegreeDays(weather: WeatherData): { hdd: number; cdd: number; avgTemp: number } {
    const temps = weather.hourly.temperature;
    if (temps.length === 0) return { hdd: 0, cdd: 0, avgTemp: 25 };

    const baseTemp = 18; // °C
    let hddSum = 0;
    let cddSum = 0;
    let tempSum = 0;

    for (const t of temps) {
        tempSum += t;
        if (t < baseTemp) hddSum += (baseTemp - t);
        if (t > baseTemp) cddSum += (t - baseTemp);
    }

    // Scale from daily to annual (rough approximation from single day)
    // More accurate with multi-day data
    const scaleFactor = 365;

    return {
        hdd: Math.round((hddSum / temps.length) * scaleFactor),
        cdd: Math.round((cddSum / temps.length) * scaleFactor),
        avgTemp: parseFloat((tempSum / temps.length).toFixed(1)),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getWindDirectionLabel(degrees: number): string {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(degrees / 22.5) % 16;
    return dirs[idx];
}

/**
 * Generate estimated weather data as fallback when API is unavailable.
 * Uses latitude-based climate approximations.
 */
function generateEstimatedData(lat: number, lng: number): WeatherData {
    const absLat = Math.abs(lat);

    // Estimate based on latitude
    let baseTemp = 30 - absLat * 0.5;   // Hotter near equator
    let baseWind = 3 + absLat * 0.05;   // Windier at higher latitudes
    let baseSolar = 800 - absLat * 5;   // More sun near equator

    // Generate 24 hourly values
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const time = hours.map(h => {
        const d = new Date();
        d.setHours(h, 0, 0, 0);
        return d.toISOString().slice(0, 16);
    });

    return {
        latitude: lat,
        longitude: lng,
        elevation: 0,
        timezone: 'UTC',
        hourly: {
            time,
            temperature: hours.map(h => {
                // Diurnal temperature variation
                const diurnal = Math.sin((h - 6) * Math.PI / 12) * 8;
                return parseFloat((baseTemp + diurnal).toFixed(1));
            }),
            windSpeed: hours.map(h => {
                // Wind typically stronger in afternoon
                const variation = Math.sin((h - 3) * Math.PI / 12) * 2;
                return parseFloat(Math.max(0, (baseWind + variation) * 3.6).toFixed(1)); // m/s → km/h
            }),
            windDirection: hours.map(() => 90 + Math.random() * 30 - 15), // ~East with variation
            shortwaveRadiation: hours.map(h => {
                if (h < 6 || h > 18) return 0;
                return Math.round(baseSolar * Math.sin((h - 6) * Math.PI / 12));
            }),
            directRadiation: hours.map(h => {
                if (h < 6 || h > 18) return 0;
                return Math.round(baseSolar * 0.7 * Math.sin((h - 6) * Math.PI / 12));
            }),
            diffuseRadiation: hours.map(h => {
                if (h < 6 || h > 18) return 0;
                return Math.round(baseSolar * 0.3 * Math.sin((h - 6) * Math.PI / 12));
            }),
            relativeHumidity: hours.map(h => {
                // Higher humidity at night, lower during day
                return Math.round(60 - Math.sin((h - 6) * Math.PI / 12) * 20);
            }),
        },
        fetchedAt: new Date(),
        isLive: false,
    };
}

/**
 * Clear the weather cache (useful for testing or forced refresh).
 */
export function clearWeatherCache(): void {
    weatherCache.clear();
    console.log('[WEATHER] Cache cleared');
}
