"use client";

import { Check, Upload, Settings, Loader2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { WizardStep } from "@/context/JobContext";

interface Step {
  id: WizardStep;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const steps: Step[] = [
  { id: 1, label: "Upload", icon: <Upload className="h-4 w-4" />, description: "Upload your MRI file" },
  { id: 2, label: "Configure", icon: <Settings className="h-4 w-4" />, description: "Select processing options" },
  { id: 3, label: "Processing", icon: <Loader2 className="h-4 w-4" />, description: "Segmentation in progress" },
  { id: 4, label: "Results", icon: <Eye className="h-4 w-4" />, description: "View and download results" },
];

interface StepperProps {
  currentStep: WizardStep;
  onStepClick?: (step: WizardStep) => void;
  canNavigateTo?: (step: WizardStep) => boolean;
}

export default function Stepper({
  currentStep,
  onStepClick,
  canNavigateTo,
}: StepperProps) {
  const getStepStatus = (stepId: WizardStep): "complete" | "current" | "upcoming" => {
    if (stepId < currentStep) return "complete";
    if (stepId === currentStep) return "current";
    return "upcoming";
  };

  const handleClick = (stepId: WizardStep) => {
    if (onStepClick && canNavigateTo && canNavigateTo(stepId) && stepId !== currentStep) {
      onStepClick(stepId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, stepId: WizardStep) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(stepId);
    }
  };

  return (
    <nav aria-label="Workflow steps">
      <ol
        className="flex items-center justify-center gap-2 md:gap-4"
        role="list"
      >
        {steps.map((step, index) => {
          const status = getStepStatus(step.id);
          const isClickable = canNavigateTo?.(step.id) && step.id !== currentStep;
          const isComplete = status === "complete";
          const isCurrent = status === "current";

          return (
            <li
              key={step.id}
              className="flex items-center"
              role="listitem"
            >
              {/* Step indicator */}
              <button
                onClick={() => handleClick(step.id)}
                onKeyDown={(e) => handleKeyDown(e, step.id)}
                disabled={!isClickable}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${step.id}: ${step.label}. ${step.description}. ${
                  isComplete ? "Completed" : isCurrent ? "Current step" : "Not yet available"
                }${isClickable ? ". Click to navigate." : ""}`}
                className={cn(
                  "group flex items-center gap-2 rounded-full px-3 py-2 md:px-4 md:py-2.5 transition-all duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                  // Complete state
                  isComplete && [
                    "bg-success/10 text-success",
                    isClickable && "cursor-pointer hover:bg-success/20",
                    !isClickable && "cursor-default",
                  ],
                  // Current state
                  isCurrent && [
                    "bg-accent text-accent-foreground shadow-sm shadow-accent/25",
                    "cursor-default",
                  ],
                  // Upcoming state
                  status === "upcoming" && [
                    "bg-surface text-foreground-muted",
                    isClickable && "cursor-pointer hover:bg-surface-elevated hover:text-foreground-secondary",
                    !isClickable && "cursor-not-allowed opacity-50",
                  ]
                )}
              >
                {/* Icon */}
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                    isComplete && "bg-success text-success-foreground",
                    isCurrent && "bg-accent-foreground/20",
                    status === "upcoming" && "bg-border"
                  )}
                  aria-hidden="true"
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : isCurrent && step.id === 3 ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    step.icon
                  )}
                </span>

                {/* Label (hidden on mobile) */}
                <span className="hidden text-sm font-medium md:block">
                  {step.label}
                </span>
              </button>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 w-8 md:w-12 rounded-full transition-colors",
                    step.id < currentStep ? "bg-success" : "bg-border"
                  )}
                  aria-hidden="true"
                  role="presentation"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Screen reader only: Current step description */}
      <p className="sr-only" role="status" aria-live="polite">
        You are on step {currentStep} of {steps.length}: {steps[currentStep - 1]?.description}
      </p>
    </nav>
  );
}
