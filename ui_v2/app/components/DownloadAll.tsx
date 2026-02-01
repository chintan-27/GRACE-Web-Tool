"use client";

import JSZip from "jszip";
import { saveAs } from "file-saver";
import { getResult } from "../../lib/api";

interface Props {
  sessionId: string;
  models: string[];
}

export default function DownloadAll({ sessionId, models }: Props) {
  const downloadAll = async () => {
    const zip = new JSZip();

    for (const m of models) {
      const blob = await getResult(sessionId, m);
      zip.file(`${m}.nii.gz`, blob);
    }

    const out = await zip.generateAsync({ type: "blob" });
    saveAs(out, `session_${sessionId.slice(0, 8)}_results.zip`);
  };

  const downloadSingle = async (model: string) => {
    const blob = await getResult(sessionId, model);
    saveAs(blob, `${model}.nii.gz`);
  };

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
        Download Results
      </h3>

      <div className="flex flex-wrap gap-2">
        {/* Individual model downloads */}
        {models.map((m) => (
          <button
            key={m}
            onClick={() => downloadSingle(m)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-700 bg-neutral-800 text-neutral-300 text-sm hover:border-neutral-500 hover:bg-neutral-700 transition"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            {m}
          </button>
        ))}

        {/* Download all as ZIP */}
        <button
          onClick={downloadAll}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500 text-neutral-950 text-sm font-medium hover:bg-amber-400 transition"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download All (ZIP)
        </button>
      </div>
    </div>
  );
}
