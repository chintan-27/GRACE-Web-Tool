"use client";

import { useEffect, useState } from "react";
import { useJob, WizardStep } from "@/context/JobContext";
import { restoreSession } from "@/lib/api";
import Stepper from "./Stepper";
import UploadStep from "./steps/UploadStep";
import ConfigureStep from "./steps/ConfigureStep";
import ProcessingStep from "./steps/ProcessingStep";
import ResultsStep from "./steps/ResultsStep";
import ErrorModal from "../ErrorModal";
import SkipLink from "../layout/SkipLink";

const stepTitles: Record<WizardStep, string> = {
  1: "Upload MRI Volume",
  2: "Configure Segmentation",
  3: "Processing",
  4: "View Results",
};

export default function WizardShell() {
  const {
    currentStep,
    setCurrentStep,
    canProceedToStep,
    error,
    setError,
    sseDisconnected,
    setSseDisconnected,
    restoreJobFromSession,
  } = useJob();

  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Detect ?restore=token on mount and load the session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("restore");
    if (!token) return;

    // Clean the URL immediately
    window.history.replaceState({}, "", "/");

    restoreSession(token)
      .then(({ session_id, models }) => {
        restoreJobFromSession(session_id, models);
      })
      .catch((err: unknown) => {
        setRestoreError(err instanceof Error ? err.message : "Restore link is invalid or has expired.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigation handlers
  const canNavigateTo = (step: WizardStep): boolean => {
    // Can always go back to completed steps
    if (step < currentStep) return true;
    // Can go forward if prerequisites are met
    return canProceedToStep(step);
  };

  const handleStepClick = (step: WizardStep) => {
    if (canNavigateTo(step)) {
      setCurrentStep(step);
    }
  };

  // Render current step content
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <UploadStep />;
      case 2:
        return <ConfigureStep />;
      case 3:
        return <ProcessingStep />;
      case 4:
        return <ResultsStep />;
      default:
        return <UploadStep />;
    }
  };

  return (
    <>
      {/* Skip Link for keyboard navigation */}
      <SkipLink />

      {/* Restore error banner */}
      {restoreError && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-400 flex items-center justify-center gap-2">
          <span>{restoreError}</span>
          <button onClick={() => setRestoreError(null)} className="underline underline-offset-2 hover:text-red-300">Dismiss</button>
        </div>
      )}

      {/* Error Modal */}
      <ErrorModal
        open={!!error || sseDisconnected}
        message={
          error ??
          "Connection to the server was lost. Attempting to reconnect..."
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

      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        {/* Stepper - sticky at top */}
        <nav
          aria-label="Segmentation workflow progress"
          className="sticky top-16 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        >
          <div className="container mx-auto px-4 py-4 md:px-6">
            <Stepper
              currentStep={currentStep}
              onStepClick={handleStepClick}
              canNavigateTo={canNavigateTo}
            />
          </div>
        </nav>

        {/* Step Content */}
        <main
          id="main-content"
          className="flex-1"
          role="main"
          aria-label={`Step ${currentStep}: ${stepTitles[currentStep]}`}
        >
          <div className="container mx-auto px-4 py-8 md:px-6 md:py-12">
            {/* Live region for step changes */}
            <div
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              Currently on step {currentStep} of 4: {stepTitles[currentStep]}
            </div>

            <div className="animate-fade-in">
              {renderStep()}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
