'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { RegulationData, RegulationFieldProvenance, RegulationSectionName, RegulationValue, Plot, REGULATION_SUB_GROUPS, isConditionalRegulationPayload } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Badge } from './ui/badge';
import { BookCopy, Building, Scaling, Droplets, ShieldCheck, Banknote, AlertTriangle, Ruler } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useBuildingStore } from '@/hooks/use-building-store';


interface RegulationViewerModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    plot: Plot;
}

const renderValue = (value: any) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string' && value.trim().length === 0) return '-';
    if (isConditionalRegulationPayload(value)) {
        return (
            <div className="space-y-2">
                <Badge variant="secondary">{value.summary}</Badge>
                <div className="text-xs text-muted-foreground space-y-1">
                    {value.conditions.slice(0, 4).map((condition, index) => (
                        <div key={index}>
                            {condition.when}
                            {condition.value !== undefined ? `: ${condition.value}` : ''}
                            {condition.note ? ` - ${condition.note}` : ''}
                        </div>
                    ))}
                    {value.conditions.length > 4 && <div>+{value.conditions.length - 4} more conditions</div>}
                </div>
            </div>
        );
    }
    if (typeof value === 'object' && value !== null) {
        return <Badge variant="secondary">{Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')}</Badge>;
    }
    return String(value);
};

const getZoningBadgeValue = (regulation?: RegulationData | null) => {
    const zoningValue = regulation?.administration?.land_use_zoning?.value;
    if (typeof zoningValue === 'string' && zoningValue.trim().length > 0) return zoningValue.trim();

    const zoningDesc = regulation?.administration?.land_use_zoning?.desc;
    if (typeof zoningDesc === 'string') {
        const match = zoningDesc.match(/\b([A-Z]{1,4}\d?(?:-\d+)?)\b/);
        if (match) return match[1];
    }

    return null;
};

const getFieldProvenance = (
    regulation: RegulationData | null | undefined,
    section: RegulationSectionName,
    key: string,
): RegulationFieldProvenance | undefined => regulation?.fieldProvenance?.[section]?.[key];

const formatConfidenceLabel = (confidence?: string) =>
    confidence ? `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)}` : null;

const hasMeaningfulFields = (section?: Record<string, RegulationValue>) =>
    Boolean(
        section && Object.values(section).some((field) => {
            if (!field) return false;
            if (field.value !== null && field.value !== undefined && String(field.value).trim() !== '') return true;
            if (field.min !== null && field.min !== undefined && String(field.min).trim() !== '') return true;
            if (field.max !== null && field.max !== undefined && String(field.max).trim() !== '') return true;
            return Boolean(field.desc?.trim());
        })
    );

