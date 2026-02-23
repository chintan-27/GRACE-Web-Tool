"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Zap, Check, AlertTriangle,
  RotateCcw, GitCompare, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useJob } from "@/context/JobContext";
import {
  MONTAGE_PRESETS,
  ALL_POSITIONS,
  buildRecipe,
  buildElectype,
  type ElectrodeConfig,
} from "@/app/components/wizard/steps/ElectrodeConfigPanel";
import SplitViewer from "@/app/components/viewer/SplitViewer";
import RoastViewer from "@/app/components/viewer/RoastViewer";
import TESComparisonViewer from "@/app/components/viewer/TESComparisonViewer";
import {
  startSimulation,
  connectROASTSSE,
  startSimNIBSSimulation,
  connectSimNIBSSSE,
} from "@/lib/api";

// ─── Step label maps ──────────────────────────────────────────────────────────
const ROAST_STEP_LABELS: Record<string, string> = {
  roast_queued:            "Queued",
  roast_start:             "Starting",
  roast_prepare:           "Preparing files",
  roast_seg8:              "Registering T1 to template",
  roast_step_csf_fix:      "Fixing CSF",
  roast_step_electrode:    "Placing electrodes",
  roast_step_mesh:         "Generating mesh",
  roast_step_solve:        "Setting up FEM solver",
  roast_step_solve_fem:    "Solving linear system",
  roast_step_postprocess:  "Post-processing",
  roast_complete:          "Complete",
};

const SIMNIBS_STEP_LABELS: Record<string, string> = {
  simnibs_start:           "Starting",
  simnibs_prepare:         "Preparing T1",
  simnibs_seg_ready:       "Segmentation ready",
  simnibs_charm:           "charm: Initialising",
  simnibs_charm_register:  "charm: Atlas registration",
  simnibs_charm_segment:   "charm: Segmenting",
  simnibs_charm_tissue:    "charm: Tissue classification",
  simnibs_charm_surface:   "charm: Building surfaces",
  simnibs_charm_mesh:      "charm: Meshing",
  simnibs_charm_finalize:  "charm: Finalizing",
  simnibs_charm_done:      "Mesh complete",
  simnibs_fem_setup:       "FEM: Setting up",
  simnibs_fem_solve:       "FEM: Solving",
  simnibs_post:            "Post-processing",
  simnibs_complete:        "Complete",
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Solver    = "simnibs" | "roast" | "both";
type RunStatus = "pending" | "running" | "complete" | "error";

interface RunState {
  status:   RunStatus;
  progress: number;
  step:     string;
  error?:   string;
}

type PanelView =
  | { type: "segmentation" }
  | { type: "roast";      model: string }
  | { type: "simnibs";    model: string }
  | { type: "comparison"; model: string };

function runKey(model: string, solver: "roast" | "simnibs") {
  return `${model}:${solver}`;
}
function getDisplayName(model: string) {
  return model.replace("-native", "").replace("-fs", "").toUpperCase();
}
function getSpaceLabel(model: string) {
  if (model.includes("-native")) return "Native";
  if (model.includes("-fs"))     return "FS";
  return "";
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
      {children}
    </p>
  );
}

function RunCard({ label, badge, state }: {
  label: string;
  badge: string;
  state: RunState;
}) {
  const { status, progress, step, error } = state;
  const isRunning  = status === "running";
  const isComplete = status === "complete";
  const isError    = status === "error";
  const isPending  = status === "pending";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground-muted">
          {label}
          <span className={cn(
            "ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold",
            isComplete ? "bg-success/15 text-success" :
            isError    ? "bg-error/15 text-error" :
            isRunning  ? "bg-accent/15 text-accent" :
                         "bg-border/60 text-foreground-muted",
          )}>
            {badge}
          </span>
        </span>
        <span className={cn(
          "text-[11px] font-medium tabular-nums",
          isComplete ? "text-success" :
          isError    ? "text-error" :
          isRunning  ? "text-accent" :
                       "text-foreground-muted",
        )}>
          {isComplete ? "✓" : isError ? "✗" : `${progress}%`}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isComplete ? "bg-success" :
            isError    ? "bg-error" :
                         "bg-accent",
          )}
          style={{ width: `${isError ? 100 : progress}%` }}
        />
      </div>
      <p className="truncate text-[10px] text-foreground-muted">
        {isRunning  && step}
        {isPending  && "Waiting in queue…"}
        {isError    && error}
        {isComplete && "Done"}
      </p>
    </div>
  );
}

