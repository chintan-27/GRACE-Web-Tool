"use client";

import { useState } from "react";
import { getModelStats, ModelStatsResponse } from "@/lib/api";
import { BarChart2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  sessionId: string;
  modelName: string;
}

export function VolumeStatsPanel({ sessionId, modelName }: Props) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<ModelStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (stats) return; // already loaded

    setLoading(true);
    setError("");
    try {
      const result = await getModelStats(sessionId, modelName);
      setStats(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  // Compute brain volume (labels 1–11, excluding background 0)
  const brainVolume = stats
    ? Object.entries(stats.labels)
        .filter(([id]) => id !== "0")
        .reduce((sum, [, v]) => sum + v.volume_mm3, 0)
    : 0;

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden">
      {/* Toggle button */}
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2",
          "bg-surface text-xs font-medium text-foreground-secondary",
          "hover:bg-surface-elevated transition-colors"
        )}
      >
        <span className="flex items-center gap-1.5">
          <BarChart2 className="h-3.5 w-3.5 text-accent" />
          Tissue volumes
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {/* Content */}
      {open && (
        <div className="bg-surface-elevated">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-foreground-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Computing volumes…
            </div>
          )}

          {error && (
            <p className="px-3 py-3 text-xs text-red-400">{error}</p>
          )}

          {stats && !loading && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-foreground-muted">
                    <th className="px-3 py-2 text-left font-medium">Tissue</th>
                    <th className="px-3 py-2 text-right font-medium">Volume (mm³)</th>
                    <th className="px-3 py-2 text-right font-medium">% Brain</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.labels).map(([id, label]) => {
                    const pct =
                      id === "0" || brainVolume === 0
                        ? null
                        : ((label.volume_mm3 / brainVolume) * 100).toFixed(1);
                    return (
                      <tr
                        key={id}
                        className={cn(
                          "border-b border-border/50 hover:bg-surface transition-colors",
                          id === "0" && "text-foreground-muted"
                        )}
                      >
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ background: getLabelColor(Number(id)) }}
                            />
                            {label.name}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {label.volume_mm3.toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground-muted">
                          {pct !== null ? `${pct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border text-foreground-muted">
                    <td className="px-3 py-2 text-xs" colSpan={3}>
                      Voxel size: {stats.voxel_volume_mm3} mm³
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Simple colour map matching the segmentation legend (indices 0–11)
function getLabelColor(id: number): string {
  const colors = [
    "#374151", // 0 Background — grey
    "#e5e7eb", // 1 White Matter
    "#9ca3af", // 2 Grey Matter
    "#60a5fa", // 3 Eyes
    "#93c5fd", // 4 CSF
    "#d1d5db", // 5 Air
    "#f87171", // 6 Blood
    "#fcd34d", // 7 Spongy Bone
    "#f9a825", // 8 Compact Bone
    "#fdba74", // 9 Skin
    "#fde68a", // 10 Fat
    "#86efac", // 11 Muscle
  ];
  return colors[id] ?? "#6b7280";
}