function RegulationCategory({
    title,
    section,
    data,
    regulation,
    icon: Icon,
}: {
    title: string,
    section: RegulationSectionName,
    data: { [key: string]: RegulationValue },
    regulation: RegulationData,
    icon: React.ElementType,
}) {
    const groupedData: Record<string, [string, RegulationValue][]> = { "General": [] };
    Object.entries(data).forEach(([key, reg]) => {
        let assignedGroup = "General";
        for (const [groupName, keys] of Object.entries(REGULATION_SUB_GROUPS)) {
            if (keys.includes(key)) {
                assignedGroup = groupName;
                break;
            }
        }
        if (!groupedData[assignedGroup]) groupedData[assignedGroup] = [];
        groupedData[assignedGroup].push([key, reg]);
    });

    return (
        <AccordionItem value={title} className="border-b-0 mb-4">
            <AccordionTrigger className="text-lg font-semibold bg-secondary/20 px-4 rounded-lg hover:bg-secondary/40 transition-colors">
                <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-primary" />
                    <span>{title}</span>
                </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 px-1">
                {Object.entries(groupedData).map(([groupName, items]) => {
                    if (items.length === 0) return null;
                    return (
                        <div key={groupName} className="mb-6 last:mb-0">
                            {groupName !== "General" && (
                                <h4 className="text-sm font-semibold text-primary/80 uppercase tracking-widest mb-3 pl-1">{groupName}</h4>
                            )}
                            <div className="border rounded-lg overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="w-[35%]">Parameter</TableHead>
                                            <TableHead>Value</TableHead>
                                            <TableHead>Unit</TableHead>
                                            <TableHead>Min</TableHead>
                                            <TableHead>Max</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                        <TableBody>
                                        {items.map(([key, reg]) => {
                                            const provenance = getFieldProvenance(regulation, section, key);
                                            return (
                                            <TableRow key={key}>
                                                <TableCell>
                                                    <div className="font-medium capitalize flex items-center gap-2 flex-wrap">
                                                        <span>{key.replace(/_/g, ' ')}</span>
                                                        {provenance?.status && (
                                                            <Badge variant={provenance.status === 'missing' ? 'destructive' : provenance.status === 'inferred' || provenance.status === 'partial' ? 'secondary' : 'outline'}>
                                                                {provenance.status}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {reg.desc && <div className="text-xs text-muted-foreground mt-1">{reg.desc}</div>}
                                                    {provenance?.detail && (
                                                        <div className="text-xs text-muted-foreground mt-1">{provenance.detail}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>{renderValue(reg.value)}</TableCell>
                                                <TableCell className="text-muted-foreground">{reg.unit || '-'}</TableCell>
                                                <TableCell>{reg.min !== undefined ? renderValue(reg.min) : '-'}</TableCell>
                                                <TableCell>{reg.max !== undefined ? renderValue(reg.max) : '-'}</TableCell>
                                            </TableRow>
                                        )})}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    );
                })}
            </AccordionContent>
        </AccordionItem>
    );
}

export function RegulationViewerModal({ isOpen, onOpenChange, plot }: RegulationViewerModalProps) {
    const { actions } = useBuildingStore();

    if (!plot) return null;

    const { availableRegulations, selectedRegulationType } = plot;
    const regulation = availableRegulations?.find(r => r.type === selectedRegulationType) || availableRegulations?.[0];

    const handleTypeChange = (newType: string) => {
        actions.updatePlot(plot.id, { selectedRegulationType: newType });
    }

    const zoningDistrict = getZoningBadgeValue(regulation);
    const sourceConfidenceLabel = formatConfidenceLabel(regulation?.sourceInfo?.confidence);
    const unresolvedFieldCount = regulation?.sourceInfo?.missingFields?.length || 0;
    const hasEnvelopeGeometry = Boolean(plot.regulationArtifacts?.gridics?.envelopeGeometry);

    const categories = regulation ? [
        { key: 'geometry' as const, title: 'Geometry & Zoning', icon: Scaling, data: regulation.geometry },
        { key: 'highrise' as const, title: 'High-Rise & Building Code', icon: Ruler, data: regulation.highrise || {} },
        { key: 'facilities' as const, title: 'Facilities', icon: Building, data: regulation.facilities },
        { key: 'sustainability' as const, title: 'Sustainability', icon: Droplets, data: regulation.sustainability },
        { key: 'safety_and_services' as const, title: 'Safety & Services', icon: ShieldCheck, data: regulation.safety_and_services },
        { key: 'administration' as const, title: 'Administration', icon: Banknote, data: regulation.administration },
        ...(hasMeaningfulFields(regulation.accessibility) ? [{ key: 'accessibility' as const, title: 'Accessibility', icon: AlertTriangle, data: regulation.accessibility || {} }] : []),
    ] : [];

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BookCopy className="text-primary"/>
                        Development Regulations
                    </DialogTitle>
                    <DialogDescription>
                        Displaying rules for <span className="font-semibold text-primary">{plot.location}</span>
                    </DialogDescription>
                </DialogHeader>
                
                {availableRegulations && availableRegulations.length > 0 ? (
                    <>
                         <div className='flex items-center gap-4'>
                            <span className="text-sm font-medium">Regulation Type:</span>
                            <Select value={selectedRegulationType || undefined} onValueChange={handleTypeChange}>
                                <SelectTrigger className="w-[250px]">
                                    <SelectValue placeholder="Select a type..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableRegulations.map(reg => (
                                        <SelectItem key={reg.type} value={reg.type}>{reg.type}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {regulation?.codeFamily && (
                                <Badge variant="outline">{regulation.codeFamily}</Badge>
                            )}
                            {regulation?.sourceInfo?.label && (
                                <Badge variant="outline">Source: {regulation.sourceInfo.label}</Badge>
                            )}
                            {sourceConfidenceLabel && (
                                <Badge variant="outline">Confidence: {sourceConfidenceLabel}</Badge>
                            )}
                            {zoningDistrict && (
                                <Badge variant="secondary">Zone: {String(zoningDistrict)}</Badge>
                            )}
                            {unresolvedFieldCount > 0 && (
                                <Badge variant="secondary">{unresolvedFieldCount} unresolved field{unresolvedFieldCount === 1 ? '' : 's'}</Badge>
                            )}
                            {hasEnvelopeGeometry && (
                                <Badge variant="outline">Envelope geometry available</Badge>
                            )}
                        </div>

                        {regulation && (
                             <div className="flex-1 overflow-hidden mt-4">
                                <ScrollArea className="h-full pr-6">
                                    <Accordion type="multiple" defaultValue={categories.map(c => c.title)} className="w-full">
                                        {categories.map(cat => (
                                            cat.data && <RegulationCategory key={cat.key} title={cat.title} section={cat.key} data={cat.data} regulation={regulation} icon={cat.icon} />
                                        ))}
                                    </Accordion>
                                </ScrollArea>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground bg-secondary/30 rounded-lg">
                        <AlertTriangle className="h-10 w-10 mb-4 text-amber-500"/>
                        <h3 className="text-lg font-semibold text-foreground">No Regulations Found</h3>
                        <p className="max-w-md">
                            No specific regulations were found for {`"${plot.location}"`}. The application is using default values.
                            You can add new regulations for this location in the Admin Panel.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
