"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";

import {
  startPrediction,
  connectSSE,
  SSEEvent,
  PredictResponse,
} from "../lib/api";

// ------------------------------------------------------------
// TYPES
// ------------------------------------------------------------
export type Space = "native" | "freesurfer";

export interface ModelSelection {
  grace: boolean;
  domino: boolean;
  dominopp: boolean;
}

export type WizardStep = 1 | 2 | 3 | 4;

interface JobContextType {
  // Session/job state
  sessionId: string | null;
  models: string[];
  space: string;
  queuePosition: number | null;
  progress: Record<string, number>;
  modelGpus: Record<string, number>;
  status: "idle" | "uploading" | "queued" | "running" | "complete";
  viewerReady: boolean;

  // Error + retry
  error: string | null;
  sseDisconnected: boolean;
  retryCount: number;

  // Wizard state
  currentStep: WizardStep;
  setCurrentStep: (step: WizardStep) => void;

  // Form state
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  selectedSpace: Space;
  setSelectedSpace: (space: Space) => void;
  convertToFs: boolean;
  setConvertToFs: (convert: boolean) => void;
  selectedModels: ModelSelection;
  setSelectedModels: (models: ModelSelection | ((prev: ModelSelection) => ModelSelection)) => void;
  inputBlobUrl: string | null;

  // Navigation helpers
  canProceedToStep: (step: WizardStep) => boolean;
  isAnyModelSelected: boolean;
  getSelectedModelList: () => string[];

  // Actions
  startJob: () => Promise<void>;
  resetJob: () => void;

  // Setters
  setError: (m: string | null) => void;
  setSseDisconnected: (v: boolean) => void;
}

const JobContext = createContext<JobContextType | null>(null);

