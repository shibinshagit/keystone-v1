'use client';

import { MapEditor } from '@/components/map-editor';
import { ChatPanel } from '@/components/chat-panel';
import { Toaster } from '@/components/ui/toaster';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Bot, MapPin, PanelRight, ArrowLeft, Save, Layers, PanelLeft, Loader2, BookCopy, Sparkles, Bookmark, Leaf } from 'lucide-react';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { LocationConnectivityPanel } from './location-connectivity-panel';
import { GreenScorecardPanel } from './green-scorecard-panel';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef } from 'react';
import { FeasibilityDashboard } from './feasibility-dashboard';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { PropertiesPanel } from './properties-panel';
import { ProjectExplorer } from './project-explorer';
import { DrawingToolbar } from './drawing-toolbar';
import { DrawingStatus } from './drawing-status';
import { ProjectInfoPanel } from './project-info-panel';
import { ParametricToolbar } from './parametric-toolbar';
import { DefineZoneModal } from './define-zone-modal';
import { AiScenarioViewerModal } from './ai-scenario-viewer-modal';
import { MapSearch } from './map-search';
import { RegulationViewerModal } from './regulation-viewer-modal';
import { ScenarioSelectorModal } from './scenario-selector-modal';
import { SavedScenariosPanel } from './saved-scenarios-panel';
import { SimulationTab } from './simulation-tab';
import { SimulationDataPanel } from './simulation-data-panel';
import { AnalysisMode } from './solar-controls';
import { Sun } from 'lucide-react';


