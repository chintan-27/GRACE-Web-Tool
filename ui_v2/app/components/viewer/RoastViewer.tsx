"use client";

import { useEffect, useRef, useState, useCallback, useId } from "react";
import { Niivue } from "@niivue/niivue";
import { AlertTriangle, Eye, Palette } from "lucide-react";
import { getSimulationResult, getSimNIBSResult } from "@/lib/api";
import { COLORMAPS } from "./ViewerControls";
import type { ColormapId } from "./ViewerControls";
import { cn } from "@/lib/utils";

// Two fixed panels — primary ROAST scalar outputs (2D only)
const PANELS = [
  { type: "emag",    label: "E-field Magnitude", unit: "V/m", description: "Electric field intensity in tissue" },
  { type: "voltage", label: "Voltage",           unit: "mV",  description: "Electric potential distribution" },
] as const;

type OutputType = typeof PANELS[number]["type"];

const OPACITY_PRESETS = [0, 0.25, 0.5, 0.75, 1] as const;

interface RoastViewerProps {
  inputUrl: string;
  sessionId: string;
  modelName: string;
  solver?: "roast" | "simnibs";
}

export default function RoastViewer({ inputUrl, sessionId, modelName, solver = "roast" }: RoastViewerProps) {
  const canvasRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const nvRefs = useRef<(Niivue | null)[]>([null, null]);

  const [initialized, setInitialized]       = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [colormap, setColormap]             = useState<ColormapId>("hot");
  const [colormapOpen, setColormapOpen]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [loadErrors, setLoadErrors]         = useState<Partial<Record<OutputType, string>>>({});

  const colormapDropRef = useRef<HTMLDivElement>(null);
  const bufferCache     = useRef<Partial<Record<OutputType, ArrayBuffer>>>({});
  const sliderId        = useId();

  // Close colormap dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colormapDropRef.current && !colormapDropRef.current.contains(e.target as Node))
        setColormapOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchOutput = useCallback(async (type: OutputType): Promise<ArrayBuffer | null> => {
    if (bufferCache.current[type]) return bufferCache.current[type]!;
    try {
      const blob = solver === "simnibs"
        ? await getSimNIBSResult(sessionId, modelName, type)
        : await getSimulationResult(sessionId, modelName, type);
      const buf  = await blob.arrayBuffer();
      bufferCache.current[type] = buf;
      return buf;
    } catch {
      return null;
    }
  }, [sessionId, modelName, solver]);

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

    const vol = nv.volumes[1];

    // Fix solid-box rendering: ROAST outputs have ~0 values in air (outside the head).
    // colormapType=1 (ZERO_TO_MAX_TRANSPARENT_BELOW_MIN) makes voxels below cal_min
    // fully transparent. We also push cal_min to 1% of max to guarantee air falls below it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vol as any).colormapType = 1;
    const calMax = (vol.cal_max ?? 0) as number;
    const calMin = (vol.cal_min ?? 0) as number;
    if (calMax > 0 && calMin <= 0) {
      vol.cal_min = calMax * 0.01;
    }

    nv.setColormap(vol.id, cmap); // calls updateGLVolume internally
    nv.setOpacity(1, opacity);
    nv.drawScene();
    return true;
  }, [fetchOutput]);

  // Initialise both viewers (2D multiplanar only)
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

      // Load T1 into both panels
      const resp = await fetch(inputUrl);
      if (!resp.ok) throw new Error("Failed to fetch input image");
      const inputBuf = await resp.arrayBuffer();
      for (const nv of nvs) {
        await nv.loadFromArrayBuffer(inputBuf.slice(0), "input.nii.gz");
        nv.setOpacity(0, 1.0);
        nv.setSliceType(nv.sliceTypeMultiplanar); // 2D only
      }

      // Sync scroll/crosshair between panels
      nvs[0].broadcastTo([nvs[1]], { "2d": true, "3d": false });
      nvs[1].broadcastTo([nvs[0]], { "2d": true, "3d": false });

      if (!mounted) return;
      setInitialized(true);

      setLoading(true);
      const results = await Promise.allSettled(
        PANELS.map((panel, i) => loadOverlay(nvs[i], panel.type, overlayOpacity, colormap))
      );
      const errs: Partial<Record<OutputType, string>> = {};
      results.forEach((r, i) => {
        if (r.status === "rejected" || (r.status === "fulfilled" && !r.value))
          errs[PANELS[i].type] = "Failed to load";
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

  // Sync colormap (re-apply transparent-below-min after each change)
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

      {/* Compact controls bar — colormap + opacity only (no 3D toggle) */}
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

      {/* Full-width stacked panels */}
      <div className="flex flex-col gap-4">
        {PANELS.map((panel, i) => (
          <article key={panel.type} className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
            <header className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{panel.label}</h3>
                <p className="text-xs text-foreground-muted mt-0.5">{panel.description}</p>
              </div>
              <span className="text-xs font-mono text-foreground-muted bg-border/50 px-2 py-0.5 rounded">
                {panel.unit}
              </span>
            </header>

            <div className="relative bg-black" style={{ height: "500px" }}>
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
                    <span className="text-sm text-foreground-muted">Initializing viewer...</span>
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
        Panels are scroll-synchronized. Results shown as overlay on T1 anatomy.
      </p>
    </section>
  );
}
