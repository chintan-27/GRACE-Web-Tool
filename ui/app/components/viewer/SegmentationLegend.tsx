"use client";

import { useMemo } from "react";
import { cmapper } from "@niivue/niivue";
import type { ColormapId } from "./ViewerControls";

const TISSUE_LABELS = [
  { id: 0,  label: "Background" },
  { id: 1,  label: "WM" },
  { id: 2,  label: "GM" },
  { id: 3,  label: "Eyes" },
  { id: 4,  label: "CSF" },
  { id: 5,  label: "Air" },
  { id: 6,  label: "Blood" },
  { id: 7,  label: "Cancellous Bone" },
  { id: 8,  label: "Cortical Bone" },
  { id: 9,  label: "Skin" },
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
  selectedLabels?: Set<number>;
  onLabelToggle?: (labelId: number) => void;
  onClearAll?: () => void;
}

export default function SegmentationLegend({
  colormap,
  selectedLabels = new Set(),
  onLabelToggle,
  onClearAll,
}: SegmentationLegendProps) {
  const colors = useMemo(() => getLabelColors(colormap), [colormap]);
  const isolating = selectedLabels.size > 0;
  const selectedCount = selectedLabels.size;

  return (
    <div
      className="rounded-xl border border-border bg-surface px-4 py-3 space-y-2.5"
      role="region"
      aria-label="Segmentation tissue legend"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Tissues
          </span>
          {isolating ? (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
              {selectedCount} isolated
            </span>
          ) : (
            <span className="text-[10px] text-foreground-muted italic">
              click to isolate · multi-select supported
            </span>
          )}
        </div>
        {isolating && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[10px] text-foreground-muted hover:text-foreground underline underline-offset-2 transition-colors shrink-0"
          >
            Show all
          </button>
        )}
      </div>

      {/* Tissue pills */}
      <div className="flex flex-wrap gap-1.5">
        {TISSUE_LABELS.map((tissue, i) => {
          const isSelected = selectedLabels.has(tissue.id);
          const isDimmed   = isolating && !isSelected;
          return (
            <button
              key={tissue.id}
              type="button"
              onClick={() => onLabelToggle?.(tissue.id)}
              title={isSelected ? `Remove ${tissue.label} from isolation` : `Isolate ${tissue.label}`}
              aria-pressed={isSelected}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-ring select-none"
              style={{
                borderColor: isSelected ? colors[i] : undefined,
                backgroundColor: isSelected ? `${colors[i]}22` : undefined,
                opacity: isDimmed ? 0.3 : 1,
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-[3px] ring-1 ring-white/10 transition-transform duration-150"
                style={{
                  backgroundColor: colors[i],
                  transform: isSelected ? "scale(1.2)" : "scale(1)",
                }}
                aria-hidden="true"
              />
              <span className={isSelected ? "font-semibold text-foreground" : "text-foreground-secondary"}>
                {tissue.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
