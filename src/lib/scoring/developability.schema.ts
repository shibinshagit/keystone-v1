/**
 * Developability Score Schema
 * 
 * Defines the scoring rubric (0–1000) for the Land Intelligence
 * Developability Score. Four categories weighted by importance.
 */

export const DEVELOPABILITY_SCHEMA = {
  type: 'developability',
  totalMaxScore: 1000,
  passThreshold: 500,
  categories: [
    {
      id: 'GP',
      title: 'Growth Potential',
      items: [
        { id: 'GP1', title: 'Infrastructure proximity (metro/highway/airport)', maxScore: 80 },
        { id: 'GP2', title: 'FDI corridor alignment', maxScore: 60 },
        { id: 'GP3', title: 'Urban expansion index (satellite)', maxScore: 80 },
        { id: 'GP4', title: 'Population growth trend', maxScore: 40 },
        { id: 'GP5', title: 'Proposed infrastructure (rumoured/approved)', maxScore: 40 },
      ],
    },
    {
      id: 'LR',
      title: 'Legal & Regulatory',
      items: [
        { id: 'LR1', title: 'Zoning compliance', mandatory: true, maxScore: 80 },
        { id: 'LR2', title: 'CLU feasibility', maxScore: 50 },
        { id: 'LR3', title: 'Dispute / litigation flags', mandatory: true, maxScore: 60 },
        { id: 'LR4', title: 'RERA / approval status', maxScore: 30 },
        { id: 'LR5', title: 'Master plan conformity', maxScore: 30 },
      ],
    },
    {
      id: 'LC',
      title: 'Location & Connectivity',
      items: [
        { id: 'LC1', title: 'Metro / rail station distance', maxScore: 60 },
        { id: 'LC2', title: 'Highway / arterial road access', maxScore: 50 },
        { id: 'LC3', title: 'Amenity density (schools, hospitals, malls, parks)', maxScore: 60 },
        { id: 'LC4', title: 'Road width / frontage quality', maxScore: 40 },
        { id: 'LC5', title: 'Airport distance', maxScore: 40 },
      ],
    },
    {
      id: 'ME',
      title: 'Market & Economics',
      items: [
        { id: 'ME1', title: 'Price trend (appreciation rate)', maxScore: 60 },
        { id: 'ME2', title: 'SEZ / industrial park proximity', maxScore: 40 },
        { id: 'ME3', title: 'Absorption rate (demand signal)', maxScore: 50 },
        { id: 'ME4', title: 'Population density vs supply gap', maxScore: 50 },
      ],
    },
  ],
} as const;
