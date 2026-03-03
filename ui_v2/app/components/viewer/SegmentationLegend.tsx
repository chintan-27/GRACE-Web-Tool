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

// Mirror of TISSUE_COLORS in SplitViewer.tsx for the "grace_seg_tissues" case.
// The viewer registers the LUT under a fixed key rather than "grace_seg_tissues",
// so we keep these here to render the legend without needing the Niivue instance.
const GRACE_TISSUE_COLORS: [number, number, number][] = [
  [  0,   0,   0],  //  0: background
  [240, 240, 240],  //  1: white matter
  [120, 100, 100],  //  2: gray matter
  [100, 180, 230],  //  3: CSF
  [200, 160,  80],  //  4: compact bone
  [230, 200, 130],  //  5: spongy bone
  [250, 170, 100],  //  6: scalp
  [ 40,  40,  80],  //  7: air cavities
  [180,  40,  40],  //  8: muscle
  [255, 230, 100],  //  9: fat
  [210,  10,  30],  // 10: blood
  [  0, 200, 180],  // 11: eye
];

function getLabelColors(colormapName: ColormapId): string[] {
  // "grace_seg_tissues" uses hand-crafted tissue colors not registered in cmapper.
  if (colormapName === "grace_seg_tissues") {
    return TISSUE_LABELS.map(({ id }) => {
      const [r, g, b] = GRACE_TISSUE_COLORS[id];
      return `rgb(${r}, ${g}, ${b})`;
    });
  }

  // For all other colormaps, sample the interpolated 256-entry LUT at the
  // same 12 positions the viewer uses — this keeps the legend in sync.
  const lut = cmapper.colormap(colormapName);
  return TISSUE_LABELS.map(({ id }) => {
    if (id === 0) return "rgb(0, 0, 0)";
    const pos = Math.round((id / MAX_LABEL) * 255) * 4;
    return `rgb(${lut[pos]}, ${lut[pos + 1]}, ${lut[pos + 2]})`;
  });
}

interface SegmentationLegendProps {
  colormap: ColormapId;
  hoveredLabel?: number | null;
  onLabelHover?: (labelId: number | null) => void;
}

export default function SegmentationLegend({ colormap, hoveredLabel = null, onLabelHover }: SegmentationLegendProps) {
  const colors = useMemo(() => getLabelColors(colormap), [colormap]);
  const isFiltering = hoveredLabel !== null;

  return (
    <div
      className="rounded-xl border border-border bg-surface px-5 py-3"
      role="region"
      aria-label="Segmentation tissue legend"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
          Legend
        </span>
        <div className="h-4 w-px bg-border hidden sm:block" aria-hidden="true" />
        {TISSUE_LABELS.map((tissue, i) => {
          const isHovered = hoveredLabel === tissue.id;
          const isDimmed  = isFiltering && !isHovered;
          return (
            <div
              key={tissue.id}
              className="flex items-center gap-1.5 cursor-pointer select-none transition-opacity duration-150"
              style={{ opacity: isDimmed ? 0.2 : 1 }}
              onMouseEnter={() => onLabelHover?.(tissue.id)}
              onMouseLeave={() => onLabelHover?.(null)}
              title={tissue.label}
            >
              <span
                className="inline-block h-3 w-3 flex-shrink-0 rounded-[3px] ring-1 ring-white/10 transition-transform duration-150"
                style={{
                  backgroundColor: colors[i],
                  transform: isHovered ? "scale(1.4)" : "scale(1)",
                }}
                aria-hidden="true"
              />
              <span className={`text-xs whitespace-nowrap transition-colors duration-150 ${isHovered ? "font-semibold text-foreground" : "text-foreground-secondary"}`}>
                {tissue.label}
              </span>
            </div>
          );
        })}
        {isFiltering && (
          <button
            className="ml-auto text-[10px] text-foreground-muted hover:text-foreground underline underline-offset-2 transition-colors"
            onMouseEnter={() => onLabelHover?.(null)}
            onClick={() => onLabelHover?.(null)}
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
}
