
'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Loader2, Plus } from 'lucide-react';

const INDIAN_STATES_AND_UTS = [
    "National (NBC)", "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

const REGULATION_TYPES = ["Residential", "Commercial", "Mixed Use", "Industrial", "Public"];

interface NewRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onCreate: (location: string, type: string) => Promise<void>;
    isSaving: boolean;
}

export function NewRegulationDialog({ isOpen, onOpenChange, onCreate, isSaving }: NewRegulationDialogProps) {
    const [location, setLocation] = useState('');
    const [type, setType] = useState('');
    
    const handleSubmit = async () => {
        if (!location || !type) return;
        await onCreate(location, type);
        setLocation('');
        setType('');
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Regulation</DialogTitle>
                    <DialogDescription>
                        Select a location and define a type to create a new regulation entry.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div>
                        <Label htmlFor="location">Location</Label>
                        <Select value={location} onValueChange={setLocation}>
                            <SelectTrigger id="location">
                                <SelectValue placeholder="Select a state or UT..." />
                            </SelectTrigger>
                            <SelectContent>
                                {INDIAN_STATES_AND_UTS.map(state => (
                                    <SelectItem key={state} value={state}>{state}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="type">Regulation Type</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger id="type">
                                <SelectValue placeholder="Select a regulation type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {REGULATION_TYPES.map(regType => (
                                    <SelectItem key={regType} value={regType}>{regType}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isSaving || !location || !type}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Create Regulation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

    