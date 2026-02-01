"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SpaceSelector({ value, onChange }: Props) {
  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Processing Space
        </h3>
      </CardHeader>

      <CardContent>
        <RadioGroup
          value={value}
          onValueChange={onChange}
          className="space-y-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="native" id="native" />
            <Label
              htmlFor="native"
              className="text-gray-800 dark:text-gray-200"
            >
              Native Space
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <RadioGroupItem value="freesurfer" id="fs" />
            <Label
              htmlFor="fs"
              className="text-gray-800 dark:text-gray-200"
            >
              FreeSurfer Space
            </Label>
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
