import { useBuildingStore, UTILITY_COLORS } from '@/hooks/use-building-store';
import { planarDimensions, planarArea } from '@/lib/generators/geometry-utils';
import { BUILDING_MATERIALS, hslToRgb } from '@/lib/color-utils';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse, GreenRegulationData, UtilityType, Building, Core, Unit, Plot, GreenArea, ParkingArea, BuildableArea, UtilityArea, SelectableObjectType } from '@/lib/types';
import { Feature, Polygon, Point, LineString, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import mapboxgl, { GeoJSONSource, LngLatLike, Map, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Script from 'next/script';
import { createShaktiChakraGroup } from '@/lib/shakti-chakra-visualizer';
import { getVastuCenter } from '@/lib/vastu-utils';
import { AnalysisMode } from './solar-controls';
import { runVisualAnalysis, runGroundAnalysis, runWallAnalysis, calculateAggregateStats } from '@/lib/engines/visual-analysis-engine';
import { fetchWeatherData } from '@/lib/engines/weather-data-service';
import { useRegulations } from '@/hooks/use-regulations';
import { generateBuildingTexture } from '@/lib/texture-generator';
import { WindStreamlineLayer } from '@/lib/wind-streamline-layer';
import { Amenity } from '@/services/mapbox-places-service';
import { OverpassPlacesService } from '@/services/overpass-places-service';
import { buildBhuvanLayerName, getIndianStateCode, getBhuvanWmsUrl, BHUVAN_THEMES, isLayerAvailableInIndex, getBestBhuvanDistrict } from '@/lib/bhuvan-utils';

import { Map as MapIcon, Globe, Image as ImageIcon } from 'lucide-react';

declare global {
  interface Window {
    tb: any;
    THREE: any;
  }
}

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

const DRAWING_OUTLINE_SOURCE_ID = 'drawing-outline-source';
const DRAWING_OUTLINE_LAYER_ID = 'drawing-outline-layer';
const FIRST_POINT_COLOR = '#F5A623';
const LABELS_SOURCE_ID = 'building-labels-source';
const LABELS_LAYER_ID = 'building-labels-layer';
const SELECTION_HIGHLIGHT_SOURCE_ID = 'selection-highlight-source';
const SELECTION_HIGHLIGHT_LAYER_ID = 'selection-highlight-layer';

// Helper to darken/lighten hex color
const adjustColorBrightness = (hex: string, percent: number) => {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
};

// Helper for Building Colors
const getBuildingColor = (use: string | BuildingIntendedUse) => {
  const useStr = (use || '').toString().toLowerCase();
  if (useStr === 'residential') return '#4CAF50'; // Green
  if (useStr === 'commercial') return '#F44336'; // Red
  if (useStr === 'retail') return '#FF4081';     // Hot Pink / Magenta
  if (useStr === 'office') return '#29B6F6';     // Light Cyan Blue
  if (useStr === 'institutional') return '#2196F3'; // Blue
  if (useStr === 'public') return '#FF8C00';     // Orange
  if (useStr === 'mixed use' || useStr === 'mixed-use') return '#FBC02D'; // Yellow
  if (useStr === 'industrial') return '#9C27B0'; // Purple
  if (useStr === 'hospitality') return '#E91E63'; // Pink
  return '#9E9E9E'; // Grey default
};

const createBuildingFrontMarker = (
  geometry: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
  centroid: Feature<Point>,
  facingBearing: number,
  roofBaseHeight: number
) => {
  try {
    const geomFeature = geometry?.type === 'Feature' ? geometry as Feature<Polygon | MultiPolygon> : turf.feature(geometry);
    const boundary = turf.polygonToLine(geomFeature as any);
    const center = centroid.geometry.coordinates as [number, number];
    const probe = turf.destination(center, 200, facingBearing, { units: 'meters' });
    const ray = turf.lineString([center, probe.geometry.coordinates as [number, number]]);
    const intersections = turf.lineIntersect(ray as any, boundary as any);

    if (!intersections.features.length) return null;

    const hit = intersections.features
      .map((feature) => ({
        point: feature,
        distance: turf.distance(center, feature.geometry.coordinates as [number, number], { units: 'meters' }),
      }))
      .filter(({ distance }) => distance > 0.1)
      .sort((a, b) => a.distance - b.distance)[0];

    if (!hit) return null;

    const dims = planarDimensions(geomFeature as any);
    const halfWidth = Math.max(2, Math.min(dims.width, dims.length) * 0.18);
    const depth = Math.max(1.5, Math.min(dims.width, dims.length) * 0.08);
    const frontLeft = turf.destination(hit.point, halfWidth, facingBearing + 90, { units: 'meters' });
    const frontRight = turf.destination(hit.point, halfWidth, facingBearing - 90, { units: 'meters' });
    const backLeft = turf.destination(frontLeft, depth, facingBearing + 180, { units: 'meters' });
    const backRight = turf.destination(frontRight, depth, facingBearing + 180, { units: 'meters' });

    return turf.polygon([[
      frontLeft.geometry.coordinates as [number, number],
      frontRight.geometry.coordinates as [number, number],
      backRight.geometry.coordinates as [number, number],
      backLeft.geometry.coordinates as [number, number],
      frontLeft.geometry.coordinates as [number, number],
    ]], {
      base_height: roofBaseHeight,
      height: roofBaseHeight + 1.6,
    });
  } catch {
    return null;
  }
};

interface MapEditorProps {
  onMapReady?: () => void;
  solarDate: Date;
  setSolarDate: (d: Date) => void;
  isSimulatorEnabled: boolean;
  setIsSimulatorEnabled: (b: boolean) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (m: AnalysisMode) => void;
  activeGreenRegulations?: GreenRegulationData[];
  children?: React.ReactNode;
}

export function MapEditor({
  onMapReady,
  solarDate,
  setSolarDate,
  isSimulatorEnabled,
  setIsSimulatorEnabled,
  analysisMode,
  setAnalysisMode,
  activeGreenRegulations = [],
  children
}: MapEditorProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [buildingsReady, setBuildingsReady] = useState(false); 

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [isThreeboxLoaded, setIsThreeboxLoaded] = useState(false);
  const [mapStyleMode, setMapStyleMode] = useState<'map' | 'satellite' | 'terrain'>('map');
  const markers = useRef<Marker[]>([]);
  const vastuObjectsRef = useRef<any[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); 
  const hasNavigatedRef = useRef(false); 
  const windStreamlineLayer = useRef<WindStreamlineLayer|null>(null);

  // Dragging state
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<mapboxgl.LngLat | null>(null);
  const draggedObjectRef = useRef<{ id: string; type: SelectableObjectType; plotId: string } | null>(null);

  // ...rotation tool state removed...

  // Timed selection highlight
  const [showSelectionHighlight, setShowSelectionHighlight] = useState(false);
  const selectionHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);




  // Optimized Selectors
  const actions = useBuildingStore(s => s.actions);
  const drawingPoints = useBuildingStore(s => s.drawingPoints);
  const drawingState = useBuildingStore(s => s.drawingState);
  const selectedObjectId = useBuildingStore(s => s.selectedObjectId);
  const isLoading = useBuildingStore(s => s.isLoading);
  const plots = useBuildingStore(s => s.plots);
  const tempScenarios = useBuildingStore(s => s.tempScenarios); // Add tempScenarios selector
  const mapCommand = useBuildingStore(s => s.mapCommand);
  const uiState = useBuildingStore(s => s.uiState);
  const componentVisibility = useBuildingStore(s => s.componentVisibility);
  const activeProjectId = useBuildingStore(s => s.activeProjectId);
  const projects = useBuildingStore(s => s.projects);
  const activeBhuvanLayer = useBuildingStore(s => s.activeBhuvanLayer);

  const activeProject = projects.find(p => p.id === activeProjectId);
  const { regulations } = useRegulations(activeProject || null);
  const { toast } = useToast();
  const getStoreState = useCallback(() => useBuildingStore.getState(), []);

  // When a building is selected, show teal highlight for 3 seconds then auto-clear
  useEffect(() => {
    if (selectedObjectId && selectedObjectId.type === 'Building') {
      setShowSelectionHighlight(true);
      if (selectionHighlightTimerRef.current) clearTimeout(selectionHighlightTimerRef.current);
      selectionHighlightTimerRef.current = setTimeout(() => {
        setShowSelectionHighlight(false);
      }, 3000);
    } else {
      setShowSelectionHighlight(false);
      if (selectionHighlightTimerRef.current) {
        clearTimeout(selectionHighlightTimerRef.current);
        selectionHighlightTimerRef.current = null;
      }
    }
    return () => {
      if (selectionHighlightTimerRef.current) clearTimeout(selectionHighlightTimerRef.current);
    };
  }, [selectedObjectId]);

  const plotsRendering = plots;


  const finishRoad = useCallback(() => {
    if (drawingPoints.length < 2) return;
    const line = turf.lineString(drawingPoints);
    if (actions.finishDrawing(line)) {
      actions.resetDrawing();
    }
  }, [drawingPoints, actions]);

  const closePolygon = useCallback(() => {
    if (drawingPoints.length < 3) return;
    try {
      const polygon = turf.polygon([[...drawingPoints, drawingPoints[0]]]);
      if (actions.finishDrawing(polygon)) {
        actions.resetDrawing();
      }
    } catch (e) {
      console.error('Error closing polygon:', e);
      toast({
        variant: 'destructive',
        title: 'Drawing Error',
        description: 'Failed to close polygon. Please check your points.',
      });
    }
  }, [drawingPoints, actions, toast]);


  const handleMouseDown = useCallback((e: mapboxgl.MapLayerMouseEvent) => {
    const { drawingState, plots } = getStoreState();
    if (drawingState.objectType !== 'Move') return;

    const mapInst = map.current;
    if (!mapInst) return;

// Move objects
    const allMapLayers = mapInst.getStyle().layers.map(l => l.id);
    const draggableLayers = plots.flatMap(p => 
      [
        ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
        ...p.greenAreas.map(g => `green-area-${g.id}`),
        ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
        ...p.utilityAreas.map(u => `utility-area-${u.id}`),
        ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
      ]
    ).filter(id => allMapLayers.includes(id));

    console.log('[Move] Draggable layers found:', draggableLayers.length);

    if (draggableLayers.length === 0) return;

    const features = mapInst.queryRenderedFeatures(e.point, { layers: draggableLayers });
    console.log('[Move] Features at click point:', features?.length, features?.map(f => f.layer?.id));

    if (!features || features.length === 0) return;

    const feature = features[0];
    const props = feature.properties || {};
    const layerId = feature.layer?.id;
    if (!layerId) return;

    let id = props.id || '';
    let type: SelectableObjectType = 'Building';
    let plotId = '';

    if (layerId.startsWith('building-floor-fill-')) {
      type = 'Building';
      for (const p of plots) {
        const matchedBuilding = p.buildings.find(b => layerId.endsWith(`-${b.id}`));
        if (matchedBuilding) {
          id = matchedBuilding.id;
          break;
        }
      }
    } else if (layerId.startsWith('green-area-')) {
      id = layerId.replace('green-area-', '');
      type = 'GreenArea';
    } else if (layerId.startsWith('parking-area-')) {
      id = layerId.replace('parking-area-', '');
      type = 'ParkingArea';
    } else if (layerId.startsWith('utility-area-')) {
      id = layerId.replace('utility-area-', '');
      type = 'UtilityArea';
    } else if (layerId.startsWith('buildable-area-')) {
      id = layerId.replace('buildable-area-', '');
      type = 'BuildableArea';
    }

    console.log('[Move] Identified object:', { id, type, layerId });

    if (!id) return;

    const targetPlot = plots.find(p => 
      (type === 'Building' && p.buildings.some(b => b.id === id)) ||
      (type === 'GreenArea' && p.greenAreas.some(g => g.id === id)) ||
      (type === 'ParkingArea' && p.parkingAreas.some(pa => pa.id === id)) ||
      (type === 'UtilityArea' && p.utilityAreas.some(u => u.id === id)) ||
      (type === 'BuildableArea' && p.buildableAreas.some(b => b.id === id))
    );
    
    if (targetPlot) {
      plotId = targetPlot.id;
      console.log('[Move] Starting drag:', { id, type, plotId });
      actions.selectObject(id, type);
      isDraggingRef.current = true;
      dragStartPosRef.current = e.lngLat;
      draggedObjectRef.current = { id, type, plotId };
      mapInst.dragPan.disable();
      mapInst.getCanvas().style.cursor = 'grabbing';
    } else {
      console.warn('[Move] Could not find parent plot for:', { id, type });
    }
  }, [getStoreState]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      const draggedObj = draggedObjectRef.current;
      const draggedPlotId = draggedObj?.plotId;
      isDraggingRef.current = false;
      draggedObjectRef.current = null;
      dragStartPosRef.current = null;
      if (map.current) {
        map.current.dragPan.enable();
        map.current.getCanvas().style.cursor = '';
      }

      if (draggedPlotId) {
        if (draggedObj?.type === 'UtilityArea') {
          actions.recalculateParkingAreas(draggedPlotId);
          actions.recalculateGreenAreas(draggedPlotId);
        } else {
          actions.recalculateParkingAreas(draggedPlotId);
          actions.recalculateGreenAreas(draggedPlotId);
        }
      }

      actions.saveCurrentProject();
    }
  }, [actions]);


  const handleDragMove = useCallback((e: mapboxgl.MapLayerMouseEvent) => {
    // ...rotation tool drag logic removed...

    if (!isDraggingRef.current || !draggedObjectRef.current || !dragStartPosRef.current) return;

    const currentPos = e.lngLat;
    const deltaLng = currentPos.lng - dragStartPosRef.current.lng;
    const deltaLat = currentPos.lat - dragStartPosRef.current.lat;

    if (deltaLng === 0 && deltaLat === 0) return;

    actions.moveObject(
      draggedObjectRef.current.plotId,
      draggedObjectRef.current.id,
      draggedObjectRef.current.type,
      deltaLng,
      deltaLat
    );

    dragStartPosRef.current = currentPos;
  }, [actions]);



  const handleMapClick = useCallback(
    (e: mapboxgl.MapLayerMouseEvent) => {
      const mapInst = map.current;
      if (!mapInst || !mapInst.isStyleLoaded()) return;

      const { drawingState, drawingPoints, activeBhuvanLayer, plots } = getStoreState();

      if (typeof drawingState.objectType !== 'string' || drawingState.objectType.toLowerCase() === 'move') return;

      // ...rotation tool map click logic removed...

      // Defensive check for Rotate tool (fix invalid comparison)
      if (typeof drawingState.objectType === 'string' && drawingState.objectType.toLowerCase() === 'rotate') {
        // Rotation tool logic (if any) would go here
        return;
      }

      if (activeBhuvanLayer) {
        if (actions) actions.setBhuvanData(null, true);
        const mapInst = map.current;
        if (mapInst) {
          const pxBuffer = 5;
          const sw = mapInst.unproject([e.point.x - pxBuffer, e.point.y + pxBuffer]);
          const ne = mapInst.unproject([e.point.x + pxBuffer, e.point.y - pxBuffer]);
          
          const bbox = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
          
          const width = 10;
          const height = 10;
          const x = 5;
          const y = 5;

          let stateCode = 'IN';
          let plotLat: number | undefined;
          let plotLng: number | undefined;
          if (plots.length > 0 && plots[0].geometry?.geometry) {
            const geom = plots[0].geometry.geometry as Polygon;
            if (geom.coordinates?.[0]?.[0]) {
              const coord = geom.coordinates[0][0];
              plotLng = coord[0];
              plotLat = coord[1];
              stateCode = getIndianStateCode(plotLat, plotLng);
            }
          }

          const layerName = buildBhuvanLayerName(activeBhuvanLayer, stateCode, undefined, plotLat, plotLng);
          const activeTheme = BHUVAN_THEMES.find(t => t.id === activeBhuvanLayer);
          const bhuvanBaseUrl = activeTheme ? getBhuvanWmsUrl(activeTheme) : undefined;

          const wmsUrl = new URL(window.location.origin + '/api/bhuvan');
          if (bhuvanBaseUrl) wmsUrl.searchParams.set('_bhuvanUrl', bhuvanBaseUrl);
          wmsUrl.searchParams.set('service', 'WMS');
          wmsUrl.searchParams.set('version', '1.1.1');
          wmsUrl.searchParams.set('request', 'GetFeatureInfo');
          wmsUrl.searchParams.set('layers', layerName);
          wmsUrl.searchParams.set('query_layers', layerName);
          wmsUrl.searchParams.set('feature_count', '1');
          wmsUrl.searchParams.set('info_format', 'text/html');
          wmsUrl.searchParams.set('format', 'image/png');
          wmsUrl.searchParams.set('srs', 'EPSG:4326');
          wmsUrl.searchParams.set('bbox', bbox);
          wmsUrl.searchParams.set('width', Math.floor(width).toString());
          wmsUrl.searchParams.set('height', Math.floor(height).toString());
          wmsUrl.searchParams.set('x', Math.floor(x).toString());
          wmsUrl.searchParams.set('y', Math.floor(y).toString());

          fetch(wmsUrl.toString())
            .then(res => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.text();
            })
            .then(text => {
              if (text.includes('ServiceException')) {
                 console.error('Bhuvan Service Exception:', text);
                 actions.setBhuvanData('Error: Invalid query parameters or layer not available here.', false);
                 return;
              }
              
              if (text.includes('<body></body>') || text.trim() === '' || text.length < 50) {
                 actions.setBhuvanData('No specific thematic data found exactly at this point.', false);
              } else {
                 actions.setBhuvanData(text, false);
              }
            })
            .catch(err => {
              console.error('Bhuvan GetFeatureInfo error:', err);
              actions.setBhuvanData('Error: Could not retrieve thematic data for this location.', false);
            });
        }
      }

      if (drawingState.isDrawing) {
        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        if (typeof drawingState.objectType !== 'string' || drawingState.objectType.toLowerCase() !== 'road' && drawingPoints.length > 2) {
          const firstPoint = drawingPoints[0];
          const clickPoint: LngLatLike = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          const firstMapPoint: LngLatLike = { lng: firstPoint[0], lat: firstPoint[1] };
          const pixelDist = map.current?.project(clickPoint).dist(map.current.project(firstMapPoint));

          if (pixelDist && pixelDist < 15) { 
            closePolygon();
            return;
          }
        }
        try {
          actions.addDrawingPoint(coords);
        } catch (err) {
          toast({
            variant: 'destructive',
            title: 'Drawing Error',
            description: 'Failed to add drawing point. Please try again.',
          });
        }
      } else {
        const { drawingState: currentDrawingState, plots } = getStoreState();
        if (typeof currentDrawingState.objectType !== 'string' || currentDrawingState.objectType.toLowerCase() !== 'select') return;

        const allMapLayers = mapInst.getStyle().layers.map(l => l.id);
        const clickableLayers = plots.flatMap(p =>
          [
            `plot-base-${p.id}`,
            ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
            ...p.buildings.flatMap(b => (b.units || []).map(u => `units-${u.id}`)),
            ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
            ...p.greenAreas.map(g => `green-area-${g.id}`),
            ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
            ...p.utilityAreas.map(u => `utility-area-${u.id}`)
          ]
        ).filter(id => allMapLayers.includes(id));

        if (clickableLayers.length === 0) return;

        const features = mapInst.queryRenderedFeatures(e.point, {
          layers: clickableLayers,
        });

        if (features && features.length > 0) {
          const prioritizedTypes = [
            'units-',
            'building-floor-fill-',
            'green-area-',
            'parking-area-',
            'utility-area-',
            'buildable-area-',
            'plot-base-'
          ];

          let feature = features[0];
          for (const prefix of prioritizedTypes) {
            const found = features.find(f => f.layer?.id?.startsWith(prefix));
            if (found) {
              feature = found;
              break;
            }
          }

          const layerId = feature.layer?.id;
          if (!layerId) return;

          if (layerId.startsWith('building-floor-fill-')) {
            for (const plot of plots) {
              const matchedBuilding = plot.buildings.find(b => layerId.endsWith(`-${b.id}`));
              if (matchedBuilding) {
                actions.selectObject(matchedBuilding.id, 'Building');
                break;
              }
            }
          } else if (layerId.startsWith('units-')) {
            const unitId = layerId.replace('units-', '');
            // Verify it exists
            for (const plot of plots) {
              const matchedBuilding = plot.buildings.find(b => b.units?.some(u => u.id === unitId));
              if (matchedBuilding) {
                actions.selectObject(unitId, 'Unit');
                break;
              }
            }
          } else if (layerId.startsWith('plot-base-')) {
            const plotId = layerId.replace('plot-base-', '');
            if (plots.some(p => p.id === plotId)) {
              actions.selectObject(plotId, 'Plot');
            }
          } else if (layerId.startsWith('buildable-area-')) {
            const buildableAreaId = layerId.replace('buildable-area-', '');
            actions.selectObject(buildableAreaId, 'BuildableArea');
          } else if (layerId.startsWith('green-area-')) {
            const greenAreaId = layerId.replace('green-area-', '');
            actions.selectObject(greenAreaId, 'GreenArea');
          } else if (layerId.startsWith('parking-area-')) {
            const parkingAreaId = layerId.replace('parking-area-', '');
            actions.selectObject(parkingAreaId, 'ParkingArea');
          } else if (layerId.startsWith('utility-area-')) {
            const utilityAreaId = layerId.replace('utility-area-', '');
            actions.selectObject(utilityAreaId, 'UtilityArea');
          }
        } else {
          actions.selectObject(null, null);
        }
      }
    },
    [closePolygon, actions, getStoreState]
  );

  const handleMouseMove = useCallback((e: mapboxgl.MapLayerMouseEvent) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const { drawingState, drawingPoints } = getStoreState();

    if (drawingState.isDrawing) {
      map.current.getCanvas().style.cursor = 'crosshair';
      if (drawingPoints.length > 0) {
        if (drawingState.objectType === 'Road' && drawingPoints.length >= 1) {
          const mousePoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          const previewPoints = [...drawingPoints, mousePoint];
          const line = turf.lineString(previewPoints);
          const buffered = turf.buffer(line, (drawingState.roadWidth / 2), { units: 'meters' });

          const outlineSource = map.current.getSource(DRAWING_OUTLINE_SOURCE_ID) as GeoJSONSource;
          const roadFillSource = map.current.getSource('drawing-road-fill') as GeoJSONSource;

          if (outlineSource) outlineSource.setData(turf.featureCollection([line]));
          if (roadFillSource && buffered) roadFillSource.setData(turf.featureCollection([buffered]));
        } else if (drawingPoints.length > 2) {
          const firstPoint = drawingPoints[0];
          const hoverPoint: LngLatLike = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          const firstMapPoint: LngLatLike = { lng: firstPoint[0], lat: firstPoint[1] };
          const pixelDist = map.current?.project(hoverPoint).dist(map.current.project(firstMapPoint));
          if (pixelDist && pixelDist < 15) {
            map.current.getCanvas().style.cursor = 'pointer';
          }
        }
      }
    } else {
      const { plots, drawingState: currentDrawState } = getStoreState();
      const isSelectMode = currentDrawState.objectType === 'Select';

      if (isSelectMode) {
        const allMapLayers = map.current.getStyle().layers.map(l => l.id);
        const hoverableLayers = plots.flatMap(p =>
          [
            `plot-base-${p.id}`,
            ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
            ...p.buildings.flatMap(b => (b.units || []).map(u => `units-${u.id}`)),
            ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
            ...p.greenAreas.map(g => `green-area-${g.id}`),
            ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
            ...p.utilityAreas.map(u => `utility-area-${u.id}`)
          ]
        ).filter(id => allMapLayers.includes(id));

        if (hoverableLayers.length > 0) {
          const features = map.current.queryRenderedFeatures(e.point, { layers: hoverableLayers });
          map.current.getCanvas().style.cursor = features && features.length > 0 ? 'pointer' : 'default';
        } else {
          map.current.getCanvas().style.cursor = 'default';
        }
      } else {
        map.current.getCanvas().style.cursor = 'grab';
      }
    }
  },
    [getStoreState]
  );

  const locateUser = useCallback(() => {
    if (!map.current) return;
    if (!navigator.geolocation) {
      toast({ variant: 'destructive', title: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!map.current) return;
        const userLoc: LngLatLike = [pos.coords.longitude, pos.coords.latitude];
        map.current.flyTo({ center: userLoc, zoom: 16 });
        new mapboxgl.Marker({ color: '#10b981' }).setLngLat(userLoc).addTo(map.current);
      },
      err => {
        toast({ variant: 'destructive', title: 'Unable to retrieve location', description: err.message });
      }
    );
  }, [toast]);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { drawingState } = getStoreState();
      if (!drawingState.isDrawing) return;

      if (event.key === 'Escape') {
        actions.resetDrawing();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (drawingState.objectType === 'Road') {
          finishRoad();
        } else if (drawingPoints.length >= 3) {
          closePolygon();
        }
      }

      if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        actions.undoLastPoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [actions, getStoreState]);



  useEffect(() => {
    const handleLocate = () => locateUser();
    const handleCloseEvent = () => closePolygon();
    const handleResize = () => {
      if (map.current) {
        map.current.resize();
      }
    }
    const handleFlyTo = (event: Event) => {
      if (!map.current) return;
      const customEvent = event as CustomEvent;
      const { center, zoom } = customEvent.detail;
      map.current.flyTo({
        center,
        zoom: zoom || 18,
        pitch: 45,
        essential: true,
        duration: 800,
      });
    }
    const handleFinishRoad = () => finishRoad();

    window.addEventListener('locateUser', handleLocate);
    window.addEventListener('closePolygon', handleCloseEvent);
    window.addEventListener('finishRoad', handleFinishRoad);
    window.addEventListener('resizeMap', handleResize);
    window.addEventListener('flyTo', handleFlyTo);

    return () => {
      window.removeEventListener('locateUser', handleLocate);
      window.removeEventListener('closePolygon', handleCloseEvent);
      window.removeEventListener('finishRoad', handleFinishRoad);
      window.removeEventListener('resizeMap', handleResize);
      window.removeEventListener('flyTo', handleFlyTo);
    };
  }, [locateUser, closePolygon, finishRoad]);

  // Initialize Map
  useEffect(() => {
    if (map.current) return;
    if (!mapContainer.current) return;
    if (!mapboxgl.accessToken) {
      toast({
        variant: 'destructive',
        title: 'Configuration Error',
        description: 'Mapbox access token is missing. Please set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your environment variables.',
      });
      return;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/standard',
      center: [-74.006, 40.7128], 
      zoom: 15,
      pitch: 60,
      antialias: true,
    });

    const mapInstance = map.current;

    mapInstance.on('load', () => {
      onMapReady?.();
      mapInstance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

      // GENERATE & ADD TEXTURES
      const buildingTypes = ['Residential', 'Commercial', 'Retail', 'Office', 'Institutional', 'Public', 'Mixed Use', 'Industrial', 'Hospitality'];

      buildingTypes.forEach(type => {
        const color = getBuildingColor(type as BuildingIntendedUse);
        const img = generateBuildingTexture(type as any, color, 1.0);
        if (img) {
          const key = `texture-${type}-1.0`;
          if (mapInstance.hasImage(key)) mapInstance.removeImage(key);
          mapInstance.addImage(key, img, { pixelRatio: 2 });
        }
      });

      // Terrain & Atmosphere Configuration
      mapInstance.setMaxPitch(85); 

      mapInstance.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });


      // Sky Layer
      mapInstance.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 0.0],
          'sky-atmosphere-sun-intensity': 15
        }
      });

      // Add Wind Arrow Image
      const arrowSize = 32;
      const canvas = document.createElement('canvas');
      canvas.width = arrowSize;
      canvas.height = arrowSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#3b82f6'; // blue-500
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(16, 4);
        ctx.lineTo(16, 28);
        ctx.moveTo(16, 4);
        ctx.lineTo(8, 12);
        ctx.moveTo(16, 4);
        ctx.lineTo(24, 12);
        ctx.stroke();
        mapInstance.addImage('wind-arrow', ctx.getImageData(0, 0, arrowSize, arrowSize));
      }

      try {
        mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
      } catch (e) {
        console.warn("Could not set show3dObjects config", e);
      }

      // Add Satellite layer
      mapInstance.addSource('mapbox-satellite', {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tileSize: 256
      });
      mapInstance.addLayer({
        id: 'satellite-basemap',
        type: 'raster',
        source: 'mapbox-satellite',
        layout: {
          visibility: 'none'
        }
      });

      setIsMapLoaded(true);
    });


    mapInstance.on('styledata', () => {
      if (mapInstance.isStyleLoaded()) {
        setStyleLoaded(true);
      }
    });

    mapInstance.on('click', handleMapClick);
    mapInstance.on('mousedown', handleMouseDown);
    mapInstance.on('mousemove', handleMouseMove);
    mapInstance.on('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleMouseUp);



    return () => {
      const mapInst = map.current;
      if (!mapInst) return;
      mapInst.off('click', handleMapClick);
      mapInst.off('mousedown', handleMouseDown);
      mapInst.off('mousemove', handleMouseMove);
      mapInst.off('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleMouseUp);

      mapInst.remove();

      map.current = null;
    };

  }, []);


  // Auto-navigate to project location or first plot on load
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    if (hasNavigatedRef.current) return;

    if (plots.length > 0) {
      const firstPlot = plots[0];
      if (firstPlot?.geometry?.geometry) {
        try {
          const centroid = turf.centroid(firstPlot.geometry);
          const [lng, lat] = centroid.geometry.coordinates;

          console.log('âœˆï¸ Flying to plot centroid:', { lat, lng });
          map.current.flyTo({
            center: [lng, lat],
            zoom: 17,
            essential: true,
            duration: 1500
          });

          map.current.once('moveend', () => {
            if (map.current) {
              hasNavigatedRef.current = true;
              console.log('âœ… Marked as navigated (session)');
              map.current.triggerRepaint();

              actions.selectObject(firstPlot.id, 'Plot');
              console.log('ðŸŽ¯ Auto-selected plot for visibility');
            }
          });
          return;
        } catch (error) {
          console.warn('Failed to calculate plot centroid:', error);
        }
      }
    }

    if (activeProject?.location && typeof activeProject.location === 'object') {
      const { lat, lng } = activeProject.location as { lat: number, lng: number };
      if (lat && lng) {
        console.log('âœˆï¸  Flying to project location:', { lat, lng });
        map.current.flyTo({
          center: [lng, lat],
          zoom: 16,
          essential: true,
          duration: 1500
        });

        map.current.once('moveend', () => {
          if (map.current) {
            hasNavigatedRef.current = true;
            map.current.triggerRepaint();
          }
        });
      }
    }
  }, [isMapLoaded, plots, activeProject, activeProjectId, actions]);

  const plotsRef = useRef(plots);
  useEffect(() => { plotsRef.current = plots; }, [plots]);

  const pendingRoadDetections = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    const detectRoads = () => {
      if (map.current?.isMoving()) return;

      plotsRef.current.forEach(plot => {
        if (!plot.geometry || !plot.visible) return;

        if (plot.roadAccessSides !== undefined || pendingRoadDetections.current.has(plot.id)) return;

        pendingRoadDetections.current.add(plot.id);
        console.log(`[Road Debug] Detecting roads for Plot ${plot.id} using Source Query...`);

        const roadFeatures = map.current!.querySourceFeatures('composite', {
          sourceLayer: 'road'
        });

        const searchPoly = turf.buffer(plot.geometry as any, 0.05, { units: 'kilometers' });

        const relevantRoads = roadFeatures.filter(f => {
          if (f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString') return false;
          return turf.booleanIntersects(searchPoly as any, f as any);
        });

        if (plots[0] === plot) {
          const style = map.current!.getStyle();
          console.log(`[Road Debug] Style Sources:`, Object.keys(style.sources));
          if ((style as any).imports) {
            console.log(`[Road Debug] Style Imports:`, (style as any).imports.map((i: any) => i.id));
          }
          console.log(`[Road Debug] Found ${roadFeatures.length} total roads in viewport.`);
          console.log(`[Road Debug] Found ${relevantRoads.length} roads near plot.`);
        }

        const determineAccessSides = (features: any[]) => {
          const bbox = turf.bbox(plot.geometry);
          const [minX, minY, maxX, maxY] = bbox;

          const nLine = turf.lineString([[minX, maxY], [maxX, maxY]]);
          const sLine = turf.lineString([[minX, minY], [maxX, minY]]);
          const eLine = turf.lineString([[maxX, minY], [maxX, maxY]]);
          const wLine = turf.lineString([[minX, minY], [minX, maxY]]);

          const bufferDist = 0.025;
          const nZone = turf.buffer(nLine, bufferDist, { units: 'kilometers' });
          const sZone = turf.buffer(sLine, bufferDist, { units: 'kilometers' });
          const eZone = turf.buffer(eLine, bufferDist, { units: 'kilometers' });
          const wZone = turf.buffer(wLine, bufferDist, { units: 'kilometers' });

          const accessSides = new Set<string>();

          features.forEach(rf => {
            if (turf.booleanIntersects(rf as any, nZone as any)) accessSides.add('N');
            if (turf.booleanIntersects(rf as any, sZone as any)) accessSides.add('S');
            if (turf.booleanIntersects(rf as any, eZone as any)) accessSides.add('E');
            if (turf.booleanIntersects(rf as any, wZone as any)) accessSides.add('W');
          });

          return Array.from(accessSides);
        };

        if (relevantRoads.length > 0) {
          const newSides = determineAccessSides(relevantRoads);
          const oldSides: string[] = plot.roadAccessSides || [];

          if (plots[0] === plot) console.log(`[Road Debug] Detected Sides (Local):`, newSides);

          const hasChanged = newSides.length !== oldSides.length || !newSides.every((s: string) => oldSides.includes(s));
          if (hasChanged && newSides.length > 0) {
            console.log(`🛣️  Detected Road Access for ${plot.name}:`, newSides);
            actions.updatePlot(plot.id, { roadAccessSides: newSides });
            toast({
              title: "Road Access Detected",
              description: `Identified roads on: ${newSides.join(', ')} side(s).`
            });
          }
          pendingRoadDetections.current.delete(plot.id);
        } else {
          if (plots[0] === plot) console.log(`[Road Debug] No local roads found. Trying Overpass API...`);

          const searchArea = turf.buffer(plot.geometry as any, 0.1, { units: 'kilometers' });
          const searchBbox = turf.bbox(searchArea);

          OverpassPlacesService.fetchRoads(searchBbox as [number, number, number, number])
            .then(osmRoads => {
              const newSides = osmRoads.length > 0 ? determineAccessSides(osmRoads) : [];
              const oldSides: string[] = plot.roadAccessSides || [];
              const hasChanged = newSides.length !== oldSides.length || !newSides.every((s: string) => oldSides.includes(s));

              console.log(`[Road Debug] Overpass returned ${osmRoads.length} roads. Access:`, newSides);

              actions.updatePlot(plot.id, { roadAccessSides: newSides });

              if (hasChanged && newSides.length > 0) {
                toast({
                  title: "Road Access Detected",
                  description: `Identified roads on: ${newSides.join(', ')} side(s).`
                });
              } else {
                console.log(`[Road Debug] Overpass result unchanged or empty. Saved.`);
              }
            })
            .catch(err => console.error("[Road Debug] Overpass failed:", err))
            .finally(() => {
              pendingRoadDetections.current.delete(plot.id);
            });
        }
      });
    };

    map.current.on('idle', detectRoads);
    return () => { map.current?.off('idle', detectRoads); };
  }, [isMapLoaded, actions]);

  const [districtNameHint, setDistrictNameHint] = useState<string | undefined>();

  useEffect(() => {
    const { plots: storePlots } = getStoreState();
    let plotLat: number | undefined;
    let plotLng: number | undefined;
    if (storePlots.length > 0 && storePlots[0].geometry?.geometry) {
      const geom = storePlots[0].geometry.geometry as Polygon;
      if (geom.coordinates?.[0]?.[0]) {
        const coord = geom.coordinates[0][0];
        plotLng = coord[0];
        plotLat = coord[1];
      }
    }

    if (!plotLat || !plotLng) {
      setDistrictNameHint(undefined);
      return;
    }

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!mapboxToken) return;

    fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${plotLng},${plotLat}.json?access_token=${mapboxToken}&types=district,place,locality,neighborhood,postcode&country=IN`)
      .then(res => res.json())
      .then(data => {
        if (data.features && data.features.length > 0) {
          const hints: string[] = [];
          
          data.features.forEach((f: any) => {
            if (f.text && !hints.includes(f.text)) {
              hints.push(f.text);
            }
          });
          
          if (hints.length > 0) {
            setDistrictNameHint(hints.join('|'));
          } else {
            setDistrictNameHint(undefined);
          }
        }
      })
      .catch(err => console.error('Reverse geocoding error for district hint:', err));
  }, [plots.length > 0 ? plots[0].geometry : null, getStoreState]);

  useEffect(() => {
    const mapInst = map.current;
    if (!mapInst || !isMapLoaded || !styleLoaded) return;

    const sourceId = 'bhuvan-wms';
    const layerId = 'bhuvan-layer';

    if (activeBhuvanLayer) {
      if (mapInst.getLayer(layerId)) mapInst.removeLayer(layerId);
      if (mapInst.getSource(sourceId)) mapInst.removeSource(sourceId);

      // Detect state code and coordinates from the plot geometry
      const { plots: storePlots } = getStoreState();
      let stateCode = 'IN';
      let plotLat: number | undefined;
      let plotLng: number | undefined;
      if (storePlots.length > 0 && storePlots[0].geometry?.geometry) {
        const geom = storePlots[0].geometry.geometry as Polygon;
        if (geom.coordinates?.[0]?.[0]) {
          const coord = geom.coordinates[0][0];
          plotLng = coord[0];
          plotLat = coord[1];
          stateCode = getIndianStateCode(plotLat, plotLng);
        }
      }

      const layerName = buildBhuvanLayerName(activeBhuvanLayer, stateCode, districtNameHint, plotLat, plotLng);
      const activeTheme = BHUVAN_THEMES.find(t => t.id === activeBhuvanLayer);

      const isDistrictTheme = activeTheme?.usesDistrict;
      let isAvailable = true;
      if (isDistrictTheme) {
        if (activeBhuvanLayer === 'ulu_4k_amrut') {
          isAvailable = !!getBestBhuvanDistrict('amrut', stateCode);
        } else if (activeBhuvanLayer === 'ulu_10k_nuis') {
          isAvailable = !!getBestBhuvanDistrict('nuis', stateCode);
        } else if (activeBhuvanLayer === 'lulc_10k_sisdp') {
          isAvailable = isLayerAvailableInIndex(layerName);
        }
      } else {
        isAvailable = isLayerAvailableInIndex(layerName);
      }

      if (!isAvailable) {
        return;
      }

      const bhuvanBaseUrl = activeTheme ? getBhuvanWmsUrl(activeTheme) : undefined;
      const bhuvanUrlParam = bhuvanBaseUrl ? `&_bhuvanUrl=${encodeURIComponent(bhuvanBaseUrl)}` : '';

      const tileProxyBase = `/api/bhuvan?service=WMS&version=1.1.1&request=GetMap&layers=${encodeURIComponent(layerName)}&width=256&height=256&srs=EPSG:3857&format=image%2Fpng&transparent=true${bhuvanUrlParam}`;

      mapInst.addSource(sourceId, {
        type: 'raster',
        tiles: [
          `${tileProxyBase}&bbox={bbox-epsg-3857}`
        ],
        tileSize: 256
      });

      const firstSymbolId = mapInst.getStyle()?.layers?.find(l => l.type === 'symbol')?.id;
      mapInst.addLayer(
        {
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': getStoreState().activeBhuvanOpacity
          }
        },
        firstSymbolId 
      );
    }

    return () => {
       if (mapInst.getStyle() && mapInst.getLayer(layerId)) mapInst.removeLayer(layerId);
       if (mapInst.getStyle() && mapInst.getSource(sourceId)) mapInst.removeSource(sourceId);
    };
  }, [activeBhuvanLayer, isMapLoaded, styleLoaded, actions, getStoreState]);

  useEffect(() => {
    const mapInst = map.current;
    if (mapInst && isMapLoaded && styleLoaded && activeBhuvanLayer) {
      const layerId = 'bhuvan-layer';
      const { activeBhuvanOpacity } = getStoreState();
      if (mapInst.getStyle() && mapInst.getLayer(layerId)) {
        mapInst.setPaintProperty(layerId, 'raster-opacity', activeBhuvanOpacity);
      }
    }
  }, [getStoreState().activeBhuvanOpacity, activeBhuvanLayer, isMapLoaded, styleLoaded, getStoreState]);

  useEffect(() => {
    if (!isMapLoaded || !isThreeboxLoaded || !map.current) return;

    const mapInstance = map.current;

    if (mapInstance.getLayer('custom-threebox-layer')) return;

    // Initialize Threebox
    mapInstance.addLayer({
      id: 'custom-threebox-layer',
      type: 'custom',
      renderingMode: '3d',
      slot: 'middle',
      onAdd: function (map, mbxContext) {
        if (window.tb) return;

        // @ts-ignore
        if (window.Threebox) {
          // @ts-ignore
          window.tb = new window.Threebox(map, mbxContext, {
            defaultLights: true,
            passiveRendering: false
          });

          if (window.tb.renderer) {
            window.tb.renderer.autoClear = false;
            window.tb.renderer.autoClearColor = false;
            window.tb.renderer.autoClearDepth = false;
            window.tb.renderer.autoClearStencil = false;

            const gl = window.tb.renderer.getContext();
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.depthMask(true);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            // Shadows setup
            window.tb.renderer.shadowMap.enabled = true;
            window.tb.renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
          }

        }
      },
      render: function (gl, matrix) {
        if (window.tb) {
          try {
            window.tb.update();
          } catch (e) {
          }
        }
      },
    });

  }, [isMapLoaded, isThreeboxLoaded]);

  useEffect(() => {
    if (!window.tb || !isMapLoaded) return;

    vastuObjectsRef.current.forEach(obj => {
      try {
        window.tb.remove(obj);
      } catch (e) {
        console.warn('Failed to remove Vastu object', e);
      }
    });
    vastuObjectsRef.current = [];

    if (uiState?.showVastuCompass && plots.length > 0) {
      const THREE = window.tb.THREE || window.THREE;
      if (!THREE) return;

      plots.forEach(plot => {
        // Use centralized Vastu center calculation logic
        const trueCenter = getVastuCenter(plot.geometry);
        const centerCoords = trueCenter.geometry.coordinates;
        const center: [number, number] = [centerCoords[0], centerCoords[1]];

        const r = Math.sqrt(plot.area / Math.PI) * 0.5;

        const compassGroup = createShaktiChakraGroup(THREE, r);
        const compassName = 'vastu-compass-group';
        compassGroup.name = `${compassName}-${plot.id}`;

        // Get elevation at center
        let elevation = 0;
        if (map.current?.queryTerrainElevation) {
          elevation = map.current.queryTerrainElevation({ lng: center[0], lat: center[1] }) || 0;
        }

        // @ts-ignore
        const tbObj = window.tb.Object3D({
          obj: compassGroup,
          units: 'meters',
          anchor: 'center'
        }).setCoords([center[0], center[1], elevation + 0.5]);

        tbObj.name = compassGroup.name;

        window.tb.add(tbObj);
        vastuObjectsRef.current.push(tbObj);
      });
      window.tb.repaint();
    } else {
      window.tb.repaint();
    }
  }, [uiState?.showVastuCompass, plots, isMapLoaded]);



  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    markers.current.forEach(marker => marker.remove());
    markers.current = [];

    const amenities = activeProject?.locationData?.amenities;
    if (!amenities || amenities.length === 0) return;

    amenities.forEach((amenity: Amenity) => {
      const el = document.createElement('div');
      el.className = 'amenity-marker';
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      el.style.cursor = 'pointer';

      // Color based on category
      let color = '#888';
      if (amenity.category === 'transit') color = '#2196F3'; // Blue
      else if (amenity.category === 'school') color = '#FF9800'; // Orange
      else if (amenity.category === 'college') color = '#FF5722'; // Deep Orange
      else if (amenity.category === 'hospital') color = '#F44336'; // Red
      else if (amenity.category === 'park') color = '#4CAF50'; // Green
      else if (amenity.category === 'shopping') color = '#9C27B0'; // Purple
      else if (amenity.category === 'mall') color = '#673AB7'; // Deep Purple
      else if (amenity.category === 'restaurant') color = '#FFEB3B'; // Yellow
      else if (amenity.category === 'atm') color = '#009688'; // Teal
      else if (amenity.category === 'petrol_pump') color = '#607D8B'; // Blue Grey

      el.style.backgroundColor = color;

      const popup = new mapboxgl.Popup({ offset: 25 })
        .setHTML(`
          <div style="padding: 5px;">
            <strong style="font-size: 14px; color: #333;">${amenity.name}</strong><br/>
            <span style="color: #666; font-size: 12px; text-transform: capitalize;">
              ${amenity.category} • ${amenity.distance}m
            </span><br/>
            <span style="color: #999; font-size: 10px;">${amenity.address}</span>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(amenity.coordinates as [number, number])
        .setPopup(popup)
        .addTo(map.current!);

      markers.current.push(marker);
    });

  }, [isMapLoaded, activeProject?.locationData?.amenities]);


  const cleanupOverlays = useCallback(() => {
    if (!map.current) return;

    const heatmapId = 'solar-ground-heatmap';
    if (map.current.getLayer(heatmapId)) map.current.removeLayer(heatmapId);

    const wallLayerId = 'analysis-walls';
    const wallSourceId = 'analysis-walls-source';
    if (map.current.getLayer(wallLayerId)) map.current.removeLayer(wallLayerId);

    const roofLayerId = 'analysis-roofs';
    const roofSourceId = 'analysis-roofs-source';
    if (map.current.getLayer(roofLayerId)) map.current.removeLayer(roofLayerId);

    const windDirId = 'wind-direction';
    if (map.current.getLayer(windDirId)) map.current.removeLayer(windDirId);

    if (windStreamlineLayer.current && map.current.getLayer('wind-streamlines')) {
      map.current.removeLayer('wind-streamlines');
      windStreamlineLayer.current = null;
    }

    if (map.current.getSource(heatmapId)) map.current.removeSource(heatmapId);
    if (map.current.getSource(wallSourceId)) map.current.removeSource(wallSourceId);
    if (map.current.getSource(roofSourceId)) map.current.removeSource(roofSourceId);
    if (map.current.getSource(windDirId)) map.current.removeSource(windDirId);

    if (window.tb && window.tb.world) {
      const oldGroup = window.tb.world.getObjectByName('analysis-results-group');
      if (oldGroup) {
        window.tb.world.remove(oldGroup);
      }
      window.tb.world.children.forEach((child: any) => {
        if (child.name && child.name.startsWith('heatmap-overlay-')) {
          window.tb.world.remove(child);
        }
      });
    }
  }, []);

