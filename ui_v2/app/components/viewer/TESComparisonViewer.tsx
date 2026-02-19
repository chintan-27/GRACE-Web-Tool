"use client";

import { useEffect, useRef, useState, useCallback, useId } from "react";
import { Niivue } from "@niivue/niivue";
import { AlertTriangle, Eye, Palette } from "lucide-react";
import { getSimulationResult, getSimNIBSResult } from "@/lib/api";
import { COLORMAPS } from "./ViewerControls";
import type { ColormapId } from "./ViewerControls";
import { cn } from "@/lib/utils";

// Four panels: ROAST emag | SimNIBS emag | ROAST voltage | SimNIBS voltage
const PANELS = [
  { solver: "roast",   type: "emag",    label: "ROAST — E-field Magnitude",   unit: "V/m",  col: 0 },
  { solver: "simnibs", type: "emag",    label: "SimNIBS — E-field Magnitude", unit: "V/m",  col: 1 },
  { solver: "roast",   type: "voltage", label: "ROAST — Voltage",              unit: "mV",   col: 0 },
  { solver: "simnibs", type: "voltage", label: "SimNIBS — Voltage",            unit: "mV",   col: 1 },
] as const;

type PanelIdx = 0 | 1 | 2 | 3;

const OPACITY_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const;

interface TESComparisonViewerProps {
  inputUrl: string;
  sessionId: string;
}

