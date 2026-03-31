"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HealthResponse, AdminJobsResponse } from "@/lib/api";
import { Wifi, WifiOff, Cpu, HardDrive, Server } from "lucide-react";

interface Props {
  health: HealthResponse | null;
  queueDepths: AdminJobsResponse["queue_depths"] | null;
  lastUpdated: Date | null;
}

export default function HealthPanel({ health, queueDepths, lastUpdated }: Props) {
  if (!health) {
    return <div className="text-sm text-muted-foreground">Loading system health…</div>;
  }

  const memUsedMb = health.mem_total_mb - health.mem_available_mb;
  const memPct = health.mem_total_mb > 0 ? (memUsedMb / health.mem_total_mb) * 100 : 0;
  const gpus = Array.isArray(health.gpu_usage) ? health.gpu_usage : [];

  return (
    <div className="space-y-6">
      {/* Top stat row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Redis */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              {health.redis
                ? <Wifi className="h-4 w-4 text-success" />
                : <WifiOff className="h-4 w-4 text-destructive" />}
              <span className="text-xs text-muted-foreground">Redis</span>
            </div>
            <p className={`text-sm font-semibold ${health.redis ? "text-success" : "text-destructive"}`}>
              {health.redis ? "Connected" : "Down"}
            </p>
          </CardContent>
        </Card>

        {/* CPU */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">CPU cores</span>
            </div>
            <p className="text-sm font-semibold">{health.cpu_count}</p>
          </CardContent>
        </Card>

        {/* Memory */}
        <Card className="col-span-2">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">System memory</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {memUsedMb.toFixed(0)} / {health.mem_total_mb.toFixed(0)} MB
              </span>
            </div>
            <Progress value={memPct} className="h-2" />
          </CardContent>
        </Card>
      </div>

      {/* GPU cards */}
      {gpus.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase text-muted-foreground mb-3">GPUs</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {gpus.map((g) => {
              const vramPct = g.mem_total > 0 ? (g.mem_used / g.mem_total) * 100 : 0;
              return (
                <Card key={g.gpu}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-xs text-muted-foreground flex justify-between">
                      <span>GPU {g.gpu}</span>
                      <span className="text-foreground font-semibold">{g.util}%</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    <Progress value={g.util} className="h-1.5" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>VRAM</span>
                      <span>{(g.mem_used / 1024).toFixed(1)} / {(g.mem_total / 1024).toFixed(1)} GB</span>
                    </div>
                    <Progress value={vramPct} className="h-1" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {typeof health.gpu_usage === "string" && (
        <p className="text-xs text-muted-foreground">GPU info: {health.gpu_usage}</p>
      )}

      {/* Queue depths */}
      {queueDepths && (
        <div>
          <h3 className="text-xs font-medium uppercase text-muted-foreground mb-3">Queue depths</h3>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { label: "Segmentation", key: "gpu_seg" as const, color: "text-accent" },
                { label: "ROAST", key: "roast" as const, color: "text-blue-400" },
                { label: "SimNIBS", key: "simnibs" as const, color: "text-purple-400" },
              ] as const
            ).map(({ label, key, color }) => (
              <Card key={key}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className={`text-xl font-bold ${color}`}>{queueDepths[key]}</p>
                  <p className="text-[11px] text-muted-foreground">queued</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {lastUpdated && (
        <p className="text-[11px] text-muted-foreground text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
