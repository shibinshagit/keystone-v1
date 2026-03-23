'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { useProjectData } from '@/hooks/use-building-store';
import {
  GreenCreditCheckResult,
  useGreenStandardChecks,
} from '@/hooks/use-green-standard-checks';
import { GRIHA_SCHEMA } from '@/lib/scoring/griha.schema';
import { IGBC_SCHEMA } from '@/lib/scoring/igbc.schema';
import { LEED_SCHEMA } from '@/lib/scoring/leed.schema';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronDown, Leaf } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';

type CertificateType = 'LEED' | 'IGBC' | 'GRIHA';

type RawSchemaItem = {
  id: string;
  name?: string;
  maxScore?: number;
  mandatory?: boolean;
  mandatoryScore?: number;
};

type RawSchemaCategory = {
  id: string;
  name?: string;
  maxScore?: number;
  items: RawSchemaItem[];
};

type RawSchema = {
  id: string;
  name: string;
  maxScore: number;
  categories: RawSchemaCategory[];
};

type ScorecardItem = {
  id: string;
  name: string;
  maxScore: number;
  mandatory: boolean;
  mandatoryScore?: number;
  detectionKey?: string;
};

type ScorecardCategory = {
  id: string;
  name: string;
  maxScore: number;
  items: ScorecardItem[];
};

type ScorecardSchema = {
  id: string;
  name: string;
  maxScore: number;
  categories: ScorecardCategory[];
};

type MandatoryIssue = {
  categoryId: string;
  itemId: string;
};

type ItemEvaluation = {
  isDetectedValid: boolean;
  countedScore: number;
};

const schemaMap: Record<CertificateType, RawSchema> = {
  LEED: LEED_SCHEMA,
  IGBC: IGBC_SCHEMA,
  GRIHA: GRIHA_SCHEMA,
};

const STORAGE_KEY_PREFIX = 'green-scorecard:toggle-state';

const ITEM_CHECK_KEY_OVERRIDES: Record<string, string> = {
  open_space: 'open_space',
  rainwater: 'rainwater_harvesting',
  outdoor_prereq: 'rainwater_harvesting',
  metering_prereq: 'water_recycling',
  water_use: 'water_recycling',
  stp: 'water_recycling',
  site_selection: 'site_planning',
  topsoil: 'green_cover',
  passive_design: 'building_orientation',
  envelope: 'energy_efficiency',
  energy: 'energy_optimization',
  lighting: 'daylighting',
  hvac: 'energy_efficiency',
  iaq: 'ventilation',
  organic: 'waste_management',
  om: 'manual_tracking',
  commissioning: 'manual_tracking',
  min_energy: 'energy_optimization',
  energy_meter: 'energy_efficiency',
  refrigerant: 'energy_efficiency',
  recycle_prereq: 'waste_management',
  waste_plan: 'waste_management',
  smoke: 'manual_tracking',
  transit: 'transit_access',
  bicycle: 'transit_access',
  density: 'amenity_proximity',
  parking: 'parking_compliance',
  green_vehicle: 'ev_charging',
  transit_access: 'transit_access',
  daylight: 'daylighting',
  renewable: 'solar_energy',
  green_power: 'solar_energy',
  metering: 'water_recycling',
  wastewater: 'water_recycling',
  harvesting: 'rainwater_harvesting',
  landscape_water: 'green_cover',
  landscape: 'green_cover',
  heat_roof: 'heat_island',
  heat_non_roof: 'heat_island',
  ventilation: 'ventilation',
  acoustic: 'manual_tracking',
  thermal: 'manual_tracking',
  accessiblity: 'manual_tracking',
};

const KEYWORD_CHECK_RULES: Array<{ checkKey: string; keywords: string[] }> = [
  { checkKey: 'ventilation', keywords: ['ventilation', 'iaq', 'air quality', 'fresh air'] },
  { checkKey: 'daylighting', keywords: ['daylight', 'lighting', 'visual'] },
  { checkKey: 'green_cover', keywords: ['green', 'landscape', 'habitat', 'topsoil', 'vegetation'] },
  { checkKey: 'open_space', keywords: ['open space'] },
  { checkKey: 'heat_island', keywords: ['heat island', 'heat roof', 'heat non roof'] },
  { checkKey: 'transit_access', keywords: ['transit', 'bicycle', 'transport'] },
  { checkKey: 'amenity_proximity', keywords: ['density', 'proximity', 'amenity'] },
  { checkKey: 'rainwater_harvesting', keywords: ['rainwater', 'outdoor water', 'harvesting'] },
  { checkKey: 'solar_energy', keywords: ['solar', 'renewable', 'green power'] },
  { checkKey: 'water_recycling', keywords: ['water', 'stp', 'wastewater', 'metering', 'fixtures'] },
  { checkKey: 'waste_management', keywords: ['waste', 'organic', 'recycle', 'segregation'] },
  { checkKey: 'ev_charging', keywords: ['ev', 'green vehicle'] },
  { checkKey: 'parking_compliance', keywords: ['parking'] },
  { checkKey: 'building_orientation', keywords: ['passive', 'orientation'] },
  { checkKey: 'energy_efficiency', keywords: ['hvac', 'energy meter', 'refrigerant', 'envelope'] },
  { checkKey: 'energy_optimization', keywords: ['energy', 'optimize', 'commissioning'] },
  { checkKey: 'site_planning', keywords: ['site', 'planning'] },
  { checkKey: 'manual_tracking', keywords: ['smoke', 'om', 'audit', 'accessibility'] },
];

