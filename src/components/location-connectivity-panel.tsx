
'use client';

import React, { useState, useCallback } from 'react';
import { useBuildingStore, useProjectData } from '@/hooks/use-building-store';
import { OverpassPlacesService } from '@/services/overpass-places-service';
import { Amenity, AmenityCategory } from '@/services/mapbox-places-service';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, MapPin, Bus, School, Hospital, TreePine, ShoppingBag, Utensils, LocateFixed, Navigation, GraduationCap, Fuel, Building2, Landmark, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const AMENITY_CATEGORIES: { id: AmenityCategory; label: string; icon: React.ReactNode; color: string }[] = [
    { id: 'transit', label: 'Transit', icon: <Bus className="h-4 w-4" />, color: '#2196F3' },
    { id: 'school', label: 'Schools', icon: <School className="h-4 w-4" />, color: '#FF9800' },
    { id: 'college', label: 'Colleges & Universities', icon: <GraduationCap className="h-4 w-4" />, color: '#FF5722' },
    { id: 'hospital', label: 'Healthcare', icon: <Hospital className="h-4 w-4" />, color: '#F44336' },
    { id: 'park', label: 'Parks & Recreation', icon: <TreePine className="h-4 w-4" />, color: '#4CAF50' },
    { id: 'shopping', label: 'Supermarkets', icon: <ShoppingBag className="h-4 w-4" />, color: '#9C27B0' },
    { id: 'mall', label: 'Malls', icon: <Building2 className="h-4 w-4" />, color: '#673AB7' },
    { id: 'restaurant', label: 'Food & Dining', icon: <Utensils className="h-4 w-4" />, color: '#FFEB3B' },
    { id: 'atm', label: 'ATMs & Banks', icon: <Landmark className="h-4 w-4" />, color: '#009688' },
    { id: 'petrol_pump', label: 'Petrol Pumps', icon: <Fuel className="h-4 w-4" />, color: '#607D8B' },
];

