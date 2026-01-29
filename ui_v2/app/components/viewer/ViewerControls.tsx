"use client";

import { Layers, Box, Eye, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useId, useState, useRef, useEffect } from "react";

// Available colormaps for segmentation overlays
export const COLORMAPS = [
  { id: "freesurfer", label: "FreeSurfer", description: "Standard neuroimaging labels" },
  { id: "actc", label: "Anatomical", description: "Anatomical color table" },
  { id: "rainbow", label: "Rainbow", description: "Full spectrum colors" },
  { id: "viridis", label: "Viridis", description: "Perceptually uniform" },
  { id: "plasma", label: "Plasma", description: "Warm purple to yellow" },
  { id: "inferno", label: "Inferno", description: "Dark to bright yellow" },
  { id: "magma", label: "Magma", description: "Dark purple to light" },
  { id: "hot", label: "Hot", description: "Black to red to white" },
  { id: "winter", label: "Winter", description: "Blue to green" },
  { id: "cool", label: "Cool", description: "Cyan to magenta" },
  { id: "gray", label: "Grayscale", description: "Black to white" },
] as const;

export type ColormapId = typeof COLORMAPS[number]["id"];

interface ViewerControlsProps {
  viewMode: "2d" | "3d";
  onViewModeChange: (mode: "2d" | "3d") => void;
  overlayOpacity: number;
  onOpacityChange: (opacity: number) => void;
  colormap: ColormapId;
  onColormapChange: (colormap: ColormapId) => void;
}

export default function ViewerControls({
  viewMode,
  onViewModeChange,
  overlayOpacity,
  onOpacityChange,
  colormap,
  onColormapChange,
}: ViewerControlsProps) {
  const sliderId = useId();
  const colormapId = useId();
  const [colormapOpen, setColormapOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const opacityPresets = [
    { value: 0, label: "0%" },
    { value: 0.25, label: "25%" },
    { value: 0.5, label: "50%" },
    { value: 0.75, label: "75%" },
    { value: 1, label: "100%" },
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setColormapOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard for view mode toggle
  const handleViewModeKeyDown = (e: React.KeyboardEvent, mode: "2d" | "3d") => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onViewModeChange(mode);
    }
  };

  const currentColormap = COLORMAPS.find(c => c.id === colormap) || COLORMAPS[0];

  return (
    <div className="flex flex-wrap items-center gap-4" role="group" aria-label="Viewer display controls">
      {/* View Mode Toggle */}
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">View mode selection</legend>
        <span className="text-sm text-foreground-muted" aria-hidden="true">View:</span>
        <div
          className="flex rounded-lg border border-border bg-surface p-1"
          role="radiogroup"
          aria-label="Select view mode"
        >
          <button
            onClick={() => onViewModeChange("2d")}
            onKeyDown={(e) => handleViewModeKeyDown(e, "2d")}
            role="radio"
            aria-checked={viewMode === "2d"}
            aria-label="2D multiplanar view"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              viewMode === "2d"
                ? "bg-accent text-accent-foreground"
                : "text-foreground-secondary hover:text-foreground"
            )}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            2D
          </button>
          <button
            onClick={() => onViewModeChange("3d")}
            onKeyDown={(e) => handleViewModeKeyDown(e, "3d")}
            role="radio"
            aria-checked={viewMode === "3d"}
            aria-label="3D rendered view"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              viewMode === "3d"
                ? "bg-accent text-accent-foreground"
                : "text-foreground-secondary hover:text-foreground"
            )}
          >
            <Box className="h-4 w-4" aria-hidden="true" />
            3D
          </button>
        </div>
      </fieldset>

      {/* Colormap Selector */}
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Colormap selection</legend>
        <Palette className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
        <span className="text-sm text-foreground-muted" aria-hidden="true">Colors:</span>
        <div ref={dropdownRef} className="relative">
          <button
            id={colormapId}
            onClick={() => setColormapOpen(!colormapOpen)}
            aria-haspopup="listbox"
            aria-expanded={colormapOpen}
            aria-label={`Select colormap, currently ${currentColormap.label}`}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm",
              "hover:bg-surface-elevated transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            )}
          >
            <span className="font-medium">{currentColormap.label}</span>
            <svg className={cn("h-4 w-4 transition-transform", colormapOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {colormapOpen && (
            <ul
              role="listbox"
              aria-labelledby={colormapId}
              className="absolute left-0 top-full z-50 mt-1 max-h-60 w-48 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg animate-scale-in"
            >
              {COLORMAPS.map((cmap) => (
                <li
                  key={cmap.id}
                  role="option"
                  aria-selected={colormap === cmap.id}
                  onClick={() => {
                    onColormapChange(cmap.id);
                    setColormapOpen(false);
                  }}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm transition-colors",
                    "hover:bg-surface-elevated focus:bg-surface-elevated",
                    colormap === cmap.id && "bg-accent/10 text-accent"
                  )}
                >
                  <div className="font-medium">{cmap.label}</div>
                  <div className="text-xs text-foreground-muted">{cmap.description}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      {/* Opacity Control */}
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Segmentation overlay opacity</legend>
        <Eye className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
        <span className="text-sm text-foreground-muted" id={`${sliderId}-label`}>Overlay:</span>
        <div
          className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
          role="group"
          aria-label="Opacity presets"
        >
          {opacityPresets.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onOpacityChange(preset.value)}
              aria-pressed={Math.abs(overlayOpacity - preset.value) < 0.01}
              aria-label={`Set overlay opacity to ${preset.label}`}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                Math.abs(overlayOpacity - preset.value) < 0.01
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Slider for fine control */}
      <div className="flex items-center gap-2">
        <label htmlFor={sliderId} className="sr-only">
          Fine opacity control
        </label>
        <input
          id={sliderId}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={overlayOpacity}
          onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
          aria-labelledby={`${sliderId}-label`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overlayOpacity * 100)}
          aria-valuetext={`${Math.round(overlayOpacity * 100)} percent`}
          className="h-2 w-24 cursor-pointer appearance-none rounded-lg bg-border accent-accent focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span
          className="w-10 text-right text-xs text-foreground-muted"
          aria-hidden="true"
        >
          {Math.round(overlayOpacity * 100)}%
        </span>
      </div>
    </div>
  );
}
