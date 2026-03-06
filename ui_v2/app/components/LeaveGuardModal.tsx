"use client";

import { useState } from "react";
import { X, Mail, Trash2, ArrowLeft, Clock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestNotification, deleteSession } from "@/lib/api";

interface LeaveGuardModalProps {
  open: boolean;
  sessionId: string;
  filename?: string;
  /** Called when user chooses to stay on the page */
  onStay: () => void;
  /** Called after user has dealt with the session (leave + optionally delete) */
  onLeave: () => void;
}

type Step = "prompt" | "email" | "sent" | "delete_confirm";

export default function LeaveGuardModal({
  open,
  sessionId,
  filename,
  onStay,
  onLeave,
}: LeaveGuardModalProps) {
  const [step, setStep]       = useState<Step>("prompt");
  const [email, setEmail]     = useState("");
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!open) return null;

  const resetStep = () => { setStep("prompt"); setEmail(""); setEmailError(""); };

  const handleSendEmail = async () => {
    if (!email || !email.includes("@")) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setSending(true);
    setEmailError("");
    try {
      await requestNotification(sessionId, email, filename);
      setStep("sent");
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send — please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleDeleteAndLeave = async () => {
    setDeleting(true);
    try {
      await deleteSession(sessionId);
    } catch {
      // best-effort
    } finally {
      setDeleting(false);
      onLeave();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-guard-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl">

        {/* Close / Stay */}
        <button
          onClick={() => { resetStep(); onStay(); }}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-foreground-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Stay on page"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          {/* ── Prompt ─────────────────────────────────────────────── */}
          {step === "prompt" && (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15">
                  <Clock className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <h2 id="leave-guard-title" className="font-semibold text-foreground">
                    Your session is still active
                  </h2>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    Results are kept for 24 hours then auto-deleted
                  </p>
                </div>
              </div>

              <p className="text-sm text-foreground-secondary mb-6">
                If you leave now, your tDCS simulation may still be running. Your session and results
                are stored securely on our server and automatically deleted after <strong>24 hours</strong>.
              </p>

              <div className="space-y-2">
                <button
                  onClick={() => { resetStep(); onStay(); }}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-accent bg-accent/5 px-4 py-3 text-left transition-all hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4 text-accent shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Stay on this page</div>
                    <div className="text-xs text-foreground-muted">Continue monitoring your simulation</div>
                  </div>
                </button>

                <button
                  onClick={() => setStep("email")}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition-all hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <Mail className="h-4 w-4 text-accent shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Email me a restore link</div>
                    <div className="text-xs text-foreground-muted">Get notified with a 6-hour link to your results</div>
                  </div>
                </button>

                <button
                  onClick={() => setStep("delete_confirm")}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition-all hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <Trash2 className="h-4 w-4 text-error shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Delete my data &amp; leave</div>
                    <div className="text-xs text-foreground-muted">Immediately erase all uploaded files and results</div>
                  </div>
                </button>
              </div>
            </>
          )}

          {/* ── Email form ─────────────────────────────────────────── */}
          {step === "email" && (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
                  <Mail className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <h2 id="leave-guard-title" className="font-semibold text-foreground">
                    Email me a restore link
                  </h2>
                  <p className="text-xs text-foreground-muted mt-0.5">Link valid for 6 hours</p>
                </div>
              </div>

              <p className="text-sm text-foreground-secondary mb-4">
                Enter your email and we&apos;ll send you a link to access your results for the next 6 hours.
                Your data is still automatically deleted after 24 hours.
              </p>

              <div className="mb-4">
                <label htmlFor="restore-email" className="block text-xs font-medium text-foreground-muted mb-1.5">
                  Email address
                </label>
                <input
                  id="restore-email"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleSendEmail()}
                  placeholder="you@institution.edu"
                  className={cn(
                    "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground",
                    "placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-ring",
                    emailError ? "border-error" : "border-border",
                  )}
                />
                {emailError && (
                  <p className="mt-1 text-xs text-error">{emailError}</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("prompt")}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  Back
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending || !email}
                  className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {sending ? "Sending…" : "Send link & leave"}
                </button>
              </div>
            </>
          )}

          {/* ── Sent confirmation ──────────────────────────────────── */}
          {step === "sent" && (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15">
                  <ShieldCheck className="h-5 w-5 text-success" />
                </div>
                <div>
                  <h2 id="leave-guard-title" className="font-semibold text-foreground">Link sent!</h2>
                  <p className="text-xs text-foreground-muted mt-0.5">Check your inbox</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary mb-6">
                We&apos;ve sent a restore link to <strong>{email}</strong>. The link is valid for 6 hours and will
                take you directly back to your results.
              </p>
              <div className="rounded-lg border border-border-subtle bg-background-secondary p-3 text-xs text-foreground-muted mb-6">
                Your data is automatically deleted 24 hours after your session started. The email link will stop working at that point.
              </div>
              <button
                onClick={onLeave}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Leave page
              </button>
            </>
          )}

          {/* ── Delete confirm ─────────────────────────────────────── */}
          {step === "delete_confirm" && (
            <>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/15">
                  <Trash2 className="h-5 w-5 text-error" />
                </div>
                <div>
                  <h2 id="leave-guard-title" className="font-semibold text-foreground">
                    Delete your data?
                  </h2>
                  <p className="text-xs text-foreground-muted mt-0.5">This cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary mb-6">
                This will immediately erase your uploaded MRI, segmentation outputs, and all simulation results.
                This action <strong>cannot be undone</strong>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep("prompt")}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAndLeave}
                  disabled={deleting}
                  className="flex-1 rounded-lg bg-error px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {deleting ? "Deleting…" : "Delete & leave"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
