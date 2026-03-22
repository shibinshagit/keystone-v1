export const LEED_SCHEMA = {
  id: "leed",
  name: "LEED v4.1",
  maxScore: 110,

  categories: [
    {
      id: "lt",
      name: "Location & Transportation",
      maxScore: 16,
      items: [
        { id: "sensitive_land", name: "Sensitive Land Protection", maxScore: 1 },
        { id: "high_priority_site", name: "High Priority Site", maxScore: 2 },
        { id: "density", name: "Surrounding Density & Diverse Uses", maxScore: 5 },
        { id: "transit", name: "Access to Quality Transit", maxScore: 5 },
        { id: "bicycle", name: "Bicycle Facilities", maxScore: 1 },
        { id: "parking", name: "Reduced Parking Footprint", maxScore: 1 },
        { id: "green_vehicle", name: "Green Vehicles", maxScore: 1 }
      ]
    },
    {
      id: "ss",
      name: "Sustainable Sites",
      maxScore: 10,
      items: [
        { id: "construction_pollution", name: "Construction Pollution Prevention", mandatory: true },
        { id: "site_assessment", name: "Site Assessment", maxScore: 1 },
        { id: "habitat", name: "Protect / Restore Habitat", maxScore: 2 },
        { id: "open_space", name: "Open Space", maxScore: 1 },
        { id: "rainwater", name: "Rainwater Management", maxScore: 3 },
        { id: "heat_island", name: "Heat Island Reduction", maxScore: 2 },
        { id: "light_pollution", name: "Light Pollution Reduction", maxScore: 1 }
      ]
    },
    {
      id: "we",
      name: "Water Efficiency",
      maxScore: 11,
      items: [
        { id: "outdoor_prereq", name: "Outdoor Water Reduction", mandatory: true },
        { id: "indoor_prereq", name: "Indoor Water Reduction", mandatory: true },
        { id: "metering_prereq", name: "Water Metering", mandatory: true },
        { id: "outdoor", maxScore: 2 },
        { id: "indoor", maxScore: 6 },
        { id: "cooling", maxScore: 2 },
        { id: "sub_meter", maxScore: 1 }
      ]
    },
    {
      id: "ea",
      name: "Energy & Atmosphere",
      maxScore: 33,
      items: [
        { id: "commissioning", mandatory: true },
        { id: "min_energy", mandatory: true },
        { id: "energy_meter", mandatory: true },
        { id: "refrigerant", mandatory: true },
        { id: "enhanced_commissioning", maxScore: 6 },
        { id: "optimize_energy", maxScore: 18 },
        { id: "advanced_meter", maxScore: 1 },
        { id: "demand_response", maxScore: 2 },
        { id: "renewable", maxScore: 3 },
        { id: "enhanced_ref", maxScore: 1 },
        { id: "green_power", maxScore: 2 }
      ]
    },
    {
      id: "mr",
      name: "Materials & Resources",
      maxScore: 13,
      items: [
        { id: "recycle_prereq", mandatory: true },
        { id: "waste_plan", mandatory: true },
        { id: "lifecycle", maxScore: 5 },
        { id: "epd", maxScore: 2 },
        { id: "sourcing", maxScore: 2 },
        { id: "ingredients", maxScore: 2 },
        { id: "waste", maxScore: 2 }
      ]
    },
    {
      id: "eq",
      name: "Indoor Environmental Quality",
      maxScore: 16,
      items: [
        { id: "iaq", mandatory: true },
        { id: "smoke", mandatory: true },
        { id: "enhanced_air", maxScore: 2 },
        { id: "low_voc", maxScore: 3 },
        { id: "iaq_plan", maxScore: 1 },
        { id: "iaq_test", maxScore: 2 },
        { id: "thermal", maxScore: 1 },
        { id: "lighting", maxScore: 2 },
        { id: "daylight", maxScore: 3 },
        { id: "views", maxScore: 1 },
        { id: "acoustic", maxScore: 1 }
      ]
    },
    {
      id: "innovation",
      maxScore: 6,
      items: [
        { id: "innovation", maxScore: 5 },
        { id: "leed_ap", maxScore: 1 }
      ]
    },
    {
      id: "regional",
      maxScore: 4,
      items: [{ id: "regional", maxScore: 4 }]
    }
  ]
};