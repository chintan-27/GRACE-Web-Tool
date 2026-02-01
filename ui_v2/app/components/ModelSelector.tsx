"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface Props {
  selectedModels: string[];
  onChange: (models: string[]) => void;
}

const ALL_MODELS = [
  "grace-native",
  "grace-fs",
  "domino-native",
  "domino-fs",
  "dominopp-native",
  "dominopp-fs",
];

export default function ModelSelector({ selectedModels, onChange }: Props) {
  const toggle = (m: string) =>
    selectedModels.includes(m)
      ? onChange(selectedModels.filter((x) => x !== m))
      : onChange([...selectedModels, m]);

  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Models
        </h3>
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-3">
        {ALL_MODELS.map((m) => (
          <div key={m} className="flex items-center space-x-2">
            <Checkbox
              checked={selectedModels.includes(m)}
              onCheckedChange={() => toggle(m)}
              id={m}
            />
            <Label
              htmlFor={m}
              className="text-gray-800 dark:text-gray-200"
            >
              {m}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
