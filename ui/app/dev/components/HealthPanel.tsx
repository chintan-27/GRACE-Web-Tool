"use client";

import { Progress } from "@/components/ui/progress";
import { HealthResponse, AdminJobsResponse, AdminJob } from "@/lib/api";
import { Wifi, WifiOff, Cpu, HardDrive, Server, Activity } from "lucide-react";

interface Props {
  health: HealthResponse | null;
  queueDepths: AdminJobsResponse["queue_depths"] | null;
  jobs: AdminJob[];
  lastUpdated: Date | null;
}

function utilColor(pct: number): string {
  if (pct < 50) return "text-success";
  if (pct < 80) return "text-warning";
  return "text-error";
}

function utilBg(pct: number): string {
  if (pct < 50) return "bg-success/10 border-success/20";
  if (pct < 80) return "bg-warning/10 border-warning/20";
  return "bg-error/10 border-error/20";
}

export default function HealthPanel({ health, queueDepths, jobs, lastUpdated }: Props) {
  if (!health) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        <Activity className="h-4 w-4 mr-2 animate-pulse" />
        Loading system health…
      </div>
    );
  }

  const memUsedMb = health.mem_total_mb - health.mem_available_mb;
  const memPct = health.mem_total_mb > 0 ? (memUsedMb / health.mem_total_mb) * 100 : 0;
  const gpus = Array.isArray(health.gpu_usage) ? health.gpu_usage : [];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* System stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Redis */}
        <div className="bg-surface border border-border rounded-xl p-5 shadow-medical-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-lg ${health.redis ? "bg-success/10" : "bg-error/10"}`}>
              {health.redis
                ? <Wifi className="h-4 w-4 text-success" />
                : <WifiOff className="h-4 w-4 text-error" />}
            </div>
            <span className="text-sm text-foreground-secondary">Redis</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health.redis ? "bg-success animate-pulse" : "bg-error"}`} />
            <span className={`text-lg font-semibold ${health.redis ? "text-success" : "text-error"}`}>
              {health.redis ? "Connected" : "Down"}
            </span>
          </div>
        </div>

        {/* CPU */}
        <div className="bg-surface border border-border rounded-xl p-5 shadow-medical-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Cpu className="h-4 w-4 text-blue-400" />
            </div>
            <span className="text-sm text-foreground-secondary">CPU Cores</span>
          </div>
          <span className="text-2xl font-bold text-foreground">{health.cpu_count}</span>
        </div>

        {/* Memory */}
        <div className="bg-surface border border-border rounded-xl p-5 shadow-medical-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-lg ${utilBg(memPct)}`}>
              <HardDrive className={`h-4 w-4 ${utilColor(memPct)}`} />
            </div>
            <span className="text-sm text-foreground-secondary">System Memory</span>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className={`text-2xl font-bold ${utilColor(memPct)}`}>{Math.round(memPct)}%</span>
            <span className="text-xs text-foreground-muted">
              {(memUsedMb / 1024).toFixed(1)} / {(health.mem_total_mb / 1024).toFixed(1)} GB
            </span>
          </div>
          <Progress value={memPct} className="h-2" />
        </div>
      </div>

      {/* GPUs */}
      {gpus.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-4">GPUs</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {gpus.map((g) => {
              const vramPct = g.mem_total > 0 ? (g.mem_used / g.mem_total) * 100 : 0;
              return (
                <div
                  key={g.gpu}
                  className="bg-surface border border-border rounded-xl p-4 shadow-medical-lg hover:shadow-glow transition-shadow duration-300"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-foreground">GPU {g.gpu}</span>
                    <span className={`text-lg font-bold ${utilColor(g.util)}`}>{g.util}%</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-[11px] text-foreground-muted mb-1.5">
                        <span>Utilization</span>
                      </div>
                      <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            g.util < 50 ? "bg-success" : g.util < 80 ? "bg-warning" : "bg-error"
                          }`}
                          style={{ width: `${g.util}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-foreground-muted mb-1.5">
                        <span>VRAM</span>
                        <span>{(g.mem_used / 1024).toFixed(1)} / {(g.mem_total / 1024).toFixed(1)} GB</span>
                      </div>
                      <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            vramPct < 50 ? "bg-blue-400" : vramPct < 80 ? "bg-amber-400" : "bg-red-400"
                          }`}
                          style={{ width: `${vramPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {typeof health.gpu_usage === "string" && (
        <p className="text-xs text-foreground-muted">GPU info: {health.gpu_usage}</p>
      )}

      {/* Job status by type */}
      {queueDepths && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-4">Jobs by Type</h3>
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: "Segmentation", type: "gpu_seg" as const, qKey: "gpu_seg" as const, color: "text-accent", bg: "bg-accent/10 border-accent/20", dot: "bg-accent" },
              { label: "ROAST",        type: "roast"   as const, qKey: "roast"   as const, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400" },
              { label: "SimNIBS",      type: "simnibs" as const, qKey: "simnibs" as const, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", dot: "bg-purple-400" },
            ] as const).map(({ label, type, qKey, color, bg, dot }) => {
              const running  = jobs.filter(j => j.type === type && j.status === "running").length;
              const active   = jobs.filter(j => j.type === type).length;
              const pending  = queueDepths[qKey];
              return (
                <div key={qKey} className={`rounded-xl border p-5 shadow-medical-lg ${bg}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2 rounded-lg ${bg.split(" ")[0]}`}>
                      <Server className={`h-4 w-4 ${color}`} />
                    </div>
                    <span className="text-sm text-foreground-secondary">{label}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-3">
                    <p className={`text-3xl font-bold ${color}`}>{active}</p>
                    <p className="text-xs text-foreground-muted">active</p>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-foreground-muted">
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${running > 0 ? dot : "bg-foreground-muted/30"}`} />
                      {running} running
                    </span>
                    <span>{pending} pending</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lastUpdated && (
        <p className="text-[11px] text-foreground-muted text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
