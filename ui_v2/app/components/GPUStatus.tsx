"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
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
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          System Health
        </h3>
      </CardHeader>

      <CardContent className="space-y-2">
        <p>
          Redis:{" "}
          <span
            className={
              health.redis
                ? "text-green-600"
                : "text-red-600 dark:text-red-400"
            }
          >
            {health.redis ? "Online" : "Offline"}
          </span>
        </p>

        <p className="text-gray-700 dark:text-gray-300">
          Queue Length: {health.queue_length}
        </p>

        {Array.isArray(health.gpu_usage) &&
          health.gpu_usage.map((gpu: any) => (
            <div
              key={gpu.gpu}
              className="flex justify-between text-sm p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
            >
              <span className="text-gray-800 dark:text-gray-200">
                GPU {gpu.gpu}
              </span>
              <span className="text-gray-700 dark:text-gray-300">
                {gpu.util}%
              </span>
              <span className="text-gray-700 dark:text-gray-300">
                {gpu.mem_used}/{gpu.mem_total} MB
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
