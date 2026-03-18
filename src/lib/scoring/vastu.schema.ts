export const VASTU_SCHEMA = {
  id: "vastu",
  title: "Vastu Compliance",
  maxScore: 138,

  categories: [
    {
      id: "A",
      title: "Site Shape & Slope",
      maxScore: 10,
      items: [
        { id: "A1", title: "Plot shape is square or rectangular", maxScore: 4 },
        { id: "A2", title: "Site slope NE lowest, SW highest", maxScore: 4 },
        { id: "A3", title: "North & East lower and open than South & West", maxScore: 2 }
      ]
    },

    {
      id: "B",
      title: "Main Entrance & Gate Placement",
      maxScore: 10,
      items: [
        { id: "B1", title: "Main entry in auspicious zones", maxScore: 5 },
        { id: "B2", title: "No entrance in South-West", maxScore: 3 },
        { id: "B3", title: "Gate aligned with road zone", maxScore: 2 }
      ]
    },

    {
      id: "C",
      title: "Zoning of Land Uses",
      maxScore: 20,
      items: [
        { id: "C1", title: "North-East zoning", maxScore: 4 },
        { id: "C2", title: "South-West zoning", maxScore: 4 },
        { id: "C3", title: "South-East zoning", maxScore: 3 },
        { id: "C4", title: "North zoning", maxScore: 3 },
        { id: "C5", title: "East zoning", maxScore: 3 },
        { id: "C6", title: "North-West zoning", maxScore: 3 }
      ]
    },

    {
      id: "D",
      title: "Building Height & Massing",
      maxScore: 10,
      items: [
        { id: "D1", title: "Tallest buildings in South-West", maxScore: 4 },
        { id: "D2", title: "Lowest height in North-East", maxScore: 3 },
        { id: "D3", title: "Step increase NE → SW", maxScore: 3 }
      ]
    },

    {
      id: "E",
      title: "Roads & Internal Circulation",
      maxScore: 6,
      items: [
        { id: "E1", title: "Main road from East/North", maxScore: 3 },
        { id: "E2", title: "Clockwise circulation", maxScore: 2 },
        { id: "E3", title: "No T-junction hitting buildings", maxScore: 1 }
      ]
    },

    {
      id: "F",
      title: "Water Bodies & Utilities",
      maxScore: 12,
      items: [
        { id: "F1", title: "Water bodies in North-East", maxScore: 3 },
        { id: "F2", title: "Underground tank in North-East", maxScore: 3 },
        { id: "F3", title: "Overhead tank in SW/West", maxScore: 3 },
        { id: "F4", title: "Borewell in NE/East", maxScore: 3 }
      ]
    },

    {
      id: "G",
      title: "Basement",
      maxScore: 6,
      items: [
        { id: "G1", title: "Basement only in S/W/SW", maxScore: 4 },
        { id: "G2", title: "NE basement only for parking", maxScore: 2 }
      ]
    },

    {
      id: "H",
      title: "Open Spaces & Landscape",
      maxScore: 6,
      items: [
        { id: "H1", title: "Open space in North-East", maxScore: 4 },
        { id: "H2", title: "Services in SE/NW", maxScore: 2 }
      ]
    },

    {
      id: "I",
      title: "Temple / Prayer",
      maxScore: 4,
      items: [
        { id: "I1", title: "Temple in North-East", maxScore: 2 },
        { id: "I2", title: "Idol facing East/West", maxScore: 2 }
      ]
    },

    {
      id: "J",
      title: "Club House",
      maxScore: 4,
      items: [
        { id: "J1", title: "Club house in NE/North", maxScore: 4 }
      ]
    },

    {
      id: "K",
      title: "Commercial Block",
      maxScore: 4,
      items: [
        { id: "K1", title: "Commercial in North/East", maxScore: 4 }
      ]
    },

    {
      id: "L",
      title: "Fire & Electrical",
      maxScore: 8,
      items: [
        { id: "L1", title: "Electrical room in SE", maxScore: 2 },
        { id: "L2", title: "Generator in SE/NW", maxScore: 2 },
        { id: "L3", title: "Fire pump in SE/South", maxScore: 2 },
        { id: "L4", title: "Gas bank in SE", maxScore: 2 }
      ]
    },

    {
      id: "M",
      title: "Waste & Drainage",
      maxScore: 6,
      items: [
        { id: "M1", title: "STP in NW/SE", maxScore: 3 },
        { id: "M2", title: "Septic tank in NW", maxScore: 3 }
      ]
    },

    {
      id: "N",
      title: "Mechanical Services",
      maxScore: 6,
      items: [
        { id: "N1", title: "Lift room in SW/South", maxScore: 2 },
        { id: "N2", title: "Chiller plant in West/SW", maxScore: 2 },
        { id: "N3", title: "Pumps in SE/South", maxScore: 2 }
      ]
    },

    {
      id: "O",
      title: "Toilets",
      maxScore: 4,
      items: [
        { id: "O1", title: "Toilets in SE/NW", maxScore: 2 },
        { id: "O2", title: "No toilets in NE/Center", maxScore: 2 }
      ]
    },

    {
      id: "P",
      title: "Brahmasthan",
      maxScore: 6,
      items: [
        { id: "P1", title: "Center is open space", maxScore: 4 },
        { id: "P2", title: "No heavy structure at center", maxScore: 2 }
      ]
    },

    {
      id: "Q",
      title: "Plot Cuts & Extensions",
      maxScore: 8,
      items: [
        { id: "Q1", title: "No NE cut / NE extension", maxScore: 3 },
        { id: "Q2", title: "No SW extension", maxScore: 3 },
        { id: "Q3", title: "SE/NW extension handled", maxScore: 2 }
      ]
    },

    {
      id: "R",
      title: "Energy",
      maxScore: 4,
      items: [
        { id: "R1", title: "Solar panels South-facing", maxScore: 2 },
        { id: "R2", title: "Rainwater harvesting in NE", maxScore: 2 }
      ]
    },

    {
      id: "S",
      title: "Parking & Meter",
      maxScore: 4,
      items: [
        { id: "S1", title: "Meter rooms in SE/S/W", maxScore: 2 },
        { id: "S2", title: "Parking in NW/S/W", maxScore: 2 }
      ]
    }
  ]
};