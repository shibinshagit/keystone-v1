export const LEED_SCHEMA = {
  id: 'leed',
  name: 'LEED v4',
  maxScore: 110,
  categories: [
    {
      id: 'integrative',
      title: 'Integrative Process',
      maxScore: 6,
      items: [
        { id: 'ip', title: 'Integrative process', maxScore: 6 }
      ]
    },
    {
      id: 'location',
      title: 'Location & Transportation',
      maxScore: 16,
      items: [
        { id: 'transit_access', title: 'Transit access', maxScore: 6 },
        { id: 'bicycle', title: 'Bicycle facilities', maxScore: 2 },
        { id: 'reduced_parking', title: 'Reduced parking', maxScore: 8 }
      ]
    },
    {
      id: 'materials',
      title: 'Materials & Resources',
      maxScore: 20,
      items: [
        { id: 'sourcing', title: 'Sourcing of materials', maxScore: 6 },
        { id: 'waste', title: 'Waste management', maxScore: 6 },
        { id: 'lifecycle', title: 'Lifecycle impacts', maxScore: 8 }
      ]
    },
    {
      id: 'energy',
      title: 'Energy & Atmosphere',
      maxScore: 48,
      items: [
        { id: 'min_energy', title: 'Minimum energy performance', maxScore: 5, mandatory: true },
        { id: 'optimize', title: 'Optimize energy performance', maxScore: 28 },
        { id: 'renewable', title: 'Renewable energy', maxScore: 15 }
      ]
    }
  ]
};
