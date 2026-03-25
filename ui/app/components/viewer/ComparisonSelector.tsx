"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect, useId } from "react";

interface ComparisonSelectorProps {
  models: string[];
  selectedModel: string | null;
  onModelSelect: (model: string | null) => void;
  loadedModels: Record<string, boolean>;
  loadingModels?: Set<string>;
  panelId?: string;
}

export default function ComparisonSelector({
  models,
  selectedModel,
  onModelSelect,
  loadedModels,
  loadingModels = new Set(),
  panelId = "default",
}: ComparisonSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uniqueId = useId();
  const listboxId = `${panelId}-model-listbox-${uniqueId}`;
  const buttonId = `${panelId}-model-button-${uniqueId}`;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" && !isOpen) {
      e.preventDefault();
      setIsOpen(true);
    } else if (e.key === "Enter" || e.key === " ") {
      if (!isOpen) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
  };

  // Handle option keyboard navigation
  const handleOptionKeyDown = (e: React.KeyboardEvent, model: string | null, index: number, isDisabled: boolean) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isDisabled) {
        onModelSelect(model);
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const items = listRef.current?.querySelectorAll('[role="option"]:not([aria-disabled="true"])');
      if (items && index < items.length - 1) {
        (items[index + 1] as HTMLElement).focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const items = listRef.current?.querySelectorAll('[role="option"]:not([aria-disabled="true"])');
      if (items && index > 0) {
        (items[index - 1] as HTMLElement).focus();
      }
    }
  };

  const getDisplayName = (model: string): string => {
    return model
      .replace("-native", "")
      .replace("-fs", "")
      .toUpperCase();
  };

  const getSpaceLabel = (model: string): string => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FS";
    return "";
  };

  const selectedDisplay = selectedModel
    ? `${getDisplayName(selectedModel)} (${getSpaceLabel(selectedModel)})`
    : "Select model...";

  return (
    <div ref={dropdownRef} className="relative">
      <button
        ref={buttonRef}
        id={buttonId}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={`Select segmentation model for ${panelId} panel. Currently: ${selectedModel ? getDisplayName(selectedModel) : "none selected"}`}
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
          "border-border bg-surface text-foreground",
          "hover:bg-surface-elevated",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
          "min-w-[160px]"
        )}
      >
        <span className={cn(!selectedModel && "text-foreground-muted")}>
          {selectedDisplay}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-foreground-muted transition-transform",
            isOpen && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={buttonId}
          aria-activedescendant={selectedModel ? `${panelId}-option-${selectedModel}` : undefined}
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-[180px] rounded-lg border border-border bg-surface py-1 shadow-lg animate-scale-in"
        >
          {/* None option */}
          <li
            id={`${panelId}-option-none`}
            role="option"
            aria-selected={selectedModel === null}
            tabIndex={0}
            onClick={() => {
              onModelSelect(null);
              setIsOpen(false);
              buttonRef.current?.focus();
            }}
            onKeyDown={(e) => handleOptionKeyDown(e, null, 0, false)}
            className={cn(
              "flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-surface-elevated focus:bg-surface-elevated focus:outline-none",
              selectedModel === null && "bg-accent/10 text-accent"
            )}
          >
            <span className="text-foreground-muted">None (input only)</span>
          </li>

          <li role="separator" className="my-1 border-t border-border" aria-hidden="true" />

          {/* Model options */}
          {models.map((model, index) => {
            const isLoaded = loadedModels[model];
            const isLoading = loadingModels.has(model);
            const isSelected = selectedModel === model;

            return (
              <li
                key={model}
                id={`${panelId}-option-${model}`}
                role="option"
                aria-selected={isSelected}
                aria-busy={isLoading}
                tabIndex={0}
                onClick={() => {
                  onModelSelect(model);
                  setIsOpen(false);
                  buttonRef.current?.focus();
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, model, index + 1, false)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                  "cursor-pointer hover:bg-surface-elevated focus:bg-surface-elevated focus:outline-none",
                  isSelected && "bg-accent/10 text-accent"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{getDisplayName(model)}</span>
                  <span className="text-xs text-foreground-muted">
                    ({getSpaceLabel(model)})
                  </span>
                </div>
                {isLoading ? (
                  <span className="text-xs text-warning" aria-label="Loading in progress">Loading...</span>
                ) : isLoaded ? (
                  <span className="text-xs text-success" aria-label="Cached">Cached</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
