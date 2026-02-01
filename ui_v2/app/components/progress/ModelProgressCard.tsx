"use client";

import { Check, Loader2, Clock, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelProgressCardProps {
  model: string;
  progress: number;
  gpu?: number;
}

export default function ModelProgressCard({ model, progress, gpu }: ModelProgressCardProps) {
  const isComplete = progress >= 100;
  const isRunning = progress > 0 && progress < 100;
  const isPending = progress === 0;

  // Parse model name for display
  const getDisplayName = (model: string): string => {
    return model
      .replace("-native", "")
      .replace("-fs", "")
      .toUpperCase();
  };

  const getSpaceLabel = (model: string): string => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FreeSurfer";
    return "";
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all duration-300",
        isComplete && "border-success/50 bg-success/5",
        isRunning && "border-accent/50 bg-accent/5",
        isPending && "border-border bg-surface"
      )}
    >
      <div className="flex items-center justify-between">
        {/* Model info */}
        <div className="flex items-center gap-3">
          {/* Status icon */}
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              isComplete && "bg-success/10 text-success",
              isRunning && "bg-accent/10 text-accent",
              isPending && "bg-surface-elevated text-foreground-muted"
            )}
          >
            {isComplete ? (
              <Check className="h-5 w-5" />
            ) : isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Clock className="h-5 w-5" />
            )}
          </div>

          <div>
            <h3 className="font-semibold text-foreground">
              {getDisplayName(model)}
            </h3>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <span>{getSpaceLabel(model)} space</span>
              {gpu !== undefined && (isRunning || isComplete) && (
                <>
                  <span className="text-border">•</span>
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                    isRunning && "bg-accent/20 text-accent",
                    isComplete && "bg-success/20 text-success"
                  )}>
                    <Cpu className="h-3 w-3" />
                    GPU {gpu}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="text-right">
          <span
            className={cn(
              "text-lg font-bold",
              isComplete && "text-success",
              isRunning && "text-accent",
              isPending && "text-foreground-muted"
            )}
          >
            {Math.round(progress)}%
          </span>
          <p className="text-xs text-foreground-muted">
            {isComplete ? "Complete" : isRunning ? "Processing" : "Waiting"}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            isComplete && "bg-success",
            isRunning && "bg-accent animate-progress-pulse",
            isPending && "bg-foreground-muted"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
