"use client";

import { useJob, WizardStep } from "@/context/JobContext";
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
  } = useJob();

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
