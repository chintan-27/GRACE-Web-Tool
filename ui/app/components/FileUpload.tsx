"use client";

import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface Props {
  selectedFile: File | null;
  onFileSelect: (f: File) => void;
}

export default function FileUpload({ selectedFile, onFileSelect }: Props) {
  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700">
      <CardHeader>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Upload NIfTI File
        </h3>
      </CardHeader>

      <CardContent className="space-y-2">
        <Label className="text-gray-700 dark:text-gray-300">
          Select .nii / .nii.gz:
        </Label>

        <Input
          type="file"
          accept=".nii,.nii.gz,.gz"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && (file.name.endsWith(".nii") || file.name.endsWith(".nii.gz"))) {
              onFileSelect(file);
            }
          }}
          className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
        />

        {selectedFile && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {selectedFile.name}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
