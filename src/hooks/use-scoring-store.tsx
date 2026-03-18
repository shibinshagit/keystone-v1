"use client";

import React, { createContext, useContext, useMemo, useState } from 'react';
import evaluateSchema, { ItemResult } from '@/lib/scoring/schema-engine';
import { GREEN_SCHEMA } from '@/lib/scoring/green.schema';
import { VASTU_SCHEMA } from '@/lib/scoring/vastu.schema';
import { DEV_SCHEMA } from '@/lib/scoring/dev.schema';

type ResultsMap = Record<string, ItemResult | undefined>;

interface ScoringContextValue {
  results: ResultsMap;
  setResults: React.Dispatch<React.SetStateAction<ResultsMap>>;
  green: ReturnType<typeof evaluateSchema>;
  vastu: ReturnType<typeof evaluateSchema>;
  dev: ReturnType<typeof evaluateSchema>;
}

const ScoringContext = createContext<ScoringContextValue | null>(null);

function buildInitialResults(): ResultsMap {
  const out: ResultsMap = {};

  const addFromSchema = (schema: any) => {
    (schema.categories || []).forEach((cat: any) => {
      (cat.items || []).forEach((it: any) => {
        if (it.mandatory === true) {
          out[String(it.id)] = { status: true } as ItemResult;
        }
      });
    });
  };

  addFromSchema(GREEN_SCHEMA as any);
  addFromSchema(VASTU_SCHEMA as any);
  addFromSchema(DEV_SCHEMA as any);

  return out;
}

export function ScoringProvider({ children }: { children: React.ReactNode }) {
  const [results, setResults] = useState<ResultsMap>(() => buildInitialResults());

  const green = useMemo(() => evaluateSchema(GREEN_SCHEMA as any, results), [results]);
  const vastu = useMemo(() => evaluateSchema(VASTU_SCHEMA as any, results), [results]);
  const dev = useMemo(() => evaluateSchema(DEV_SCHEMA as any, results), [results]);

  const value = useMemo(() => ({ results, setResults, green, vastu, dev }), [results, green, vastu, dev]);

  return <ScoringContext.Provider value={value}>{children}</ScoringContext.Provider>;
}

export function useScoring() {
  const ctx = useContext(ScoringContext);
  if (!ctx) throw new Error('useScoring must be used within ScoringProvider');
  return ctx;
}

export default useScoring;
