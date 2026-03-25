"use client";

import { useMemo } from "react";
import { cmapper } from "@niivue/niivue";
import type { ColormapId } from "./ViewerControls";

const TISSUE_LABELS = [
  { id: 0, label: "Background" },
  { id: 1, label: "WM" },
  { id: 2, label: "GM" },
  { id: 3, label: "Eyes" },
  { id: 4, label: "CSF" },
  { id: 5, label: "Air" },
  { id: 6, label: "Blood" },
  { id: 7, label: "Cancellous Bone" },
  { id: 8, label: "Cortical Bone" },
  { id: 9, label: "Skin" },
  { id: 10, label: "Fat" },
  { id: 11, label: "Muscle" },
] as const;

const MAX_LABEL = 11;

const GRACE_TISSUE_COLORS: [number, number, number][] = [
  [  0,   0,   0],
  [240, 240, 240],
  [120, 100, 100],
  [100, 180, 230],
  [200, 160,  80],
  [230, 200, 130],
  [250, 170, 100],
  [ 40,  40,  80],
  [180,  40,  40],
  [255, 230, 100],
  [210,  10,  30],
  [  0, 200, 180],
];

function getLabelColors(colormapName: ColormapId): string[] {
  if (colormapName === "grace_seg_tissues") {
    return TISSUE_LABELS.map(({ id }) => {
      const [r, g, b] = GRACE_TISSUE_COLORS[id];
      return `rgb(${r}, ${g}, ${b})`;
    });
  }
  const lut = cmapper.colormap(colormapName);
  return TISSUE_LABELS.map(({ id }) => {
    if (id === 0) return "rgb(0, 0, 0)";
    const pos = Math.round((id / MAX_LABEL) * 255) * 4;
    return `rgb(${lut[pos]}, ${lut[pos + 1]}, ${lut[pos + 2]})`;
  });
}

interface SegmentationLegendProps {
  colormap: ColormapId;
  selectedLabel?: number | null;
  onLabelSelect?: (labelId: number) => void;
}

export default function SegmentationLegend({ colormap, selectedLabel = null, onLabelSelect }: SegmentationLegendProps) {
  const colors = useMemo(() => getLabelColors(colormap), [colormap]);
  const isFiltering = selectedLabel !== null;
  const selectedTissue = isFiltering ? TISSUE_LABELS.find(t => t.id === selectedLabel) : null;

  return (
    <div
      className="rounded-xl border border-border bg-surface px-5 py-3"
      role="region"
      aria-label="Segmentation tissue legend"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Legend
          </span>
          {isFiltering ? (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {selectedTissue?.label} only
            </span>
          ) : (
            <span className="text-[10px] text-foreground-muted italic">
              click to isolate
            </span>
          )}
        </div>

        <div className="h-4 w-px bg-border hidden sm:block" aria-hidden="true" />

        {TISSUE_LABELS.map((tissue, i) => {
          const isSelected = selectedLabel === tissue.id;
          const isDimmed   = isFiltering && !isSelected;
          return (
            <button
              key={tissue.id}
              type="button"
              onClick={() => onLabelSelect?.(tissue.id)}
              title={isSelected ? `Click to show all` : `Click to isolate ${tissue.label}`}
              className="flex items-center gap-1.5 select-none transition-opacity duration-150 focus:outline-none"
              style={{ opacity: isDimmed ? 0.2 : 1 }}
            >
              <span
                className="inline-block h-3 w-3 flex-shrink-0 rounded-[3px] ring-1 ring-white/10 transition-transform duration-150"
                style={{
                  backgroundColor: colors[i],
                  transform: isSelected ? "scale(1.5)" : "scale(1)",
                  boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 3px ${colors[i]}` : undefined,
                }}
                aria-hidden="true"
              />
              <span className={`text-xs whitespace-nowrap transition-colors duration-150 ${isSelected ? "font-semibold text-foreground" : "text-foreground-secondary"}`}>
                {tissue.label}
              </span>
            </button>
          );
        })}

        {isFiltering && (
          <button
            type="button"
            onClick={() => selectedLabel !== null && onLabelSelect?.(selectedLabel)}
            className="ml-auto text-[10px] text-foreground-muted hover:text-foreground underline underline-offset-2 transition-colors shrink-0"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
}
