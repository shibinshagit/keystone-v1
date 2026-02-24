import { getSunPosition } from '@/lib/sun-utils';
import type { Building, GreenRegulationData } from '@/lib/types';
import * as turf from '@turf/turf';
import type { WeatherData } from './weather-data-service';
import { getWindAtHour, getSolarAtHour, calculateDegreeDays } from './weather-data-service';

export interface AggregateAnalysisResult {
    compliantArea: number; // Percentage 0-100
    avgValue: number;
}

/**
 * Helper to calculate aggregate statistics from analysis results
 */
export function calculateAggregateStats(
    results: Map<string, BuildingAnalysisResult>,
    mode: AnalysisMode,
    buildings: Building[],
    greenRegulations: GreenRegulationData[] = []
): AggregateAnalysisResult {
    if (results.size === 0) return { compliantArea: 0, avgValue: 0 };

    let totalArea = 0;
    let compliantArea = 0;
    let totalValueArea = 0;

    // Get thresholds
    const thresholds = greenRegulations.length > 0 ? greenRegulations.map(parseThresholdsFromRegulation)[0] : {};

    buildings.forEach(b => {
        const res = results.get(b.id);
        if (!res) return;

        // Weight by floor area (or just footprint area if simple)
        // Let's use total floor area for more accuracy
        const bArea = b.floors.length * b.area;
        totalArea += bArea;
        totalValueArea += res.value * bArea;

        // Check compliance
        let isCompliant = false;
        if (mode === 'wind') {
            // Wind: Target is ventilation. 
            // If wind speed > min (e.g. 0.6 m/s), it's ventilated.
            const minSpeed = thresholds?.windSpeedMin || 0.6;
            if (res.value >= minSpeed) isCompliant = true;
        } else if (mode === 'sun-hours') {
            // Sun: Target is direct sunlight.
            // If hours > min (e.g. 2 hours), it's compliant.
            const minHours = thresholds?.sunHoursMin || 2;
            if (res.value >= minHours) isCompliant = true;
        } else if (mode === 'daylight') {
            // Daylight: DF > min (e.g. 2%)
            // Value in runVisualAnalysis for daylight is 'daylightFactor' (0-1 approx).
            // So if minDF is 0.02, we check >= 0.02
            const minDF = thresholds?.daylightFactorMin || 0.02;
            if (res.value >= minDF) isCompliant = true;
        }

        if (isCompliant) {
            compliantArea += bArea;
        }
    });

    if (totalArea === 0) return { compliantArea: 0, avgValue: 0 };

    return {
        compliantArea: (compliantArea / totalArea) * 100,
        avgValue: totalValueArea / totalArea
    };
}

export type AnalysisMode = 'none' | 'sun-hours' | 'daylight' | 'wind' | 'energy' | 'mobility' | 'resilience';

// Parsed threshold values from certificate regulations
interface ParsedThresholds {
    sunHoursMin?: number;
    sunHoursTarget?: number;
    daylightFactorMin?: number;
    daylightFactorTarget?: number;
    windSpeedMin?: number;
    windSpeedTarget?: number;
}

/**
 * Parse numeric thresholds from green regulation requirements
 */
export function parseThresholdsFromRegulation(
    regulation: GreenRegulationData
): ParsedThresholds {
    const thresholds: ParsedThresholds = {};

    // PRIORITY 1: Check explicit analysisThresholds field
    if (regulation.analysisThresholds) {
        if (regulation.analysisThresholds.sunHours) {
            thresholds.sunHoursMin = regulation.analysisThresholds.sunHours.min;
            thresholds.sunHoursTarget = regulation.analysisThresholds.sunHours.target;
        }
        if (regulation.analysisThresholds.daylightFactor) {
            thresholds.daylightFactorMin = regulation.analysisThresholds.daylightFactor.min;
            thresholds.daylightFactorTarget = regulation.analysisThresholds.daylightFactor.target;
        }
        if (regulation.analysisThresholds.windSpeed) {
            thresholds.windSpeedMin = regulation.analysisThresholds.windSpeed.min;
            thresholds.windSpeedTarget = regulation.analysisThresholds.windSpeed.target;
        }

        // If explicit thresholds are provided, return early
        if (thresholds.sunHoursMin || thresholds.daylightFactorMin || thresholds.windSpeedMin) {
            return thresholds;
        }
    }

    // FALLBACK: Parse from credit requirements (legacy behavior)
    const daylightCredits = regulation.categories
        ?.flatMap(cat => cat.credits)
        .filter(credit =>
            credit.name.toLowerCase().includes('daylight') ||
            credit.name.toLowerCase().includes('sun') ||
            credit.name.toLowerCase().includes('natural light') ||
            credit.code?.includes('EQ')
        ) || [];

    for (const credit of daylightCredits) {
        for (const req of credit.requirements || []) {
            const hoursMatch = req.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
            if (hoursMatch) {
                const hours = parseFloat(hoursMatch[1]);
                if (!thresholds.sunHoursMin || hours < thresholds.sunHoursMin) {
                    thresholds.sunHoursMin = hours;
                }
            }

            const dfMatch = req.match(/(\d+(?:\.\d+)?)\s*%\s*(?:daylight\s*factor|DF)/i);
            if (dfMatch) {
                const df = parseFloat(dfMatch[1]) / 100;
                if (!thresholds.daylightFactorMin || df < thresholds.daylightFactorMin) {
                    thresholds.daylightFactorMin = df;
                }
            }
        }
    }

    if (thresholds.sunHoursMin) {
        thresholds.sunHoursTarget = thresholds.sunHoursMin * 1.5;
    }
    if (thresholds.daylightFactorMin) {
        thresholds.daylightFactorTarget = thresholds.daylightFactorMin * 1.5;
    }

    return thresholds;
}

const DEFAULT_THRESHOLDS: ParsedThresholds = {
    sunHoursMin: 2,
    sunHoursTarget: 4,
    daylightFactorMin: 0.02,
    daylightFactorTarget: 0.04,
    windSpeedMin: 0.6,
    windSpeedTarget: 1.2
};

/**
 * Results from visual analysis for a single building
 */
export interface BuildingAnalysisResult {
    buildingId: string;
    value: number;
    color: string; // Hex color #RRGGBB
    unit?: string; // Display unit e.g. 'hrs', 'kWh/m²/yr', 'trips/day'
    label?: string; // Display label
}

// Helper to calculate edge normal
function getEdgeNormal(p1: number[], p2: number[]): number[] {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    // Normal is (-dy, dx) for counter-clockwise winding, or (dy, -dx)
    // Turf polygons are usually CCW. P1->P2 vector is (dx, dy).
    // Normal facing OUTWARD: (dy, -dx) checks out? 
    // If P1=(0,0), P2=(1,0) (East edge), Normal should be (0, -1) (South)? No.
    // Let's assume standard math: Normal = (dy, -dx) normalized.
    const len = Math.sqrt(dx * dx + dy * dy);
    return [dy / len, -dx / len];
}

/**
 * Calculate solar exposure by summing up exposure of all polygon edges
 * accounts for orientation of every face
 */
