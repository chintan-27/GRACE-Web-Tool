"use client";

import { useState, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Electrode positions grouped by brain region (10-10 system + neck)
// Only positions relevant to tDCS are included.
// -------------------------------------------------------------------
export const ELECTRODE_GROUPS: { label: string; positions: string[] }[] = [
  {
    label: "Prefrontal",
    positions: ["Fp1", "Fp2", "Fpz", "AF3", "AF4", "AFz", "AF7", "AF8"],
  },
  {
    label: "Frontal",
    positions: ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "Fz"],
  },
  {
    label: "Fronto-Central",
    positions: ["FC1", "FC2", "FC3", "FC4", "FC5", "FC6", "FCz", "FT7", "FT8"],
  },
  {
    label: "Central",
    positions: ["C1", "C2", "C3", "C4", "C5", "C6", "Cz"],
  },
  {
    label: "Centro-Parietal",
    positions: ["CP1", "CP2", "CP3", "CP4", "CP5", "CP6", "CPz", "TP7", "TP8"],
  },
  {
    label: "Parietal",
    positions: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "Pz"],
  },
  {
    label: "Parieto-Occipital",
    positions: ["PO3", "PO4", "POz", "PO7", "PO8"],
  },
  {
    label: "Occipital & Temporal",
    positions: ["O1", "O2", "Oz", "T7", "T8", "Iz"],
  },
  {
    // Neck electrodes — for cerebellar/spinal cord protocols.
    // Nk1=left-posterior, Nk2=right-posterior, Nk3=left-anterior, Nk4=right-anterior
    label: "Neck (Nk1–Nk4)",
    positions: ["Nk1", "Nk2", "Nk3", "Nk4"],
  },
];

export const ALL_POSITIONS = ELECTRODE_GROUPS.flatMap(g => g.positions);

// -------------------------------------------------------------------
// Common clinical tDCS montages
// -------------------------------------------------------------------
export const MONTAGE_PRESETS: {
  label: string;
  description: string;
  anode: string;
  cathode: string;
  currentMa: number;
}[] = [
  {
    label: "Bifrontal (F3 → F4)",
    description: "Depression, cognition, bilateral prefrontal",
    anode: "F3",
    cathode: "F4",
    currentMa: 2,
  },
  {
    label: "DLPFC Left (F3 → Fp2)",
    description: "Depression, left DLPFC targeting",
    anode: "F3",
    cathode: "Fp2",
    currentMa: 2,
  },
  {
    label: "DLPFC Right (F4 → Fp1)",
    description: "Right hemisphere DLPFC",
    anode: "F4",
    cathode: "Fp1",
    currentMa: 2,
  },
  {
    label: "Motor Left (C3 → C4)",
    description: "Left motor cortex, stroke rehabilitation",
    anode: "C3",
    cathode: "C4",
    currentMa: 2,
  },
  {
    label: "Motor Right (C4 → C3)",
    description: "Right motor cortex",
    anode: "C4",
    cathode: "C3",
    currentMa: 2,
  },
  {
    label: "Motor → Contralateral Orbit (C3 → Fp2)",
    description: "Left motor cortex with orbit reference",
    anode: "C3",
    cathode: "Fp2",
    currentMa: 2,
  },
  {
    label: "Vertex → Occipital (Cz → Oz)",
    description: "Cerebellum, chronic pain, consciousness",
    anode: "Cz",
    cathode: "Oz",
    currentMa: 2,
  },
  {
    label: "Parietal (P3 → P4)",
    description: "Spatial attention, visuospatial memory",
    anode: "P3",
    cathode: "P4",
    currentMa: 2,
  },
  {
    label: "Temporal (T7 → T8)",
    description: "Language lateralization, tinnitus",
    anode: "T7",
    cathode: "T8",
    currentMa: 2,
  },
  {
    label: "Frontal-Parietal (F3 → P4)",
    description: "Working memory, attentional networks",
    anode: "F3",
    cathode: "P4",
    currentMa: 2,
  },
  {
    label: "Temporal → Mastoid (T7 → TP8)",
    description: "Language lateralization, auditory processing",
    anode: "T7",
    cathode: "TP8",
    currentMa: 1,
  },
  {
    label: "Cerebellar → Vertex (Nk1 → Cz)",
    description: "Cerebellar stimulation, balance, ataxia",
    anode: "Nk1",
    cathode: "Cz",
    currentMa: 2,
  },
  {
    label: "Occipital → Vertex (Oz → Cz)",
    description: "Visual cortex, migraine, visual processing",
    anode: "Oz",
    cathode: "Cz",
    currentMa: 2,
  },
];

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
export interface ElectrodeConfig {
  anode: string;
  cathode: string;
  currentMa: number;
  electrodeType: "pad" | "ring";
}

export function buildRecipe(cfg: ElectrodeConfig): (string | number)[] {
  return [cfg.anode, cfg.currentMa, cfg.cathode, -cfg.currentMa];
}

