import type { UnitTemplate } from '../types';

export const DEFAULT_UNIT_TEMPLATES: Omit<UnitTemplate, 'id' | 'created_at' | 'updated_at'>[] = [
    // ── RESIDENTIAL ──
    {
        name: "Standard 2BHK",
        bhk_type: "2BHK",
        carpet_area_sqm: 140,
        builtup_area_sqm: 186,
        balcony_area_sqm: 15,
        efficiency_ratio: 0.753,
        min_width_m: 10,
        min_depth_m: 14,
        description: "As per Logic & Methodology (1500 sqft / 140 sqm carpet area)"
    },
    {
        name: "Standard 3BHK",
        bhk_type: "3BHK",
        carpet_area_sqm: 185,
        builtup_area_sqm: 245,
        balcony_area_sqm: 20,
        efficiency_ratio: 0.755,
        min_width_m: 12,
        min_depth_m: 15,
        description: "As per Logic & Methodology (2000 sqft / 185 sqm carpet area)"
    },
    {
        name: "Standard 4BHK",
        bhk_type: "4BHK",
        carpet_area_sqm: 245,
        builtup_area_sqm: 325,
        balcony_area_sqm: 25,
        efficiency_ratio: 0.754,
        min_width_m: 14,
        min_depth_m: 17,
        description: "As per Logic & Methodology (2650 sqft / 245 sqm carpet area)"
    },
    {
        name: "Compact 1BHK",
        bhk_type: "1BHK",
        carpet_area_sqm: 55,
        builtup_area_sqm: 75,
        balcony_area_sqm: 8,
        efficiency_ratio: 0.733,
        min_width_m: 7,
        min_depth_m: 10,
        description: "Compact 1BHK for affordable housing"
    },
    {
        name: "Luxury 3BHK",
        bhk_type: "3BHK",
        carpet_area_sqm: 220,
        builtup_area_sqm: 290,
        balcony_area_sqm: 25,
        efficiency_ratio: 0.759,
        min_width_m: 13,
        min_depth_m: 16,
        description: "Premium 3BHK with larger living spaces"
    },
    {
        name: "Penthouse 5BHK",
        bhk_type: "5BHK",
        carpet_area_sqm: 350,
        builtup_area_sqm: 465,
        balcony_area_sqm: 40,
        efficiency_ratio: 0.753,
        min_width_m: 16,
        min_depth_m: 20,
        description: "Ultra-luxury penthouse configuration"
    },
];

// ── COMMERCIAL UNIT TEMPLATES ──
// These are used as reference data; the layout generator uses area values directly.
export const COMMERCIAL_UNIT_TEMPLATES = {
    retail: [
        { name: "Standard Retail Unit", area: 100, min_width_m: 10, min_depth_m: 10, description: "Standard retail shop unit (~1075 sqft)" },
        { name: "Large Retail Unit", area: 200, min_width_m: 14, min_depth_m: 14, description: "Large anchor retail unit (~2150 sqft)" },
        { name: "Small Retail Kiosk", area: 50, min_width_m: 7, min_depth_m: 7, description: "Small inline retail kiosk (~540 sqft)" },
    ],
    office: [
        { name: "Standard Office Bay", area: 80, min_width_m: 8, min_depth_m: 10, description: "Standard office bay (~860 sqft)" },
        { name: "Large Office Suite", area: 150, min_width_m: 12, min_depth_m: 12, description: "Large office suite (~1615 sqft)" },
        { name: "Compact Office", area: 50, min_width_m: 7, min_depth_m: 7, description: "Compact office unit (~540 sqft)" },
    ],
};
