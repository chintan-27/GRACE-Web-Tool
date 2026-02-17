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

// Label-type colormaps use direct index-to-color mapping.
// Continuous colormaps use interpolated 256-entry gradients.
const LABEL_COLORMAPS = new Set(["freesurfer", "actc"]);

function getLabelColors(colormapName: ColormapId): string[] {
  const cm = cmapper.colormapFromKey(colormapName);

  if (LABEL_COLORMAPS.has(colormapName)) {
    // Label colormap: use makeLabelLut for direct mapping
    const lut = cmapper.makeLabelLut(cm);
    const minIdx = lut.min ?? 0;
    return TISSUE_LABELS.map(({ id }) => {
      const offset = (id - minIdx) * 4;
      if (offset >= 0 && offset + 2 < lut.lut.length) {
        return `rgb(${lut.lut[offset]}, ${lut.lut[offset + 1]}, ${lut.lut[offset + 2]})`;
      }
      return "rgb(0, 0, 0)";
    });
  }

  // Continuous colormap: sample from interpolated 256-entry LUT
  const lut = cmapper.colormap(colormapName);
  return TISSUE_LABELS.map(({ id }) => {
    const pos = Math.round((id / MAX_LABEL) * 255) * 4;
    return `rgb(${lut[pos]}, ${lut[pos + 1]}, ${lut[pos + 2]})`;
  });
}

interface SegmentationLegendProps {
  colormap: ColormapId;
}

export default function SegmentationLegend({ colormap }: SegmentationLegendProps) {
  const colors = useMemo(() => getLabelColors(colormap), [colormap]);

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
        {TISSUE_LABELS.map((tissue, i) => (
          <div key={tissue.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 flex-shrink-0 rounded-[3px] ring-1 ring-white/10"
              style={{ backgroundColor: colors[i] }}
              aria-hidden="true"
            />
            <span className="text-xs text-foreground-secondary whitespace-nowrap">
              {tissue.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
