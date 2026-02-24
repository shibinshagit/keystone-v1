'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { X, Wind, Sun, Thermometer, Droplets, CloudSun, RefreshCw } from 'lucide-react';
import { fetchWeatherData, getConditionsAtHour, type WeatherData, type CurrentConditions } from '@/lib/engines/weather-data-service';
import { useBuildingStore } from '@/hooks/use-building-store';
import * as turf from '@turf/turf';
import type { AnalysisMode } from './solar-controls';

interface SimulationDataPanelProps {
    analysisMode: AnalysisMode;
    isOpen: boolean;
    onClose: () => void;
    date?: Date; // The selected simulation date (drives historical vs live)
}

export function SimulationDataPanel({ analysisMode, isOpen, onClose, date }: SimulationDataPanelProps) {
    const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
    const [conditions, setConditions] = useState<CurrentConditions | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const plots = useBuildingStore(s => s.plots);

    const fetchData = useCallback(async () => {
        if (plots.length === 0 || !plots[0].geometry) return;
        
        setIsLoading(true);
        try {
            const centroid = turf.centroid(plots[0].geometry);
            const [lng, lat] = centroid.geometry.coordinates;
            const effectiveDate = date || new Date();
            const data = await fetchWeatherData(lat, lng, effectiveDate);
            setWeatherData(data);
            // Show conditions at the selected hour
            const hour = effectiveDate.getHours();
            setConditions(getConditionsAtHour(data, hour));
        } catch (err) {
            console.error('[SIM-DATA] Failed to fetch weather:', err);
        } finally {
            setIsLoading(false);
        }
    }, [plots, date]);

    useEffect(() => {
        if (isOpen && analysisMode !== 'none') {
            fetchData();
        }
    }, [isOpen, analysisMode, fetchData]);

    if (!isOpen || analysisMode === 'none') return null;

    const hourly = weatherData?.hourly;

    // Build simple sparkline SVG from hourly data
    const renderSparkline = (data: number[], color: string, unit: string, label: string, icon: React.ReactNode) => {
        if (!data || data.length === 0) return null;
        const max = Math.max(...data);
        const min = Math.min(...data);
        const range = max - min || 1;
        const width = 280;
        const height = 48;
        const points = data.map((v, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((v - min) / range) * (height - 4) - 2;
            return `${x},${y}`;
        }).join(' ');
        
        // Use selected hour from date prop, not wall clock
        const selectedHour = (date || new Date()).getHours();
        const currentValue = data[Math.min(selectedHour, data.length - 1)];

        return (
            <div className="bg-muted/20 rounded-lg p-3 border border-border/30">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                        {icon}
                        <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
                    </div>
                    <span className="text-sm font-bold" style={{ color }}>{currentValue.toFixed(1)} {unit}</span>
                </div>
                <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-1">
                    <defs>
                        <linearGradient id={`grad-${label.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {/* Area fill */}
                    <polygon
                        points={`0,${height} ${points} ${width},${height}`}
                        fill={`url(#grad-${label.replace(/\s/g, '')})`}
                    />
                    {/* Line */}
                    <polyline
                        points={points}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    {/* Selected hour marker */}
                    {selectedHour < data.length && (
                        <>
                            {/* Vertical line at selected hour */}
                            <line
                                x1={(selectedHour / (data.length - 1)) * width}
                                y1={0}
                                x2={(selectedHour / (data.length - 1)) * width}
                                y2={height}
                                stroke={color}
                                strokeWidth="1"
                                strokeDasharray="3,2"
                                strokeOpacity="0.5"
                            />
                            <circle
                                cx={(selectedHour / (data.length - 1)) * width}
                                cy={height - ((data[selectedHour] - min) / range) * (height - 4) - 2}
                                r="3.5"
                                fill={color}
                                stroke="white"
                                strokeWidth="1.5"
                            />
                        </>
                    )}
                </svg>
                <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                    <span>12 AM</span>
                    <span>6 AM</span>
                    <span>12 PM</span>
                    <span>6 PM</span>
                    <span>11 PM</span>
                </div>
            </div>
        );
    };

    // Mode-relevant graphs
    const getGraphsForMode = () => {
        if (!hourly) return null;
        
        switch (analysisMode) {
            case 'sun-hours':
            case 'daylight':
                return (
                    <>
                        {renderSparkline(hourly.shortwaveRadiation, '#f59e0b', 'W/m²', 'Solar Radiation', <Sun className="h-3.5 w-3.5 text-amber-500" />)}
                        {renderSparkline(hourly.directRadiation, '#ef4444', 'W/m²', 'Direct Radiation', <CloudSun className="h-3.5 w-3.5 text-red-400" />)}
                        {renderSparkline(hourly.temperature, '#6366f1', '°C', 'Temperature', <Thermometer className="h-3.5 w-3.5 text-indigo-500" />)}
                    </>
                );
            case 'wind':
                return (
                    <>
                        {renderSparkline(hourly.windSpeed.map(v => v / 3.6), '#3b82f6', 'm/s', 'Wind Speed', <Wind className="h-3.5 w-3.5 text-blue-500" />)}
                        {renderSparkline(hourly.windDirection, '#10b981', '°', 'Wind Direction', <Wind className="h-3.5 w-3.5 text-emerald-500" />)}
                        {renderSparkline(hourly.temperature, '#6366f1', '°C', 'Temperature', <Thermometer className="h-3.5 w-3.5 text-indigo-500" />)}
                    </>
                );
            case 'energy':
                return (
                    <>
                        {renderSparkline(hourly.temperature, '#ef4444', '°C', 'Temperature', <Thermometer className="h-3.5 w-3.5 text-red-500" />)}
                        {renderSparkline(hourly.shortwaveRadiation, '#f59e0b', 'W/m²', 'Solar Heat Gain', <Sun className="h-3.5 w-3.5 text-amber-500" />)}
                        {renderSparkline(hourly.relativeHumidity, '#06b6d4', '%', 'Humidity', <Droplets className="h-3.5 w-3.5 text-cyan-500" />)}
                    </>
                );
            case 'mobility':
                return (
                    <>
                        {renderSparkline(hourly.temperature, '#6366f1', '°C', 'Temperature', <Thermometer className="h-3.5 w-3.5 text-indigo-500" />)}
                        {renderSparkline(hourly.windSpeed.map(v => v / 3.6), '#3b82f6', 'm/s', 'Wind Speed', <Wind className="h-3.5 w-3.5 text-blue-500" />)}
                    </>
                );
            case 'resilience':
                return (
                    <>
                        {renderSparkline(hourly.windSpeed.map(v => v / 3.6), '#ef4444', 'm/s', 'Wind Speed', <Wind className="h-3.5 w-3.5 text-red-500" />)}
                        {renderSparkline(hourly.shortwaveRadiation, '#f59e0b', 'W/m²', 'Solar Radiation', <Sun className="h-3.5 w-3.5 text-amber-500" />)}
                        {renderSparkline(hourly.temperature, '#6366f1', '°C', 'Temperature', <Thermometer className="h-3.5 w-3.5 text-indigo-500" />)}
                    </>
                );
            default:
                return null;
        }
    };

    const modeLabels: Record<string, string> = {
        'sun-hours': 'Sun Hours Analysis',
        'daylight': 'Daylight Analysis',
        'wind': 'Wind / CFD Analysis',
        'energy': 'Energy Analysis',
        'mobility': 'Mobility Analysis',
        'resilience': 'Resilience Analysis',
    };

    const isHistorical = weatherData?.isLive && date && (() => {
        const today = new Date();
        return date.getFullYear() !== today.getFullYear() ||
            date.getMonth() !== today.getMonth() ||
            date.getDate() !== today.getDate();
    })();

    return (
        <div className="pointer-events-auto w-96 flex flex-col h-full max-h-[calc(100vh-200px)] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-xl border shadow-xl animate-in slide-in-from-top-2 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full animate-pulse", isHistorical ? "bg-blue-400" : "bg-green-500")} />
                    <h3 className="text-sm font-semibold">{modeLabels[analysisMode] || 'Simulation Data'}</h3>
                    {isHistorical && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 font-semibold">ERA5</span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={fetchData}
                        className="p-1 rounded hover:bg-muted transition-colors"
                        title="Refresh data"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", isLoading && "animate-spin")} />
                    </button>
                    <button 
                        onClick={onClose}
                        className="p-1 rounded hover:bg-muted transition-colors"
                    >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 scrollbar-thin">
                {/* Current Conditions */}
                {conditions && (
                    <div className="px-4 py-3 border-b border-border/30">
                    <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                            {isHistorical ? (
                                <>{date?.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} {date?.getHours()}:00</>
                            ) : 'Current Conditions'}
                        </span>
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium ml-1",
                            conditions.isLive
                                ? (isHistorical ? "bg-blue-500/15 text-blue-600" : "bg-green-500/15 text-green-600")
                                : "bg-yellow-500/15 text-yellow-600"
                        )}>
                            {conditions.isLive ? (isHistorical ? 'ERA5 DATA' : 'LIVE') : 'ESTIMATED'}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        <div className="text-center">
                            <Thermometer className="h-4 w-4 mx-auto text-red-400 mb-0.5" />
                            <div className="text-sm font-bold">{conditions.temperature.toFixed(0)}°</div>
                            <div className="text-[9px] text-muted-foreground">Temp</div>
                        </div>
                        <div className="text-center">
                            <Wind className="h-4 w-4 mx-auto text-blue-400 mb-0.5" />
                            <div className="text-sm font-bold">{conditions.windSpeed} <span className="text-[9px] font-normal">m/s</span></div>
                            <div className="text-[9px] text-muted-foreground">{conditions.windDirectionLabel}</div>
                        </div>
                        <div className="text-center">
                            <Sun className="h-4 w-4 mx-auto text-amber-400 mb-0.5" />
                            <div className="text-sm font-bold">{conditions.solarRadiation.toFixed(0)}</div>
                            <div className="text-[9px] text-muted-foreground">W/m²</div>
                        </div>
                        <div className="text-center">
                            <Droplets className="h-4 w-4 mx-auto text-cyan-400 mb-0.5" />
                            <div className="text-sm font-bold">{conditions.humidity}%</div>
                            <div className="text-[9px] text-muted-foreground">Humidity</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Graphs */}
            <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">24-Hour Data</span>
                    <span className="text-[9px] text-muted-foreground ml-auto">
                        {isHistorical ? 'ERA5 Archive' : 'Forecast'}
                    </span>
                </div>
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />
                        <span className="text-sm text-muted-foreground ml-2">Fetching weather data...</span>
                    </div>
                ) : (
                    getGraphsForMode()
                )}
            </div>
            </div>
        </div>
    );
}
