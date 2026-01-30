"use client";

import { useState, useCallback, useId } from "react";
import { Upload, FileCheck, AlertCircle, ArrowRight, X, ShieldAlert } from "lucide-react";
import { useJob } from "@/context/JobContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function UploadStep() {
  const { selectedFile, setSelectedFile, setCurrentStep } = useJob();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputId = useId();
  const errorId = useId();
  const descriptionId = useId();

  const validateFile = (file: File): boolean => {
    const isValidExtension =
      file.name.endsWith(".nii") || file.name.endsWith(".nii.gz");

    if (!isValidExtension) {
      setError("Please upload a NIfTI file (.nii or .nii.gz)");
      return false;
    }

    // Optional: Check file size (e.g., max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      setError("File size must be less than 500MB");
      return false;
    }

    setError(null);
    return true;
  };

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file);
      }
    },
    [setSelectedFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setError(null);
  };

  const handleContinue = () => {
    if (selectedFile) {
      setCurrentStep(2);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle keyboard for drop zone
  const handleDropZoneKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      document.getElementById(fileInputId)?.click();
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Important Disclaimer Alert */}
      <div
        className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4"
        role="alert"
      >
        <div className="flex gap-3">
          <ShieldAlert className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-warning">Important Notice</p>
            <p className="text-foreground-secondary">
              This tool is for <strong>research and prototyping only</strong> and does not provide medical advice, diagnosis, or treatment.
            </p>
            <p className="text-foreground-secondary">
              Upload only <strong>de-identified MRI data</strong>. Ensure your use complies with all applicable ethics, privacy, and data governance requirements.
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Upload MRI Volume
        </h1>
        <p className="mt-2 text-foreground-secondary" id={descriptionId}>
          Upload a de-identified T1-weighted MRI scan in NIfTI format
        </p>
      </header>

      {/* Upload Card */}
      <section
        className="rounded-2xl border border-border bg-surface p-6 shadow-medical md:p-8"
        aria-labelledby="upload-section-title"
      >
        <h2 id="upload-section-title" className="sr-only">
          File Upload Area
        </h2>

        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onKeyDown={handleDropZoneKeyDown}
          tabIndex={0}
          role="button"
          aria-describedby={`${descriptionId} ${error ? errorId : ""}`}
          aria-label={selectedFile ? `Selected file: ${selectedFile.name}. Press Enter to choose a different file.` : "Click or drag and drop to upload a NIfTI file"}
          aria-invalid={!!error}
          className={cn(
            "relative rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 cursor-pointer",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            dragOver && "border-accent bg-accent/5",
            selectedFile && !error && "border-success bg-success/5",
            error && "border-error bg-error/5",
            !dragOver && !selectedFile && !error && "border-border hover:border-foreground-muted hover:bg-surface-elevated"
          )}
        >
          <input
            id={fileInputId}
            type="file"
            accept=".nii,.nii.gz,.gz"
            onChange={handleInputChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-describedby={descriptionId}
          />

          {/* Icon */}
          <div
            className={cn(
              "mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full",
              dragOver && "bg-accent/10 text-accent",
              selectedFile && !error && "bg-success/10 text-success",
              error && "bg-error/10 text-error",
              !dragOver && !selectedFile && !error && "bg-surface-elevated text-foreground-muted"
            )}
            aria-hidden="true"
          >
            {selectedFile && !error ? (
              <FileCheck className="h-8 w-8" />
            ) : error ? (
              <AlertCircle className="h-8 w-8" />
            ) : (
              <Upload className="h-8 w-8" />
            )}
          </div>

          {/* Text */}
          {selectedFile && !error ? (
            <div>
              <p className="font-medium text-success">{selectedFile.name}</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {formatFileSize(selectedFile.size)}
              </p>
              <p className="mt-2 text-sm text-foreground-muted">
                Click or drag to replace
              </p>
            </div>
          ) : error ? (
            <div>
              <p className="font-medium text-error" id={errorId} role="alert">
                {error}
              </p>
              <p className="mt-2 text-sm text-foreground-muted">
                Click or drag to try again
              </p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-foreground">
                Drop your NIfTI file here
              </p>
              <p className="mt-1 text-sm text-foreground-muted">
                or click to browse
              </p>
              <p className="mt-3 text-xs text-foreground-muted">
                Supported formats: .nii, .nii.gz
              </p>
            </div>
          )}
        </div>

        {/* Selected File Actions */}
        {selectedFile && !error && (
          <div
            className="mt-4 flex items-center justify-between rounded-lg bg-success/5 px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <FileCheck className="h-5 w-5 text-success" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-foreground-muted">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            <button
              onClick={handleRemoveFile}
              aria-label={`Remove file ${selectedFile.name}`}
              className="rounded-lg p-2 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Info Box */}
        <aside
          className="mt-6 rounded-lg border border-border-subtle bg-background-secondary p-4"
          aria-labelledby="requirements-title"
        >
          <h3 id="requirements-title" className="text-sm font-medium text-foreground">
            File Requirements
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary list-disc list-inside">
            <li>T1-weighted MRI scan in NIfTI format</li>
            <li>De-identified (no PHI/PII)</li>
            <li>Maximum file size: 500MB</li>
          </ul>
        </aside>
      </section>

      {/* Continue Button */}
      <nav className="mt-8 flex justify-end" aria-label="Step navigation">
        <Button
          variant="accent"
          size="lg"
          onClick={handleContinue}
          disabled={!selectedFile || !!error}
          aria-describedby={!selectedFile ? "continue-hint" : undefined}
          className="gap-2"
        >
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        {!selectedFile && (
          <span id="continue-hint" className="sr-only">
            Upload a file to continue
          </span>
        )}
      </nav>
    </div>
  );
}
