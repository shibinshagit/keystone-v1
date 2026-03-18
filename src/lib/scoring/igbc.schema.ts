export const IGBC_SCHEMA = {
  id: 'igbc',
  name: 'IGBC Green Building',
  maxScore: 120,
  categories: [
    {
      id: 'site',
      title: 'Site Selection & Planning',
      maxScore: 20,
      items: [
        { id: 'site_protection', title: 'Site protection', maxScore: 4 },
        { id: 'stormwater', title: 'Stormwater management', maxScore: 4 },
        { id: 'landscape', title: 'Landscape and biodiversity', maxScore: 6 },
        { id: 'transport', title: 'Sustainable transport access', maxScore: 6 }
      ]
    },
    {
      id: 'water',
      title: 'Water Management',
      maxScore: 20,
      items: [
        { id: 'water_reduction', title: 'Water reduction', maxScore: 8 },
        { id: 'recycling', title: 'Water recycling', maxScore: 6 },
        { id: 'metering', title: 'Water metering', maxScore: 6 }
      ]
    },
    {
      id: 'energy',
      title: 'Energy & Emissions',
      maxScore: 40,
      items: [
        { id: 'baseline', title: 'Baseline energy performance', maxScore: 10, mandatory: true },
        { id: 'efficiency', title: 'Energy efficiency measures', maxScore: 18 },
        { id: 'renewables', title: 'Renewable energy', maxScore: 12 }
      ]
    },
    {
      id: 'materials',
      title: 'Materials & Resources',
      maxScore: 20,
      items: [
        { id: 'recycled', title: 'Use of recycled materials', maxScore: 6 },
        { id: 'local', title: 'Local sourcing', maxScore: 6 },
        { id: 'waste', title: 'Construction waste management', maxScore: 8 }
      ]
    }
  ]
};
