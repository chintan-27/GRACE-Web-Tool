"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Niivue } from "@niivue/niivue";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { getSimulationResult } from "@/lib/api";
import ViewerControls from "./ViewerControls";
import type { ColormapId } from "./ViewerControls";

type OutputType = "emag" | "voltage";

const OUTPUT_OPTIONS: { id: OutputType; label: string; description: string }[] = [
  { id: "emag",    label: "E-field Magnitude", description: "Electric field intensity (V/m)" },
  { id: "voltage", label: "Voltage",           description: "Electric potential (mV)" },
];

interface RoastViewerProps {
  inputUrl: string;
  sessionId: string;
}

export default function RoastViewer({ inputUrl, sessionId }: RoastViewerProps) {
  const leftCanvasRef  = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftNvRef  = useRef<Niivue | null>(null);
  const rightNvRef = useRef<Niivue | null>(null);

  const [initialized, setInitialized]   = useState(false);
  const [leftOutput, setLeftOutput]     = useState<OutputType>("emag");
  const [rightOutput, setRightOutput]   = useState<OutputType>("voltage");
  const [viewMode, setViewMode]         = useState<"2d" | "3d">("2d");
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [colormap, setColormap]         = useState<ColormapId>("hot");
  const [error, setError]               = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);

  const bufferCache = useRef<Partial<Record<OutputType, ArrayBuffer>>>({});

  const fetchOutput = useCallback(async (type: OutputType): Promise<ArrayBuffer | null> => {
    if (bufferCache.current[type]) return bufferCache.current[type]!;
    try {
      const blob = await getSimulationResult(sessionId, type);
      const buf  = await blob.arrayBuffer();
      bufferCache.current[type] = buf;
      return buf;
    } catch (e) {
      setError(`Failed to load ${type}: ${e}`);
      return null;
    }
  }, [sessionId]);

  const loadOverlay = useCallback(async (
    nv: Niivue | null,
    type: OutputType,
    opacity: number,
    cmap: ColormapId,
  ): Promise<boolean> => {
    if (!nv) return false;
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

  // Initialise viewers and load initial overlays
  useEffect(() => {
    if (initialized) return;
    if (!leftCanvasRef.current || !rightCanvasRef.current) return;
    if (leftNvRef.current || rightNvRef.current) { setInitialized(true); return; }

    let mounted = true;

    const init = async () => {
      await new Promise(r => setTimeout(r, 150));
      if (!mounted) return;

      const opts = {
        show3Dcrosshair: true,
        isRadiologicalConvention: true,
        backColor:       [0, 0, 0, 1] as [number, number, number, number],
        crosshairColor:  [1, 0, 0, 1] as [number, number, number, number],
      };

      const leftNv  = new Niivue(opts);
      const rightNv = new Niivue(opts);
      leftNv.attachToCanvas(leftCanvasRef.current!);
      rightNv.attachToCanvas(rightCanvasRef.current!);
      leftNvRef.current  = leftNv;
      rightNvRef.current = rightNv;

      // Load T1 to both panels
      const resp = await fetch(inputUrl);
      if (!resp.ok) throw new Error("Failed to fetch input image");
      const inputBuf = await resp.arrayBuffer();
      await leftNv.loadFromArrayBuffer(inputBuf.slice(0),  "input.nii.gz");
      await rightNv.loadFromArrayBuffer(inputBuf.slice(0), "input.nii.gz");

      leftNv.setOpacity(0, 1.0);
      rightNv.setOpacity(0, 1.0);

      const sliceType = leftNv.sliceTypeMultiplanar;
      leftNv.setSliceType(sliceType);
      rightNv.setSliceType(sliceType);

      leftNv.broadcastTo([rightNv], { "2d": true, "3d": true });
      rightNv.broadcastTo([leftNv], { "2d": true, "3d": true });

      if (!mounted) return;
      setInitialized(true);

      // Load initial overlays
      setLoading(true);
      await Promise.all([
        loadOverlay(leftNv,  "emag",    overlayOpacity, colormap),
        loadOverlay(rightNv, "voltage", overlayOpacity, colormap),
      ]);
      setLoading(false);
    };

    init().catch(e => { if (mounted) setError(String(e)); });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputUrl, initialized]);

  // Handle left panel output change
  const handleLeftChange = async (type: OutputType) => {
    setLeftOutput(type);
    await loadOverlay(leftNvRef.current, type, overlayOpacity, colormap);
  };

  const handleRightChange = async (type: OutputType) => {
    setRightOutput(type);
    await loadOverlay(rightNvRef.current, type, overlayOpacity, colormap);
  };

  // Sync view mode
  useEffect(() => {
    if (!initialized) return;
    [leftNvRef, rightNvRef].forEach(ref => {
      const nv = ref.current;
      if (nv) {
        nv.setSliceType(viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar);
        nv.drawScene();
      }
    });
  }, [viewMode, initialized]);

  // Sync opacity
  useEffect(() => {
    if (!initialized) return;
    [leftNvRef, rightNvRef].forEach(ref => {
      const nv = ref.current;
      if (nv && nv.volumes.length > 1) { nv.setOpacity(1, overlayOpacity); nv.drawScene(); }
    });
  }, [overlayOpacity, initialized]);

  // Sync colormap
  useEffect(() => {
    if (!initialized) return;
    [leftNvRef, rightNvRef].forEach(ref => {
      const nv = ref.current;
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

      {/* Split panels */}
      <div className="grid gap-4 md:grid-cols-2">
        <RoastPanel
          canvasRef={leftCanvasRef}
          initialized={initialized}
          selected={leftOutput}
          onSelect={handleLeftChange}
          panelId="left"
        />
        <RoastPanel
          canvasRef={rightCanvasRef}
          initialized={initialized}
          selected={rightOutput}
          onSelect={handleRightChange}
          panelId="right"
        />
      </div>

      <p className="text-xs text-foreground-muted">
        Simulation results shown as overlay on T1 anatomy. Use controls above to adjust opacity and colormap.
      </p>
    </section>
  );
}

// -------------------------------------------------------------------
// Internal panel component
// -------------------------------------------------------------------
interface RoastPanelProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  initialized: boolean;
  selected: OutputType;
  onSelect: (type: OutputType) => void;
  panelId: string;
}

function RoastPanel({ canvasRef, initialized, selected, onSelect, panelId }: RoastPanelProps) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = OUTPUT_OPTIONS.find(o => o.id === selected)!;

  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">{current.label}</h3>
        <div ref={dropRef} className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {current.label}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ul role="listbox" className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-surface py-1 shadow-lg">
              {OUTPUT_OPTIONS.map(opt => (
                <li
                  key={opt.id}
                  role="option"
                  aria-selected={selected === opt.id}
                  onClick={() => { onSelect(opt.id); setOpen(false); }}
                  className={`cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-surface-elevated ${selected === opt.id ? "bg-accent/10 text-accent" : ""}`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-foreground-muted">{opt.description}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="relative bg-black" style={{ height: "500px" }}>
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          style={{ width: "100%", height: "100%" }}
          aria-label={`${panelId} ROAST viewer`}
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
    </article>
  );
}
