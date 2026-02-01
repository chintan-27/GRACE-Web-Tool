"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getResult } from "../../lib/api";
import { Niivue } from "@niivue/niivue";

interface Props {
  inputUrl: string; // blob URL of original file for immediate display
  sessionId: string;
  models: string[];
  progress: Record<string, number>; // track model progress
}

export default function Viewer({ inputUrl, sessionId, models, progress }: Props) {
  // Refs for each model's canvas and Niivue instance
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const nvRefs = useRef<Record<string, Niivue | null>>({});

  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [loadedResults, setLoadedResults] = useState<Record<string, boolean>>({});
  const [initialized, setInitialized] = useState(false);

  // Get layout class based on number of models
  const getWidthClass = (count: number) => {
    if (count === 3) return "w-1/3";
    if (count === 2) return "w-1/2";
    return "w-full";
  };

  const getCanvasSize = (count: number) => {
    if (count === 3) return { width: 512, height: 1024 };
    if (count === 2) return { width: 120, height: 360 };
    return { width: 720, height: 720 };
  };

  // Initialize Niivue instances and load original image
  useEffect(() => {
    if (initialized || !inputUrl) return;

    const initializeViewers = async () => {
      // Wait for canvases to be in the DOM
      await new Promise((resolve) => requestAnimationFrame(resolve));

      for (const model of models) {
        const canvas = canvasRefs.current[model];
        if (!canvas || nvRefs.current[model]) continue;

        try {
          const nv = new Niivue({
            show3Dcrosshair: true,
            isRadiologicalConvention: true,
            backColor: [0, 0, 0, 1],
          });
          nv.attachToCanvas(canvas);
          nvRefs.current[model] = nv;

          // Load original image from blob URL
          const response = await fetch(inputUrl);
          const arrayBuffer = await response.arrayBuffer();
          await nv.loadFromArrayBuffer(arrayBuffer, "input.nii.gz");
          nv.setOpacity(0, 1.0);

          // Set initial view mode
          const sliceType = viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
          nv.setSliceType(sliceType);
          nv.drawScene();
        } catch (err) {
          console.error(`Failed to initialize viewer for ${model}:`, err);
        }
      }

      // Synchronize views after all are initialized
      syncViews();
      setInitialized(true);
    };

    initializeViewers();
  }, [inputUrl, models, initialized, viewMode]);

  // Synchronize views across canvases
  const syncViews = useCallback(() => {
    const activeInstances = models
      .map((m) => nvRefs.current[m])
      .filter((nv): nv is Niivue => nv !== null);

    activeInstances.forEach((nv, i) => {
      const others = activeInstances.filter((_, j) => j !== i);
      if (others.length > 0) {
        nv.broadcastTo(others, { "2d": true, "3d": true });
      }
    });
  }, [models]);

  // Load segmentation results when they become available
  useEffect(() => {
    const loadResults = async () => {
      for (const model of models) {
        const modelProgress = progress[model] ?? 0;
        const nv = nvRefs.current[model];

        // Load result when progress hits 100 and not already loaded
        if (modelProgress >= 100 && nv && !loadedResults[model]) {
          try {
            const blob = await getResult(sessionId, model);
            const buffer = await blob.arrayBuffer();

            // Add segmentation as overlay (volume index 1) with FreeSurfer colormap
            await nv.loadFromArrayBuffer(buffer, `${model}.nii.gz`);

            // Set colormap for segmentation - use freesurfer for label visualization
            nv.setColormap(nv.volumes[1].id, "freesurfer");
            nv.setOpacity(1, 0.5); // Semi-transparent overlay
            nv.drawScene();

            setLoadedResults((prev) => ({ ...prev, [model]: true }));
          } catch (err) {
            console.error(`Failed to load result for ${model}:`, err);
          }
        }
      }
    };

    if (initialized) {
      loadResults();
    }
  }, [progress, sessionId, models, initialized, loadedResults]);

  // Update view mode for all instances
  useEffect(() => {
    if (!initialized) return;

    for (const model of models) {
      const nv = nvRefs.current[model];
      if (nv) {
        const sliceType = viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
        nv.setSliceType(sliceType);
        nv.drawScene();
      }
    }
  }, [viewMode, models, initialized]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const model of models) {
        try {
          const nv = nvRefs.current[model];
          nv?.gl?.getExtension("WEBGL_lose_context")?.loseContext();
          nvRefs.current[model] = null;
        } catch {}
      }
    };
  }, [models]);

  // Toggle 2D/3D view
  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "2d" ? "3d" : "2d"));
  };

  // Handle download from Niivue instance (matching v1)
  const handleDownload = async (model: string) => {
    const nv = nvRefs.current[model];
    if (!nv || nv.volumes.length < 2) {
      console.error(`Niivue instance or segmentation for ${model} not found.`);
      return;
    }

    const filename = `uploaded_image_pred_${model.toUpperCase().replace("-", "_")}.nii.gz`;

    try {
      const result = await nv.saveImage({
        filename,
        volumeByIndex: 1, // Save the segmentation volume
        isSaveDrawing: false,
      });

      if (result instanceof Uint8Array) {
        const blob = new Blob([result as BlobPart], { type: "application/gzip" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(`Failed to save image for ${model}:`, err);
    }
  };

  return (
    <div className="w-full bg-black p-4">
      {/* View toggle button */}
      <div className="flex justify-center mb-4">
        <button
          onClick={toggleViewMode}
          className="px-4 py-2 text-sm bg-gray-800 text-white rounded-sm hover:bg-gray-700"
        >
          Switch to {viewMode === "2d" ? "3D" : "2D"} View
        </button>
      </div>

      {/* Canvases in side-by-side layout (matching v1) */}
      <div
        className={`flex flex-row ${
          models.length === 1 ? "justify-center" : "justify-start"
        } items-start space-x-4 w-full h-full`}
      >
        {models.map((model) => {
          const { width, height } = getCanvasSize(models.length);
          const modelProgress = progress[model] ?? 0;
          const isLoaded = loadedResults[model];

          return (
            <div
              key={model}
              className={`${getWidthClass(models.length)} flex flex-col items-center`}
            >
              {/* Canvas with fixed dimensions like v1 */}
              <canvas
                ref={(el) => {
                  canvasRefs.current[model] = el;
                }}
                width={width}
                height={height}
              />

              {/* Model label */}
              <div className="text-center mt-2 font-semibold text-white">
                {model.toUpperCase().replace("-NATIVE", "").replace("-FS", "")}
              </div>

              {/* Progress or Download button (matching v1) */}
              {modelProgress < 100 ? (
                <div className="text-sm text-amber-400 mt-1">
                  Processing... {modelProgress}%
                </div>
              ) : isLoaded ? (
                <button
                  onClick={() => handleDownload(model)}
                  className="mt-2 px-3 py-1 bg-lime-600 text-white text-sm rounded-sm hover:bg-lime-700"
                >
                  Download
                </button>
              ) : (
                <div className="text-sm text-amber-400 mt-1">Loading result...</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
