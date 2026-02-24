import * as turf from '@turf/turf';
import type { Building } from '@/lib/types';

/**
 * Simple Perlin-like noise generator for wind turbulence
 */
class SimplexNoise {
    private perm: number[];

    constructor(seed: number = Math.random()) {
        this.perm = [];
        for (let i = 0; i < 256; i++) {
            this.perm[i] = i;
        }
        // Shuffle based on seed
        for (let i = 255; i > 0; i--) {
            const j = Math.floor((seed * (i + 1)) % (i + 1));
            [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
        }
        // Duplicate for wrapping
        for (let i = 0; i < 256; i++) {
            this.perm[256 + i] = this.perm[i];
        }
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const a = this.perm[X] + Y;
        const b = this.perm[X + 1] + Y;

        return this.lerp(v,
            this.lerp(u, this.grad(this.perm[a], x, y), this.grad(this.perm[b], x - 1, y)),
            this.lerp(u, this.grad(this.perm[a + 1], x, y - 1), this.grad(this.perm[b + 1], x - 1, y - 1))
        );
    }
}

export interface WindVector {
    vx: number;  // X component of velocity
    vy: number;  // Y component of velocity
    speed: number; // Magnitude
}

export interface WindFieldOptions {
    windDirection: number; // Degrees (0 = North, 90 = East)
    baseSpeed: number;     // Base wind speed in m/s
    turbulenceScale: number; // Scale of turbulence (0-1)
    wakeLength: number;    // Wake length multiplier (building height * this)
}

/**
 * Wind field generator with building wake effects
 */
export class WindField {
    private options: WindFieldOptions;
    private buildings: Building[];
    private noise: SimplexNoise;
    private wakeCells: Map<string, { vx: number, vy: number, strength: number }>;

    constructor(buildings: Building[], options: Partial<WindFieldOptions> = {}) {
        this.buildings = buildings;
        this.options = {
            windDirection: options.windDirection ?? 45, // Default NE
            baseSpeed: options.baseSpeed ?? 3.5,
            turbulenceScale: options.turbulenceScale ?? 0.3,
            wakeLength: options.wakeLength ?? 5.0
        };
        this.noise = new SimplexNoise(Math.random());
        this.wakeCells = new Map();

        this.calculateWakeZones();
    }

    /**
     * Pre-calculate wake zones behind buildings
     */
    private calculateWakeZones(): void {
        // Wind blows FROM windDirection, so the flow (and wake) is opposite
        const flowRad = (this.options.windDirection + 180) * (Math.PI / 180);
        const windVecX = Math.sin(flowRad);
        const windVecY = Math.cos(flowRad);

        for (const building of this.buildings) {
            const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;
            const centroid = turf.centroid(building.geometry);
            const [cx, cy] = centroid.geometry.coordinates;

            // Wake extends downwind from building
            const wakeLength = height * this.options.wakeLength;

            // Convert to approximate meters
            const metersPerDegLat = 111320;
            const metersPerDegLng = 111320 * Math.cos(cy * Math.PI / 180);

            const wakeLengthLng = (wakeLength * windVecX) / metersPerDegLng;
            const wakeLengthLat = (wakeLength * windVecY) / metersPerDegLat;

            // Sample wake zone at multiple points
            const wakeSamples = 10;
            for (let i = 1; i <= wakeSamples; i++) {
                const t = i / wakeSamples;
                const wakeX = cx + wakeLengthLng * t;
                const wakeY = cy + wakeLengthLat * t;

                // Wake strength decreases with distance
                const strength = Math.exp(-2 * t); // Exponential decay

                // Wake creates turbulence (perpendicular component)
                const turbVecX = -windVecY * 0.3 * strength;
                const turbVecY = windVecX * 0.3 * strength;

                const cellKey = `${Math.floor(wakeX * 10000)},${Math.floor(wakeY * 10000)}`;

                // Accumulate wake effects
                const existing = this.wakeCells.get(cellKey);
                if (existing) {
                    existing.vx += turbVecX;
                    existing.vy += turbVecY;
                    existing.strength = Math.max(existing.strength, strength);
                } else {
                    this.wakeCells.set(cellKey, { vx: turbVecX, vy: turbVecY, strength });
                }
            }
        }
    }

    /**
     * Get wind vector at a specific location (lng, lat)
     */
    getVectorAt(lng: number, lat: number): WindVector {
        // Wind blows FROM windDirection, so flow vector is opposite
        const flowRad = (this.options.windDirection + 180) * (Math.PI / 180);

        // Base wind vector
        let vx = Math.sin(flowRad) * this.options.baseSpeed;
        let vy = Math.cos(flowRad) * this.options.baseSpeed;

        // Add turbulence using noise
        const noiseScale = 0.5; // Frequency of turbulence
        const noiseVal = this.noise.noise(lng * noiseScale * 1000, lat * noiseScale * 1000);
        const turbulence = noiseVal * this.options.turbulenceScale * this.options.baseSpeed;

        // Apply turbulence perpendicular to wind direction
        vx += -Math.cos(flowRad) * turbulence;
        vy += Math.sin(flowRad) * turbulence;

        // Check for wake effects
        const cellKey = `${Math.floor(lng * 10000)},${Math.floor(lat * 10000)}`;
        const wake = this.wakeCells.get(cellKey);

        if (wake) {
            // Reduce base wind speed in wake
            const reduction = wake.strength * 0.7;
            vx = vx * (1 - reduction) + wake.vx * this.options.baseSpeed;
            vy = vy * (1 - reduction) + wake.vy * this.options.baseSpeed;
        }

        const speed = Math.sqrt(vx * vx + vy * vy);

        return { vx, vy, speed };
    }

    /**
     * Update wind direction (for future dynamic wind)
     */
    updateDirection(newDirection: number): void {
        this.options.windDirection = newDirection;
        this.wakeCells.clear();
        this.calculateWakeZones();
    }
}
