"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { NVImage } from "@niivue/niivue";
import pako from "pako";
import crypto from "crypto";
import { SignJWT } from "jose";
import NiiVueComponent from "../components/niivue";

const Trial = () => {
  const searchParams = useSearchParams();
  const fileUrl = searchParams.get("file") || "";
  const grace = searchParams.get("grace") === "true";
  const domino = searchParams.get("domino") === "true";
  const dominopp = searchParams.get("dominopp") === "true";
  const space =
    (searchParams.get("space") as "native" | "freesurfer" | null) || "native";

  const modelCount = [grace, domino, dominopp].filter(Boolean).length;

  // Image + loading state
  const [image, setImage] = useState<NVImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGz, setIsGz] = useState(false);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);

  // Progress state
  const [graceProgress, setGraceProgress] = useState({
    message: "Setting up the connection to the server",
    progress: 0,
  });
  const [dominoProgress, setDominoProgress] = useState({
    message: "Setting up the connection to the server",
    progress: 0,
  });
  const [dppProgress, setDppProgress] = useState({
    message: "",
    progress: 0,
  });

  // Inference results
  const [ginferenceResults, setgInferenceResults] = useState<NVImage | null>(
    null,
  );
  const [dinferenceResults, setdInferenceResults] = useState<NVImage | null>(
    null,
  );
  const [dppinferenceResults, setdppInferenceResults] =
    useState<NVImage | null>(null);

  const [messages, setMessages] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "done" | "error"
  >("idle");
  const [token, setToken] = useState<string>("");

  const startedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);

  const server = process.env.server || "https://flask.thecka.tech";
  const secret1 = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";
  const secret2 = process.env.NEXT_JWT_SECRET || "default_secret";

  // Get JWT
  useEffect(() => {
    (async () => {
      const ts = (Date.now() + 15 * 60 * 1000).toString();
      const signature = crypto.createHmac("sha256", secret1).update(ts).digest("hex");
      const key = new TextEncoder().encode(secret2);

      const jwt = await new SignJWT({ ts, signature })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("15m")
        .sign(key);
      setToken(jwt);
    })().catch((err) => console.error("JWT error:", err));
  }, [secret1, secret2]);

  // Load image from blob URL
  useEffect(() => {
    if (startedRef.current) return;
    if (!fileUrl) return;

    startedRef.current = true;
    setLoading(true);

    fetch(fileUrl)
      .then((res) => res.blob())
      .then(async (blob) => {
        const arr = new Uint8Array(await blob.arrayBuffer());
        const gzipped = arr[0] === 0x1f && arr[1] === 0x8b;
        setIsGz(gzipped);

        const file = gzipped
          ? new File([Uint8Array.from(pako.inflate(arr))], "uploaded_image.nii")
          : new File([blob], "uploaded_image.nii");

        setFileBlob(file);

        const nv = await NVImage.loadFromFile({ file, colormap: "gray" });
        setImage(nv);
        console.log("✅ Image loaded");
      })
      .catch((err) => console.error("❌ Load image error:", err))
      .finally(() => setLoading(false));
  }, [fileUrl]);

  // SSE: stream progress / messages
  useEffect(() => {
    // don’t run until we have both token and fileBlob
    if (!token || !fileBlob) return;
    // only open once
    if (esRef.current) return;

    setStatus("connecting");
    setMessages((prev) => [...prev, "[system] Connecting to streaming endpoint…"]);

    const es = new EventSource(
      `${server}/stream/${grace}/${domino}/${dominopp}/${token}`,
    );
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      setMessages((prev) => [
        ...prev,
        "[system] Connection established. Starting models…",
      ]);
    };

    es.onmessage = (e) => {
      try {
        const { model, message, progress, complete } = JSON.parse(e.data);

        if (complete) {
          setStatus("done");
          setMessages((prev) => [
            ...prev,
            "[system] All models finished processing.",
          ]);
          es.close();
          return;
        }

        if (model === "grace") {
          setGraceProgress({ message, progress });
          setMessages((prev) => [...prev, `[GRACE] ${message} (${progress}%)`]);
          if (progress === 100) {
            fetchGraceOutput();
          }
        } else if (model === "domino") {
          setDominoProgress({ message, progress });
          setMessages((prev) => [...prev, `[DOMINO] ${message} (${progress}%)`]);
          if (progress === 100) {
            fetchDominoOutput();
          }
        } else if (model === "dominopp") {
          setDppProgress({ message, progress });
          setMessages((prev) => [
            ...prev,
            `[DOMINO++] ${message} (${progress}%)`,
          ]);
          if (progress === 100) {
            // Add fetchDominoPPOutput() when you implement it
          }
        }
      } catch (err) {
        console.log("in on message");
        console.error("SSE error:", err);
        setMessages((prev) => [...prev, `⚠️ SSE parse error: ${String(err)}`]);

        if (grace) setGraceProgress({ message: e.data, progress: 0 });
        if (domino) setDominoProgress({ message: e.data, progress: 0 });
        if (dominopp) setDppProgress({ message: e.data, progress: 0 });
      }
    };

    es.onerror = (err) => {
      console.log("EventSource error occurred");
      if (status !== "done") {
        console.error("SSE error:", err);
        setStatus("error");
        setMessages((prev) => [
          ...prev,
          "[system] Connection error. Check backend logs.",
        ]);
      }
      es.close();
    };

    return () => {
      es.close();
    };
  }, [token, fileBlob, grace, domino, dominopp, server, status]);

  // Kick off predictions once connected
  useEffect(() => {
    if (status === "connected") {
      if (grace) {
        setGraceProgress({ message: "Starting GRACE…", progress: 0 });
        fetch(server + "/predict/grace", {
          method: "POST",
          headers: { "X-Signature": token },
          body: createFormData(),
        })
          .then((r) => {
            if (!r.ok) throw new Error(r.statusText);
          })
          .catch((err) =>
            setGraceProgress({ message: err.message, progress: 0 }),
          );
      }
      if (domino) {
        setDominoProgress({ message: "Starting DOMINO…", progress: 0 });
        fetch(server + "/predict/domino", {
          method: "POST",
          headers: { "X-Signature": token },
          body: createFormData(),
        })
          .then((r) => {
            if (!r.ok) throw new Error(r.statusText);
          })
          .catch((err) =>
            setDominoProgress({ message: err.message, progress: 0 }),
          );
      }
      if (dominopp) {
        setDppProgress({ message: "Starting DOMINO++…", progress: 0 });
        fetch(server + "/predict_dpp", {
          method: "POST",
          headers: { "X-Signature": token },
          body: createFormData(),
        })
          .then((r) => {
            if (!r.ok) throw new Error(r.statusText);
          })
          .catch((err) =>
            setDppProgress({ message: err.message, progress: 0 }),
          );
      }
    }
  }, [status]);

  // Helpers
  const createFormData = () => {
    const fd = new FormData();
    if (fileBlob) {
      fd.append(
        "file",
        fileBlob,
        fileBlob instanceof File ? fileBlob.name : "uploaded_image.nii",
      );
    }
    return fd;
  };

  const fetchGraceOutput = async () => {
    console.log("Fetching GRACE output…");
    const res = await fetch(server + "/output/grace", {
      method: "GET",
      headers: { "X-Signature": token },
    });
    if (!res.ok) {
      setGraceProgress({ message: res.statusText, progress: 0 });
      return;
    }
    const blob = await res.blob();
    const img = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "GraceInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setgInferenceResults(img);
    console.log("✅ GRACE output loaded");
  };

  const fetchDominoOutput = async () => {
    console.log("Fetching DOMINO output…");
    const res = await fetch(server + "/output/domino", {
      method: "GET",
      headers: { "X-Signature": token },
    });
    if (!res.ok) {
      setGraceProgress({ message: res.statusText, progress: 0 });
      return;
    }
    const blob = await res.blob();
    const img = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "DominoInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setdInferenceResults(img);
    console.log("✅ DOMINO output loaded");
  };

  // Status pills / helpers
  const statusLabel = () => {
    if (status === "idle") return "Idle";
    if (status === "connecting") return "Connecting";
    if (status === "connected") return "Streaming";
    if (status === "done") return "Completed";
    if (status === "error") return "Error";
    return status;
  };

  const statusColorClasses = () => {
    switch (status) {
      case "connecting":
        return "border-amber-500/60 bg-amber-500/10 text-amber-100";
      case "connected":
        return "border-emerald-500/60 bg-emerald-500/10 text-emerald-100";
      case "done":
        return "border-neutral-500/60 bg-neutral-500/10 text-neutral-100";
      case "error":
        return "border-red-500/60 bg-red-500/10 text-red-100";
      default:
        return "border-neutral-700 bg-neutral-900 text-neutral-200";
    }
  };

  const renderModelCard = (
    key: "grace" | "domino" | "dominopp",
    label: string,
    enabled: boolean,
    progressState: { message: string; progress: number },
  ) => {
    const { message, progress } = progressState;
    const isComplete = progress === 100;
    const isDisabled = !enabled;
    const baseColor =
      key === "grace"
        ? "text-emerald-200"
        : key === "domino"
          ? "text-amber-200"
          : "text-neutral-200";

    const pillText = isDisabled
      ? "Disabled"
      : status === "error"
        ? "Error"
        : isComplete
          ? "Completed"
          : status === "connected" || status === "connecting"
            ? "Running"
            : "Queued";

    return (
      <div
        key={key}
        className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3 text-xs space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-neutral-100 flex items-center gap-2">
            <span
              className={`uppercase tracking-wide text-[11px] ${baseColor}`}
            >
              {label}
            </span>
            {isDisabled && (
              <span className="text-[10px] text-neutral-500">
                (not selected)
              </span>
            )}
          </div>
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wide ${
              isComplete
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
                : isDisabled
                  ? "border-neutral-700 bg-neutral-900 text-neutral-400"
                  : status === "error"
                    ? "border-red-500/60 bg-red-500/10 text-red-100"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100"
            }`}
          >
            {pillText}
          </span>
        </div>
        <p className="font-mono text-[11px] text-neutral-400 min-h-[1.5rem]">
          {enabled ? message || "Waiting for updates…" : "Model not queued for this run."}
        </p>
        {enabled && (
          <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className={`h-full ${
                isComplete ? "bg-emerald-500" : "bg-amber-500"
              } transition-all duration-300`}
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const recentMessages = messages.slice(-20);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-neutral-50">
      {/* header / summary */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-1">
            Segmentation run
          </p>
          <h1 className="text-lg font-semibold text-neutral-50">
            {modelCount || 0} model{modelCount === 1 ? "" : "s"} on{" "}
            {space === "freesurfer" ? "FreeSurfer" : "native"} space
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            Live streaming from backend · JWT-signed session
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-wide ${statusColorClasses()}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "done"
                  ? "bg-emerald-400"
                  : status === "error"
                    ? "bg-red-400"
                    : status === "connected"
                      ? "bg-emerald-400 animate-pulse"
                      : status === "connecting"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-neutral-500"
              }`}
            />
            {statusLabel()}
          </span>
          <span className="text-[11px] text-neutral-500">
            {grace && "GRACE · "}
            {domino && "DOMINO · "}
            {dominopp && "DOMINO++ · "}
            JWT token generated client-side
          </span>
        </div>
      </div>

      {/* main layout: viewer + sidebar */}
      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr),minmax(0,1.1fr)] items-start">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6 flex items-center justify-center min-h-[320px]">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 rounded-full border-2 border-neutral-700 border-t-amber-400 animate-spin" />
              <p className="text-xs text-neutral-400">
                Loading your volume and preparing viewers…
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-6">
            <p className="text-xs text-neutral-400">
              Waiting for image to load. Once ready, real-time logs from the
              backend will appear here as each model progresses.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr),minmax(0,1.1fr)] items-start">
          <section className="rounded-3xl border border-neutral-800 bg-neutral-950/80 p-4 md:p-5 shadow-[0_18px_60px_rgba(0,0,0,0.8)]">
            {image ? (
              <NiiVueComponent
                image={image}
                inferredImages={{
                  grace: ginferenceResults,
                  domino: dinferenceResults,
                  dominopp: dppinferenceResults,
                }}
                selectedModels={{ grace, domino, dominopp }}
                progressMap={{
                  grace: graceProgress,
                  domino: dominoProgress,
                  dominopp: dppProgress,
                }}
              />
            ) : (
              <div className="flex h-[360px] items-center justify-center text-xs text-neutral-500">
                Failed to load volume. Check that the file is a valid NIfTI
                image.
              </div>
            )}
          </section>

          <aside className="space-y-4">
            {/* per-model status */}
            <div className="rounded-3xl border border-neutral-800 bg-neutral-950/90 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                  Model status
                </h2>
                <span className="text-[11px] text-neutral-500">
                  {modelCount || 0} active
                </span>
              </div>
              <div className="grid gap-3">
                {renderModelCard("grace", "GRACE", grace, graceProgress)}
                {renderModelCard("domino", "DOMINO", domino, dominoProgress)}
                {renderModelCard("dominopp", "DOMINO++", dominopp, dppProgress)}
              </div>
            </div>

            {/* "deployment" log */}
            <div className="rounded-3xl border border-neutral-800 bg-neutral-950/90 p-4 flex flex-col h-[260px]">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                  Live deployment log
                </h2>
                <span className="text-[10px] text-neutral-500">
                  {recentMessages.length} event
                  {recentMessages.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="relative flex-1 rounded-2xl bg-neutral-950 border border-neutral-900 overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-neutral-950 to-transparent pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-neutral-950 to-transparent pointer-events-none" />
                <div className="h-full overflow-y-auto px-3 py-3 space-y-1.5 text-[11px] font-mono text-neutral-400">
                  {recentMessages.length === 0 ? (
                    <p className="text-neutral-500">
                      Waiting for events… logs will appear here as the backend
                      sends updates.
                    </p>
                  ) : (
                    recentMessages.map((m, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="text-neutral-600">▍</span>
                        <span>{m}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default Trial;
