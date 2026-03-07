'use client';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, writeBatch, deleteDoc, getDoc } from 'firebase/firestore';
import type { RegulationData, GreenRegulationData, VastuRegulationData } from '@/lib/types';
import { Button } from './ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Building, Scaling, Droplets, ShieldCheck, Banknote, Trash2, Upload, Leaf, Compass, Pencil } from 'lucide-react';
import { AdminDetailsSidebar } from './admin-details-sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '@/lib/utils';
import { NewRegulationDialog } from './new-regulation-dialog';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from './ui/skeleton';
import { produce } from 'immer';
import { UploadRegulationDialog } from './upload-regulation-dialog';
import { UploadGreenRegulationDialog } from './upload-green-regulation-dialog';
import { EditGreenRegulationDialog } from './edit-green-regulation-dialog';
import { UploadVastuDialog } from './upload-vastu-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnitTemplatesPanel } from './unit-templates-panel';
import { CostRevenuePanel } from './cost-revenue-panel';
import { TimeEstimationPanel } from './time-estimation-panel';
import { PlanningParamsPanel } from './planning-params-panel';
import { NationalCodePanel } from './national-code-panel';

const DEFAULT_REGULATION_DATA: Omit<RegulationData, 'location' | 'type'> = {
    geometry: {
        setback: { desc: "General setback (if uniform)", unit: "m", value: 5, min: 0, max: 20 },
        front_setback: { desc: "Front setback from road", unit: "m", value: 6, min: 0, max: 30 },
        rear_setback: { desc: "Rear setback from boundary", unit: "m", value: 4, min: 0, max: 20 },
        side_setback: { desc: "Side setback from boundary", unit: "m", value: 3, min: 0, max: 15 },
        road_width: { desc: "Adjacent road width", unit: "m", value: 9, min: 6, max: 30 },
        max_ground_coverage: { desc: "Maximum ground coverage", unit: "%", value: 40, min: 10, max: 80 },
        floor_area_ratio: { desc: "Floor Area Ratio (FAR)", unit: "", value: 1.8, min: 0.5, max: 5 },
        max_height: { desc: "Maximum building height", unit: "m", value: 30, min: 10, max: 100 },
    },
    facilities: {
        parking: { desc: "Parking requirements per unit", unit: "spaces/unit", value: 1, min: 0.5, max: 3 },
        open_space: { desc: "Required open space per plot", unit: "%", value: 15, min: 5, max: 50 },
    },
    sustainability: {
        rainwater_harvesting: { desc: "Rainwater harvesting capacity", unit: "liters/sqm", value: 30, min: 10, max: 100 },
        solar_panels: { desc: "Solar panel area requirement", unit: "% of roof", value: 20, min: 0, max: 100 },
    },
    safety_and_services: {
        fire_safety: { desc: "Fire safety compliance level", unit: "", value: 1, min: 1, max: 3 },
    },
    administration: {
        fee_rate: { desc: "Processing fee rate", unit: "% of cost", value: 0.1, min: 0.05, max: 1 },
    }
};