export default function TESComparisonViewer({ inputUrl, sessionId }: TESComparisonViewerProps) {
  // One canvas per panel — 4 total
  const canvasRefs = [
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
  ];
  const nvRefs = useRef<(Niivue | null)[]>([null, null, null, null]);

  const [initialized, setInitialized]       = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [colormap, setColormap]             = useState<ColormapId>("hot");
  const [colormapOpen, setColormapOpen]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [loadErrors, setLoadErrors]         = useState<Partial<Record<PanelIdx, string>>>({});

  const colormapDropRef = useRef<HTMLDivElement>(null);
  const bufferCache     = useRef<Record<string, ArrayBuffer>>({});
  const sliderId        = useId();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colormapDropRef.current && !colormapDropRef.current.contains(e.target as Node))
        setColormapOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchOutput = useCallback(async (solver: "roast" | "simnibs", type: "emag" | "voltage"): Promise<ArrayBuffer | null> => {
    const key = `${solver}:${type}`;
    if (bufferCache.current[key]) return bufferCache.current[key];
    try {
      const blob = solver === "roast"
        ? await getSimulationResult(sessionId, type)
        : await getSimNIBSResult(sessionId, type);
      const buf = await blob.arrayBuffer();
      bufferCache.current[key] = buf;
      return buf;
    } catch {
      return null;
    }
  }, [sessionId]);

  const loadOverlay = useCallback(async (
    nv: Niivue,
    solver: "roast" | "simnibs",
    type: "emag" | "voltage",
    opacity: number,
    cmap: ColormapId,
  ): Promise<boolean> => {
    while (nv.volumes.length > 1) nv.removeVolumeByIndex(1);

    const buf = await fetchOutput(solver, type);
    if (!buf || buf.byteLength === 0) return false;

    await nv.loadFromArrayBuffer(buf.slice(0), `${solver}_${type}.nii.gz`);
    if (nv.volumes.length < 2) return false;

    const vol = nv.volumes[1];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vol as any).colormapType = 1; // ZERO_TO_MAX_TRANSPARENT_BELOW_MIN — keeps air voxels invisible
    const calMax = (vol.cal_max ?? 0) as number;
    const calMin = (vol.cal_min ?? 0) as number;
    if (calMax > 0 && calMin <= 0) {
      vol.cal_min = calMax * 0.01;
    }

    nv.setColormap(vol.id, cmap);
    nv.setOpacity(1, opacity);
    nv.drawScene();
    return true;
  }, [fetchOutput]);

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

      const nvs = canvasRefs.map((ref, i) => {
        const nv = new Niivue(opts);
        nv.attachToCanvas(ref.current!);
        nvRefs.current[i] = nv;
        return nv;
      });

      const resp = await fetch(inputUrl);
      if (!resp.ok) throw new Error("Failed to fetch input image");
      const inputBuf = await resp.arrayBuffer();
      for (const nv of nvs) {
        await nv.loadFromArrayBuffer(inputBuf.slice(0), "input.nii.gz");
        nv.setOpacity(0, 1.0);
        nv.setSliceType(nv.sliceTypeMultiplanar);
      }

      // Sync all four panels together
      nvs[0].broadcastTo([nvs[1], nvs[2], nvs[3]], { "2d": true, "3d": false });
      nvs[1].broadcastTo([nvs[0], nvs[2], nvs[3]], { "2d": true, "3d": false });
      nvs[2].broadcastTo([nvs[0], nvs[1], nvs[3]], { "2d": true, "3d": false });
      nvs[3].broadcastTo([nvs[0], nvs[1], nvs[2]], { "2d": true, "3d": false });

      if (!mounted) return;
      setInitialized(true);

      setLoading(true);
      const results = await Promise.allSettled(
        PANELS.map((p, i) => loadOverlay(nvs[i], p.solver, p.type, overlayOpacity, colormap))
      );
      const errs: Partial<Record<PanelIdx, string>> = {};
      results.forEach((r, i) => {
        if (r.status === "rejected" || (r.status === "fulfilled" && !r.value))
          errs[i as PanelIdx] = "Failed to load";
      });
      if (Object.keys(errs).length) setLoadErrors(errs);
      setLoading(false);
    };

    init().catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputUrl, initialized]);

  // Sync opacity
  useEffect(() => {
    if (!initialized) return;
    nvRefs.current.forEach(nv => {
      if (nv && nv.volumes.length > 1) { nv.setOpacity(1, overlayOpacity); nv.drawScene(); }
    });
  }, [overlayOpacity, initialized]);

  // Sync colormap
  useEffect(() => {
    if (!initialized) return;
    nvRefs.current.forEach(nv => {
      if (nv && nv.volumes.length > 1) {
        const vol = nv.volumes[1];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vol as any).colormapType = 1;
        nv.setColormap(vol.id, colormap);
        nv.drawScene();
      }
    });
  }, [colormap, initialized]);

  const currentColormap = COLORMAPS.find(c => c.id === colormap) ?? COLORMAPS[0];

  return (
    <section aria-label="ROAST vs SimNIBS Comparison Viewer" className="space-y-4">
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

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
        {/* Colormap */}
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-foreground-muted" />
          <span className="text-sm text-foreground-muted">Colors:</span>
          <div ref={colormapDropRef} className="relative">
            <button
              onClick={() => setColormapOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={colormapOpen}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="font-medium">{currentColormap.label}</span>
              <svg className={cn("h-4 w-4 transition-transform", colormapOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {colormapOpen && (
              <ul role="listbox" className="absolute left-0 top-full z-50 mt-1 max-h-60 w-48 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
                {COLORMAPS.map(cmap => (
                  <li
                    key={cmap.id}
                    role="option"
                    aria-selected={colormap === cmap.id}
                    onClick={() => { setColormap(cmap.id); setColormapOpen(false); }}
                    className={cn(
                      "cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-surface-elevated",
                      colormap === cmap.id && "bg-accent/10 text-accent"
                    )}
                  >
                    <div className="font-medium">{cmap.label}</div>
                    <div className="text-xs text-foreground-muted">{cmap.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Opacity */}
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-foreground-muted" />
          <span className="text-sm text-foreground-muted" id={`${sliderId}-label`}>Overlay:</span>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            {OPACITY_PRESETS.map(v => (
              <button
                key={v}
                onClick={() => setOverlayOpacity(v)}
                aria-pressed={Math.abs(overlayOpacity - v) < 0.01}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                  Math.abs(overlayOpacity - v) < 0.01
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground-secondary hover:text-foreground"
                )}
              >
                {Math.round(v * 100)}%
              </button>
            ))}
          </div>
          <input
            id={sliderId}
            type="range" min="0" max="1" step="0.05"
            value={overlayOpacity}
            onChange={e => setOverlayOpacity(parseFloat(e.target.value))}
            aria-labelledby={`${sliderId}-label`}
            className="h-2 w-24 cursor-pointer appearance-none rounded-lg bg-border accent-accent focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="w-10 text-right text-xs text-foreground-muted">{Math.round(overlayOpacity * 100)}%</span>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted ml-auto">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Loading outputs...
          </div>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center text-sm font-semibold text-foreground px-3 py-1.5 rounded-lg bg-surface border border-border">
          ROAST-11 <span className="text-xs font-normal text-foreground-muted">(GRACE seg)</span>
        </div>
        <div className="text-center text-sm font-semibold text-foreground px-3 py-1.5 rounded-lg bg-surface border border-border">
          SimNIBS <span className="text-xs font-normal text-foreground-muted">(charm seg)</span>
        </div>
      </div>

      {/* 2×2 panel grid */}
      {([0, 1] as const).map(row => (
        <div key={row} className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map(col => {
            const panelIdx = (row * 2 + col) as PanelIdx;
            const panel = PANELS[panelIdx];
            return (
              <article key={panelIdx} className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
                <header className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{panel.label}</h3>
                  <span className="text-xs font-mono text-foreground-muted bg-border/50 px-2 py-0.5 rounded">
                    {panel.unit}
                  </span>
                </header>

                <div className="relative bg-black" style={{ height: "400px" }}>
                  <canvas
                    ref={canvasRefs[panelIdx]}
                    width={512}
                    height={512}
                    style={{ width: "100%", height: "100%" }}
                    aria-label={`${panel.label} viewer`}
                  />
                  {!initialized && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                        <span className="text-sm text-foreground-muted">Initializing...</span>
                      </div>
                    </div>
                  )}
                  {initialized && loadErrors[panelIdx] && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="flex flex-col items-center gap-2 text-center px-4">
                        <AlertTriangle className="h-6 w-6 text-warning" />
                        <p className="text-sm text-foreground-muted">Could not load {panel.label}</p>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ))}

      <p className="text-xs text-foreground-muted">
        All panels are scroll-synchronized. Left: ROAST (uses GRACE segmentation) · Right: SimNIBS (uses charm segmentation).
      </p>
    </section>
  );
}
