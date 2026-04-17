'use client';

import React, { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { Loader2, Globe, Info, MousePointer2, AlertTriangle, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BHUVAN_THEMES, getIndianStateCode, findBhuvanLayerByCoord, buildBhuvanLayerName, isLayerAvailableInIndex, BHUVAN_EXTENTS, getBestBhuvanDistrict, getBhuvanWmsUrl } from '@/lib/bhuvan-utils';

interface BhuvanPanelProps {
  embedded?: boolean;
}

function getIndexType(themeId: string): 'amrut' | 'nuis' | 'sisdp' | undefined {
  if (themeId === 'ulu_4k_amrut') return 'amrut';
  if (themeId === 'ulu_10k_nuis') return 'nuis';
  if (themeId === 'lulc_10k_sisdp') return 'sisdp';
  return undefined;
}

// Availability check — returns { status, message }
function checkAvailability(
  themeId: string,
  stateCode: string,
  lat?: number,
  lng?: number,
  districtNameHint?: string
): { status: 'available' | 'unavailable' | 'unknown'; message: string | null } {
  const theme = BHUVAN_THEMES.find(t => t.id === themeId);
  if (!theme) return { status: 'unknown', message: 'Theme not found.' };

  if (stateCode === 'IN' || stateCode === '') {
    return { status: 'unknown', message: 'Set a plot location to check availability.' };
  }

  const indexType = getIndexType(themeId);
  if (indexType) {
    const district = getBestBhuvanDistrict(indexType, stateCode, districtNameHint);
    if (district) {
      return { status: 'available', message: null };
    }
    return {
      status: 'unavailable',
      message: `${theme.categoryName || theme.name} is not available for ${stateCode} state.`
    };
  }

  const suffix = theme.themeCode;

  const hasStateCoverage = Object.keys(BHUVAN_EXTENTS).some(name =>
    (name.includes(`_${stateCode}_`) || name.includes(`${stateCode}_`) || name.endsWith(`_${stateCode}`)) && 
    (name.includes(suffix) || name.includes(theme.id))
  );

  if (!hasStateCoverage && !theme.fixedLayerName) {
    return {
      status: 'unavailable',
      message: `${theme.categoryName || theme.name} is not available for ${stateCode} state.`
    };
  }

  const layerName = buildBhuvanLayerName(themeId, stateCode, districtNameHint, lat, lng);
  if (isLayerAvailableInIndex(layerName)) return { status: 'available', message: null };

  return {
    status: 'unavailable',
    message: `${theme.categoryName || theme.name} data not found for this region.`
  };
}

export function BhuvanPanel({ embedded = false }: BhuvanPanelProps) {
  const { activeBhuvanLayer, activeBhuvanOpacity, bhuvanData, isFetchingBhuvan, plots, actions, districtNameHint } = useBuildingStore(s => ({
    activeBhuvanLayer: s.activeBhuvanLayer,
    activeBhuvanOpacity: s.activeBhuvanOpacity,
    bhuvanData: s.bhuvanData,
    isFetchingBhuvan: s.isFetchingBhuvan,
    plots: s.plots,
    actions: s.actions,
    districtNameHint: s.districtNameHint
  }));

  const selectedPlot = useSelectedPlot();
  const activePlot = selectedPlot || (plots.length > 0 ? plots[0] : null);

  const { stateCode, plotLat, plotLng } = useMemo(() => {
    if (activePlot?.geometry?.geometry) {
      try {
        const coords = (activePlot.geometry.geometry as any).coordinates[0][0];
        return {
          stateCode: getIndianStateCode(coords[1], coords[0]),
          plotLat: coords[1] as number,
          plotLng: coords[0] as number,
        };
      } catch {
        return { stateCode: 'IN', plotLat: undefined, plotLng: undefined };
      }
    }
    return { stateCode: 'IN', plotLat: undefined, plotLng: undefined };
  }, [activePlot]);

  const isPlotCreated = plots.length > 0;
  const activeTheme = BHUVAN_THEMES.find(t => t.id === activeBhuvanLayer);

  // Group themes by categoryId for the grid view
  const categories = useMemo(() => {
    const groups: Map<string, typeof BHUVAN_THEMES> = new Map();
    BHUVAN_THEMES.forEach(t => {
      const catId = t.categoryId || t.id;
      if (!groups.has(catId)) groups.set(catId, []);
      groups.get(catId)!.push(t);
    });
    return Array.from(groups.values());
  }, []);

  if (!isPlotCreated) {
    return (
      <div className={cn('flex flex-col h-full', embedded ? '' : 'w-full max-h-[calc(100vh-200px)]')}>
        <div className="px-3 py-2 border-b shrink-0">
          <h2 className="text-xs font-semibold flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-blue-500" />
            Bhuvan Thematic
          </h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-2">
          <div className="rounded-full bg-muted p-3">
            <MapPin className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No plot created yet</p>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Create a plot on the map first to access thematic layers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', embedded ? '' : 'w-full max-h-[calc(100vh-200px)]')}>
      <div className="px-3 py-2 border-b shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-blue-500" />
            Thematic Services
          </h2>
          {stateCode !== 'IN' && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              Region: {stateCode}
            </Badge>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4">
          <Label className="text-xs text-muted-foreground font-medium uppercase tracking-wider px-1">
            Select Thematic Layer
          </Label>

          <div className="grid grid-cols-2 gap-2">
            {/* None button */}
            <button
              onClick={() => actions.setActiveBhuvanLayer(null)}
              className={cn(
                'text-xs px-3 py-2 rounded-md border transition-all text-left flex items-center justify-between col-span-2 h-10',
                !activeBhuvanLayer
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background hover:bg-muted text-muted-foreground border-border hover:border-primary/30'
              )}
            >
              <span className="font-medium">None (Hide Overlays)</span>
              {!activeBhuvanLayer && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
            </button>

            {/* Category Grid */}
            {categories.map(groupThemes => {
              const primaryTheme = groupThemes[0];
              const categoryId = primaryTheme.categoryId || primaryTheme.id;
              const categoryName = primaryTheme.categoryName || primaryTheme.name;
              const isCategoryActive = groupThemes.some(t => t.id === activeBhuvanLayer);
              
              const firstAvailable = groupThemes.find(t => checkAvailability(t.id, stateCode, plotLat, plotLng, districtNameHint).status === 'available');
              const displayTheme = groupThemes.find(t => t.id === activeBhuvanLayer) || firstAvailable || primaryTheme;
              
              const { status: availStatus, message: error } = checkAvailability(displayTheme.id, stateCode, plotLat, plotLng, districtNameHint);
              const isUnavailable = availStatus === 'unavailable';

              return (
                <div key={categoryId} className={cn("flex flex-col gap-2", isCategoryActive && "col-span-2")}>
                  <button
                    onClick={() => {
                      if (isCategoryActive) {
                        actions.setActiveBhuvanLayer(null);
                      } else if (!isUnavailable) {
                        actions.setActiveBhuvanLayer(displayTheme.id);
                      }
                    }}
                    className={cn(
                      'text-xs px-3 py-2 rounded-md border transition-all text-left flex flex-col gap-1 h-20 group relative overflow-hidden',
                      isCategoryActive
                        ? 'bg-primary text-primary-foreground border-primary shadow-md'
                        : isUnavailable
                        ? 'bg-muted/30 border-dashed text-muted-foreground opacity-60 hover:opacity-100 hover:border-amber-500/50 hover:bg-muted/50'
                        : 'bg-background hover:bg-muted text-muted-foreground border-border hover:border-primary/30'
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold leading-tight line-clamp-2 uppercase tracking-wide text-[10px]">
                        {categoryName.split(':')[0].trim()}
                      </span>
                      {isCategoryActive && <div className="h-1.5 w-1.5 rounded-full bg-white animate-pulse shrink-0 ml-1" />}
                      {isUnavailable && !isCategoryActive && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 ml-1" />}
                    </div>
                    <span className={cn(
                      'text-[10px] opacity-80 line-clamp-2 leading-tight',
                      isCategoryActive ? 'text-primary-foreground/80' : 'text-muted-foreground'
                    )}>
                      {primaryTheme.description}
                    </span>
                  </button>

                  {/* Expansion: Sub-themes / Variants */}
                  {isCategoryActive && (
                    <div className="bg-muted/30 rounded-md border border-border p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                      {error && (
                        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                          <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-[10px] text-amber-400 leading-relaxed font-medium">{error}</p>
                        </div>
                      )}

                      {groupThemes.length > 1 && (
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Select Year / Scale</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {groupThemes.map(variant => {
                              const variantAvail = checkAvailability(variant.id, stateCode, plotLat, plotLng, districtNameHint);
                              const vDisabled = variantAvail.status === 'unavailable';
                              const vActive = activeBhuvanLayer === variant.id;

                              return (
                                <button
                                  key={variant.id}
                                  onClick={() => !vDisabled && actions.setActiveBhuvanLayer(variant.id)}
                                  className={cn(
                                    'text-[10px] px-3 py-1 rounded-full border transition-all flex items-center gap-1',
                                    vActive
                                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                      : vDisabled
                                      ? 'bg-muted/30 text-muted-foreground/50 border-transparent italic hover:border-amber-500/30 hover:bg-muted/50 hover:text-muted-foreground'
                                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                                  )}
                                >
                                  {variant.name.includes(':') ? variant.name.split(':')[1].trim() : variant.name.replace(categoryName, '').trim() || 'Standard'}
                                  {vDisabled && <AlertTriangle className="h-2 w-2 opacity-50" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Controls Area */}
                      <div className="grid grid-cols-1 gap-3 pt-1">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                              Opacity: {Math.round(activeBhuvanOpacity * 100)}%
                            </Label>
                          </div>
                          <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={activeBhuvanOpacity}
                            onChange={(e) => actions.setBhuvanOpacity(parseFloat(e.target.value))}
                            className="w-full accent-primary h-1 bg-secondary/50 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            {/* <Info className="h-3 w-3 text-muted-foreground" /> */}
                            {/* <Label className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                              Legend
                            </Label> */}
                          </div>
                          <BhuvanLegend
                            themeId={activeBhuvanLayer!}
                            stateCode={stateCode}
                            districtNameHint={districtNameHint}
                            plotLat={plotLat}
                            plotLng={plotLng}
                            fallbackLegend={activeTheme?.legend}
                          />
                        </div>

                        {/* Feature Info (if any) */}
                        <div className="space-y-2 pt-1 border-t border-border/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <MousePointer2 className="h-3 w-3 text-primary" />
                              <Label className="text-[10px] font-bold text-primary uppercase tracking-wider">Info</Label>
                            </div>
                            {isFetchingBhuvan && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                          </div>
                          {bhuvanData ? (
                            <ScrollArea className="h-32 w-full rounded-md border border-border/50 bg-background/50">
                              <div 
                                className="p-2 text-[10px] leading-tight w-max min-w-full bhuvan-info-content [&_table]:w-full [&_table]:text-[9px] [&_table]:border-collapse [&_th]:p-1.5 [&_th]:bg-muted/50 [&_th]:text-left [&_th]:font-semibold [&_td]:p-1.5 [&_td]:border-t [&_td]:border-border/50 [&_*]:!bg-transparent [&_*]:!text-foreground [&_*]:!border-border/50"
                                dangerouslySetInnerHTML={{ __html: bhuvanData }} 
                              />
                              <ScrollBar orientation="horizontal" />
                            </ScrollArea>
                          ) : (
                            <p className="text-[10px] text-muted-foreground italic text-center py-1">
                              {isFetchingBhuvan ? "NRSC lookup..." : "Click plot on map to query"}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Dynamic Legend from WMS GetLegendGraphic ──
function BhuvanLegend({
  themeId,
  stateCode,
  districtNameHint,
  plotLat,
  plotLng,
  fallbackLegend,
}: {
  themeId: string;
  stateCode: string;
  districtNameHint?: string;
  plotLat?: number;
  plotLng?: number;
  fallbackLegend?: { label: string; color: string }[];
}) {
  const [imgError, setImgError] = useState(false);
  const [legendData, setLegendData] = useState<{ label: string; color: string }[] | null>(null);
  const [loading, setLoading] = useState(true);

  const legendUrl = useMemo(() => {
    const theme = BHUVAN_THEMES.find(t => t.id === themeId);
    if (!theme) return null;

    const layerName = buildBhuvanLayerName(themeId, stateCode, districtNameHint, plotLat, plotLng);
    const bhuvanBaseUrl = getBhuvanWmsUrl(theme);

    const url = new URL(window.location.origin + '/api/bhuvan');
    url.searchParams.set('_bhuvanUrl', bhuvanBaseUrl);
    url.searchParams.set('service', 'WMS');
    url.searchParams.set('version', '1.1.1');
    url.searchParams.set('request', 'GetLegendGraphic');
    url.searchParams.set('layer', layerName);
    url.searchParams.set('format', 'image/png');
    url.searchParams.set('width', '18');
    url.searchParams.set('height', '18');
    return url.toString();
  }, [themeId, stateCode, districtNameHint, plotLat, plotLng]);

  // Fetch JSON version to render as native HTML
  React.useEffect(() => {
    if (!legendUrl) return;
    setLoading(true);
    setImgError(false);
    
    const jsonUrl = new URL(legendUrl);
    jsonUrl.searchParams.set('format', 'application/json');

    fetch(jsonUrl.toString())
      .then(res => res.json())
      .then(data => {
        if (data && data.Legend && Array.isArray(data.Legend)) {
          const allRules = data.Legend.flatMap((l: any) => l.rules || []);
          const parsed = allRules.map((r: any) => {
            let color = '#888';
            if (r.symbolizers && r.symbolizers.length > 0) {
              const sym = r.symbolizers[0];
              if (sym.Polygon?.fill) color = sym.Polygon.fill;
              else if (sym.Line?.stroke) color = sym.Line.stroke;
              else if (sym.Polygon?.['graphic-fill']?.graphics?.[0]?.fill) color = sym.Polygon['graphic-fill'].graphics[0].fill;
              else if (r.symbolizers[1]?.Polygon?.['graphic-fill']?.graphics?.[0]?.fill) color = r.symbolizers[1].Polygon['graphic-fill'].graphics[0].fill;
            }
            return {
              label: r.title || r.name || 'Unknown',
              color
            };
          }).filter((item: any) => item.label && item.label !== 'Unknown');
          setLegendData(parsed.length > 0 ? parsed : null);
        } else {
          setLegendData(null);
        }
      })
      .catch((err) => {
        console.error("Legend JSON parse error, falling back to image:", err);
        setLegendData(null);
      })
      .finally(() => setLoading(false));
  }, [legendUrl]);

  if (loading) {
    return <div className="h-20 w-full flex items-center justify-center text-[10px] animate-pulse text-muted-foreground bg-background/50 rounded-md border border-border/50">Fetching legend...</div>;
  }

  // 1. Render Native JSON Legend if available (Best Quality!)
  if (legendData && legendData.length > 0) {
    return (
      <ScrollArea className="w-full h-40 rounded-md border border-border/50 bg-background/50 p-2">
        <div className="grid grid-cols-1 w-full gap-y-1.5">
          {legendData.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 min-w-0" title={item.label}>
              <div
                className="w-2.5 h-2.5 rounded-[2px] shrink-0 border border-black/20 dark:border-white/10"
                style={{ backgroundColor: item.color }}
              />
              <span className="truncate text-[10px] font-medium text-foreground/90 flex-1">{item.label}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    );
  }

  // 2. Fallback to PNG Image if JSON failed
  if (!imgError && legendUrl) {
    return (
      <ScrollArea className="w-full h-40 rounded-md border border-border/50 bg-white dark:bg-black">
        <div className="p-2 flex items-start justify-start w-max min-w-full">
          <img
            src={legendUrl}
            alt="Legend"
            className="max-w-none h-auto rounded-sm dark:invert dark:hue-rotate-180"
            onError={() => setImgError(true)}
            onLoad={(e) => {
              if (e.currentTarget.naturalWidth <= 1 && e.currentTarget.naturalHeight <= 1) {
                setImgError(true);
              }
            }}
          />
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  }

  // 3. Absolute Fallback to hardcoded theme config
  if (fallbackLegend) {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        {fallbackLegend.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 py-0.5">
            <div
              className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/10"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate text-muted-foreground/90">{item.label}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
