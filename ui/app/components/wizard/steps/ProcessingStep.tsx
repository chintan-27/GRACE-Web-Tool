"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useJob } from "@/context/JobContext";
import { cancelJob } from "@/lib/api";
import OverallProgress from "../../progress/OverallProgress";
import ModelProgressCard from "../../progress/ModelProgressCard";
import GPUStatus from "../../GPUStatus";

export default function ProcessingStep() {
  const { models, progress, modelGpus, status, sessionId, queuePosition, selectedFile, resetJob } = useJob();
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!sessionId || cancelling) return;
    setCancelling(true);
    await cancelJob(sessionId).catch(() => {});
    resetJob();
  };

  // Calculate overall progress
  const totalProgress = models.length > 0
    ? models.reduce((sum, model) => sum + (progress[model] ?? 0), 0) / models.length
    : 0;

  const getStatusLabel = () => {
    if (status === "uploading") return "Uploading file...";
    if (status === "queued") {
      return queuePosition && queuePosition > 0
        ? `In queue (position ${queuePosition})`
        : "Starting...";
    }
    if (status === "running") return "Processing MRI scan";
    if (status === "complete") return "Segmentation complete";
    return "Initializing...";
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
          {status === "running" && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
          )}
          {status === "complete" && <span className="text-success">✓</span>}
          // {status === "uploading" ? "uploading" : status === "queued" ? "queued" : status === "running" ? "inference running" : "done"}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {getStatusLabel()}
        </h1>
        {selectedFile && (
          <p className="mt-2 font-mono text-sm text-foreground-secondary">
            {selectedFile.name}
          </p>
        )}
      </div>

      {/* Main Content */}
      <div className="grid gap-6 md:grid-cols-[1fr,2fr]">
        {/* Left: Overall Progress */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
          <OverallProgress
            progress={totalProgress}
            status={status === "complete" ? "complete" : status === "running" ? "running" : "queued"}
          />

          {sessionId && (
            <div className="mt-4 text-center">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-accent">session</p>
              <p className="mt-1 font-mono text-xs text-foreground-secondary border border-border rounded px-2 py-0.5 inline-block">
                {sessionId.slice(0, 8)}...
              </p>
            </div>
          )}

          {/* Cancel button — only while job is active */}
          {(status === "queued" || status === "running") && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {cancelling ? "Cancelling…" : "Cancel job"}
            </button>
          )}
        </div>

        {/* Right: Model Cards */}
        <div className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest font-mono text-accent">
            // Model Pipeline
          </h2>

          <div className="space-y-3">
            {models.map((model) => (
              <ModelProgressCard
                key={model}
                model={model}
                progress={progress[model] ?? 0}
                gpu={modelGpus[model]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* GPU Status */}
      <div className="mt-8">
        <GPUStatus />
      </div>

      {/* Info Box */}
      <div className="mt-6 rounded-xl border border-border-subtle bg-background-secondary p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono text-accent mb-2">
          // Runtime Info
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
          <li>Models are processed sequentially on available GPUs</li>
          <li>Progress updates are streamed in real-time via SSE</li>
          <li>You can stay on this page or leave — your session will continue</li>
        </ul>
      </div>
    </div>
  );
}