function calculatePolygonSolarExposure(
    building: Building,
    sunAzimuth: number,
    sunAltitude: number
): number {
    if (sunAltitude <= 0) return 0;

    // Ensure consistent winding (CCW) for correct Normal calculation
    const safePoly = turf.rewind(building.geometry as any, { reverse: false });
    const coords = safePoly.geometry.coordinates[0];

    // Ensure we have a valid polygon
    if (!coords || coords.length < 3) return 0;

    // Sun Vector (XY plane projection)
    // Azimuth 0 = North, PI = South.
    // x = sin(az), y = cos(az) 
    const sunVecX = Math.sin(sunAzimuth);
    const sunVecY = Math.cos(sunAzimuth);

    let totalExposure = 0;
    let totalPerimeter = 0;

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];

        // Edge vector
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy);

        // Edge Normal (Outward facing)
        // Assuming CCW winding: (dy, -dx)
        const nx = dy / len;
        const ny = -dx / len;

        // Dot product with sun vector
        const dot = nx * sunVecX + ny * sunVecY;

        // Only faces pointing TOWARDS sum (dot > 0) receive direct light
        if (dot > 0) {
            totalExposure += dot * len;
        }
        totalPerimeter += len;
    }

    if (totalPerimeter === 0) return 0;

    // Normalize exposure 0-1
    // Max possible exposure is when normal aligns perfectly with sun (dot=1)
    // But for a closed 2D shape, max aggregate projection is less < 0.5 perimeter?
    // A flat plate facing sun: exposure = 1*L. Perimeter = 2L. Ratio = 0.5.
    // A circle: integral...
    // Let's normalize by Projected Width? Or just return raw value normalized by Perimeter/2?
    // For visualization 0-1 range:
    const exposureFactor = totalExposure / (totalPerimeter / 2); // Roughly 0-1

    return exposureFactor * Math.sin(sunAltitude);
}


/**
 * Calculate wind exposure based on dominant wind direction
 */
function calculatePolygonWindExposure(
    building: Building,
    windDirectionDeg: number = 45 // Meteorological: FROM this direction (0=N, 90=E)
): number {
    // Ensure consistent winding (CCW)
    const safePoly = turf.rewind(building.geometry as any, { reverse: false });
    const coords = safePoly.geometry.coordinates[0];

    if (!coords || coords.length < 3) return 0;

    // Wind vector (pointing TO source / FROM direction)
    const windRad = windDirectionDeg * (Math.PI / 180);
    const windVecX = Math.sin(windRad);
    const windVecY = Math.cos(windRad);

    let totalExposure = 0;
    let totalPerimeter = 0;

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy);

        // Outward normal (CCW winding): (dy, -dx)
        const nx = dy / len;
        const ny = -dx / len;

        // A windward face has its outward normal pointing INTO the wind.
        // i.e., normal aligned with wind FROM direction (dot > 0 = faces the source)
        const dot = nx * windVecX + ny * windVecY;

        if (dot > 0) {
            totalExposure += dot * len;
        }
        totalPerimeter += len;
    }

    // Normalize: instead of dividing by perimeter/2, just divide by a projected width proxy.
    // dividing by perimeter/4 scales higher so exposure ranges 0.5 - 1.0
    return totalPerimeter > 0 ? (totalExposure / (totalPerimeter / 3)) : 0;
}

/**
 * Get hex color for analysis value
 */
