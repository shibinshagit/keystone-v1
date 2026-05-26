'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { DEFAULT_PLANNING_PARAMETERS } from '@/lib/default-data/planning-parameters';
import type { PlanningParameter } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Layout, Sliders, RefreshCw, PieChart } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';

const BUILDING_TYPES: PlanningParameter['building_type'][] = [
    'Residential', 'Commercial', 'Mixed Use', 'Industrial', 'Public'
];

const HEIGHT_CATEGORIES: PlanningParameter['height_category'][] = [
    'Low-Rise (<15m)', 'Mid-Rise (15-45m)', 'High-Rise (>45m)'
];

export function PlanningParamsPanel() {
    const [params, setParams] = useState<PlanningParameter[]>([]);
    const [selectedParam, setSelectedParam] = useState<PlanningParameter | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    const [formData, setFormData] = useState<Partial<PlanningParameter>>({
        category_name: '',
        building_type: 'Residential',
        height_category: 'Mid-Rise (15-45m)',
        core_to_gfa_ratio_min: 0.15,
        core_to_gfa_ratio_max: 0.20,
        circulation_to_gfa_ratio: 0.10,
        efficiency_target: 0.75,
        passenger_lifts_per_unit: 0,
        passenger_lifts_per_sqm: 0,
        service_lifts_per_tower: 1,
        description: ''
    });

    const paramsCollection = collection(db, 'planning_parameters');

    const fetchParams = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(paramsCollection);
            const data = snapshot.docs.map(doc => doc.data() as PlanningParameter);
            setParams(data.sort((a, b) => a.category_name.localeCompare(b.category_name)));
        } catch (error) {
            console.error("Error fetching planning parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch planning parameters.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadDefaults = async () => {
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            DEFAULT_PLANNING_PARAMETERS.forEach((param) => {
                const id = `${param.building_type}-${param.category_name.replace(/\s+/g, '-')}`;
                const docRef = doc(paramsCollection, id);
                batch.set(docRef, {
                    ...param,
                    id,
                    last_updated: now,
                });
            });

            await batch.commit();
            toast({ title: 'Success', description: 'Default planning parameters loaded.' });
            fetchParams();
        } catch (error) {
            console.error("Error loading defaults:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not load default planning parameters.' });
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchParams();
    }, []);

    const handleSelectParam = (param: PlanningParameter) => {
        setSelectedParam(param);
        setFormData(param);
        setIsEditing(false);
    };

    const handleNewParam = () => {
        setSelectedParam(null);
        setFormData({
            category_name: '',
            building_type: 'Residential',
            height_category: 'Mid-Rise (15-45m)',
            core_to_gfa_ratio_min: 0.15,
            core_to_gfa_ratio_max: 0.20,
            circulation_to_gfa_ratio: 0.10,
            efficiency_target: 0.75,
            passenger_lifts_per_unit: 0,
            passenger_lifts_per_sqm: 0,
            service_lifts_per_tower: 1,
            description: ''
        });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!formData.category_name || !formData.building_type) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Category Name and Building Type are required.' });
            return;
        }

        setIsSaving(true);
        try {
            const id = selectedParam?.id || `${formData.building_type}-${formData.category_name.replace(/\s+/g, '-')}-${Date.now()}`;
            const now = new Date().toISOString();

            const paramData: PlanningParameter = {
                id,
                category_name: formData.category_name!,
                building_type: formData.building_type!,
                height_category: formData.height_category!,
                core_to_gfa_ratio_min: formData.core_to_gfa_ratio_min || 0,
                core_to_gfa_ratio_max: formData.core_to_gfa_ratio_max || 0,
                circulation_to_gfa_ratio: formData.circulation_to_gfa_ratio || 0,
                efficiency_target: formData.efficiency_target || 0,
                passenger_lifts_per_unit: formData.passenger_lifts_per_unit,
                passenger_lifts_per_sqm: formData.passenger_lifts_per_sqm,
                service_lifts_per_tower: formData.service_lifts_per_tower || 0,
                description: formData.description,
                last_updated: now
            };

            await setDoc(doc(paramsCollection, id), paramData);

            setParams(prev => {
                const filtered = prev.filter(p => p.id !== id);
                return [...filtered, paramData].sort((a, b) => a.category_name.localeCompare(b.category_name));
            });

            setSelectedParam(paramData);
            setIsEditing(false);
            toast({ title: 'Success', description: 'Planning parameters saved successfully.' });
        } catch (error) {
            console.error("Error saving parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save parameters.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteDoc(doc(paramsCollection, id));
            setParams(prev => prev.filter(p => p.id !== id));
            if (selectedParam?.id === id) {
                setSelectedParam(null);
            }
            toast({ title: 'Deleted', description: 'Planning parameters deleted successfully.' });
        } catch (error) {
            console.error("Error deleting parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete parameters.' });
        }
    };

    // Calculate core area breakdown
    const coreAvg = ((formData.core_to_gfa_ratio_min || 0) + (formData.core_to_gfa_ratio_max || 0)) / 2;
    const circulation = formData.circulation_to_gfa_ratio || 0;
    const efficiency = formData.efficiency_target || 0;
    const total = coreAvg + circulation + efficiency; // Should ideally sum to 1.0 (or close, remaining is walls/structure)
    const discrepancy = 1.0 - total;

    return (
        <div className="grid grid-cols-[300px_1fr] gap-6 h-full">
            {/* Left Sidebar */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Planning Logic</h3>
                    <Button size="sm" onClick={handleNewParam}>
                        <Plus className="h-4 w-4 mr-1" /> New
                    </Button>
                </div>

                <ScrollArea className="h-[calc(100vh-200px)]">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {params.map(param => (
                                <Card
                                    key={param.id}
                                    className={`cursor-pointer transition-all hover:shadow-md ${selectedParam?.id === param.id ? 'border-primary bg-primary/5' : ''}`}
                                    onClick={() => handleSelectParam(param)}
                                >
                                    <CardHeader className="p-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <CardTitle className="text-sm">{param.category_name}</CardTitle>
                                                <CardDescription className="text-xs mt-1">
                                                    Eff: {(param.efficiency_target * 100).toFixed(0)}% • Core: {((param.core_to_gfa_ratio_min + param.core_to_gfa_ratio_max) * 50).toFixed(0)}%
                                                </CardDescription>
                                            </div>
                                            <Layout className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    </CardHeader>
                                </Card>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Right Panel */}
            <div>
                {selectedParam || isEditing ? (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>
                                        {isEditing ? (selectedParam ? 'Edit Logic' : 'New Configuration') : formData.category_name}
                                    </CardTitle>
                                    <CardDescription>
                                        Configure efficiency targets and core assumptions
                                    </CardDescription>
                                </div>
                                <div className="flex gap-2">
                                    {!isEditing ? (
                                        <>
                                            <Button variant="outline" onClick={() => setIsEditing(true)}>Edit</Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" size="icon">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Parameters?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will permanently delete this planning configuration.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => selectedParam && handleDelete(selectedParam.id)}>
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </>
                                    ) : (
                                        <>
                                            <Button variant="outline" onClick={() => {
                                                setIsEditing(false);
                                                if (selectedParam) setFormData(selectedParam);
                                            }}>
                                                Cancel
                                            </Button>
                                            <Button onClick={handleSave} disabled={isSaving}>
                                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Configuration Name</Label>
                                    <Input
                                        value={formData.category_name}
                                        onChange={e => setFormData({ ...formData, category_name: e.target.value })}
                                        disabled={!isEditing}
                                        placeholder="e.g. Luxury Residential"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Height Category</Label>
                                    <Select
                                        value={formData.height_category}
                                        onValueChange={(v: any) => setFormData({ ...formData, height_category: v })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {HEIGHT_CATEGORIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Separator />

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                        <PieChart className="h-4 w-4" /> Area Breakdown (Ratios)
                                    </h4>
                                    <div className="space-y-2">
                                        <Label>Efficiency Target (Carpet/GFA)</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.efficiency_target}
                                            onChange={e => setFormData({ ...formData, efficiency_target: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Core Area (Min - Max)</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={formData.core_to_gfa_ratio_min}
                                                onChange={e => setFormData({ ...formData, core_to_gfa_ratio_min: parseFloat(e.target.value) })}
                                                disabled={!isEditing}
                                                placeholder="Min"
                                            />
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={formData.core_to_gfa_ratio_max}
                                                onChange={e => setFormData({ ...formData, core_to_gfa_ratio_max: parseFloat(e.target.value) })}
                                                disabled={!isEditing}
                                                placeholder="Max"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Circulation Ratio</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.circulation_to_gfa_ratio}
                                            onChange={e => setFormData({ ...formData, circulation_to_gfa_ratio: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>

                                    {/* Simple Validation UI */}
                                    <div className={`text-xs p-2 rounded ${discrepancy < -0.05 ? 'bg-destructive/10 text-destructive' : 'bg-secondary/50'}`}>
                                        Total: {(total * 100).toFixed(1)}%
                                        {discrepancy < -0.05 ? " (Over 100%!)" : " (Remainder is Structure/Walls)"}
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold flex items-center gap-2">
                                        <Sliders className="h-4 w-4" /> Vertical Transport
                                    </h4>
                                    {formData.building_type === 'Residential' ? (
                                        <div className="space-y-2">
                                            <Label>Passenger Lifts (per Unit)</Label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={formData.passenger_lifts_per_unit}
                                                onChange={e => setFormData({ ...formData, passenger_lifts_per_unit: parseFloat(e.target.value) })}
                                                disabled={!isEditing}
                                            />
                                            <p className="text-xs text-muted-foreground">e.g. 0.02 = 1 lift per 50 units</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <Label>Passenger Lifts (per sqm)</Label>
                                            <Input
                                                type="number"
                                                step="0.001"
                                                value={formData.passenger_lifts_per_sqm}
                                                onChange={e => setFormData({ ...formData, passenger_lifts_per_sqm: parseFloat(e.target.value) })}
                                                disabled={!isEditing}
                                            />
                                            <p className="text-xs text-muted-foreground">e.g. 0.001 = 1 lift per 1000 sqm</p>
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        <Label>Service Lifts (per Tower)</Label>
                                        <Input
                                            type="number"
                                            value={formData.service_lifts_per_tower}
                                            onChange={e => setFormData({ ...formData, service_lifts_per_tower: parseFloat(e.target.value) })}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    disabled={!isEditing}
                                    placeholder="Explain the logic used here..."
                                />
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                            <Layout className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="mb-4">Select or create planning logic</p>
                            {params.length === 0 && (
                                <Button variant="outline" onClick={handleLoadDefaults} disabled={isLoading}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Load Default Logic
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
