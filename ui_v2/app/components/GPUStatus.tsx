"use client";

import { useEffect, useState } from "react";
import { getHealth } from "../../lib/api";

export default function GPUStatus() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const load = async () => setHealth(await getHealth());
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!health) return null;

  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300 mb-3">
        System Status
      </h3>

      <div className="space-y-3 text-xs">
        {/* Redis Status */}
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Redis</span>
          <span
            className={`font-medium ${
              health.redis ? "text-green-400" : "text-red-400"
            }`}
          >
            {health.redis ? "Online" : "Offline"}
          </span>
        </div>

        {/* Queue */}
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Queue</span>
          <span className="text-neutral-200">{health.queue_length} jobs</span>
        </div>

        {/* GPUs */}
        {Array.isArray(health.gpu_usage) && health.gpu_usage.length > 0 && (
          <div className="pt-2 border-t border-neutral-800">
            <p className="text-neutral-500 mb-2">GPUs ({health.gpu_count} available)</p>
            <div className="space-y-2">
              {health.gpu_usage.map((gpu: any) => (
                <div
                  key={gpu.gpu}
                  className="flex items-center gap-2"
                >
                  <span className="text-neutral-400 w-12">GPU {gpu.gpu}</span>
                  <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        gpu.util > 80
                          ? "bg-amber-500"
                          : gpu.util > 50
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${gpu.util}%` }}
                    />
                  </div>
                  <span className="text-neutral-500 w-10 text-right">{gpu.util}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
