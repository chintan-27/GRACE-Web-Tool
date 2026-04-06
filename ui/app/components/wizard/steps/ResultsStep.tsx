"use client";

import { useState, useEffect } from "react";
import { Download, RefreshCw, Check, AlertTriangle, Zap, ArrowRight, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useJob } from "@/context/JobContext";
import { Button } from "@/components/ui/button";
import SplitViewer from "../../viewer/SplitViewer";
import { API_BASE, deleteSession } from "@/lib/api";
import { VolumeStatsPanel } from "../../results/VolumeStatsPanel";

const ACTIVE_SIM_KEY = "grace_active_sim";
type SavedSim = { sessionId: string; model: string; solver: "roast" | "simnibs"; startedAt: number };

export default function ResultsStep() {
  const { sessionId, models, inputBlobUrl, resetJob, selectedFile, error } = useJob();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeSim, setActiveSim] = useState<SavedSim | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SIM_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as SavedSim;
      if (Date.now() - s.startedAt < 4 * 3600 * 1000) setActiveSim(s);
    } catch {}
  }, []);

  const handleDeleteSession = async () => {
    if (!sessionId) return;
    setDeleting(true);
    try {
      await deleteSession(sessionId);
    } catch { /* best-effort */ }
    setDeleting(false);
    setDeleteConfirm(false);
    resetJob();
  };

  const handleDownload = (model: string) => {
    if (!sessionId) return;
    const url  = `${API_BASE}/results/${sessionId}/${model}`;
    const link = document.createElement("a");
    link.href  = url;
    link.download = `${model}_segmentation.nii.gz`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = () =>
    models.forEach((model, idx) => setTimeout(() => handleDownload(model), idx * 200));

  const getDisplayName = (model: string) =>
    model.replace("-native", "").replace("-fs", "").toUpperCase();

  const getSpaceLabel = (model: string) => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FreeSurfer";
    return "";
  };

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
        <p className="text-foreground-secondary text-center mb-6">No segmentation models completed successfully.</p>
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
          <div className="mb-2 inline-flex items-center gap-2 rounded border border-success/40 bg-success/10 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-success">
            <Check className="h-3.5 w-3.5" />
            ✓ inference complete
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">View Results</h1>
          {selectedFile && (
            <p className="mt-2 font-mono text-sm text-foreground-secondary">{selectedFile.name}</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 md:mt-0">
          <Button variant="outline" onClick={resetJob} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            New Segmentation
          </Button>
          <Button variant="outline" onClick={handleDownloadAll} className="gap-2">
            <Download className="h-4 w-4" />
            Download All
          </Button>
          <Button variant="outline" onClick={() => setDeleteConfirm(true)} className="gap-2 text-error border-error/40 hover:bg-error/5">
            <Trash2 className="h-4 w-4" />
            Delete My Data
          </Button>
        </div>
      </div>

      {/* Running tDCS simulation banner */}
      {activeSim && (
        <div className="flex items-center gap-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              tDCS simulation running in background
            </p>
            <p className="text-xs text-foreground-muted truncate">
              {activeSim.model.replace("-native", "").replace("-fs", "").toUpperCase()} · {activeSim.solver.toUpperCase()}
            </p>
          </div>
          <Link
            href="/tes"
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90"
          >
            View progress →
          </Link>
        </div>
      )}

      {/* tDCS Simulation CTA */}
      <Link href="/tes" className="block group">
        <div className="rounded-2xl border-2 border-accent/40 bg-gradient-to-r from-accent/5 to-accent/10 p-5 shadow-medical transition-all hover:border-accent hover:from-accent/10 hover:to-accent/15 hover:shadow-glow">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent">
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-mono text-sm font-bold uppercase tracking-widest text-accent mb-0.5">
                  Run tDCS Simulation
                </h2>
                <p className="text-sm text-foreground-secondary">
                  Use your segmentation to simulate transcranial Direct Current Stimulation — place electrodes, pick a montage, and compute E-field and current density maps.
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-accent opacity-60 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
          </div>
        </div>
      </Link>

      {/* Segmentation Viewer — always visible */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-medical">
        <SplitViewer inputUrl={inputBlobUrl} sessionId={sessionId} models={models} />
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <button onClick={() => setDeleteConfirm(false)} className="absolute right-3 top-3 rounded-lg p-1.5 text-foreground-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/15">
                <Trash2 className="h-5 w-5 text-error" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Delete your data?</h3>
                <p className="text-xs text-foreground-muted">This cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-foreground-secondary mb-5">
              This will immediately erase your uploaded MRI, all segmentation results, and any simulation outputs from our server.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
              <button
                onClick={handleDeleteSession}
                disabled={deleting}
                className="flex-1 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Cards */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
        <h2 className="mb-4 text-[10px] font-bold uppercase tracking-widest font-mono text-accent">
          // Output Files
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {models.map(model => (
            <div key={model} className="flex flex-col rounded-xl border border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-mono font-bold tracking-wide text-foreground">{getDisplayName(model)}</h3>
                  <span className="mt-1 inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-foreground-muted">{getSpaceLabel(model)}</span>
                </div>
                <Button variant="success" size="sm" onClick={() => handleDownload(model)} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
              {sessionId && (
                <VolumeStatsPanel sessionId={sessionId} modelName={model} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-border-subtle bg-background-secondary p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono text-accent mb-2">// Output Info</h3>
        <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
          <li>Segmentation results are in NIfTI format (.nii.gz) compatible with FSL, FreeSurfer, and SPM</li>
          <li>tDCS simulation uses ROAST-11 (MATLAB) and/or SimNIBS FEM solvers</li>
          <li>Simulation outputs include E-field magnitude (V/m) and current density (A/m²) maps</li>
          <li>Your session data is stored securely and <strong>automatically deleted after 24 hours</strong></li>
          <li>Use <strong>Delete My Data</strong> above to erase your files immediately</li>
        </ul>
      </div>
    </div>
  );
}
