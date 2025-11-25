"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { useJob } from "../../context/JobContext";

export default function SessionSummary() {
  const { sessionId, models, space, queuePosition, status } = useJob();

  if (!sessionId) return null;

  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Session Summary
        </h3>
      </CardHeader>

      <CardContent className="space-y-2 text-sm">
        <p className="text-gray-800 dark:text-gray-200">
          <b>Status:</b> {status}
        </p>

        <p className="text-gray-800 dark:text-gray-200">
          <b>Queue Position:</b> {queuePosition}
        </p>

        <p className="text-gray-800 dark:text-gray-200">
          <b>Space:</b> {space}
        </p>

        <div>
          <b className="text-gray-800 dark:text-gray-200">Models:</b>
          <ul className="list-disc ml-6">
            {models.map((m) => (
              <li key={m} className="text-gray-700 dark:text-gray-300">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