function getColorForValue(
    actualValue: number,
    mode: AnalysisMode,
    regulations: GreenRegulationData[]
): string {
    const thresholds = regulations.length > 0
        ? regulations.map(parseThresholdsFromRegulation).reduce((acc, t) => ({
            sunHoursMin: Math.min(acc.sunHoursMin || Infinity, t.sunHoursMin || Infinity),
            sunHoursTarget: Math.max(acc.sunHoursTarget || 0, t.sunHoursTarget || 0),
            daylightFactorMin: Math.min(acc.daylightFactorMin || Infinity, t.daylightFactorMin || Infinity),
            daylightFactorTarget: Math.max(acc.daylightFactorTarget || 0, t.daylightFactorTarget || 0),
            windSpeedMin: Math.min(acc.windSpeedMin || Infinity, t.windSpeedMin || Infinity),
            windSpeedTarget: Math.max(acc.windSpeedTarget || 0, t.windSpeedTarget || 0),
        }), {} as ParsedThresholds)
        : DEFAULT_THRESHOLDS;

    // Green -> Yellow -> Red scale function
    const getComplianceColor = (val: number, min: number, target: number) => {
        if (val >= target) return '#00cc00'; // Green (Excellent)
        if (val >= min) return '#ffcc00';    // Yellow (Fair/Pass)
        return '#ff0000';                   // Red (Fail)
    };

    if (mode === 'sun-hours') {
        const min = thresholds.sunHoursMin || 2;
        const target = thresholds.sunHoursTarget || 4;
        return getComplianceColor(actualValue, min, target);
    }

    if (mode === 'daylight') {
        // actualValue is raw factor 0-1, convert to % for threshold check if needed, 
        // BUT check if input actualValue is already % or factor.
        // In logic below, we store it as raw number.
        // Thresholds are typically 0.02 (2%).
        const min = thresholds.daylightFactorMin || 0.02;
        const target = thresholds.daylightFactorTarget || 0.04;
        return getComplianceColor(actualValue, min, target);
    }

    if (mode === 'wind') {
        const hasWindThresholds = thresholds.windSpeedMin !== undefined && thresholds.windSpeedMin !== Infinity;
        const isComplianceMode = regulations.length > 0 && hasWindThresholds;

        if (isComplianceMode) {
            // Wind speed checks (Compliance: Green = Good, Red = Bad)
            const min = thresholds.windSpeedMin || 1.0;
            const target = thresholds.windSpeedTarget || 2.0;
            return getComplianceColor(actualValue, min, target);
        } else {
            // Default UI Legend scale: Green(2.0+), Yellow(1.0-2.0), Red(<1.0)
            if (actualValue >= 2.0) return '#10b981'; // Green (Good Ventilation)
            if (actualValue >= 1.0) return '#f59e0b'; // Yellow (Fair/Meets)
            return '#ef4444';                         // Red (Stagnant)
        }
    }

    if (mode === 'energy') {
        if (actualValue > 200) return '#ef4444'; // Red (High EUI)
        if (actualValue > 120) return '#f59e0b'; // Amber (Average)
        return '#3b82f6'; // Blue (Efficient)
    }

    if (mode === 'mobility') {
        if (actualValue > 5000) return '#9333ea'; // Purple
        if (actualValue > 2000) return '#06b6d4'; // Cyan
        return '#3b82f6'; // Blue
    }

    if (mode === 'resilience') {
        if (actualValue < 60) return '#ef4444'; // Red
        if (actualValue < 80) return '#f59e0b'; // Amber
        return '#10b981'; // Green
    }

    return '#cccccc';
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CLIMATE & LOCATION HELPERS
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Estimate ASHRAE climate zone from latitude (simplified) */
function getClimateZone(lat: number): { zone: number; hdd: number; cdd: number; baseWindSpeed: number } {
    const absLat = Math.abs(lat);
    // HDD/CDD in °C·days (simplified annual averages by latitude band)
    if (absLat < 10)  return { zone: 1, hdd: 0,    cdd: 3500, baseWindSpeed: 3.0 }; // Tropical
    if (absLat < 20)  return { zone: 2, hdd: 200,  cdd: 2800, baseWindSpeed: 3.5 }; // Hot-Humid
    if (absLat < 30)  return { zone: 3, hdd: 800,  cdd: 1800, baseWindSpeed: 4.0 }; // Warm (India)
    if (absLat < 40)  return { zone: 4, hdd: 1500, cdd: 1200, baseWindSpeed: 4.5 }; // Mixed
    if (absLat < 50)  return { zone: 5, hdd: 2500, cdd: 600,  baseWindSpeed: 5.0 }; // Cool
    if (absLat < 60)  return { zone: 6, hdd: 3500, cdd: 200,  baseWindSpeed: 5.5 }; // Cold
    return                    { zone: 7, hdd: 5000, cdd: 50,   baseWindSpeed: 6.0 }; // Very Cold
}

/** Estimate Peak Ground Acceleration (PGA) from lat/lng using simplified GSHAP zones */
function getSeismicPGA(lat: number, lng: number): number {
    // Simplified global seismic hazard model (PGA in g)
    // Based on GSHAP (Global Seismic Hazard Assessment Program) zones
    // India-specific + global fallback
    
    // Himalayan Belt (Zone V - Very High): 
    if (lat > 28 && lat < 36 && lng > 72 && lng < 98) return 0.36;
    // Indo-Gangetic Plain (Zone IV - High):
    if (lat > 24 && lat < 32 && lng > 72 && lng < 88) return 0.24;
    // Western India / Gujarat (Zone III-IV):
    if (lat > 20 && lat < 26 && lng > 68 && lng < 76) return 0.24;
    // Deccan Plateau (Zone II-III): 
    if (lat > 10 && lat < 24 && lng > 73 && lng < 85) return 0.16;
    // Southern India (Zone II - Low):
    if (lat > 8 && lat < 15 && lng > 74 && lng < 80)  return 0.10;
    // Pacific Ring of Fire (Japan, Philippines, etc.)
    if (lng > 120 && lng < 150 && lat > 20 && lat < 45) return 0.40;
    // California / US West Coast
    if (lng > -125 && lng < -115 && lat > 30 && lat < 42) return 0.40;
    // Mediterranean (Turkey, Greece, Italy)
    if (lng > 20 && lng < 45 && lat > 35 && lat < 42) return 0.30;
    // Default moderate hazard
    return 0.10;
}

/** Get base EUI (kWh/m²/yr) by building intended use - ASHRAE 90.1 methodology */
function getBaseEUI(intendedUse: string): number {
    switch (intendedUse) {
        case 'Residential': return 120;    // Apartments: 100-140 kWh/m²/yr
        case 'Commercial':  return 200;    // Offices: 150-250
        case 'Office':      return 180;    // Office buildings
        case 'Retail':      return 220;    // Retail/shops
        case 'Hospitality': return 280;    // Hotels: 250-350
        case 'Industrial':  return 300;    // Warehouses/factories
        case 'Mixed-Use':   return 160;    // Average of residential+commercial
        case 'Public':      return 150;    // Schools, libraries
        default:            return 150;
    }
}

/** ITE Trip Generation rates (daily vehicle trips) per 1000 sqm GFA */
function getITETripRate(intendedUse: string): { rate: number; unit: 'per_unit' | 'per_1000sqm' } {
    switch (intendedUse) {
        case 'Residential': return { rate: 6.65, unit: 'per_unit' };     // ITE LU 220: Multifamily
        case 'Commercial':  return { rate: 12.44, unit: 'per_1000sqm' };  // ITE LU 710: Office
        case 'Office':      return { rate: 11.03, unit: 'per_1000sqm' };  // ITE LU 710
        case 'Retail':      return { rate: 41.0, unit: 'per_1000sqm' };   // ITE LU 820: Shopping
        case 'Hospitality': return { rate: 8.17, unit: 'per_1000sqm' };   // ITE LU 310: Hotel
        case 'Mixed-Use':   return { rate: 15.0, unit: 'per_1000sqm' };   // Blended
        case 'Industrial':  return { rate: 3.89, unit: 'per_1000sqm' };   // ITE LU 110
        case 'Public':      return { rate: 20.0, unit: 'per_1000sqm' };   // ITE LU 520: School
        default:            return { rate: 10.0, unit: 'per_1000sqm' };
    }
}

/** Compute building compactness (surface-to-volume ratio) */
function computeCompactness(building: Building): { svRatio: number; perimeterM: number; footprintM2: number; volumeM3: number } {
    const footprintM2 = building.area || turf.area(building.geometry);
    
    // Perimeter in meters
    const perimeterLine = turf.polygonToLine(building.geometry as any);
    const perimeterM = turf.length(perimeterLine as any, { units: 'meters' });
    
    const height = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
    const volumeM3 = footprintM2 * height;
    
    // Surface area = 2 * footprint + perimeter * height (roof + floor + walls)
    const surfaceArea = 2 * footprintM2 + perimeterM * height;
    const svRatio = volumeM3 > 0 ? surfaceArea / volumeM3 : 1;
    
    return { svRatio, perimeterM, footprintM2, volumeM3 };
}

/** Calculate Sky View Factor for a building considering neighboring obstructions.
 *  Casts rays in 16 directions and checks if any neighbor blocks the sky. */
function calculateSkyViewFactor(building: Building, allBuildings: Building[]): number {
    const center = turf.centroid(building.geometry);
    const [cLng, cLat] = center.geometry.coordinates;
    const bHeight = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
    
    const NUM_RAYS = 16;
    const CHECK_DISTANCE_M = 100; // Check obstructions within 100m
    let unobstructedRays = 0;
    
    for (let r = 0; r < NUM_RAYS; r++) {
        const angle = (r / NUM_RAYS) * 2 * Math.PI;
        let isBlocked = false;
        
        for (const other of allBuildings) {
            if (other.id === building.id) continue;
            
            const otherCenter = turf.centroid(other.geometry);
            const dist = turf.distance(center, otherCenter, { units: 'meters' });
            if (dist > CHECK_DISTANCE_M || dist < 1) continue;
            
            // Check if this neighbor is roughly in the ray direction
            const [oLng, oLat] = otherCenter.geometry.coordinates;
            const dx = oLng - cLng;
            const dy = oLat - cLat;
            const neighborAngle = Math.atan2(dx, dy);
            const angleDiff = Math.abs(((neighborAngle - angle + Math.PI) % (2 * Math.PI)) - Math.PI);
            
            if (angleDiff < Math.PI / NUM_RAYS) {
                // Neighbor is in this ray's direction
                const otherHeight = other.height || (other.floors?.reduce((s, f) => s + f.height, 0)) || 10;
                // Elevation angle of the obstruction from our rooftop
                const elevAngle = Math.atan2(otherHeight - bHeight, dist);
                if (elevAngle > 0.05) { // >~3° obstruction = blocks sky
                    isBlocked = true;
                    break;
                }
            }
        }
        
        if (!isBlocked) unobstructedRays++;
    }
    
    return unobstructedRays / NUM_RAYS; // 0-1, 1 = full sky view
}

/** Detect Venturi effect: find narrow gaps between this building and neighbors */
function detectVenturiEffect(building: Building, allBuildings: Building[]): number {
    const center = turf.centroid(building.geometry);
    let maxAmplification = 1.0;
    
    for (const other of allBuildings) {
        if (other.id === building.id) continue;
        const otherCenter = turf.centroid(other.geometry);
        const gap = turf.distance(center, otherCenter, { units: 'meters' });
        
        // Venturi effect in gaps < 2× building width
        const bWidth = Math.sqrt(building.area || 100);
        if (gap > 0 && gap < bWidth * 2 && gap > 3) {
            // Narrower gap = higher speed amplification (up to 2×)
            const gapRatio = gap / (bWidth * 2);
            const amplification = 1 + (1 - gapRatio) * 0.8; // Max 1.8× speed
            maxAmplification = Math.max(maxAmplification, amplification);
        }
    }
    
    return maxAmplification;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MAIN ANALYSIS FUNCTION — Real-time physics-based simulation
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function runVisualAnalysis(
    targetBuildings: Building[],
    contextBuildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = [],
    weatherData?: WeatherData | null
): Promise<Map<string, BuildingAnalysisResult>> {
    console.log('[ANALYSIS ENGINE] Starting runVisualAnalysis', {
        mode,
        targetCount: targetBuildings.length,
        liveWeather: !!weatherData?.isLive
    });

    const results = new Map<string, BuildingAnalysisResult>();

    if (mode === 'none' || targetBuildings.length === 0) {
        return results;
    }

    console.time('Analysis');

    const firstCentroid = turf.centroid(targetBuildings[0].geometry);
    const [lng, lat] = firstCentroid.geometry.coordinates;
    const climate = getClimateZone(lat);

    // ────────────────────────────────────────────────────────────────────
    // SUN HOURS — Radiance/Ladybug methodology
    // Full-day shadow integration using NOAA solar positions
    // For each building we cast shadows at hourly intervals and check
    // which buildings are shaded by their neighbors at each timestep.
    // ────────────────────────────────────────────────────────────────────
    if (mode === 'sun-hours') {
        const hourSamples = 24; // Higher resolution: every 30 min from 5am-7pm
        const baseDate = new Date(date);

        // Precompute all shadow polygons for each hour
        const hourlySnapshots: { shadows: any[]; altitude: number; azimuth: number; hour: number; solarW: number }[] = [];
        for (let i = 0; i < hourSamples; i++) {
            const hour = 5 + (i * 14 / hourSamples); // 5AM to 7PM
            const sampleDate = new Date(baseDate);
            sampleDate.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);

            const pos = getSunPosition(sampleDate, lat, lng);
            if (pos.altitude <= 0) continue;

            const shadows: any[] = [];
            contextBuildings.forEach(b => {
                const s = calculateBuildingShadow(b, pos.azimuth, pos.altitude);
                if (s) shadows.push({ shadow: s, casterId: b.id });
            });

            hourlySnapshots.push({ shadows, altitude: pos.altitude, azimuth: pos.azimuth, hour, solarW: weatherData ? getSolarAtHour(weatherData, Math.floor(hour)).shortwave : -1 });
        }

        for (const building of targetBuildings) {
            const bCenter = turf.centroid(building.geometry);
            let sunHours = 0;

            for (const snap of hourlySnapshots) {
                // Check if building centroid is shaded by any OTHER building's shadow
                const isShadowed = snap.shadows.some(s => 
                    s.casterId !== building.id && turf.booleanPointInPolygon(bCenter, s.shadow)
                );

                if (!isShadowed) {
                    // Also factor in facade exposure (how much of the polygon faces the sun)
                    const exposure = calculatePolygonSolarExposure(building, snap.azimuth, snap.altitude);
                    // Count proportional sun hours weighted by exposure quality
                    const timeStep = 14 / hourSamples; // hours per sample
                    
                    // Weight by real solar radiation if available (clear sky = full weight, cloudy = reduced)
                    let solarWeight = 1.0;
                    if (snap.solarW >= 0) {
                        // API gives real W/m², normalize to 0-1 (clear sky peak ~1000 W/m²)
                        solarWeight = Math.min(1, snap.solarW / 800);
                    }
                    
                    sunHours += timeStep * Math.max(0.3, exposure) * Math.max(0.2, solarWeight);
                }
            }

            // Cap at actual daylight hours for this latitude/season
            sunHours = Math.min(sunHours, 14);

            const color = getColorForValue(sunHours, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: parseFloat(sunHours.toFixed(1)),
                color,
                unit: 'hrs',
                label: `${sunHours.toFixed(1)} hrs direct sun`
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // DAYLIGHT — Radiance/Honeybee methodology
    // Combines Sky View Factor (obstruction check in 16 directions)
    // with instantaneous solar illuminance based on altitude angle.
    // Approximates Daylight Factor (DF) and Spatial Daylight Autonomy.
    // ────────────────────────────────────────────────────────────────────
    else if (mode === 'daylight') {
        const { azimuth, altitude } = getSunPosition(date, lat, lng);
        
        // External illuminance (lux) — CIE clear sky model approximation
        // Use real solar radiation from API if available
        let externalIlluminance: number;
        if (weatherData) {
            const currentHour = date.getHours();
            const solar = getSolarAtHour(weatherData, currentHour);
            // Convert W/m² to lux approximation (1 W/m² ≈ 120 lux for visible light)
            externalIlluminance = Math.max(5000, solar.shortwave * 120);
        } else {
            externalIlluminance = altitude > 0 ? 100000 * Math.sin(altitude) : 10000;
        }

        for (const building of targetBuildings) {
            // Sky View Factor: ratio of unobstructed sky hemisphere
            const svf = calculateSkyViewFactor(building, contextBuildings);
            
            // Facade solar exposure at current time
            const solarExposure = altitude > 0 
                ? calculatePolygonSolarExposure(building, azimuth, altitude) 
                : 0;

            // Daylight Factor (DF) = Ei / Eo
            // Interior illuminance proxy: SVF × transmission × solar contribution
            const windowTransmission = 0.65; // Typical double glazing VLT
            const windowWallRatio = 0.30; // Typical 30% WWR
            
            // DF combines diffuse sky (SVF-dependent) and direct sun (exposure-dependent)
            const diffuseComponent = svf * windowTransmission * windowWallRatio * 0.10; // ~10% of sky light enters
            const directComponent = solarExposure * windowTransmission * windowWallRatio * 0.15;
            const daylightFactor = diffuseComponent + directComponent;

            // Interior illuminance estimate
            const interiorLux = externalIlluminance * daylightFactor;
            // sDA proxy: probability that ≥300 lux is achieved
            const sdaEstimate = Math.min(100, (interiorLux / 300) * 50);

            const color = getColorForValue(daylightFactor, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: parseFloat(daylightFactor.toFixed(4)),
                color,
                unit: 'DF',
                label: `DF: ${(daylightFactor * 100).toFixed(1)}% | ~${Math.round(interiorLux)} lux | sDA: ${sdaEstimate.toFixed(0)}%`
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // WIND / CFD — OpenFOAM-inspired methodology
    // Atmospheric Boundary Layer power law profile for height correction.
    // Polygon-based windward/leeward exposure.
    // Venturi effect detection in narrow gaps between buildings.
    // Lawson pedestrian comfort criteria for ground level.
    // ────────────────────────────────────────────────────────────────────
    else if (mode === 'wind') {
        // Use real wind data from API if available, otherwise fall back to climate zone estimate
        const currentHour = date.getHours();
        const apiWind = weatherData ? getWindAtHour(weatherData, currentHour) : null;
        
        const windDir = apiWind ? apiWind.direction : 45; // Real direction or default NE
        const V_ref = apiWind ? apiWind.speed : climate.baseWindSpeed; // Real m/s at 10m or estimated
        const Z_ref = 10; // Reference height (m)
        const alpha = 0.33; // Power law exponent for urban terrain (ABL)
        
        console.log('[ANALYSIS] Wind params:', {
            source: apiWind ? 'LIVE API' : 'ESTIMATED',
            direction: windDir.toFixed(0) + '°',
            refSpeed: V_ref.toFixed(1) + ' m/s',
        });

        for (const building of targetBuildings) {
            const height = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
            
            // 1. Height-corrected wind speed: V(z) = V_ref × (z/z_ref)^α
            const V_height = V_ref * Math.pow(height / Z_ref, alpha);

            // 2. Facade exposure to wind direction
            const exposure = calculatePolygonWindExposure(building, windDir);

            // 3. Venturi effect amplification from nearby buildings
            const venturiAmp = detectVenturiEffect(building, contextBuildings);

            // 4. Wake/shelter reduction from upwind buildings
            let shelterFactor = 1.0;
            const bCenter = turf.centroid(building.geometry);
            const windRad = windDir * (Math.PI / 180);
                    for (const other of contextBuildings) {
                if (other.id === building.id) continue;
                const otherCenter = turf.centroid(other.geometry);
                const dist = turf.distance(bCenter, otherCenter, { units: 'meters' });
                if (dist > 200 || dist < 1) continue;
                
                // A sheltering building is UPWIND of the target.
                // "Upwind" means it lies in the FROM direction of the wind relative to the target.
                // Wind FROM windDirDeg → vector pointing FROM = (sin(windRad), cos(windRad))
                const [dx, dy] = [
                    otherCenter.geometry.coordinates[0] - bCenter.geometry.coordinates[0],
                    otherCenter.geometry.coordinates[1] - bCenter.geometry.coordinates[1]
                ];
                // bearingToOther uses atan2(x,y) = meteorological bearing (0=N, 90=E)
                const bearingToOther = Math.atan2(dx, dy);
                // Wind FROM direction in radians
                const fromRad = windRad; // windRad = windDir * π/180 (FROM direction)
                let angleDiff = Math.abs(bearingToOther - fromRad);
                // Normalize to [0, π]
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                
                if (angleDiff < Math.PI / 3) { // ±60° cone upwind
                    const otherH = other.height || 10;
                    const wakeLength = otherH * 6; // Wake extends ~6× height downwind
                    if (dist < wakeLength) {
                        // Stronger shelter nearer to the blocker
                        const proximityFactor = 1 - (dist / wakeLength);
                        const heightFactor = Math.min(1, (otherH / Math.max(height, 1)));
                        const reduction = proximityFactor * heightFactor * 0.55; // Up to 55% reduction, leaving 45% wind
                        shelterFactor = Math.min(shelterFactor, 1 - reduction);
                    }
                }
            }

            // Combined wind speed at building
            // Add a base floor to venturi/shelter so it rarely goes perfectly to zero
            const estimatedWindSpeed = V_height * Math.max(0.4, exposure) * Math.max(0.8, venturiAmp) * Math.max(0.3, shelterFactor);
            
            // Lawson comfort level
            let comfort = 'Comfortable';
            if (estimatedWindSpeed > 8) comfort = 'Dangerous';
            else if (estimatedWindSpeed > 5) comfort = 'Uncomfortable';
            else if (estimatedWindSpeed > 3.5) comfort = 'Windy';

            const color = getColorForValue(estimatedWindSpeed, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: parseFloat(estimatedWindSpeed.toFixed(2)),
                color,
                unit: 'm/s',
                label: `${estimatedWindSpeed.toFixed(1)} m/s | ${comfort}`
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // ENERGY — EnergyPlus/OpenStudio methodology (ASHRAE 90.1 baseline)
    // Calculates EUI (kWh/m²/yr) using:
    //   - Base EUI by use type
    //   - Climate zone correction (HDD/CDD)
    //   - Shape factor (surface-to-volume ratio → compactness)
    //   - Solar heat gain via polygon orientation analysis
    //   - Window-to-wall ratio estimation from perimeter
    // ────────────────────────────────────────────────────────────────────
    else if (mode === 'energy') {
        for (const building of targetBuildings) {
            const height = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
            const { svRatio, perimeterM, footprintM2 } = computeCompactness(building);

            // 1. Base EUI by use type
            let eui = getBaseEUI(building.intendedUse || 'Residential');

            // 2. Climate correction: heating + cooling loads
            // Use real temperature data from API if available
            let hdd: number, cdd: number;
            if (weatherData) {
                const degreeDays = calculateDegreeDays(weatherData);
                hdd = degreeDays.hdd;
                cdd = degreeDays.cdd;
            } else {
                hdd = climate.hdd;
                cdd = climate.cdd;
            }
            const heatingFactor = 1 + (hdd - 800) / 5000; // Higher HDD → more heating
            const coolingFactor = 1 + (cdd - 1800) / 5000; // Higher CDD → more cooling
            eui *= (0.4 * heatingFactor + 0.6 * coolingFactor); // Cooling-dominated weight

            // 3. Shape factor: compact buildings are more efficient
            // Ideal S/V for a cube ≈ 0.6/m. Higher = less efficient.
            const compactnessPenalty = Math.max(0.8, Math.min(1.4, svRatio / 0.3));
            eui *= compactnessPenalty;

            // 4. Solar heat gain through building orientation
            // Calculate south-facing perimeter fraction (beneficial in heating zones, penalty in cooling)
            const { azimuth, altitude } = getSunPosition(date, lat, lng);
            if (altitude > 0) {
                const solarExposure = calculatePolygonSolarExposure(building, azimuth, altitude);
                // In hot climates, high solar exposure increases cooling load
                // In cool climates, it reduces heating load
                if (climate.cdd > climate.hdd || (weatherData && calculateDegreeDays(weatherData).cdd > calculateDegreeDays(weatherData).hdd)) {
                    eui *= (1 + solarExposure * 0.15); // Up to 15% penalty in hot climate
                } else {
                    eui *= (1 - solarExposure * 0.10); // Up to 10% benefit in cold climate
                }
            }

            // 5. Height factor: taller buildings need more energy for pumping/lifts
            if (height > 30) eui *= 1.05;
            if (height > 60) eui *= 1.10;

            eui = parseFloat(eui.toFixed(1));

            const color = getColorForValue(eui, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: eui,
                color,
                unit: 'kWh/m²/yr',
                label: `EUI: ${eui} kWh/m²/yr`
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // MOBILITY — SUMO/MATSim methodology (ITE Trip Generation)
    // Uses ITE Trip Generation Manual rates to compute daily vehicle
    // trips based on building use type and gross floor area.
    // ────────────────────────────────────────────────────────────────────
    else if (mode === 'mobility') {
        for (const building of targetBuildings) {
            const height = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
            const gfa = building.area * building.numFloors; // Gross Floor Area in m²
            const { rate, unit: rateUnit } = getITETripRate(building.intendedUse || 'Residential');

            let dailyTrips: number;
            if (rateUnit === 'per_unit') {
                // Estimate number of units from GFA (avg 100m² per unit)
                const avgUnitSize = 100; // m²
                const estimatedUnits = Math.max(1, Math.floor(gfa / avgUnitSize));
                dailyTrips = estimatedUnits * rate;
            } else {
                // Rate is per 1000 sqm of GFA
                dailyTrips = (gfa / 1000) * rate;
            }

            // Adjust for transit proximity (if lat/lng suggests urban area, reduce by 20%)
            // Simple proxy: higher density areas (more buildings nearby) = better transit
            const nearbyCount = contextBuildings.filter(b => {
                if (b.id === building.id) return false;
                const dist = turf.distance(
                    turf.centroid(building.geometry),
                    turf.centroid(b.geometry),
                    { units: 'meters' }
                );
                return dist < 500;
            }).length;
            const transitReduction = Math.max(0.6, 1 - nearbyCount * 0.05); // Up to 40% reduction
            dailyTrips *= transitReduction;

            dailyTrips = Math.round(dailyTrips);

            const color = getColorForValue(dailyTrips, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: dailyTrips,
                color,
                unit: 'trips/day',
                label: `${dailyTrips} trips/day (${building.intendedUse || 'Mixed'})`
            });
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // RESILIENCE — OpenQuake methodology
    // Combines location-based seismic hazard (PGA from GSHAP zones)
    // with building vulnerability (fragility index from structural
    // properties). Outputs a 0-100 resilience score.
    // ────────────────────────────────────────────────────────────────────
    else if (mode === 'resilience') {
        const pga = getSeismicPGA(lat, lng);
        // Normalize PGA to 0-1 hazard index (0.4g = max considered)
        const hazardIndex = Math.min(1, pga / 0.40);

        for (const building of targetBuildings) {
            const height = building.height || (building.floors?.reduce((s, f) => s + f.height, 0)) || 10;
            const numFloors = building.numFloors || building.floors?.length || 1;
            const { svRatio, footprintM2 } = computeCompactness(building);

            // Building Fragility Index (0-1, higher = more fragile)
            let fragility = 0;

            // a) Height vulnerability: taller = more vulnerable
            // IS 1893 (Indian seismic code) considers buildings >15m as special
            fragility += Math.min(0.3, height / 200); // Max 0.3 contribution

            // b) Aspect ratio: slender buildings are more vulnerable
            const footprintWidth = Math.sqrt(footprintM2);
            const aspectRatio = height / Math.max(footprintWidth, 1);
            fragility += Math.min(0.25, aspectRatio / 20); // Max 0.25

            // c) Soft story risk: buildings with 4+ floors and ground-floor commercial
            if (numFloors >= 4) {
                const groundFloor = building.floors?.[0];
                if (groundFloor?.intendedUse === 'Commercial' || groundFloor?.intendedUse === 'Retail') {
                    fragility += 0.15; // Soft story penalty
                }
            }

            // d) Plan irregularity (from S/V ratio — irregular plans are worse)
            if (svRatio > 0.5) fragility += 0.10;

            // e) Soil amplification
            if (building.soilData?.bd) {
                // Low bulk density soil amplifies seismic waves
                if (building.soilData.bd < 1.3) fragility += 0.10; // Loose soil
                else if (building.soilData.bd < 1.5) fragility += 0.05; // Medium
            }

            fragility = Math.min(1, fragility);

            // Risk = Hazard × Vulnerability
            const risk = hazardIndex * fragility;

            // Resilience Score = 100 - risk×100
            let score = Math.round(100 * (1 - risk));
            score = Math.max(0, Math.min(100, score));

            const color = getColorForValue(score, mode, greenRegulations);
            
            // Seismic Zone label
            let zoneLabel = 'Low';
            if (pga >= 0.36) zoneLabel = 'Zone V (Very High)';
            else if (pga >= 0.24) zoneLabel = 'Zone IV (High)';
            else if (pga >= 0.16) zoneLabel = 'Zone III (Moderate)';
            else if (pga >= 0.10) zoneLabel = 'Zone II (Low)';

            results.set(building.id, {
                buildingId: building.id,
                value: score,
                color,
                unit: '/100',
                label: `Score: ${score}/100 | PGA: ${pga}g | ${zoneLabel}`
            });
        }
    }

    console.timeEnd('Analysis');
    console.log('[ANALYSIS ENGINE] Complete, processed', results.size, 'buildings');

    return results;
}

// --- GROUND ANALYSIS & SHADOWS ---

/**
 * Calculate the shadow polygon for a building at a given sun position
 * Shadow is the union of the base polygon and the projected top polygon (extrusion shadow)
 */
export function calculateBuildingShadow(
    building: Building,
    azimuth: number,
    altitude: number
): any { // Returns turf.Feature<turf.Polygon> | null
    if (altitude <= 0) return null; // Sun is below horizon

    const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;

    // Shadow length = h / tan(altitude)
    const tanAlt = Math.tan(altitude);
    // Cap shadow length to avoid infinite/huge shadows at sunset
    const shadowLen = tanAlt > 0.1 ? height / tanAlt : height * 20;

    // Sun/Wind Azimuth convention: 0 = North, PI/2 = East
    // Vector TO Sun/Source: x = sin(az), y = cos(az)
    // Shadow is FROM building: vector = -sourceVec
    const sunVecX = Math.sin(azimuth);
    const sunVecY = Math.cos(azimuth);

    const shadowX = -sunVecX * shadowLen;
    const shadowY = -sunVecY * shadowLen;

    // Project the building base polygon
    const basePoly = building.geometry;
    if (!basePoly || !basePoly.geometry) return null;

    // Handle MultiPolygon (simplified: take first polygon)
    // Ensure consistent winding
    const safePoly = turf.rewind(basePoly as any, { reverse: false });
    const coords = (safePoly.geometry.type === 'Polygon')
        ? safePoly.geometry.coordinates[0]
        : (safePoly.geometry as any).coordinates[0][0];

    // Shift coords to get the projected top
    // Approximate meters to degrees conversion
    // 1 deg Lat ~= 111320m
    const centroid = turf.centroid(basePoly);
    const lat = centroid.geometry.coordinates[1];
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);

    const shiftLng = shadowX / metersPerDegLng;
    const shiftLat = shadowY / metersPerDegLat;

    const shiftedCoords = coords.map((c: any) => [c[0] + shiftLng, c[1] + shiftLat]);

    // Create a collection of points from base and projected top
    // Computing convex hull of these points gives the shadow volume footprint
    // (This ignores the 'hole' if the building is hollow, but acceptable for shadow casting)
    const allPoints = [...coords, ...shiftedCoords].map(c => turf.point(c));
    const collection = turf.featureCollection(allPoints);

    return turf.convex(collection);
}

/**
 * Run analysis on the ground (plot) to generate a heatmap
 */
export async function runGroundAnalysis(
    plotGeometry: any,
    buildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = [],
    weatherData?: WeatherData | null
): Promise<any> { // Returns FeatureCollection

    if (mode === 'none' || !plotGeometry) return turf.featureCollection([]);

    console.time('GroundAnalysis');

    // 1. Generate Grid Points
    const bbox = turf.bbox(plotGeometry);
    const area = turf.area(plotGeometry); // sq meters

    // Target ~400-900 points. sqrt(area/500) = spacing in meters
    // Example: 10000sqm -> 100x100 -> spacing ~4m -> 625 points
    let cellSideKm = Math.max(0.002, Math.sqrt(area / 600) / 1000); // Minimum 2m spacing

    // console.log('[GroundAnalysis] Grid config', { area, cellSideKm });

    const grid = turf.pointGrid(bbox, cellSideKm, { units: 'kilometers', mask: plotGeometry });
    const points = grid.features;

    console.log(`[GroundAnalysis] Generated ${points.length} points for heatmap (spacing: ${(cellSideKm * 1000).toFixed(1)}m)`);

    const results: any[] = [];

    // 2. Calculate Analysis
    const center = turf.centroid(plotGeometry);
    const [lng, lat] = center.geometry.coordinates;

    if (mode === 'sun-hours') {
        const sampleCount = 24; // Higher resolution: every 35 min from 5am-7pm
        const hourStep = 14 / sampleCount;

        // Pre-calculate sun and shadows for each hour to avoid re-calc per point
        const hourlyData: any[] = [];
        const baseDate = new Date(date);

        for (let i = 0; i < sampleCount; i++) {
            const hour = 5 + i * hourStep; // 5AM to 7PM
            const sampleDate = new Date(baseDate);
            sampleDate.setHours(hour, 0, 0, 0);

            const { azimuth, altitude } = getSunPosition(sampleDate, lat, lng);

            if (altitude <= 0) {
                hourlyData.push(null);
                continue;
            }

            // Generate shadows for all buildings at this hour
            const shadows: any[] = [];
            buildings.forEach(b => {
                const s = calculateBuildingShadow(b, azimuth, altitude);
                if (s) shadows.push(s);
            });

            hourlyData.push({ shadows, altitude });
        }

        // Evaluate points
        points.forEach((pt: any) => {
            let exposureCount = 0;

            for (let i = 0; i < sampleCount; i++) {
                const data = hourlyData[i];
                if (!data) continue;

                // Check if point is inside any shadow
                // Optimization: check bounding box first? Turf might do it.
                const isInShadow = data.shadows.some((shadow: any) => turf.booleanPointInPolygon(pt, shadow));

                if (!isInShadow) {
                    exposureCount++;
                }
            }

            const sunHours = (exposureCount / sampleCount) * 14; // 14-hour window

            // Normalize for Heatmap Weight (0-1)
            // Expect max ~12h. 
            const weight = Math.min(sunHours / 10, 1);

            pt.properties = {
                value: sunHours,
                weight: weight
            };
            results.push(pt);
        });

    } else if (mode === 'daylight') {
        // Simple Snapshot at current time
        const { azimuth, altitude } = getSunPosition(date, lat, lng);

        let shadows: any[] = [];
        if (altitude > 0) {
            buildings.forEach(b => {
                const s = calculateBuildingShadow(b, azimuth, altitude);
                if (s) shadows.push(s);
            });
        }

        points.forEach((pt: any) => {
            let exposed = 0;
            if (altitude > 0) {
                const isInShadow = shadows.some((shadow: any) => turf.booleanPointInPolygon(pt, shadow));
                if (!isInShadow) exposed = 1;
            }
            // Simple daylight factor proxy: Sunlight Intensity
            // Factor in Angle of Incidence? sunAltitude.
            const val = exposed * Math.sin(altitude);

            pt.properties = {
                value: val,
                weight: val // 0-1
            };
            results.push(pt);
        });

    } else if (mode === 'wind') {
        // Use real wind data from API if available
        const currentHour = date.getHours();
        const apiWind = weatherData ? getWindAtHour(weatherData, currentHour) : null;
        const windDirDeg = apiWind ? apiWind.direction : 45; // Real direction or default NE
        const refWindSpeed = apiWind ? apiWind.speed : 3.5; // Real m/s or default
        const windRad = windDirDeg * (Math.PI / 180);

        // Wake zone simulation using shadow casting at low angle
        const wakeAngle = Math.atan(0.2); // ~11 deg altitude eq. → wake length ~5x building height

        // Wind is blowing FROM windDirDeg. We cast a "shadow" AWAY from the wind source.
        // So we pass windRad directly as the "sun" position to cast a downwind wake.
        const wakes: any[] = [];
        buildings.forEach(b => {
            const s = calculateBuildingShadow(b, windRad, wakeAngle);
            if (s) wakes.push(s);
        });

        points.forEach((pt: any) => {
            // Check if point is in wake (wind shadow)
            const isInWake = wakes.some((wake: any) => turf.booleanPointInPolygon(pt, wake));

            // Scale value by real wind speed (or default)
            // In wake = sheltered (20% of ref speed). In open = full speed.
            const speedFraction = isInWake ? 0.2 : 1.0;
            const val = speedFraction * (refWindSpeed / 5.0); // Normalize to 0-1 range (5 m/s = 1.0)

            const angle = windDirDeg;

            pt.properties = {
                value: Math.min(1, val),
                weight: Math.min(1, val),
                angle: angle
            };
            results.push(pt);
        });
    }

    // --- ENERGY GROUND HEATMAP: Solar heat gain/loss zones ---
    else if (mode === 'energy') {
        const { azimuth, altitude } = getSunPosition(date, lat, lng);
        const climate = getClimateZone(lat);
        const isHotClimate = climate.cdd > climate.hdd;

        let shadows: any[] = [];
        if (altitude > 0) {
            buildings.forEach(b => {
                const s = calculateBuildingShadow(b, azimuth, altitude);
                if (s) shadows.push(s);
            });
        }

        points.forEach((pt: any) => {
            // Distance to nearest building (heat source proxy)
            let minDist = Infinity;
            buildings.forEach(b => {
                const d = turf.distance(pt, turf.centroid(b.geometry), { units: 'meters' });
                if (d < minDist) minDist = d;
            });

            const isShaded = altitude > 0 ? shadows.some((s: any) => turf.booleanPointInPolygon(pt, s)) : false;
            
            // In hot climates: shaded = good (lower cooling), exposed = bad (higher load)
            // In cold climates: shaded = bad (higher heating), exposed = good (solar gain)
            let heatIndex: number;
            if (isHotClimate) {
                heatIndex = isShaded ? 0.3 : 0.8; // Shaded areas = less heat
            } else {
                heatIndex = isShaded ? 0.7 : 0.3; // Shaded = colder = more heating needed
            }

            // Proximity to buildings increases heat (urban heat island effect)
            if (minDist < 20) heatIndex += 0.15;
            else if (minDist < 50) heatIndex += 0.05;
            heatIndex = Math.min(1, heatIndex);

            pt.properties = { value: heatIndex, weight: heatIndex };
            results.push(pt);
        });
    }

    // --- MOBILITY GROUND HEATMAP: Traffic density ---
    else if (mode === 'mobility') {
        // Compute trip generation per building first
        const buildingTrips: { center: any; trips: number }[] = [];
        buildings.forEach(b => {
            const gfa = b.area * b.numFloors;
            const { rate, unit: rateUnit } = getITETripRate(b.intendedUse || 'Residential');
            let trips = rateUnit === 'per_unit'
                ? Math.max(1, Math.floor(gfa / 100)) * rate
                : (gfa / 1000) * rate;
            buildingTrips.push({ center: turf.centroid(b.geometry), trips });
        });

        const maxTrips = Math.max(...buildingTrips.map(bt => bt.trips), 1);

        points.forEach((pt: any) => {
            // Sum weighted trip density from all buildings (inverse-distance weighted)
            let density = 0;
            buildingTrips.forEach(bt => {
                const dist = turf.distance(pt, bt.center, { units: 'meters' });
                if (dist < 1) dist === 1;
                const influence = bt.trips / Math.max(dist, 5); // Avoid division by zero
                density += influence;
            });

            // Normalize to 0-1
            const normalizedDensity = Math.min(1, density / (maxTrips / 10));

            pt.properties = { value: normalizedDensity, weight: normalizedDensity };
            results.push(pt);
        });
    }

    // --- RESILIENCE GROUND HEATMAP: Collapse risk zones ---
    else if (mode === 'resilience') {
        const pga = getSeismicPGA(lat, lng);
        const hazardBase = Math.min(1, pga / 0.40);

        points.forEach((pt: any) => {
            // Risk increases near tall buildings (collapse zone) and in open areas (liquefaction)
            let riskWeight = hazardBase * 0.5; // Base risk from seismic zone

            buildings.forEach(b => {
                const dist = turf.distance(pt, turf.centroid(b.geometry), { units: 'meters' });
                const bHeight = b.height || 10;
                const collapseRadius = bHeight * 1.5; // Building can topple ~1.5× its height

                if (dist < collapseRadius) {
                    // Inside collapse zone: higher risk
                    const proximity = 1 - (dist / collapseRadius);
                    riskWeight += proximity * 0.4;
                }
            });

            riskWeight = Math.min(1, riskWeight);

            pt.properties = { value: riskWeight, weight: riskWeight };
            results.push(pt);
        });
    }

    console.timeEnd('GroundAnalysis');
    return turf.featureCollection(results);
}

/**
 * Run per-face analysis to generate colored wall segments
 * This decomposes building polygons into individual edge extrusions
 */
export async function runWallAnalysis(
    targetBuildings: Building[],
    contextBuildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = [],
    weatherData?: WeatherData | null
): Promise<any> { // Returns FeatureCollection
    console.log('[ANALYSIS ENGINE] Starting runWallAnalysis', { mode });
    console.time('WallAnalysis');

    if (mode === 'none' || targetBuildings.length === 0) {
        console.timeEnd('WallAnalysis');
        return turf.featureCollection([]);
    }

    const walls: any[] = [];

    // Helper to get color
    const getColor = (val: number) => getColorForValue(val, mode, greenRegulations);

    // Pre-calc sun position if needed
    let sunVecX = 0, sunVecY = 0, sunAlt = 0;
    let hourlySunData: { vecX: number, vecY: number, alt: number }[] = [];

    const firstCentroid = targetBuildings.length > 0 ? turf.centroid(targetBuildings[0].geometry) : null;
    const [lng, lat] = firstCentroid ? firstCentroid.geometry.coordinates : [0, 0];

    if (mode === 'sun-hours') {
        const hourSamples = 24; // Match building analysis resolution
        const baseDate = new Date(date);
        for (let i = 0; i < hourSamples; i++) {
            const hour = 5 + (i * 14 / hourSamples); // 5AM to 7PM
            const sampleDate = new Date(baseDate);
            sampleDate.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
            const { azimuth, altitude } = getSunPosition(sampleDate, lat, lng);
            if (altitude > 0) {
                hourlySunData.push({
                    vecX: Math.sin(azimuth),
                    vecY: Math.cos(azimuth),
                    alt: altitude
                });
            }
        }
    } else if (mode === 'daylight') {
        const { azimuth, altitude } = getSunPosition(date, lat, lng);
        sunVecX = Math.sin(azimuth);
        sunVecY = Math.cos(azimuth);
        sunAlt = altitude;
    } else if (mode === 'wind') {
        const currentHour = date.getHours();
        const apiWind = weatherData ? getWindAtHour(weatherData, currentHour) : null;
        const windDirDeg = apiWind ? apiWind.direction : 45; // Real direction or default NE
        const windRad = windDirDeg * (Math.PI / 180);
        // Wind Vector (pointing TO source): x = sin, y = cos
        sunVecX = Math.sin(windRad);
        sunVecY = Math.cos(windRad);
        sunAlt = 1; // Dummy
    }

    // Wall thickness in meters - use very small value for thin wall overlay
    // turf.buffer uses kilometers when units='kilometers'
    // 0.5 meters = 0.0005 km
    const BUFFER_AMT = 0.0005; // 0.5 meters

    // PARSE THRESHOLDS LOGGING
    const activeThresholds = greenRegulations.length > 0
        ? greenRegulations.map(parseThresholdsFromRegulation).reduce((acc, t) => ({
            sunHoursMin: Math.min(acc.sunHoursMin || Infinity, t.sunHoursMin || Infinity),
            sunHoursTarget: Math.max(acc.sunHoursTarget || 0, t.sunHoursTarget || 0),
            daylightFactorMin: Math.min(acc.daylightFactorMin || Infinity, t.daylightFactorMin || Infinity),
            daylightFactorTarget: Math.max(acc.daylightFactorTarget || 0, t.daylightFactorTarget || 0),
        }), {} as ParsedThresholds)
        : DEFAULT_THRESHOLDS;

    console.log(`[ANALYSIS ENGINE] Thresholds used for ${mode}:`, activeThresholds);
    if (mode === 'sun-hours') {
        console.log('[ANALYSIS ENGINE] Hourly Sun Data Points:', hourlySunData.length);
    }


    for (const building of targetBuildings) {
        // Ensure consistent winding (CCW) for correct Normal calculation
        const safePoly = turf.rewind(building.geometry as any, { reverse: false });
        const coords = safePoly.geometry.coordinates[0];

        if (!coords || coords.length < 3) continue;

        const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;
        const baseHeight = building.baseHeight || 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];

            // 1. Calculate Normal
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            // Normal (Outward CCW): (dy, -dx)
            const nx = dy / len;
            const ny = -dx / len;

            let value = 0;

            // 2. Calculate Exposure based on Mode
            if (mode === 'sun-hours') {
                let directHours = 0;
                let totalWeight = 0;
                // Integrate over day
                for (const sun of hourlySunData) {
                    // Dot product
                    const dot = nx * sun.vecX + ny * sun.vecY;
                    if (dot > 0) {
                        // Face sees sun. 
                        // Shadows? Raycasting is expensive for every wall.
                        // For now, assume "self-shadowing" is covered by dot product.
                        // Context shadowing is too heavy for visual analysis of 1000s of walls in real-time without GPU.
                        directHours += 1; // Simple hour count if facing sun
                    }
                    totalWeight++;
                }
                // Normalize to 12h day
                if (totalWeight > 0) {
                    value = (directHours / totalWeight) * 12;
                }
            } else if (mode === 'daylight') {
                // Instantaneous
                const dot = nx * sunVecX + ny * sunVecY;
                const facingFactor = Math.max(0, dot);
                // Light on vertical surface includes direct (cos) and diffuse (sin)
                const direct = sunAlt > 0 ? facingFactor * Math.cos(sunAlt) : 0;
                const diffuse = sunAlt > 0 ? 0.5 * Math.sin(sunAlt) : 0; // Even shaded walls get diffuse
                value = (direct + diffuse) * 0.04; // Baseline DF ~ 0-4%
            } else if (mode === 'wind') {
                // Wind: dot of face-normal against wind FROM direction
                const currentHour = date.getHours();
                const apiWind = weatherData ? getWindAtHour(weatherData, currentHour) : null;
                const windDirDeg = apiWind?.direction ?? 45;
                const apiWindSpeed = apiWind?.speed ?? getClimateZone(lat).baseWindSpeed;
                
                // direction wind is originating FROM
                const windRad = windDirDeg * (Math.PI / 180);
                const windVecX = Math.sin(windRad);
                const windVecY = Math.cos(windRad);

                // dot > 0 = face is windward (outward normal points toward wind source)
                const dot = nx * windVecX + ny * windVecY;
                const exposure = Math.max(0, dot);

                // ABL power law: V(z) = V_ref × (z/z_ref)^α
                const V_height = apiWindSpeed * Math.pow(Math.max(height, 1) / 10, 0.33);
                value = exposure * V_height;
            } else if (mode === 'energy') {
                // Wall energy loss: based on surface orientation vs sun
                const { azimuth: sunAz, altitude: sunAltitude } = getSunPosition(date, lat, lng);
                const sVecX = Math.sin(sunAz);
                const sVecY = Math.cos(sunAz);
                const dot = nx * sVecX + ny * sVecY;
                
                // Direct solar irradiation on a vertical wall scales with cos(altitude)
                // (Unlike a roof which scales with sin(altitude))
                const directSolar = Math.max(0, dot) * (sunAltitude > 0 ? Math.cos(sunAltitude) : 0);
                
                // EUI contribution per face: more solar gain = more cooling need in hot, less heating in cold
                const climate = getClimateZone(lat);
                if (climate.cdd > climate.hdd) {
                    value = 100 + directSolar * 180; // Hot climate: sun adds up to 180 EUI, shade is 100 (cooler, greener)
                } else {
                    value = 250 - directSolar * 100; // Cold climate: sun drops EUI acting as heating benefit
                }
            } else if (mode === 'mobility') {
                // All walls get uniform trip density (building-level metric, not per-face)
                const gfa = (building.area || 100) * (building.numFloors || 1);
                const { rate, unit: rateUnit } = getITETripRate(building.intendedUse || 'Residential');
                const trips = rateUnit === 'per_unit'
                    ? Math.max(1, Math.floor(gfa / 100)) * rate
                    : (gfa / 1000) * rate;
                value = trips;
            } else if (mode === 'resilience') {
                // Per-face vulnerability: walls with large unsupported span are weaker
                const edgeLenM = len * 111320 * Math.cos(lat * Math.PI / 180); // Approx
                const aspectPenalty = height / Math.max(edgeLenM, 1);
                const pga = getSeismicPGA(lat, lng);
                value = Math.max(0, Math.min(100, 100 - (pga * 100 * aspectPenalty)));
            }

            // 3. Create Wall Geometry (Thin Offset "Skin")
            // Create a very thin (5cm) polygon offset slightly OUTWARD (10cm) from the face
            // This prevents z-fighting and ensures it doesn't look like a thick block

            const thicknessMeters = 0.05; // 5cm thin skin
            const offsetMeters = 0.10;    // 10cm offset outward

            // Convert to degrees (approximate)
            const metersPerDegLat = 111320;
            const wallLat = firstCentroid ? firstCentroid.geometry.coordinates[1] : 0;
            const metersPerDegLng = 111320 * Math.cos(wallLat * Math.PI / 180);

            // Shift points outward by the normal
            const shiftLng = (offsetMeters / metersPerDegLng);
            const shiftLat = (offsetMeters / metersPerDegLat);

            const thicknessLng = (thicknessMeters / 2) / metersPerDegLng;
            const thicknessLat = (thicknessMeters / 2) / metersPerDegLat;

            // p1, p2 are edge endpoints
            // Shift them outward by 'offsetMeters'
            const p1_mid = [p1[0] + nx * shiftLng, p1[1] + ny * shiftLat];
            const p2_mid = [p2[0] + nx * shiftLng, p2[1] + ny * shiftLat];

            // Create 4 corners around the shifted edge
            const p1_outer = [p1_mid[0] + nx * thicknessLng, p1_mid[1] + ny * thicknessLat];
            const p2_outer = [p2_mid[0] + nx * thicknessLng, p2_mid[1] + ny * thicknessLat];
            const p1_inner = [p1_mid[0] - nx * thicknessLng, p1_mid[1] - ny * thicknessLat];
            const p2_inner = [p2_mid[0] - nx * thicknessLng, p2_mid[1] - ny * thicknessLat];

            // Create polygon
            const wallCoords = [
                p1_inner,
                p2_inner,
                p2_outer,
                p1_outer,
                p1_inner
            ];

            const wallPoly = turf.polygon([wallCoords]);

            if (wallPoly) {
                walls.push({
                    type: 'Feature',
                    geometry: wallPoly.geometry,
                    properties: {
                        color: getColor(value),
                        height: height,
                        base_height: baseHeight,
                        value: value,
                        wallId: `${building.id}-wall-${i}`
                    }
                });
            }
        }
    }

    console.timeEnd('WallAnalysis');
    return turf.featureCollection(walls);
}
