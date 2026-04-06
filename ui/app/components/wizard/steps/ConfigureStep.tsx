"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Boxes, Sparkles, Check, Bell } from "lucide-react";
import { useJob, Space, ModelSelection } from "@/context/JobContext";
import { useWorkspace } from "@/context/WorkspaceContext";
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
    id: "freesurfer",
    name: "FreeSurfer Space",
    description: "The space our models are trained on — produces the most accurate segmentations. Your MRI is conformed to 1mm isotropic resolution before processing.",
  },
  {
    id: "native",
    name: "Native Space",
    description: "Segment directly in your MRI's original coordinate space, skipping the FreeSurfer conformation step. Faster, but may reduce accuracy.",
  },
];

const modelOptions: ModelOption[] = [
  {
    id: "grace",
    name: "GRACE",
    description: "Fast accurate whole-head segmentation",
    icon: <Brain className="h-5 w-5" />,
  },
  {
    id: "domino",
    name: "DOMINO",
    description: "Domain-aware model calibration",
    icon: <Boxes className="h-5 w-5" />,
  },
  {
    id: "dominopp",
    name: "DOMINO++",
    description: "Robust calibration under domain shift",
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

  const { user, isLoggedIn } = useWorkspace();
  const [notifyEmail, setNotifyEmail] = useState("");

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
      await startJob({
        notifyEmail: isLoggedIn ? (user?.email ?? "") : notifyEmail,
        workspaceJwt: user?.token,
      });
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
          <h2 className="mb-4 text-[10px] font-bold uppercase tracking-widest font-mono text-accent">
            // Processing Space
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-mono font-semibold tracking-wide text-foreground">{option.name}</h3>
                    {option.id === "freesurfer" && (
                      <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-accent font-mono">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* FreeSurfer conversion option */}
          {selectedSpace === "freesurfer" && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border-2 border-accent/40 bg-accent/5 p-4 transition-colors hover:bg-accent/10">
              <input
                type="checkbox"
                checked={convertToFs}
                onChange={() => setConvertToFs(!convertToFs)}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent focus:ring-offset-background"
              />
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Convert input to FreeSurfer space
                </div>
                <div className="mt-1 text-xs font-semibold text-accent">
                  If you have not run FreeSurfer on this MRI, keep this checked.
                </div>
                <div className="mt-0.5 text-xs text-foreground-muted">
                  Uncheck only if your MRI has already been conformed to FreeSurfer space (e.g. output of <code className="font-mono">mri_convert --conform</code>).
                </div>
              </div>
            </label>
          )}
        </div>

        {/* Model Selection */}
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical">
          <h2 className="mb-4 text-[10px] font-bold uppercase tracking-widest font-mono text-accent">
            // Models to Run
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
                  <h3 className="font-mono font-bold tracking-widest text-foreground">{option.name}</h3>
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
          <h3 className="text-[10px] font-bold uppercase tracking-widest font-mono text-accent mb-2">
            // Pipeline Info
          </h3>
          <p className="text-sm text-foreground-secondary">
            Selected models will run sequentially on GPU. Results are available for
            download upon completion. All data is processed securely and not stored
            after your session ends.
          </p>
        </div>
      </div>

      {/* Notify email */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-medical">
        <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest font-mono text-accent flex items-center gap-1.5">
          <Bell className="h-3 w-3" />
          // Notify on Completion
        </h2>
        {isLoggedIn && user ? (
          <p className="text-sm text-foreground-secondary">
            We'll email <strong className="text-foreground">{user.email}</strong> when your job finishes.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="notify-email" className="text-xs text-foreground-muted">
              Email address <span className="text-foreground-muted">(optional)</span>
            </label>
            <input
              id="notify-email"
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="you@example.com"
              className={cn(
                "w-full max-w-xs rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm",
                "text-foreground placeholder:text-foreground-muted",
                "focus:outline-none focus:ring-2 focus:ring-ring"
              )}
            />
          </div>
        )}
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
