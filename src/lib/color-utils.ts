
import { BuildingIntendedUse } from './types';

// Helper to convert HSL to hex color string
export const hslToRgb = (h: number, s: number, l: number): string => {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const r = Math.round(255 * f(0));
    const g = Math.round(255 * f(8));
    const b = Math.round(255 * f(4));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

// Material palettes for different building types
export const BUILDING_MATERIALS = {
    [BuildingIntendedUse.Residential]: {
        baseHue: 30, // Warm beige/tan
        saturation: 40, // Increased saturation
        baseLightness: 70,
    },
    [BuildingIntendedUse.Commercial]: {
        baseHue: 220, // Distinct Blue
        saturation: 60, // Vibrant
        baseLightness: 60,
    },
    [BuildingIntendedUse.Retail]: {
        baseHue: 340, // Pink/Red/Magenta shade to distinguish from others
        saturation: 70, // Vibrant and inviting
        baseLightness: 60,
    },
    [BuildingIntendedUse.Office]: {
        baseHue: 200, // Light Cyan/Blue, distinct from bright blue Commercial
        saturation: 50,
        baseLightness: 75,
    },
    [BuildingIntendedUse.MixedUse]: {
        baseHue: 280, // Purple/Mixed
        saturation: 40,
        baseLightness: 65,
    },
    [BuildingIntendedUse.Industrial]: {
        baseHue: 0, // Concrete gray
        saturation: 0,
        baseLightness: 50,
    },
    [BuildingIntendedUse.Institutional]: {
        baseHue: 145, // Civic green
        saturation: 38,
        baseLightness: 58,
    },
    [BuildingIntendedUse.Public]: {
        baseHue: 15, // Brick Red / Terracotta
        saturation: 50,
        baseLightness: 60,
    },
    [BuildingIntendedUse.Utility]: {
        baseHue: 0, // Metric for grey
        saturation: 0,
        baseLightness: 40,
    },
    [BuildingIntendedUse.Hospitality]: {
        baseHue: 300, // Magenta/Purple
        saturation: 50,
        baseLightness: 60,
    }
};
