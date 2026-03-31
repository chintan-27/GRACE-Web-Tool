"use client";

import { AdminJob, cancelJob } from "@/lib/api";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";
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

const TYPE_COLOR: Record<AdminJob["type"], string> = {
  gpu_seg: "bg-accent/20 text-accent",
  roast: "bg-blue-500/20 text-blue-400",
  simnibs: "bg-purple-500/20 text-purple-400",
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    queued:      "bg-muted text-muted-foreground",
    waiting_gpu: "bg-orange-500/20 text-orange-400",
    running:     "bg-accent/20 text-accent animate-pulse",
    error:       "bg-destructive/20 text-destructive",
    cancelled:   "bg-muted text-muted-foreground line-through",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

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
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <XCircle className="h-8 w-8 opacity-30" />
        <p className="text-sm">No active jobs</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground uppercase">
            <th className="text-left pb-2 pr-4">Type</th>
            <th className="text-left pb-2 pr-4">Session</th>
            <th className="text-left pb-2 pr-4">Model</th>
            <th className="text-left pb-2 pr-4">Status</th>
            <th className="text-left pb-2 pr-4 w-32">Progress</th>
            <th className="text-left pb-2 pr-4">GPU</th>
            <th className="text-left pb-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {jobs.map((job, i) => (
            <tr key={i} className="hover:bg-surface/50">
              <td className="py-2.5 pr-4">
                <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TYPE_COLOR[job.type]}`}>
                  {TYPE_LABEL[job.type]}
                </span>
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs">
                <span title={job.session_id}>{job.session_id.slice(0, 8)}…</span>
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground">{job.model || "—"}</td>
              <td className="py-2.5 pr-4">{statusBadge(job.status)}</td>
              <td className="py-2.5 pr-4">
                <div className="flex items-center gap-2">
                  <Progress value={job.progress} className="h-1.5 w-24" />
                  <span className="text-[11px] text-muted-foreground w-8">{Math.round(job.progress)}%</span>
                </div>
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                {job.gpu != null ? `GPU ${job.gpu}` : "—"}
              </td>
              <td className="py-2.5">
                {job.status !== "cancelled" && job.status !== "error" && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[11px]"
                    disabled={cancelling.has(job.session_id)}
                    onClick={() => handleCancel(job.session_id)}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
