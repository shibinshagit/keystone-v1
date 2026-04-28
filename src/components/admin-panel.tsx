'use client';
import { useEffect, useState, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import type { RegulationData, GreenRegulationData, VastuRegulationData } from '@/lib/types';
import { Button } from './ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Building, Scaling, Droplets, ShieldCheck, Banknote, Trash2, Upload, Leaf, Compass, Pencil, MapPin, Landmark, Ruler, LayoutGrid, ArrowUpDown, Users, Car, DoorOpen, Flame, TreePine, Wrench, HardHat, CircleDollarSign } from 'lucide-react';
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
// AdminAttachVastu removed; use default checklist JSON instead when needed
import { UploadVastuDialog } from './upload-vastu-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnitTemplatesPanel } from './unit-templates-panel';
import { CostRevenuePanel } from './cost-revenue-panel';
import { TimeEstimationPanel } from './time-estimation-panel';
import { PlanningParamsPanel } from './planning-params-panel';
import { NationalCodePanel } from './national-code-panel';
import { useBuildingStore } from '@/hooks/use-building-store';
import ultimateVastuChecklist from '@/data/ultimate-vastu-checklist.json';
import { compactOptionalFields, inferRegulationGeography } from '@/lib/geography';
import { getRegulationCollectionNameForRegulation, INDIA_REGULATIONS_COLLECTION, US_REGULATIONS_COLLECTION } from '@/lib/regulation-collections';

const DEFAULT_REGULATION_DATA: Omit<RegulationData, 'location' | 'type' | 'market' | 'countryCode' | 'stateOrProvince' | 'city' | 'jurisdictionLevel' | 'codeFamily'> = {
    geometry: {
        setback: { desc: "General setback (if uniform)", unit: "m", value: "", exampleStr: "e.g. 5" },
        front_setback: { desc: "Front setback from road", unit: "m", value: "", exampleStr: "e.g. 6" },
        rear_setback: { desc: "Rear setback from boundary", unit: "m", value: "", exampleStr: "e.g. 4" },
        side_setback: { desc: "Side setback from boundary", unit: "m", value: "", exampleStr: "e.g. 3" },
        road_width: { desc: "Adjacent road width", unit: "m", value: "", exampleStr: "e.g. 9" },
        max_ground_coverage: { desc: "Maximum ground coverage", unit: "%", value: "", exampleStr: "e.g. 40" },
        floor_area_ratio: { desc: "Floor Area Ratio (FAR)", unit: "", value: "", exampleStr: "e.g. 1.8" },
        max_height: { desc: "Maximum building height", unit: "m", value: "", exampleStr: "e.g. 30" },
        // Land & Zoning
        minimum_plot_size: { desc: "Minimum plot size required", unit: "sqm", value: "", exampleStr: "e.g. 500" },
        minimum_frontage_width: { desc: "Minimum frontage / width of plot", unit: "m", value: "", exampleStr: "e.g. 12" },
        density_norms: { desc: "Density norms (DU/acre or persons/hectare)", unit: "DU/acre", value: "", exampleStr: "e.g. 40" },
        units_per_acre: { desc: "Units per acre", unit: "units/acre", value: "", exampleStr: "e.g. 40" },
        population_load: { desc: "Population load", unit: "persons/hectare", value: "", exampleStr: "e.g. 500" },
        // FAR / FSI
        premium_fsi_tdr: { desc: "Premium FSI / TDR utilisation", unit: "", value: "", exampleStr: "e.g. 0" },
        premium_far_purchasable: { desc: "Premium FAR / Purchasable FAR", unit: "", value: "", exampleStr: "e.g. 0" },
        fungible_fsi_incentive: { desc: "Fungible FSI / Incentive FSI", unit: "", value: "", exampleStr: "e.g. 0" },
        fungible_far_incentive: { desc: "Fungible FAR / Incentive FAR", unit: "", value: "", exampleStr: "e.g. 0" },
        excluded_areas_calc: { desc: "Excluded areas calculation (exempted FAR computation)", unit: "", value: "", exampleStr: "e.g. 0" },
        exclusions_basement_services: { desc: "Exclusions (basement, services, etc.)", unit: "", value: "", exampleStr: "e.g. 0" },
        // Setbacks & Building Line
        road_setback_building_line: { desc: "Road setback (building line)", unit: "m", value: "", exampleStr: "e.g. 6" },
        highrise_setback_multiplier: { desc: "High-rise setback multiplier", unit: "", value: "", exampleStr: "e.g. 1" },
        based_on_road_width: { desc: "Setback based on road width", unit: "m", value: "", exampleStr: "e.g. 9" },
        based_on_building_height: { desc: "Setback based on building height", unit: "m", value: "", exampleStr: "e.g. 30" },
        based_on_plot_size: { desc: "Setback based on plot size", unit: "sqm", value: "", exampleStr: "e.g. 500" },
        // Building Height
        height_vs_road_width: { desc: "Height vs road width relation", unit: "", value: "", exampleStr: "e.g. 1.5" },
        aviation_clearance: { desc: "Aviation clearance (if required)", unit: "m", value: "", exampleStr: "e.g. 0" },
        shadow_skyline_control: { desc: "Shadow / skyline control", unit: "", value: "", exampleStr: "e.g. 0" },
    },
    facilities: {
        parking: { desc: "Parking requirements per unit", unit: "spaces/unit", value: "", exampleStr: "e.g. 1" },
        open_space: { desc: "Required open space per plot", unit: "%", value: "", exampleStr: "e.g. 15" },
        // Access, Parking & Traffic
        entry_exit_width: { desc: "Entry/exit width and number", unit: "m", value: "", exampleStr: "e.g. 6" },
        internal_road_width: { desc: "Internal road width hierarchy", unit: "m", value: "", exampleStr: "e.g. 7" },
        parking_ecs: { desc: "Parking requirements (ECS)", unit: "ECS", value: "", exampleStr: "e.g. 1" },
        visitor_parking: { desc: "Visitor parking (% of total)", unit: "%", value: "", exampleStr: "e.g. 10" },
        ramp_slope: { desc: "Ramp slope", unit: "%", value: "", exampleStr: "e.g. 12" },
        turning_radius: { desc: "Turning radius", unit: "m", value: "", exampleStr: "e.g. 6" },
        // Building Planning
        staircase_width: { desc: "Staircase width", unit: "m", value: "", exampleStr: "e.g. 1.2" },
        staircase_count: { desc: "Number of staircases required", unit: "", value: "", exampleStr: "e.g. 2" },
        lift_requirements: { desc: "Lift requirements (based on height/population)", unit: "", value: "", exampleStr: "e.g. 2" },
        refuge_areas: { desc: "Refuge areas (high-rise)", unit: "sqm", value: "", exampleStr: "e.g. 15" },
        corridor_widths: { desc: "Corridor widths", unit: "m", value: "", exampleStr: "e.g. 1.8" },
        unit_size_compliance: { desc: "Unit size compliance (min carpet area)", unit: "sqm", value: "", exampleStr: "e.g. 30" },
    },
    sustainability: {
        rainwater_harvesting: { desc: "Rainwater harvesting capacity", unit: "liters/sqm", value: "", exampleStr: "e.g. 30" },
        solar_panels: { desc: "Solar panel area requirement", unit: "% of roof", value: "", exampleStr: "e.g. 20" },
        // Green Ratings
        leed_compliance: { desc: "LEED compliance level", unit: "", value: "", exampleStr: "e.g. 0" },
        igbc_compliance: { desc: "IGBC compliance level", unit: "", value: "", exampleStr: "e.g. 0" },
        griha_compliance: { desc: "GRIHA compliance level", unit: "", value: "", exampleStr: "e.g. 0" },
        tree_plantation_green_cover: { desc: "Tree plantation / green cover %", unit: "%", value: "", exampleStr: "e.g. 15" },
        water_consumption_norm: { desc: "Water consumption norm", unit: "lpcd", value: "", exampleStr: "e.g. 135" },
        energy_efficiency: { desc: "Energy efficiency (ECBC compliance)", unit: "", value: "", exampleStr: "e.g. 0" },
    },
    safety_and_services: {
        fire_safety: { desc: "Fire safety compliance level", unit: "", value: "", exampleStr: "e.g. 1" },
        // Fire & Life Safety
        fire_tender_access: { desc: "Fire tender access path width", unit: "m", value: "", exampleStr: "e.g. 6" },
        fire_tender_movement: { desc: "Fire tender movement path width", unit: "m", value: "", exampleStr: "e.g. 6" },
        staircases_by_height: { desc: "Number of staircases (based on height)", unit: "", value: "", exampleStr: "e.g. 2" },
        fire_exits_travel_distance: { desc: "Fire exits and travel distance", unit: "m", value: "", exampleStr: "e.g. 30" },
        refuge_floors: { desc: "Refuge floors / areas", unit: "", value: "", exampleStr: "e.g. 0" },
        fire_fighting_systems: { desc: "Fire fighting systems (sprinkler, hydrant, etc.)", unit: "", value: "", exampleStr: "e.g. 1" },
        fire_command_center: { desc: "Fire command center (high-rise)", unit: "", value: "", exampleStr: "e.g. 0" },
        // Utilities & MEP
        water_supply_approval: { desc: "Water supply source approval", unit: "", value: "", exampleStr: "e.g. 0" },
        sewer_connection_stp: { desc: "Sewer connection / STP design", unit: "", value: "", exampleStr: "e.g. 0" },
        stormwater_drainage: { desc: "Stormwater drainage plan", unit: "", value: "", exampleStr: "e.g. 0" },
        electrical_load_sanction: { desc: "Electrical load sanction", unit: "kVA", value: "", exampleStr: "e.g. 500" },
        transformer_placement: { desc: "Transformer placement", unit: "", value: "", exampleStr: "e.g. 0" },
        backup_power_norms: { desc: "Backup power norms", unit: "kVA", value: "", exampleStr: "e.g. 200" },
        gas_pipelines: { desc: "Gas pipelines (if applicable)", unit: "", value: "", exampleStr: "e.g. 0" },
        telecom_infrastructure: { desc: "Telecom infrastructure", unit: "", value: "", exampleStr: "e.g. 0" },
        sewage_treatment_plant: { desc: "Sewage Treatment Plant (STP)", unit: "KLD", value: "", exampleStr: "e.g. 50" },
        solid_waste_management: { desc: "Solid waste management", unit: "", value: "", exampleStr: "e.g. 0" },
        // Structural Engineering
        seismic_zone: { desc: "Seismic zone classification", unit: "", value: "", exampleStr: "e.g. 3" },
        wind_load: { desc: "Wind load design speed", unit: "m/s", value: "", exampleStr: "e.g. 39" },
        soil_bearing_capacity: { desc: "Soil bearing capacity", unit: "kN/sqm", value: "", exampleStr: "e.g. 200" },
    },
    administration: {
        fee_rate: { desc: "Processing fee rate", unit: "% of cost", value: "", exampleStr: "e.g. 0.1" },
        // Land & Legal
        land_use_zoning: { desc: "Land use zoning classification", unit: "", value: "", exampleStr: "e.g. 0" },
        conversion_status: { desc: "Agricultural to Non-agricultural conversion status", unit: "", value: "", exampleStr: "e.g. 0" },
        land_use_category: { desc: "Land use category", unit: "", value: "", exampleStr: "e.g. 0" },
        tod_rules: { desc: "Transit-oriented development (TOD) rules", unit: "", value: "", exampleStr: "e.g. 0" },
        special_zones: { desc: "Special zones (heritage, coastal, eco-sensitive, etc.)", unit: "", value: "", exampleStr: "e.g. 0" },
        // Financial Compliance
        saleable_vs_carpet_rera: { desc: "Saleable vs carpet area (RERA)", unit: "", value: "", exampleStr: "e.g. 0" },
        exit_compliance: { desc: "Exit compliance", unit: "", value: "", exampleStr: "e.g. 0" },
        absorption_assumptions: { desc: "Absorption assumptions (for large projects)", unit: "%/year", value: "", exampleStr: "e.g. 20" },
        infra_load_vs_financial_viability: { desc: "Infrastructure load vs financial viability", unit: "", value: "", exampleStr: "e.g. 0" },
    },
};

const sanitizeFirestoreData = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;

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

    const greenRegulationsCollection = collection(db, 'greenRegulations');
    const vastuRegulationsCollection = collection(db, 'vastuRegulations');
    const getRegulationsCollection = (collectionName: string) => collection(db, collectionName);
    const getRegulationDocId = (regulation: Pick<RegulationData, 'location' | 'type'>) =>
        `${regulation.location}-${regulation.type}`.replace(/\s+/g, '-');

    const fetchRegulations = async () => {
        setIsLoading(true);
        try {
            const [indiaSnapshot, usSnapshot] = await Promise.all([
                getDocs(getRegulationsCollection(INDIA_REGULATIONS_COLLECTION)),
                getDocs(getRegulationsCollection(US_REGULATIONS_COLLECTION)),
            ]);
            const data = [...indiaSnapshot.docs, ...usSnapshot.docs].map(doc => doc.data() as RegulationData);
            setRegulations(data);

            const greenSnapshot = await getDocs(greenRegulationsCollection);
            const greenData = greenSnapshot.docs.map(doc => doc.data() as GreenRegulationData);
            setGreenRegulations(greenData);

            const vastuSnapshot = await getDocs(vastuRegulationsCollection);
            const vastuData = vastuSnapshot.docs.map(doc => doc.data() as VastuRegulationData);
            if (!vastuData || vastuData.length === 0) {
                // No Vastu in Firestore — use bundled ultimate checklist for immediate admin preview
                const checklist = (ultimateVastuChecklist as any) as VastuRegulationData;
                setVastuRegulations([checklist]);
                // Also load into the store for active project attachment/engine use
                try {
                    useBuildingStore.getState().actions.loadUltimateVastuChecklist();
                } catch (e) {
                    console.warn('[AdminPanel] could not call loadUltimateVastuChecklist', e);
                }
            } else {
                setVastuRegulations(vastuData);
            }

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

        const categoryKey = selectedCategory as keyof typeof DEFAULT_REGULATION_DATA;
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
            const docId = getRegulationDocId(selectedRegulation);
            const collectionName = getRegulationCollectionNameForRegulation(selectedRegulation);
            const docRef = doc(getRegulationsCollection(collectionName), docId);
            const sanitizedRegulation = sanitizeFirestoreData(selectedRegulation);
            await setDoc(docRef, sanitizedRegulation, { merge: true });

            setRegulations(prevRegs => prevRegs.map(reg =>
                (reg.location === selectedRegulation.location && reg.type === selectedRegulation.type)
                    ? sanitizedRegulation
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

    const handleCreateRegulation = async ({
        location,
        type,
        market,
        countryCode,
        stateOrProvince,
        city,
        jurisdictionLevel,
        codeFamily,
    }: {
        location: string;
        type: string;
        market?: RegulationData['market'];
        countryCode?: RegulationData['countryCode'];
        stateOrProvince?: string;
        city?: string;
        jurisdictionLevel?: RegulationData['jurisdictionLevel'];
        codeFamily?: string;
    }) => {
        setIsSaving(true);
        const docId = getRegulationDocId({ location, type });
        const effectiveMarket = market || inferRegulationGeography(location).market || 'India';
        if (regulations.some(reg => getRegulationDocId(reg) === docId && (reg.market || 'India') === effectiveMarket)) {
            toast({ variant: 'destructive', title: 'Error', description: 'This regulation already exists.' });
            setIsSaving(false);
            return;
        }

        const newRegulation: RegulationData = sanitizeFirestoreData({
            ...JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)),
            location,
            type,
            ...compactOptionalFields({
                market,
                countryCode,
                stateOrProvince,
                city,
                jurisdictionLevel,
                codeFamily,
            }),
        } as RegulationData);

        try {
            const collectionName = getRegulationCollectionNameForRegulation(newRegulation);
            const docRef = doc(getRegulationsCollection(collectionName), docId);
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

    const handleDeleteRegulation = async (regulation: RegulationData) => {
        const docId = getRegulationDocId(regulation);
        setDeletingId(docId);
        try {
            const collectionName = getRegulationCollectionNameForRegulation(regulation);
            await deleteDoc(doc(getRegulationsCollection(collectionName), docId));
            setRegulations(prev =>
                prev.filter(
                    reg =>
                        !(
                            getRegulationDocId(reg) === docId &&
                            (reg.market || 'India') === (regulation.market || 'India')
                        ),
                ),
            );
            if (selectedRegulation?.location === regulation.location && selectedRegulation?.type === regulation.type) {
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
                const docId = getRegulationDocId(reg);
                const collectionName = getRegulationCollectionNameForRegulation(reg);
                batch.delete(doc(getRegulationsCollection(collectionName), docId));
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

                const newRegulation: RegulationData = sanitizeFirestoreData(produce(
                    JSON.parse(JSON.stringify(DEFAULT_REGULATION_DATA)) as RegulationData,
                    voidDraft => {
                        const draft = voidDraft as any;
                        draft.location = extractedData.location!;
                        draft.type = extractedData.type!;
                        Object.assign(draft, inferRegulationGeography(extractedData.location!));
                        
                        // Deep merge properties
                        const categories = ['geometry', 'facilities', 'sustainability', 'safety_and_services', 'administration'];
                        categories.forEach(cat => {
                            if ((extractedData as any)[cat]) {
                                draft[cat] = { ...draft[cat], ...(extractedData as any)[cat] };
                            }
                        });

                        ['market', 'countryCode', 'stateOrProvince', 'city', 'jurisdictionLevel', 'codeFamily'].forEach((key) => {
                            if ((extractedData as any)[key] !== undefined) {
                                draft[key] = (extractedData as any)[key];
                            }
                        });
                    }
                ));

                const regulationId = getRegulationDocId(newRegulation);
                const collectionName = getRegulationCollectionNameForRegulation(newRegulation);
                const regulationRef = doc(db, collectionName, regulationId);
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

    const categories: { key: keyof typeof DEFAULT_REGULATION_DATA, icon: React.ElementType }[] = [
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
                                                <AccordionItem value={location} key={location} className="border rounded-lg bg-card px-4 group/item">
                                                    <AccordionTrigger className="hover:no-underline py-4 group">
                                                        <div className="flex items-center justify-between w-full pr-4">
                                                            <div className="flex items-center gap-4">
                                                                <span className="text-xl font-semibold text-primary">{location}</span>
                                                                <Badge variant="secondary" className="ml-2">{locationRegulations.length} Types</Badge>
                                                            </div>
                                                            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                                                <AlertDialog>
                                                                    <AlertDialogTrigger asChild>
                                                                        <div 
                                                                            role="button"
                                                                            className={cn(
                                                                                "flex items-center justify-center h-8 w-8 rounded-md transition-opacity",
                                                                                deletingId === location 
                                                                                    ? "opacity-50 cursor-not-allowed text-destructive" 
                                                                                    : "text-destructive/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/item:opacity-100 cursor-pointer"
                                                                            )}
                                                                        >
                                                                            {deletingId === location ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                                        </div>
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
                                                                                <Badge variant="outline" className="mb-2 truncate max-w-[85%]">{reg.type}</Badge>
                                                                                <div onClick={(e) => e.stopPropagation()}>
                                                                                    <AlertDialog>
                                                                                        <AlertDialogTrigger asChild>
                                                                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity -mr-2 -mt-2" disabled={isDeleting}>
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
                                                                                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={(e) => { e.stopPropagation(); handleDeleteRegulation(reg); }}>
                                                                                                Delete
                                                                                            </AlertDialogAction>
                                                                                        </AlertDialogFooter>
                                                                                    </AlertDialogContent>
                                                                                </AlertDialog>
                                                                                </div>
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
                                                {Array.isArray(reg.categories) && reg.categories.length > 0 && (
                                                    <Accordion type="single" collapsible className="w-full border-t pt-2">
                                                        {reg.categories.map((category, idx) => (
                                                            <AccordionItem key={idx} value={`item-${idx}`} className="border-b-0">
                                                                <AccordionTrigger className="py-2 text-xs hover:no-underline">
                                                                    <div className="flex justify-between w-full pr-2">
                                                                        <span>{category.name}</span>
                                                                        <span className="text-muted-foreground">{Array.isArray(category.credits) ? category.credits.length : 0}</span>
                                                                    </div>
                                                                </AccordionTrigger>
                                                                <AccordionContent>
                                                                    <div className="space-y-2 pl-2">
                                                                        {(Array.isArray(category.credits) ? category.credits : []).map((credit, cIdx) => (
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
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setIsUploadVastuDialogOpen(true)}>
                                        <Compass className="mr-2 h-4 w-4" /> Upload Vastu PDF
                                    </Button>
                                    <Button variant="ghost" onClick={() => useBuildingStore.getState().actions.loadUltimateVastuChecklist()}>
                                        Load Ultimate Checklist
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                <div className="col-span-full mb-4">
                                    {/* AdminAttachVastu removed; use default checklist JSON when needed */}
                                </div>
                                {vastuRegulations.map(reg => {
                                    const recommendations = Array.isArray(reg.recommendations)
                                        ? reg.recommendations
                                        : [];
                                    const scorecardItems = Array.isArray(reg.scorecardItems)
                                        ? reg.scorecardItems
                                        : [];

                                    return (
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
                                                {scorecardItems.length
                                                    ? `${scorecardItems.length} scorecard items - ${recommendations.length} guidelines`
                                                    : `${recommendations.length} Guidelines`}
                                            </div>
                                            <div className="space-y-2">
                                                {recommendations.slice(0, 3).map((rec, idx) => (
                                                    <div key={idx} className="text-xs border-l-2 border-primary/30 pl-2">
                                                        <span className="font-semibold">{rec.category}:</span> {rec.idealDirections.join(', ')}
                                                    </div>
                                                ))}
                                                {recommendations.length > 3 && (
                                                    <div className="text-xs text-muted-foreground italic">
                                                        + {recommendations.length - 3} more...
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                )})}
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
            <UploadVastuDialog
                isOpen={isUploadVastuDialogOpen}
                onOpenChange={setIsUploadVastuDialogOpen}
                onExtracted={handleSaveVastuRegulation}
            />
            {/* Green upload/edit dialogs removed per request */}
        </div>
    );
}
