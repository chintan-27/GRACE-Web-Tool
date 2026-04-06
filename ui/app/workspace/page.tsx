"use client";

import { useState, useEffect } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { requestMagicLink, getWorkspaceSessions, deleteWorkspaceAccount } from "@/lib/workspaceApi";
import { Loader2, Mail, Trash2, FolderOpen, AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sign-in form (anonymous user)
// ---------------------------------------------------------------------------

function SignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      await requestMagicLink(email.trim());
      setStatus("sent");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send link");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <h2 className="text-lg font-semibold text-foreground">Check your email</h2>
        <p className="text-sm text-foreground-muted max-w-sm">
          We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
        </p>
        <button
          onClick={() => setStatus("idle")}
          className="text-xs text-foreground-muted underline underline-offset-2"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={cn(
            "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm",
            "text-foreground placeholder:text-foreground-muted",
            "focus:outline-none focus:ring-2 focus:ring-ring"
          )}
        />
      </div>

      {status === "error" && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2",
          "text-sm font-medium text-accent-foreground",
          "transition-colors hover:bg-accent-hover disabled:opacity-60"
        )}
      >
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mail className="h-4 w-4" />
        )}
        Send sign-in link
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Workspace dashboard (logged-in user)
// ---------------------------------------------------------------------------

function WorkspaceDashboard() {
  const { user, logout } = useWorkspace();
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    getWorkspaceSessions(user.token)
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleDeleteAccount() {
    if (!user) return;
    setDeleting(true);
    try {
      await deleteWorkspaceAccount(user.token);
      logout();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete workspace");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Profile */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-xs text-foreground-muted mb-1">Signed in as</p>
        <p className="text-sm font-semibold text-foreground">{user?.email}</p>
        <p className="text-xs text-foreground-muted mt-1">
          Session retention: <strong>{user?.retention_days} days</strong>
        </p>
      </div>

      {/* Sessions */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Your sessions</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-foreground-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading...
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            No saved sessions yet.{" "}
            <Link href="/" className="text-accent underline underline-offset-2">
              Start a segmentation
            </Link>{" "}
            to create one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((sid) => (
              <li
                key={sid}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2"
              >
                <FolderOpen className="h-3.5 w-3.5 text-foreground-muted shrink-0" />
                <code className="text-xs text-foreground flex-1 truncate">{sid}</code>
                <Link
                  href={`/?session=${sid}`}
                  className="text-xs text-accent hover:underline underline-offset-2 shrink-0"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <h3 className="text-sm font-semibold text-red-400 flex items-center gap-1.5 mb-2">
          <AlertTriangle className="h-4 w-4" />
          Delete workspace
        </h3>
        <p className="text-xs text-foreground-muted mb-3">
          Permanently deletes your account and all session data. This cannot be undone.
        </p>
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete my workspace
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Confirm — delete everything
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="text-xs text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkspacePage() {
  const { isLoggedIn } = useWorkspace();

  return (
    <div className="container mx-auto max-w-lg px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Workspace</h1>
        <p className="text-sm text-foreground-muted">
          {isLoggedIn
            ? "Manage your saved sessions and account."
            : "Sign in to save your sessions for longer and access them from any device."}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-medical-lg">
        {isLoggedIn ? <WorkspaceDashboard /> : <SignInForm />}
      </div>

      {!isLoggedIn && (
        <p className="mt-4 text-center text-xs text-foreground-muted">
          No account needed to use CROWN. Sign in only if you want longer session retention.
        </p>
      )}
    </div>
  );
}
