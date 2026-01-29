"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Niivue } from "@niivue/niivue";
import { cn } from "@/lib/utils";

export interface ViewerPanelHandle {
  getNiivue: () => Niivue | null;
  loadOverlay: (buffer: ArrayBuffer, filename: string) => Promise<void>;
  setViewMode: (mode: "2d" | "3d") => void;
  setOverlayOpacity: (opacity: number) => void;
  syncWith: (other: Niivue) => void;
}

interface ViewerPanelProps {
  inputUrl: string;
  label: string;
  className?: string;
  viewMode?: "2d" | "3d";
  overlayOpacity?: number;
}

const ViewerPanel = forwardRef<ViewerPanelHandle, ViewerPanelProps>(
  ({ inputUrl, label, className, viewMode = "2d", overlayOpacity = 0.5 }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const nvRef = useRef<Niivue | null>(null);
    const [initialized, setInitialized] = useState(false);
    const [hasOverlay, setHasOverlay] = useState(false);

    // Initialize Niivue
    useEffect(() => {
      if (!canvasRef.current || nvRef.current) return;

      const initViewer = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        try {
          const nv = new Niivue({
            show3Dcrosshair: true,
            isRadiologicalConvention: true,
            backColor: [0.05, 0.05, 0.08, 1],
          });

          nv.attachToCanvas(canvas);
          nvRef.current = nv;

          // Load the input image
          const response = await fetch(inputUrl);
          const arrayBuffer = await response.arrayBuffer();
          await nv.loadFromArrayBuffer(arrayBuffer, "input.nii.gz");
          nv.setOpacity(0, 1.0);

          // Set initial view mode
          const sliceType = viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
          nv.setSliceType(sliceType);
          nv.drawScene();

          setInitialized(true);
        } catch (err) {
          console.error("Failed to initialize viewer:", err);
        }
      };

      // Wait for canvas to be ready
      requestAnimationFrame(() => {
        initViewer();
      });

      return () => {
        if (nvRef.current) {
          try {
            nvRef.current.gl?.getExtension("WEBGL_lose_context")?.loseContext();
          } catch {}
          nvRef.current = null;
        }
      };
      // viewMode is intentionally excluded - it's handled in a separate effect
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputUrl]);

    // Update view mode
    useEffect(() => {
      if (!initialized || !nvRef.current) return;
      const nv = nvRef.current;
      const sliceType = viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
      nv.setSliceType(sliceType);
      nv.drawScene();
    }, [viewMode, initialized]);

    // Update overlay opacity
    useEffect(() => {
      if (!initialized || !nvRef.current || !hasOverlay) return;
      nvRef.current.setOpacity(1, overlayOpacity);
      nvRef.current.drawScene();
    }, [overlayOpacity, initialized, hasOverlay]);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      getNiivue: () => nvRef.current,

      loadOverlay: async (buffer: ArrayBuffer, filename: string) => {
        const nv = nvRef.current;
        if (!nv) return;

        await nv.loadFromArrayBuffer(buffer, filename);
        nv.setColormap(nv.volumes[1].id, "freesurfer");
        nv.setOpacity(1, overlayOpacity);
        nv.drawScene();
        setHasOverlay(true);
      },

      setViewMode: (mode: "2d" | "3d") => {
        const nv = nvRef.current;
        if (!nv) return;
        const sliceType = mode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
        nv.setSliceType(sliceType);
        nv.drawScene();
      },

      setOverlayOpacity: (opacity: number) => {
        const nv = nvRef.current;
        if (!nv || !hasOverlay) return;
        nv.setOpacity(1, opacity);
        nv.drawScene();
      },

      syncWith: (other: Niivue) => {
        const nv = nvRef.current;
        if (!nv) return;
        nv.broadcastTo([other], { "2d": true, "3d": true });
      },
    }), [overlayOpacity, hasOverlay]);

    return (
      <div className={cn("flex flex-col", className)}>
        {/* Label */}
        <div className="mb-2 text-center">
          <span className="text-sm font-medium text-foreground-secondary">
            {label}
          </span>
        </div>

        {/* Canvas container */}
        <div className="relative flex-1 overflow-hidden rounded-xl bg-[#0d0d14] border border-border">
          <canvas
            ref={canvasRef}
            className="h-full w-full"
          />

          {/* Loading overlay */}
          {!initialized && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d14]">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="text-sm text-foreground-muted">Loading...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

ViewerPanel.displayName = "ViewerPanel";

export default ViewerPanel;
