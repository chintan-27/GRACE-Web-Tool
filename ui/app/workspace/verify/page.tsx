"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/context/WorkspaceContext";
import { verifyMagicToken } from "@/lib/workspaceApi";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

function VerifyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login } = useWorkspace();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setErrorMsg("No sign-in token found in URL.");
      setStatus("error");
      return;
    }

    verifyMagicToken(token)
      .then(({ token: jwt, email, retention_days }) => {
        login(jwt, email, retention_days);
        setStatus("success");
        setTimeout(() => router.push("/workspace"), 1500);
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "Invalid or expired sign-in link");
        setStatus("error");
      });
  }, [searchParams, login, router]);

  return (
    <div className="container mx-auto max-w-md px-4 py-24 flex flex-col items-center text-center gap-4">
      {status === "loading" && (
        <>
          <Loader2 className="h-12 w-12 animate-spin text-accent" />
          <p className="text-sm text-foreground-muted">Verifying your sign-in link…</p>
        </>
      )}

      {status === "success" && (
        <>
          <CheckCircle className="h-12 w-12 text-green-500" />
          <h2 className="text-lg font-semibold text-foreground">Signed in!</h2>
          <p className="text-sm text-foreground-muted">Redirecting to your workspace…</p>
        </>
      )}

      {status === "error" && (
        <>
          <XCircle className="h-12 w-12 text-red-400" />
          <h2 className="text-lg font-semibold text-foreground">Sign-in failed</h2>
          <p className="text-sm text-foreground-muted">{errorMsg}</p>
          <Link
            href="/workspace"
            className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover transition-colors"
          >
            Request a new link
          </Link>
        </>
      )}
    </div>
  );
}

export default function WorkspaceVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto max-w-md px-4 py-24 flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-accent" />
          <p className="text-sm text-foreground-muted">Loading…</p>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
