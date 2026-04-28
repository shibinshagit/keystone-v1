'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Upload, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import type { RegulationData } from '@/lib/types';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
    GEOGRAPHY_MARKETS,
    getLocationOptionsForMarket,
} from '@/lib/geography';
import type { GeographyMarket } from '@/lib/types';

interface UploadRegulationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onExtracted: (data: Partial<RegulationData>[]) => void;
}

export function UploadRegulationDialog({ isOpen, onOpenChange, onExtracted }: UploadRegulationDialogProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [extractedData, setExtractedData] = useState<any[]>([]);
    const [overrideLocation, setOverrideLocation] = useState<string>('');
    const [market, setMarket] = useState<GeographyMarket>('India');
    const locationOptions = getLocationOptionsForMarket(market);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setExtractedData([]);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            if (overrideLocation && overrideLocation !== 'none') {
                formData.append('overrideLocation', overrideLocation);
            }

            const response = await fetch('/api/extract-regulation', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to extract regulation data');
            }

            // Handle both array and single object responses
            const regulations = Array.isArray(result.data) ? result.data : [result.data];
            setExtractedData(regulations);
            toast({
                title: 'Success',
                description: `Extracted ${regulations.length} regulation${regulations.length > 1 ? 's' : ''}!`
            });
        } catch (error: any) {
            console.error('Upload error:', error);
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsUploading(false);
        }
    };

    const handleUseExtracted = () => {
        if (extractedData.length > 0) {
            console.log('Sending extracted regulations to admin panel:', extractedData);
            onExtracted(extractedData);
            onOpenChange(false);
            setSelectedFile(null);
            setExtractedData([]);
            setOverrideLocation('');
        }
    };

    const handleCancel = () => {
        setSelectedFile(null);
        setExtractedData([]);
        setOverrideLocation('');
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Upload Regulation Document</DialogTitle>
                    <DialogDescription>
                        Upload a PDF, DOCX, or TXT file containing regulation data. AI will automatically extract structured information for all land use types.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {extractedData.length === 0 ? (
                        <>
                            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                                <input
                                    type="file"
                                    accept=".pdf,.docx,.txt"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                    id="regulation-file"
                                />
                                <label htmlFor="regulation-file" className="cursor-pointer">
                                    <Button variant="outline" asChild>
                                        <span>
                                            <FileText className="mr-2 h-4 w-4" />
                                            Select File
                                        </span>
                                    </Button>
                                </label>
                                {selectedFile && (
                                    <p className="mt-4 text-sm text-muted-foreground">
                                        Selected: {selectedFile.name}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="override-market">Market</Label>
                                <Select
                                    value={market}
                                    onValueChange={(value) => {
                                        setMarket(value as GeographyMarket);
                                        setOverrideLocation('');
                                    }}
                                >
                                    <SelectTrigger id="override-market">
                                        <SelectValue placeholder="Select a market..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {GEOGRAPHY_MARKETS.map(option => (
                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="override-location">Location Override (Optional)</Label>
                                <Select
                                    value={overrideLocation}
                                    onValueChange={(value) => setOverrideLocation(value === 'none' ? '' : value)}
                                >
                                    <SelectTrigger id="override-location">
                                        <SelectValue placeholder="Let AI determine location..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none" className="text-muted-foreground italic">Let AI determine location...</SelectItem>
                                        {locationOptions.map(option => (
                                            <SelectItem key={`${option.market}-${option.location}`} value={option.location}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Forces the AI to tag all extracted rules under this specific pilot location.
                                </p>
                            </div>

                            <Button
                                onClick={handleUpload}
                                disabled={!selectedFile || isUploading}
                                className="w-full"
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Extracting...
                                    </>
                                ) : (
                                    'Extract Regulation Data'
                                )}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Alert>
                                <CheckCircle className="h-4 w-4" />
                                <AlertDescription>
                                    Successfully extracted {extractedData.length} regulation{extractedData.length > 1 ? 's' : ''} from {selectedFile?.name}
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-3">
                                <h4 className="font-semibold text-sm">Extracted Regulations:</h4>
                                {extractedData.map((regulation, index) => (
                                    <div key={index} className="bg-secondary p-4 rounded-lg space-y-2 border border-border">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="default">{regulation.type}</Badge>
                                                <span className="text-sm text-muted-foreground">{regulation.location}</span>
                                            </div>
                                            <Badge variant="outline">
                                                {regulation.confidence ? `${(regulation.confidence * 100).toFixed(0)}% confidence` : 'N/A'}
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                            {regulation.geometry?.floor_area_ratio?.value && (
                                                <div>
                                                    <span className="text-muted-foreground">FAR:</span> {regulation.geometry.floor_area_ratio.value}
                                                </div>
                                            )}
                                            {regulation.geometry?.max_height?.value && (
                                                <div>
                                                    <span className="text-muted-foreground">Max Height:</span> {regulation.geometry.max_height.value}m
                                                </div>
                                            )}
                                            {regulation.geometry?.setback?.value && (
                                                <div>
                                                    <span className="text-muted-foreground">Setback:</span> {regulation.geometry.setback.value}m
                                                </div>
                                            )}
                                            {regulation.geometry?.max_ground_coverage?.value && (
                                                <div>
                                                    <span className="text-muted-foreground">Coverage:</span> {regulation.geometry.max_ground_coverage.value}%
                                                </div>
                                            )}
                                        </div>

                                        <details className="mt-2">
                                            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                                                View Full Data
                                            </summary>
                                            <pre className="mt-2 text-xs bg-background p-2 rounded overflow-x-auto max-h-40">
                                                {JSON.stringify(regulation, null, 2)}
                                            </pre>
                                        </details>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" onClick={handleCancel} className="flex-1">
                                    Cancel
                                </Button>
                                <Button onClick={handleUseExtracted} className="flex-1">
                                    Import All ({extractedData.length})
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
