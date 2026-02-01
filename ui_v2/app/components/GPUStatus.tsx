"use client";

import { useEffect, useState } from "react";
import { Cpu, Server, Database } from "lucide-react";
import { getHealth, HealthResponse } from "../../lib/api";
import { cn } from "@/lib/utils";

export default function GPUStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const load = async () => setHealth(await getHealth());
    load();
    const t = setInterval(load, 3000); // Poll every 3 seconds for more real-time updates
    return () => clearInterval(t);
  }, []);

  if (!health) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-3 flex items-center gap-2">
        <Server className="h-4 w-4" />
        System Status
      </h3>

      <div className="space-y-3 text-sm">
        {/* Redis Status */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-foreground-secondary">
            <Database className="h-4 w-4" />
            Redis
          </span>
          <span
            className={cn(
              "font-medium px-2 py-0.5 rounded text-xs",
              health.redis
                ? "bg-success/20 text-success"
                : "bg-error/20 text-error"
            )}
          >
            {health.redis ? "Online" : "Offline"}
          </span>
        </div>

        {/* Queue */}
        <div className="flex items-center justify-between">
          <span className="text-foreground-secondary">Queue</span>
          <span className="text-foreground font-medium">{health.queue_length} jobs</span>
        </div>

        {/* GPUs */}
        {Array.isArray(health.gpu_usage) && health.gpu_usage.length > 0 && (
          <div className="pt-3 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-foreground-secondary flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                GPUs
              </span>
              <span className="text-xs text-foreground-muted">
                {health.gpu_count} available
              </span>
            </div>
            <div className="space-y-2">
              {health.gpu_usage.map((gpu) => (
                <div
                  key={gpu.gpu}
                  className="flex items-center gap-3"
                >
                  <span className={cn(
                    "text-xs font-mono w-14 px-1.5 py-0.5 rounded text-center",
                    gpu.util > 50
                      ? "bg-accent/20 text-accent"
                      : "bg-surface-elevated text-foreground-muted"
                  )}>
                    GPU {gpu.gpu}
                  </span>
                  <div className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        gpu.util > 80
                          ? "bg-warning"
                          : gpu.util > 50
                          ? "bg-accent"
                          : "bg-success"
                      )}
                      style={{ width: `${gpu.util}%` }}
                    />
                  </div>
                  <span className="text-xs text-foreground-muted w-12 text-right font-mono">
                    {gpu.util}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