export function LocationConnectivityPanel() {
    const activeProject = useProjectData();
    const plots = useBuildingStore((state) => state.plots);
    const mapCommand = useBuildingStore((state) => state.mapCommand);
    const actions = useBuildingStore((state) => state.actions);
    const { toast } = useToast();
    const [isScanning, setIsScanning] = useState(false);

    const handleAmenityClick = useCallback((amenity: Amenity) => {
        useBuildingStore.setState({
            mapCommand: {
                type: 'flyTo',
                center: amenity.coordinates,
                zoom: 16
            }
        });
    }, []);

    const center: [number, number] | null = React.useMemo(() => {
        if (plots.length > 0 && plots[0].geometry) {
            try {
                const turf = require('@turf/turf');
                const centroid = turf.centroid(plots[0].geometry);
                const [lng, lat] = centroid.geometry.coordinates;
                return [lng, lat];
            } catch (e) {
                console.error('Failed to calculate plot centroid:', e);
            }
        }
        return null;
    }, [plots]);

    const existingAmenities = activeProject?.locationData?.amenities || [];

    const [loadingCategories, setLoadingCategories] = useState<Set<string>>(new Set());

    const fetchCategory = useCallback(async (category: AmenityCategory) => {
        if (!center) return;

        setLoadingCategories(prev => new Set(prev).add(category));

        try {
            const results = await OverpassPlacesService.searchNearby(center, category);

            const current = activeProject?.locationData?.amenities || [];
            const other = current.filter((a: Amenity) => a.category !== category);
            const uniqueResults = [...other, ...results];

            actions.setLocationData(uniqueResults);
            await actions.saveCurrentProject();

            if (results.length > 0) {
                toast({ title: "Updated", description: `Found ${results.length} ${category}s.` });
            }
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: 'Error', description: `Failed to load ${category}.` });
        } finally {
            setLoadingCategories(prev => {
                const next = new Set(prev);
                next.delete(category);
                return next;
            });
        }
    }, [center, activeProject, actions, toast]);

    const handleScan = useCallback(async () => {
        if (!center) {
            toast({ variant: 'destructive', title: 'Location Missing', description: 'Project location is not set or valid.' });
            return;
        }

        setIsScanning(true);
        try {
            const allCategories = AMENITY_CATEGORIES.map(c => c.id);

            const results = await OverpassPlacesService.searchNearby(center, allCategories, 2000);

            actions.setLocationData(results);
            await actions.saveCurrentProject();
            toast({ title: 'Scan Complete', description: `Found ${results.length} amenities nearby and saved to project.` });

        } catch (error: any) {
            console.error(error);
            const msg = error?.message || 'Could not fetch amenity data.';
            toast({ variant: 'destructive', title: 'Scan Failed', description: msg });
        } finally {
            setIsScanning(false);
        }
    }, [center, actions, toast]);

    const groupedAmenities = AMENITY_CATEGORIES.map(cat => ({
        ...cat,
        items: existingAmenities.filter((a: Amenity) => a.category === cat.id)
    }));

    const formatDistance = (meters: number) => {
        if (meters < 1000) return `${meters}m`;
        return `${(meters / 1000).toFixed(1)}km`;
    };

    return (
        <div className="h-full flex flex-col w-full max-h-[calc(100vh-200px)]">
            <div className="p-4 border-b space-y-4">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <MapPin className="h-5 w-5" /> Location & Connectivity
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {activeProject?.name || 'No Project'}
                        {center && (
                            <span className="text-xs ml-2 opacity-60">
                                ({center[1].toFixed(4)}°, {center[0].toFixed(4)}°)
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex gap-2">
                    <Button
                        className="flex-1"
                        onClick={handleScan}
                        disabled={isScanning || !center}
                    >
                        {isScanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
                        {isScanning ? 'Scanning...' : 'Scan Amenities'}
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        title="Clear All Amenities"
                        onClick={() => actions.setLocationData([])}
                        disabled={existingAmenities.length === 0}
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        title="Return to Plot"
                        onClick={() => {
                            if (center) {
                                useBuildingStore.setState({ mapCommand: { type: 'flyTo', center: center, zoom: 17 } });
                            }
                        }}
                        disabled={!center}
                    >
                        <Navigation className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <ScrollArea className="flex-1 p-4">
                {existingAmenities.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <MapPin className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p>No amenities found.</p>
                        <p className="text-sm">Click scan to find nearby places.</p>
                    </div>
                ) : (
                    <Accordion
                        type="multiple"
                        className="w-full space-y-4"
                        onValueChange={(values) => {
                            values.forEach(category => {
                                const hasData = existingAmenities.some((a: Amenity) => a.category === category);
                                if (!hasData && !loadingCategories.has(category)) {
                                    fetchCategory(category as any);
                                }
                            });
                        }}
                    >
                        {AMENITY_CATEGORIES.map(category => {
                            const items = existingAmenities.filter((a: Amenity) => a.category === category.id);
                            const isLoading = loadingCategories.has(category.id);

                            return (
                                <AccordionItem key={category.id} value={category.id} className="border rounded-lg px-3">
                                    <AccordionTrigger className="hover:no-underline py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted" style={{ color: category.color, backgroundColor: `${category.color}15` }}>
                                                {category.icon}
                                            </div>
                                            <span>{category.label}</span>
                                            {isLoading ? (
                                                <Loader2 className="ml-2 h-3 w-3 animate-spin text-muted-foreground" />
                                            ) : (
                                                <Badge variant="secondary" className="ml-2 text-xs">
                                                    {items.length}
                                                </Badge>
                                            )}
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="pt-0 pb-3">
                                        <div className="space-y-2 mt-2">
                                            {items.length === 0 && !isLoading && (
                                                <div className="text-center py-2 text-muted-foreground text-xs">
                                                    No {category.label.toLowerCase()} found nearby.
                                                </div>
                                            )}

                                            {items.map((amenity: Amenity) => (
                                                <TooltipProvider key={amenity.id}>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div
                                                                onClick={() => handleAmenityClick(amenity)}
                                                                className="flex justify-between items-start text-sm p-2 bg-muted/50 rounded hover:bg-muted transition-colors cursor-pointer group"
                                                            >
                                                                <div className="flex-1">
                                                                    <div className="font-medium flex items-center gap-1">
                                                                        {amenity.name}
                                                                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            <LocateFixed className="h-3 w-3 text-primary" />
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">{amenity.address}</div>
                                                                </div>
                                                                <Badge variant={amenity.distance < 500 ? "default" : "outline"} className={cn("ml-2 whitespace-nowrap text-[10px]", amenity.distance < 500 ? "bg-green-600 hover:bg-green-700" : "")}>
                                                                    {formatDistance(amenity.distance)}
                                                                </Badge>
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-xs">
                                                            <p className="font-semibold">{amenity.name}</p>
                                                            <p className="text-xs text-muted-foreground">{amenity.address}</p>
                                                            <p className="text-xs mt-1">Click to fly to location</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                )}
            </ScrollArea>
        </div>
    );
}
