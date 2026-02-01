"use client";

import { cn } from "@/lib/utils";

interface OverallProgressProps {
  progress: number; // 0-100
  status: "queued" | "running" | "complete";
}

export default function OverallProgress({ progress, status }: OverallProgressProps) {
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      {/* Circular Progress */}
      <div className="relative h-32 w-32">
        {/* Background circle */}
        <svg className="h-full w-full -rotate-90 transform">
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            stroke={status === "complete" ? "hsl(var(--success))" : "hsl(var(--accent))"}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={cn(
              "transition-all duration-500 ease-out",
              status === "running" && "animate-progress-pulse"
            )}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "text-3xl font-bold",
              status === "complete" ? "text-success" : "text-foreground"
            )}
          >
            {Math.round(progress)}%
          </span>
          <span className="text-xs text-foreground-muted">
            {status === "queued"
              ? "Queued"
              : status === "running"
              ? "Processing"
              : "Complete"}
          </span>
        </div>
      </div>
    </div>
  );
}
