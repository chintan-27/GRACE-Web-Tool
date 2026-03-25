"use client";

interface Props {
  models: string[];
  progress: { [model: string]: number };
}

export default function ProgressPanel({ models, progress }: Props) {
  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-4">
        Model Progress
      </h3>

      <div className="space-y-4">
        {models.map((m) => {
          const pct = progress[m] ?? 0;
          const isComplete = pct >= 100;
          const isRunning = pct > 0 && pct < 100;

          return (
            <div key={m} className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-200 font-medium">{m}</span>
                <span
                  className={`${
                    isComplete
                      ? "text-green-400"
                      : isRunning
                      ? "text-amber-400"
                      : "text-neutral-500"
                  }`}
                >
                  {isComplete ? "Complete" : `${pct}%`}
                </span>
              </div>
              <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isComplete
                      ? "bg-green-500"
                      : isRunning
                      ? "bg-amber-500"
                      : "bg-neutral-700"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