export function GeoConstructApp({ projectId }: { projectId: string }) {
  const isMobile = useIsMobile();
  const [isClient, setIsClient] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("design");
  const [isMapReady, setIsMapReady] = useState(false);
  const [isRegulationViewerOpen, setIsRegulationViewerOpen] = useState(false);

  // Simulation State
  const [isSimulatorEnabled, setIsSimulatorEnabled] = useState(false);
  const [solarDate, setSolarDate] = useState<Date>(() => new Date());
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('none');
  const [isDataPanelOpen, setIsDataPanelOpen] = useState(true);

  const selectedObjectId = useBuildingStore(s => s.selectedObjectId);
  const actions = useBuildingStore(s => s.actions);
  const projects = useBuildingStore(s => s.projects);
  const activeProjectId = useBuildingStore(s => s.activeProjectId);
  const drawingState = useBuildingStore(s => s.drawingState);
  const zoneDefinition = useBuildingStore(s => s.zoneDefinition);
  const aiScenarios = useBuildingStore(s => s.aiScenarios);
  const isLoading = useBuildingStore(s => s.isLoading);
  const isSaving = useBuildingStore(s => s.isSaving);
  const plots = useBuildingStore(s => s.plots);
  const uiState = useBuildingStore(s => s.uiState);

  // Dynamic bottom clearance — stays above KPI bar whether open or collapsed
  const kpiOpen = uiState.isFeasibilityPanelOpen ?? true;
  const kpiBottom = kpiOpen ? 'calc(45vh + 8px)' : '58px';

  const project = projects.find(p => p.id === projectId);

  const selectedPlot = useSelectedPlot();

  console.log('[GeoConstructApp] Current project:', project);
  console.log('[GeoConstructApp] Project greenCertification:', project?.greenCertification);

  const { regulations: greenRegulations } = useGreenRegulations(project);

  useEffect(() => {
    setIsClient(true);
    if (projectId) {
      actions.loadProject(projectId);
    }
  }, [projectId, actions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('resizeMap'));
    }, 350);
    return () => clearTimeout(timer);
  }, [isChatOpen, selectedObjectId]);

  // Auto-switch to simulation tab when simulator is enabled
  // And close right property panel by deselecting objects
  useEffect(() => {
    if (isSimulatorEnabled) {
      setActiveTab('simulation');
      setIsDataPanelOpen(true);
      // Deselect any object to close the right properties panel
      if (selectedObjectId && selectedObjectId.type !== 'Plot') {
        actions.selectObject(null, null);
      }
    }
  }, [isSimulatorEnabled]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawingState.isDrawing) {
          actions.resetDrawing();
        } else if (selectedObjectId) {
          actions.selectObject(null, null);
        } else if (zoneDefinition.isDefining) {
          actions.cancelDefineZone();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [actions, drawingState.isDrawing, selectedObjectId, zoneDefinition.isDefining]);


  const locateMeButton = (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => window.dispatchEvent(new CustomEvent('locateUser'))}
      className={cn("absolute bottom-4 right-4 z-10 rounded-full h-12 w-12 shadow-lg transition-all duration-300",
        uiState.isFeasibilityPanelOpen ? "scrollbar-hide translate-y-20 opacity-0 pointer-events-none" : "translate-y-0 opacity-100")}
    >
      <MapPin className="h-6 w-6" />
    </Button>
  );

  const mobileChatPanel = (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" className="absolute top-2 right-2 z-10 rounded-full">
          <Bot className="mr-2 h-5 w-5" />
          AI Assistant
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[80vw] p-0 border-l-0 bg-transparent">
        <ChatPanel />
      </SheetContent>
    </Sheet>
  )

  const header = (
    <div className="p-2 border-b border-border flex items-center justify-between gap-4 bg-background/80 backdrop-blur-sm z-10">
      <div className="flex items-center gap-4 flex-1">
        <Button variant="outline" size="icon" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-headline font-bold">
            {project?.name || 'Loading Project...'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Urban Planning & Feasibility
          </p>
        </div>
      </div>
      <div className="flex-1 flex justify-center">
        <MapSearch />
      </div>
      <div className='flex items-center gap-2 flex-1 justify-end'>
        <Button variant={activeTab === 'explorer' ? 'secondary' : 'outline'} onClick={() => setActiveTab('explorer')}>
          <Layers className="mr-2 h-4 w-4" />
          Explorer
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => setIsChatOpen(!isChatOpen)}>
                <Bot className={cn("transition-transform h-5 w-5", isChatOpen && "text-primary")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isChatOpen ? "Collapse" : "Expand"} AI Assistant</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="outline" onClick={() => setIsRegulationViewerOpen(true)} disabled={!selectedPlot || !selectedPlot.availableRegulations || selectedPlot.availableRegulations.length === 0}>
          <BookCopy className="mr-2 h-4 w-4" />
          Regulations
        </Button>
        <Button onClick={() => actions.saveCurrentProject()} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )

  const showLoader = isLoading || !isMapReady;

  if (isClient && isMobile) {
    return (
      <div className="h-dvh w-screen bg-background text-foreground flex flex-col">
        {header}
        <main className="h-full w-full relative flex-1">
          {showLoader && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
              <div className="flex items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-lg">Loading Project...</span>
              </div>
            </div>
          )}
          <div className={cn('h-full w-full', showLoader && 'opacity-0')}>
            <MapEditor
              activeGreenRegulations={greenRegulations}
              onMapReady={() => setIsMapReady(true)}
              solarDate={solarDate}
              setSolarDate={setSolarDate}
              isSimulatorEnabled={isSimulatorEnabled}
              setIsSimulatorEnabled={setIsSimulatorEnabled}
              analysisMode={analysisMode}
              setAnalysisMode={setAnalysisMode}
            >
            </MapEditor>
            <DrawingToolbar />
            {locateMeButton}
            {selectedObjectId && <FeasibilityDashboard />}
          </div>
        </main>
        {mobileChatPanel}
        <Toaster />
      </div>
    );
  }

  return (
    <div className="h-dvh w-screen bg-background text-foreground flex flex-col overflow-hidden">
      {header}
      <div className="flex-1 relative">
        {showLoader && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
            <div className="flex items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-lg">Loading Project...</span>
            </div>
          </div>
        )}
        <div className={cn('h-full w-full', showLoader && 'opacity-0')}>
          <MapEditor
            activeGreenRegulations={greenRegulations}
            onMapReady={() => setIsMapReady(true)}
            solarDate={solarDate}
            setSolarDate={setSolarDate}
            isSimulatorEnabled={isSimulatorEnabled}
            setIsSimulatorEnabled={setIsSimulatorEnabled}
            analysisMode={analysisMode}
            setAnalysisMode={setAnalysisMode}
          >
          </MapEditor>

          {drawingState.isDrawing && <DrawingStatus />}

          <DrawingToolbar />

          {/* Hektar-style Sidebar */}
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 pointer-events-none" style={{ bottom: kpiBottom }}>
            <div className="pointer-events-auto shrink-0 w-96">
              <ProjectInfoPanel />
            </div>
            <div className="pointer-events-auto min-h-0 w-96 flex flex-row bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-xl border shadow-xl overflow-hidden text-clip shrink max-h-full">
              <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="flex flex-row h-auto max-h-full w-full min-h-0">
                <div className="w-14 bg-muted/30 border-r flex flex-col items-center py-4 gap-4 shrink-0">
                  <TabsList className="bg-transparent flex flex-col h-auto p-0 gap-4 w-full items-center">
                    <TabsTrigger value="design" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <Sparkles className="h-5 w-5" />
                    </TabsTrigger>
                    <TabsTrigger value="explorer" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <Layers className="h-5 w-5" />
                    </TabsTrigger>
                    <TabsTrigger value="simulation" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <Sun className="h-5 w-5" />
                    </TabsTrigger>
                    <TabsTrigger value="saved" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <Bookmark className="h-5 w-5" />
                    </TabsTrigger>
                    <TabsTrigger value="scorecard" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <Leaf className="h-5 w-5" />
                    </TabsTrigger>
                    <TabsTrigger value="location" className="justify-center w-10 h-10 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all">
                      <MapPin className="h-5 w-5" />
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                  <TabsContent
                    value="design"
                    className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin m-0 p-0 data-[state=active]:block h-full min-h-0"
                  >
                    <ParametricToolbar embedded={true} />
                  </TabsContent>

                  <TabsContent value="explorer" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <ProjectExplorer className="h-full" embedded={true} />
                  </TabsContent>

                  <TabsContent value="simulation" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full bg-background/50">
                    <SimulationTab
                      activeGreenRegulations={greenRegulations}
                      date={solarDate}
                      setDate={setSolarDate}
                      enabled={isSimulatorEnabled}
                      setEnabled={setIsSimulatorEnabled}
                      analysisMode={analysisMode}
                      setAnalysisMode={setAnalysisMode}
                    />
                  </TabsContent>

                  <TabsContent value="saved" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <SavedScenariosPanel embedded={true} />
                  </TabsContent>

                  <TabsContent value="scorecard" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <GreenScorecardPanel />
                  </TabsContent>
                  <TabsContent value="location" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <LocationConnectivityPanel />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>

          <div className={cn("absolute top-4 right-4 w-96 z-20 transition-transform duration-300 ease-in-out", 
            isSimulatorEnabled && analysisMode !== 'none' && isDataPanelOpen ? "translate-x-0" : "translate-x-[calc(100%+2rem)]")}>
            <SimulationDataPanel
              analysisMode={analysisMode}
              isOpen={isDataPanelOpen}
              onClose={() => setIsDataPanelOpen(false)}
              date={solarDate}
            />
          </div>

          <div className={cn("absolute top-4 right-4 z-20 transition-transform duration-300 ease-in-out flex flex-col", 
            selectedObjectId && !isSimulatorEnabled ? "translate-x-0" : "translate-x-[calc(100%+2rem)]")} 
            style={{ 
              bottom: kpiBottom,
              width: '420px',
            }}>
            <PropertiesPanel />
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {locateMeButton}
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>Locate Me</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {selectedObjectId && <FeasibilityDashboard />}

          <div className={cn("fixed top-[65px] right-0 h-[calc(100vh-65px)] bg-background/80 backdrop-blur-sm border-l border-border z-50 transition-transform duration-300 ease-in-out", isChatOpen ? "translate-x-0" : "translate-x-full")}>
            <div className="h-full w-[440px] relative">
              {isChatOpen && <ChatPanel />}
            </div>
          </div>
        </div>

      </div>
      <DefineZoneModal />
      <AiScenarioViewerModal />
      {
        selectedPlot && (
          <RegulationViewerModal
            isOpen={isRegulationViewerOpen}
            onOpenChange={setIsRegulationViewerOpen}
            plot={selectedPlot}
          />
        )
      }
      <Toaster />
      <ScenarioSelectorModal />
    </div >
  );
}
