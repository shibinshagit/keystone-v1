import { create } from 'zustand';

export type ScorecardDisplayItem = {
  label: string;
  value: string;
  status: string;
  score: number;
  maxScore: number;
};

interface GreenScorecardState {
  totalScore: number;
  maxScore: number;
  progress: number;
  certificateType: string | null;
  items: ScorecardDisplayItem[];
  setScorecardData: (data: { totalScore: number; maxScore: number; progress: number; certificateType: string, items: ScorecardDisplayItem[] }) => void;
}

export const useGreenScorecardStore = create<GreenScorecardState>((set) => ({
  totalScore: 0,
  maxScore: 100,
  progress: 0,
  certificateType: null,
  items: [],
  setScorecardData: (data) => set(data),
}));