// ─── TESPage ──────────────────────────────────────────────────────────────────
export default function TESPage() {
  const router = useRouter();
  const { sessionId, models, inputBlobUrl } = useJob();

  // Config
  const [selectedModels, setSelectedModels]     = useState<string[]>([]);
  const [solver, setSolver]                     = useState<Solver>("simnibs");
  const [quality, setQuality]                   = useState<"fast" | "standard">("fast");
  const [electrodeConfig, setElectrodeConfig]   = useState<ElectrodeConfig>({
    anode: "F3", cathode: "F4", currentMa: 2, electrodeType: "pad",
  });

  // Run state
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const runQueueRef = useRef<{ model: string; solver: "roast" | "simnibs" }[]>([]);
  const runningRef  = useRef(false);

  // Right-panel view
  const [panelView, setPanelView] = useState<PanelView>({ type: "segmentation" });

  // ── Queue helpers ─────────────────────────────────────────────────────────
  const setRunState = useCallback((key: string, patch: Partial<RunState>) => {
    setRunStates(prev => ({
      ...prev,
      [key]: { ...{ status: "pending", progress: 0, step: "" }, ...prev[key], ...patch },
    }));
  }, []);

  const processQueue = useCallback(async () => {
    if (runningRef.current) return;
    const next = runQueueRef.current.shift();
    if (!next) { runningRef.current = false; return; }

    runningRef.current = true;
    const key      = runKey(next.model, next.solver);
    const recipe   = buildRecipe(electrodeConfig);
    const electype = buildElectype(electrodeConfig);

    if (next.solver === "roast") {
      setRunState(key, { status: "running", progress: 2, step: "Starting…" });
      try {
        await startSimulation(sessionId!, next.model, quality, recipe, electype);
      } catch (e: unknown) {
        setRunState(key, { status: "error", error: (e as Error).message });
        runningRef.current = false;
        processQueue();
        return;
      }
      connectROASTSSE(sessionId!, (evt) => {
        if (evt.type === "progress") {
          setRunState(key, {
            status: "running", progress: evt.progress ?? 0,
            step: evt.event ? (ROAST_STEP_LABELS[evt.event] ?? evt.event) : "",
          });
        }
        if (evt.type === "complete") {
          setRunState(key, { status: "complete", progress: 100, step: "Complete" });
          setPanelView({ type: "roast", model: next.model });
          runningRef.current = false;
          processQueue();
        }
        if (evt.type === "error") {
          setRunState(key, { status: "error", error: evt.detail || "ROAST error" });
          runningRef.current = false;
          processQueue();
        }
      });

    } else {
      setRunState(key, { status: "running", progress: 2, step: "Starting…" });
      try {
        await startSimNIBSSimulation(sessionId!, next.model, recipe, electype);
      } catch (e: unknown) {
        setRunState(key, { status: "error", error: (e as Error).message });
        runningRef.current = false;
        processQueue();
        return;
      }
      connectSimNIBSSSE(sessionId!, (evt) => {
        if (evt.type === "progress") {
          setRunState(key, {
            status: "running", progress: evt.progress ?? 0,
            step: evt.event ? (SIMNIBS_STEP_LABELS[evt.event] ?? evt.event) : "",
          });
        }
        if (evt.type === "complete") {
          setRunState(key, { status: "complete", progress: 100, step: "Complete" });
          setPanelView({ type: "simnibs", model: next.model });
          runningRef.current = false;
          processQueue();
        }
        if (evt.type === "error") {
          setRunState(key, { status: "error", error: evt.detail || "SimNIBS error" });
          runningRef.current = false;
          processQueue();
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, quality, electrodeConfig]);

  const startAllRuns = useCallback(() => {
    if (!sessionId || selectedModels.length === 0) return;
    const solvers: ("roast" | "simnibs")[] =
      solver === "both" ? ["roast", "simnibs"] :
      solver === "roast" ? ["roast"] : ["simnibs"];

    const queue: { model: string; solver: "roast" | "simnibs" }[] = [];
    const init: Record<string, RunState> = {};
    for (const m of selectedModels) {
      for (const s of solvers) {
        const k = runKey(m, s);
        queue.push({ model: m, solver: s });
        init[k] = { status: "pending", progress: 0, step: "Queued" };
      }
    }
    setRunStates(init);
    runQueueRef.current = queue;
    runningRef.current  = false;
    processQueue();
  }, [selectedModels, solver, processQueue, sessionId]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const runEntries = Object.entries(runStates);
  const hasRuns    = runEntries.length > 0;
  const isRunning  = runEntries.some(([, r]) => r.status === "running");
  const allDone    = hasRuns && runEntries.every(([, r]) => r.status === "complete" || r.status === "error");

  const completedByModel: Record<string, ("roast" | "simnibs")[]> = {};
  for (const [key, state] of runEntries) {
    if (state.status !== "complete") continue;
    const [m, s] = key.split(":") as [string, "roast" | "simnibs"];
    (completedByModel[m] ??= []).push(s);
  }
  const completedCount = Object.keys(completedByModel).length;

  // ── No-session guard ──────────────────────────────────────────────────────
  if (!sessionId || !inputBlobUrl) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="space-y-4 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-warning" />
          <p className="text-foreground-secondary">No active session. Run a segmentation first.</p>
          <Button variant="accent" onClick={() => router.push("/")}>Go to Segmentation</Button>
        </div>
      </div>
    );
  }

  // ── Tab helpers ───────────────────────────────────────────────────────────
  const isPanelActive = (v: PanelView) => {
    if (panelView.type !== v.type) return false;
    if ("model" in panelView && "model" in v) return panelView.model === v.model;
    return true;
  };

  const tabCls = (active: boolean) => cn(
    "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus:outline-none focus:ring-2 focus:ring-ring",
    active
      ? "bg-accent/10 text-accent"
      : "text-foreground-muted hover:bg-surface-elevated hover:text-foreground",
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ═══════════════════════ LEFT PANEL ═══════════════════════════════ */}
      <aside className="flex w-[22rem] shrink-0 flex-col border-r border-border bg-surface">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="ml-auto flex items-center gap-2">
            <div className="rounded-md bg-accent/15 p-1">
              <Zap className="h-3.5 w-3.5 text-accent" />
            </div>
            <span className="text-sm font-semibold text-foreground">TES Simulation</span>
          </div>
        </div>

        {/* Scrollable config */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">

          {/* ── Models ── */}
          <div>
            <SectionLabel>Models</SectionLabel>
            <div className="space-y-1.5">
              {models.map(model => {
                const on = selectedModels.includes(model);
                return (
                  <button
                    key={model}
                    type="button"
                    onClick={() =>
                      setSelectedModels(prev =>
                        prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model],
                      )
                    }
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                      on
                        ? "border-accent/50 bg-accent/10 text-foreground"
                        : "border-border bg-background text-foreground-muted hover:border-accent/30 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2",
                        on ? "border-accent bg-accent" : "border-border",
                      )}>
                        {on && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <span className="font-medium">{getDisplayName(model)}</span>
                    </div>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      on ? "bg-accent/15 text-accent" : "bg-border/50 text-foreground-muted",
                    )}>
                      {getSpaceLabel(model)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Solver ── */}
          <div>
            <SectionLabel>Solver</SectionLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {(["simnibs", "roast", "both"] as Solver[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSolver(s)}
                  className={cn(
                    "rounded-lg border py-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                    solver === s
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-background text-foreground-muted hover:border-accent/30",
                  )}
                >
                  {s === "simnibs" ? "SimNIBS" : s === "roast" ? "ROAST" : "Both"}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-foreground-muted">
              {solver === "simnibs" && "FEM with charm meshing on GRACE segmentation"}
              {solver === "roast"   && "MATLAB MCR pipeline, 11-tissue conductivities"}
              {solver === "both"    && "Both solvers run sequentially — enables side-by-side comparison"}
            </p>
          </div>

          {/* ── Montage presets ── */}
          <div>
            <SectionLabel>Montage Preset</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {MONTAGE_PRESETS.map(preset => {
                const active =
                  preset.anode     === electrodeConfig.anode &&
                  preset.cathode   === electrodeConfig.cathode &&
                  preset.currentMa === electrodeConfig.currentMa;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    title={`${preset.label} — ${preset.description}`}
                    onClick={() =>
                      setElectrodeConfig(prev => ({
                        ...prev,
                        anode:     preset.anode,
                        cathode:   preset.cathode,
                        currentMa: preset.currentMa,
                      }))
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-background text-foreground-muted hover:border-accent/30 hover:text-foreground",
                    )}
                  >
                    {preset.anode}→{preset.cathode}
                  </button>
                );
              })}
            </div>
            {(() => {
              const match = MONTAGE_PRESETS.find(
                p => p.anode === electrodeConfig.anode && p.cathode === electrodeConfig.cathode,
              );
              return match
                ? <p className="mt-1.5 text-[11px] text-foreground-muted">{match.description}</p>
                : null;
            })()}
          </div>

          {/* ── Anode / Cathode ── */}
          <div>
            <SectionLabel>Electrodes</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {(["anode", "cathode"] as const).map(role => (
                <div key={role}>
                  <label className="mb-1 block text-[11px] text-foreground-muted">
                    {role === "anode" ? "Anode (+)" : "Cathode (−)"}
                  </label>
                  <div className="relative">
                    <select
                      value={electrodeConfig[role]}
                      onChange={e =>
                        setElectrodeConfig(prev => ({ ...prev, [role]: e.target.value }))
                      }
                      className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-7 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {ALL_POSITIONS.filter(
                        p => p !== (role === "anode" ? electrodeConfig.cathode : electrodeConfig.anode),
                      ).map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Current ── */}
          <div>
            <SectionLabel>Current — {electrodeConfig.currentMa} mA</SectionLabel>
            <div className="flex gap-1.5">
              {[0.5, 1, 1.5, 2, 3, 4].map(mA => (
                <button
                  key={mA}
                  type="button"
                  onClick={() => setElectrodeConfig(prev => ({ ...prev, currentMa: mA }))}
                  className={cn(
                    "flex-1 rounded-md border py-1.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                    electrodeConfig.currentMa === mA
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-background text-foreground-muted hover:border-accent/30",
                  )}
                >
                  {mA}
                </button>
              ))}
            </div>
          </div>

          {/* ── Electrode type ── */}
          <div>
            <SectionLabel>Electrode Type</SectionLabel>
            <div className="flex gap-2">
              {(["pad", "ring"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setElectrodeConfig(prev => ({ ...prev, electrodeType: t }))}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                    electrodeConfig.electrodeType === t
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-background text-foreground-muted hover:border-accent/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "h-3 w-3 shrink-0 rounded-full border-2",
                      electrodeConfig.electrodeType === t ? "border-accent bg-accent" : "border-border",
                    )} />
                    <div>
                      <div className="font-medium">{t === "pad" ? "Pad" : "Ring"}</div>
                      <div className="text-[10px] opacity-60">{t === "pad" ? "70×50 mm" : "8 / 40 mm"}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── ROAST quality (conditional) ── */}
          {(solver === "roast" || solver === "both") && (
            <div>
              <SectionLabel>ROAST Quality</SectionLabel>
              <div className="flex gap-1.5">
                {(["fast", "standard"] as const).map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                      quality === q
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-background text-foreground-muted hover:border-accent/30",
                    )}
                  >
                    {q === "fast" ? "⚡ Fast" : "🎯 Standard"}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-foreground-muted">
                {quality === "fast" ? "~1–2 min, coarser mesh" : "~3–5 min, full resolution"}
              </p>
            </div>
          )}

          {/* ── Config summary pill ── */}
          <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5 text-[11px] text-foreground-muted">
            <span className="font-medium text-foreground">
              {electrodeConfig.anode}(+{electrodeConfig.currentMa}mA)
              {" → "}
              {electrodeConfig.cathode}(−{electrodeConfig.currentMa}mA)
            </span>
            {" · "}{electrodeConfig.electrodeType}
            {" · "}{solver === "both" ? "ROAST + SimNIBS" : solver === "roast" ? "ROAST" : "SimNIBS"}
            {selectedModels.length > 0 && (
              <>{" · "}{selectedModels.length} model{selectedModels.length > 1 ? "s" : ""}</>
            )}
          </div>

        </div>{/* end scrollable */}

        {/* ── Footer: progress + action ── */}
        <div className="space-y-3 border-t border-border px-4 py-4">

          {hasRuns && (
            <div className="space-y-3">
              {runEntries.map(([key, state]) => {
                const [model, sol] = key.split(":");
                return (
                  <RunCard
                    key={key}
                    label={`${getDisplayName(model)} · ${getSpaceLabel(model)}`}
                    badge={sol === "roast" ? "ROAST" : "SimNIBS"}
                    state={state}
                  />
                );
              })}
            </div>
          )}

          {allDone ? (
            <Button
              variant="outline"
              size="sm"
              onClick={startAllRuns}
              disabled={selectedModels.length === 0}
              className="w-full gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Run Again (new config)
            </Button>
          ) : (
            <Button
              variant="accent"
              onClick={startAllRuns}
              disabled={selectedModels.length === 0 || isRunning}
              className="w-full gap-2"
            >
              <Zap className="h-4 w-4" />
              {isRunning ? "Simulating…" : "Start Simulation"}
            </Button>
          )}

        </div>
      </aside>

      {/* ═══════════════════════ RIGHT PANEL ══════════════════════════════ */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-surface px-3 py-2">
          <button
            type="button"
            onClick={() => setPanelView({ type: "segmentation" })}
            className={tabCls(panelView.type === "segmentation")}
          >
            Segmentation
          </button>

          {Object.entries(completedByModel).flatMap(([model, solvers]) => {
            const tabs = [];
            if (solvers.includes("roast"))
              tabs.push(
                <button
                  key={`${model}:roast`}
                  type="button"
                  onClick={() => setPanelView({ type: "roast", model })}
                  className={tabCls(isPanelActive({ type: "roast", model }))}
                >
                  <Check className="h-3 w-3 text-success" />
                  {getDisplayName(model)} · ROAST
                </button>,
              );
            if (solvers.includes("simnibs"))
              tabs.push(
                <button
                  key={`${model}:simnibs`}
                  type="button"
                  onClick={() => setPanelView({ type: "simnibs", model })}
                  className={tabCls(isPanelActive({ type: "simnibs", model }))}
                >
                  <Check className="h-3 w-3 text-success" />
                  {getDisplayName(model)} · SimNIBS
                </button>,
              );
            if (solvers.includes("roast") && solvers.includes("simnibs"))
              tabs.push(
                <button
                  key={`${model}:comparison`}
                  type="button"
                  onClick={() => setPanelView({ type: "comparison", model })}
                  className={tabCls(isPanelActive({ type: "comparison", model }))}
                >
                  <GitCompare className="h-3 w-3" />
                  {getDisplayName(model)} · Compare
                </button>,
              );
            return tabs;
          })}

          {completedCount > 0 && (
            <div className="ml-auto shrink-0 pl-4 text-[11px] text-foreground-muted">
              {completedCount} model{completedCount > 1 ? "s" : ""} complete
            </div>
          )}
        </div>

        {/* Viewer */}
        <div className="flex-1 overflow-auto">
          {panelView.type === "segmentation" && (
            <div className="h-full p-4">
              <SplitViewer inputUrl={inputBlobUrl} sessionId={sessionId} models={models} />
            </div>
          )}
          {(panelView.type === "roast" || panelView.type === "simnibs") && (
            <div className="h-full p-4">
              <RoastViewer
                inputUrl={inputBlobUrl}
                sessionId={sessionId}
                modelName={panelView.model}
                solver={panelView.type}
              />
            </div>
          )}
          {panelView.type === "comparison" && (
            <div className="h-full p-4">
              <TESComparisonViewer
                inputUrl={inputBlobUrl}
                sessionId={sessionId}
                modelName={panelView.model}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
