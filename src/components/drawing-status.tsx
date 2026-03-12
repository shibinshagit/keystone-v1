'use client';
import React from 'react';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Button } from '@/components/ui/button';
import { Building, X, Route } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

export function DrawingStatus() {
    const { drawingState, drawingPoints, actions } = useBuildingStore(s => ({
        drawingState: s.drawingState,
        drawingPoints: s.drawingPoints,
        actions: s.actions,
    }));

    if (!drawingState.isDrawing) {
        return null;
    }

    const isRoad = drawingState.objectType === 'Road';
    const isRotate = drawingState.objectType === 'Rotate';
    const canFinish = isRoad ? drawingPoints.length >= 2 : drawingPoints.length > 2;

    const handleFinish = () => {
        if (isRoad) {
            window.dispatchEvent(new CustomEvent('finishRoad'));
        } else {
            window.dispatchEvent(new CustomEvent('closePolygon'));
        }
    };

    // Hide instructions for Rotate tool
    if (isRotate) {
        return null;
    }

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
            <Card className="bg-background/80 backdrop-blur-sm shadow-xl border-primary/20">
                <CardHeader className="py-2 px-4">
                    <CardTitle className='text-sm font-medium flex items-center justify-between gap-4'>
                        <span className="flex items-center gap-2">
                            Drawing a new {drawingState.objectType}
                        </span>
                        <Button variant="ghost" size="icon" className='h-6 w-6 hover:bg-destructive/10 hover:text-destructive' onClick={actions.resetDrawing}>
                            <X className='h-4 w-4' />
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className='flex items-center gap-6 py-2 px-4'>
                    <p className="text-xs text-muted-foreground">
                        {isRoad
                            ? "Click to add road points. 2 points minimum."
                            : "Click to add points. Last click first point to close."}
                    </p>
                    {canFinish && (
                        <Button size="sm" className="h-8" onClick={handleFinish}>
                            {isRoad ? <Route className="mr-2 h-4 w-4" /> : <Building className="mr-2 h-4 w-4" />}
                            {isRoad ? 'Finish' : `Create ${drawingState.objectType}`}
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
