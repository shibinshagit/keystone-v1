
'use client';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { X, RefreshCw } from 'lucide-react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { toast } from '@/hooks/use-toast';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';
import { REGULATION_SUB_GROUPS } from '@/lib/types';

interface AdminDetailsSidebarProps {
    title: string;
    data: { [key: string]: any };
    path: string;
    onUpdate: (path: string, value: any) => void;
    onFullUpdate: (data: any) => void;
    onClose: () => void;
}

const renderValueInput = (currentPath: string, value: any, onUpdate: (path: string, value: any) => void, placeholder?: string) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return (
            <div className="space-y-4 pl-4 border-l ml-2 mt-2">
                {Object.entries(value).map(([subKey, subValue]) => (
                    <div key={subKey} className="grid grid-cols-2 items-center">
                        <Label className="text-xs capitalize text-muted-foreground">{subKey.replace(/_/g, ' ')}</Label>
                        {renderValueInput(`${currentPath}.${subKey}`, subValue, onUpdate)}
                    </div>
                ))}
            </div>
        );
    } else {
        return (
            <Input
                type="text"
                value={value === undefined ? '' : value}
                placeholder={placeholder}
                onChange={(e) => {
                    const text = e.target.value;
                    const num = parseFloat(text);
                    if (text !== "" && !isNaN(Number(text))) {
                        onUpdate(currentPath, num);
                    } else {
                        onUpdate(currentPath, text);
                    }
                }}
                className="text-xs h-8 bg-background"
            />
        );
    }
};

export function AdminDetailsSidebar({ title, data, path, onUpdate, onFullUpdate, onClose }: AdminDetailsSidebarProps) {
    const [jsonString, setJsonString] = useState('');
    const [view, setView] = useState<'form' | 'json'>('form');

    useEffect(() => {
        setJsonString(JSON.stringify(data, null, 2));
    }, [data]);
    
    const handleJsonSync = () => {
        try {
            const parsedData = JSON.parse(jsonString);
            onFullUpdate(parsedData);
            toast({ title: 'Synced!', description: 'Data has been updated from JSON.' });
        } catch (error) {
            console.error("JSON Parse Error:", error);
            toast({ variant: 'destructive', title: 'JSON Error', description: 'Could not parse JSON string.' });
        }
    }

    return (
        <div className="fixed top-0 right-0 h-screen w-[600px] bg-secondary border-l border-border z-20 flex flex-col">
            <CardHeader className="flex flex-row items-start justify-between">
                <div>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>Edit regulation parameters</CardDescription>
                </div>
                 <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="view-switch">Form</Label>
                        <Switch id="view-switch" checked={view === 'json'} onCheckedChange={(checked) => setView(checked ? 'json' : 'form')} />
                        <Label htmlFor="view-switch">JSON</Label>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <ScrollArea className="flex-1">
                <CardContent className="space-y-6 h-full">
                    {view === 'form' ? (
                         <>
                            {(() => {
                                if (!data) return null;
                                const groupedData: Record<string, [string, any][]> = { "General": [] };
                                Object.entries(data).forEach(([key, item]) => {
                                    let assignedGroup = "General";
                                    for (const [groupName, keys] of Object.entries(REGULATION_SUB_GROUPS)) {
                                        if (keys.includes(key)) {
                                            assignedGroup = groupName;
                                            break;
                                        }
                                    }
                                    if (!groupedData[assignedGroup]) groupedData[assignedGroup] = [];
                                    groupedData[assignedGroup].push([key, item]);
                                });

                                return Object.entries(groupedData).map(([groupName, items]) => {
                                    if (items.length === 0) return null;
                                    return (
                                        <div key={groupName} className="mb-8">
                                            {groupName !== "General" && (
                                                <div className="flex items-center gap-2 mb-4">
                                                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wider">{groupName}</h3>
                                                    <Separator className="flex-1" />
                                                </div>
                                            )}
                                            <div className="space-y-4">
                                                {items.map(([key, item]) => (
                                                    <Card key={key} className="bg-background/50">
                                                        <CardHeader>
                                                            <CardTitle className="text-base capitalize">{key.replace(/_/g, ' ')}</CardTitle>
                                                        </CardHeader>
                                                        <CardContent className="space-y-4">
                                                            <div className="grid grid-cols-3 gap-4 items-start">
                                                                <Label className="text-sm pt-2">Description</Label>
                                                                <Textarea
                                                                    value={item.desc}
                                                                    onChange={(e) => onUpdate(`${path}.${key}.desc`, e.target.value)}
                                                                    className="text-xs bg-background col-span-2"
                                                                    rows={4}
                                                                />
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-4 items-center">
                                                                <Label className="text-sm">Unit</Label>
                                                                <Input
                                                                    value={item.unit}
                                                                    onChange={(e) => onUpdate(`${path}.${key}.unit`, e.target.value)}
                                                                    className="bg-background col-span-2"
                                                                />
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-4 items-start">
                                                                <Label className="text-sm pt-2">Value</Label>
                                                                <div className="col-span-2">
                                                                    {renderValueInput(`${path}.${key}.value`, item.value, onUpdate, item.exampleStr)}
                                                                </div>
                                                            </div>
                                                            {item.min !== undefined && (
                                                                <div className="grid grid-cols-3 gap-4 items-start">
                                                                    <Label className="text-sm pt-2">Min</Label>
                                                                    <div className="col-span-2">
                                                                        {renderValueInput(`${path}.${key}.min`, item.min, onUpdate, item.exampleStr ? `${item.exampleStr} (min)` : undefined)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {item.max !== undefined && (
                                                                <div className="grid grid-cols-3 gap-4 items-start">
                                                                    <Label className="text-sm pt-2">Max</Label>
                                                                    <div className="col-span-2">
                                                                        {renderValueInput(`${path}.${key}.max`, item.max, onUpdate, item.exampleStr ? `${item.exampleStr} (max)` : undefined)}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </>
                    ) : (
                        <div className="space-y-4 px-1 h-full flex flex-col">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="text-lg font-semibold">JSON Editor</h3>
                                    <p className="text-sm text-muted-foreground">Sync changes from the JSON below.</p>
                                </div>
                                <Button onClick={handleJsonSync}>
                                    <RefreshCw className="mr-2 h-4 w-4" /> Sync JSON
                                </Button>
                            </div>
                            <Textarea
                                value={jsonString}
                                onChange={(e) => setJsonString(e.target.value)}
                                className="h-[70dvh] font-mono text-xs bg-background/50"
                                placeholder="Paste JSON here..."
                            />
                        </div>
                    )}
                   
                </CardContent>
            </ScrollArea>
        </div>
    );
}

    