"use client";

import { ArrowLeft, ArrowRight, Brain, Boxes, Sparkles, Check } from "lucide-react";
import { useJob, Space, ModelSelection } from "@/context/JobContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SpaceOption {
  id: Space;
  name: string;
  description: string;
}

interface ModelOption {
  id: keyof ModelSelection;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const spaceOptions: SpaceOption[] = [
  {
    id: "native",
    name: "Native Space",
    description: "Segment directly in each subject's native anatomical space. Best for structural analysis.",
  },
  {
    id: "freesurfer",
    name: "FreeSurfer Space",
    description: "Use volumes aligned to FreeSurfer-derived space. Best for group comparisons.",
  },
];

const modelOptions: ModelOption[] = [
  {
    id: "grace",
    name: "GRACE",
    description: "Whole-head segmentation with extended tissue coverage",
    icon: <Brain className="h-5 w-5" />,
  },
  {
    id: "domino",
    name: "DOMINO",
    description: "Fast inference with efficient architecture",
    icon: <Boxes className="h-5 w-5" />,
  },
  {
    id: "dominopp",
    name: "DOMINO++",
    description: "Enhanced accuracy with improved tissue boundaries",
    icon: <Sparkles className="h-5 w-5" />,
  },
];

export default function ConfigureStep() {
  const {
    selectedSpace,
    setSelectedSpace,
    convertToFs,
    setConvertToFs,
    selectedModels,
    setSelectedModels,
    isAnyModelSelected,
    setCurrentStep,
    startJob,
    status,
  } = useJob();

  const handleModelToggle = (modelId: keyof ModelSelection) => {
    setSelectedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }));
  };

  const handleBack = () => {
    setCurrentStep(1);
  };

  const handleStart = async () => {
    if (isAnyModelSelected) {
      await startJob();
    }
  };

  const isLoading = status === "uploading";

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Configure Segmentation
        </h1>
        <p className="mt-2 text-foreground-secondary">
          Select processing space and models to run
        </p>
      </div>

      <div className="space-y-8">
        {/* Space Selection */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            Processing Space
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            {spaceOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelectedSpace(option.id)}
                className={cn(
                  "relative rounded-xl border-2 p-4 text-left transition-all duration-200",
                  selectedSpace === option.id
                    ? "border-accent bg-accent/5 accent-glow"
                    : "border-border hover:border-foreground-muted hover:bg-surface-elevated"
                )}
              >
                {/* Selected indicator */}
                {selectedSpace === option.id && (
                  <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check className="h-4 w-4" />
                  </div>
                )}

                <div className="pr-8">
                  <h3 className="font-medium text-foreground">{option.name}</h3>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* FreeSurfer conversion option */}
          {selectedSpace === "freesurfer" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background-secondary p-4 transition-colors hover:bg-surface-elevated">
              <input
                type="checkbox"
                checked={convertToFs}
                onChange={() => setConvertToFs(!convertToFs)}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent focus:ring-offset-background"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Convert input to FreeSurfer space
                </div>
                <div className="mt-0.5 text-xs text-foreground-muted">
                  Enable if your input is in native space and needs to be converted.
                  Leave unchecked if already in FreeSurfer space.
                </div>
              </div>
            </label>
          )}
        </div>

        {/* Model Selection */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            Models to Run
          </h2>

          <div className="grid gap-3 md:grid-cols-3">
            {modelOptions.map((option) => {
              const isSelected = selectedModels[option.id];

              return (
                <button
                  key={option.id}
                  onClick={() => handleModelToggle(option.id)}
                  className={cn(
                    "relative flex flex-col items-center rounded-xl border-2 p-4 text-center transition-all duration-200",
                    isSelected
                      ? "border-accent bg-accent/5 accent-glow"
                      : "border-border hover:border-foreground-muted hover:bg-surface-elevated"
                  )}
                >
                  {/* Checkbox indicator */}
                  <div
                    className={cn(
                      "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded border-2 transition-colors",
                      isSelected
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border bg-background"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>

                  {/* Icon */}
                  <div
                    className={cn(
                      "mb-3 flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
                      isSelected
                        ? "bg-accent/10 text-accent"
                        : "bg-surface-elevated text-foreground-muted"
                    )}
                  >
                    {option.icon}
                  </div>

                  {/* Text */}
                  <h3 className="font-semibold text-foreground">{option.name}</h3>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>

          {!isAnyModelSelected && (
            <p className="mt-4 text-center text-sm text-warning">
              Select at least one model to continue
            </p>
          )}
        </div>

        {/* Info Card */}
        <div className="rounded-xl border border-border-subtle bg-background-secondary p-4">
          <h3 className="text-sm font-medium text-foreground">
            About Processing
          </h3>
          <p className="mt-1 text-sm text-foreground-secondary">
            Selected models will run sequentially on GPU. Results are available for
            download upon completion. All data is processed securely and not stored
            after your session ends.
          </p>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <Button variant="outline" size="lg" onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <Button
          variant="accent"
          size="lg"
          onClick={handleStart}
          disabled={!isAnyModelSelected || isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-foreground border-t-transparent" />
              Uploading...
            </>
          ) : (
            <>
              Start Segmentation
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
