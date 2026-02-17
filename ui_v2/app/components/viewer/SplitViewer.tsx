"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Niivue } from "@niivue/niivue";
import { AlertTriangle } from "lucide-react";
import { getResult } from "@/lib/api";
import ViewerControls, { ColormapId } from "./ViewerControls";
import ComparisonSelector from "./ComparisonSelector";
import SegmentationLegend from "./SegmentationLegend";

interface SplitViewerProps {
  inputUrl: string;
  sessionId: string;
  models: string[];
}

export default function SplitViewer({ inputUrl, sessionId, models }: SplitViewerProps) {
  // Canvas refs
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);

  // Niivue instances
  const leftNvRef = useRef<Niivue | null>(null);
  const rightNvRef = useRef<Niivue | null>(null);

  // State
  const [initialized, setInitialized] = useState(false);
  const [leftModel, setLeftModel] = useState<string | null>(null);
  const [rightModel, setRightModel] = useState<string | null>(null);
  const [loadedResults, setLoadedResults] = useState<Record<string, ArrayBuffer>>({});
  const [loadingModels, setLoadingModels] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [colormap, setColormap] = useState<ColormapId>("freesurfer");
  const [error, setError] = useState<string | null>(null);

  // Ref to track loaded results without stale closure issues
  const loadedResultsRef = useRef<Record<string, ArrayBuffer>>({});

  // Load a result from the API
  const loadResult = useCallback(async (model: string): Promise<ArrayBuffer | null> => {
    // Check ref for most up-to-date state
    if (loadedResultsRef.current[model]) {
      console.log(`Using cached result for model: ${model}`);
      return loadedResultsRef.current[model];
    }

    setLoadingModels((prev) => new Set(prev).add(model));

    try {
      console.log(`Fetching result for model: ${model}, sessionId: ${sessionId}`);
      const blob = await getResult(sessionId, model);
      console.log(`Got blob for ${model}, size: ${blob.size}, type: ${blob.type}`);

      if (blob.size === 0) {
        console.error(`Empty blob received for ${model}`);
        setError(`No data received for ${model}. The result may not be ready yet.`);
        return null;
      }

      const buffer = await blob.arrayBuffer();
      console.log(`Converted to ArrayBuffer for ${model}, byteLength: ${buffer.byteLength}`);

      if (buffer.byteLength === 0) {
        console.error(`Empty buffer for ${model}`);
        setError(`Empty result for ${model}. Please try refreshing.`);
        return null;
      }

      // Update both ref and state
      loadedResultsRef.current[model] = buffer;
      setLoadedResults((prev) => ({ ...prev, [model]: buffer }));

      console.log(`Successfully loaded and cached result for model: ${model}`);
      return buffer;
    } catch (err) {
      console.error(`Failed to load result for ${model}:`, err);
      setError(`Failed to load ${model} result. Please try refreshing.`);
      return null;
    } finally {
      setLoadingModels((prev) => {
        const next = new Set(prev);
        next.delete(model);
        return next;
      });
    }
  }, [sessionId]);

  // Initialize Niivue instances
  useEffect(() => {
    if (initialized) return;
    if (!leftCanvasRef.current || !rightCanvasRef.current) return;

    // Check if already initialized (StrictMode remount)
    if (leftNvRef.current && rightNvRef.current) {
      console.log("Niivue already initialized, skipping...");
      setInitialized(true);
      return;
    }

    let isMounted = true;

    const init = async () => {
      // Wait for DOM and layout
      await new Promise((resolve) => setTimeout(resolve, 150));

      if (!isMounted) return;

      const leftCanvas = leftCanvasRef.current;
      const rightCanvas = rightCanvasRef.current;
      if (!leftCanvas || !rightCanvas) return;

      // Double-check refs weren't set by another mount
      if (leftNvRef.current || rightNvRef.current) {
        console.log("Niivue refs already set, skipping init...");
        return;
      }

      try {
        console.log("Initializing Niivue viewers...");

        // Create instances with explicit options
        const nvOptions = {
          show3Dcrosshair: true,
          isRadiologicalConvention: true,
          backColor: [0, 0, 0, 1] as [number, number, number, number],
          crosshairColor: [1, 0, 0, 1] as [number, number, number, number],
        };

        const leftNv = new Niivue(nvOptions);
        const rightNv = new Niivue(nvOptions);

        leftNv.attachToCanvas(leftCanvas);
        rightNv.attachToCanvas(rightCanvas);

        leftNvRef.current = leftNv;
        rightNvRef.current = rightNv;

        // Load input image to both
        console.log("Loading input image from:", inputUrl);
        const response = await fetch(inputUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch input image: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        if (arrayBuffer.byteLength === 0) {
          throw new Error("Input image is empty");
        }

        console.log(`Input image loaded, size: ${arrayBuffer.byteLength} bytes`);

        if (!isMounted) return;

        // Clone the buffer for each viewer
        console.log("Loading input to left viewer...");
        await leftNv.loadFromArrayBuffer(arrayBuffer.slice(0), "input.nii.gz");
        console.log("Left viewer volumes:", leftNv.volumes.length, leftNv.volumes.map(v => ({ id: v.id, dims: v.dims })));

        console.log("Loading input to right viewer...");
        await rightNv.loadFromArrayBuffer(arrayBuffer.slice(0), "input.nii.gz");
        console.log("Right viewer volumes:", rightNv.volumes.length, rightNv.volumes.map(v => ({ id: v.id, dims: v.dims })));

        if (leftNv.volumes.length === 0 || rightNv.volumes.length === 0) {
          throw new Error("Failed to load input image into Niivue viewers");
        }

        leftNv.setOpacity(0, 1.0);
        rightNv.setOpacity(0, 1.0);

        // Set initial view mode
        const sliceType = leftNv.sliceTypeMultiplanar;
        console.log("Setting slice type to:", sliceType);
        leftNv.setSliceType(sliceType);
        rightNv.setSliceType(sliceType);

        console.log("Drawing scenes...");
        leftNv.drawScene();
        rightNv.drawScene();

        // Sync views between panels
        leftNv.broadcastTo([rightNv], { "2d": true, "3d": true });
        rightNv.broadcastTo([leftNv], { "2d": true, "3d": true });

        console.log("Niivue viewers initialized successfully");
        console.log("Canvas sizes - Left:", leftCanvas.width, "x", leftCanvas.height, "Right:", rightCanvas.width, "x", rightCanvas.height);

        // Check WebGL context
        const leftGl = leftNv.gl;
        const rightGl = rightNv.gl;
        console.log("WebGL contexts - Left:", !!leftGl, "Right:", !!rightGl);
        if (leftGl) {
          console.log("Left GL viewport:", leftGl.getParameter(leftGl.VIEWPORT));
        }

        setInitialized(true);

        // Auto-load segmentation results based on number of models
        if (models.length > 0) {
          console.log("Auto-loading models:", models);

          // Helper to load a model to a panel
          const loadModelToPanel = async (
            nv: Niivue,
            model: string,
            panelName: string
          ): Promise<boolean> => {
            try {
              const buffer = await loadResult(model);
              if (buffer && buffer.byteLength > 0) {
                console.log(`Loading ${model} to ${panelName} panel, buffer size: ${buffer.byteLength}`);
                await nv.loadFromArrayBuffer(buffer.slice(0), `${model}.nii.gz`);

                if (nv.volumes.length > 1) {
                  nv.setColormap(nv.volumes[1].id, "freesurfer");
                  nv.setOpacity(1, 0.5);
                  nv.drawScene();
                  console.log(`${model} loaded to ${panelName} panel successfully`);
                  return true;
                }
              }
              return false;
            } catch (err) {
              console.error(`Error loading ${model} to ${panelName}:`, err);
              return false;
            }
          };

          if (models.length === 1) {
            // Single model: load to right panel only
            if (rightNvRef.current) {
              const success = await loadModelToPanel(rightNvRef.current, models[0], "right");
              if (success) {
                setRightModel(models[0]);
              }
            }
          } else {
            // Multiple models: load first to left, second to right
            if (leftNvRef.current && rightNvRef.current) {
              const [leftSuccess, rightSuccess] = await Promise.all([
                loadModelToPanel(leftNvRef.current, models[0], "left"),
                loadModelToPanel(rightNvRef.current, models[1], "right"),
              ]);

              if (leftSuccess) {
                setLeftModel(models[0]);
              }
              if (rightSuccess) {
                setRightModel(models[1]);
              }
            }
          }
        } else {
          console.log("No models available to load");
        }
      } catch (err) {
        console.error("Failed to initialize viewers:", err);
        if (isMounted) {
          setError("Failed to initialize MRI viewer. Please try refreshing the page.");
        }
      }
    };

    init();

    return () => {
      isMounted = false;
      // Don't clear refs or lose WebGL context here - it causes issues with React StrictMode
      // The refs will be reused on remount, or properly cleaned up when component fully unmounts
    };
  }, [inputUrl, models, initialized, loadResult]);

  // Load overlay on a panel
  const loadOverlayToPanel = useCallback(async (
    nv: Niivue | null,
    model: string | null,
    currentOpacity: number,
    currentColormap: ColormapId
  ): Promise<boolean> => {
    if (!nv) {
      console.log("loadOverlayToPanel: nv is null");
      return false;
    }

    console.log(`loadOverlayToPanel: model=${model}, currentOpacity=${currentOpacity}, colormap=${currentColormap}, volumes=${nv.volumes.length}`);

    // Remove existing overlay if any
    while (nv.volumes.length > 1) {
      console.log(`Removing overlay volume, remaining: ${nv.volumes.length}`);
      nv.removeVolumeByIndex(1);
    }

    if (model) {
      try {
        const buffer = loadedResultsRef.current[model] || (await loadResult(model));
        if (buffer && buffer.byteLength > 0) {
          console.log(`Loading overlay ${model}, buffer size: ${buffer.byteLength}`);
          await nv.loadFromArrayBuffer(buffer.slice(0), `${model}.nii.gz`);

          // Check if the volume was actually loaded
          if (nv.volumes.length > 1) {
            console.log(`Volume loaded successfully, total volumes: ${nv.volumes.length}`);
            // Use the selected colormap
            nv.setColormap(nv.volumes[1].id, currentColormap);
            nv.setOpacity(1, currentOpacity);
            nv.drawScene();
            return true;
          } else {
            console.error(`Volume was not added after loadFromArrayBuffer for ${model}`);
            setError(`Failed to render ${model} overlay.`);
            return false;
          }
        } else {
          console.error(`No buffer or empty buffer for ${model}`);
          return false;
        }
      } catch (err) {
        console.error(`Error loading overlay for ${model}:`, err);
        setError(`Failed to load ${model} overlay.`);
        return false;
      }
    }

    nv.drawScene();
    return true;
  }, [loadResult]);

  // Handle model selection for left panel
  const handleLeftModelChange = async (model: string | null) => {
    const success = await loadOverlayToPanel(leftNvRef.current, model, overlayOpacity, colormap);
    if (success) {
      setLeftModel(model);
    }
  };

  // Handle model selection for right panel
  const handleRightModelChange = async (model: string | null) => {
    const success = await loadOverlayToPanel(rightNvRef.current, model, overlayOpacity, colormap);
    if (success) {
      setRightModel(model);
    }
  };

  // Update view mode
  useEffect(() => {
    if (!initialized) return;

    [leftNvRef, rightNvRef].forEach((ref) => {
      const nv = ref.current;
      if (nv) {
        const sliceType = viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;
        nv.setSliceType(sliceType);
        nv.drawScene();
      }
    });
  }, [viewMode, initialized]);

  // Update opacity
  useEffect(() => {
    if (!initialized) return;

    [
      { nv: leftNvRef.current, hasOverlay: leftModel !== null },
      { nv: rightNvRef.current, hasOverlay: rightModel !== null },
    ].forEach(({ nv, hasOverlay }) => {
      if (nv && hasOverlay && nv.volumes.length > 1) {
        nv.setOpacity(1, overlayOpacity);
        nv.drawScene();
      }
    });
  }, [overlayOpacity, initialized, leftModel, rightModel]);

  // Update colormap
  useEffect(() => {
    if (!initialized) return;

    [
      { nv: leftNvRef.current, hasOverlay: leftModel !== null },
      { nv: rightNvRef.current, hasOverlay: rightModel !== null },
    ].forEach(({ nv, hasOverlay }) => {
      if (nv && hasOverlay && nv.volumes.length > 1) {
        nv.setColormap(nv.volumes[1].id, colormap);
        nv.drawScene();
      }
    });
  }, [colormap, initialized, leftModel, rightModel]);

  // Get display names
  const getDisplayName = (model: string): string => {
    return model
      .replace("-native", "")
      .replace("-fs", "")
      .toUpperCase();
  };

  const getSpaceLabel = (model: string): string => {
    if (model.includes("-native")) return "Native";
    if (model.includes("-fs")) return "FreeSurfer";
    return "";
  };

  // Check which models are loaded
  const loadedModelsStatus = models.reduce(
    (acc, model) => ({ ...acc, [model]: !!loadedResults[model] }),
    {} as Record<string, boolean>
  );

  // Get loading model name for display
  const loadingModelName = loadingModels.size > 0
    ? getDisplayName(Array.from(loadingModels)[0])
    : null;

  // Keyboard handler for viewer navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "2") {
      setViewMode("2d");
    } else if (e.key === "3") {
      setViewMode("3d");
    } else if (e.key === "ArrowUp" && overlayOpacity < 1) {
      setOverlayOpacity((prev) => Math.min(1, prev + 0.1));
    } else if (e.key === "ArrowDown" && overlayOpacity > 0) {
      setOverlayOpacity((prev) => Math.max(0, prev - 0.1));
    }
  }, [overlayOpacity]);

  return (
    <section
      aria-label="MRI Viewer Comparison"
      className="space-y-4"
      onKeyDown={handleKeyDown}
    >
      {/* Error message */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-error/50 bg-error/10 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-error flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-error mb-1">Failed to load results</h4>
              <p className="text-sm text-error/80">{error}</p>
              <p className="text-xs text-foreground-muted mt-2">
                This may indicate a server-side processing error. Check if the segmentation completed successfully.
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-error/70 hover:text-error text-sm underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4"
        role="toolbar"
        aria-label="Viewer controls"
      >
        <ViewerControls
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          overlayOpacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          colormap={colormap}
          onColormapChange={setColormap}
        />

        {loadingModelName && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-foreground-muted"
          >
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
              aria-hidden="true"
            />
            <span>Loading {loadingModelName}...</span>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts help */}
      <div className="sr-only" aria-live="polite">
        Keyboard shortcuts: Press 2 for 2D view, 3 for 3D view, Up arrow to increase opacity, Down arrow to decrease opacity.
      </div>

      {/* Split View Canvases */}
      <div className="grid gap-4 md:grid-cols-2" role="group" aria-label="Side by side MRI comparison">
        {/* Left Panel */}
        <article
          className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden"
          aria-label={leftModel ? `Left panel: ${getDisplayName(leftModel)} segmentation` : "Left panel: Input MRI only"}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium text-foreground" id="left-panel-title">
              {leftModel ? (
                <>
                  {getDisplayName(leftModel)}{" "}
                  <span className="text-foreground-muted">({getSpaceLabel(leftModel)})</span>
                </>
              ) : (
                "Input Only"
              )}
            </h3>
            <ComparisonSelector
              models={models}
              selectedModel={leftModel}
              onModelSelect={handleLeftModelChange}
              loadedModels={loadedModelsStatus}
              loadingModels={loadingModels}
              panelId="left"
            />
          </header>

          <div
            className="relative bg-black"
            style={{ height: "500px" }}
            role="img"
            aria-labelledby="left-panel-title"
            tabIndex={0}
          >
            <canvas
              ref={leftCanvasRef}
              width={512}
              height={512}
              style={{ width: "100%", height: "100%" }}
              aria-label="Left MRI viewer canvas"
            />
            {!initialized && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                role="status"
                aria-label="Loading viewer"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <span className="text-sm text-foreground-muted">Initializing viewer...</span>
                </div>
              </div>
            )}
          </div>
        </article>

        {/* Right Panel */}
        <article
          className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden"
          aria-label={rightModel ? `Right panel: ${getDisplayName(rightModel)} segmentation` : "Right panel: Input MRI only"}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium text-foreground" id="right-panel-title">
              {rightModel ? (
                <>
                  {getDisplayName(rightModel)}{" "}
                  <span className="text-foreground-muted">({getSpaceLabel(rightModel)})</span>
                </>
              ) : (
                "Input Only"
              )}
            </h3>
            <ComparisonSelector
              models={models}
              selectedModel={rightModel}
              onModelSelect={handleRightModelChange}
              loadedModels={loadedModelsStatus}
              loadingModels={loadingModels}
              panelId="right"
            />
          </header>

          <div
            className="relative bg-black"
            style={{ height: "500px" }}
            role="img"
            aria-labelledby="right-panel-title"
            tabIndex={0}
          >
            <canvas
              ref={rightCanvasRef}
              width={512}
              height={512}
              style={{ width: "100%", height: "100%" }}
              aria-label="Right MRI viewer canvas"
            />
            {!initialized && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                role="status"
                aria-label="Loading viewer"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <span className="text-sm text-foreground-muted">Initializing viewer...</span>
                </div>
              </div>
            )}
          </div>
        </article>
      </div>

      {/* Segmentation Legend */}
      <SegmentationLegend colormap={colormap} />

      {/* Debug info in development */}
      {process.env.NODE_ENV === "development" && (
        <div className="text-xs text-foreground-muted p-2 bg-surface rounded space-y-1">
          <p><strong>Debug Info:</strong></p>
          <p>Session: {sessionId}</p>
          <p>Models available: {models.join(", ") || "none"}</p>
          <p>Loaded results: {Object.keys(loadedResults).join(", ") || "none"}</p>
          <p>Loading: {loadingModels.size > 0 ? Array.from(loadingModels).join(", ") : "none"}</p>
          <p>Left panel: {leftModel || "input only"}</p>
          <p>Right panel: {rightModel || "input only"}</p>
          <p>Initialized: {initialized ? "yes" : "no"}</p>
          <p>Input URL: {inputUrl ? "set" : "not set"}</p>
        </div>
      )}
    </section>
  );
}
