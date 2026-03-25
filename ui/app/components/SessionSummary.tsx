"use client";

import { useJob } from "../../context/JobContext";

export default function SessionSummary() {
  const { sessionId, models, space, queuePosition, status } = useJob();

  if (!sessionId) return null;

  const statusColors: Record<string, string> = {
    queued: "text-yellow-400",
    running: "text-amber-400",
    complete: "text-green-400",
    error: "text-red-400",
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-neutral-50">
          {status === "complete" ? "Segmentation Complete" : "Processing..."}
        </h2>
        <span
          className={`text-sm font-medium px-3 py-1 rounded-full border ${
            status === "complete"
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : status === "running"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
              : "border-neutral-700 bg-neutral-800 text-neutral-400"
          }`}
        >
          {status}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-3">
          <p className="text-neutral-500 text-xs mb-1">Space</p>
          <p className="text-neutral-200 font-medium capitalize">{space}</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-3">
          <p className="text-neutral-500 text-xs mb-1">Models</p>
          <p className="text-neutral-200 font-medium">{models.length}</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-3">
          <p className="text-neutral-500 text-xs mb-1">Queue Position</p>
          <p className="text-neutral-200 font-medium">{queuePosition ?? "-"}</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-800/50 p-3">
          <p className="text-neutral-500 text-xs mb-1">Session</p>
          <p className="text-neutral-400 font-mono text-xs truncate">{sessionId.slice(0, 8)}...</p>
        </div>
      </div>
    </div>
  );
}