function formatLabel(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveDetectionKey(item: RawSchemaItem) {
  const direct = ITEM_CHECK_KEY_OVERRIDES[item.id];
  if (direct) return direct;

  const haystack = `${item.id} ${item.name ?? ''}`.toLowerCase();
  const matchedRule = KEYWORD_CHECK_RULES.find((rule) =>
    rule.keywords.some((keyword) => haystack.includes(keyword)),
  );

  return matchedRule?.checkKey;
}

function normalizeSchema(schema: RawSchema): ScorecardSchema {
  return {
    id: schema.id,
    name: schema.name,
    maxScore: schema.maxScore,
    categories: schema.categories.map((category) => ({
      id: category.id,
      name: category.name ?? formatLabel(category.id),
      maxScore: category.maxScore ?? 0,
      items: category.items.map((item) => ({
        id: item.id,
        name: item.name ?? formatLabel(item.id),
        maxScore: item.maxScore ?? 0,
        mandatory: Boolean(item.mandatory || item.mandatoryScore),
        mandatoryScore: item.mandatoryScore,
        detectionKey: resolveDetectionKey(item),
      })),
    })),
  };
}

function normalizeCertificateType(raw: string | undefined): CertificateType | null {
  const value = raw?.toUpperCase();

  if (!value) return null;
  if (value.includes('LEED')) return 'LEED';
  if (value.includes('IGBC')) return 'IGBC';
  if (value.includes('GRIHA')) return 'GRIHA';

  return null;
}

function getDefaultExpandedState(schema: ScorecardSchema) {
  return schema.categories.reduce<Record<string, boolean>>((state, category) => {
    state[category.id] = true;
    return state;
  }, {});
}

function getItemAutoDetectedValidity(
  item: ScorecardItem,
  checks: Record<string, GreenCreditCheckResult>,
) {
  if (!item.detectionKey) {
    return false;
  }

  const result = checks[item.detectionKey];
  if (!result || result.status !== 'achieved') {
    return false;
  }

  if (typeof item.mandatoryScore === 'number') {
    return result.score >= item.mandatoryScore;
  }

  return true;
}

function buildDetectedToggleState(
  schema: ScorecardSchema,
  checks: Record<string, GreenCreditCheckResult>,
) {
  return schema.categories.reduce<Record<string, boolean>>((state, category) => {
    category.items.forEach((item) => {
      state[item.id] = item.mandatory
        ? true
        : getItemAutoDetectedValidity(item, checks);
    });
    return state;
  }, {});
}

function getStoredToggleState(certificateType: CertificateType) {
  if (typeof window === 'undefined') {
    return {};
  }

  const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}:${certificateType}`);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export interface GreenScorecardProps {
  certificateType: CertificateType;
}

export function GreenScorecard({ certificateType }: GreenScorecardProps) {
  const project = useProjectData();
  const checks = useGreenStandardChecks(project, project?.simulationResults);

  const activeSchema = useMemo(
    () => normalizeSchema(schemaMap[certificateType]),
    [certificateType],
  );
  const [toggleState, setToggleState] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedCategories(getDefaultExpandedState(activeSchema));
  }, [activeSchema]);

  useEffect(() => {
    const stored = getStoredToggleState(certificateType);
    const detected = buildDetectedToggleState(activeSchema, checks);

    setToggleState((current) => {
      const next = { ...current };

      activeSchema.categories.forEach((category) => {
        category.items.forEach((item) => {
          const detectedOn = detected[item.id];
          const hasStored = Object.prototype.hasOwnProperty.call(stored, item.id);
          const storedValue = hasStored ? stored[item.id] : undefined;

          if (item.mandatory) {
            next[item.id] = hasStored ? Boolean(storedValue) : true;
            return;
          }

          if (detectedOn) {
            next[item.id] = true;
            return;
          }

          if (hasStored) {
            next[item.id] = Boolean(storedValue);
            return;
          }

          if (!Object.prototype.hasOwnProperty.call(next, item.id)) {
            next[item.id] = false;
          }
        });
      });

      return next;
    });
  }, [activeSchema, certificateType, checks]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      `${STORAGE_KEY_PREFIX}:${certificateType}`,
      JSON.stringify(toggleState),
    );
  }, [certificateType, toggleState]);

  const evaluations = useMemo(() => {
    return activeSchema.categories.reduce<Record<string, ItemEvaluation>>((map, category) => {
      category.items.forEach((item) => {
        const isDetectedValid = getItemAutoDetectedValidity(item, checks);
        const isChecked = Boolean(toggleState[item.id]);
        const countedScore = isChecked ? item.maxScore : 0;

        map[item.id] = {
          isDetectedValid,
          countedScore,
        };
      });

      return map;
    }, {});
  }, [activeSchema, checks, toggleState]);

  const selectedItems = useMemo(() => {
    return Object.keys(evaluations).reduce<Record<string, number>>((map, itemId) => {
      map[itemId] = evaluations[itemId]?.countedScore ?? 0;
      return map;
    }, {});
  }, [evaluations]);

  const categoryScores = useMemo(
    () =>
      activeSchema.categories.reduce<Record<string, number>>((scores, category) => {
        scores[category.id] = category.items.reduce((sum, item) => {
          return sum + (selectedItems[item.id] || 0);
        }, 0);

        return scores;
      }, {}),
    [activeSchema, selectedItems],
  );

  const totalScore = useMemo(() => {
    return activeSchema.categories.reduce((sum, category) => {
      return (
        sum +
        category.items.reduce((catSum, item) => {
          return catSum + (selectedItems[item.id] || 0);
        }, 0)
      );
    }, 0);
  }, [activeSchema, selectedItems]);

  const mandatoryIssues = useMemo(() => {
    return activeSchema.categories.reduce<MandatoryIssue[]>((issues, category) => {
      category.items.forEach((item) => {
        if (!item.mandatory) {
          return;
        }

        if (!toggleState[item.id]) {
          issues.push({ categoryId: category.id, itemId: item.id });
        }
      });

      return issues;
    }, []);
  }, [activeSchema, evaluations, toggleState]);

  const hasMandatoryErrors =
    (certificateType === 'LEED' || certificateType === 'GRIHA') &&
    mandatoryIssues.length > 0;

  const progress = activeSchema.maxScore
    ? Math.min((totalScore / activeSchema.maxScore) * 100, 100)
    : 0;

  const handleToggle = (item: ScorecardItem, checked: boolean) => {
    setToggleState((current) => ({
      ...current,
      [item.id]: checked,
    }));
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((current) => ({
      ...current,
      [categoryId]: !current[categoryId],
    }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2">
        {hasMandatoryErrors ? (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-red-200 px-2.5 py-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Mandatory conditions are not met. Please check highlighted items.</span>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Leaf className="h-3.5 w-3.5 text-green-600" />
          {certificateType}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="text-lg font-semibold">
            {totalScore} / {activeSchema.maxScore}
          </p>
          <p className="text-xs text-muted-foreground">Green Scorecard</p>
        </div>
        <Progress className="mt-2 h-2" value={progress} />
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {activeSchema.categories.map((category) => {
            const isExpanded = expandedCategories[category.id] !== false;

            return (
              <section
                key={category.id}
                className="overflow-hidden rounded-md border bg-transparent"
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-left"
                >
                  <div className="min-w-0">
                    <p
                      className="overflow-hidden text-sm font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                    >
                      {category.name}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 whitespace-nowrap text-right">
                    <span className="text-xs text-muted-foreground">
                      {categoryScores[category.id] || 0} / {category.maxScore}
                    </span>
                    <ChevronDown
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        isExpanded && 'rotate-180',
                      )}
                    />
                  </div>
                </button>

                {isExpanded ? (
                  <div className="space-y-2 border-t px-2 py-2">
                    {category.items.map((item) => {
                      const evaluation = evaluations[item.id];
                      const isChecked = Boolean(toggleState[item.id]);
                      const isInvalidMandatory = item.mandatory && !isChecked;

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'rounded-md border px-3 py-2',
                            isInvalidMandatory ? 'border-red-300' : 'border-border',
                          )}
                        >
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {isInvalidMandatory ? (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                ) : null}
                                <p className="overflow-hidden text-sm font-medium leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                                  {item.name}
                                </p>
                                {item.mandatory ? (
                                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                    Mandatory
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {selectedItems[item.id] || 0} / {item.maxScore}
                              </p>
                            </div>

                            <div className="flex items-start gap-3 whitespace-nowrap text-right">
                              <span className="min-w-[48px] shrink-0 text-right text-xs text-muted-foreground">
                                {selectedItems[item.id] || 0} / {item.maxScore}
                              </span>
                              <Switch
                                checked={isChecked}
                                onCheckedChange={(checked) => handleToggle(item, checked)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function GreenScorecardPanel() {
  const activeProject = useProjectData();
  const certificateType = normalizeCertificateType(activeProject?.greenCertification?.[0]);

  if (!activeProject) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Select a project to view scorecard
      </div>
    );
  }

  if (!certificateType) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Select a green certification to view the scorecard.
      </div>
    );
  }

  return <GreenScorecard certificateType={certificateType} />;
}
