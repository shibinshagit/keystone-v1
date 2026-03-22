export const IGBC_SCHEMA = {
  id: "igbc",
  name: "IGBC Green Building",
  maxScore: 100,

  categories: [
    {
      id: "site",
      name: "Sustainable Site Planning",
      maxScore: 20,
      items: [
        { id: "site_selection", maxScore: 4 },
        { id: "proximity", maxScore: 3 },
        { id: "worker_amenities", maxScore: 2 },
        { id: "landscape", maxScore: 3 },
        { id: "heat_non_roof", maxScore: 2 },
        { id: "heat_roof", maxScore: 2 },
        { id: "lighting", maxScore: 2 },
        { id: "universal_design", maxScore: 2 }
      ]
    },
    {
      id: "water",
      name: "Water Efficiency",
      maxScore: 20,
      items: [
        { id: "landscape_water", maxScore: 5 },
        { id: "harvesting", maxScore: 5 },
        { id: "wastewater", maxScore: 4 },
        { id: "fixtures", maxScore: 4 },
        { id: "metering", maxScore: 2 }
      ]
    },
    {
      id: "energy",
      name: "Energy Efficiency",
      maxScore: 30,
      items: [
        { id: "optimize_energy", maxScore: 16 },
        { id: "renewable", maxScore: 5 },
        { id: "green_power", maxScore: 2 },
        { id: "refrigerant", maxScore: 2 },
        { id: "metering", maxScore: 2 },
        { id: "heat_recovery", maxScore: 2 },
        { id: "transport", maxScore: 1 }
      ]
    },
    {
      id: "materials",
      name: "Materials & Resources",
      maxScore: 15,
      items: [
        { id: "recycled", maxScore: 4 },
        { id: "regional", maxScore: 4 },
        { id: "wood", maxScore: 2 },
        { id: "waste", maxScore: 3 },
        { id: "segregation", maxScore: 2 }
      ]
    },
    {
      id: "ieq",
      name: "Indoor Environmental Quality",
      maxScore: 10,
      items: [
        { id: "ventilation", maxScore: 2 },
        { id: "co2", maxScore: 1 },
        { id: "voc", maxScore: 2 },
        { id: "daylight", maxScore: 2 },
        { id: "acoustic", maxScore: 1 },
        { id: "smoke", maxScore: 1 },
        { id: "thermal", maxScore: 1 }
      ]
    },
    {
      id: "innovation",
      name: "Innovation",
      maxScore: 5,
      items: [
        { id: "innovation", maxScore: 4 },
        { id: "ap", maxScore: 1 }
      ]
    }
  ]
};