"use client";

import { useEffect, useRef, useState, useCallback, useId, useMemo } from "react";
import { Niivue, cmapper } from "@niivue/niivue";
import { AlertTriangle, Eye, Palette, Info, ZoomIn, MapPin } from "lucide-react";
import { getSimulationResult, getSimNIBSResult, type SimNIBSOutputType } from "@/lib/api";
import { COLORMAPS } from "./ViewerControls";
import type { ColormapId } from "./ViewerControls";
import { cn } from "@/lib/utils";

// Two fixed panels — primary ROAST scalar outputs (2D only)
const PANELS = [
  {
    type: "emag",
    label: "E-field Magnitude",
    unit: "V/m",
    description: "Electric field intensity in tissue",
    recommended: true,
    note: null,
  },
  {
    type: "voltage",
    label: "Voltage",
    unit: "mV",
    description: "Electric potential distribution",
    recommended: false,
    note: "Voltage appears nearly uniform inside brain tissue — the skull (high resistance) absorbs most of the potential drop. Use E-field Magnitude above to assess stimulation strength in the brain.",
  },
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
  const [colormap, setColormap]             = useState<ColormapId>("jet");
  const [colormapOpen, setColormapOpen]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [loadErrors, setLoadErrors]         = useState<Partial<Record<OutputType, string>>>({});
  const [calRanges, setCalRanges]           = useState<Partial<Record<OutputType, { min: number; max: number }>>>({});
  // When true, voltage colormap is clipped to the 5–99th percentile to reveal brain-tissue variation
  const [voltageZoomed, setVoltageZoomed]   = useState(false);

  // Electrode placement panel (ROAST only)
  const canvasElecRef   = useRef<HTMLCanvasElement>(null);
  const nvElecRef       = useRef<Niivue | null>(null);
  const [elecReady, setElecReady]           = useState(false);
  const [elecError, setElecError]           = useState(false);

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

  // Map ROAST panel types to equivalent SimNIBS output types
  const SIMNIBS_TYPE_MAP: Record<OutputType, SimNIBSOutputType> = {
    emag:    "magnJ",
    voltage: "wm_gm_magnJ",
  };

  const fetchOutput = useCallback(async (type: OutputType): Promise<ArrayBuffer | null> => {
    if (bufferCache.current[type]) return bufferCache.current[type]!;
    try {
      const blob = solver === "simnibs"
        ? await getSimNIBSResult(sessionId, modelName, SIMNIBS_TYPE_MAP[type])
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

    // Store physical range for the colorbar (0 → peak)
    setCalRanges(prev => ({ ...prev, [type]: { min: 0, max: calMax } }));

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

  // Electrode placement viewer (ROAST only) — runs once after main viewers init
  useEffect(() => {
    if (!initialized || solver === "simnibs" || nvElecRef.current || !canvasElecRef.current) return;
    let mounted = true;

    const initElec = async () => {
      const nv = new Niivue({
        show3Dcrosshair: true,
        isRadiologicalConvention: true,
        backColor:      [0, 0, 0, 1] as [number, number, number, number],
        crosshairColor: [1, 0, 0, 1] as [number, number, number, number],
      });
      nv.attachToCanvas(canvasElecRef.current!);
      nvElecRef.current = nv;

      // Load T1 base
      const resp = await fetch(inputUrl);
      if (!resp.ok || !mounted) return;
      const inputBuf = await resp.arrayBuffer();
      await nv.loadFromArrayBuffer(inputBuf.slice(0), "input.nii.gz");
      nv.setOpacity(0, 1.0);
      nv.setSliceType(nv.sliceTypeMultiplanar);

      // Sync crosshair / scroll with the main panels
      const mainNvs = nvRefs.current.filter(Boolean) as Niivue[];
      mainNvs.forEach(m => m.broadcastTo([...mainNvs.filter(x => x !== m), nv], { "2d": true, "3d": false }));
      nv.broadcastTo(mainNvs, { "2d": true, "3d": false });

      // Fetch both mask buffers
      const fetchMask = async (type: "mask_elec" | "mask_gel"): Promise<ArrayBuffer | null> => {
        try {
          const blob = await getSimulationResult(sessionId, modelName, type);
          const buf = await blob.arrayBuffer();
          return buf.byteLength > 0 ? buf : null;
        } catch { return null; }
      };

      const [elecBuf, gelBuf] = await Promise.all([fetchMask("mask_elec"), fetchMask("mask_gel")]);
      if (!mounted) return;

      if (!elecBuf && !gelBuf) { setElecError(true); return; }

      if (elecBuf) {
        await nv.loadFromArrayBuffer(elecBuf.slice(0), "mask_elec.nii");
        if (nv.volumes.length >= 2) {
          const vol = nv.volumes[1];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vol as any).colormapType = 1;
          vol.cal_min = 0.5;
          vol.cal_max = 1.0;
          nv.setColormap(vol.id, "hot");
          nv.setOpacity(1, 0.85);
        }
      }

      if (gelBuf) {
        await nv.loadFromArrayBuffer(gelBuf.slice(0), "mask_gel.nii");
        const gelIdx = nv.volumes.length - 1;
        if (gelIdx >= 2) {
          const vol = nv.volumes[gelIdx];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vol as any).colormapType = 1;
          vol.cal_min = 0.5;
          vol.cal_max = 1.0;
          nv.setColormap(vol.id, "winter");
          nv.setOpacity(gelIdx, 0.65);
        }
      }

      nv.drawScene();
      if (mounted) setElecReady(true);
    };

    initElec().catch(() => { if (mounted) setElecError(true); });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, inputUrl, sessionId, modelName, solver]);

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

  // Apply / remove brain-range zoom on the voltage panel (index 1 = voltage)
  const voltageNv = nvRefs.current[1];
  useEffect(() => {
    if (!initialized || !voltageNv || voltageNv.volumes.length < 2) return;
    const vol = voltageNv.volumes[1];
    const fullRange = calRanges["voltage"];
    if (!fullRange) return;

    if (voltageZoomed) {
      // Compute 5th–99th percentile of non-zero voxels to reveal brain variation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const img = (vol as any).img as Float32Array | undefined;
      if (img) {
        const nonzero = Array.from(img).filter((v: number) => v > 0).sort((a: number, b: number) => a - b);
        if (nonzero.length > 0) {
          const p05 = nonzero[Math.floor(nonzero.length * 0.05)];
          const p99 = nonzero[Math.floor(nonzero.length * 0.99)];
          vol.cal_min = p05;
          vol.cal_max = p99;
          setCalRanges(prev => ({ ...prev, voltage: { min: p05, max: p99 } }));
        }
      }
    } else {
      // Restore full range
      vol.cal_min = fullRange.min > 0 ? fullRange.max * 0.01 : fullRange.min;
      vol.cal_max = fullRange.max;
      setCalRanges(prev => ({ ...prev, voltage: { min: 0, max: fullRange.max } }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vol as any).colormapType = 1;
    voltageNv.updateGLVolume();
    voltageNv.drawScene();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voltageZoomed, initialized]);

  const currentColormap = COLORMAPS.find(c => c.id === colormap) ?? COLORMAPS[0];

  // Build a CSS linear-gradient string from a Niivue colormap LUT
  const colormapGradient = useMemo(() => {
    try {
      const lut = cmapper.colormap(colormap);
      // Sample 12 evenly-spaced stops from the 256-entry LUT
      const stops = Array.from({ length: 12 }, (_, i) => {
        const idx = Math.round((i / 11) * 255) * 4;
        return `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]}) ${Math.round((i / 11) * 100)}%`;
      });
      return `linear-gradient(to right, ${stops.join(", ")})`;
    } catch {
      return "linear-gradient(to right, #000, #fff)";
    }
  }, [colormap]);

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
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{panel.label}</h3>
                    {panel.recommended && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground-muted mt-0.5">{panel.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {panel.type === "voltage" && initialized && !loadErrors[panel.type] && (
                  <button
                    type="button"
                    onClick={() => setVoltageZoomed(v => !v)}
                    title={voltageZoomed ? "Reset to full range" : "Zoom colormap to brain-tissue range"}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                      voltageZoomed
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-background text-foreground-muted hover:border-accent/40 hover:text-foreground",
                    )}
                  >
                    <ZoomIn className="h-3 w-3" aria-hidden="true" />
                    {voltageZoomed ? "Zoomed" : "Zoom to brain"}
                  </button>
                )}
                <span className="text-xs font-mono text-foreground-muted bg-border/50 px-2 py-0.5 rounded">
                  {panel.unit}
                </span>
              </div>
            </header>

            {initialized && loadErrors[panel.type] ? (
              <div className="flex items-center gap-3 px-4 py-5 text-foreground-muted">
                <AlertTriangle className="h-4 w-4 shrink-0 text-foreground-muted/60" />
                <p className="text-sm">
                  {panel.label} output was not produced by the solver — only E-field magnitude is available.
                </p>
              </div>
            ) : (
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
              </div>
            )}

            {/* Scalar colorbar */}
            {initialized && !loadErrors[panel.type] && (
              <div className="px-4 py-3 border-t border-border bg-surface space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-10 text-right text-xs font-mono text-foreground-muted tabular-nums">
                    {calRanges[panel.type] ? calRanges[panel.type]!.min.toFixed(2) : "0.00"}
                  </span>
                  <div
                    className="flex-1 h-4 rounded"
                    style={{ background: colormapGradient }}
                    aria-label={`${panel.label} colormap scale`}
                  />
                  <span className="w-14 text-left text-xs font-mono text-foreground-muted tabular-nums">
                    {calRanges[panel.type]
                      ? `${calRanges[panel.type]!.max.toFixed(2)} ${panel.unit}`
                      : `— ${panel.unit}`}
                  </span>
                </div>
                {panel.note && (
                  <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
                    <p className="text-[11px] leading-snug text-foreground-muted">{panel.note}</p>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}

        {/* Electrode placement panel — ROAST only */}
        {solver !== "simnibs" && (
        <article className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
          <header className="border-b border-border px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 text-accent" aria-hidden="true" />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Electrode Placement</h3>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-[#ff6000]" />
                    Electrode rubber
                  </span>
                  <span className="mx-2">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-[#0080ff]" />
                    Gel layer
                  </span>
                </p>
              </div>
            </div>
            {!elecReady && !elecError && (
              <div className="flex items-center gap-2 text-xs text-foreground-muted">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Loading…
              </div>
            )}
          </header>

          {elecError ? (
            <div className="flex items-center gap-3 px-4 py-5 text-foreground-muted">
              <AlertTriangle className="h-4 w-4 shrink-0 text-foreground-muted/60" />
              <p className="text-sm">Electrode mask files not found — run the simulation to generate placement data.</p>
            </div>
          ) : (
            <div className="relative bg-black" style={{ height: "500px" }}>
              <canvas
                ref={canvasElecRef}
                width={512}
                height={512}
                style={{ width: "100%", height: "100%" }}
                aria-label="Electrode placement viewer"
              />
              {!elecReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    <span className="text-sm text-foreground-muted">Loading electrode masks…</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </article>
        )}
      </div>

      <p className="text-xs text-foreground-muted">
        Panels are scroll-synchronized. Results shown as overlay on T1 anatomy.
      </p>
    </section>
  );
}
