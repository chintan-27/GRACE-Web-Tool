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

function getLabelColors(colormapName: ColormapId): string[] {
  // Use the interpolated 256-entry LUT — this matches how Niivue
  // renders colormaps on volumes (normalizes voxel range to 0-255).
  const lut = cmapper.colormap(colormapName);

  return TISSUE_LABELS.map(({ id }) => {
    // Label 0 is always black (background / transparent in the viewer)
    if (id === 0) return "rgb(0, 0, 0)";

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
