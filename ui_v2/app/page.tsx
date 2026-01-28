"use client";

import { useState, useEffect } from "react";
import { useJob } from "@/context/JobContext";

import GPUStatus from "./components/GPUStatus";
import ProgressPanel from "./components/ProgressPanel";
import SessionSummary from "./components/SessionSummary";
import DownloadAll from "./components/DownloadAll";
import Viewer from "./components/Viewer";
import ErrorModal from "./components/ErrorModal";

type Space = "native" | "freesurfer";

export default function HomePage() {
  const {
    startJob,
    resetJob,
    sessionId,
    models,
    progress,
    status,
    viewerReady,
    error,
    setError,
    sseDisconnected,
    setSseDisconnected,
  } = useJob();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space>("native");
  const [convertToFs, setConvertToFs] = useState(false);
  const [grace, setGrace] = useState(false);
  const [domino, setDomino] = useState(false);
  const [dominopp, setDominopp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [inputBlobUrl, setInputBlobUrl] = useState<string | null>(null);

  const isAnyModelChecked = grace || domino || dominopp;
  const canSubmit = selectedFile && isAnyModelChecked;

  // Cleanup blob URL when component unmounts or resets
  useEffect(() => {
    return () => {
      if (inputBlobUrl) {
        URL.revokeObjectURL(inputBlobUrl);
      }
    };
  }, [inputBlobUrl]);

  const handleStart = async () => {
    if (!selectedFile) return;
    if (!isAnyModelChecked) return;

    // Create blob URL for immediate display
    const blobUrl = URL.createObjectURL(selectedFile);
    setInputBlobUrl(blobUrl);

    // Build model list based on space + selected models
    const modelList: string[] = [];
    const suffix = selectedSpace === "native" ? "-native" : "-fs";

    if (grace) modelList.push(`grace${suffix}`);
    if (domino) modelList.push(`domino${suffix}`);
    if (dominopp) modelList.push(`dominopp${suffix}`);

    // Only convert to FS if user selected FreeSurfer space AND checked the conversion box
    const shouldConvertToFs = selectedSpace === "freesurfer" && convertToFs;
    await startJob(selectedFile, modelList, selectedSpace, shouldConvertToFs);
  };

  const handleReset = () => {
    // Cleanup blob URL
    if (inputBlobUrl) {
      URL.revokeObjectURL(inputBlobUrl);
      setInputBlobUrl(null);
    }
    // Reset form state
    setSelectedFile(null);
    setConvertToFs(false);
    setGrace(false);
    setDomino(false);
    setDominopp(false);
    // Reset job context
    resetJob();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".nii") || file.name.endsWith(".nii.gz"))) {
      setSelectedFile(file);
    }
  };

  return (
    <>
      {/* Error Modal */}
      <ErrorModal
        open={!!error || sseDisconnected}
        message={
          error ??
          "Connection to the server was lost. Attempting to reconnect…"
        }
        onRetry={() => {
          setSseDisconnected(false);
          setError(null);
        }}
        onClose={() => {
          setSseDisconnected(false);
          setError(null);
        }}
      />

      <div className="flex items-center justify-center px-4 py-10 min-h-screen bg-neutral-950">
        <div className="w-full max-w-5xl">
          {/* INITIAL UI */}
          {status === "idle" && (
            <div className="grid gap-8 md:grid-cols-[minmax(0,2.1fr),minmax(0,1.3fr)] items-start">
              {/* LEFT: Main Card */}
              <section className="rounded-3xl border border-neutral-800 bg-neutral-900/80 p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.75)] backdrop-blur">
                <div className="space-y-2 mb-6">
                  <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-neutral-50">
                    Whole-Head MRI Segmentator
                  </h2>
                  <p className="text-sm text-neutral-400">
                    Upload a T1-weighted MRI volume, choose a processing space, and
                    run GRACE / DOMINO models to obtain whole-head segmentations.
                  </p>
                </div>

                {/* Space Selection */}
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                    Processing space
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedSpace("native")}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                        selectedSpace === "native"
                          ? "border-amber-500 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
                          : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
                      }`}
                    >
                      <div className="font-medium text-neutral-50">Native space</div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Segment directly in each subject&apos;s native anatomical space.
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSpace("freesurfer")}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                        selectedSpace === "freesurfer"
                          ? "border-amber-500 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
                          : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
                      }`}
                    >
                      <div className="font-medium text-neutral-50">FreeSurfer space</div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Use volumes aligned to a FreeSurfer-derived space.
                      </div>
                    </button>
                  </div>

                  {/* FreeSurfer conversion checkbox - only shown when FreeSurfer space is selected */}
                  {selectedSpace === "freesurfer" && (
                    <label className="flex items-start gap-3 mt-3 p-3 rounded-xl border border-neutral-700 bg-neutral-800/50 cursor-pointer hover:border-neutral-600 transition-colors">
                      <input
                        type="checkbox"
                        checked={convertToFs}
                        onChange={() => setConvertToFs((prev) => !prev)}
                        className="mt-0.5 h-4 w-4 accent-amber-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-neutral-200">
                          Convert input to FreeSurfer space
                        </div>
                        <div className="text-xs text-neutral-400 mt-0.5">
                          Check this if your input is in native space and needs to be converted.
                          Leave unchecked if your input is already in FreeSurfer space.
                        </div>
                      </div>
                    </label>
                  )}
                </div>

                {/* File Upload */}
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                    Upload NIfTI volume
                  </p>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
                      dragOver
                        ? "border-amber-500 bg-amber-500/10"
                        : selectedFile
                        ? "border-green-500/50 bg-green-500/5"
                        : "border-neutral-700 hover:border-neutral-500"
                    }`}
                  >
                    <input
                      type="file"
                      accept=".nii,.nii.gz,.gz"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && (file.name.endsWith(".nii") || file.name.endsWith(".nii.gz"))) {
                          setSelectedFile(file);
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    {selectedFile ? (
                      <div className="text-sm text-green-400">
                        <span className="font-medium">{selectedFile.name}</span>
                        <p className="text-xs text-neutral-500 mt-1">
                          Click or drag to replace
                        </p>
                      </div>
                    ) : (
                      <div className="text-sm text-neutral-400">
                        <p className="font-medium">Drop your NIfTI file here</p>
                        <p className="text-xs text-neutral-500 mt-1">
                          or click to browse (.nii / .nii.gz)
                        </p>
                      </div>
                    )}
                  </div>
                  {!selectedFile && (
                    <p className="mt-2 text-xs text-amber-300">
                      A de-identified T1-weighted .nii or .nii.gz file is required.
                    </p>
                  )}
                </div>

                {/* Models */}
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                    Models to run in {selectedSpace === "native" ? "native" : "FreeSurfer"} space
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <label
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 cursor-pointer transition-colors ${
                        grace
                          ? "border-amber-500 bg-amber-500/15 text-amber-100"
                          : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={grace}
                        onChange={() => setGrace((prev) => !prev)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span className="font-medium">GRACE</span>
                    </label>

                    <label
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 cursor-pointer transition-colors ${
                        domino
                          ? "border-amber-500 bg-amber-500/15 text-amber-100"
                          : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={domino}
                        onChange={() => setDomino((prev) => !prev)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span className="font-medium">DOMINO</span>
                    </label>

                    <label
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 cursor-pointer transition-colors ${
                        dominopp
                          ? "border-amber-500 bg-amber-500/15 text-amber-100"
                          : "border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={dominopp}
                        onChange={() => setDominopp((prev) => !prev)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span className="font-medium">DOMINO++</span>
                    </label>
                  </div>
                  {!isAnyModelChecked && (
                    <p className="mt-2 text-xs text-amber-300">
                      Select at least one model to run.
                    </p>
                  )}
                </div>

                {/* Submit Button & Disclaimer */}
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[11px] text-neutral-500 space-y-1 max-w-xs">
                    <p>
                      Uploaded volumes are sent to the backend to compute
                      segmentations. They are not intended for direct clinical
                      decision-making.
                    </p>
                  </div>

                  <button
                    onClick={handleStart}
                    disabled={!canSubmit}
                    className={`font-semibold py-2.5 px-6 rounded-full text-sm shadow-md shadow-black/60 transition ${
                      canSubmit
                        ? "bg-amber-500 hover:bg-amber-400 text-neutral-950"
                        : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                    }`}
                  >
                    Run segmentation
                  </button>
                </div>
              </section>

              {/* RIGHT: Info Sidebar */}
              <aside className="space-y-4 text-sm text-neutral-400">
                <div className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300 mb-2">
                    Workflow
                  </h3>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                    <li>Choose the processing space: Native or FreeSurfer.</li>
                    <li>Upload a de-identified T1-weighted MRI NIfTI volume.</li>
                    <li>Select one or more segmentation models (GRACE / DOMINO).</li>
                    <li>
                      View predictions in the viewer and export labeled volumes from
                      the results page.
                    </li>
                  </ol>
                </div>

                <div className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4 text-xs">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300 mb-2">
                    Data & Privacy
                  </h3>
                  <p className="mb-1">
                    This tool is intended for research and development only. It
                    should be used with properly de-identified data and within the
                    scope of institutional approvals.
                  </p>
                </div>

                {/* GPU Status in sidebar */}
                <GPUStatus />
              </aside>
            </div>
          )}

          {/* QUEUED / RUNNING - Show viewer immediately with original image */}
          {status !== "idle" && status !== "complete" && inputBlobUrl && (
            <div className="space-y-6">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/80 p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.75)]">
                <SessionSummary />
                <ProgressPanel models={models} progress={progress} />
                <div className="mt-6">
                  <GPUStatus />
                </div>
              </div>

              {/* Viewer with original image while processing */}
              {sessionId && (
                <Viewer
                  inputUrl={inputBlobUrl}
                  sessionId={sessionId}
                  models={models}
                  progress={progress}
                />
              )}
            </div>
          )}

          {/* COMPLETED */}
          {status === "complete" && viewerReady && inputBlobUrl && (
            <div className="space-y-6">
              <div className="rounded-3xl border border-neutral-800 bg-neutral-900/80 p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.75)]">
                <SessionSummary />
                <DownloadAll sessionId={sessionId!} models={models} />
              </div>

              <Viewer
                inputUrl={inputBlobUrl}
                sessionId={sessionId!}
                models={models}
                progress={progress}
              />

              <button
                onClick={handleReset}
                className="font-semibold py-2.5 px-6 rounded-full text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
              >
                New Job
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
