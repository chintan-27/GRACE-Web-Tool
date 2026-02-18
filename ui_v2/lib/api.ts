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
  gpu?: number;
}

// ---------------------------------------------------------------------
// POST /predict
// ---------------------------------------------------------------------
export async function startPrediction(
  file: File,
  models: string[],
  space: string,
  convertToFs: boolean = false
): Promise<PredictResponse> {
  console.log(models);
  console.log(space);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("space", space);
  formData.append("convert_to_fs", convertToFs ? "true" : "false");

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
          gpu: payload.gpu,
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
// GET /results/{session}/input
// ---------------------------------------------------------------------
export async function getInput(sessionId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/results/${sessionId}/input`);
  if (!res.ok) throw new Error("Input file not found");
  return await res.blob();
}

// ---------------------------------------------------------------------
// POST /simulate
// ---------------------------------------------------------------------
export interface SimulateResponse {
  session_id: string;
  status: "queued";
}

export async function startSimulation(
  sessionId: string,
  modelName: string,
  quality: "fast" | "standard" = "standard",
  recipe?: (string | number)[]
): Promise<SimulateResponse> {
  const body: Record<string, unknown> = { session_id: sessionId, model_name: modelName, quality };
  if (recipe) body.recipe = recipe;

  const res = await fetch(`${API_BASE}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "Failed to start simulation";
    try { const err = await res.json(); detail = err.detail || detail; } catch {}
    throw new Error(detail);
  }
  return await res.json();
}

// ---------------------------------------------------------------------
// SSE for ROAST /stream/roast/{session_id}
// ---------------------------------------------------------------------
export interface ROASTSSEEvent {
  type: "progress" | "complete" | "error";
  event?: string;
  progress?: number;
  detail?: string;
}

export function connectROASTSSE(
  sessionId: string,
  onEvent: (event: ROASTSSEEvent) => void,
  onDisconnect?: () => void
): EventSource {
  const evtSource = new EventSource(`${API_BASE}/stream/roast/${sessionId}`);

  evtSource.onmessage = (e) => {
    try {
      const envelope = JSON.parse(e.data) as any;
      const payload = envelope.event ?? envelope;

      if (payload.event === "roast_complete") {
        evtSource.close();
        onEvent({ type: "complete", progress: 100 });
        return;
      }
      if (payload.event === "roast_error") {
        evtSource.close();
        onEvent({ type: "error", detail: payload.detail || "Simulation failed" });
        return;
      }
      if (typeof payload.progress === "number") {
        onEvent({ type: "progress", event: payload.event, progress: payload.progress });
        return;
      }
    } catch {}
  };

  evtSource.onerror = () => {
    evtSource.close();
    onDisconnect?.();
  };

  return evtSource;
}

// ---------------------------------------------------------------------
// GET /simulate/results/{session}/{output_type}
// ---------------------------------------------------------------------
export async function getSimulationResult(
  sessionId: string,
  outputType: "voltage" | "efield" | "emag"
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/simulate/results/${sessionId}/${outputType}`);
  if (!res.ok) throw new Error(`Simulation result not found: ${outputType}`);
  return await res.blob();
}

// ---------------------------------------------------------------------
// GET /simulate/status/{session}
// ---------------------------------------------------------------------
export async function getSimulationStatus(sessionId: string): Promise<{ status: string; progress: number }> {
  const res = await fetch(`${API_BASE}/simulate/status/${sessionId}`);
  if (!res.ok) throw new Error("Failed to get simulation status");
  return await res.json();
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
