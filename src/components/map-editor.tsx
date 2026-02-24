import { useBuildingStore, UTILITY_COLORS } from '@/hooks/use-building-store';
import { BUILDING_MATERIALS, hslToRgb } from '@/lib/color-utils';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse, GreenRegulationData, UtilityType, Building, Core, Unit, Plot, GreenArea, ParkingArea, BuildableArea, UtilityArea } from '@/lib/types';
import { Feature, Polygon, Point, LineString, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import mapboxgl, { GeoJSONSource, LngLatLike, Map, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Script from 'next/script';
import { createShaktiChakraGroup } from '@/lib/shakti-chakra-visualizer';
import { AnalysisMode } from './solar-controls';
import { runVisualAnalysis, runGroundAnalysis, runWallAnalysis, calculateAggregateStats } from '@/lib/engines/visual-analysis-engine';
import { fetchWeatherData } from '@/lib/engines/weather-data-service';
import { useRegulations } from '@/hooks/use-regulations';
import { generateBuildingTexture } from '@/lib/texture-generator';
import { WindStreamlineLayer } from '@/lib/wind-streamline-layer';
import { Amenity } from '@/services/mapbox-places-service';
import { OverpassPlacesService } from '@/services/overpass-places-service';


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


interface MapEditorProps {
  onMapReady?: () => void;
  solarDate: Date;
  setSolarDate: (d: Date) => void;
  isSimulatorEnabled: boolean;
  setIsSimulatorEnabled: (b: boolean) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (m: AnalysisMode) => void;
  activeGreenRegulations?: GreenRegulationData[];
}

export function MapEditor({
  onMapReady,
  solarDate,
  setSolarDate,
  isSimulatorEnabled,
  setIsSimulatorEnabled,
  analysisMode,
  setAnalysisMode,
  activeGreenRegulations = []
}: MapEditorProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [buildingsReady, setBuildingsReady] = useState(false); // Track when buildings are ready for analysis

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [isThreeboxLoaded, setIsThreeboxLoaded] = useState(false);
  const [isTerrainEnabled, setIsTerrainEnabled] = useState(false); // Terrain OFF by default
  const markers = useRef<Marker[]>([]);
  const vastuObjectsRef = useRef<any[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); // Default primary color
  const hasNavigatedRef = useRef(false); // Track if we've navigated in this component instance
  const windStreamlineLayer = useRef<WindStreamlineLayer | null>(null);



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


  const activeProject = projects.find(p => p.id === activeProjectId);
  const { regulations } = useRegulations(activeProject || null);





  const { toast } = useToast();

  const getStoreState = useBuildingStore.getState;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const computedStyle = getComputedStyle(document.documentElement);
      const primaryHslRaw = computedStyle.getPropertyValue('--primary').trim();
      if (primaryHslRaw) {
        // Mapbox expects comma-separated HSL values, not space-separated
        const commaSeparatedHsl = primaryHslRaw.replace(/\s+/g, ',');
        setPrimaryColor(`hsl(${commaSeparatedHsl})`);
      }
    }
  }, []);

  // Compute effective plots to render (Scenario Preview vs Actual)
  const plotsRendering = useMemo(() => {
    // FIX: Do not show temporary scenarios on the map immediately.
    // The user wants to see them only after selecting one.
    // const scenarioPlots = (tempScenarios || []).flatMap(s => s.plots);
    // return scenarioPlots.length > 0 ? scenarioPlots : plots;
    return plots;
  }, [plots]);

  const closePolygon = useCallback(async () => {
    const { drawingPoints, drawingState } = getStoreState();
    if (drawingPoints.length < 3 || !drawingState.isDrawing) return;

    const finalPoints = [...drawingPoints, drawingPoints[0]];
    const polygonFeature = turf.polygon([finalPoints]);
    const centroid = turf.centroid(polygonFeature);


    const success = actions.finishDrawing(polygonFeature);
    if (!success) {
      // Toast message is now handled inside the store for more specific errors.
      // Generic fallback in case the store doesn't provide one.
      const lastToast = toast({
        title: 'Drawing Error',
        description: 'Could not create the object. Ensure it is drawn correctly and within required boundaries.',
      });
    }

  }, [actions, getStoreState, toast]);

  const finishRoad = useCallback(async () => {
    const { drawingPoints, drawingState } = getStoreState();
    if (drawingPoints.length < 2 || !drawingState.isDrawing || drawingState.objectType !== 'Road') return;

    const lineFeature = turf.lineString(drawingPoints);
    const success = actions.finishDrawing(lineFeature);

    if (!success) {
      toast({
        title: 'Drawing Error',
        description: 'Could not create the road. Ensure it intersects a plot boundary.',
      });
    }
  }, [actions, getStoreState, toast]);

  const handleMapClick = useCallback(
    (e: mapboxgl.MapLayerMouseEvent) => {
      if (!map.current || !map.current.isStyleLoaded()) return;

      const { drawingState, drawingPoints } = getStoreState();

      if (drawingState.isDrawing) {
        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        if (drawingState.objectType !== 'Road' && drawingPoints.length > 2) {
          const firstPoint = drawingPoints[0];
          const clickPoint: LngLatLike = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          const firstMapPoint: LngLatLike = { lng: firstPoint[0], lat: firstPoint[1] };
          const pixelDist = map.current?.project(clickPoint).dist(map.current.project(firstMapPoint));

          if (pixelDist && pixelDist < 15) { // 15px tolerance
            closePolygon();
            return;
          }
        }
        actions.addDrawingPoint(coords);
      } else {
        // Logic for selecting objects on the map
        const allMapLayers = map.current.getStyle().layers.map(l => l.id);
        const clickableLayers = plotsRendering.flatMap(p =>
          [
            `plot-base-${p.id}`,
            ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
            ...p.buildings.map(b => `units-${b.id}`),
            ...p.buildings.map(b => `cores-${b.id}`),
            // Include all rendered util- layers dynamically by scanning existing layers
            ...allMapLayers.filter(id => id.startsWith('util-')),
            ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
            ...p.greenAreas.map(g => `green-area-${g.id}`),
            ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
            ...p.utilityAreas.map(u => `utility-area-${u.id}`)
          ]
        ).filter(id => allMapLayers.includes(id));

        if (clickableLayers.length === 0) return;

        const features = map.current.queryRenderedFeatures(e.point, {
          layers: clickableLayers,
        });

        if (features && features.length > 0) {
          // Filter out invisible internal layers before processing click
          const { componentVisibility: cv, uiState: us, plots } = getStoreState();
          const validFeatures = features.filter(f => {
            const lid = f.layer?.id;
            if (!lid) return false;
            const isInternal = lid.startsWith('cores-') || lid.startsWith('units-') || lid.startsWith('util-');
            if (isInternal) {
                // If the layer is currently rendered fully transparent, ignore it for clicks
                const opacity = map.current?.getPaintProperty(lid, 'fill-extrusion-opacity');
                if (opacity === 0) return false;
            }
            return true;
          });
          if (validFeatures.length === 0) return;
          const feature = validFeatures[0];
          const layerId = feature.layer?.id;
          if (!layerId) return;

          if (layerId.startsWith('plot-base-')) {
            const plotId = layerId.replace('plot-base-', '');
            if (plotsRendering.some(p => p.id === plotId)) {
              actions.selectObject(plotId, 'Plot');
            }
          } else if (layerId.startsWith('building-floor-fill-')) {
            const buildingId = layerId.split('-').pop();
            if (!buildingId) return;
            for (const plot of plotsRendering) {
              if (plot.buildings.some(b => b.id === buildingId)) {
                actions.selectObject(buildingId, 'Building');
                break;
              }
            }
          } else if (layerId.startsWith('units-')) {
            const unitId = feature.properties?.unitId;
            if (unitId) actions.selectObject(unitId, 'Unit');
          } else if (layerId.startsWith('cores-')) {
            const coreId = feature.properties?.coreId;
            if (coreId) actions.selectObject(coreId, 'Core');
          } else if (layerId.startsWith('util-')) {
            // util layer IDs format: `util-${buildingId}-${utilId}`
            const parts = layerId.split('-');
            const utilId = parts.slice(2).join('-'); // handles uuid format correctly
            if (utilId) actions.selectObject(utilId, 'UtilityArea');
          } else if (layerId.startsWith('buildable-area-')) {
            const buildableAreaId = layerId.replace('buildable-area-', '');
            for (const plot of plotsRendering) {
              if (plot.buildableAreas.some(b => b.id === buildableAreaId)) {
                actions.selectObject(buildableAreaId, 'BuildableArea');
                break;
              }
            }
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
        }
      }
    },
    [closePolygon, actions, getStoreState, plotsRendering]
  );

  const handleMouseMove = useCallback((e: mapboxgl.MapLayerMouseEvent) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const { drawingState, drawingPoints } = getStoreState();

    if (drawingState.isDrawing) {
      map.current.getCanvas().style.cursor = 'crosshair';
      if (drawingPoints.length > 0) {
        if (drawingState.objectType === 'Road' && drawingPoints.length >= 1) {
          // Interactive Road Preview: All points so far + mouse position
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
      const allMapLayers = map.current.getStyle().layers.map(l => l.id);
      const hoverableLayers = plotsRendering.flatMap(p =>
        [
          `plot-base-${p.id}`,
          ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
          `buildable-area-${p.buildableAreas.map(b => b.id).join(',')}`, // Bug in original? Fix here?
          // Original was: ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
          // Wait, I should match the original logic exactly unless I want to fix bugs.
          // Original:
          // ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
          ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
          ...p.greenAreas.map(g => `green-area-${g.id}`),
          ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
          ...p.utilityAreas.map(u => `utility-area-${u.id}`)
        ]
      ).filter(id => allMapLayers.includes(id));

      if (hoverableLayers.length > 0) {
        const features = map.current.queryRenderedFeatures(e.point, { layers: hoverableLayers });
        map.current.getCanvas().style.cursor = features && features.length > 0 ? 'pointer' : 'grab';
      } else {
        map.current.getCanvas().style.cursor = 'grab';
      }
    }
  },
    [getStoreState, plotsRendering]
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
      map.current.flyTo({ center, zoom: zoom || 16, essential: true });
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
      center: [-74.006, 40.7128], // Default to NYC
      zoom: 15,
      pitch: 60,
      antialias: true,
    });

    const mapInstance = map.current;

    mapInstance.on('load', () => {
      onMapReady?.();
      mapInstance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

      // GENERATE & ADD TEXTURES
      // Always remove + re-add so changes to texture-generator take effect immediately.
      const buildingTypes = ['Residential', 'Commercial', 'Retail', 'Office', 'Institutional', 'Public', 'Mixed Use', 'Industrial', 'Hospitality'];

      buildingTypes.forEach(type => {
        const color = getBuildingColor(type as BuildingIntendedUse);
        const img = generateBuildingTexture(type as any, color);
        if (img) {
          const key = `texture-${type}`;
          if (mapInstance.hasImage(key)) mapInstance.removeImage(key);
          mapInstance.addImage(key, img, { pixelRatio: 2 });
        }
      });


      // Terrain & Atmosphere Configuration
      mapInstance.setMaxPitch(85); // Allow looking up easier in mountains

      // Add terrain source (used by the toggle button)
      mapInstance.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });
      // NOTE: Do NOT call setTerrain here. Even exaggeration:0 activates Mapbox's
      // terrain pipeline which distorts fill-extrusion base heights per-vertex,
      // causing visible width inconsistencies on slabs at oblique camera angles.
      // Terrain is only activated when the user explicitly toggles it on.

      // Add Sky Layer for better horizon context in 3D
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
        // Draw an arrow pointing UP (0 degrees)
        ctx.moveTo(16, 4);
        ctx.lineTo(16, 28);
        ctx.moveTo(16, 4);
        ctx.lineTo(8, 12);
        ctx.moveTo(16, 4);
        ctx.lineTo(24, 12);
        ctx.stroke();
        mapInstance.addImage('wind-arrow', ctx.getImageData(0, 0, arrowSize, arrowSize));
      }

      // Enable 3D buildings in Mapbox Standard Style
      try {
        mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
      } catch (e) {
        console.warn("Could not set show3dObjects config", e);
      }

      setIsMapLoaded(true);
    });

    // Listen for style data changes to ensure we render when style is ready
    mapInstance.on('styledata', () => {
      if (mapInstance.isStyleLoaded()) {
        setStyleLoaded(true);
      }
    });

    mapInstance.on('click', handleMapClick);

    return () => {
      const mapInst = map.current;
      if (!mapInst) return;
      mapInst.remove();
      map.current = null;
    };

  }, []);



  // Auto-navigate to project location or first plot on load
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    // Check if we've already navigated in this component instance
    if (hasNavigatedRef.current) return;

    // Priority 1: Use first plot's centroid if available
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

          // Trigger map update after navigation completes
          map.current.once('moveend', () => {
            if (map.current) {
              hasNavigatedRef.current = true;
              console.log('âœ… Marked as navigated (session)');

              // Trigger single repaint
              map.current.triggerRepaint();

              // Auto-select immediately
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

    // Priority 2: Use project location if no plots exist
    if (activeProject?.location && typeof activeProject.location === 'object') {
      const { lat, lng } = activeProject.location as { lat: number, lng: number };
      if (lat && lng) {
        console.log('âœˆï¸ Flying to project location:', { lat, lng });
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

  // Keep a stable ref to plots so road detection doesn't re-register on every plot update
  const plotsRef = useRef(plots);
  useEffect(() => { plotsRef.current = plots; }, [plots]);

  // Track in-flight road detections to prevent redundant toasts/requests
  const pendingRoadDetections = useRef<Set<string>>(new Set());

  // Automatic Road Detection — only registers once per map load
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    const detectRoads = () => {
      if (map.current?.isMoving()) return;

      plotsRef.current.forEach(plot => {
        if (!plot.geometry || !plot.visible) return;

        // "Fetch Once" Logic: Skip if already detected or currently in flight
        if (plot.roadAccessSides !== undefined || pendingRoadDetections.current.has(plot.id)) return;

        pendingRoadDetections.current.add(plot.id);
        console.log(`[Road Debug] Detecting roads for Plot ${plot.id} using Source Query...`);

        // Use querySourceFeatures to get raw vector data from 'composite' source
        // This bypasses style visibility/layer naming issues in Mapbox Standard
        const roadFeatures = map.current!.querySourceFeatures('composite', {
          sourceLayer: 'road'
        });

        // Filter roads that are close to the plot
        // We need to check intersection with the plot's expanded bounding box
        const searchPoly = turf.buffer(plot.geometry as any, 0.05, { units: 'kilometers' }); // 50m buffer

        const relevantRoads = roadFeatures.filter(f => {
          // Geometry must be LineString or MultiLineString
          if (f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString') return false;

          // Check intersection with our buffered plot
          // Note: features from querySourceFeatures might be split across tiles, causing duplicates
          // But for detection, duplicates are acceptable.
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

        // determineAccessSides helper (Strict Proximity)
        const determineAccessSides = (features: any[]) => {
          const bbox = turf.bbox(plot.geometry);
          const [minX, minY, maxX, maxY] = bbox;

          // Define 4 edge lines of the plot bounding box
          const nLine = turf.lineString([[minX, maxY], [maxX, maxY]]);
          const sLine = turf.lineString([[minX, minY], [maxX, minY]]);
          const eLine = turf.lineString([[maxX, minY], [maxX, maxY]]);
          const wLine = turf.lineString([[minX, minY], [minX, maxY]]);

          // Create detection zones (20m buffer around each edge)
          // Note: using 0.025 km = 25m to be safe but precise
          const bufferDist = 0.025;
          const nZone = turf.buffer(nLine, bufferDist, { units: 'kilometers' });
          const sZone = turf.buffer(sLine, bufferDist, { units: 'kilometers' });
          const eZone = turf.buffer(eLine, bufferDist, { units: 'kilometers' });
          const wZone = turf.buffer(wLine, bufferDist, { units: 'kilometers' });

          const accessSides = new Set<string>();

          features.forEach(rf => {
            // Check intersection with each zone
            // turf.booleanIntersects handles LineString vs Polygon (Zone)
            // We cast to 'any' to avoid some strict typing issues with turf/geojson versions if mismatched
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

          // Fallback: Use Overpass API with retry logic
          const searchArea = turf.buffer(plot.geometry as any, 0.1, { units: 'kilometers' }); // 100m buffer
          const searchBbox = turf.bbox(searchArea);

          OverpassPlacesService.fetchRoads(searchBbox as [number, number, number, number])
            .then(osmRoads => {
              const newSides = osmRoads.length > 0 ? determineAccessSides(osmRoads) : [];
              const oldSides: string[] = plot.roadAccessSides || [];
              const hasChanged = newSides.length !== oldSides.length || !newSides.every((s: string) => oldSides.includes(s));

              console.log(`[Road Debug] Overpass returned ${osmRoads.length} roads. Access:`, newSides);

              // Save result (IMPORTANT: Save even if empty to prevent re-fetch loop)
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
    // Only re-register when map loads — plots are read via plotsRef to avoid re-registering on every plot update
  }, [isMapLoaded, actions]);

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

          console.log('Threebox initialized with shared depth buffer');
        }
      },
      render: function (gl, matrix) {
        if (window.tb) {
          try {
            window.tb.update();
          } catch (e) {
            // Suppress repeating errors
          }
        }
      },
    });

  }, [isMapLoaded, isThreeboxLoaded]);

  // Vastu Compass Rendering
  useEffect(() => {
    if (!window.tb || !isMapLoaded) return;

    // 1. Cleanup existing objects using our kept references
    vastuObjectsRef.current.forEach(obj => {
      try {
        window.tb.remove(obj);
      } catch (e) {
        console.warn('Failed to remove Vastu object', e);
      }
    });
    vastuObjectsRef.current = [];

    // 2. Add if enabled
    if (uiState?.showVastuCompass && plots.length > 0) {
      const THREE = window.tb.THREE || window.THREE;
      if (!THREE) return;

      plots.forEach(plot => {
        // Calculate bbox center for accurate positioning
        const bbox = turf.bbox(plot.geometry);
        const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

        // Radius: Make it fit within plot
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





  // Render Amenity Markers
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    // Clear existing markers
    markers.current.forEach(marker => marker.remove());
    markers.current = [];

    const amenities = activeProject?.locationData?.amenities;
    if (!amenities || amenities.length === 0) return;

    amenities.forEach((amenity: Amenity) => {
      // Create element
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

      // Create Popup
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

    // Optional: Fit bounds? Maybe too intrusive on every update.
    // For now, let the user pan/zoom manually or use simple flyTo on setLocationData action if needed.

  }, [isMapLoaded, activeProject?.locationData?.amenities]);


  // Move cleanupOverlays to a reusable callback
  const cleanupOverlays = useCallback(() => {
    if (!map.current) return;

    // Cleanup Mapbox Heatmap Layer
    const heatmapId = 'solar-ground-heatmap';
    if (map.current.getLayer(heatmapId)) map.current.removeLayer(heatmapId);

    // Cleanup Wall Analysis Layer
    const wallLayerId = 'analysis-walls';
    const wallSourceId = 'analysis-walls-source';
    if (map.current.getLayer(wallLayerId)) map.current.removeLayer(wallLayerId);

    // Cleanup Wind Direction Layer (old arrows)
    const windDirId = 'wind-direction';
    if (map.current.getLayer(windDirId)) map.current.removeLayer(windDirId);

    // Cleanup Wind Streamline Layer
    if (windStreamlineLayer.current && map.current.getLayer('wind-streamlines')) {
      map.current.removeLayer('wind-streamlines');
      windStreamlineLayer.current = null;
    }

    // Now cleanup sources after layers are gone
    if (map.current.getSource(heatmapId)) map.current.removeSource(heatmapId);
    if (map.current.getSource(wallSourceId)) map.current.removeSource(wallSourceId);
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

  // Execute Map Commands (e.g., flyTo from Location Panel)
  useEffect(() => {
    if (!map.current || !isMapLoaded || !mapCommand) return;

    if (mapCommand.type === 'flyTo') {
      map.current.flyTo({
        center: mapCommand.center,
        zoom: mapCommand.zoom || 15,
        essential: true,
        duration: 1500
      });

      // Clear the command after executing
      useBuildingStore.setState({ mapCommand: null });
    }
  }, [mapCommand, isMapLoaded]);

  // Monitor toggle to reset analysis
  useEffect(() => {
    if (!isSimulatorEnabled) {
      setAnalysisMode('none');
      cleanupOverlays();
    }
  }, [isSimulatorEnabled, setAnalysisMode, cleanupOverlays]);


  const resetBuildingColors = (forcedColor?: string) => {
    if (!map.current) return;

    plots.forEach(plot => {
      plot.buildings.forEach(building => {
        // Reset each building's floors to their original color (or forced color)
        const colorToApply = forcedColor || getBuildingColor(building.intendedUse);

        building.floors.forEach(floor => {
          const layerId = `building-floor-fill-${floor.id}-${building.id}`;

          if (map.current!.getLayer(layerId)) {
            try {
              map.current!.setPaintProperty(layerId, 'fill-extrusion-color', colorToApply);
            } catch (e) {
              console.warn(`[MAP EDITOR] Failed to reset color for ${layerId}`, e);
            }
          }
        });
      });
    });
  };

  // Effect: Run Visual Analysis when mode/date changes or buildings change
  useEffect(() => {
    if (!isMapLoaded) return;

    if (analysisMode === 'none') {
      cleanupOverlays();
      resetBuildingColors();
      if (window.tb) window.tb.repaint();
      return;
    }

    // For analysis modes: small debounce to batch rapid changes
    const timer = setTimeout(async () => {
      // Collect buildings from STORE
      const allBuildings = plots.flatMap(p => p.buildings);

      if (allBuildings.length === 0) {
        console.warn('[MAP EDITOR] No buildings found for analysis');
        return;
      }

      console.log(`[MAP EDITOR] Running ${analysisMode} on ${allBuildings.length} buildings...`);

      cleanupOverlays(); // Clear previous results before adding new ones
      resetBuildingColors('#eeeeee'); // Reset buildings to neutral grey so walls are visible

      // ── STEP 0: Fetch weather data FIRST so ALL analysis phases use it ──
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

      // --- STEP 1: PER-FACE WALL ANALYSIS (now with weatherData) ---
      const wallFeatures = await runWallAnalysis(allBuildings, allBuildings, analysisMode, solarDate, activeGreenRegulations, weatherData);

      console.log('[MAP EDITOR] Wall Analysis complete, features:', { count: wallFeatures.features.length });

      // Mapbox-native fill-extrusion for building analysis
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
          }, LABELS_LAYER_ID); // Place below labels
        }
      }

      // --- STEP 2: GROUND HEATMAP ANALYSIS ---
      if (map.current && plots.length > 0) {
        try {
          console.log('[MAP EDITOR] Running Ground Analysis...');
          
          // 2a. Run Ground Analysis (Heatmap)
          const groundPoints = await runGroundAnalysis(
            plots[0].geometry,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations,
            weatherData
          );

          // 2b. Run Visual Analysis (Building Stats)
          const buildingResults = await runVisualAnalysis(
            allBuildings,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations,
            weatherData
          );

          // NEW: Calculate Aggregate Stats and Update Project State
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

          // ── Apply analysis colors to building floor layers ──
          if (buildingResults.size > 0 && map.current) {
            buildingResults.forEach((result: any, buildingId: string) => {
              const building = allBuildings.find(b => b.id === buildingId);
              if (!building) return;
              
              const analysisColor = result.color || '#eeeeee';
              building.floors.forEach((floor: any) => {
                const layerId = `building-floor-fill-${floor.id}-${building.id}`;
                if (map.current!.getLayer(layerId)) {
                  try {
                    map.current!.setPaintProperty(layerId, 'fill-extrusion-color', analysisColor);
                  } catch (e) {
                    // Layer might not support color change
                  }
                }
              });
            });
            console.log(`[MAP EDITOR] Applied analysis colors to ${buildingResults.size} buildings`);
          }

          // Apply colors to ground heatmap
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
              // Determine color ramp based on mode
              // For Wind/Sun: Use Compliance Ramp (Red=Bad, Green=Good)
              // This matches the building wall colors for visual consistency
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

              map.current.addLayer({
                id: heatmapId,
                type: 'heatmap',
                source: heatmapId,
                paint: {
                  // Weight based on 'weight' property (0-1)
                  'heatmap-weight': ['get', 'weight'] as any,
                  // Intensity increases with zoom
                  'heatmap-intensity': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 0.7,  // Slightly reduced from 0.8
                    18, 1.8   // Slightly reduced from 2.0
                  ] as any,
                  'heatmap-color': colorRamp as any,
                  'heatmap-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 20,  // Reduced from 30
                    20, 40   // Reduced from 50
                  ] as any,
                  'heatmap-opacity': 0.7
                }
              }, LABELS_LAYER_ID); // Place below labels
            }

            // --- WIND STREAMLINES (Animated) ---
            if (analysisMode === 'wind') {
              // Remove old arrow layer if it exists
              const windDirId = 'wind-direction';
              if (map.current.getLayer(windDirId)) {
                map.current.removeLayer(windDirId);
              }

              // Get current wind direction from weather data
              const currentHour = solarDate.getHours();
              const windDir = (weatherData && weatherData.hourly) ? weatherData.hourly.windDirection[currentHour] : 45;

              // Add streamline layer if not already added
              if (!windStreamlineLayer.current) {
                windStreamlineLayer.current = new WindStreamlineLayer('wind-streamlines');

                // Add layer to map
                if (!map.current.getLayer('wind-streamlines')) {
                  map.current.addLayer(windStreamlineLayer.current as any, LABELS_LAYER_ID);
                }

                // Initialize with buildings and wind direction
                windStreamlineLayer.current.initialize(allBuildings, windDir);
              } else {
                // Update direction dynamically
                windStreamlineLayer.current.updateWindDirection(windDir);
              }

              // Update bounds when map moves
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

    // Helper to manage Three.js lights
    const updateThreeLights = (azimuth: number, altitude: number, enabled: boolean) => {
      if (!window.tb) return;

      const THREE = window.tb.THREE || window.THREE;
      if (!THREE) return;

      const scene = window.tb.world; // Use world as root
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
        // Convert to Threebox/Mapbox World coords logic
        // Mapbox World: Z up.
        // Sun Az/Alt -> Vector
        // We use the same logic as Analysis Engine for consistency
        const lat = 28.6; // Dummy, unused for vector direction if we have Az/Alt
        // ... actually we just need normalized vector

        // Azimuth 0 = South, PI/2 = West (from sun-utils)
        // Three.js: X=East, Y=North
        // x = sin(az)*cos(alt)
        // y = -cos(az)*cos(alt)
        // z = sin(alt)

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
        // Default Threebox Lighting (if any?)
        // Usually Threebox has default lights if 'defaultLights' is true.
        // If we want to restore defaults, we might just leave this group empty.
      }

      if (window.tb) window.tb.repaint();
    };


    if (isSimulatorEnabled) {
      const center = mapInstance.getCenter();
      // Dynamically require to avoid top-level import issues if not needed
      const { getSunPosition } = require('@/lib/sun-utils');
      const { azimuth, altitude } = getSunPosition(solarDate, center.lat, center.lng);

      // 1. Sync Mapbox Native Light (for fill-extrusion)
      // Azimuth: Sun 0(S) -> Map 180(S). Sun 90(W) -> Map 270(W).
      // Map = (SunDeg + 180) % 360
      const azDeg = (azimuth * 180 / Math.PI + 180) % 360;

      // Polar: Sun Alt 0 -> Map Polar 90. Sun Alt 90 -> Map Polar 0.
      const polarDeg = 90 - (altitude * 180 / Math.PI);

      // Safety clamp
      // Safety clamp
      const safePolar = Math.max(0, Math.min(90, polarDeg));

      // 1. Sync Mapbox Standard Style Lighting
      // Mapbox Standard style uses 'lightPreset' config and handles sun position automatically based on that preset.
      // We map our solar time to these presets.

      const hour = solarDate.getHours();
      let preset = 'day';
      if (hour >= 5 && hour < 8) preset = 'dawn';
      else if (hour >= 8 && hour < 17) preset = 'day';
      else if (hour >= 17 && hour < 20) preset = 'dusk';
      else preset = 'night';

      if (mapInstance.getStyle()?.name === 'Mapbox Standard') {
        try {
          mapInstance.setConfigProperty('basemap', 'lightPreset', preset);
          // We can also try to enable shadows if not already
          mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
        } catch (e) {
          console.warn('Failed to set lightPreset', e);
        }
      } else {
        // Fallback for non-standard styles (if any)
        try {
          // @ts-ignore - simple check to avoid TS errors if types aren't updated
          if (mapInstance.setLights) {
            // Use new API if needed, but for now just skip to avoid errors
          }
        } catch (e) { }
      }

      // 2. Sync Threebox Lights (for heatmaps/other 3D)
      // Note: We removed Threebox, but this function might still be called?


      // Legacy Threebox Initialization Removed
      // We now rely on pure Mapbox GL JS layers (fill-extrusion) which are more performant and consistent.

      // --- MANAGE SOLAR LIGHTING ---
      // Legacy Solar Lighting (Three.js) Removed
      // TODO: Implement Mapbox Native Solar/Shadow API when needed.

      // 2. Sync Threebox Lights
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

  // Legacy Threebox Effect specific to markers and trees removed.
  // We are moving to pure Mapbox GL JS rendering for consistency and performance.
  // Effect to handle drawing state
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
          // Road Preview: Show centerline + buffered fill separately
          if (drawingPoints.length === 1) {
            outlineData = turf.featureCollection([
              turf.point(drawingPoints[0])
            ]);
          } else if (drawingPoints.length >= 2) {
            const line = turf.lineString(drawingPoints);
            const buffered = turf.buffer(line, (drawingState.roadWidth / 2), { units: 'meters' });
            outlineData = turf.featureCollection([line]); // Only centerline for outline layer
            roadFillData = turf.featureCollection(buffered ? [buffered] : []); // Buffered polygon for fill
          }
        } else {
          // Standard Polygon/Point Preview
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

      // Road fill preview layer
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


  // Debug Effect: Trace Plots Data
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

  // Effect to render all plots and their contents
  useEffect(() => {
    console.log(`[MapEditor] Render Effect Triggered. isMapLoaded: ${isMapLoaded}, styleLoaded: ${styleLoaded}, mapRef: ${!!map.current}`);

    if (!isMapLoaded || !styleLoaded || !map.current) {
      if (map.current && map.current.isStyleLoaded() && !styleLoaded) {
        // Fallback: If map says style is loaded but state lags, force update
        console.log("[MapEditor] Style check passed despite state lag. Updating state...");
        setStyleLoaded(true);
      } else {
        console.warn("[MapEditor] Render Effect SKIPPED due to map state.");
        return;
      }
    }
    const mapInstance = map.current;

    // FIX: Hide standard Mapbox 3D buildings to prevent overlap glitch
    if (mapInstance.getLayer('building')) {
      mapInstance.setLayoutProperty('building', 'visibility', 'none');
    }
    if (mapInstance.getLayer('3d-buildings')) {
      mapInstance.setLayoutProperty('3d-buildings', 'visibility', 'none');
    }

    const renderedIds = new Set<string>();
    // Check if any specific component is focused/visible - Calculated once per render for entire map
    const anyComponentVisible = Object.values(componentVisibility).some(v => v);

    // PRE-CLEANUP: Remove ALL old core/unit layers before rendering new ones
    // This prevents ghost layers from persisting across renders
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

    // Ensure the label layer and source exist before we do anything else
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
          'text-opacity': ['case',
            ['boolean', ['feature-state', 'hover'], false], 1,
            ['==', ['get', 'linkedId'], 'SELECTED_ID_PLACEHOLDER'], 1, // We'll update this via setPaintProperty
            0
          ]
        },
      });
    }

    // Effect to update label visibility based on selection/hover
    // We do this separately to avoid full re-render
    if (mapInstance.getLayer(LABELS_LAYER_ID)) {
      mapInstance.setPaintProperty(LABELS_LAYER_ID, 'text-opacity', [
        'case',
        ['==', ['get', 'linkedId'], hoveredId || ''], 1,
        0
      ]);
    }


    plots.forEach(plot => {
      // Add plot area label
      if (plot.centroid) {
        allLabels.push(
          turf.point(plot.centroid.geometry.coordinates, {
            label: `${plot.area.toFixed(0)} m²`,
            id: `plot-label-${plot.id}`,
            linkedId: plot.id // Link to plot ID for selection highlight
          })
        );
      }

      // --- RENDER UTILITIES & PARKING FIRST (Bottom Layer) ---

      // 0. Green Areas (Moved to Bottom Layer)
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
          mapInstance.addLayer({
            id: areaId,
            type: 'fill',
            source: areaId,
            paint: {
              'fill-color': '#4ade80',
              'fill-opacity': 0.5,
              'fill-outline-color': '#22c55e'
            }
          }, LABELS_LAYER_ID);
        }
      });

      // 1. Parking Areas (Surface & Basements)
      plot.parkingAreas.forEach(area => {
        const areaId = `parking-area-${area.id}`;
        if (!area.geometry) return; // Skip invalid areas

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

        // Ensure layer exists and correct type
        const existingRef = mapInstance.getLayer(areaId);
        // If we want to change type (e.g. line to fill), remove it
        // Surface parking is now Fill, Basement is Line
        const isBasement = (area.type === 'Basement');
        const desiredType = isBasement ? 'line' : 'fill';

        if (existingRef && existingRef.type !== desiredType) {
          mapInstance.removeLayer(areaId);
        }

        if (!mapInstance.getLayer(areaId)) {
          if (isBasement) {
            // Render Basement as dashed outline
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
            // Surface Parking: Visible Fill (Blue Grey)
            mapInstance.addLayer({
              id: areaId,
              type: 'fill',
              source: areaId,
              paint: {
                'fill-color': '#607D8B',
                'fill-opacity': 0.5,
                'fill-outline-color': '#455A64'
              }
            }, LABELS_LAYER_ID); // Render using Label ID as reference (top), but since this runs BEFORE buildings, buildings will be added AFTER (on top)
          }
        } else {
          // Update Paint Props if needed
          if (!isBasement) {
            mapInstance.setPaintProperty(areaId, 'fill-color', '#607D8B');
            mapInstance.setPaintProperty(areaId, 'fill-opacity', 0.5);
          }
        }
      });

      // 2. Utility Areas (Roads, STP, etc.)
      const utilitiesToRender = [...(plot.utilityAreas || [])];

      utilitiesToRender.forEach(u => {
        const areaId = `utility-area-${u.id}`;
        const centerlineId = `${areaId}-centerline`;
        const isVisible = u.visible !== false;

        renderedIds.add(areaId);
        renderedIds.add(`utility-area-label-${u.id}`);

        if (!u.geometry) return; // Skip invalid utilities

        const featureData = {
          type: 'Feature',
          geometry: (u.geometry as any).type === 'Feature' ? (u.geometry as any).geometry : u.geometry,
          properties: {
            id: u.id,
            name: u.name,
            type: u.type,
            area: u.area
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
        else if (typeStr.includes('road')) color = '#546E7A';

        const isRoad = u.type === 'Roads' || u.type === 'AppRoads' as any;

        if (!mapInstance.getLayer(areaId)) {
          if (isRoad) {
            mapInstance.addLayer({
              id: areaId,
              type: 'fill',
              source: areaId,
              layout: { 'visibility': isVisible ? 'visible' : 'none' },
              paint: {
                'fill-color': color,
                'fill-opacity': 0.8,
                'fill-outline-color': '#2c3e50'
              }
            }, LABELS_LAYER_ID);

            // Add a dashed centerline for finished roads
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
            // 3D Extrusion for non-road utilities
            mapInstance.addLayer({
              id: areaId,
              type: 'fill-extrusion',
              source: areaId,
              layout: { 'visibility': isVisible ? 'visible' : 'none' },
              paint: {
                'fill-extrusion-color': color,
                'fill-extrusion-height': 2.5,
                'fill-extrusion-opacity': 0.7,
                'fill-extrusion-base': 0
              }
            }, LABELS_LAYER_ID);
          }
        } else {
          // Layer already exists — update paint and visibility
          if (isRoad) {
            if (mapInstance.getLayer(areaId)?.type === 'fill') {
              mapInstance.setPaintProperty(areaId, 'fill-color', color);
            }
          } else {
            if (mapInstance.getLayer(areaId)?.type === 'fill-extrusion') {
              mapInstance.setPaintProperty(areaId, 'fill-extrusion-color', color);
            }
          }
          // Always sync visibility via setLayoutProperty (correct Mapbox approach)
          try {
            mapInstance.setLayoutProperty(areaId, 'visibility', isVisible ? 'visible' : 'none');
            if (mapInstance.getLayer(centerlineId)) {
              mapInstance.setLayoutProperty(centerlineId, 'visibility', isVisible ? 'visible' : 'none');
            }
          } catch (e) {
            // Layer might not support visibility toggle in rare cases
          }
        }
      });

      // Add building labels

      plot.buildings.forEach(building => {
        if (building.centroid) {
          let labelText = `${building.name}\n${building.intendedUse}\n${building.area.toFixed(0)} m²`;

          allLabels.push(
            turf.point(building.centroid.geometry.coordinates, {
              label: labelText,
              id: `building-label-${building.id}`,
              linkedId: building.id // Link to building ID for hover
            })
          );
        }




        // --- RENDER BUILDING FLOORS (NEW) ---
        // --- RENDER BUILDING FLOORS (NEW) ---


        if (building.floors && building.floors.length > 0) {
          // Separate basement and superstructure floors
          const basementFloors = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || f.type === 'Parking'
          );
          const superstructureFloors = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || f.type === 'Parking')
          );



          // Determine which floors to render based on Ghost Mode and basement visibility toggle
          let floorsToRender = building.floors.filter(f => {
            // Always hide utility floors
            if (f.type === 'Utility') return false;

            const isBasement = (f.level !== undefined && f.level < 0) || f.type === 'Parking';

            // In Ghost Mode, respect the basement visibility toggle
            if (uiState.ghostMode) {
              if (isBasement) {
                return componentVisibility.basements; // Only show basements if toggled on
              }
              return true; // Show all non-basement floors
            }

            // In normal mode, hide basements
            return !isBasement;
          });

          // CRITICAL: Sort floors so basements (level < 0) render FIRST (at bottom of stack)
          floorsToRender = [...floorsToRender].sort((a, b) => {
            const aLevel = a.level ?? (a.type === 'Parking' ? -1 : 999);
            const bLevel = b.level ?? (b.type === 'Parking' ? -1 : 999);
            return aLevel - bLevel; // Ascending: basements (-2, -1) before ground (0) before upper (1, 2, 3...)
          });

          // --- CALCULATE OFFSETS FOR GHOST MODE ---
          const basementFloorsCalc = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking'
          );
          const totalBasementHeight = basementFloorsCalc.reduce((sum, f) => sum + f.height, 0);

          // Only lift building if basements are actually visible
          const heightOffset = 0; // Always start at 0 (Ground)
          const shouldLiftForBasements = uiState.ghostMode && componentVisibility.basements;
          // Calculate Visual Top
          const superstructureFloorsCalc = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking')
          );
          const superstructureHeight = superstructureFloorsCalc.reduce((sum, f) => sum + (f.height || 3), 0);
          // Exclude Utility floors - they are not rendered, so should not inflate building height
          const superstructureFloorsCalcFiltered = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking') &&
            f.type !== 'Utility'
          );
          const superstructureHeightFinal = superstructureFloorsCalcFiltered.reduce((sum, f) => sum + (f.height || 3), 0);
          const visualBuildingTop = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0) + superstructureHeightFinal;
          const effectiveBase = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0);

          // --- RENDER INTERNAL LAYOUT (UTILITIES -> CORES & UNITS) FIRST ---
          // Render Opaque internals BEFORE Transparent Shell to fix Depth Buffer occlusion

          // Utilities (Render FIRST to be inside)
          if (building.internalUtilities) {
            building.internalUtilities.forEach((util: UtilityArea) => {
              const layerId = `util-${building.id}-${util.id}`;
              renderedIds.add(layerId);

              // Electrical/HVAC Opacity: 0.8 in Ghost Mode (Solid-ish)
              let utilOpacity = 0.0;
              let utilHeight = 0;
              let utilBase = 0;
              let utilColor = '#CCCCCC';

              // Building top calculation (Using shared calculation)
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

                utilBase = effectiveBase;  // Start at effective ground (accounts for basement lift)
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
                utilBase = buildingTop + heightOffset;
                utilHeight = buildingTop + 3.0 + heightOffset;
                utilColor = '#C0C0C0';
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

          // Pre-compute floor heights map for accurate 3D placement
          const floorDict: Record<string, { baseHeight: number, height: number }> = {};
          let fdCurrentBase = building.baseHeight || 0;
          floorsToRender.forEach(f => {
            floorDict[f.id] = { baseHeight: fdCurrentBase, height: fdCurrentBase + f.height };
            fdCurrentBase += f.height;
          });

          // Cores Layer (Unified) – each core spans the full building height
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

            // Deduplicate by base coreId (format: floorId-c-originalId → we use the original id)
            // Since we may have one logical core per floor, render one representative per unique geometry
            const seenGeoKeys = new Set<string>();
            const features: Feature[] = [];
            building.cores.forEach((core: Core) => {
              // Use a geometry fingerprint to deduplicate identical footprints
              const geoKey = JSON.stringify(core.geometry.geometry.coordinates);
              if (seenGeoKeys.has(geoKey)) return;
              seenGeoKeys.add(geoKey);

              features.push({
                ...core.geometry,
                properties: {
                  ...core.geometry.properties,
                  height: visualBuildingTop,
                  // Tower cores extend to ground level so the shaft visually passes through the podium
                  base_height: building.id.endsWith('-tower') ? 0 : effectiveBase,
                  coreId: core.id
                }
              } as Feature);
            });

            const coreGeoData = { type: 'FeatureCollection', features } as FeatureCollection;
            const usePattern = !(uiState.ghostMode || building.internalsVisible === true);
            const patternName = 'texture-Institutional';

            let cSource = mapInstance.getSource(layerId) as GeoJSONSource;
            if (cSource) cSource.setData(coreGeoData as any);
            else mapInstance.addSource(layerId, { type: 'geojson', data: coreGeoData as any });

            if (!mapInstance.getLayer(layerId)) {
              const paintProps: any = {
                'fill-extrusion-color': '#9370DB',
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

          // Units Layer (Unified) – per-floor instances
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

            const SLAB_GAP = 0.35; // metres left unoccupied at top of each floor (visible slab line)
            const features: Feature[] = [];
            building.units.forEach((unit: Unit) => {
              const fBounds = floorDict[unit.floorId || ''];
              if (!fBounds) return;

              // Shorten the unit extrusion slightly to leave a visible slab at each floor boundary
              const unitTop = Math.max(fBounds.baseHeight, fBounds.height - SLAB_GAP);

              features.push({
                ...unit.geometry,
                properties: {
                  ...unit.geometry.properties,
                  height: unitTop,
                  base_height: fBounds.baseHeight,
                  color: unit.color || '#ADD8E6',
                  unitId: unit.id
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

          // --- RENDER FLOORS (SHELL) LAST (BACKGROUND/CONTEXT) ---
          // Revert "Exploded View" - user rejected it.
          // Render floors upwards from currentBase
          // If basements are HIDDEN, start from ground (0) to keep building grounded
          // If basements are VISIBLE, start from ground (0) and stack basements first
          // NOTE: We do NOT add offsets here because 'floorsToRender' handles the stack order
          let currentBase = building.baseHeight || 0;
          floorsToRender.forEach((floor, fIndex) => {
            // Determine Color: Grey for Parking/Basement, otherwise Building Intended Use
            // Robust check for Parking (case-insensitive) just in case
            const typeLower = (floor.type || '').toLowerCase();
            const isBasementOrParking = (floor.level !== undefined && floor.level < 0) || typeLower === 'parking';

            // CRITICAL FIX: Use floor-specific intended use if available (for Mixed Use vertical stacking)
            // Fallback to building-level intended use if not set on floor
            const floorUse = floor.intendedUse || building.intendedUse;

            const builtColor = getBuildingColor(floorUse);
            const intendedColor = isBasementOrParking ? '#555555' : builtColor;

            // --- Slabs & Walls Rendering Strategy ---
            const slabHeight = 0.3; // 30cm Concrete Slab

            // GEOMETRY REFINEMENT: Inset the wall to create balconies/overhangs
            // This relieves the "sharp edge" / blocky look by adding depth
            let wallGeometry = building.geometry;
            try {
              // Inset by 0.5 meters to create a balcony effect
              const buffered = turf.buffer(building.geometry, -0.0005, { units: 'kilometers' }); // 0.5m inset
              if (buffered) wallGeometry = buffered as any;
            } catch (e) {
              console.warn('Failed to buffer wall geometry', e);
            }

            // 1. Render Structural Slab (White Concrete Band) - Uses ORIGINAL Geometry (Outer)
            // UPDATE: Render Slabs even in Ghost Mode to provide "Skeleton" visual
            const slabLayerId = `building-slab-${floor.id}-${building.id}`;
            renderedIds.add(slabLayerId);

            const userOpacity = building.opacity !== undefined ? building.opacity : 1.0;

            // Slab Opacity: Use user setting in Ordinary Mode. In Ghost Mode, set to 0.0.
            const slabOpacity = uiState.ghostMode ? 0.0 : userOpacity;

            const slabGeo = {
              ...building.geometry,
              properties: {
                ...building.geometry.properties,
                height: currentBase + slabHeight,
                base_height: currentBase,
                color: '#EEEEEE' // White/Light Grey Concrete
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

            // 2. Render Wall/Glass (Usage Colored) - Uses INSET Geometry (Inner)
            const floorTop = currentBase + floor.height;
            const floorLayerId = `building-floor-fill-${floor.id}-${building.id}`;
            renderedIds.add(floorLayerId);

            // Ghost Mode Logic - Different opacity for basements vs superstructure
            // Superstructure (Normal Floors): 0.0 Opacity (Invisible Skin) to show internal Units clearly
            // Basements: 0.7 Opacity (Visible) - Ensure distinct from 0.0

            // Check if any internal element of THIS building is selected (Granular Ghost Mode)
            const isInternalSelected = selectedObjectId && (
              building.internalUtilities?.some(u => u.id === selectedObjectId.id) ||
              building.cores?.some(c => c.id === selectedObjectId.id) ||
              building.units?.some(u => u.id === selectedObjectId.id)
            );

            // NEW OPACITY LOGIC for Floors - "Skeleton Mode"
            let opacity = userOpacity;
            if (building.internalsVisible === true || anyComponentVisible) {
              // If focused on internals globally OR specifically for this building, make WALLS invisible (0.0)
              opacity = 0.0;
              // Exception: If showing basements, basement floors stay visible
              if ((componentVisibility.basements || building.internalsVisible === true) && floor.parkingType === 'Basement') {
                opacity = 0.9;
              }
            } else if (uiState.ghostMode) {
              // In Ghost Mode
              if (floor.parkingType === 'Basement') opacity = 0.8; // User requested "add opacity for basement parking"
              else opacity = 0.0; // INVISIBLE WALLS to fix "Glassy Block"
            }

            if (isInternalSelected) opacity = 1.0;

            const floorGeo = {
              ...wallGeometry, // Use the Inset Geometry here!
              properties: {
                ...building.geometry.properties,
                height: floorTop, // Top of floor
                base_height: currentBase + slabHeight, // Start *above* the slab
                color: intendedColor || floor.color || '#cccccc'
              }
            };

            let fSource = mapInstance.getSource(floorLayerId) as GeoJSONSource;
            if (fSource) fSource.setData(floorGeo);
            else mapInstance.addSource(floorLayerId, { type: 'geojson', data: floorGeo });

            if (!mapInstance.getLayer(floorLayerId)) {
              // Determine if we should use a pattern
              const usePattern = !uiState.ghostMode && !isBasementOrParking;
              // Use floor-specific texture if available (e.g. texture-Residential, texture-Commercial)
              const patternName = `texture-${floorUse}`;

              const paintProps: any = {
                'fill-extrusion-color': usePattern ? '#ffffff' : ['get', 'color'],
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': opacity
              };

              // Only add pattern if we intend to use it, to avoid "null/undefined" crash
              if (usePattern) {
                paintProps['fill-extrusion-pattern'] = patternName;
              }

              mapInstance.addLayer({
                id: floorLayerId,
                type: 'fill-extrusion',
                source: floorLayerId,
                paint: paintProps
              }, LABELS_LAYER_ID);
            } else {
              const usePattern = !uiState.ghostMode && !isBasementOrParking;
              const patternName = `texture-${floorUse}`;

              mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-opacity', opacity);
              // Update Pattern & Color
              if (usePattern) {
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', patternName);
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', '#ffffff');
              } else {
                // Use undefined to unset property in strict Mapbox TS/JS
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', undefined); // Clear pattern
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', ['get', 'color']);
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
              label: `${area.name}\n(${area.type})\n${area.area.toFixed(0)} m²`,
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

    // Consolidate footprints
    const allBuildingFootprints: Feature<Polygon>[] = [];

    plotsRendering.forEach(plot => {
      const plotId = plot.id;
      // Debug Rendering
      if (plotsRendering.length > 0 && plot === plotsRendering[0]) {
        console.log(`[MapEditor] Rendering Plot ${plotId}`, {
          geometryType: plot.geometry?.type,
          hasCoordinates: !!(plot.geometry as any)?.coordinates,
          isSelected: plotId === selectedObjectId?.id,
          entriesCount: plot.entries?.length || 0 // Added entries debug
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

      // Normalize Feature to Geometry
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
          // turf.buffer works with Features too, but passing raw geometry is safer contextually
          setbackPolygon = turf.buffer(plot.geometry as any, -plot.setback, { units: 'meters' });
        }
      } catch (e) {
        console.warn("[Setback Debug] Buffer FAILED for plot", plot.id, e);
        setbackPolygon = plot.geometry;
      }

      let sourceBase = mapInstance.getSource(plotBaseSourceId) as GeoJSONSource;

      // Strict Validation on the Normalized Geometry
      let validNormalizedGeometry = geometryToRender;
      if (!validNormalizedGeometry || typeof validNormalizedGeometry !== 'object' || !validNormalizedGeometry.type || !(validNormalizedGeometry as any).coordinates) {
        console.warn(`[MapEditor] âŒ Invalid Geometry Object for Plot ${plotId}`, validNormalizedGeometry);
      }

      const dataToRender = validNormalizedGeometry || plot.geometry; // Fallback to raw if normalization fails but maybe it's still renderable?


      if (sourceBase) {
        if (dataToRender) sourceBase.setData(dataToRender);
      } else {
        if (dataToRender) mapInstance.addSource(plotBaseSourceId, { type: 'geojson', data: dataToRender });
      }

      if (!mapInstance.getLayer(plotBaseLayerId)) {
        if (dataToRender) { // Only add layer if source valid
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
                uiState.ghostMode ? 0.2 : 0.6, // Low opacity in Ghost Mode
                uiState.ghostMode ? 0.05 : 0.1
              ]
            }
          }, LABELS_LAYER_ID);
        }
      } else {
        // Update selection highlight if layer exists
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-color', '#4a5568'); // Always use base color, no green highlight
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-opacity', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          0.1, // Keep opacity low even when selected
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
            'text-offset': [0, 0], // Center
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
        // Accumulate footprints for single-layer rendering
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
        // renderedIds.add(gateLabelLayerId);

        // Create GeoJSON feature collection from gates
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

        // Add or update source
        let gateSource = mapInstance.getSource(gateSourceId) as GeoJSONSource;
        if (gateSource) {
          gateSource.setData(gateCollection as any);
        } else {
          mapInstance.addSource(gateSourceId, {
            type: 'geojson',
            data: gateCollection as any
          });
        }

        // Add circle layer for gate markers
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
        paint: { 'fill-color': '#000', 'fill-opacity': 0 } // Invisible, hits only
      }, LABELS_LAYER_ID); // Ensure it is below labels

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
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('building-floor-fill-') || layerId.startsWith('building-slab-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-') || layerId.startsWith('util-') || layerId.startsWith('utility-area-') || layerId.startsWith('core-') || layerId.startsWith('unit-') || layerId.startsWith('units-') || layerId.startsWith('cores-') || layerId.startsWith('electrical-') || layerId.startsWith('hvac-') || layerId.startsWith('gates-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('building-floor-fill-') || sourceId.startsWith('building-slab-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-') || sourceId.startsWith('util-') || sourceId.startsWith('utility-area-') || sourceId.startsWith('core-') || sourceId.startsWith('unit-') || sourceId.startsWith('units-') || sourceId.startsWith('cores-') || sourceId.startsWith('electrical-') || sourceId.startsWith('hvac-') || sourceId.startsWith('gates-');

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
      // Query specific interactive layers
      // We check for: Buildings (hit layer), Utilities (prefix), Roads
      const { componentVisibility: cv, uiState: us, plots } = getStoreState();
      const internalsVisible = cv.units || cv.cores || cv.electrical || cv.hvac || us.ghostMode;

      const features = m.queryRenderedFeatures(e.point).filter(f => {
        const lid = f.layer?.id;
        if (!lid) return false;
        
        const isInternal = lid.startsWith('cores-') || lid.startsWith('units-') || lid.startsWith('util-');
        if (isInternal) {
            // Check actual painted opacity to perfectly match what's visible
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
            // @ts-ignore
            const area = props.area || turf.area(f);
            // @ts-ignore
            const line = turf.polygonToLine(f.geometry);
            // @ts-ignore
            const perimeter = turf.length(line, { units: 'meters' });

            if (area && perimeter) {
              const s = perimeter / 2;
              const disc = (s * s) - (4 * area);
              let l = 0, w = 0;
              if (disc >= 0) {
                l = (s + Math.sqrt(disc)) / 2;
                w = (s - Math.sqrt(disc)) / 2;
              } else {
                l = Math.sqrt(area);
                w = l;
              }
              dims = `${Math.round(Math.max(l, w))}m x ${Math.round(Math.min(l, w))}m`;
            }
          } catch (e) { }

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Building'}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${props.use || ''}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${props.floors || 0} Fl • ${Math.round(props.height || 0)}m</div>
            ${dims ? `<div class="text-xs text-neutral-600 mt-0.5" style="color: #525252;">Size: ${dims}</div>` : ''}
          `;
        } else if (f.layer?.id.startsWith('utility-area-') || f.layer?.id.startsWith('parking-area-')) {
          const typeLabel = props.type || (f.layer?.id.startsWith('parking-area-') ? 'Parking' : 'Utility');
          const areaLabel = props.area ? `${Math.round(props.area)} m²` : '';
          const capacityLabel = props.capacity ? `<div class="text-xs text-neutral-600">Capacity: ${props.capacity} cars</div>` : '';

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${typeLabel}</div>
            ${areaLabel ? `<div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Area: ${areaLabel}</div>` : ''}
            ${capacityLabel}
          `;
        } else if (f.layer?.id.startsWith('gates-circle-')) {
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Gate'}</div>
          `;
        } else if (f.layer?.id.startsWith('cores-')) {
          const area = turf.area(f as any);
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">Core</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Vertical Circulation</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Footprint Area: ${area.toFixed(1)} m²</div>
          `;
        } else if (f.layer?.id.startsWith('util-')) {
          const typeLabel = props.type || 'Utility Shaft';
          const area = turf.area(f as any);
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Internal ${typeLabel}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Footprint Area: ${area.toFixed(1)} m²</div>
          `;
        } else if (f.layer?.id.startsWith('units-')) {
          const typeLabel = props.type || 'Unit';
          const area = turf.area(f as any);
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">Internal Unit Layout</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">Area: ${area.toFixed(1)} m²</div>
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

      {/* Terrain Toggle Button */}
      <div className="absolute top-4 right-14 z-10 bg-background/90 backdrop-blur rounded-md border shadow-sm p-1 flex items-center gap-1">
        <button
          onClick={() => {
            const newStatus = !isTerrainEnabled;
            setIsTerrainEnabled(newStatus);
            if (map.current) {
              // Toggle Terrain: use null to fully deactivate (exaggeration:0 still activates
              // the terrain pipeline and distorts fill-extrusion geometry)
              if (newStatus) {
                map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.0 });
              } else {
                (map.current as any).setTerrain(null);
              }
              // Trigger repaint to update building elevations
              if (window.tb) window.tb.repaint();
            }
          }}
          className={`p-2 h-9 rounded-sm text-xs font-medium transition-colors ${isTerrainEnabled ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          title="Toggle 3D Terrain"
        >
          {isTerrainEnabled ? '⛰️ Terrain ON' : 'Analytic Flat'}
        </button>

        <div className="h-6 w-[1px] bg-border mx-1" />

        <div className="flex gap-0.5">
          {[
            { label: 'N', angle: 0 },
            { label: 'E', angle: 90 },
            { label: 'S', angle: 180 },
            { label: 'W', angle: 270 }
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
              className="w-9 h-9 flex items-center justify-center rounded-sm text-xs font-bold hover:bg-muted transition-colors text-muted-foreground hover:text-primary"
              title={`Rotate to ${dir.label}`}
            >
              {dir.label}
            </button>
          ))}
        </div>
      </div>

    </div >
  );
}
