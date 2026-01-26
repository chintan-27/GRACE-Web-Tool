"use client";

// ---------------------------------------------------------------------
// ENV
// ---------------------------------------------------------------------
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://10.15.224.253:8100";

// ---------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------
export interface PredictResponse {
  session_id: string;
  queue_position: number;
  models: string[];
  space: string;
}

export interface HealthResponse {
  redis: boolean;
  gpu_usage:
    | Array<{
        gpu: number;
        util: number;
        mem_used: number;
        mem_total: number;
      }>
    | string;
  queue_length: number;
  gpu_count: number;
}

export interface SSEEvent {
  type: "progress" | "complete" | "error";
  model?: string;
  progress?: number;
  message?: string;
}

// ---------------------------------------------------------------------
// POST /predict
// ---------------------------------------------------------------------
export async function startPrediction(
  file: File,
  models: string[],
  space: string
): Promise<PredictResponse> {
  console.log(models);
  console.log(space);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("space", space);

  if (models.length === 6) formData.append("models", "all");
  else formData.append("models", models.join(","));

  const res = await fetch(`${API_BASE}/predict`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let detail = "Failed to start job";
    try {
      const err = await res.json();
      detail = err.detail || detail;
    } catch {}
    throw new Error(detail);
  }

  return await res.json();
}

// ---------------------------------------------------------------------
// SSE → unified connectSSE wrapper
// ---------------------------------------------------------------------
export function connectSSE(
  sessionId: string,
  onEvent: (event: SSEEvent) => void,
  onDisconnect?: () => void
): EventSource {
  const evtSource = new EventSource(`${API_BASE}/stream/${sessionId}`);

  evtSource.onmessage = (e) => {
    try {
      const envelope = JSON.parse(e.data) as any;

      // Your backend sends { event: {...}, sig: "..." }
      const payload = envelope.event ?? envelope;

      // Map backend events -> UI events
      if (payload.event === "job_complete") {
        evtSource.close(); // Close gracefully to prevent onerror firing
        onEvent({ type: "complete" });
        return;
      }

      if (payload.event === "job_failed" || payload.event === "model_error") {
        onEvent({
          type: "error",
          message: payload.error || payload.detail || "Job failed",
        });
        return;
      }

      if (typeof payload.progress === "number" && payload.model) {
        onEvent({
          type: "progress",
          model: payload.model,
          progress: payload.progress,
        });
        return;
      }

      // ignore heartbeats/other events
    } catch (err) {
      console.error("Bad SSE message", err);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    onDisconnect?.();
  };

  return evtSource;
}

// ---------------------------------------------------------------------
// GET /results/{session}/{model}
// ---------------------------------------------------------------------
export async function getResult(
  sessionId: string,
  model: string
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/results/${sessionId}/${model}`);
  if (!res.ok) throw new Error(`Result not found for ${model}`);
  return await res.blob();
}

// ---------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------
export async function getHealth(): Promise<HealthResponse> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error("bad");
    return await res.json();
  } catch {
    return {
      redis: false,
      gpu_usage: [],
      queue_length: -1,
      gpu_count: 0,
    };
  }
}