// ------------------------------------------------------------
// PROVIDER
// ------------------------------------------------------------
export function JobProvider({ children }: { children: React.ReactNode }) {
  // Session/job state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [space, setSpace] = useState<string>("native");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [modelGpus, setModelGpus] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<JobContextType["status"]>("idle");
  const [viewerReady, setViewerReady] = useState<boolean>(false);

  // Error + retry
  const [error, setError] = useState<string | null>(null);
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space>("freesurfer");
  const [convertToFs, setConvertToFs] = useState(false);
  const [selectedModels, setSelectedModels] = useState<ModelSelection>({
    grace: false,
    domino: false,
    dominopp: false,
  });
  const [inputBlobUrl, setInputBlobUrl] = useState<string | null>(null);

  // Ref for recursive SSE subscription
  const subscribeToSSERef = useRef<(session: string, backoffCount: number) => void>(() => {});

  // Derived state
  const isAnyModelSelected = selectedModels.grace || selectedModels.domino || selectedModels.dominopp;

  // Build model list from selection
  const getSelectedModelList = useCallback((): string[] => {
    const modelList: string[] = [];
    const suffix = selectedSpace === "native" ? "-native" : "-fs";

    if (selectedModels.grace) modelList.push(`grace${suffix}`);
    if (selectedModels.domino) modelList.push(`domino${suffix}`);
    if (selectedModels.dominopp) modelList.push(`dominopp${suffix}`);

    return modelList;
  }, [selectedSpace, selectedModels]);

  // Navigation helper
  const canProceedToStep = useCallback(
    (step: WizardStep): boolean => {
      switch (step) {
        case 1:
          return true;
        case 2:
          return selectedFile !== null;
        case 3:
          return selectedFile !== null && isAnyModelSelected;
        case 4:
          return status === "complete" && viewerReady;
        default:
          return false;
      }
    },
    [selectedFile, isAnyModelSelected, status, viewerReady]
  );

  // Cleanup blob URL when component unmounts or resets
  useEffect(() => {
    return () => {
      if (inputBlobUrl) {
        URL.revokeObjectURL(inputBlobUrl);
      }
    };
  }, [inputBlobUrl]);

  // Auto-advance to step 4 when complete
  useEffect(() => {
    if (status === "complete" && viewerReady && currentStep === 3) {
      setCurrentStep(4);
    }
  }, [status, viewerReady, currentStep]);

  // ------------------------------------------------------------
  // SSE SUBSCRIBE
  // ------------------------------------------------------------
  // Define the function and store in ref to allow recursive calls
  subscribeToSSERef.current = (session: string, backoffCount: number) => {
    const backoff = Math.min(2000 * (backoffCount + 1), 16000);

    connectSSE(
      session,
      (evt: SSEEvent) => {
        if (evt.type === "error") {
          setError(evt.message || "An unknown backend error occurred.");
          return;
        }

        if (evt.type === "progress" && evt.model) {
          setStatus("running");
          setProgress((prev) => ({
            ...prev,
            [evt.model!]: evt.progress ?? 0,
          }));
          // Track which GPU each model is running on
          if (evt.gpu !== undefined) {
            setModelGpus((prev) => ({
              ...prev,
              [evt.model!]: evt.gpu!,
            }));
          }
        }

        if (evt.type === "complete") {
          setViewerReady(true);
          setStatus("complete");
        }
      },
      () => {
        // onDisconnect
        setSseDisconnected(true);
        const newCount = backoffCount + 1;
        setRetryCount(newCount);

        setTimeout(() => {
          subscribeToSSERef.current(session, newCount);
        }, backoff);
      }
    );
  };

  const subscribeToSSE = useCallback((session: string, backoffCount: number) => {
    subscribeToSSERef.current(session, backoffCount);
  }, []);

  // ------------------------------------------------------------
  // START A NEW JOB
  // ------------------------------------------------------------
  const startJob = useCallback(async () => {
    if (!selectedFile || !isAnyModelSelected) return;

    setStatus("uploading");

    // Create blob URL for immediate display
    const blobUrl = URL.createObjectURL(selectedFile);
    setInputBlobUrl(blobUrl);

    const modelList = getSelectedModelList();
    const shouldConvertToFs = selectedSpace === "freesurfer" && convertToFs;

    const resp: PredictResponse = await startPrediction(
      selectedFile,
      modelList,
      selectedSpace,
      shouldConvertToFs
    );

    setSessionId(resp.session_id);
    setModels(resp.models);
    setSpace(resp.space);
    setQueuePosition(resp.queue_position);

    setStatus("queued");
    setProgress({});
    setViewerReady(false);
    setRetryCount(0);
    setError(null);
    setSseDisconnected(false);

    // Move to processing step
    setCurrentStep(3);

    subscribeToSSE(resp.session_id, 0);
  }, [selectedFile, isAnyModelSelected, getSelectedModelList, selectedSpace, convertToFs, subscribeToSSE]);

  // ------------------------------------------------------------
  // RESET JOB COMPLETELY
  // ------------------------------------------------------------
  const resetJob = useCallback(() => {
    // Cleanup blob URL
    if (inputBlobUrl) {
      URL.revokeObjectURL(inputBlobUrl);
    }

    // Reset session state
    setSessionId(null);
    setModels([]);
    setSpace("native");
    setQueuePosition(null);
    setProgress({});
    setModelGpus({});
    setStatus("idle");
    setViewerReady(false);
    setError(null);
    setRetryCount(0);
    setSseDisconnected(false);

    // Reset form state
    setSelectedFile(null);
    setSelectedSpace("freesurfer");
    setConvertToFs(false);
    setSelectedModels({ grace: false, domino: false, dominopp: false });
    setInputBlobUrl(null);

    // Reset wizard
    setCurrentStep(1);
  }, [inputBlobUrl]);

  return (
    <JobContext.Provider
      value={{
        // Session/job state
        sessionId,
        models,
        space,
        queuePosition,
        progress,
        modelGpus,
        status,
        viewerReady,

        // Error + retry
        error,
        sseDisconnected,
        retryCount,

        // Wizard state
        currentStep,
        setCurrentStep,

        // Form state
        selectedFile,
        setSelectedFile,
        selectedSpace,
        setSelectedSpace,
        convertToFs,
        setConvertToFs,
        selectedModels,
        setSelectedModels,
        inputBlobUrl,

        // Navigation helpers
        canProceedToStep,
        isAnyModelSelected,
        getSelectedModelList,

        // Actions
        startJob,
        resetJob,
        setError,
        setSseDisconnected,
      }}
    >
      {children}
    </JobContext.Provider>
  );
}

export function useJob() {
  const c = useContext(JobContext);
  if (!c) throw new Error("useJob() must be used inside <JobProvider>");
  return c;
}
