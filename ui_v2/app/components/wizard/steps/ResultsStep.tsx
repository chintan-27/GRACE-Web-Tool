"use client";

import { Download, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { useJob } from "@/context/JobContext";
import { Button } from "@/components/ui/button";
import SplitViewer from "../../viewer/SplitViewer";
import { API_BASE } from "@/lib/api";

export default function ResultsStep() {
  const { sessionId, models, inputBlobUrl, resetJob, selectedFile, error } = useJob();

  const handleDownload = (model: string) => {
    if (!sessionId) return;
    const url = `${API_BASE}/results/${sessionId}/${model}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${model}_segmentation.nii.gz`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = () => {
    models.forEach((model, index) => {
      // Stagger downloads to avoid browser blocking
      setTimeout(() => handleDownload(model), index * 200);
    });
  };

  const getDisplayName = (model: string): string => {
    return model
      .replace("-native", "")
      .replace("-fs", "")
      .toUpperCase();
  };

  const getSpaceLabel = (model: string): string => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FreeSurfer";
    return "";
  };

  // Show error state if there was a processing error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 max-w-2xl mx-auto">
        <div className="rounded-full bg-error/10 p-4 mb-4">
          <AlertTriangle className="h-8 w-8 text-error" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Processing Error
        </h2>
        <p className="text-foreground-secondary text-center mb-2">
          The segmentation job encountered an error:
        </p>
        <div className="bg-error/5 border border-error/20 rounded-lg p-4 mb-6 max-w-full overflow-auto">
          <code className="text-sm text-error whitespace-pre-wrap break-words">
            {error}
          </code>
        </div>
        <p className="text-foreground-muted text-sm text-center mb-6">
          This may be due to a GPU/CUDA compatibility issue on the server.
          Please contact support if the issue persists.
        </p>
        <Button variant="accent" onClick={resetJob}>
          Start New Segmentation
        </Button>
      </div>
    );
  }

  if (!sessionId || !inputBlobUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-foreground-secondary">No results available</p>
        <Button variant="accent" className="mt-4" onClick={resetJob}>
          Start New Segmentation
        </Button>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="rounded-full bg-warning/10 p-4 mb-4">
          <AlertTriangle className="h-8 w-8 text-warning" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          No Results Available
        </h2>
        <p className="text-foreground-secondary text-center mb-6">
          No segmentation models completed successfully. This may indicate a server-side issue.
        </p>
        <Button variant="accent" onClick={resetJob}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col items-center text-center md:flex-row md:items-start md:justify-between md:text-left">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm text-success">
            <Check className="h-4 w-4" />
            Segmentation Complete
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            View Results
          </h1>
          {selectedFile && (
            <p className="mt-2 text-foreground-secondary">
              {selectedFile.name}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-3 md:mt-0">
          <Button variant="outline" onClick={resetJob} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            New Segmentation
          </Button>
          <Button variant="accent" onClick={handleDownloadAll} className="gap-2">
            <Download className="h-4 w-4" />
            Download All
          </Button>
        </div>
      </div>

      {/* Split Viewer */}
      <SplitViewer
        inputUrl={inputBlobUrl}
        sessionId={sessionId}
        models={models}
      />

      {/* Download Cards */}
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Download Results
        </h2>

        <div className="grid gap-3 md:grid-cols-3">
          {models.map((model) => (
            <div
              key={model}
              className="flex items-center justify-between rounded-xl border border-success/30 bg-success/5 p-4"
            >
              <div>
                <h3 className="font-semibold text-foreground">
                  {getDisplayName(model)}
                </h3>
                <p className="text-xs text-foreground-muted">
                  {getSpaceLabel(model)} space
                </p>
              </div>
              <Button
                variant="success"
                size="sm"
                onClick={() => handleDownload(model)}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-border-subtle bg-background-secondary p-4">
        <h3 className="text-sm font-medium text-foreground">
          About Your Results
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
          <li>Results are in NIfTI format with FreeSurfer-compatible labels</li>
          <li>Use the split viewer above to compare different models</li>
          <li>Adjust overlay opacity to see underlying anatomy</li>
          <li>Session data will be automatically cleaned up after 24 hours</li>
        </ul>
      </div>
    </div>
  );
}
