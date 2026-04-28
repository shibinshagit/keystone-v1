
'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Loader2, Plus } from 'lucide-react';
import {
    GEOGRAPHY_MARKETS,
    getDefaultLocationForMarket,
    getLocationOptionsForMarket,
    inferRegulationGeography,
} from '@/lib/geography';
import type { CountryCode, GeographyMarket, RegulationData } from '@/lib/types';

const REGULATION_TYPES = ["Residential", "Commercial", "Mixed Use", "Industrial", "Public"];

interface NewRegulationDraft {
    location: string;
    market: GeographyMarket;
    countryCode?: CountryCode;
    stateOrProvince?: string;
    city?: string;
    jurisdictionLevel?: RegulationData['jurisdictionLevel'];
    codeFamily?: string;
    type: string;
}

interface NewRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    onCreate: (draft: NewRegulationDraft) => Promise<void>;
    isSaving: boolean;
}

export function NewRegulationDialog({ isOpen, onOpenChange, onCreate, isSaving }: NewRegulationDialogProps) {
    const [market, setMarket] = useState<GeographyMarket>('India');
    const [location, setLocation] = useState(getDefaultLocationForMarket('India'));
    const [type, setType] = useState('');
    const locationOptions = getLocationOptionsForMarket(market);

    const handleSubmit = async () => {
        if (!location || !type) return;
        await onCreate({
            location,
            type,
            market,
            ...inferRegulationGeography(location),
        });
        setLocation(getDefaultLocationForMarket(market));
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
                        <Label htmlFor="market">Market</Label>
                        <Select
                            value={market}
                            onValueChange={(value) => {
                                const nextMarket = value as GeographyMarket;
                                setMarket(nextMarket);
                                setLocation(getDefaultLocationForMarket(nextMarket));
                            }}
                        >
                            <SelectTrigger id="market">
                                <SelectValue placeholder="Select a market..." />
                            </SelectTrigger>
                            <SelectContent>
                                {GEOGRAPHY_MARKETS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="location">Location</Label>
                        <Select value={location} onValueChange={setLocation}>
                            <SelectTrigger id="location">
                                <SelectValue placeholder="Select a location..." />
                            </SelectTrigger>
                            <SelectContent>
                                {locationOptions.map(option => (
                                    <SelectItem key={`${option.market}-${option.location}`} value={option.location}>{option.label}</SelectItem>
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

    
