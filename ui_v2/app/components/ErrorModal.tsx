"use client";

import { AlertTriangle, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  message: string;
  onRetry: () => void;
  onClose: () => void;
}

export default function ErrorModal({ open, message, onRetry, onClose }: Props) {
  if (!open) return null;

  const isDisconnect =
    message.toLowerCase().includes("connection") ||
    message.toLowerCase().includes("reconnect");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface shadow-medical-lg">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border p-5">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              isDisconnect ? "bg-warning/10 text-warning" : "bg-error/10 text-error"
            )}
          >
            {isDisconnect ? (
              <WifiOff className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
              // {isDisconnect ? "Connection Lost" : "Runtime Error"}
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-foreground">
              {isDisconnect
                ? "Server connection interrupted"
                : "Something went wrong"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message */}
        <div className="p-5">
          <pre className="overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground-secondary whitespace-pre-wrap break-words">
            {message}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          <Button variant="accent" size="sm" onClick={onRetry}>
            {isDisconnect ? "Reconnect" : "Retry"}
          </Button>
        </div>
      </div>
    </div>
  );
}
