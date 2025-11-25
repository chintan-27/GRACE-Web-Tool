"use client";

import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Button } from "@/components/ui/button";
import { getResult } from "../../lib/api";

interface Props {
  sessionId: string;
  models: string[];
}

export default function DownloadAll({ sessionId, models }: Props) {
  const download = async () => {
    const zip = new JSZip();

    for (const m of models) {
      const blob = await getResult(sessionId, m);
      zip.file(`${m}.nii.gz`, blob);
    }

    const out = await zip.generateAsync({ type: "blob" });
    saveAs(out, `session_${sessionId}_results.zip`);
  };

  return (
    <Button
      onClick={download}
      className="bg-green-600 hover:bg-green-700 text-white dark:bg-green-500 dark:hover:bg-green-600"
    >
      Download All Outputs
    </Button>
  );
}