export function AdminPanel() {
    const [regulations, setRegulations] = useState<RegulationData[]>([]);
    const [greenRegulations, setGreenRegulations] = useState<GreenRegulationData[]>([]);
    const [vastuRegulations, setVastuRegulations] = useState<VastuRegulationData[]>([]);

    const [selectedRegulation, setSelectedRegulation] = useState<RegulationData | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [isNewRegDialogOpen, setIsNewRegDialogOpen] = useState(false);
    const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
    const [isUploadGreenDialogOpen, setIsUploadGreenDialogOpen] = useState(false);
    const [isEditGreenDialogOpen, setIsEditGreenDialogOpen] = useState(false);
    const [selectedGreenRegulation, setSelectedGreenRegulation] = useState<GreenRegulationData | null>(null);
    const [isUploadVastuDialogOpen, setIsUploadVastuDialogOpen] = useState(false);

    const [deletingId, setDeletingId] = useState<string | null>(null);

    const regulationsCollection = collection(db, 'regulations');
    const greenRegulationsCollection = collection(db, 'greenRegulations');
    const vastuRegulationsCollection = collection(db, 'vastuRegulations');

    const fetchRegulations = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(regulationsCollection);
            const data = snapshot.docs.map(doc => doc.data() as RegulationData);
            setRegulations(data);

            const greenSnapshot = await getDocs(greenRegulationsCollection);
            const greenData = greenSnapshot.docs.map(doc => doc.data() as GreenRegulationData);
            setGreenRegulations(greenData);

            const vastuSnapshot = await getDocs(vastuRegulationsCollection);
            const vastuData = vastuSnapshot.docs.map(doc => doc.data() as VastuRegulationData);
            setVastuRegulations(vastuData);

        } catch (error) {
            console.error("Error fetching regulations:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch regulations.' });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRegulations();
    }, []);

    useEffect(() => {
        setSelectedCategory(null);
    }, [selectedRegulation]);

    const categoryDetails = useMemo(() => {
        if (!selectedRegulation || !selectedCategory) return null;

        const categoryKey = selectedCategory as keyof Omit<RegulationData, 'location' | 'type'>;
        const categoryData = selectedRegulation[categoryKey];
        const defaultCategoryData = DEFAULT_REGULATION_DATA[categoryKey];

        return {
            title: selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1).replace(/_/g, ' '),
            data: categoryData || defaultCategoryData,
            path: selectedCategory,
        }
    }, [selectedRegulation, selectedCategory]);

    const groupedRegulations = useMemo(() => {
        const groups: Record<string, RegulationData[]> = {};
        regulations.forEach(reg => {
            if (!groups[reg.location]) {
                groups[reg.location] = [];
            }
            groups[reg.location].push(reg);
        });
        // Sort keys alphabetically
        return Object.keys(groups).sort().reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {} as Record<string, RegulationData[]>);
    }, [regulations]);

    const handleUpdate = (path: string, value: any) => {
        setSelectedRegulation(produce(draft => {
            if (!draft) return;
            const keys = path.split('.');
            let current: any = draft;
            for (let i = 0; i < keys.length - 1; i++) {
                const key = keys[i];
                if (!current[key]) {
                    current[key] = {};
                }
                current = current[key];
            }
            current[keys[keys.length - 1]] = value;
        }));
    };

    const handleFullUpdate = (updatedData: any) => {
        if (!selectedRegulation || !selectedCategory) return;
        setSelectedRegulation(produce(draft => {
            if (draft) {
                (draft as any)[selectedCategory!] = updatedData;
            }
        }));
    }

    const handleSaveChanges = async () => {
        if (!selectedRegulation) return;
        setIsSaving(true);
        try {
            const docId = `${selectedRegulation.location}-${selectedRegulation.type}`.replace(/\s+/g, '-');
            const docRef = doc(regulationsCollection, docId);
            await setDoc(docRef, selectedRegulation, { merge: true });

            setRegulations(prevRegs => prevRegs.map(reg =>
                (reg.location === selectedRegulation.location && reg.type === selectedRegulation.type)
                    ? selectedRegulation
                    : reg
            ));

            toast({ title: 'Success', description: 'Changes saved successfully.' });
        } catch (error) {
            console.error("Error saving changes:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save changes.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateRegulation = async (location: string, type: string) => {
        setIsSaving(true);
        const docId = `${location}-${type}`.replace(/\s+/g, '-');
        if (regulations.some(reg => `${reg.location}-${reg.type}` === docId)) {
            toast({ variant: 'destructive', title: 'Error', description: 'This regulation already exists.' });
            setIsSaving(false);
            return;
        }

        const newRegulation: RegulationData = {
            ...JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)),
            location,
            type,
        };

        try {
            const docRef = doc(regulationsCollection, docId);
            await setDoc(docRef, newRegulation);
            setRegulations(prev => [...prev, newRegulation]);
            setSelectedRegulation(newRegulation);
            toast({ title: 'Success!', description: `${location} - ${type} has been created.` });
        } catch (error) {
            console.error("Error creating regulation:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not create new regulation.' });
        } finally {
            setIsSaving(false);
            setIsNewRegDialogOpen(false);
        }
    };

    const handleDeleteRegulation = async (location: string, type: string) => {
        const docId = `${location}-${type}`.replace(/\s+/g, '-');
        setDeletingId(docId);
        try {
            await deleteDoc(doc(regulationsCollection, docId));
            setRegulations(prev => prev.filter(reg => `${reg.location}-${reg.type}` !== docId));
            if (selectedRegulation?.location === location && selectedRegulation?.type === type) {
                setSelectedRegulation(null);
            }
            toast({ title: 'Success', description: 'Regulation deleted successfully.' });
        } catch (error) {
            console.error("Error deleting regulation:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete regulation.' });
        } finally {
            setDeletingId(null);
        }
    }

    const handleDeleteLocation = async (location: string) => {
        const locationRegulations = groupedRegulations[location];
        if (!locationRegulations || locationRegulations.length === 0) return;

        setDeletingId(location);
        try {
            const batch = writeBatch(db);
            locationRegulations.forEach(reg => {
                const docId = `${reg.location}-${reg.type}`.replace(/\s+/g, '-');
                batch.delete(doc(regulationsCollection, docId));
            });
            await batch.commit();

            setRegulations(prev => prev.filter(reg => reg.location !== location));
            if (selectedRegulation?.location === location) {
                setSelectedRegulation(null);
            }
            toast({ title: 'Success', description: `All regulations for ${location} deleted successfully.` });
        } catch (error) {
            console.error("Error deleting location regulations:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete regulations.' });
        } finally {
            setDeletingId(null);
        }
    };

    const handleExtractedRegulation = async (extractedDataArray: Partial<RegulationData>[]) => {
        if (!extractedDataArray || extractedDataArray.length === 0) {
            toast({ variant: 'destructive', title: 'Error', description: 'No regulations extracted.' });
            return;
        }

        try {
            const batch = writeBatch(db);
            let savedCount = 0;

            for (const extractedData of extractedDataArray) {
                if (!extractedData.location || !extractedData.type) {
                    continue;
                }

                const newRegulation: RegulationData = produce(
                    JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)) as RegulationData,
                    voidDraft => {
                        const draft = voidDraft as any;
                        draft.location = extractedData.location!;
                        draft.type = extractedData.type!;
                        
                        // Deep merge properties
                        const categories = ['geometry', 'facilities', 'sustainability', 'safety_and_services', 'administration'];
                        categories.forEach(cat => {
                            if ((extractedData as any)[cat]) {
                                draft[cat] = { ...draft[cat], ...(extractedData as any)[cat] };
                            }
                        });
                    }
                );

                const regulationId = `${newRegulation.location}-${newRegulation.type}`.replace(/\s+/g, '-');
                const regulationRef = doc(db, 'regulations', regulationId);
                batch.set(regulationRef, newRegulation);
                savedCount++;
            }

            if (savedCount === 0) {
                toast({ variant: 'destructive', title: 'Error', description: 'No valid regulations to save.' });
                return;
            }

            await batch.commit();
            await fetchRegulations();
            toast({
                title: 'Success',
                description: `Saved ${savedCount} regulation${savedCount > 1 ? 's' : ''} to database.`
            });
        } catch (error) {
            console.error('Error saving regulations:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to save regulations.' });
        }
    };

    const handleSaveGreenRegulation = async (data: GreenRegulationData) => {
        try {
            const id = data.id || `${data.certificationType}-${data.name.replace(/\s+/g, '-')}`.toLowerCase();
            const docRef = doc(greenRegulationsCollection, id);

            const dataToSave = {
                ...data,
                id,
                lastModified: Date.now()
            };

            await setDoc(docRef, dataToSave);
            setGreenRegulations(prev => [...prev.filter(p => p.id !== id), dataToSave]);

            toast({ title: 'Success', description: 'Green regulations saved successfully.' });
            setIsUploadGreenDialogOpen(false);
            setIsEditGreenDialogOpen(false); // Close edit dialog if open
        } catch (error) {
            console.error('Error saving green regulation:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to save green regulations.' });
        }
    };

    const handleSaveVastuRegulation = async (data: VastuRegulationData) => {
        try {
            const id = data.id || data.name.replace(/\s+/g, '-').toLowerCase();
            const docRef = doc(vastuRegulationsCollection, id);

            const dataToSave = {
                ...data,
                id,
                lastModified: Date.now()
            };

            await setDoc(docRef, dataToSave);
            setVastuRegulations(prev => [...prev.filter(p => p.id !== id), dataToSave]);

            toast({ title: 'Success', description: 'Vastu guidelines saved successfully.' });
            setIsUploadVastuDialogOpen(false);
        } catch (error) {
            console.error('Error saving vastu regulation:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save Vastu guidelines.' });
        }
    };

    const handleDeleteGreenRegulation = async (id: string) => {
        try {
            await deleteDoc(doc(greenRegulationsCollection, id));
            setGreenRegulations(prev => prev.filter(p => p.id !== id));
            toast({ title: 'Success', description: 'Green regulation deleted.' });
        } catch (error) {
            console.error('Error deleting green regulation:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete.' });
        }
    };


    const handleBackToList = () => {
        setSelectedRegulation(null);
        setSelectedCategory(null);
    };

    const categories: { key: keyof Omit<RegulationData, 'location' | 'type'>, icon: React.ElementType }[] = [
        { key: 'geometry', icon: Scaling },
        { key: 'facilities', icon: Building },
        { key: 'sustainability', icon: Droplets },
        { key: 'safety_and_services', icon: ShieldCheck },
        { key: 'administration', icon: Banknote },
    ];


    if (isLoading) {
        return (
            <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <div className="flex-1 transition-all duration-300">
                <header className="p-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-sm z-10">
                    <div className="container mx-auto flex items-center justify-between">
                        <h1 className="text-2xl font-headline font-bold">Regulations Admin</h1>
                        <div className="flex items-center gap-4">
                            {/* Actions will appear in Tabs */}
                        </div>
                    </div>
                </header>
                <main className="container mx-auto py-8">
                    <Tabs defaultValue="building" className="w-full">
                        <TabsList className="mb-4">
                            <TabsTrigger value="building">Building Regulations</TabsTrigger>
                            <TabsTrigger value="green">Green Regulations</TabsTrigger>
                            <TabsTrigger value="vastu">Vastu Guidelines</TabsTrigger>
                            <TabsTrigger value="units">Unit Types</TabsTrigger>
                            <TabsTrigger value="costs">Cost & Revenue</TabsTrigger>
                            <TabsTrigger value="time">Time & Schedule</TabsTrigger>
                            <TabsTrigger value="planning">Planning Logic</TabsTrigger>
                            <TabsTrigger value="national">National Code</TabsTrigger>
                        </TabsList>

                        <TabsContent value="building">
                            {!selectedRegulation ? (
                                <>
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-xl font-semibold">Existing Regulations</h2>
                                        <div className="flex gap-2">
                                            <Button onClick={() => setIsNewRegDialogOpen(true)}>
                                                <Plus className="mr-2 h-4 w-4" /> New Regulation
                                            </Button>
                                            <Button variant="outline" onClick={() => setIsUploadDialogOpen(true)}>
                                                <Upload className="mr-2 h-4 w-4" /> Upload Document
                                            </Button>
                                        </div>
                                    </div>

                                    {regulations.length > 0 ? (
                                        <Accordion type="single" collapsible className="w-full space-y-4">
                                            {Object.entries(groupedRegulations).map(([location, locationRegulations]) => (
                                                <AccordionItem value={location} key={location} className="relative border rounded-lg bg-card px-4 group/item">
                                                    <div className="absolute right-14 top-1/2 -translate-y-1/2 z-10">
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="icon" 
                                                                    className="h-8 w-8 text-destructive/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/item:opacity-100 transition-opacity"
                                                                    disabled={deletingId === location}
                                                                >
                                                                    {deletingId === location ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete all regulations for {location}?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        This will permanently delete all {locationRegulations.length} regulation types for this location. This action cannot be undone.
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction 
                                                                        className="bg-destructive hover:bg-destructive/90"
                                                                        onClick={() => handleDeleteLocation(location)}
                                                                    >
                                                                        Delete All
                                                                    </AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </div>
                                                    <AccordionTrigger className="hover:no-underline py-4 group pr-8">
                                                        <div className="flex items-center justify-between w-full">
                                                            <div className="flex items-center gap-4">
                                                                <span className="text-xl font-semibold text-primary">{location}</span>
                                                                <Badge variant="secondary" className="ml-2">{locationRegulations.length} Types</Badge>
                                                            </div>
                                                        </div>
                                                    </AccordionTrigger>
                                                    <AccordionContent className="pt-2 pb-6">
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pt-4">
                                                            {locationRegulations.map(reg => {
                                                                const docId = `${reg.location}-${reg.type}`.replace(/\s+/g, '-');
                                                                const isDeleting = deletingId === docId;
                                                                return (
                                                                    <Card
                                                                        key={docId}
                                                                        className="cursor-pointer hover:bg-secondary/50 transition-colors hover:shadow-lg relative group border-border/50"
                                                                        onClick={() => setSelectedRegulation(reg)}
                                                                    >
                                                                        <CardHeader>
                                                                            <div className="flex items-start justify-between">
                                                                                <Badge variant="outline" className="mb-2">{reg.type}</Badge>
                                                                                <AlertDialog>
                                                                                    <AlertDialogTrigger asChild>
                                                                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity -mr-2 -mt-2" onClick={(e) => e.stopPropagation()} disabled={isDeleting}>
                                                                                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                                                                        </Button>
                                                                                    </AlertDialogTrigger>
                                                                                    <AlertDialogContent>
                                                                                        <AlertDialogHeader>
                                                                                            <AlertDialogTitle>Delete {reg.type}?</AlertDialogTitle>
                                                                                            <AlertDialogDescription>
                                                                                                This will permanently delete the regulation for {reg.location} - {reg.type}.
                                                                                            </AlertDialogDescription>
                                                                                        </AlertDialogHeader>
                                                                                        <AlertDialogFooter>
                                                                                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                                                                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={(e) => { e.stopPropagation(); handleDeleteRegulation(reg.location, reg.type); }}>
                                                                                                Delete
                                                                                            </AlertDialogAction>
                                                                                        </AlertDialogFooter>
                                                                                    </AlertDialogContent>
                                                                                </AlertDialog>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                <div className="text-sm text-muted-foreground flex justify-between">
                                                                                    <span>Max Height:</span>
                                                                                    <span className="font-medium text-foreground">{reg.geometry?.max_height?.value || '-'}m</span>
                                                                                </div>
                                                                                <div className="text-sm text-muted-foreground flex justify-between">
                                                                                    <span>FAR:</span>
                                                                                    <span className="font-medium text-foreground">{reg.geometry?.floor_area_ratio?.value || '-'}</span>
                                                                                </div>
                                                                            </div>
                                                                        </CardHeader>
                                                                    </Card>
                                                                );
                                                            })}
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            ))}
                                        </Accordion>
                                    ) : (
                                        <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
                                            <p className="text-muted-foreground mb-4">No regulations found.</p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between mb-8">
                                        <div>
                                            <h2 className="text-2xl font-bold">{selectedRegulation.location} - {selectedRegulation.type}</h2>
                                            <p className="text-muted-foreground">Select a category to edit its parameters.</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" onClick={handleBackToList}>Back to List</Button>
                                            <Button onClick={handleSaveChanges} disabled={isSaving}>
                                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                Save Changes
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                        {categories.map(({ key, icon: Icon }) => (
                                            <Card
                                                key={key}
                                                className={cn("cursor-pointer hover:bg-secondary/50 transition-colors", selectedCategory === key && "ring-2 ring-primary")}
                                                onClick={() => setSelectedCategory(key)}
                                            >
                                                <div className="p-6 flex flex-col items-center justify-center text-center gap-4">
                                                    <Icon className="h-10 w-10 text-primary" />
                                                    <h3 className="text-lg font-semibold capitalize">{key.replace(/_/g, ' ')}</h3>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                </>
                            )}
                        </TabsContent>

                        <TabsContent value="green">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-semibold">Green Building Regulations</h2>
                                <Button variant="outline" onClick={() => setIsUploadGreenDialogOpen(true)}>
                                    <Leaf className="mr-2 h-4 w-4" /> Upload Green Document
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {greenRegulations.map(reg => (
                                    <Card
                                        key={reg.id}
                                        className="relative group border-border/50 cursor-pointer hover:bg-secondary/30 transition-colors"
                                        onClick={() => {
                                            setSelectedGreenRegulation(reg);
                                            setIsEditGreenDialogOpen(true);
                                        }}
                                    >
                                        <CardHeader>
                                            <div className="flex justify-between items-start">
                                                <Badge variant="default">{reg.certificationType}</Badge>
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedGreenRegulation(reg);
                                                            setIsEditGreenDialogOpen(true);
                                                        }}
                                                    >
                                                        <Pencil className="h-3 w-3" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete {reg.name}?</AlertDialogTitle>
                                                                <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction className="bg-destructive" onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    reg.id && handleDeleteGreenRegulation(reg.id);
                                                                }}>Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </div>
                                            <CardTitle className="text-base mt-2">{reg.name}</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-4 text-sm">
                                                <div className="space-y-2">
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Min Open Space:</span>
                                                        <span className="font-mono font-medium">{reg.constraints.minOpenSpace ? `${(reg.constraints.minOpenSpace * 100).toFixed(0)}%` : '-'}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Max Coverage:</span>
                                                        <span className="font-mono font-medium">{reg.constraints.maxGroundCoverage ? `${(reg.constraints.maxGroundCoverage * 100).toFixed(0)}%` : '-'}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Min Green Cover:</span>
                                                        <span className="font-mono font-medium">{reg.constraints.minGreenCover ? `${(reg.constraints.minGreenCover * 100).toFixed(0)}%` : '-'}</span>
                                                    </div>
                                                </div>

                                                <div className="space-y-2 pt-2 border-t border-border/30">
                                                    <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Analysis Targets</div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Sun Hours:</span>
                                                        <span className="font-mono font-medium">{reg.analysisThresholds?.sunHours?.min || '-'}h / {reg.analysisThresholds?.sunHours?.target || '-'}h</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Daylight Factor:</span>
                                                        <span className="font-mono font-medium">{reg.analysisThresholds?.daylightFactor?.min ? `${(reg.analysisThresholds.daylightFactor.min * 100).toFixed(1)}%` : '-'} / {reg.analysisThresholds?.daylightFactor?.target ? `${(reg.analysisThresholds.daylightFactor.target * 100).toFixed(1)}%` : '-'}</span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-muted-foreground">Wind Speed:</span>
                                                        <span className="font-mono font-medium">{reg.analysisThresholds?.windSpeed?.min || '-'} / {reg.analysisThresholds?.windSpeed?.target || '-'} m/s</span>
                                                    </div>
                                                </div>

                                                {/* Detailed Categories */}
                                                {reg.categories && reg.categories.length > 0 && (
                                                    <Accordion type="single" collapsible className="w-full border-t pt-2">
                                                        {reg.categories.map((category, idx) => (
                                                            <AccordionItem key={idx} value={`item-${idx}`} className="border-b-0">
                                                                <AccordionTrigger className="py-2 text-xs hover:no-underline">
                                                                    <div className="flex justify-between w-full pr-2">
                                                                        <span>{category.name}</span>
                                                                        <span className="text-muted-foreground">{category.credits.length}</span>
                                                                    </div>
                                                                </AccordionTrigger>
                                                                <AccordionContent>
                                                                    <div className="space-y-2 pl-2">
                                                                        {category.credits.map((credit, cIdx) => (
                                                                            <div key={cIdx} className="text-xs border-l-2 border-primary/20 pl-2 py-1">
                                                                                <div className="font-medium">{credit.code} {credit.name}</div>
                                                                                <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                                                                                    {credit.type === 'mandatory' && <span className="text-destructive font-semibold">MANDATORY</span>}
                                                                                    {credit.points && <span>{credit.points} Pts</span>}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </AccordionContent>
                                                            </AccordionItem>
                                                        ))}
                                                    </Accordion>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                            {greenRegulations.length === 0 && (
                                <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
                                    <p className="text-muted-foreground mb-4">No Green Regulations found.</p>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="vastu">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-semibold">Vastu Shastra Guidelines</h2>
                                <Button variant="outline" onClick={() => setIsUploadVastuDialogOpen(true)}>
                                    <Compass className="mr-2 h-4 w-4" /> Upload Vastu PDF
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {vastuRegulations.map(reg => (
                                    <Card key={reg.id || reg.name} className="relative group border-border/50">
                                        <CardHeader>
                                            <div className="flex justify-between items-start">
                                                <Badge variant="outline" className="text-xs">Vastu</Badge>
                                                {/* Delete Handler would go here */}
                                            </div>
                                            <CardTitle className="text-base mt-2">{reg.name}</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-sm text-muted-foreground mb-4">
                                                {reg.recommendations.length} Guidelines
                                            </div>
                                            <div className="space-y-2">
                                                {reg.recommendations.slice(0, 3).map((rec, idx) => (
                                                    <div key={idx} className="text-xs border-l-2 border-primary/30 pl-2">
                                                        <span className="font-semibold">{rec.category}:</span> {rec.idealDirections.join(', ')}
                                                    </div>
                                                ))}
                                                {reg.recommendations.length > 3 && (
                                                    <div className="text-xs text-muted-foreground italic">
                                                        + {reg.recommendations.length - 3} more...
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                            {vastuRegulations.length === 0 && (
                                <div className="text-center py-16 border-2 border-dashed border-border rounded-lg">
                                    <p className="text-muted-foreground mb-4">No Vastu Guidelines found.</p>
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="units">
                            <UnitTemplatesPanel />
                        </TabsContent>

                        <TabsContent value="costs">
                            <CostRevenuePanel />
                        </TabsContent>

                        <TabsContent value="time">
                            <TimeEstimationPanel />
                        </TabsContent>

                        <TabsContent value="planning">
                            <PlanningParamsPanel />
                        </TabsContent>

                        <TabsContent value="national">
                            <NationalCodePanel />
                        </TabsContent>
                    </Tabs>
                </main>
            </div>
            {categoryDetails && selectedRegulation && (
                <AdminDetailsSidebar
                    title={categoryDetails.title}
                    data={categoryDetails.data as any}
                    path={categoryDetails.path}
                    onUpdate={handleUpdate}
                    onFullUpdate={handleFullUpdate}
                    onClose={() => setSelectedCategory(null)}
                />
            )}
            <NewRegulationDialog
                isOpen={isNewRegDialogOpen}
                onOpenChange={setIsNewRegDialogOpen}
                onCreate={handleCreateRegulation}
                isSaving={isSaving}
            />
            <UploadRegulationDialog
                isOpen={isUploadDialogOpen}
                onOpenChange={setIsUploadDialogOpen}
                onExtracted={handleExtractedRegulation}
            />
            <UploadGreenRegulationDialog
                isOpen={isUploadGreenDialogOpen}
                onOpenChange={setIsUploadGreenDialogOpen}
                onExtracted={handleSaveGreenRegulation}
            />
            <UploadVastuDialog
                isOpen={isUploadVastuDialogOpen}
                onOpenChange={setIsUploadVastuDialogOpen}
                onExtracted={handleSaveVastuRegulation}
            />
            <EditGreenRegulationDialog
                key={selectedGreenRegulation?.id || 'new'}
                isOpen={isEditGreenDialogOpen}
                onOpenChange={setIsEditGreenDialogOpen}
                regulation={selectedGreenRegulation}
                onSave={handleSaveGreenRegulation}
            />
        </div>
    );
}
