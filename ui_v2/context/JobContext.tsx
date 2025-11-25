"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
} from "react";

import {
  startPrediction,
  connectSSE,
  SSEEvent,
  PredictResponse,
  API_BASE,
} from "../lib/api";

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------
interface JobContextType {
  sessionId: string | null;
  models: string[];
  space: string;
  queuePosition: number | null;
  progress: Record<string, number>;
  status: "idle" | "uploading" | "queued" | "running" | "complete";
  viewerReady: boolean;

  // error + retry
  error: string | null;
  sseDisconnected: boolean;
  retryCount: number;

  // actions
  startJob: (file: File, models: string[], space: string) => Promise<void>;
  resetJob: () => void;

  // setters
  setError: (m: string | null) => void;
  setSseDisconnected: (v: boolean) => void;
}

const JobContext = createContext<JobContextType | null>(null);

// ------------------------------------------------------------
// PROVIDER
// ------------------------------------------------------------
export function JobProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [space, setSpace] = useState<string>("native");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<JobContextType["status"]>("idle");
  const [viewerReady, setViewerReady] = useState<boolean>(false);

  const [error, setError] = useState<string | null>(null);
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  // ------------------------------------------------------------
  // SSE SUBSCRIBE
  // ------------------------------------------------------------
  const subscribeToSSE = useCallback(
    (session: string) => {
      const backoff = Math.min(2000 * (retryCount + 1), 16000);

      connectSSE(
        session,
        (evt: SSEEvent) => {
          if (evt.type === "error") {
            setError(evt.message || "An unknown backend error occurred.");
            return;
          }

          if (evt.type === "progress" && evt.model) {
            setStatus("running");
            setProgress((prev) => ({
              ...prev,
              [evt.model!]: evt.progress ?? 0,
            }));
          }

          if (evt.type === "complete") {
            setViewerReady(true);
            setStatus("complete");
          }
        },
        () => {
          // onDisconnect
          setSseDisconnected(true);
          setRetryCount((c) => c + 1);

          setTimeout(() => {
            if (sessionId) subscribeToSSE(sessionId);
          }, backoff);
        }
      );
    },
    [sessionId, retryCount]
  );

  // ------------------------------------------------------------
  // START A NEW JOB
  // ------------------------------------------------------------
  const startJob = async (file: File, modelList: string[], sp: string) => {
    setStatus("uploading");

    const resp: PredictResponse = await startPrediction(file, modelList, sp);

    setSessionId(resp.session_id);
    setModels(resp.models);
    setSpace(resp.space);
    setQueuePosition(resp.queue_position);

    setStatus("queued");
    setProgress({});
    setViewerReady(false);
    setRetryCount(0);
    setError(null);
    setSseDisconnected(false);

    subscribeToSSE(resp.session_id);
  };

  // ------------------------------------------------------------
  // RESET JOB COMPLETELY
  // ------------------------------------------------------------
  const resetJob = () => {
    setSessionId(null);
    setModels([]);
    setSpace("native");
    setQueuePosition(null);
    setProgress({});
    setStatus("idle");
    setViewerReady(false);
    setError(null);
    setRetryCount(0);
    setSseDisconnected(false);
  };

  return (
    <JobContext.Provider
      value={{
        sessionId,
        models,
        space,
        queuePosition,
        progress,
        status,
        viewerReady,

        error,
        sseDisconnected,
        retryCount,

        startJob,
        resetJob,
        setError,
        setSseDisconnected,
      }}
    >
      {children}
    </JobContext.Provider>
  );
}

export function useJob() {
  const c = useContext(JobContext);
  if (!c) throw new Error("useJob() must be used inside <JobProvider>");
  return c;
}
