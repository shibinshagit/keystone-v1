export const GREEN_SCHEMA = {
  id: "green",
  name: "Green Building",
  maxScore: 110,

  categories: [
    // =========================
    // LOCATION & TRANSPORT
    // =========================
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

    // =========================
    // SUSTAINABLE SITE
    // =========================
    {
      id: "ss",
      name: "Sustainable Sites",
      maxScore: 10,

      items: [
        {
          id: "construction_pollution",
          name: "Construction Pollution Prevention",
          mandatory: true
        },

        { id: "site_assessment", name: "Site Assessment", maxScore: 1 },
        { id: "habitat", name: "Protect / Restore Habitat", maxScore: 2 },
        { id: "open_space", name: "Open Space", maxScore: 1 },
        { id: "rainwater", name: "Rainwater Management", maxScore: 3 },
        { id: "heat_island", name: "Heat Island Reduction", maxScore: 2 },
        { id: "light_pollution", name: "Light Pollution Reduction", maxScore: 1 }
      ]
    },

    // =========================
    // WATER EFFICIENCY
    // =========================
    {
      id: "we",
      name: "Water Efficiency",
      maxScore: 11,

      items: [
        { id: "outdoor_prereq", name: "Outdoor Water Reduction", mandatory: true },
        { id: "indoor_prereq", name: "Indoor Water Reduction", mandatory: true },
        { id: "metering_prereq", name: "Water Metering", mandatory: true },

        { id: "outdoor", name: "Outdoor Water Use Reduction", maxScore: 2 },
        { id: "indoor", name: "Indoor Water Use Reduction", maxScore: 6 },
        { id: "cooling", name: "Cooling Tower Water Use", maxScore: 2 },
        { id: "sub_meter", name: "Water Sub-metering", maxScore: 1 }
      ]
    },

    // =========================
    // ENERGY
    // =========================
    {
      id: "ea",
      name: "Energy & Atmosphere",
      maxScore: 33,

      items: [
        { id: "commissioning", name: "Fundamental Commissioning", mandatory: true },
        { id: "min_energy", name: "Minimum Energy Performance", mandatory: true },
        { id: "energy_meter", name: "Energy Metering", mandatory: true },
        { id: "refrigerant", name: "Refrigerant Management", mandatory: true },

        { id: "enhanced_commissioning", name: "Enhanced Commissioning", maxScore: 6 },
        { id: "optimize_energy", name: "Optimize Energy Performance", maxScore: 18 },
        { id: "advanced_meter", name: "Advanced Energy Metering", maxScore: 1 },
        { id: "demand_response", name: "Demand Response", maxScore: 2 },
        { id: "renewable", name: "Renewable Energy Production", maxScore: 3 },
        { id: "enhanced_ref", name: "Enhanced Refrigerant", maxScore: 1 },
        { id: "green_power", name: "Green Power & Offsets", maxScore: 2 }
      ]
    },

    // =========================
    // MATERIALS
    // =========================
    {
      id: "mr",
      name: "Materials & Resources",
      maxScore: 13,

      items: [
        { id: "recycle_prereq", name: "Recyclables Storage", mandatory: true },
        { id: "waste_plan", name: "Construction Waste Plan", mandatory: true },

        { id: "lifecycle", name: "Lifecycle Impact Reduction", maxScore: 5 },
        { id: "epd", name: "Environmental Product Declarations", maxScore: 2 },
        { id: "sourcing", name: "Material Sourcing", maxScore: 2 },
        { id: "ingredients", name: "Material Ingredients", maxScore: 2 },
        { id: "waste", name: "Waste Management", maxScore: 2 }
      ]
    },

    // =========================
    // INDOOR ENVIRONMENT
    // =========================
    {
      id: "eq",
      name: "Indoor Environmental Quality",
      maxScore: 16,

      items: [
        { id: "iaq", name: "Minimum IAQ Performance", mandatory: true },
        { id: "smoke", name: "Tobacco Smoke Control", mandatory: true },

        { id: "enhanced_air", name: "Enhanced Air Quality", maxScore: 2 },
        { id: "low_voc", name: "Low Emitting Materials", maxScore: 3 },
        { id: "iaq_plan", name: "IAQ Management Plan", maxScore: 1 },
        { id: "iaq_test", name: "IAQ Testing", maxScore: 2 },
        { id: "thermal", name: "Thermal Comfort", maxScore: 1 },
        { id: "lighting", name: "Lighting Quality", maxScore: 2 },
        { id: "daylight", name: "Daylight", maxScore: 3 },
        { id: "views", name: "Quality Views", maxScore: 1 },
        { id: "acoustic", name: "Acoustic Comfort", maxScore: 1 }
      ]
    },

    // =========================
    // INNOVATION
    // =========================
    {
      id: "innovation",
      name: "Innovation",
      maxScore: 6,

      items: [
        { id: "innovation", name: "Innovation Credits", maxScore: 5 },
        { id: "leed_ap", name: "LEED Accredited Professional", maxScore: 1 }
      ]
    },

    // =========================
    // REGIONAL
    // =========================
    {
      id: "regional",
      name: "Regional Priority",
      maxScore: 4,

      items: [
        { id: "regional", name: "Regional Credits", maxScore: 4 }
      ]
    }
  ]
};