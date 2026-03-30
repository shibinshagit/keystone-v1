'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Download, Image, FileText, ChevronDown, Minus, Maximize2, X, GripVertical, RefreshCw } from 'lucide-react';

export function AiRenderingModal() {
  const { aiRenderingUrl, aiRenderingResult, aiRenderingMinimized, isGeneratingRendering, actions } = useBuildingStore(s => ({
    aiRenderingUrl: s.aiRenderingUrl,
    aiRenderingResult: s.aiRenderingResult,
    aiRenderingMinimized: s.aiRenderingMinimized,
    isGeneratingRendering: s.isGeneratingRendering,
    actions: s.actions,
  }));

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [prompt, setPrompt] = useState('');

  // Draggable PiP position (default: bottom-right)
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 224, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.origY + dy));
      setPipPos({ x: newX, y: newY });
    };
    const onMouseUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Reset load state when URL changes
  const [prevUrl, setPrevUrl] = useState(aiRenderingUrl);
  if (aiRenderingUrl && aiRenderingUrl !== prevUrl) {
    setPrevUrl(aiRenderingUrl);
    setImgLoaded(false);
    setImgError(false);
  }

  const downloadFilename = useCallback((suffix: string) => {
    const p = aiRenderingResult?.plot;
    const b = aiRenderingResult?.buildings;
    const location = p?.location?.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '') || 'Site';
    const use = b?.[0]?.intendedUse?.replace(/[^a-zA-Z0-9]+/g, '-') || 'Mixed';
    const date = new Date().toISOString().slice(0, 10);
    return `${location}_${use}_ArchViz${suffix}_${date}.png`;
  }, [aiRenderingResult]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadImage = useCallback(async () => {
    if (!aiRenderingUrl) return;
    try {
      const res = await fetch(aiRenderingUrl);
      const blob = await res.blob();
      downloadBlob(blob, downloadFilename(''));
    } catch {
      window.open(aiRenderingUrl, '_blank');
    }
  }, [aiRenderingUrl, downloadBlob, downloadFilename]);

  const handleDownloadWithDetails = useCallback(async () => {
    if (!aiRenderingUrl) return;
    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.src = aiRenderingUrl;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; });

      const b = aiRenderingResult?.buildings ?? [];
      const p = aiRenderingResult?.plot;
      const s = aiRenderingResult?.summary;

      // Collect detail lines
      const lines: string[] = [];
      if (p) {
        lines.push('── PLOT & LAND ──');
        lines.push(`Location: ${p.location}  |  Plot Area: ${Math.round(p.plotArea).toLocaleString()} sqm  |  Setback: ${p.setback}m`);
        if (p.far != null) lines.push(`FAR: ${p.far}  |  Max Coverage: ${p.maxCoverage != null ? Math.round(p.maxCoverage * 100) + '%' : '–'}  |  Max Height: ${p.maxBuildingHeight != null ? p.maxBuildingHeight + 'm' : '–'}`);
        if (p.roadAccessSides?.length) lines.push(`Road Access: ${p.roadAccessSides.join(', ')}`);
        lines.push('');
      }
      if (s && s.totalBuiltUpArea != null) {
        lines.push('── KPIs ──');
        lines.push(`GFA: ${Math.round(s.totalBuiltUpArea).toLocaleString()} sqm  |  FAR: ${s.achievedFAR ?? 0}  |  Coverage: ${s.groundCoveragePct ?? 0}%  |  Efficiency: ${Math.round((s.efficiency ?? 0) * 100)}%`);
        lines.push(`Sellable: ${(s.sellableArea ?? 0).toLocaleString()} sqm  |  Open Space: ${(s.openSpace ?? 0).toLocaleString()} sqm  |  Units: ${s.totalUnits ?? 0}`);
        lines.push('');
      }
      if (s?.compliance) {
        lines.push('── COMPLIANCE ──');
        lines.push(`Bylaws: ${s.compliance.bylaws}%  |  Green: ${s.compliance.green}%  |  Vastu: ${s.compliance.vastu}%`);
        lines.push('');
      }
      if (b.length > 0) {
        lines.push(`── BUILDINGS (${b.length}) ──`);
        b.forEach((bld, i) => {
          lines.push(`${b.length > 1 ? `[${i + 1}] ` : ''}${bld.name}: ${bld.intendedUse}, ${bld.typology}, ${Math.round(bld.height)}m, ${bld.numFloors}F above + ${bld.basementFloors}B, ${bld.footprintWidth}×${bld.footprintDepth}m, GFA ${Math.round(bld.gfa).toLocaleString()} sqm`);
        });
        lines.push('');
      }
      if (s?.designStrategy) {
        lines.push('── DESIGN STRATEGY ──');
        const ds = s.designStrategy;
        lines.push(`Land Use: ${ds.landUse}  |  Typology: ${ds.typology}${ds.hasPodium ? `  |  Podium: ${ds.podiumFloors}F` : ''}`);
        if (ds.parkingTypes?.length) lines.push(`Parking: ${ds.parkingTypes.join(', ')}`);
      }

      // Draw canvas
      const padding = 40;
      const lineHeight = 22;
      const fontSize = 14;
      const detailsHeight = padding * 2 + lines.length * lineHeight + 20;
      const canvasW = img.width;
      const canvasH = img.height + detailsHeight;

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Draw details text
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
      let y = img.height + padding;
      for (const line of lines) {
        if (line.startsWith('──')) {
          ctx.font = `bold ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = '#555555';
          ctx.fillText(line, padding, y);
          ctx.font = `${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = '#1a1a1a';
        } else {
          ctx.fillText(line, padding, y);
        }
        y += lineHeight;
      }

      canvas.toBlob(blob => {
        if (blob) downloadBlob(blob, downloadFilename('_Report'));
      }, 'image/png');
    } catch {
      window.open(aiRenderingUrl, '_blank');
    }
  }, [aiRenderingUrl, aiRenderingResult, downloadBlob, downloadFilename]);

  if (!aiRenderingUrl) return null;

  const handleClose = () => {
    setImgLoaded(false);
    setImgError(false);
    actions.clearAiRendering();
  };

  const handleMinimize = () => {
    actions.toggleAiRenderingMinimized(true);
  };

  const handleRestore = () => {
    actions.toggleAiRenderingMinimized(false);
    actions.refreshAiRenderingData();
  };

  const handleRefresh = () => {
    setImgLoaded(false);
    setImgError(false);
    actions.refreshAiRenderingData(true);
  };

  // Minimized floating PiP thumbnail (draggable)
  if (aiRenderingMinimized) {
    const defaultX = typeof window !== 'undefined' ? window.innerWidth - 240 : 0;
    const defaultY = typeof window !== 'undefined' ? window.innerHeight - 220 : 0;
    const pos = pipPos ?? { x: defaultX, y: defaultY };

    const onDragStart = (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    };

    return (
      <div
        ref={pipRef}
        className="fixed z-50 group"
        style={{ left: pos.x, top: pos.y }}
      >
        <div className="relative w-56 rounded-lg overflow-hidden shadow-2xl border bg-background ring-1 ring-black/10">
          {/* Drag handle + controls bar */}
          <div
            className="flex items-center justify-between px-2 py-1 bg-muted/80 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <GripVertical className="h-3 w-3" />
              AI Rendering
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleRestore}
                className="hover:bg-accent rounded p-0.5 transition-colors"
                title="Restore"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleClose}
                className="hover:bg-destructive/20 rounded p-0.5 transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Thumbnail image */}
          <img
            src={aiRenderingUrl}
            alt="AI rendering preview"
            className="w-full h-32 object-cover cursor-pointer"
            onClick={handleRestore}
          />
        </div>
      </div>
    );
  }

  return (
    <Dialog open={true} onOpenChange={open => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-start justify-between space-y-0 pr-8">
          <div>
            <DialogTitle>AI Architectural Rendering</DialogTitle>
            <DialogDescription>
              Photorealistic rendering based on your design parameters.
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleMinimize} title="Minimize">
            <Minus className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Image section */}
        <div className="mt-2">
          {imgError && (
            <p className="text-sm text-destructive">Failed to load image.</p>
          )}
          {!imgLoaded && !imgError && (
            <div className="flex items-center justify-center h-48 bg-muted rounded">
              <p className="text-sm text-muted-foreground animate-pulse">Loading image…</p>
            </div>
          )}
          <img
            src={aiRenderingUrl}
            alt="AI architectural rendering"
            className={`w-full h-auto rounded ${!imgLoaded ? 'hidden' : ''}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        </div>

        <div className="mt-4 space-y-3 border-t pt-3">
          <div className="space-y-1">
            <h3 className="text-sm font-bold">Generation Panel</h3>
            <p className="text-xs text-muted-foreground">
              Add optional guidance for the render. This field is UI-only for now and does not affect generation yet.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="render-prompt">Prompt</Label>
            <Textarea
              id="render-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the desired render mood, facade style, materials, lighting, or camera angle."
              className="min-h-[110px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleRefresh} disabled={isGeneratingRendering} title="Regenerate 3D rendering with latest data">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isGeneratingRendering ? 'animate-spin' : ''}`} />
            {isGeneratingRendering ? 'Regenerating…' : 'Refresh'}
          </Button>
          {imgLoaded && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-1.5" />
                  Download
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadImage}>
                  <Image className="h-4 w-4 mr-2" />
                  Image Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadWithDetails}>
                  <FileText className="h-4 w-4 mr-2" />
                  Image with Details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
