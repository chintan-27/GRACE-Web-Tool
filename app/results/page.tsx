"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { NVImage } from "@niivue/niivue";
import pako from "pako";
import NiiVueComponent from "../components/niivue";
import socket from "./socket";

const Results = () => {
  const searchParams = useSearchParams();
  const fileUrl = searchParams.get("file") || "";
  const grace = searchParams.get("grace") === "true";
  const domino = searchParams.get("domino") === "true";
  const dominopp = searchParams.get("dominopp") === "true";

  const [image, setImage] = useState<NVImage | null>(null);
  const [loading, setLoading] = useState(true);

  const [graceProgress, setGraceProgress] = useState({ message: "", progress: 0 });
  const [dominoProgress, setDominoProgress] = useState({ message: "", progress: 0 });
  const [dppProgress, setDppProgress] = useState({ message: "", progress: 0 });

  const [ginferenceResults, setgInferenceResults] = useState<NVImage | null>(null);
  const [dinferenceResults, setdInferenceResults] = useState<NVImage | null>(null);
  const [dppinferenceResults, setdppInferenceResults] = useState<NVImage | null>(null);

  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  const hasStartedGrace = useRef(false);
  const hasStartedDomino = useRef(false);
  const hasStartedDpp = useRef(false);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket.id);
      setSocketReady(true);
    });

    socket.on("disconnect", () => {
      console.log("⚠️ Socket disconnected");
      setSocketReady(false);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, []);

  useEffect(() => {
    const loadImage = async () => {
      try {
        console.log("Fetching file from:", fileUrl);
        setLoading(true);
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        setFileBlob(blob);
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const isGzipped = uint8Array[0] === 0x1f && uint8Array[1] === 0x8b;
        const file = isGzipped
          ? new File([pako.inflate(uint8Array)], "uploaded_image.nii")
          : new File([blob], "uploaded_image.nii");

        const nvImage = await NVImage.loadFromFile({ file, colormap: "gray" });
        setImage(nvImage);
        console.log("Image loaded successfully");
      } catch (err) {
        console.error("Error loading image:", err);
      } finally {
        setLoading(false);
      }
    };

    if (fileUrl) loadImage();
  }, [fileUrl]);

  useEffect(() => {
    if (!fileBlob || !socketReady) return;

    if (grace && !hasStartedGrace.current) {
      hasStartedGrace.current = true;
      console.log("Calling GRACE endpoint...");
      handleGrace();
    }
    if (domino && !hasStartedDomino.current) {
      hasStartedDomino.current = true;
      console.log("Calling DOMINO endpoint...");
      handleDomino();
    }
    if (dominopp && !hasStartedDpp.current) {
      hasStartedDpp.current = true;
      console.log("Calling DOMINO++ endpoint...");
      handleDpp();
    }
  }, [socketReady, fileBlob]);

  const handleGrace = async () => {
    if (!fileBlob) return console.error("No fileBlob for GRACE");
    setGraceProgress({ message: "Starting GRACE...", progress: 0 });

    socket.off("progress_grace");
    socket.on("progress_grace", (update) => {
      console.log("GRACE Progress:", update);
      console.log("Updating GRACE progress:", update.message, update.progress);
      setGraceProgress({ message: update.message, progress: update.progress });
      if (update.progress === 100) fetchGraceOutput();
    });

    await fetch("http://localhost:5500/predict_grace", {
      method: "POST",
      body: createFormData(),
    });
    console.log("GRACE request sent.");
  };

  const handleDomino = async () => {
    if (!fileBlob) return console.error("No fileBlob for DOMINO");
    setDominoProgress({ message: "Starting DOMINO...", progress: 0 });

    socket.off("progress_domino");
    socket.on("progress_domino", (update) => {
      console.log("DOMINO Progress:", update);
      console.log("Updating DOMINO progress:", update.message, update.progress);
      setDominoProgress({ message: update.message, progress: update.progress });
      if (update.progress === 100) fetchDominoOutput();
    });

    await fetch("http://localhost:5500/predict_domino", {
      method: "POST",
      body: createFormData(),
    });
    console.log("DOMINO request sent.");
  };

  const handleDpp = async () => {
    if (!fileBlob) return console.error("No fileBlob for DOMINO++");
    setDppProgress({ message: "Starting DOMINO++...", progress: 0 });

    socket.off("progress_dpp");
    socket.on("progress_dpp", (update) => {
      console.log("DOMINO++ Progress:", update);
      console.log("Updating DOMINO++ progress:", update.message, update.progress);
      setDppProgress({ message: update.message, progress: update.progress });
      if (update.progress === 100) fetchDppOutput();
    });

    await fetch("http://localhost:5500/predict_dpp", {
      method: "POST",
      body: createFormData(),
    });
    console.log("DOMINO++ request sent.");
  };

  const createFormData = () => {
    const formData = new FormData();
    if (fileBlob) {
      formData.append("file", fileBlob, "uploaded_image.nii.gz");
    } else {
      console.error("File blob is not available for upload.");
    }
    return formData;
  };

  const fetchGraceOutput = async () => {
    console.log("Fetching GRACE output...");
    const blob = await (await fetch("http://localhost:5500/goutput")).blob();
    const image = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "GraceInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setgInferenceResults(image);
    console.log("GRACE output loaded.");
  };

  const fetchDominoOutput = async () => {
    console.log("Fetching DOMINO output...");
    const blob = await (await fetch("http://localhost:5500/doutput")).blob();
    const image = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "DominoInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setdInferenceResults(image);
    console.log("DOMINO output loaded.");
  };

  const fetchDppOutput = async () => {
    console.log("Fetching DOMINO++ output...");
    const blob = await (await fetch("http://localhost:5500/dppoutput")).blob();
    const image = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "DominoPPInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setdppInferenceResults(image);
    console.log("DOMINO++ output loaded.");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
      {loading ? (
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-lime-800"></div>
      ) : (
        <>
          <div className="w-full p-4">
            {image && (
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
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Results;
