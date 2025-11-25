"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Props {
  models: string[];
  progress: { [model: string]: number };
}

export default function ProgressPanel({ models, progress }: Props) {
  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Model Progress
        </h3>
      </CardHeader>

      <CardContent className="space-y-3">
        {models.map((m) => {
          const pct = progress[m] ?? 0;
          return (
            <div key={m} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-800 dark:text-gray-200">{m}</span>
                <span className="text-gray-700 dark:text-gray-300">{pct}%</span>
              </div>
              <Progress value={pct} className="h-2" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