useEffect(() => {
    if (!map.current || !isMapLoaded || !mapCommand) return;

    if (mapCommand.type === 'flyTo') {
      map.current.flyTo({
        center: mapCommand.center,
        zoom: mapCommand.zoom || 15,
        essential: true,
        duration: 1500
      });

      useBuildingStore.setState({ mapCommand: null });
    }
  }, [mapCommand, isMapLoaded]);

  useEffect(() => {
    if (!isSimulatorEnabled) {
      setAnalysisMode('none');
      cleanupOverlays();
    }
  }, [isSimulatorEnabled, setAnalysisMode, cleanupOverlays]);


  const resetBuildingColors = (forcedColor?: string) => {
    if (!map.current) return;
    const { uiState } = getStoreState();

    plots.forEach(plot => {
      plot.buildings.forEach(building => {
        const colorToApply = forcedColor || getBuildingColor(building.intendedUse);

        building.floors.forEach(floor => {
          const layerId = `building-floor-fill-${floor.id}-${building.id}`;

          if (map.current!.getLayer(layerId)) {
            if (forcedColor) {
              try {
                map.current!.setPaintProperty(layerId, 'fill-extrusion-pattern', undefined as any);
              } catch (e) {
                try { map.current!.setPaintProperty(layerId, 'fill-extrusion-pattern', ''); } catch (e2) {}
              }
              try {
                map.current!.setPaintProperty(layerId, 'fill-extrusion-color', colorToApply);
              } catch (e) {}
            } else {
              const isBasementOrParking = (floor.level !== undefined && floor.level < 0) || (floor.type || '').toLowerCase() === 'parking';
              const usePattern = !uiState.ghostMode && !isBasementOrParking && analysisMode === 'none';
              if (usePattern) {
                const floorUse = floor.intendedUse || building.intendedUse;
                const userOpacity = building.opacity !== undefined ? building.opacity : 1.0;
                const opacityStr = userOpacity.toFixed(2);
                const isBuildingSelected = showSelectionHighlight && selectedObjectId && selectedObjectId.id === building.id && selectedObjectId.type === 'Building';
                const patternName = `texture-${floorUse}-${opacityStr}${isBuildingSelected ? '-selected' : ''}`;
                try {
                  map.current!.setPaintProperty(layerId, 'fill-extrusion-pattern', patternName);
                  map.current!.setPaintProperty(layerId, 'fill-extrusion-color', '#ffffff');
                } catch (e) {}
              } else {
                try {
                  map.current!.setPaintProperty(layerId, 'fill-extrusion-pattern', undefined as any);
                } catch (e) {
                  try { map.current!.setPaintProperty(layerId, 'fill-extrusion-pattern', ''); } catch (e2) {}
                }
                try {
                  map.current!.setPaintProperty(layerId, 'fill-extrusion-color', colorToApply);
                } catch (e) {}
              }
            }
          }
        });
      });
    });
  };

  useEffect(() => {
    if (!isMapLoaded) return;

    if (analysisMode === 'none') {
      cleanupOverlays();
      resetBuildingColors();
      if (window.tb) window.tb.repaint();
      return;
    }

    const timer = setTimeout(async () => {
      const allBuildings = plots.flatMap(p => p.buildings);

      if (allBuildings.length === 0) {
        console.warn('[MAP EDITOR] No buildings found for analysis');
        return;
      }

      console.log(`[MAP EDITOR] Running ${analysisMode} on ${allBuildings.length} buildings...`);

      cleanupOverlays();
      resetBuildingColors('#eeeeee');

      // ── Fetch weather data ──
      let weatherData: any = null;
      if (plots.length > 0 && plots[0].geometry) {
        try {
          const plotCentroid = turf.centroid(plots[0].geometry);
          const [pLng, pLat] = plotCentroid.geometry.coordinates;
          weatherData = await fetchWeatherData(pLat, pLng, solarDate);
          console.log('[MAP EDITOR] Weather data:', weatherData.isLive ? '🟢 LIVE/ERA5' : '🟡 ESTIMATED', 'for', solarDate.toDateString());
        } catch (err) {
          console.warn('[MAP EDITOR] Weather fetch failed, using null:', err);
        }
      }

      // ── PER-FACE WALL ANALYSIS ──
      const wallFeatures = await runWallAnalysis(allBuildings, allBuildings, analysisMode, solarDate, activeGreenRegulations, weatherData);

      console.log('[MAP EDITOR] Wall Analysis complete, features:', { count: wallFeatures.features.length });

      const wallLayerId = 'analysis-walls';
      const wallSourceId = 'analysis-walls-source';

      if (map.current) {
        if (map.current.getSource(wallSourceId)) {
          (map.current.getSource(wallSourceId) as mapboxgl.GeoJSONSource).setData(wallFeatures);
        } else {
          map.current.addSource(wallSourceId, {
            type: 'geojson',
            data: wallFeatures
          });
          map.current.addLayer({
            id: wallLayerId,
            type: 'fill-extrusion',
            source: wallSourceId,
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'base_height'],
              'fill-extrusion-opacity': 0.85,
              'fill-extrusion-vertical-gradient': true
            }
          }, LABELS_LAYER_ID);
        }
      }

      // ── GROUND HEATMAP ANALYSIS ──
      if (map.current && plots.length > 0) {
        try {
          console.log('[MAP EDITOR] Running Ground Analysis...');
          
          const groundPoints = await runGroundAnalysis(
            plots[0].geometry,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations,
            weatherData
          );

          const buildingResults = await runVisualAnalysis(
            allBuildings,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations,
            weatherData
          );

          // ── Calculate Aggregate Stats and Update Project State ──
          const stats = calculateAggregateStats(buildingResults, analysisMode, allBuildings, activeGreenRegulations);
          console.log('[MAP EDITOR] Analysis Stats:', stats);

          if (analysisMode === 'wind') {
            actions.updateSimulationResults({ wind: { compliantArea: stats.compliantArea, avgSpeed: stats.avgValue } });
          } else if (analysisMode === 'sun-hours') {
            actions.updateSimulationResults({ sun: { compliantArea: stats.compliantArea, avgHours: stats.avgValue } });
          } else if (analysisMode === 'daylight') {
            actions.updateSimulationResults({ sun: { compliantArea: stats.compliantArea, avgHours: stats.avgValue } });
          }
          // Energy, Mobility, Resilience: log stats (not stored in project state yet)
          if (['energy', 'mobility', 'resilience'].includes(analysisMode)) {
            console.log(`[MAP EDITOR] ${analysisMode.toUpperCase()} Stats:`, stats);
          }

          // ── Apply analysis colors to building roofs via overlay layer ──
          // We create a separate overlay layer (like analysis-walls) because
          // Mapbox GL JS cannot clear fill-extrusion-pattern once set.
          if (buildingResults.size > 0 && map.current) {
            const roofFeatures: any[] = [];
            const ROOF_THICKNESS = 0.3; // thin cap on top of building

            buildingResults.forEach((result: any, buildingId: string) => {
              const building = allBuildings.find(b => b.id === buildingId);
              if (!building) return;
              
              const analysisColor = result.roofColor || result.color || '#eeeeee';
              const buildingHeight = building.height || (building.floors?.reduce((s: number, f: any) => s + f.height, 0)) || 10;
              const baseHeight = building.baseHeight || 0;
              const roofTop = baseHeight + buildingHeight;
              const roofBase = roofTop - ROOF_THICKNESS;

              // Create a thin extrusion at the roof level with analysis color
              roofFeatures.push({
                type: 'Feature',
                geometry: building.geometry.geometry || building.geometry,
                properties: {
                  color: analysisColor,
                  height: roofTop + 0.1, // Slightly above to avoid z-fighting
                  base_height: roofBase,
                  buildingId: buildingId
                }
              });
            });

            const roofLayerId = 'analysis-roofs';
            const roofSourceId = 'analysis-roofs-source';
            const roofCollection = { type: 'FeatureCollection', features: roofFeatures };

            if (map.current.getSource(roofSourceId)) {
              (map.current.getSource(roofSourceId) as mapboxgl.GeoJSONSource).setData(roofCollection as any);
            } else {
              map.current.addSource(roofSourceId, {
                type: 'geojson',
                data: roofCollection as any
              });
              map.current.addLayer({
                id: roofLayerId,
                type: 'fill-extrusion',
                source: roofSourceId,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': 0.9
                }
              }, LABELS_LAYER_ID);
            }

            console.log(`[MAP EDITOR] Applied analysis roof overlay to ${roofFeatures.length} buildings`);
          }

          // ── Apply colors to ground heatmap ──
          const heatmapId = 'solar-ground-heatmap';

          if (groundPoints && groundPoints.features.length > 0) {
            if (map.current.getSource(heatmapId)) {
              (map.current.getSource(heatmapId) as GeoJSONSource).setData(groundPoints);
            } else {
              map.current.addSource(heatmapId, {
                type: 'geojson',
                data: groundPoints
              });
            }

            if (!map.current.getLayer(heatmapId)) {
              let colorRamp: any[];

              if (analysisMode === 'wind' || analysisMode === 'sun-hours' || analysisMode === 'daylight') {
                // Compliance Ramp: Red (Low/Bad) -> Yellow (Medium) -> Green (High/Good)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(239, 68, 68, 0)',   // Transparent red
                  0.2, '#ef4444',               // red-500 (Stagnant/Shady/Dark)
                  0.4, '#f59e0b',               // amber-500 (Fair)
                  0.6, '#eab308',               // yellow-500 (Moderate)
                  0.8, '#10b981',               // emerald-500 (Good)
                  1, '#00cc00'                  // bright green (Excellent)
                ];
              } else if (analysisMode === 'energy') {
                // Thermal Ramp: Blue (Cool/Efficient) -> Yellow -> Red (Hot/Inefficient)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(59, 130, 246, 0)',   // Transparent blue
                  0.2, '#3b82f6',               // blue-500 (Cool/Efficient)
                  0.4, '#06b6d4',               // cyan-500
                  0.6, '#f59e0b',               // amber-500 (Warm)
                  0.8, '#ef4444',               // red-500 (Hot)
                  1, '#991b1b'                  // red-800 (Very Hot)
                ];
              } else if (analysisMode === 'mobility') {
                // Traffic Ramp: Green (Low Traffic) -> Yellow -> Red (High Traffic)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(34, 197, 94, 0)',    // Transparent green
                  0.2, '#22c55e',               // green-500 (Low traffic)
                  0.4, '#84cc16',               // lime-500
                  0.6, '#f59e0b',               // amber-500 (Moderate)
                  0.8, '#f97316',               // orange-500
                  1, '#ef4444'                  // red-500 (High traffic)
                ];
              } else if (analysisMode === 'resilience') {
                // Risk Ramp: Green (Safe) -> Yellow -> Red (High Risk)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(34, 197, 94, 0)',    // Transparent green
                  0.2, '#22c55e',               // green-500 (Safe)
                  0.4, '#84cc16',               // lime-500
                  0.6, '#eab308',               // yellow-500 (Moderate risk)
                  0.8, '#ef4444',               // red-500 (High risk)
                  1, '#991b1b'                  // red-800 (Extreme risk)
                ];
              } else {
                // Standard Thermal Heatmap: Blue (Low) -> Red (High)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(0, 0, 255, 0)',
                  0.2, '#3b82f6',               // blue-500
                  0.4, '#10b981',               // emerald-500
                  0.6, '#f59e0b',               // amber-500
                  0.8, '#ef4444',               // red-500
                  1, '#b91c1c'                  // red-700
                ];
              }

              // Find the lowest 3D building layer to insert the heatmap beneath it
              let insertBeforeId = LABELS_LAYER_ID;
              const styleLayers = map.current.getStyle().layers;
              if (styleLayers) {
                const firstBuildingLayer = styleLayers.find((l: any) => 
                  l.id.startsWith('building-') || 
                  l.id === 'analysis-walls' ||
                  l.id.startsWith('slab-') ||
                  l.id.startsWith('core-') ||
                  l.id.startsWith('util-')
                );
                if (firstBuildingLayer && firstBuildingLayer.id) {
                  insertBeforeId = firstBuildingLayer.id;
                }
              }

              map.current.addLayer({
                id: heatmapId,
                type: 'heatmap',
                source: heatmapId,
                paint: {
                  'heatmap-weight': ['get', 'weight'] as any,
                  'heatmap-intensity': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 0.7,
                    18, 1.8
                  ] as any,
                  'heatmap-color': colorRamp as any,
                  'heatmap-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 20,
                    20, 40
                  ] as any,
                  'heatmap-opacity': 0.7
                }
              }, insertBeforeId); // Place strictly below buildings
            }

            // --- WIND STREAMLINES (Animated) ---
            if (analysisMode === 'wind') {
              const windDirId = 'wind-direction';
              if (map.current.getLayer(windDirId)) {
                map.current.removeLayer(windDirId);
              }
              const currentHour = solarDate.getHours();
              const windDir = (weatherData && weatherData.hourly) ? weatherData.hourly.windDirection[currentHour] : 45;

              if (!windStreamlineLayer.current) {
                windStreamlineLayer.current = new WindStreamlineLayer('wind-streamlines');

                if (!map.current.getLayer('wind-streamlines')) {
                  map.current.addLayer(windStreamlineLayer.current as any, LABELS_LAYER_ID);
                }

                windStreamlineLayer.current.initialize(allBuildings, windDir);
              } else {
                windStreamlineLayer.current.updateWindDirection(windDir);
              }

              const updateBounds = () => {
                if (windStreamlineLayer.current) {
                  windStreamlineLayer.current.updateBounds();
                }
              };

              map.current.on('moveend', updateBounds);
              map.current.on('zoomend', updateBounds);
            }
          }
        } catch (e) {
          console.warn('[MAP EDITOR] Ground Analysis Failed', e);
        }
      }

    }, 200);

    return () => clearTimeout(timer);
  }, [analysisMode, solarDate, plots, isMapLoaded, activeGreenRegulations]);

  // Solar Lighting Effect
  useEffect(() => {
    if (!isMapLoaded) return;
    const mapInstance = map.current;
    if (!mapInstance) return;

    const updateThreeLights = (azimuth: number, altitude: number, enabled: boolean) => {
      if (!window.tb) return;

      const THREE = window.tb.THREE || window.THREE;
      if (!THREE) return;

      const scene = window.tb.world;
      if (!scene) return;

      const LIGHT_GROUP_NAME = 'simulation-lights-group';
      let lightGroup = scene.getObjectByName(LIGHT_GROUP_NAME);

      if (!lightGroup) {
        lightGroup = new THREE.Group();
        lightGroup.name = LIGHT_GROUP_NAME;
        scene.add(lightGroup);
      }

      lightGroup.clear();

      if (enabled) {
        const dist = 1000;
        const x = dist * Math.sin(azimuth) * Math.cos(altitude);
        const y = dist * -1 * Math.cos(azimuth) * Math.cos(altitude);
        const z = dist * Math.sin(altitude);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(x, y, z);
        sunLight.target.position.set(0, 0, 0);
        sunLight.castShadow = true;

        // Optimize Shadows
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        const d = 1000;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;

        lightGroup.add(sunLight);
        lightGroup.add(sunLight.target);

        // Ambient
        const ambient = new THREE.AmbientLight(0x404040, 0.4);
        lightGroup.add(ambient);

      } else {
      }

      if (window.tb) window.tb.repaint();
    };


    if (isSimulatorEnabled) {
      const center = mapInstance.getCenter();
      const { getSunPosition } = require('@/lib/sun-utils');
      const { azimuth, altitude } = getSunPosition(solarDate, center.lat, center.lng);

      const azDeg = (azimuth * 180 / Math.PI + 180) % 360;
      const polarDeg = 90 - (altitude * 180 / Math.PI);
      const safePolar = Math.max(0, Math.min(90, polarDeg));

      const hour = solarDate.getHours();
      let preset = 'day';
      if (hour >= 5 && hour < 8) preset = 'dawn';
      else if (hour >= 8 && hour < 17) preset = 'day';
      else if (hour >= 17 && hour < 20) preset = 'dusk';
      else preset = 'night';

      if (mapInstance.getStyle()?.name === 'Mapbox Standard') {
        try {
          mapInstance.setConfigProperty('basemap', 'lightPreset', preset);
          mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
        } catch (e) {
          console.warn('Failed to set lightPreset', e);
        }
      } else {
        try {
          // @ts-ignore
          if (mapInstance.setLights) {
          }
        } catch (e) { }
      }

      updateThreeLights(azimuth, altitude, true);

    } else {
      // Reset Default
      if (mapInstance.getStyle()?.name === 'Mapbox Standard') {
        try {
          mapInstance.setConfigProperty('basemap', 'lightPreset', 'day');
        } catch (e) { }
      }
      updateThreeLights(0, 0, false);
    }

  }, [isSimulatorEnabled, solarDate, isMapLoaded]);




  const buildingProps = useMemo(() =>
    plots.flatMap(p => p.buildings.map(b => `${b.id}-${b.opacity}-${b.height}-${b.numFloors}`)).join(','),
    [plots]
  );

  useEffect(() => {
    if (!isMapLoaded || !map.current) return;
    const mapInstance = map.current;
    if (!mapInstance.isStyleLoaded()) return;

    markers.current.forEach(m => m.remove());
    markers.current = [];

    if (drawingState.isDrawing) {
      drawingPoints.forEach((point, index) => {
        const isFirstPoint = index === 0;
        const marker = new mapboxgl.Marker({ color: isFirstPoint ? FIRST_POINT_COLOR : primaryColor }).setLngLat(point as LngLatLike).addTo(mapInstance);
        markers.current.push(marker);
      });

      const outlineSource = mapInstance.getSource(DRAWING_OUTLINE_SOURCE_ID) as GeoJSONSource;
      const roadFillSource = mapInstance.getSource('drawing-road-fill') as GeoJSONSource;
      let outlineData: any = turf.featureCollection([]);
      let roadFillData: any = turf.featureCollection([]);

      if (drawingPoints.length > 0) {
        if (drawingState.objectType === 'Road') {
          if (drawingPoints.length === 1) {
            outlineData = turf.featureCollection([
              turf.point(drawingPoints[0])
            ]);
          } else if (drawingPoints.length >= 2) {
            const line = turf.lineString(drawingPoints);
            const buffered = turf.buffer(line, (drawingState.roadWidth / 2), { units: 'meters' });
            outlineData = turf.featureCollection([line]);
            roadFillData = turf.featureCollection(buffered ? [buffered] : []);
          }
        } else {
          if (drawingPoints.length > 1) {
            outlineData = turf.lineString(drawingPoints);
          }
        }
      }

      if (outlineSource) {
        outlineSource.setData(outlineData);
      } else {
        mapInstance.addSource(DRAWING_OUTLINE_SOURCE_ID, { type: 'geojson', data: outlineData });
        mapInstance.addLayer({
          id: DRAWING_OUTLINE_LAYER_ID,
          type: 'line',
          source: DRAWING_OUTLINE_SOURCE_ID,
          paint: { 'line-color': '#F5A623', 'line-width': 2, 'line-dasharray': [2, 1] },
        });
      }

      if (roadFillSource) {
        roadFillSource.setData(roadFillData);
      } else if (drawingState.objectType === 'Road') {
        mapInstance.addSource('drawing-road-fill', { type: 'geojson', data: roadFillData });
        mapInstance.addLayer({
          id: 'drawing-road-fill-layer',
          type: 'fill',
          source: 'drawing-road-fill',
          paint: { 'fill-color': '#546E7A', 'fill-opacity': 0.6, 'fill-outline-color': '#F5A623' },
        });
      }
    } else {
      if (mapInstance.getLayer('drawing-road-fill-layer')) {
        mapInstance.removeLayer('drawing-road-fill-layer');
      }
      if (mapInstance.getSource('drawing-road-fill')) {
        mapInstance.removeSource('drawing-road-fill');
      }
      if (mapInstance.getLayer(DRAWING_OUTLINE_LAYER_ID)) {
        mapInstance.removeLayer(DRAWING_OUTLINE_LAYER_ID);
      }
      if (mapInstance.getSource(DRAWING_OUTLINE_SOURCE_ID)) {
        mapInstance.removeSource(DRAWING_OUTLINE_SOURCE_ID);
      }
    }
  }, [drawingState.isDrawing, drawingPoints, isMapLoaded, primaryColor]);


  useEffect(() => {
    if (plots.length > 0) {
      console.log(`[MapEditor] ðŸ•µï¸ Plots Data Updated. Count: ${plots.length}`);
      const p0 = plots[0];
      console.log(`[MapEditor] Plot[0] Preview:`, {
        id: p0.id,
        geometryType: p0.geometry?.type,
        coordsSample: (p0.geometry as any)?.coordinates ? 'Present' : 'Missing',
        isGeometryObject: typeof p0.geometry === 'object',
        geometryKeys: p0.geometry ? Object.keys(p0.geometry) : []
      });
    } else {
      console.log(`[MapEditor] Plots array is empty.`);
    }
  }, [plots, uiState.ghostMode, componentVisibility]);
  
  // Selection Highlight Effect
  useEffect(() => {
    if (!isMapLoaded || !styleLoaded || !map.current) return;
    const mapInstance = map.current;

    if (!selectedObjectId) {
      const source = mapInstance.getSource(SELECTION_HIGHLIGHT_SOURCE_ID) as GeoJSONSource;
      if (source) source.setData(turf.featureCollection([]));
      return;
    }

    // Find the geometry for the selected object
    let geometry: any = null;
    const { id, type } = selectedObjectId;

    // Search in plots and their children
    for (const plot of plots) {
      if (type === 'Plot' && plot.id === id) {
        geometry = plot.geometry;
        break;
      }
      
      const objects = [
        ...plot.buildings, 
        ...plot.greenAreas, 
        ...plot.parkingAreas, 
        ...plot.buildableAreas,
        ...(plot.utilityAreas || [])
      ];
      
      const found = objects.find(obj => obj.id === id);
      if (found) {
        geometry = found.geometry;
        break;
      }

      // Search in internal building objects
      for (const b of plot.buildings) {
        const internals = [...(b.internalUtilities || []), ...(b.cores || []), ...(b.units || [])];
        const foundInternal = internals.find((obj: any) => obj.id === id);
        if (foundInternal) {
          geometry = foundInternal.geometry;
          break;
        }
      }
      if (geometry) break;
    }

    if (!geometry) return;

    // Ensure we have a feature collection for the source
    const featureData = turf.feature(geometry.type === 'Feature' ? geometry.geometry : geometry);

    let source = mapInstance.getSource(SELECTION_HIGHLIGHT_SOURCE_ID) as GeoJSONSource;
    if (!source) {
      mapInstance.addSource(SELECTION_HIGHLIGHT_SOURCE_ID, {
        type: 'geojson',
        data: turf.featureCollection([featureData])
      });
    } else {
      source.setData(turf.featureCollection([featureData]));
    }

    if (!mapInstance.getLayer(SELECTION_HIGHLIGHT_LAYER_ID)) {
      mapInstance.addLayer({
        id: SELECTION_HIGHLIGHT_LAYER_ID,
        type: 'line',
        source: SELECTION_HIGHLIGHT_SOURCE_ID,
        paint: {
          'line-color': '#F5A623',
          'line-width': 4,
          'line-opacity': 0.8,
          'line-blur': 1
        }
      }, LABELS_LAYER_ID);
    }

    // Set a timer to clear the highlight after 3 seconds
    const timer = setTimeout(() => {
      const s = mapInstance.getSource(SELECTION_HIGHLIGHT_SOURCE_ID) as GeoJSONSource;
      if (s) s.setData(turf.featureCollection([]));
    }, 3000);

    return () => clearTimeout(timer);
  }, [selectedObjectId, plots, isMapLoaded, styleLoaded]);

  useEffect(() => {

    if (!isMapLoaded || !styleLoaded || !map.current) {
      if (map.current && map.current.isStyleLoaded() && !styleLoaded) {
        setStyleLoaded(true);
      } else {
        console.warn("[MapEditor] Render Effect SKIPPED due to map state.");
        return;
      }
    }
    const mapInstance = map.current;

    // ...rotation tool overlay hiding removed...

    if (mapInstance.getLayer('building')) {
      mapInstance.setLayoutProperty('building', 'visibility', 'none');
    }
    if (mapInstance.getLayer('3d-buildings')) {
      mapInstance.setLayoutProperty('3d-buildings', 'visibility', 'none');
    }

    const renderedIds = new Set<string>();
    const anyComponentVisible = Object.values(componentVisibility).some(v => v);

    const existingLayers = mapInstance.getStyle()?.layers || [];
    existingLayers.forEach(layer => {
      const layerId = layer.id;
      if (layerId.startsWith('core-') || layerId.startsWith('unit-')) {
        if (mapInstance.getLayer(layerId)) {
          try {
            mapInstance.removeLayer(layerId);
          } catch (e) {
            console.warn('[PRE-CLEANUP] Failed to remove layer:', layerId, e);
          }
        }
      }
    });

    const allLabels: Feature<Point, { label: string; id: string }>[] = [];

    if (!mapInstance.getSource(LABELS_SOURCE_ID)) {
      mapInstance.addSource(LABELS_SOURCE_ID, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }
    if (!mapInstance.getLayer(LABELS_LAYER_ID)) {
      mapInstance.addLayer({
        id: LABELS_LAYER_ID,
        type: 'symbol',
        source: LABELS_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 14,
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.5,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
          'text-opacity': false ? 0 : ['case',
            ['boolean', ['feature-state', 'hover'], false], 1,
            ['==', ['get', 'linkedId'], 'SELECTED_ID_PLACEHOLDER'], 1,
            0
          ]
        },
      });
    }

    if (mapInstance.getLayer(LABELS_LAYER_ID)) {
      mapInstance.setPaintProperty(LABELS_LAYER_ID, 'text-opacity', false ? 0 : [
        'case',
        ['==', ['get', 'linkedId'], hoveredId || ''], 1,
        0
      ]);
    }


    plots.forEach(plot => {
      if (plot.centroid) {
        allLabels.push(
          turf.point(plot.centroid.geometry.coordinates, {
            label: `${plot.area.toFixed(0)} m²`,
            id: `plot-label-${plot.id}`,
            linkedId: plot.id 
          })
        );
      }

      // --- RENDER UTILITIES & PARKING FIRST ---

      // Green Areas (Moved to Bottom Layer)
      plot.greenAreas.forEach(area => {
        const areaId = area.id;
        renderedIds.add(areaId);

        let source = mapInstance.getSource(areaId) as GeoJSONSource;

        if (!area.geometry) return;

        if (source) {
          source.setData(area.geometry);
        } else {
          mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });
        }

        if (!mapInstance.getLayer(areaId)) {
          const isSelected = selectedObjectId && selectedObjectId.id === area.id && selectedObjectId.type === 'GreenArea';
          const selectionColor = '#00fbff';

          mapInstance.addLayer({
            id: areaId,
            type: 'fill',
            source: areaId,
            paint: {
              'fill-color': isSelected ? selectionColor : '#4ade80',
              'fill-opacity': isSelected ? 0.8 : 0.5,
              'fill-outline-color': isSelected ? selectionColor : '#22c55e'
            },
            metadata: {
              id: area.id,
              type: 'GreenArea'
            }
          }, LABELS_LAYER_ID);
        } else {
          const isSelected = selectedObjectId && selectedObjectId.id === area.id && selectedObjectId.type === 'GreenArea';
          const selectionColor = '#00fbff';
          mapInstance.setPaintProperty(areaId, 'fill-color', isSelected ? selectionColor : '#4ade80');
          mapInstance.setPaintProperty(areaId, 'fill-opacity', isSelected ? 0.8 : 0.5);
          mapInstance.setPaintProperty(areaId, 'fill-outline-color', isSelected ? selectionColor : '#22c55e');
        }
      });

      // Buildable Areas (Transparent Orange)
      plot.buildableAreas.forEach(area => {
        const areaId = `buildable-area-${area.id}`;
        renderedIds.add(areaId);

        let source = mapInstance.getSource(areaId) as GeoJSONSource;

        if (!area.geometry) return;

        if (source) {
          source.setData(area.geometry as any);
        } else {
          mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry as any });
        }

        const isSelected = selectedObjectId && selectedObjectId.id === area.id && selectedObjectId.type === 'BuildableArea';
        const selectionColor = '#00fbff';

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({
            id: areaId,
            type: 'fill',
            source: areaId,
            paint: {
              'fill-color': isSelected ? selectionColor : '#f59e0b',
              'fill-opacity': isSelected ? 0.3 : 0.1,
              'fill-outline-color': isSelected ? selectionColor : '#b45309'
            },
            metadata: {
              id: area.id,
              type: 'BuildableArea'
            }
          } as any, LABELS_LAYER_ID);

          // Add a dashed border layer for better visibility
          const borderId = `buildable-area-border-${area.id}`;
          renderedIds.add(borderId);
          mapInstance.addLayer({
            id: borderId,
            type: 'line',
            source: areaId,
            paint: {
              'line-color': isSelected ? selectionColor : '#b45309',
              'line-width': isSelected ? 3 : 2,
              'line-dasharray': [2, 2]
            }
          }, LABELS_LAYER_ID);

        } else {
          mapInstance.setPaintProperty(areaId, 'fill-color', isSelected ? selectionColor : '#f59e0b');
          mapInstance.setPaintProperty(areaId, 'fill-opacity', isSelected ? 0.3 : 0.1);
          mapInstance.setPaintProperty(areaId, 'fill-outline-color', isSelected ? selectionColor : '#b45309');

          const borderId = `buildable-area-border-${area.id}`;
          if (mapInstance.getLayer(borderId)) {
            mapInstance.setPaintProperty(borderId, 'line-color', isSelected ? selectionColor : '#b45309');
            mapInstance.setPaintProperty(borderId, 'line-width', isSelected ? 3 : 2);
          }
        }
      });

      //Parking Areas (Surface & Basements)
      plot.parkingAreas.forEach(area => {
        const areaId = `parking-area-${area.id}`;
        if (!area.geometry) return;

        const areaData: Feature<Polygon> = {
          type: 'Feature',
          geometry: (area.geometry as any).type === 'Feature' ? (area.geometry as any).geometry : area.geometry,
          properties: {
            id: area.id,
            name: area.name,
            type: area.type,
            area: area.area,
            capacity: area.capacity
          }
        };

        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(areaData);
        else mapInstance.addSource(areaId, { type: 'geojson', data: areaData });

        const existingRef = mapInstance.getLayer(areaId);
        const isBasement = (area.type === 'Basement');
        const desiredType = isBasement ? 'line' : 'fill';

        if (existingRef && existingRef.type !== desiredType) {
          mapInstance.removeLayer(areaId);
        }

        if (!mapInstance.getLayer(areaId)) {
          if (isBasement) {
            mapInstance.addLayer({
              id: areaId,
              type: 'line',
              source: areaId,
              paint: {
                'line-color': '#1a202c',
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7
              }
            }, LABELS_LAYER_ID);
          } else {
            const isSelected = selectedObjectId && selectedObjectId.id === area.id && selectedObjectId.type === 'ParkingArea';
            const selectionColor = '#00fbff';

            mapInstance.addLayer({
              id: areaId,
              type: 'fill',
              source: areaId,
              paint: {
                'fill-color': isSelected ? selectionColor : '#607D8B',
                'fill-opacity': isSelected ? 0.8 : 0.5,
                'fill-outline-color': isSelected ? selectionColor : '#455A64'
              },
              metadata: {
                id: area.id,
                type: 'ParkingArea'
              }
            }, LABELS_LAYER_ID);
          }
        } else {
          if (!isBasement) {
            const isSelected = selectedObjectId && selectedObjectId.id === area.id && selectedObjectId.type === 'ParkingArea';
            const selectionColor = '#00fbff';
            mapInstance.setPaintProperty(areaId, 'fill-color', isSelected ? selectionColor : '#607D8B');
            mapInstance.setPaintProperty(areaId, 'fill-opacity', isSelected ? 0.8 : 0.5);
            mapInstance.setPaintProperty(areaId, 'fill-outline-color', isSelected ? selectionColor : '#455A64');
          }
        }
      });

      const utilitiesToRender = [...(plot.utilityAreas || [])];

      utilitiesToRender.forEach(u => {
        const areaId = `utility-area-${u.id}`;
        const centerlineId = `${areaId}-centerline`;
        const isVisible = u.visible !== false;

        renderedIds.add(areaId);
        renderedIds.add(`utility-area-label-${u.id}`);

        if (!u.geometry) return;

        const featureData = {
          type: 'Feature',
          geometry: (u.geometry as any).type === 'Feature' ? (u.geometry as any).geometry : u.geometry,
          properties: {
            id: u.id,
            name: u.name,
            type: u.type,
            area: u.area,
            targetArea: u.targetArea
          }
        };

        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(featureData as any);
        else mapInstance.addSource(areaId, { type: 'geojson', data: featureData as any });

        let color = '#718096';
        const typeStr = (u.type || '').toLowerCase();

        if (typeStr.includes('stp')) color = '#9C27B0';
        else if (typeStr.includes('wtp') || typeStr.includes('water')) color = '#2196F3';
        else if (typeStr.includes('electrical')) color = '#F44336';
        else if (typeStr.includes('fire')) color = '#E91E63';
        else if (typeStr.includes('hvac')) color = '#FF9800';
        else if (typeStr.includes('gas')) color = '#795548';
        else if (typeStr.includes('dg') || typeStr.includes('transformer')) color = '#3A4F2E'; // Olive Green
        else if (typeStr.includes('road')) color = '#546E7A';
        else if (typeStr.includes('solar')) color = '#1A237E'; // Solar Indigo
        else if (typeStr.includes('waste') || typeStr.includes('owc')) color = '#8D6E63'; // Brown
        else if (typeStr.includes('admin')) color = '#FDD835'; // Yellow

        const isRoad = u.type === 'Roads' || u.type === 'AppRoads' as any;

        if (!mapInstance.getLayer(areaId)) {
          const isSelected = selectedObjectId && selectedObjectId.id === u.id && selectedObjectId.type === 'UtilityArea';
          const selectionColor = '#00fbff';

          if (isRoad) {
            mapInstance.addLayer({
              id: areaId,
              type: 'fill',
              source: areaId,
              layout: { 'visibility': isVisible ? 'visible' : 'none' },
              paint: {
                'fill-color': isSelected ? selectionColor : color,
                'fill-opacity': isSelected ? 0.9 : 0.8,
                'fill-outline-color': isSelected ? selectionColor : '#2c3e50'
              },
              metadata: {
                id: u.id,
                type: 'UtilityArea'
              }
            }, LABELS_LAYER_ID);

            renderedIds.add(centerlineId);
            if (!mapInstance.getLayer(centerlineId)) {
              mapInstance.addLayer({
                id: centerlineId,
                type: 'line',
                source: areaId,
                layout: { 'visibility': isVisible ? 'visible' : 'none' },
                paint: {
                  'line-color': '#ffffff',
                  'line-width': 1,
                  'line-dasharray': [5, 5],
                  'line-opacity': 0.5
                }
              }, LABELS_LAYER_ID);
            }
          } else {
            const isSelected = selectedObjectId && selectedObjectId.id === u.id && selectedObjectId.type === 'UtilityArea';
            const selectionColor = '#00fbff';

            mapInstance.addLayer({
              id: areaId,
              type: 'fill-extrusion',
              source: areaId,
              layout: { 'visibility': isVisible ? 'visible' : 'none' },
              paint: {
                'fill-extrusion-color': isSelected ? selectionColor : color,
                'fill-extrusion-height': u.type === 'Solar PV' as any ? 3.5 : 2.5,
                'fill-extrusion-opacity': isSelected ? 0.9 : 0.7,
                'fill-extrusion-base': u.type === 'Solar PV' as any ? 3.0 : 0
              },
              metadata: {
                id: u.id,
                type: 'UtilityArea'
              }
            }, LABELS_LAYER_ID);
          }
        } else {
          const isSelected = selectedObjectId && selectedObjectId.id === u.id && selectedObjectId.type === 'UtilityArea';
          const selectionColor = '#00fbff';

          if (isRoad) {
            if (mapInstance.getLayer(areaId)?.type === 'fill') {
              mapInstance.setPaintProperty(areaId, 'fill-color', isSelected ? selectionColor : color);
              mapInstance.setPaintProperty(areaId, 'fill-opacity', isSelected ? 0.9 : 0.8);
              mapInstance.setPaintProperty(areaId, 'fill-outline-color', isSelected ? selectionColor : '#2c3e50');
            }
          } else {
            if (mapInstance.getLayer(areaId)?.type === 'fill-extrusion') {
              mapInstance.setPaintProperty(areaId, 'fill-extrusion-color', isSelected ? selectionColor : color);
              mapInstance.setPaintProperty(areaId, 'fill-extrusion-opacity', isSelected ? 0.9 : 0.7);
              mapInstance.setPaintProperty(areaId, 'fill-extrusion-base', u.type === 'Solar PV' as any ? 3.0 : 0);
            }
          }
          try {
            mapInstance.setLayoutProperty(areaId, 'visibility', isVisible ? 'visible' : 'none');
            if (mapInstance.getLayer(centerlineId)) {
              mapInstance.setLayoutProperty(centerlineId, 'visibility', isVisible ? 'visible' : 'none');
            }
          } catch (e) {
          }
        }
      });

      plot.buildings.forEach(building => {
        if (building.centroid) {
          let labelText = `${building.name}\n${building.intendedUse}\n${building.area.toFixed(0)} m²`;

          allLabels.push(
            turf.point(building.centroid.geometry.coordinates, {
              label: labelText,
              id: `building-label-${building.id}`,
              linkedId: building.id
            })
          );
        }

        if (building.floors && building.floors.length > 0) {
          const basementFloors = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || f.type === 'Parking'
          );
          const superstructureFloors = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || f.type === 'Parking')
          );

          let floorsToRender = building.floors.filter(f => {
            if (f.type === 'Utility') return false;

            const isBasement = (f.level !== undefined && f.level < 0) || f.type === 'Parking';
            if (uiState.ghostMode || componentVisibility.basements) {
              if (isBasement) {
                return componentVisibility.basements;
              }
              return true;
            }

            return !isBasement;
          });

          floorsToRender = [...floorsToRender].sort((a, b) => {
            const aLevel = a.level ?? (a.type === 'Parking' ? -1 : 999);
            const bLevel = b.level ?? (b.type === 'Parking' ? -1 : 999);
            return aLevel - bLevel;
          });

          const basementFloorsCalc = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking'
          );
          let totalBasementHeight = basementFloorsCalc.reduce((sum, f) => sum + f.height, 0);

          // Tower Lift Fix: If this is a tower and has no basements itself, 
          // look for sibling podium's basement height to know how much to lift.
          if (totalBasementHeight === 0 && building.id.includes('-tower')) {
             const baseId = building.id.replace('-tower', '');
             const siblingPodium = plot.buildings.find(b => b.id === `${baseId}-podium`);
             if (siblingPodium) {
                const siblingBasementFloors = siblingPodium.floors.filter(f => 
                   (f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking'
                );
                totalBasementHeight = siblingBasementFloors.reduce((sum, f) => sum + f.height, 0);
             }
          }

          const heightOffset = 0;
          const shouldLiftForBasements = componentVisibility.basements;
          const superstructureFloorsCalc = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking')
          );
          const superstructureHeight = superstructureFloorsCalc.reduce((sum, f) => sum + (f.height || 3), 0);
          const superstructureFloorsCalcFiltered = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking') &&
            f.type !== 'Utility'
          );
          const superstructureHeightFinal = superstructureFloorsCalcFiltered.reduce((sum, f) => sum + (f.height || 3), 0);
          const visualBuildingTop = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0) + superstructureHeightFinal;
          const effectiveBase = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0);

          // --- RENDER INTERNAL LAYOUT (UTILITIES -> CORES & UNITS) ---
          if (building.internalUtilities) {
            building.internalUtilities.forEach((util: UtilityArea) => {
              const layerId = `util-${building.id}-${util.id}`;
              renderedIds.add(layerId);

              let utilOpacity = 0.0;
              let utilHeight = 0;
              let utilBase = 0;
              let utilColor = '#CCCCCC';

              const buildingTop = visualBuildingTop;

              if (util.type === 'Electrical') {
                const isSelected = selectedObjectId?.id === util.id;
                if (building.internalsVisible === false) {
                  utilOpacity = 0.0;
                } else if (building.internalsVisible === true) {
                  utilOpacity = uiState.ghostMode ? 0.8 : 1.0;
                } else {
                  utilOpacity = componentVisibility.electrical ? 1.0 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.8 : 0.0));
                }

                utilBase = effectiveBase;
                utilHeight = visualBuildingTop;
                utilColor = '#FFD700';
              } else if (util.type === 'HVAC') {
                if (building.internalsVisible === false) {
                  utilOpacity = 0.0;
                } else if (building.internalsVisible === true) {
                  utilOpacity = uiState.ghostMode ? 0.8 : 1.0;
                } else {
                  utilOpacity = componentVisibility.hvac ? 1.0 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.8 : 0.0));
                }
                // HVAC sits directly on top of building (W/SW half - Vastu compliant)
                utilBase = buildingTop + heightOffset;
                utilHeight = buildingTop + 3.0 + heightOffset;
                utilColor = '#FF8C00'; // Dark orange - HVAC unit
              } else if (util.type === 'Solar PV') {
                // Solar PV rooftop panels sit on top of HVAC (or directly on roof)
                // Vastu: South-facing roof for maximum efficiency
                if (building.internalsVisible === false) {
                  utilOpacity = 0.0;
                } else if (building.internalsVisible === true) {
                  utilOpacity = uiState.ghostMode ? 0.75 : 0.9;
                } else {
                  utilOpacity = componentVisibility.solar ? 0.9 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.75 : 0.0));
                }
                // Solar panels start at building top (S/SE half - above HVAC level on other side)
                utilBase = buildingTop + heightOffset;
                utilHeight = buildingTop + 0.5 + heightOffset; // Thin 0.5m panel
                utilColor = '#1A237E'; // Solar Indigo
              } else if (util.type === 'EV Station') {
                // EV Stations shown in basements as small polygons inside parking
                if (building.internalsVisible === false) {
                  utilOpacity = 0.0;
                } else if (building.internalsVisible === true) {
                  utilOpacity = uiState.ghostMode ? 0.8 : 1.0;
                } else {
                  // Use EV visibility toggle
                  utilOpacity = componentVisibility.ev ? 1.0 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.8 : 0.0));
                }
                
                // Render in first basement (B1)
                const b1 = building.floors.find(f => f.level === -1);
                if (b1) {
                   utilBase = (building.baseHeight || 0) + (shouldLiftForBasements ? (totalBasementHeight - b1.height) : -b1.height);
                   utilHeight = utilBase + 2.5; 
                } else {
                   utilBase = (building.baseHeight || 0) - 2.5;
                   utilHeight = building.baseHeight || 0;
                }
                utilColor = '#2E7D32'; // Forest Green
              }

              const utilGeo = {
                ...util.geometry,
                properties: {
                  height: utilHeight,
                  base_height: utilBase,
                  color: utilColor
                }
              };

              let source = mapInstance.getSource(layerId) as GeoJSONSource;
              if (source) source.setData(utilGeo);
              else mapInstance.addSource(layerId, { type: 'geojson', data: utilGeo });

              if (!mapInstance.getLayer(layerId)) {
                mapInstance.addLayer({
                  id: layerId,
                  type: 'fill-extrusion',
                  source: layerId,
                  paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base_height'],
                    'fill-extrusion-opacity': utilOpacity
                  }
                }, LABELS_LAYER_ID);
              } else {
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', utilOpacity);
              }
            });
          }

          const floorDict: Record<string, { baseHeight: number, height: number }> = {};
          let fdCurrentBase = building.baseHeight || 0;
          // If lifting for basements and this building doesn't have its own basements to push it up
          if (shouldLiftForBasements && basementFloorsCalc.length === 0) {
            fdCurrentBase += totalBasementHeight;
          }
          floorsToRender.forEach(f => {
            floorDict[f.id] = { baseHeight: fdCurrentBase, height: fdCurrentBase + f.height };
            fdCurrentBase += f.height;
          });

          if (building.cores && floorsToRender) {
            const layerId = `cores-${building.id}`;
            renderedIds.add(layerId);

            let coreOpacity = 0.0;
            if (building.internalsVisible === false) {
              coreOpacity = 0.0;
            } else if (building.internalsVisible === true) {
              coreOpacity = uiState.ghostMode ? 0.8 : 1.0;
            } else {
              if (componentVisibility.cores) {
                coreOpacity = uiState.ghostMode ? 0.8 : 1.0;
              } else if (anyComponentVisible) {
                coreOpacity = 0.0;
              } else if (uiState.ghostMode) {
                coreOpacity = 0.8;
              }
            }

            const seenGeoKeys = new Set<string>();
            const features: Feature[] = [];
            building.cores.forEach((core: Core) => {
              const geoKey = JSON.stringify(core.geometry.geometry.coordinates);
              if (seenGeoKeys.has(geoKey)) return;
              seenGeoKeys.add(geoKey);

              features.push({
                ...core.geometry,
                properties: {
                  ...core.geometry.properties,
                  height: visualBuildingTop,
                  base_height: effectiveBase,
                  coreId: core.id
                }
              } as Feature);
            });

            const coreGeoData = { type: 'FeatureCollection', features } as FeatureCollection;
            const usePattern = !(uiState.ghostMode || building.internalsVisible === true);
            let patternName = 'texture-Institutional';

            if (usePattern) {
              const opacityStr = coreOpacity.toFixed(1);
              patternName = `texture-Institutional-${opacityStr}`;
              if (!mapInstance.hasImage(patternName)) {
                const img = generateBuildingTexture('Institutional', '#9370DB', coreOpacity);
                if (img) mapInstance.addImage(patternName, img, { pixelRatio: 2 });
              }
            }

            let cSource = mapInstance.getSource(layerId) as GeoJSONSource;
            if (cSource) cSource.setData(coreGeoData as any);
            else mapInstance.addSource(layerId, { type: 'geojson', data: coreGeoData as any });

            if (!mapInstance.getLayer(layerId)) {
              const paintProps: any = {
                'fill-extrusion-color': usePattern ? '#ffffff' : '#9370DB',
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': coreOpacity
              };
              if (usePattern) paintProps['fill-extrusion-pattern'] = patternName;
              mapInstance.addLayer({ id: layerId, type: 'fill-extrusion', source: layerId, paint: paintProps }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', coreOpacity);
              if (usePattern) {
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-pattern', patternName);
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-color', '#ffffff');
              } else {
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-pattern', undefined as any);
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-color', '#9370DB');
              }
            }
          }

        if (building.units && floorsToRender) {
            const layerId = `units-${building.id}`;
            renderedIds.add(layerId);

            let unitOpacity = 0.0;
            if (building.internalsVisible === false) {
              unitOpacity = 0.0;
            } else if (building.internalsVisible === true) {
              unitOpacity = uiState.ghostMode ? 0.8 : 1.0;
            } else {
              if (componentVisibility.units) {
                unitOpacity = uiState.ghostMode ? 0.8 : 1.0;
              } else if (anyComponentVisible) {
                unitOpacity = 0.0;
              } else if (uiState.ghostMode) {
                unitOpacity = 0.8;
              }
            }

            const SLAB_GAP = 0.35;
            const features: Feature[] = [];
            building.units.forEach((unit: Unit) => {
              const fBounds = floorDict[unit.floorId || ''];
              if (!fBounds) return;

              const unitTop = Math.max(fBounds.baseHeight, fBounds.height - SLAB_GAP);

              features.push({
                ...unit.geometry,
                properties: {
                  ...unit.geometry.properties,
                  height: unitTop,
                  base_height: fBounds.baseHeight,
                  color: unit.color || '#ADD8E6',
                  unitId: unit.id,
                  type: unit.type,
                  targetArea: unit.targetArea
                }
              } as Feature);
            });

            const geometryData = { type: 'FeatureCollection', features } as FeatureCollection;

            let source = mapInstance.getSource(layerId) as GeoJSONSource;
            if (source) source.setData(geometryData as any);
            else mapInstance.addSource(layerId, { type: 'geojson', data: geometryData as any });

            if (!mapInstance.getLayer(layerId)) {
              mapInstance.addLayer({
                id: layerId,
                type: 'fill-extrusion',
                source: layerId,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': unitOpacity
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', unitOpacity);
              mapInstance.setPaintProperty(layerId, 'fill-extrusion-color', ['get', 'color']);
            }
          }

          const frontMarkerSourceId = `building-front-${building.id}`;
          const frontMarkerLayerId = `building-front-${building.id}`;
          renderedIds.add(frontMarkerSourceId);
          renderedIds.add(frontMarkerLayerId);

          const frontMarker = building.centroid
            ? createBuildingFrontMarker(
                building.geometry as any,
                building.centroid as Feature<Point>,
                building.alignmentRotation ?? (building.geometry as any)?.properties?.alignmentRotation ?? 0,
                visualBuildingTop + 0.2
              )
            : null;

          if (frontMarker) {
            const frontSource = mapInstance.getSource(frontMarkerSourceId) as GeoJSONSource;
            if (frontSource) frontSource.setData(frontMarker as any);
            else mapInstance.addSource(frontMarkerSourceId, { type: 'geojson', data: frontMarker as any });

            const isSelected = selectedObjectId?.type === 'Building' && selectedObjectId.id === building.id;
            if (!mapInstance.getLayer(frontMarkerLayerId)) {
              mapInstance.addLayer({
                id: frontMarkerLayerId,
                type: 'fill-extrusion',
                source: frontMarkerSourceId,
                paint: {
                  'fill-extrusion-color': isSelected ? '#f59e0b' : '#f8fafc',
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-opacity': isSelected ? 0.98 : 0.9,
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(frontMarkerLayerId, 'fill-extrusion-color', isSelected ? '#f59e0b' : '#f8fafc');
              mapInstance.setPaintProperty(frontMarkerLayerId, 'fill-extrusion-opacity', isSelected ? 0.98 : 0.9);
            }
          }

          // --- RENDER FLOORS (SHELL) LAST (BACKGROUND/CONTEXT) ---
          let currentBase = building.baseHeight || 0;
          // If lifting for basements and this building doesn't have its own basements to push it up
          if (shouldLiftForBasements && basementFloorsCalc.length === 0) {
            currentBase += totalBasementHeight;
          }
          floorsToRender.forEach((floor, fIndex) => {
            const typeLower = (floor.type || '').toLowerCase();
            const isBasementOrParking = (floor.level !== undefined && floor.level < 0) || typeLower === 'parking';

            const floorUse = floor.intendedUse || building.intendedUse;

            const builtColor = getBuildingColor(floorUse);
            const intendedColor = isBasementOrParking ? '#555555' : builtColor;

            const slabHeight = 0.3;
            let wallGeometry = building.geometry;
            try {
              const buffered = turf.buffer(building.geometry, -0.0005, { units: 'kilometers' });
              if (buffered) wallGeometry = buffered as any;
            } catch (e) {
              console.warn('Failed to buffer wall geometry', e);
            }

            const slabLayerId = `building-slab-${floor.id}-${building.id}`;
            renderedIds.add(slabLayerId);

            const userOpacity = building.opacity !== undefined ? building.opacity : 1.0;
            const slabOpacity = uiState.ghostMode ? 0.0 : userOpacity;

            const slabGeo = {
              ...building.geometry,
              properties: {
                ...building.geometry.properties,
                height: currentBase + slabHeight,
                base_height: currentBase,
                color: '#EEEEEE'
              }
            };

            let slabSource = mapInstance.getSource(slabLayerId) as GeoJSONSource;
            if (slabSource) slabSource.setData(slabGeo);
            else mapInstance.addSource(slabLayerId, { type: 'geojson', data: slabGeo });

            if (!mapInstance.getLayer(slabLayerId)) {
              mapInstance.addLayer({
                id: slabLayerId,
                type: 'fill-extrusion',
                source: slabLayerId,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': slabOpacity
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(slabLayerId, 'fill-extrusion-opacity', slabOpacity);
            }

            const floorTop = currentBase + floor.height;
            const floorLayerId = `building-floor-fill-${floor.id}-${building.id}`;
            renderedIds.add(floorLayerId);

            // Only highlight with teal during the 3-second flash window after selection
            const isBuildingSelected = showSelectionHighlight && selectedObjectId && selectedObjectId.id === building.id && selectedObjectId.type === 'Building';
            const isInternalSelected = selectedObjectId && (
              building.internalUtilities?.some(u => u.id === selectedObjectId.id) ||
              building.cores?.some(c => c.id === selectedObjectId.id) ||
              building.units?.some(u => u.id === selectedObjectId.id)
            );

            const isInternalMode = building.internalsVisible === true || anyComponentVisible;
            let opacity = userOpacity;
            if (isInternalMode) {
              opacity = 0.0;
              if ((componentVisibility.basements || building.internalsVisible === true) && floor.parkingType === 'Basement') {
                opacity = 0.9;
              }
            } else if (uiState.ghostMode) {
              if (floor.parkingType === 'Basement') opacity = 0.8;
              else opacity = 0.0;
            }

            if (isInternalSelected || isBuildingSelected) {
               if (isInternalMode) {
                  opacity = 0.15; // Transparent shell to still see internals
               } else {
                  opacity = Math.max(0.6, userOpacity);
               }
            }

            const selectionColor = '#00fbff'; // Bright cyan for selection
            let finalColor: any = isBuildingSelected ? selectionColor : (intendedColor || floor.color || '#cccccc');
 
            const floorGeo = {
              ...wallGeometry,
              properties: {
                ...building.geometry.properties,
                height: floorTop,
                base_height: currentBase + slabHeight,
                color: finalColor
              }
            };

            let fSource = mapInstance.getSource(floorLayerId) as GeoJSONSource;
            if (fSource) fSource.setData(floorGeo);
            else mapInstance.addSource(floorLayerId, { type: 'geojson', data: floorGeo });

            if (!mapInstance.getLayer(floorLayerId)) {
              const usePattern = !uiState.ghostMode && !isBasementOrParking && analysisMode === 'none';
              let patternName = `texture-${floorUse}`;

              if (usePattern) {
                // Generate texture with specific opacity on demand
                const opacityStr = opacity.toFixed(2);
                patternName = `texture-${floorUse}-${opacityStr}${isBuildingSelected ? '-selected' : ''}`;
                if (!mapInstance.hasImage(patternName)) {
                  const color = getBuildingColor(floorUse as any);
                  const img = generateBuildingTexture(floorUse as any, color, opacity, !!isBuildingSelected);
                  if (img) mapInstance.addImage(patternName, img, { pixelRatio: 2 });
                }
              }

              const paintProps: any = {
                'fill-extrusion-color': usePattern ? '#ffffff' : (isBuildingSelected ? selectionColor : ['get', 'color']),
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': opacity
              };

              
              if (usePattern) {
                paintProps['fill-extrusion-pattern'] = patternName;
              }

              mapInstance.addLayer({
                id: floorLayerId,
                type: 'fill-extrusion',
                source: floorLayerId,
                paint: paintProps,
                metadata: {
                  id: building.id,
                  type: 'Building'
                }
              }, LABELS_LAYER_ID);
            } else {
              const usePattern = !uiState.ghostMode && !isBasementOrParking && analysisMode === 'none';
              let patternName = `texture-${floorUse}`;

              if (usePattern) {
                // Generate texture with specific opacity on demand
                const opacityStr = opacity.toFixed(2);
                patternName = `texture-${floorUse}-${opacityStr}${isBuildingSelected ? '-selected' : ''}`;
                if (!mapInstance.hasImage(patternName)) {
                  const color = getBuildingColor(floorUse as any);
                  const img = generateBuildingTexture(floorUse as any, color, opacity, !!isBuildingSelected);
                  if (img) mapInstance.addImage(patternName, img, { pixelRatio: 2 });
                }
              }

              mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-opacity', opacity);
              // Update Pattern & Color
              if (usePattern) {
                try {
                  mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', patternName);
                  mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', '#ffffff');
                } catch (e) {}
              } else {
                // Use undefined to unset property in strict Mapbox TS/JS
                try {
                  mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', undefined as any); // Clear pattern
                } catch (e) {
                  try { mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', ''); } catch (e2) {}
                }
                try {
                  mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', isBuildingSelected ? selectionColor : ['get', 'color']);
                } catch (e) {}
              }
            }

            currentBase += floor.height;
          });
        }

      });

      plot.greenAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `green-area-label-${area.id}`
            })
          )
        }
      });

      plot.parkingAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `parking-area-label-${area.id}`
            })
          )
        }
      });

      plot.buildableAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `buildable-area-label-${area.id}`
            })
          )
        }
      });
      plot.utilityAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n(${area.type})\n${(area.targetArea || area.area).toFixed(0)} m²`,
              id: `utility-area-label-${area.id}`
            })
          )
        }
      });
    });

    const labelCollection = turf.featureCollection(allLabels);
    const labelsSource = mapInstance.getSource(LABELS_SOURCE_ID) as GeoJSONSource;
    if (labelsSource) {
      labelsSource.setData(labelCollection);
    }

    const allBuildingFootprints: Feature<Polygon>[] = [];

    plotsRendering.forEach(plot => {
      const plotId = plot.id;
      if (plotsRendering.length > 0 && plot === plotsRendering[0]) {
        console.log(`[MapEditor] Rendering Plot ${plotId}`, {
          geometryType: plot.geometry?.type,
          hasCoordinates: !!(plot.geometry as any)?.coordinates,
          isSelected: plotId === selectedObjectId?.id,
          entriesCount: plot.entries?.length || 0
        });
      }

      renderedIds.add(`plot-base-${plotId}`);
      renderedIds.add(`plot-setback-${plotId}`);
      renderedIds.add(`plot-label-${plotId}`);


      plot.greenAreas.forEach(g => {
        renderedIds.add(`green-area-${g.id}`);
        renderedIds.add(`green-area-label-${g.id}`);
      });
      plot.parkingAreas.forEach(p => {
        renderedIds.add(`parking-area-${p.id}`);
        renderedIds.add(`parking-area-label-${p.id}`);
      });
      plot.buildableAreas.forEach(b => {
        renderedIds.add(`buildable-area-${b.id}`);
        renderedIds.add(`buildable-area-border-${b.id}`);
        renderedIds.add(`buildable-area-label-${b.id}`);
      });
      plot.utilityAreas.forEach(u => {
        renderedIds.add(`utility-area-${u.id}`);
        renderedIds.add(`utility-area-label-${u.id}`);
      });

      const plotBaseSourceId = `plot-base-${plotId}`;
      const plotSetbackSourceId = `plot-setback-${plotId}`;
      const plotBaseLayerId = `plot-base-${plotId}`;
      const plotSetbackLayerId = `plot-setback-${plotId}`;

      let geometryToRender = plot.geometry;
      let geometryType = geometryToRender?.type;

      if (geometryType === 'Feature' && (geometryToRender as any).geometry) {
        console.log(`[MapEditor] Normalizing Feature to Geometry for Plot ${plotId}`);
        geometryToRender = (geometryToRender as any).geometry;
        geometryType = geometryToRender.type;
      } else {
        console.log(`[MapEditor] No normalization needed for Plot ${plotId}. Type: ${geometryType}`);
      }

      let setbackPolygon = null;
      try {
        if (((geometryType as string) === 'Polygon' || (geometryType as string) === 'MultiPolygon') && plot.setback > 0) {
          setbackPolygon = turf.buffer(plot.geometry as any, -plot.setback, { units: 'meters' });
        }
      } catch (e) {
        console.warn("[Setback Debug] Buffer FAILED for plot", plot.id, e);
        setbackPolygon = plot.geometry;
      }

      let sourceBase = mapInstance.getSource(plotBaseSourceId) as GeoJSONSource;

      let validNormalizedGeometry = geometryToRender;
      if (!validNormalizedGeometry || typeof validNormalizedGeometry !== 'object' || !validNormalizedGeometry.type || !(validNormalizedGeometry as any).coordinates) {
        console.warn(`[MapEditor] âŒ Invalid Geometry Object for Plot ${plotId}`, validNormalizedGeometry);
      }

      const dataToRender = validNormalizedGeometry || plot.geometry;


      if (sourceBase) {
        if (dataToRender) sourceBase.setData(dataToRender);
      } else {
        if (dataToRender) mapInstance.addSource(plotBaseSourceId, { type: 'geojson', data: dataToRender });
      }

      if (!mapInstance.getLayer(plotBaseLayerId)) {
        if (dataToRender) {
          mapInstance.addLayer({
            id: plotBaseLayerId,
            type: 'fill',
            source: plotBaseSourceId,
            paint: {
              'fill-color': [
                'case',
                ['==', plotId, selectedObjectId?.id || ''],
                '#48bb78',
                '#4a5568'
              ],
              'fill-opacity': [
                'case',
                ['==', plotId, selectedObjectId?.id || ''],
                uiState.ghostMode ? 0.2 : 0.6,
                uiState.ghostMode ? 0.05 : 0.1
              ]
            }
          }, LABELS_LAYER_ID);
        }
      } else {
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-color', '#4a5568');
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-opacity', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          0.1,
          0.1
        ]);
      }

      let sourceSetback = mapInstance.getSource(plotSetbackSourceId) as GeoJSONSource;
      if (sourceSetback) sourceSetback.setData(setbackPolygon || dataToRender);
      else if (dataToRender) mapInstance.addSource(plotSetbackSourceId, { type: 'geojson', data: setbackPolygon || dataToRender });

      if (!mapInstance.getLayer(plotSetbackLayerId)) {
        mapInstance.addLayer({
          id: plotSetbackLayerId,
          type: 'line',
          source: plotSetbackSourceId,
          paint: {
            'line-color': [
              'case',
              ['==', plotId, selectedObjectId?.id || ''],
              '#ed8936',
              '#f6ad55'
            ],
            'line-width': [
              'case',
              ['==', plotId, selectedObjectId?.id || ''],
              3,
              2
            ],
            'line-dasharray': [2, 2]
          }
        }, LABELS_LAYER_ID);
      } else {
        mapInstance.setPaintProperty(plotSetbackLayerId, 'line-color', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          '#ed8936',
          '#f6ad55'
        ]);
        mapInstance.setPaintProperty(plotSetbackLayerId, 'line-width', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          3,
          2
        ]);
      }

      // Plot Label Layer
      const labelSourceId = `plot-label-${plotId}`;
      const labelLayerId = `plot-label-${plotId}`;
      const labelData = {
        type: 'Feature',
        geometry: plot.centroid.geometry,
        properties: {
          label: `${plot.name}\n${Math.round(plot.area)} m²`,
        }
      };

      let sourceLabel = mapInstance.getSource(labelSourceId) as GeoJSONSource;
      if (sourceLabel) sourceLabel.setData(labelData as any);
      else mapInstance.addSource(labelSourceId, { type: 'geojson', data: labelData as any });

      if (!mapInstance.getLayer(labelLayerId)) {
        mapInstance.addLayer({
          id: labelLayerId,
          type: 'symbol',
          source: labelSourceId,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-offset': [0, 0],
            'text-anchor': 'center'
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2
          }
        });
      }

      plot.buildings.forEach(building => {
        // @ts-ignore
        const feat = turf.feature(building.geometry.geometry, {
          id: building.id,
          linkedId: building.id,
          name: building.name || 'Building',
          use: building.intendedUse || 'General',
          height: building.height || 0,
          floors: building.numFloors || 0
        });
        // @ts-ignore
        allBuildingFootprints.push(feat);
      });

      // --- RENDER ENTRY/EXIT GATES ---
      console.log(`[MapEditor] Rendering gates for plot ${plot.id}`, plot.entries);
      if (plot.entries && plot.entries.length > 0) {
        const gateSourceId = `gates-${plot.id}`;
        const gateCircleLayerId = `gates-circle-${plot.id}`;
        const gateLabelLayerId = `gates-label-${plot.id}`;

        renderedIds.add(gateSourceId);
        renderedIds.add(gateCircleLayerId);
        const gateFeatures = plot.entries.map(entry => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: entry.position
          },
          properties: {
            id: entry.id,
            name: entry.name || entry.type,
            type: entry.type,
            color: entry.color || (entry.type === 'Entry' ? '#10b981' : entry.type === 'Exit' ? '#ef4444' : '#3b82f6')
          }
        }));

        const gateCollection = {
          type: 'FeatureCollection' as const,
          features: gateFeatures
        };

        let gateSource = mapInstance.getSource(gateSourceId) as GeoJSONSource;
        if (gateSource) {
          gateSource.setData(gateCollection as any);
        } else {
          mapInstance.addSource(gateSourceId, {
            type: 'geojson',
            data: gateCollection as any
          });
        }

        if (!mapInstance.getLayer(gateCircleLayerId)) {
          mapInstance.addLayer({
            id: gateCircleLayerId,
            type: 'circle',
            source: gateSourceId,
            paint: {
              'circle-radius': 12,
              'circle-color': ['get', 'color'],
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.9
            }
          });
        }

        // Add label layer for gate names
        /*
        if (!mapInstance.getLayer(gateLabelLayerId)) {
          mapInstance.addLayer({
            id: gateLabelLayerId,
            type: 'symbol',
            source: gateSourceId,
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 11,
              'text-offset': [0, 2],
              'text-anchor': 'top'
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#000000',
              'text-halo-width': 2
            }
          });
        }
        */
      }
    });

    const allBuildingsSourceId = 'all-buildings-footprints';
    const allBuildingsLayerId = 'all-buildings-hit-layer';
    renderedIds.add(allBuildingsSourceId);
    renderedIds.add(allBuildingsLayerId);

    let buildingSource = mapInstance.getSource(allBuildingsSourceId) as GeoJSONSource;
    // @ts-ignore
    const buildingCollection = turf.featureCollection(allBuildingFootprints);
    if (buildingSource) buildingSource.setData(buildingCollection);
    else mapInstance.addSource(allBuildingsSourceId, { type: 'geojson', data: buildingCollection });

    if (!mapInstance.getLayer(allBuildingsLayerId)) {
      mapInstance.addLayer({
        id: allBuildingsLayerId,
        type: 'fill',
        source: allBuildingsSourceId,
        paint: { 'fill-color': '#000', 'fill-opacity': 0 }
      }, LABELS_LAYER_ID);

      mapInstance.on('mousemove', allBuildingsLayerId, (e) => {
        if (e.features && e.features.length > 0) {
          mapInstance.getCanvas().style.cursor = 'pointer';
        }
      });
      mapInstance.on('mouseleave', allBuildingsLayerId, () => {
        mapInstance.getCanvas().style.cursor = '';
      });
    }

    const currentStyle = mapInstance.getStyle();
    if (currentStyle && currentStyle.layers) {
      currentStyle.layers.forEach(layer => {
        const layerId = layer.id;
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('building-floor-fill-') || layerId.startsWith('building-slab-') || layerId.startsWith('building-front-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-') || layerId.startsWith('util-') || layerId.startsWith('utility-area-') || layerId.startsWith('core-') || layerId.startsWith('unit-') || layerId.startsWith('units-') || layerId.startsWith('cores-') || layerId.startsWith('electrical-') || layerId.startsWith('hvac-') || layerId.startsWith('gates-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('building-floor-fill-') || sourceId.startsWith('building-slab-') || sourceId.startsWith('building-front-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-') || sourceId.startsWith('util-') || sourceId.startsWith('utility-area-') || sourceId.startsWith('core-') || sourceId.startsWith('unit-') || sourceId.startsWith('units-') || sourceId.startsWith('cores-') || sourceId.startsWith('electrical-') || sourceId.startsWith('hvac-') || sourceId.startsWith('gates-');

        if (isManagedByPlots && !renderedIds.has(sourceId) && sourceId !== LABELS_SOURCE_ID) {
          const style = mapInstance.getStyle();
          const isSourceInUse = style?.layers?.some(layer => (layer as any).source === sourceId);
          if (!isSourceInUse && mapInstance.getSource(sourceId)) {
            mapInstance.removeSource(sourceId);
          }
        }
      });
      mapInstance.triggerRepaint();
    }

  }, [plots, tempScenarios, plotsRendering, isMapLoaded, selectedObjectId, primaryColor, isLoading, activeProject, styleLoaded, uiState.ghostMode, componentVisibility]);

  // HOVER TOOLTIP EFFECT
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;
    const m = map.current;

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'editor-tooltip'
    });

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      const { componentVisibility: cv, uiState: us, plots, drawingState: ds } = getStoreState();

      // Hide tooltip during rotation to keep the view clear
      if (typeof ds.objectType === 'string' && ds.objectType.toLowerCase() === 'rotate') {
        popup.remove();
        return;
      }

      const internalsVisible = cv.units || cv.cores || cv.electrical || cv.hvac || us.ghostMode;

      const features = m.queryRenderedFeatures(e.point).filter(f => {
        const lid = f.layer?.id;
        if (!lid) return false;
        
        const isInternal = lid.startsWith('cores-') || lid.startsWith('units-') || lid.startsWith('util-');
        if (isInternal) {
            const opacity = m.getPaintProperty(lid, 'fill-extrusion-opacity');
            if (opacity === 0) return false;
        }
        
        return (
          lid === 'all-buildings-hit-layer' ||
          lid.startsWith('utility-area-') ||
          lid.startsWith('parking-area-') ||
          lid.startsWith('gates-circle-') ||
          lid.startsWith('cores-') ||
          lid.startsWith('units-') ||
          lid.startsWith('util-')
        );
      });

      if (features.length > 0) {
        const f = features[0];
        m.getCanvas().style.cursor = 'pointer';

        let html = '';
        const props = f.properties || {};

        if (f.layer?.id === 'all-buildings-hit-layer') {
          let dims = '';
          try {
            const pd = planarDimensions(f);
            const l = Math.round(pd.length * 10) / 10;
            const w = Math.round(pd.width * 10) / 10;
            const calcArea = Math.round(l * w * 100) / 100;
            dims = `${l.toFixed(1)}m x ${w.toFixed(1)}m`;
            props.area = calcArea;
          } catch (e) { }

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Building'}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${props.use || ''}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${props.floors || 0} Fl • ${Math.round(props.height || 0)}m</div>
            ${dims ? `<div class="text-xs text-neutral-600 mt-0.5" style="color: #525252;">Size: ${dims}</div>` : ''}
            <div class="text-xs text-neutral-600 mt-0.5" style="color: #525252;">Footprint: ${props.area.toFixed(2)} m²</div>
          `;
        } else if (f.layer?.id.startsWith('utility-area-') || f.layer?.id.startsWith('parking-area-')) {
          const typeLabel = props.type || (f.layer?.id.startsWith('parking-area-') ? 'Parking' : 'Utility');
          
          const actualArea = Number(props.targetArea || props.area) || 0;
          const areaLabel = actualArea ? `Footprint: ${actualArea.toFixed(1)} m²` : '';
          const targetAreaLabel = '';
          
          const capacityLabel = props.capacity ? `<div class="text-xs text-neutral-600 mt-0.5">Capacity: ${props.capacity} cars</div>` : '';

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${typeLabel}</div>
            ${areaLabel ? `<div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${areaLabel} ${targetAreaLabel}</div>` : ''}
            ${capacityLabel}
          `;
        } else if (f.layer?.id.startsWith('gates-circle-')) {
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Gate'}</div>
          `;
        } else if (f.layer?.id.startsWith('cores-')) {
          let dims = '';
          let coreArea = 0;
          try {
            const pd = planarDimensions(f);
            const l = Math.round(pd.length * 10) / 10;
            const w = Math.round(pd.width * 10) / 10;
            coreArea = pd.area;
            dims = `${l.toFixed(1)}m x ${w.toFixed(1)}m`;
          } catch (e) {
            coreArea = turf.area(f as any);
          }

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">Core</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Vertical Circulation</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Footprint Area: ${coreArea.toFixed(1)} m²</div>
            ${dims ? `<div class="text-xs text-neutral-600 mt-0.5" style="color: #525252;">Size: ${dims}</div>` : ''}
          `;
        } else if (f.layer?.id.startsWith('util-')) {
          const typeLabel = props.type || 'Utility Shaft';
          const area = planarArea(f);
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Internal ${typeLabel}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Footprint Area: ${area.toFixed(1)} m²</div>
          `;
        } else if (f.layer?.id.startsWith('units-')) {
          const typeLabel = props.type || 'Unit';
          // Use targetArea if available (architectural intent), fallback to geometric area
          const actualArea = props.targetArea ? Number(props.targetArea).toFixed(1) : planarArea(f).toFixed(1);
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Internal Unit Layout</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Area: ${actualArea} m² </div>
          `;
        }

        if (html) {
          popup.setLngLat(e.lngLat).setHTML(html).addTo(m);
        }
      } else {
        m.getCanvas().style.cursor = '';
        popup.remove();
      }
    };

    m.on('mousemove', onMouseMove);
    m.on('mouseleave', () => popup.remove());

    return () => {
      m.off('mousemove', onMouseMove);
      popup.remove();
    };
  }, [isMapLoaded]);


  return (
    <div className="relative w-full h-full">
      <Script
        src="https://cdn.jsdelivr.net/gh/jscastro76/threebox@v.2.2.2/dist/threebox.min.js"
        strategy="afterInteractive"
        onLoad={() => {
          console.log('Threebox script loaded');
          setIsThreeboxLoaded(true);
        }}
      />
      <div ref={mapContainer} className="w-full h-full" />
      {children}

      {/* Map Style & View Controls */}
      <div className="absolute top-4 right-14 z-10 bg-background/90 backdrop-blur rounded-md border shadow-sm p-0.5 flex items-center gap-0.5">
        
        {/* Style Toggle */}
        <button
          onClick={() => {
            if (!map.current) return;
            
            let nextMode: 'map' | 'satellite' | 'terrain';
            if (mapStyleMode === 'map') nextMode = 'satellite';
            else if (mapStyleMode === 'satellite') nextMode = 'terrain';
            else nextMode = 'map';
            
            setMapStyleMode(nextMode);

            if (map.current.getLayer('satellite-basemap')) {
              map.current.setLayoutProperty(
                'satellite-basemap',
                'visibility',
                nextMode === 'satellite' ? 'visible' : 'none'
              );
            }

            if (nextMode === 'terrain') {
              map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
            } else {
              (map.current as any).setTerrain(null);
            }

            if (window.tb) window.tb.repaint();
          }}
          className={`h-7 min-w-[90px] rounded-sm text-[11px] font-medium transition-colors flex items-center justify-center gap-1 px-2 ${mapStyleMode !== 'map' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          title="Toggle Map Style"
        >
          {mapStyleMode === 'map' && <><MapIcon className="w-3.5 h-3.5" /> Map View</>}
          {mapStyleMode === 'satellite' && <><Globe className="w-3.5 h-3.5" /> Satellite</>}
          {mapStyleMode === 'terrain' && <><ImageIcon className="w-3.5 h-3.5" /> Terrain</>}
        </button>

        <div className="h-5 w-[1px] bg-border" />

        {/* Compass */}
        <div className="flex gap-0">
          {[
            { label: 'N', angle: 180 },
            { label: 'E', angle: 270 },
            { label: 'S', angle: 0 },
            { label: 'W', angle: 90 }
          ].map(dir => (
            <button
              key={dir.label}
              onClick={() => {
                if (map.current) {
                  map.current.easeTo({
                    bearing: dir.angle,
                    duration: 1000,
                    essential: true
                  });
                }
              }}
              className="w-7 h-7 flex items-center justify-center rounded-sm text-[11px] font-semibold hover:bg-muted transition-colors text-muted-foreground hover:text-primary"
              title={`View from ${dir.label === 'N' ? 'North' : dir.label === 'E' ? 'East' : dir.label === 'S' ? 'South' : 'West'}`}
            >
              {dir.label}
            </button>
          ))}
        </div>
      </div>

    </div >
  );
}
