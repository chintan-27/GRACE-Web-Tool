"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Niivue } from "@niivue/niivue";
import { AlertTriangle } from "lucide-react";
import { getSimulationResult } from "@/lib/api";
import ViewerControls from "./ViewerControls";
import type { ColormapId } from "./ViewerControls";

// All three ROAST output types shown simultaneously
const PANELS = [
  { type: "emag",    label: "E-field Magnitude", unit: "V/m",  description: "Electric field intensity" },
  { type: "voltage", label: "Voltage",           unit: "mV",   description: "Electric potential" },
  { type: "efield",  label: "E-field Vector",    unit: "V/m",  description: "Electric field direction" },
] as const;

type OutputType = typeof PANELS[number]["type"];

interface RoastViewerProps {
  inputUrl: string;
  sessionId: string;
}

export default function RoastViewer({ inputUrl, sessionId }: RoastViewerProps) {
  const canvasRefs = [
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
  ];
  const nvRefs = useRef<(Niivue | null)[]>([null, null, null]);

  const [initialized, setInitialized] = useState(false);
  const [viewMode, setViewMode]       = useState<"2d" | "3d">("2d");
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [colormap, setColormap]       = useState<ColormapId>("hot");
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [loadErrors, setLoadErrors]   = useState<Partial<Record<OutputType, string>>>({});

  const bufferCache = useRef<Partial<Record<OutputType, ArrayBuffer>>>({});

  const fetchOutput = useCallback(async (type: OutputType): Promise<ArrayBuffer | null> => {
    if (bufferCache.current[type]) return bufferCache.current[type]!;
    try {
      const blob = await getSimulationResult(sessionId, type);
      const buf  = await blob.arrayBuffer();
      bufferCache.current[type] = buf;
      return buf;
    } catch (e) {
      return null;
    }
  }, [sessionId]);

  const loadOverlay = useCallback(async (
    nv: Niivue,
    type: OutputType,
    opacity: number,
    cmap: ColormapId,
  ): Promise<boolean> => {
    while (nv.volumes.length > 1) nv.removeVolumeByIndex(1);

    const buf = await fetchOutput(type);
    if (!buf || buf.byteLength === 0) return false;

    await nv.loadFromArrayBuffer(buf.slice(0), `${type}.nii`);
    if (nv.volumes.length < 2) return false;

    nv.setColormap(nv.volumes[1].id, cmap);
    nv.setOpacity(1, opacity);
    nv.drawScene();
    return true;
  }, [fetchOutput]);

  // Initialise all three viewers
  useEffect(() => {
    if (initialized) return;
    if (canvasRefs.some(r => !r.current)) return;
    if (nvRefs.current[0]) { setInitialized(true); return; }

    let mounted = true;

    const init = async () => {
      await new Promise(r => setTimeout(r, 150));
      if (!mounted) return;

      const opts = {
        show3Dcrosshair: true,
        isRadiologicalConvention: true,
        backColor:      [0, 0, 0, 1] as [number, number, number, number],
        crosshairColor: [1, 0, 0, 1] as [number, number, number, number],
      };

      // Create all 3 Niivue instances
      const nvs = canvasRefs.map((ref, i) => {
        const nv = new Niivue(opts);
        nv.attachToCanvas(ref.current!);
        nvRefs.current[i] = nv;
        return nv;
      });

      // Load T1 into all panels
      const resp = await fetch(inputUrl);
      if (!resp.ok) throw new Error("Failed to fetch input image");
      const inputBuf = await resp.arrayBuffer();
      for (const nv of nvs) {
        await nv.loadFromArrayBuffer(inputBuf.slice(0), "input.nii.gz");
        nv.setOpacity(0, 1.0);
        nv.setSliceType(nv.sliceTypeMultiplanar);
      }

      // Sync all panels: each broadcasts to the other two
      nvs[0].broadcastTo([nvs[1], nvs[2]], { "2d": true, "3d": true });
      nvs[1].broadcastTo([nvs[0], nvs[2]], { "2d": true, "3d": true });
      nvs[2].broadcastTo([nvs[0], nvs[1]], { "2d": true, "3d": true });

      if (!mounted) return;
      setInitialized(true);

      // Load overlays in parallel
      setLoading(true);
      const results = await Promise.allSettled(
        PANELS.map((panel, i) => loadOverlay(nvs[i], panel.type, overlayOpacity, colormap))
      );
      const errs: Partial<Record<OutputType, string>> = {};
      results.forEach((r, i) => {
        if (r.status === "rejected" || (r.status === "fulfilled" && !r.value)) {
          errs[PANELS[i].type] = "Failed to load";
        }
      });
      if (Object.keys(errs).length) setLoadErrors(errs);
      setLoading(false);
    };

    init().catch(e => { if (mounted) setError(String(e)); });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputUrl, initialized]);

  // Sync view mode across all panels
  useEffect(() => {
    if (!initialized) return;
    nvRefs.current.forEach(nv => {
      if (!nv) return;
      nv.setSliceType(viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar);
      nv.drawScene();
    });
  }, [viewMode, initialized]);

  // Sync opacity across all panels
  useEffect(() => {
    if (!initialized) return;
    nvRefs.current.forEach(nv => {
      if (nv && nv.volumes.length > 1) { nv.setOpacity(1, overlayOpacity); nv.drawScene(); }
    });
  }, [overlayOpacity, initialized]);

  // Sync colormap across all panels
  useEffect(() => {
    if (!initialized) return;
    nvRefs.current.forEach(nv => {
      if (nv && nv.volumes.length > 1) {
        nv.setColormap(nv.volumes[1].id, colormap);
        nv.drawScene();
      }
    });
  }, [colormap, initialized]);

  return (
    <section aria-label="TES Simulation Viewer" className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border border-error/50 bg-error/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-error flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-medium text-error mb-1">Viewer error</h4>
            <p className="text-sm text-error/80">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-error/70 hover:text-error text-sm underline">Dismiss</button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4" role="toolbar">
        <ViewerControls
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          overlayOpacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          colormap={colormap}
          onColormapChange={setColormap}
        />
        {loading && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading simulation outputs...
          </div>
        )}
      </div>

      {/* Three panels — one per output type */}
      <div className="grid gap-4 md:grid-cols-3">
        {PANELS.map((panel, i) => (
          <article key={panel.type} className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
            <header className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{panel.label}</h3>
                <span className="text-xs font-mono text-foreground-muted bg-border/50 px-2 py-0.5 rounded">
                  {panel.unit}
                </span>
              </div>
              <p className="text-xs text-foreground-muted mt-0.5">{panel.description}</p>
            </header>

            <div className="relative bg-black" style={{ height: "380px" }}>
              <canvas
                ref={canvasRefs[i]}
                width={512}
                height={512}
                style={{ width: "100%", height: "100%" }}
                aria-label={`${panel.label} ROAST viewer`}
              />
              {!initialized && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    <span className="text-sm text-foreground-muted">Initializing...</span>
                  </div>
                </div>
              )}
              {initialized && loadErrors[panel.type] && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <div className="flex flex-col items-center gap-2 text-center px-4">
                    <AlertTriangle className="h-6 w-6 text-warning" />
                    <p className="text-sm text-foreground-muted">Could not load {panel.label}</p>
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="text-xs text-foreground-muted">
        All three simulation outputs shown as overlays on T1 anatomy. Panels are synchronized — scroll or rotate one to move all.
      </p>
    </section>
  );
}
