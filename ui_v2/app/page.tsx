"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";

import FileUpload from "./components/FileUpload";
import ModelSelector from "./components/ModelSelector";
import SpaceSelector from "./components/SpaceSelector";
import GPUStatus from "./components/GPUStatus";
import ProgressPanel from "./components/ProgressPanel";
import SessionSummary from "./components/SessionSummary";
import DownloadAll from "./components/DownloadAll";
import Viewer from "./components/Viewer";
import ErrorModal from "./components/ErrorModal";

import { useJob } from "@/context/JobContext";

export default function HomePage() {
  const {
    startJob,
    resetJob,
    sessionId,
    models,
    space,
    progress,
    status,
    viewerReady,
    error,
    setError,
    sseDisconnected,
    setSseDisconnected,
  } = useJob();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<File | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedSpace, setSelectedSpace] = useState("native");

  const handleStart = async () => {
    if (!selectedFile) return alert("Please upload a NIfTI file.");
    if (!selectedModels.length) return alert("Please select at least one model.");

    await startJob(selectedFile, selectedModels, selectedSpace);
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

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8">

        {/* INITIAL UI */}
        {status === "idle" && (
          <>
            <FileUpload selectedFile={selectedFile} onFileSelect={setSelectedFile} />
            <ModelSelector selectedModels={selectedModels} onChange={setSelectedModels} />
            <SpaceSelector value={selectedSpace} onChange={setSelectedSpace} />

            <Button
              className="bg-blue-600 text-white dark:bg-blue-500 dark:hover:bg-blue-600"
              onClick={handleStart}
            >
              Start Processing
            </Button>

            <GPUStatus />
          </>
        )}

        {/* QUEUED / RUNNING */}
        {status !== "idle" && status !== "complete" && (
          <>
            <SessionSummary />
            <ProgressPanel models={models} progress={progress} />
            <GPUStatus />
          </>
        )}

        {/* COMPLETED */}
        {status === "complete" && viewerReady && (
          <div className="space-y-6">
            <SessionSummary />
            <DownloadAll sessionId={sessionId!} models={models} />
            <Viewer sessionId={sessionId!} models={models} />

            <Button
              className="mt-4 bg-gray-700 text-white dark:bg-gray-800"
              onClick={resetJob}
            >
              New Job
            </Button>
          </div>
        )}
      </main>
    </>
  );
}
