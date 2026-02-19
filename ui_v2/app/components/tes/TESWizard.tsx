"use client";

import { useState, useCallback, useRef } from "react";
import {
  Zap, ChevronRight, ChevronLeft, Check, AlertTriangle,
  GitCompare, RotateCcw, Eye, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ElectrodeConfigPanel, {
  buildRecipe,
  buildElectype,
  type ElectrodeConfig,
} from "@/app/components/wizard/steps/ElectrodeConfigPanel";
import RoastViewer from "@/app/components/viewer/RoastViewer";
import TESComparisonViewer from "@/app/components/viewer/TESComparisonViewer";
import {
  startSimulation,
  connectROASTSSE,
  startSimNIBSSimulation,
  connectSimNIBSSSE,
} from "@/lib/api";

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------
type TESStep = "select" | "configure" | "simulate" | "results";
type Solver  = "roast" | "simnibs" | "both";
type RunStatus = "pending" | "running" | "complete" | "error";

interface RunState {
  status:   RunStatus;
  progress: number;
  step:     string;
  error?:   string;
}

interface TESWizardProps {
  sessionId:    string;
  models:       string[];
  inputBlobUrl: string;
}

// -------------------------------------------------------------------
// ROAST step label map
// -------------------------------------------------------------------
const ROAST_STEP_LABELS: Record<string, string> = {
  roast_queued:            "Queued...",
  roast_start:             "Starting simulation...",
  roast_prepare:           "Preparing files...",
  roast_seg8:              "Registering T1 to template...",
  roast_seg8_done:         "Registration complete",
  roast_step_csf_fix:      "Step 2.5: Fixing CSF...",
  roast_step_electrode:    "Step 3: Setting up electrodes...",
  roast_step_el_measure:   "Step 3: Measuring head...",
  roast_step_el_cap:       "Step 3: Fitting electrode cap...",
  roast_step_el_f3:        "Step 3: Placing anode electrode...",
  roast_step_el_f4:        "Step 3: Placing cathode electrode...",
  roast_step_el_cleanup:   "Step 3: Finalizing electrodes...",
  roast_step_mesh:         "Step 4: Generating mesh...",
  roast_step_mesh_sizing:  "Step 4: Computing mesh sizes...",
  roast_step_mesh_done:    "Step 4: Mesh complete",
  roast_step_mesh_saving:  "Step 4: Saving mesh...",
  roast_step_solve:        "Step 5: Setting up FEM solver...",
  roast_step_solve_pre:    "Step 5: FEM pre-processing...",
  roast_step_solve_gen:    "Step 5: Assembling FEM system...",
  roast_step_solve_fem:    "Step 5: Solving linear system...",
  roast_step_solve_save:   "Step 5: Saving solution...",
  roast_step_solve_post:   "Step 5: FEM post-processing...",
  roast_step_postprocess:  "Step 6: Post-processing...",
  roast_step_post_convert: "Step 6: Converting results...",
  roast_step_post_jroast:  "Step 6: Computing E-fields...",
  roast_step_post_save:    "Step 6: Saving final results...",
  roast_step_post_done:    "Step 6: Almost done...",
  roast_complete:          "Complete!",
};

const SIMNIBS_STEP_LABELS: Record<string, string> = {
  simnibs_start:           "Starting...",
  simnibs_prepare:         "Preparing T1...",
  simnibs_seg_ready:       "Segmentation remapped",
  simnibs_charm:           "Running charm mesher...",
  simnibs_charm_register:  "charm: Registering...",
  simnibs_charm_segment:   "charm: Segmenting...",
  simnibs_charm_tissue:    "charm: Classifying tissue...",
  simnibs_charm_surface:   "charm: Building surfaces...",
  simnibs_charm_mesh:      "charm: Meshing...",
  simnibs_charm_finalize:  "charm: Finalizing...",
  simnibs_charm_saving:    "charm: Saving...",
  simnibs_charm_done:      "Mesh complete",
  simnibs_fem_setup:       "FEM: Setting up simulation...",
  simnibs_fem_solve:       "FEM: Solving...",
  simnibs_post:            "Post-processing...",
  simnibs_complete:        "Complete!",
};

// -------------------------------------------------------------------
// Sub-stepper
// -------------------------------------------------------------------
const STEPS: { id: TESStep; label: string }[] = [
  { id: "select",    label: "Select" },
  { id: "configure", label: "Configure" },
  { id: "simulate",  label: "Simulate" },
  { id: "results",   label: "Results" },
];

function TESSubStepper({ current }: { current: TESStep }) {
  const currentIdx = STEPS.findIndex(s => s.id === current);
  return (
    <nav aria-label="TES simulation steps" className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done    = idx < currentIdx;
        const active  = idx === currentIdx;
        const upcoming = idx > currentIdx;
        return (
          <div key={step.id} className="flex items-center">
            <div className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
              done    && "text-success",
              active  && "bg-accent/10 text-accent",
              upcoming && "text-foreground-muted opacity-50",
            )}>
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold flex-shrink-0",
                done    && "bg-success/15 text-success",
                active  && "bg-accent text-white",
                upcoming && "bg-border text-foreground-muted",
              )}>
                {done ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              <span>{step.label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={cn(
                "mx-1 h-0.5 w-6 rounded-full",
                idx < currentIdx ? "bg-success/40" : "bg-border",
              )} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// -------------------------------------------------------------------
// Model display helpers
// -------------------------------------------------------------------
function getDisplayName(model: string) {
  return model.replace("-native", "").replace("-fs", "").toUpperCase();
}
function getSpaceLabel(model: string) {
  if (model.includes("-native")) return "Native";
  if (model.includes("-fs")) return "FreeSurfer";
  return "";
}

// -------------------------------------------------------------------
// Run key: "${model}:${solver}" — uniquely identifies one simulation run
// -------------------------------------------------------------------
function runKey(model: string, solver: "roast" | "simnibs") {
  return `${model}:${solver}`;
}

// -------------------------------------------------------------------
// TESWizard
// -------------------------------------------------------------------
export default function TESWizard({ sessionId, models, inputBlobUrl }: TESWizardProps) {
  const [step, setStep]                   = useState<TESStep>("select");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [solver, setSolver]               = useState<Solver>("roast");
  const [quality, setQuality]             = useState<"fast" | "standard">("fast");
  const [electrodeConfig, setElectrodeConfig] = useState<ElectrodeConfig>({
    anode: "F3", cathode: "F4", currentMa: 2, electrodeType: "pad",
  });

  // Run state per key
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});

  // Viewer: which run to display
  const [activeView, setActiveView] = useState<{ model: string; solver: "roast" | "simnibs" | "comparison" } | null>(null);

  // Sequential run queue ref
  const runQueueRef  = useRef<{ model: string; solver: "roast" | "simnibs" }[]>([]);
  const runningRef   = useRef(false);

  // -------------------------------------------------------------------
  // Run queue management
  // -------------------------------------------------------------------
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
    const key = runKey(next.model, next.solver);

    if (next.solver === "roast") {
      const recipe   = buildRecipe(electrodeConfig);
      const electype = buildElectype(electrodeConfig);
      setRunState(key, { status: "running", progress: 2, step: "Starting..." });

      try {
        await startSimulation(sessionId, next.model, quality, recipe, electype);
      } catch (e: unknown) {
        setRunState(key, { status: "error", error: (e as Error).message || "Failed to start ROAST" });
        runningRef.current = false;
        processQueue();
        return;
      }

      connectROASTSSE(
        sessionId,
        (evt) => {
          // Filter to this model (events are tagged with model name)
          if (evt.type === "progress") {
            setRunState(key, {
              status:   "running",
              progress: evt.progress ?? 0,
              step:     evt.event ? (ROAST_STEP_LABELS[evt.event] ?? evt.event) : "",
            });
          }
          if (evt.type === "complete") {
            setRunState(key, { status: "complete", progress: 100, step: "Complete!" });
            runningRef.current = false;
            processQueue();
          }
          if (evt.type === "error") {
            setRunState(key, { status: "error", error: evt.detail || "ROAST error" });
            runningRef.current = false;
            processQueue();
          }
        },
      );

    } else {
      // SimNIBS
      const recipe   = buildRecipe(electrodeConfig);
      const electype = buildElectype(electrodeConfig);
      setRunState(key, { status: "running", progress: 2, step: "Starting..." });

      try {
        await startSimNIBSSimulation(sessionId, next.model, recipe, electype);
      } catch (e: unknown) {
        setRunState(key, { status: "error", error: (e as Error).message || "Failed to start SimNIBS" });
        runningRef.current = false;
        processQueue();
        return;
      }

      connectSimNIBSSSE(
        sessionId,
        (evt) => {
          if (evt.type === "progress") {
            setRunState(key, {
              status:   "running",
              progress: evt.progress ?? 0,
              step:     evt.event ? (SIMNIBS_STEP_LABELS[evt.event] ?? evt.event) : "",
            });
          }
          if (evt.type === "complete") {
            setRunState(key, { status: "complete", progress: 100, step: "Complete!" });
            runningRef.current = false;
            processQueue();
          }
          if (evt.type === "error") {
            setRunState(key, { status: "error", error: evt.detail || "SimNIBS error" });
            runningRef.current = false;
            processQueue();
          }
        },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, quality, electrodeConfig]);

  // -------------------------------------------------------------------
  // Start simulation — build queue and kick it off
  // -------------------------------------------------------------------
  const startAllRuns = useCallback(() => {
    const solvers: ("roast" | "simnibs")[] =
      solver === "both"    ? ["roast", "simnibs"] :
      solver === "roast"   ? ["roast"] :
      ["simnibs"];

    const queue: { model: string; solver: "roast" | "simnibs" }[] = [];
    const initialStates: Record<string, RunState> = {};

    for (const m of selectedModels) {
      for (const s of solvers) {
        const key = runKey(m, s);
        queue.push({ model: m, solver: s });
        initialStates[key] = { status: "pending", progress: 0, step: "Queued..." };
      }
    }

    setRunStates(initialStates);
    runQueueRef.current = queue;
    runningRef.current  = false;
    setStep("simulate");
    processQueue();
  }, [selectedModels, solver, processQueue]);

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------
  const totalRuns   = Object.keys(runStates).length;
  const doneCount   = Object.values(runStates).filter(r => r.status === "complete" || r.status === "error").length;
  const allDone     = totalRuns > 0 && doneCount === totalRuns;
  const anyComplete = Object.values(runStates).some(r => r.status === "complete");

  // -------------------------------------------------------------------
  // Rerun with new config (go back to configure, keep selections)
  // -------------------------------------------------------------------
  const rerunWithNewConfig = () => {
    setRunStates({});
    runQueueRef.current  = [];
    runningRef.current   = false;
    setActiveView(null);
    setStep("configure");
  };

  const changeModels = () => {
    setRunStates({});
    runQueueRef.current  = [];
    runningRef.current   = false;
    setActiveView(null);
    setStep("select");
  };

  // -------------------------------------------------------------------
  // Step: SELECT
  // -------------------------------------------------------------------
  const renderSelect = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Which segmentations to simulate?</h3>
        <p className="text-xs text-foreground-muted mb-3">Select one or more completed segmentation models.</p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {models.map(model => {
            const selected = selectedModels.includes(model);
            return (
              <button
                key={model}
                type="button"
                onClick={() =>
                  setSelectedModels(prev =>
                    prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
                  )
                }
                className={cn(
                  "relative flex flex-col gap-1 rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                  selected
                    ? "border-accent bg-accent/5 accent-glow"
                    : "border-border bg-surface hover:border-accent/40",
                )}
              >
                {selected && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent bg-accent">
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
                <Layers className="h-5 w-5 text-accent" />
                <span className="font-semibold text-foreground text-sm">{getDisplayName(model)}</span>
                <span className="text-xs text-foreground-muted">{getSpaceLabel(model)} space</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Which solver?</h3>
        <p className="text-xs text-foreground-muted mb-3">ROAST and SimNIBS use different meshing pipelines.</p>
        <div className="flex gap-2">
          {(["roast", "simnibs", "both"] as Solver[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSolver(s)}
              className={cn(
                "flex-1 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-ring",
                solver === s
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-accent/40",
              )}
            >
              {s === "roast"   && "ROAST-11"}
              {s === "simnibs" && "SimNIBS"}
              {s === "both"    && "Both"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground-muted">
          {solver === "roast"   && "ROAST-11 uses compiled MATLAB MCR with 11-tissue conductivities."}
          {solver === "simnibs" && "SimNIBS uses FEM with charm meshing on the GRACE segmentation."}
          {solver === "both"    && "Run both solvers for direct comparison. Runs sequentially."}
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          variant="accent"
          onClick={() => setStep("configure")}
          disabled={selectedModels.length === 0}
          className="gap-2"
        >
          Configure
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Step: CONFIGURE
  // -------------------------------------------------------------------
  const renderConfigure = () => (
    <div className="space-y-5">
      <ElectrodeConfigPanel config={electrodeConfig} onChange={setElectrodeConfig} />

      {(solver === "roast" || solver === "both") && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">ROAST Quality</h3>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
            <button
              type="button"
              onClick={() => setQuality("fast")}
              className={cn(
                "flex-1 py-2 transition-colors",
                quality === "fast" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-elevated",
              )}
            >
              ⚡ Fast (~1–2 min)
            </button>
            <button
              type="button"
              onClick={() => setQuality("standard")}
              className={cn(
                "flex-1 py-2 transition-colors",
                quality === "standard" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-elevated",
              )}
            >
              🎯 Standard (~3–5 min)
            </button>
          </div>
          <p className="text-xs text-foreground-muted">
            {quality === "fast" ? "Coarser mesh, faster solve — good for exploration." : "Full mesh resolution — recommended for final results."}
          </p>
        </div>
      )}

      {/* Summary */}
      <div className="rounded-lg bg-surface-elevated border border-border/60 px-4 py-3 text-sm">
        <p className="font-medium text-foreground mb-1">Simulation summary</p>
        <p className="text-xs text-foreground-muted">
          <span className="font-medium text-foreground">{selectedModels.map(getDisplayName).join(", ")}</span>
          {" · "}{solver === "both" ? "ROAST + SimNIBS" : solver === "roast" ? "ROAST-11" : "SimNIBS"}
          {(solver === "roast" || solver === "both") && ` · ${quality}`}
          {" · "}{electrodeConfig.anode}(+{electrodeConfig.currentMa}mA) → {electrodeConfig.cathode}(−{electrodeConfig.currentMa}mA)
          {" · "}{electrodeConfig.electrodeType} electrodes
        </p>
        <p className="text-xs text-foreground-muted mt-1">
          {selectedModels.length * (solver === "both" ? 2 : 1)} simulation{selectedModels.length * (solver === "both" ? 2 : 1) > 1 ? "s" : ""} will run sequentially.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep("select")}
          className="flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Change models
        </button>
        <Button variant="accent" onClick={startAllRuns} className="gap-2">
          <Zap className="h-4 w-4" />
          Start Simulation
        </Button>
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Step: SIMULATE
  // -------------------------------------------------------------------
  const renderSimulate = () => {
    const totalProgress = totalRuns > 0
      ? Math.round(Object.values(runStates).reduce((sum, r) => sum + r.progress, 0) / totalRuns)
      : 0;

    return (
      <div className="space-y-4">
        {/* Overall progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-foreground-muted">
              {allDone
                ? anyComplete ? "All simulations complete" : "All simulations finished (some with errors)"
                : `Running ${doneCount + 1} of ${totalRuns}...`}
            </span>
            <span className="font-medium text-foreground">{totalProgress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
        </div>

        {/* Per-run cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(runStates).map(([key, state]) => {
            const [model, sol] = key.split(":");
            const isPending  = state.status === "pending";
            const isRunning  = state.status === "running";
            const isComplete = state.status === "complete";
            const isError    = state.status === "error";

            return (
              <div
                key={key}
                className={cn(
                  "rounded-xl border p-4 space-y-2 transition-all",
                  isComplete && "border-success/30 bg-success/5",
                  isError    && "border-error/30 bg-error/5",
                  isRunning  && "border-accent/30 bg-accent/5",
                  isPending  && "border-border bg-surface opacity-60",
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-foreground">{getDisplayName(model)}</span>
                    <span className="ml-2 text-xs text-foreground-muted">{getSpaceLabel(model)}</span>
                  </div>
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    isComplete && "bg-success/15 text-success",
                    isError    && "bg-error/15 text-error",
                    isRunning  && "bg-accent/15 text-accent",
                    isPending  && "bg-border text-foreground-muted",
                  )}>
                    {sol === "roast" ? "ROAST" : "SimNIBS"}
                  </span>
                </div>

                {(isRunning || isComplete) && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-foreground-muted">
                      <span>{state.step || (isPending ? "Queued..." : "")}</span>
                      <span>{state.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          isComplete ? "bg-success" : "bg-accent",
                        )}
                        style={{ width: `${state.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {isPending && (
                  <p className="text-xs text-foreground-muted">Waiting for previous to finish...</p>
                )}

                {isComplete && (
                  <div className="flex items-center gap-1 text-xs text-success">
                    <Check className="h-3.5 w-3.5" />
                    Done
                  </div>
                )}

                {isError && (
                  <p className="text-xs text-error truncate">{state.error}</p>
                )}
              </div>
            );
          })}
        </div>

        {allDone && (
          <div className="flex justify-end">
            <Button variant="accent" onClick={() => setStep("results")} className="gap-2">
              View Results
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Step: RESULTS
  // -------------------------------------------------------------------
  const renderResults = () => {
    // Build list of completed runs grouped by model
    const completedByModel: Record<string, ("roast" | "simnibs")[]> = {};
    for (const [key, state] of Object.entries(runStates)) {
      if (state.status !== "complete") continue;
      const [model, sol] = key.split(":") as [string, "roast" | "simnibs"];
      if (!completedByModel[model]) completedByModel[model] = [];
      completedByModel[model].push(sol);
    }

    const hasComparison = (model: string) =>
      completedByModel[model]?.includes("roast") && completedByModel[model]?.includes("simnibs");

    return (
      <div className="space-y-5">
        {/* Result selector */}
        <div className="space-y-3">
          {Object.entries(completedByModel).map(([model, solvers]) => (
            <div key={model} className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-foreground">{getDisplayName(model)}</h3>
                <p className="text-xs text-foreground-muted">{getSpaceLabel(model)} space</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {solvers.includes("roast") && (
                  <Button
                    variant={activeView?.model === model && activeView?.solver === "roast" ? "accent" : "outline"}
                    size="sm"
                    onClick={() => setActiveView({ model, solver: "roast" })}
                    className="gap-1.5"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View ROAST
                  </Button>
                )}
                {solvers.includes("simnibs") && (
                  <Button
                    variant={activeView?.model === model && activeView?.solver === "simnibs" ? "accent" : "outline"}
                    size="sm"
                    onClick={() => setActiveView({ model, solver: "simnibs" })}
                    className="gap-1.5"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View SimNIBS
                  </Button>
                )}
                {hasComparison(model) && (
                  <Button
                    variant={activeView?.model === model && activeView?.solver === "comparison" ? "accent" : "outline"}
                    size="sm"
                    onClick={() => setActiveView({ model, solver: "comparison" })}
                    className="gap-1.5"
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    Compare
                  </Button>
                )}
              </div>
            </div>
          ))}

          {Object.keys(completedByModel).length === 0 && (
            <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-center">
              <AlertTriangle className="h-5 w-5 text-error mx-auto mb-2" />
              <p className="text-sm text-foreground-muted">All simulations failed. Check errors and retry.</p>
            </div>
          )}
        </div>

        {/* Rerun / change actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={rerunWithNewConfig} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Run Again (new parameters)
          </Button>
          <Button variant="outline" onClick={changeModels} className="gap-2">
            <Layers className="h-4 w-4" />
            Change Models
          </Button>
        </div>

        {/* Active viewer */}
        {activeView && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">
                {getDisplayName(activeView.model)}{" "}
                <span className="text-foreground-muted font-normal text-sm">
                  — {activeView.solver === "comparison" ? "ROAST vs SimNIBS" : activeView.solver === "roast" ? "ROAST-11" : "SimNIBS"}
                </span>
              </h3>
              <button
                onClick={() => setActiveView(null)}
                className="text-xs text-foreground-muted hover:text-foreground underline transition-colors"
              >
                Close viewer
              </button>
            </div>

            {(activeView.solver === "roast" || activeView.solver === "simnibs") && (
              <RoastViewer
                inputUrl={inputBlobUrl}
                sessionId={sessionId}
                modelName={activeView.model}
                solver={activeView.solver}
              />
            )}
            {activeView.solver === "comparison" && (
              <TESComparisonViewer
                inputUrl={inputBlobUrl}
                sessionId={sessionId}
                modelName={activeView.model}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 shadow-medical overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-accent/20 px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-accent/15 p-1.5">
            <Zap className="h-4 w-4 text-accent" />
          </div>
          <h2 className="text-base font-semibold text-foreground">TES Simulation</h2>
        </div>
        <TESSubStepper current={step} />
      </div>

      {/* Step content */}
      <div className="p-5">
        {step === "select"    && renderSelect()}
        {step === "configure" && renderConfigure()}
        {step === "simulate"  && renderSimulate()}
        {step === "results"   && renderResults()}
      </div>
    </div>
  );
}
