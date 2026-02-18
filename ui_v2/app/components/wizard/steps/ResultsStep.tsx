"use client";

import { useState, useCallback } from "react";
import { Download, RefreshCw, Check, AlertTriangle, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { useJob } from "@/context/JobContext";
import { Button } from "@/components/ui/button";
import SplitViewer from "../../viewer/SplitViewer";
import RoastViewer from "../../viewer/RoastViewer";
import { API_BASE, startSimulation, connectROASTSSE } from "@/lib/api";

// -------------------------------------------------------------------
// ROAST state per model
// -------------------------------------------------------------------
type RoastStatus = "idle" | "queued" | "running" | "complete" | "error";

const ROAST_STEP_LABELS: Record<string, string> = {
  roast_queued:           "Queued...",
  roast_start:            "Starting simulation...",
  roast_prepare:          "Preparing files...",
  roast_step_csf_fix:     "Step 2.5: Fixing CSF...",
  roast_step_electrode:   "Step 3: Placing electrodes...",
  roast_step_mesh:        "Step 4: Generating mesh...",
  roast_step_solve:       "Step 5: Solving FEM model...",
  roast_step_postprocess: "Step 6: Post-processing...",
  roast_complete:         "Complete!",
};

// -------------------------------------------------------------------
export default function ResultsStep() {
  const { sessionId, models, inputBlobUrl, resetJob, selectedFile, error } = useJob();

  const handleDownload = (model: string) => {
    if (!sessionId) return;
    const url = `${API_BASE}/results/${sessionId}/${model}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${model}_segmentation.nii.gz`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = () => {
    models.forEach((model, index) => {
      setTimeout(() => handleDownload(model), index * 200);
    });
  };

  const getDisplayName = (model: string): string =>
    model.replace("-native", "").replace("-fs", "").toUpperCase();

  const getSpaceLabel = (model: string): string => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FreeSurfer";
    return "";
  };

  // -------------------------------------------------------------------
  // ROAST state (per model)
  // -------------------------------------------------------------------
  const [roastStatus,   setRoastStatus]   = useState<Record<string, RoastStatus>>({});
  const [roastProgress, setRoastProgress] = useState<Record<string, number>>({});
  const [roastStep,     setRoastStep]     = useState<Record<string, string>>({});
  const [roastError,    setRoastError]    = useState<Record<string, string | null>>({});
  const [roastOpen,     setRoastOpen]     = useState<Record<string, boolean>>({});

  const runSimulation = useCallback(async (model: string) => {
    if (!sessionId) return;

    setRoastStatus(p  => ({ ...p, [model]: "queued" }));
    setRoastProgress(p => ({ ...p, [model]: 0 }));
    setRoastStep(p    => ({ ...p, [model]: "Queued..." }));
    setRoastError(p   => ({ ...p, [model]: null }));

    try {
      await startSimulation(sessionId, model);
    } catch (e: any) {
      setRoastStatus(p => ({ ...p, [model]: "error" }));
      setRoastError(p  => ({ ...p, [model]: e.message || "Failed to start" }));
      return;
    }

    connectROASTSSE(
      sessionId,
      (evt) => {
        if (evt.type === "progress") {
          setRoastStatus(p   => ({ ...p, [model]: "running" }));
          setRoastProgress(p => ({ ...p, [model]: evt.progress ?? 0 }));
          const label = evt.event ? (ROAST_STEP_LABELS[evt.event] ?? evt.event) : "";
          if (label) setRoastStep(p => ({ ...p, [model]: label }));
        }
        if (evt.type === "complete") {
          setRoastStatus(p   => ({ ...p, [model]: "complete" }));
          setRoastProgress(p => ({ ...p, [model]: 100 }));
          setRoastStep(p    => ({ ...p, [model]: "Complete!" }));
          // Auto-open viewer
          setRoastOpen(p    => ({ ...p, [model]: true }));
        }
        if (evt.type === "error") {
          setRoastStatus(p => ({ ...p, [model]: "error" }));
          setRoastError(p  => ({ ...p, [model]: evt.detail || "Simulation error" }));
        }
      },
    );
  }, [sessionId]);

  // -------------------------------------------------------------------
  // Error / empty states
  // -------------------------------------------------------------------
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 max-w-2xl mx-auto">
        <div className="rounded-full bg-error/10 p-4 mb-4">
          <AlertTriangle className="h-8 w-8 text-error" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Processing Error</h2>
        <p className="text-foreground-secondary text-center mb-2">The segmentation job encountered an error:</p>
        <div className="bg-error/5 border border-error/20 rounded-lg p-4 mb-6 max-w-full overflow-auto">
          <code className="text-sm text-error whitespace-pre-wrap break-words">{error}</code>
        </div>
        <Button variant="accent" onClick={resetJob}>Start New Segmentation</Button>
      </div>
    );
  }

  if (!sessionId || !inputBlobUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-foreground-secondary">No results available</p>
        <Button variant="accent" className="mt-4" onClick={resetJob}>Start New Segmentation</Button>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="rounded-full bg-warning/10 p-4 mb-4">
          <AlertTriangle className="h-8 w-8 text-warning" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">No Results Available</h2>
        <p className="text-foreground-secondary text-center mb-6">
          No segmentation models completed successfully.
        </p>
        <Button variant="accent" onClick={resetJob}>Try Again</Button>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col items-center text-center md:flex-row md:items-start md:justify-between md:text-left">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm text-success">
            <Check className="h-4 w-4" />
            Segmentation Complete
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">View Results</h1>
          {selectedFile && (
            <p className="mt-2 text-foreground-secondary">{selectedFile.name}</p>
          )}
        </div>
        <div className="mt-4 flex gap-3 md:mt-0">
          <Button variant="outline" onClick={resetJob} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            New Segmentation
          </Button>
          <Button variant="accent" onClick={handleDownloadAll} className="gap-2">
            <Download className="h-4 w-4" />
            Download All
          </Button>
        </div>
      </div>

      {/* Segmentation Viewer */}
      <SplitViewer inputUrl={inputBlobUrl} sessionId={sessionId} models={models} />

      {/* TES Simulation Section */}
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-6 shadow-medical">
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-lg bg-accent/15 p-2">
            <Zap className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">TES Simulation</h2>
            <p className="text-xs text-foreground-muted">Run a transcranial electrical stimulation simulation on your segmentation</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {models.map((model) => {
            const rs = roastStatus[model] ?? "idle";
            const rp = roastProgress[model] ?? 0;
            const rStep = roastStep[model] ?? "";
            const rErr = roastError[model];
            const isViewerOpen = roastOpen[model] ?? false;

            return (
              <div key={model} className="flex flex-col gap-3 rounded-xl border border-accent/20 bg-background p-4">
                <div>
                  <h3 className="font-semibold text-foreground">{getDisplayName(model)}</h3>
                  <p className="text-xs text-foreground-muted">{getSpaceLabel(model)} space · F3(−2mA) / F4(+2mA)</p>
                </div>

                {rs === "idle" && (
                  <Button
                    variant="accent"
                    onClick={() => runSimulation(model)}
                    className="gap-2 w-full"
                  >
                    <Zap className="h-4 w-4" />
                    Run TES Simulation
                  </Button>
                )}

                {(rs === "queued" || rs === "running") && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-foreground-muted">
                      <span>{rStep || "Queued..."}</span>
                      <span>{rp}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-500"
                        style={{ width: `${rp}%` }}
                      />
                    </div>
                  </div>
                )}

                {rs === "error" && rErr && (
                  <div className="space-y-2">
                    <p className="text-xs text-error">{rErr}</p>
                    <Button variant="outline" onClick={() => runSimulation(model)} className="gap-2 w-full">
                      <Zap className="h-4 w-4" />
                      Retry
                    </Button>
                  </div>
                )}

                {rs === "complete" && (
                  <Button
                    variant="outline"
                    onClick={() => setRoastOpen(p => ({ ...p, [model]: !isViewerOpen }))}
                    className="gap-2 w-full border-accent/40 text-accent hover:bg-accent/10"
                  >
                    {isViewerOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {isViewerOpen ? "Hide" : "View"} Results
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ROAST Viewers — one per completed model */}
      {models.map((model) => {
        const rs = roastStatus[model];
        const isViewerOpen = roastOpen[model] ?? false;

        if (rs !== "complete" || !isViewerOpen || !inputBlobUrl) return null;

        return (
          <div key={`roast-viewer-${model}`} className="rounded-2xl border border-border bg-surface p-6 shadow-medical space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">
                TES Simulation — {getDisplayName(model)} <span className="text-foreground-muted text-sm">({getSpaceLabel(model)})</span>
              </h2>
            </div>
            <RoastViewer inputUrl={inputBlobUrl} sessionId={sessionId} />
          </div>
        );
      })}

      {/* Download Cards */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Download Segmentations
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {models.map((model) => (
            <div key={model} className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
              <div>
                <h3 className="font-semibold text-foreground">{getDisplayName(model)}</h3>
                <p className="text-xs text-foreground-muted">{getSpaceLabel(model)} space</p>
              </div>
              <Button variant="success" size="sm" onClick={() => handleDownload(model)} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-border-subtle bg-background-secondary p-4">
        <h3 className="text-sm font-medium text-foreground">About Your Results</h3>
        <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
          <li>Segmentation results are in NIfTI format with FreeSurfer-compatible labels</li>
          <li>TES simulation uses ROAST with F3(-2mA)/F4(+2mA) pad electrodes by default</li>
          <li>Simulation outputs include E-field magnitude and voltage maps</li>
          <li>Session data will be automatically cleaned up after 24 hours</li>
        </ul>
      </div>
    </div>
  );
}
