'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where } from 'firebase/firestore';
import { DEFAULT_COST_PARAMETERS } from '@/lib/default-data/cost-parameters';
import type { CostRevenueParameters } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from './ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, DollarSign, TrendingUp, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Separator } from './ui/separator';

const INDIAN_LOCATIONS = [
    "Delhi", "Mumbai", "Bangalore", "Pune", "Hyderabad", "Chennai",
    "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Gurgaon",
    "Noida", "Ghaziabad", "Navi Mumbai", "Thane"
];

const BUILDING_TYPES: ('Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public')[] = [
    'Residential', 'Commercial', 'Mixed Use', 'Industrial', 'Public'
];

export function CostRevenuePanel() {
    const [parameters, setParameters] = useState<CostRevenueParameters[]>([]);
    const [selectedParam, setSelectedParam] = useState<CostRevenueParameters | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Form state
    const [formData, setFormData] = useState<Partial<CostRevenueParameters>>({
        location: 'Delhi',
        building_type: 'Residential',
        earthwork_cost_per_sqm: 0,
        structure_cost_per_sqm: 0,
        finishing_cost_per_sqm: 0,
        services_cost_per_sqm: 0,
        total_cost_per_sqm: 0,
        market_rate_per_sqm: 0,
        sellable_ratio: 0.75,
        currency: 'INR',
        notes: ''
    });

    const parametersCollection = collection(db, 'cost_revenue_parameters');

    const fetchParameters = async () => {
        setIsLoading(true);
        try {
            const snapshot = await getDocs(parametersCollection);
            const data = snapshot.docs.map(doc => doc.data() as CostRevenueParameters);
            setParameters(data.sort((a, b) => a.location.localeCompare(b.location)));
        } catch (error) {
            console.error("Error fetching cost parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch cost parameters.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadDefaults = async () => {
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            DEFAULT_COST_PARAMETERS.forEach((param) => {
                const id = `${param.location}-${param.building_type}`;
                const docRef = doc(parametersCollection, id);
                batch.set(docRef, {
                    ...param,
                    id,
                    last_updated: now,
                });
            });

            await batch.commit();
            toast({ title: 'Success', description: 'Default cost parameters loaded.' });
            fetchParameters();
        } catch (error) {
            console.error("Error loading defaults:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not load default cost parameters.' });
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchParameters();
    }, []);

    // Auto-calculate total cost whenever component costs change
    useEffect(() => {
        if (isEditing) {
            const total =
                (formData.earthwork_cost_per_sqm || 0) +
                (formData.structure_cost_per_sqm || 0) +
                (formData.finishing_cost_per_sqm || 0) +
                (formData.services_cost_per_sqm || 0);
            setFormData(prev => ({ ...prev, total_cost_per_sqm: total }));
        }
    }, [
        formData.earthwork_cost_per_sqm,
        formData.structure_cost_per_sqm,
        formData.finishing_cost_per_sqm,
        formData.services_cost_per_sqm,
        isEditing
    ]);

    const handleSelectParam = (param: CostRevenueParameters) => {
        setSelectedParam(param);
        const defaultParam = DEFAULT_COST_PARAMETERS.find(p => p.location === param.location && p.building_type === param.building_type) || DEFAULT_COST_PARAMETERS[0];
        setFormData({
            ...defaultParam,
            ...param,
            utility_costs: {
                ...(defaultParam.utility_costs || {}),
                ...(param.utility_costs || {})
            }
        } as any);
        setIsEditing(false);
    };

    const handleNewParam = () => {
        setSelectedParam(null);
        const defaultParam = DEFAULT_COST_PARAMETERS.find(p => p.location === 'Delhi' && p.building_type === 'Residential') || DEFAULT_COST_PARAMETERS[0];
        setFormData({
            ...defaultParam,
            location: 'Delhi',
            building_type: 'Residential',
            sellable_ratio: 0.75,
            currency: 'INR',
            notes: ''
        });
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!formData.location || !formData.building_type) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Location and Building Type are required.' });
            return;
        }

        if (formData.sellable_ratio && (formData.sellable_ratio < 0.6 || formData.sellable_ratio > 0.85)) {
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Sellable ratio must be between 0.60 and 0.85.' });
            return;
        }

        setIsSaving(true);
        try {
            const paramId = `${formData.location}-${formData.building_type}`;

            const paramData: CostRevenueParameters = {
                ...(formData as Required<CostRevenueParameters>),
                id: paramId,
                location: formData.location!,
                building_type: formData.building_type!,
                last_updated: new Date().toISOString(),
                notes: formData.notes
            };

            await setDoc(doc(parametersCollection, paramId), paramData);

            setParameters(prev => {
                const filtered = prev.filter(p => p.id !== paramId);
                return [...filtered, paramData].sort((a, b) => a.location.localeCompare(b.location));
            });

            setSelectedParam(paramData);
            setIsEditing(false);
            toast({ title: 'Success', description: 'Cost parameters saved successfully.' });
        } catch (error) {
            console.error("Error saving parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save parameters.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (paramId: string) => {
        try {
            await deleteDoc(doc(parametersCollection, paramId));
            setParameters(prev => prev.filter(p => p.id !== paramId));
            if (selectedParam?.id === paramId) {
                setSelectedParam(null);
            }
            toast({ title: 'Deleted', description: 'Cost parameters deleted successfully.' });
        } catch (error) {
            console.error("Error deleting parameters:", error);
            toast({ variant: 'destructive', title: 'Error', description: 'Could not delete parameters.' });
        }
    };

    const groupedParams = parameters.reduce((acc, param) => {
        const key = param.location;
        if (!acc[key]) acc[key] = [];
        acc[key].push(param);
        return acc;
    }, {} as Record<string, CostRevenueParameters[]>);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: formData.currency || 'INR',
            maximumFractionDigits: 0
        }).format(value);
    };

    const defaultParamsForType = DEFAULT_COST_PARAMETERS.find(
        p => p.location === formData.location && p.building_type === formData.building_type
    ) || DEFAULT_COST_PARAMETERS[0];

    return (
        <div className="grid grid-cols-[320px_1fr] gap-6 h-full">
            {/* Left Sidebar - Parameters List */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Cost & Revenue</h3>
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
                            {Object.entries(groupedParams).map(([location, params]) => (
                                <div key={location}>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                        {location}
                                    </div>
                                    <div className="space-y-1">
                                        {params.map(param => (
                                            <Card
                                                key={param.id}
                                                className={`cursor-pointer transition-all hover:shadow-md ${selectedParam?.id === param.id ? 'border-primary bg-primary/5' : ''
                                                    }`}
                                                onClick={() => handleSelectParam(param)}
                                            >
                                                <CardHeader className="p-3">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <CardTitle className="text-sm">{param.building_type}</CardTitle>
                                                            <CardDescription className="text-xs mt-1">
                                                                {formatCurrency(param.total_cost_per_sqm)}/sqm
                                                            </CardDescription>
                                                        </div>
                                                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <Badge variant="secondary" className="text-xs">
                                                            {param.currency}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-xs">
                                                            {(param.sellable_ratio * 100).toFixed(0)}% sellable
                                                        </Badge>
                                                    </div>
                                                </CardHeader>
                                            </Card>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* Right Panel - Parameters Editor */}
            <div>
                {selectedParam || isEditing ? (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>
                                        {isEditing ? (selectedParam ? 'Edit Parameters' : 'New Parameters') : `${formData.location} - ${formData.building_type}`}
                                    </CardTitle>
                                    <CardDescription>
                                        {isEditing ? 'Configure cost and revenue parameters' : `Last updated: ${new Date(formData.last_updated || '').toLocaleDateString()}`}
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
                                                            This will permanently delete cost parameters for "{formData.location} - {formData.building_type}". This action cannot be undone.
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
                            {/* Location & Type */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="location">Location *</Label>
                                    <Select
                                        value={formData.location}
                                        onValueChange={(value) => {
                                            if (!selectedParam) {
                                                const defaultParam = DEFAULT_COST_PARAMETERS.find(p => p.location === value && p.building_type === formData.building_type) || DEFAULT_COST_PARAMETERS[0];
                                                setFormData({ ...defaultParam, location: value, building_type: formData.building_type });
                                            } else {
                                                setFormData({ ...formData, location: value });
                                            }
                                        }}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {INDIAN_LOCATIONS.map(loc => (
                                                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="building_type">Building Type *</Label>
                                    <Select
                                        value={formData.building_type}
                                        onValueChange={(value: any) => {
                                            if (!selectedParam) {
                                                const defaultParam = DEFAULT_COST_PARAMETERS.find(p => p.location === formData.location && p.building_type === value) || DEFAULT_COST_PARAMETERS[0];
                                                setFormData({ ...defaultParam, location: formData.location, building_type: value });
                                            } else {
                                                setFormData({ ...formData, building_type: value });
                                            }
                                        }}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {BUILDING_TYPES.map(type => (
                                                <SelectItem key={type} value={type}>{type}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <Separator />

                            {/* Cost Breakdown */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold">Cost Breakdown (per sqm)</h4>
                                <div className="space-y-6">
                                    {(['earthwork', 'structure', 'finishing', 'services'] as const).map(key => (
                                        <div key={key} className="p-3 bg-secondary/10 rounded-lg border border-border/40">
                                            <Label className="capitalize font-semibold mb-3 block">{key} Cost</Label>
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="space-y-1.5">
                                                    <span className="text-[10px] text-muted-foreground uppercase">Min (P10)</span>
                                                    <Input
                                                        type="number" className="h-8 text-sm"
                                                        value={(formData as any)[`${key}_cost_per_sqm_min`] || ''}
                                                        onChange={(e) => setFormData({ ...formData, [`${key}_cost_per_sqm_min`]: parseFloat(e.target.value) || undefined })}
                                                        disabled={!isEditing}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <span className="text-[10px] text-muted-foreground uppercase text-primary font-medium">Expected (P50) *</span>
                                                    <Input
                                                        type="number" className="h-8 text-sm border-primary/30"
                                                        value={(formData as any)[`${key}_cost_per_sqm`]}
                                                        onChange={(e) => setFormData({ ...formData, [`${key}_cost_per_sqm`]: parseFloat(e.target.value) || 0 })}
                                                        disabled={!isEditing}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <span className="text-[10px] text-muted-foreground uppercase">Max (P90)</span>
                                                    <Input
                                                        type="number" className="h-8 text-sm"
                                                        value={(formData as any)[`${key}_cost_per_sqm_max`] || ''}
                                                        onChange={(e) => setFormData({ ...formData, [`${key}_cost_per_sqm_max`]: parseFloat(e.target.value) || undefined })}
                                                        disabled={!isEditing}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="p-4 bg-secondary/30 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold">Total Construction Cost</span>
                                        <span className="text-lg font-bold text-primary">
                                            {formatCurrency(formData.total_cost_per_sqm || 0)}/sqm
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Auto-calculated from above costs</p>
                                </div>
                            </div>

                            <Separator />

                            {/* Utility Costs */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold flex items-center gap-2">Utility Costs</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {(() => {
                                        const defaultParam = DEFAULT_COST_PARAMETERS.find(p => p.location === formData.location && p.building_type === formData.building_type);
                                        return [
                                            { key: 'ugt_pumping', label: 'UGT + Pumping (Fixed, ₹)' },
                                            { key: 'stp_per_kld', label: 'STP (₹ per KLD)' },
                                            { key: 'wtp_cost', label: 'WTP (Fixed, ₹)' },
                                            { key: 'transformer_per_kva', label: 'Transformer (₹/kVA)' },
                                            { key: 'dg_per_kva', label: 'DG Set (₹/kVA)' },
                                            { key: 'fire_fighting', label: 'Fire Fighting (Fixed, ₹)' },
                                            { key: 'lifts_per_unit', label: 'Lifts (₹ per lift)' },
                                            { key: 'solar_per_kw', label: 'Solar PV (₹/kW)' },
                                            { key: 'hvac_per_tr', label: 'HVAC (₹/TR)' },
                                            { key: 'owc_per_kg_per_day', label: 'OWC (₹/kg/day)' },
                                        ].map(u => {
                                            const dbVal = formData.utility_costs?.[u.key as keyof typeof formData.utility_costs];
                                            const defVal = defaultParam?.utility_costs?.[u.key as keyof typeof formData.utility_costs];
                                            
                                            const dbValMin = formData.utility_costs?.[`${u.key}_min` as keyof typeof formData.utility_costs];
                                            const defValMin = defaultParam?.utility_costs?.[`${u.key}_min` as keyof typeof formData.utility_costs];

                                            const dbValMax = formData.utility_costs?.[`${u.key}_max` as keyof typeof formData.utility_costs];
                                            const defValMax = defaultParam?.utility_costs?.[`${u.key}_max` as keyof typeof formData.utility_costs];

                                            return (
                                                <div key={u.key} className="space-y-2 p-3 border rounded-md bg-background/50">
                                                    <Label className="text-xs font-semibold">{u.label}</Label>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <div className="space-y-1">
                                                            <span className="text-[10px] text-muted-foreground block">Base</span>
                                                            <Input
                                                                type="number" className="h-7 text-xs"
                                                                value={dbVal !== undefined ? dbVal : (defVal || '')}
                                                                onChange={(e) => setFormData({
                                                                    ...formData,
                                                                    utility_costs: {
                                                                        ...formData.utility_costs,
                                                                        [u.key]: parseFloat(e.target.value) || undefined
                                                                    }
                                                                })}
                                                                disabled={!isEditing}
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <span className="text-[10px] text-muted-foreground block">Min</span>
                                                            <Input
                                                                type="number" className="h-7 text-xs"
                                                                value={dbValMin !== undefined ? dbValMin : (defValMin || '')}
                                                                onChange={(e) => setFormData({
                                                                    ...formData,
                                                                    utility_costs: {
                                                                        ...formData.utility_costs,
                                                                        [`${u.key}_min`]: parseFloat(e.target.value) || undefined
                                                                    }
                                                                })}
                                                                disabled={!isEditing}
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <span className="text-[10px] text-muted-foreground block">Max</span>
                                                            <Input
                                                                type="number" className="h-7 text-xs"
                                                                value={dbValMax !== undefined ? dbValMax : (defValMax || '')}
                                                                onChange={(e) => setFormData({
                                                                    ...formData,
                                                                    utility_costs: {
                                                                        ...formData.utility_costs,
                                                                        [`${u.key}_max`]: parseFloat(e.target.value) || undefined
                                                                    }
                                                                })}
                                                                disabled={!isEditing}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            <Separator />

                            {/* Revenue Parameters */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4" />
                                    Revenue Parameters
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="market_rate">Market Rate (per sqm)</Label>
                                        <Input
                                            id="market_rate"
                                            type="number"
                                            value={formData.market_rate_per_sqm}
                                            onChange={(e) => setFormData({ ...formData, market_rate_per_sqm: parseFloat(e.target.value) || 0 })}
                                            disabled={!isEditing}
                                        />
                                        <p className="text-xs text-muted-foreground">Selling price per sqm</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="sellable_ratio">Sellable Ratio</Label>
                                        <Input
                                            id="sellable_ratio"
                                            type="number"
                                            step="0.01"
                                            min="0.60"
                                            max="0.85"
                                            value={formData.sellable_ratio}
                                            onChange={(e) => setFormData({ ...formData, sellable_ratio: parseFloat(e.target.value) || 0.75 })}
                                            disabled={!isEditing}
                                        />
                                        <p className="text-xs text-muted-foreground">Carpet / Built-up (0.60 - 0.85)</p>
                                    </div>
                                </div>

                                {formData.market_rate_per_sqm && formData.total_cost_per_sqm ? (
                                    <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold">Potential Profit Margin</span>
                                            <span className="text-lg font-bold text-green-600">
                                                {(((formData.market_rate_per_sqm - formData.total_cost_per_sqm) / formData.market_rate_per_sqm) * 100).toFixed(1)}%
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Revenue: {formatCurrency(formData.market_rate_per_sqm)}/sqm - Cost: {formatCurrency(formData.total_cost_per_sqm)}/sqm
                                        </p>
                                    </div>
                                ) : null}
                            </div>

                            <Separator />

                            {/* Metadata */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="currency">Currency</Label>
                                    <Select
                                        value={formData.currency}
                                        onValueChange={(value) => setFormData({ ...formData, currency: value })}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="INR">INR (₹)</SelectItem>
                                            <SelectItem value="USD">USD ($)</SelectItem>
                                            <SelectItem value="EUR">EUR (€)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="notes">Notes</Label>
                                <Textarea
                                    id="notes"
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    disabled={!isEditing}
                                    rows={3}
                                    placeholder="Optional notes about these parameters (e.g., market conditions, data source)"
                                />
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                            <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="mb-4">Select parameters or create new ones</p>
                            {parameters.length === 0 && (
                                <Button variant="outline" onClick={handleLoadDefaults} disabled={isLoading}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Load Default Parameters
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
