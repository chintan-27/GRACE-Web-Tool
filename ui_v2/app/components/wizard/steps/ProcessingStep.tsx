"use client";

import { useJob } from "@/context/JobContext";
import OverallProgress from "../../progress/OverallProgress";
import ModelProgressCard from "../../progress/ModelProgressCard";
import GPUStatus from "../../GPUStatus";

export default function ProcessingStep() {
  const { models, progress, modelGpus, status, sessionId, queuePosition, selectedFile } = useJob();

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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {getStatusLabel()}
        </h1>
        {selectedFile && (
          <p className="mt-2 text-foreground-secondary">
            Processing: {selectedFile.name}
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
              <p className="text-xs text-foreground-muted">Session ID</p>
              <p className="mt-1 font-mono text-xs text-foreground-secondary">
                {sessionId.slice(0, 8)}...
              </p>
            </div>
          )}
        </div>

        {/* Right: Model Cards */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            Model Progress
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
        <h3 className="text-sm font-medium text-foreground">
          Processing Information
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
          <li>Models are processed sequentially on available GPUs</li>
          <li>Progress updates are streamed in real-time</li>
          <li>You can stay on this page or leave - your session will continue</li>
        </ul>
      </div>
    </div>
  );
}