export function buildElectype(cfg: ElectrodeConfig): string[] {
  return [cfg.electrodeType, cfg.electrodeType];
}

// -------------------------------------------------------------------
// Position selector (grouped dropdown)
// -------------------------------------------------------------------
function PositionSelect({
  value,
  onChange,
  label,
  exclude,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <span>{value}</span>
          <ChevronDown className={cn("h-4 w-4 text-foreground-muted transition-transform flex-shrink-0", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
            {ELECTRODE_GROUPS.map(group => (
              <div key={group.label}>
                <div className="sticky top-0 bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-foreground-muted uppercase tracking-wider border-b border-border">
                  {group.label}
                </div>
                <ul role="listbox">
                  {group.positions.map(pos => {
                    const isExcluded = pos === exclude;
                    return (
                      <li
                        key={pos}
                        role="option"
                        aria-selected={value === pos}
                        aria-disabled={isExcluded}
                        onClick={() => {
                          if (!isExcluded) { onChange(pos); setOpen(false); }
                        }}
                        className={cn(
                          "flex items-center justify-between px-3 py-1.5 text-sm transition-colors",
                          isExcluded
                            ? "text-foreground-muted/40 cursor-not-allowed"
                            : "cursor-pointer hover:bg-surface-elevated",
                          value === pos && !isExcluded && "bg-accent/10 text-accent font-medium"
                        )}
                      >
                        {pos}
                        {value === pos && !isExcluded && (
                          <span className="text-xs text-accent">✓</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------
interface ElectrodeConfigPanelProps {
  config: ElectrodeConfig;
  onChange: (cfg: ElectrodeConfig) => void;
}

const CURRENT_STEPS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];

export default function ElectrodeConfigPanel({ config, onChange }: ElectrodeConfigPanelProps) {
  const [presetOpen, setPresetOpen] = useState(false);

  const selectedPreset = MONTAGE_PRESETS.find(
    p => p.anode === config.anode && p.cathode === config.cathode && p.currentMa === config.currentMa
  );

  const applyPreset = (preset: typeof MONTAGE_PRESETS[number]) => {
    onChange({ ...config, anode: preset.anode, cathode: preset.cathode, currentMa: preset.currentMa });
    setPresetOpen(false);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Electrode Montage</h3>

        {/* Preset picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPresetOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {selectedPreset ? selectedPreset.label : "Custom"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", presetOpen && "rotate-180")} />
          </button>

          {presetOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-foreground-muted uppercase tracking-wider">
                Common tDCS Montages
              </div>
              {MONTAGE_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 text-sm hover:bg-surface-elevated transition-colors border-t border-border/50",
                    selectedPreset?.label === preset.label && "bg-accent/10"
                  )}
                >
                  <div className="font-medium text-foreground">{preset.label}</div>
                  <div className="text-xs text-foreground-muted mt-0.5">{preset.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Anode / Cathode selectors */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <PositionSelect
            label="Anode (+)"
            value={config.anode}
            onChange={v => onChange({ ...config, anode: v })}
            exclude={config.cathode}
          />
          <p className="mt-1 text-xs text-success">+{config.currentMa} mA</p>
        </div>
        <div>
          <PositionSelect
            label="Cathode (−)"
            value={config.cathode}
            onChange={v => onChange({ ...config, cathode: v })}
            exclude={config.anode}
          />
          <p className="mt-1 text-xs text-error">−{config.currentMa} mA</p>
        </div>
      </div>

      {/* Current intensity */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          Current Intensity
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {CURRENT_STEPS.map(ma => (
            <button
              key={ma}
              type="button"
              onClick={() => onChange({ ...config, currentMa: ma })}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                config.currentMa === ma
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface text-foreground-muted hover:bg-surface-elevated"
              )}
            >
              {ma} mA
            </button>
          ))}
        </div>
      </div>

      {/* Electrode type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
          Electrode Type
        </label>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium w-fit">
          <button
            type="button"
            onClick={() => onChange({ ...config, electrodeType: "pad" })}
            className={cn(
              "px-4 py-1.5 transition-colors",
              config.electrodeType === "pad" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface"
            )}
          >
            Pad
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, electrodeType: "ring" })}
            className={cn(
              "px-4 py-1.5 transition-colors",
              config.electrodeType === "ring" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface"
            )}
          >
            Ring
          </button>
        </div>
        <p className="text-xs text-foreground-muted">
          {config.electrodeType === "pad"
            ? "Rectangular pad — 70×50mm, standard tDCS"
            : "Focal ring — 8mm inner / 40mm outer radius"}
        </p>
      </div>

      {/* Summary */}
      <div className="rounded-lg bg-surface-elevated border border-border/60 px-3 py-2 text-xs text-foreground-muted">
        <span className="font-medium text-foreground">{config.anode}</span> +{config.currentMa}mA
        {" · "}
        <span className="font-medium text-foreground">{config.cathode}</span> −{config.currentMa}mA
        {" · "}
        Balanced ✓
      </div>
    </div>
  );
}
