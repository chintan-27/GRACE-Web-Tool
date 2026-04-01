"use client";

import { AdminJob, cancelJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { XCircle, Inbox } from "lucide-react";
import { useState } from "react";

interface Props {
  jobs: AdminJob[];
  onRefresh: () => void;
}

const TYPE_LABEL: Record<AdminJob["type"], string> = {
  gpu_seg: "Seg",
  roast: "ROAST",
  simnibs: "SimNIBS",
};

const TYPE_STYLE: Record<AdminJob["type"], string> = {
  gpu_seg: "bg-accent/15 text-accent border border-accent/25",
  roast: "bg-blue-500/15 text-blue-400 border border-blue-500/25",
  simnibs: "bg-purple-500/15 text-purple-400 border border-purple-500/25",
};

const STATUS_STYLE: Record<string, string> = {
  queued:      "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
  waiting_gpu: "bg-orange-500/15 text-orange-400 border border-orange-500/25",
  assigned:    "bg-blue-500/15 text-blue-400 border border-blue-500/25",
  running:     "bg-accent/15 text-accent border border-accent/25",
  error:       "bg-red-500/15 text-red-400 border border-red-500/25",
  cancelled:   "bg-zinc-500/10 text-zinc-500 border border-zinc-500/20 line-through",
};

const STATUS_DOT: Record<string, string> = {
  queued:      "bg-zinc-400",
  waiting_gpu: "bg-orange-400",
  assigned:    "bg-blue-400",
  running:     "bg-accent animate-pulse",
  error:       "bg-red-400",
  cancelled:   "bg-zinc-500",
};

export default function JobsPanel({ jobs, onRefresh }: Props) {
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  async function handleCancel(sessionId: string) {
    setCancelling((prev) => new Set(prev).add(sessionId));
    try {
      await cancelJob(sessionId);
      onRefresh();
    } finally {
      setCancelling((prev) => { const s = new Set(prev); s.delete(sessionId); return s; });
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div className="p-4 rounded-full bg-surface-elevated">
          <Inbox className="h-8 w-8 text-foreground-muted" />
        </div>
        <p className="text-sm text-foreground-muted">No active jobs</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-medical-lg overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-elevated/50">
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Type</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Session</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Model</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted">Status</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted w-40">Progress</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted">GPU</th>
              <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-foreground-muted"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface-elevated/40 transition-colors">
                <td className="py-3 px-4">
                  <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${TYPE_STYLE[job.type]}`}>
                    {TYPE_LABEL[job.type]}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs">
                  <span title={job.session_id} className="text-foreground-secondary">{job.session_id.slice(0, 10)}</span>
                </td>
                <td className="py-3 px-4 text-sm text-foreground-secondary">{job.model || "—"}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[job.status] ?? "bg-zinc-400"}`} />
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[job.status] ?? STATUS_STYLE.queued}`}>
                      {job.status}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          job.status === "running" ? "bg-accent animate-progress-pulse" : "bg-foreground-muted/30"
                        }`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-foreground-muted w-10 text-right font-mono">{Math.round(job.progress)}%</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm text-foreground-muted">
                  {job.gpu != null ? `GPU ${job.gpu}` : "—"}
                </td>
                <td className="py-3 px-4">
                  {job.status !== "cancelled" && job.status !== "error" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-3 text-xs gap-1.5"
                      disabled={cancelling.has(job.session_id)}
                      onClick={() => handleCancel(job.session_id)}
                    >
                      <XCircle className="h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
