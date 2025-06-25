"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { NVImage } from "@niivue/niivue";
import pako from "pako";
import NiiVueComponent from "../components/niivue";
import { createSocket } from "./socket";
import crypto from "crypto";
import { SignJWT } from "jose";
import { Socket } from "socket.io-client";

const Results = () => {
  // URL params
  const searchParams = useSearchParams();
  const fileUrl   = searchParams.get("file")     || "";
  const grace     = searchParams.get("grace")   === "true";
  const domino    = searchParams.get("domino")  === "true";
  const dominopp  = searchParams.get("dominopp")==="true";

  // Image + loading state
  const [image, setImage] = useState<NVImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGz, setIsGz]   = useState(false);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);

  const [graceDone, setGraceDone]       = useState(false);
  const [dominoDone, setDominoDone]     = useState(false);
  const [dominoppDone, setDominoppDone] = useState(false);

  // Progress state
  const [graceProgress, setGraceProgress]   = useState({ message: "", progress: 0 });
  const [dominoProgress, setDominoProgress] = useState({ message: "", progress: 0 });
  const [dppProgress,    setDppProgress]    = useState({ message: "", progress: 0 });

  // Inference results
  const [ginferenceResults,   setgInferenceResults]   = useState<NVImage | null>(null);
  const [dinferenceResults,   setdInferenceResults]   = useState<NVImage | null>(null);
  const [dppinferenceResults, setdppInferenceResults] = useState<NVImage | null>(null);

  // Socket + auth
  const [socketReady, setSocketReady] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [token, setToken] = useState<string>("");

  // Env
  const server  = process.env.server                 || "https://flask.thecka.tech";
  const secret1 = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";
  const secret2 = process.env.NEXT_JWT_SECRET       || "default_secret";

  // 1️⃣ Generate JWT on mount
  useEffect(() => {
    (async () => {
      const ts = (Date.now() + 15 * 60 * 1000).toString();
      const signature = crypto.createHmac("sha256", secret1).update(ts).digest("hex");
      const key = new TextEncoder().encode(secret2);

      const jwt = await new SignJWT({ ts, signature })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("15m")
        .sign(key);

      console.log("✅ Generated token:", jwt);
      setToken(jwt);
    })().catch(err => console.error("❌ JWT error:", err));
  }, [secret1, secret2]);

  // 2️⃣ Load image
  useEffect(() => {
    if (!fileUrl) return;
    setLoading(true);

    fetch(fileUrl)
      .then(res => res.blob())
      .then(async blob => {
        setFileBlob(blob);
        const arr = new Uint8Array(await blob.arrayBuffer());
        const gzipped = arr[0] === 0x1f && arr[1] === 0x8b;
        setIsGz(gzipped);

        const file = gzipped
          ? new File([pako.inflate(arr)], "uploaded_image.nii")
          : new File([blob], "uploaded_image.nii");
        
          setFileBlob(file);

        const nv = await NVImage.loadFromFile({ file, colormap: "gray" });
        setImage(nv);
        console.log("✅ Image loaded");
      })
      .catch(err => console.error("❌ Load image error:", err))
      .finally(() => setLoading(false));
  }, [fileUrl]);

  // 3️⃣ Socket lifecycle + listeners + REST + cleanup
  useEffect(() => {
    if (!token || !fileBlob) return;
    let finished = 0;
    const total = [grace, domino, dominopp].filter(x => x).length;

    const cleanup = () => {
      const sock = socketRef.current;
      if (!sock) return;
      sock.off();
      sock.disconnect();
      console.log("🚪 Socket disconnected");
    };

    (async () => {
      const sock = await createSocket(token);
      socketRef.current = sock;

      sock.on("connect", () => {
        console.log("✅ Socket connected:", sock.id);
        setSocketReady(true);

        // fire endpoints
        if (grace && !graceDone) {
          setGraceProgress({ message: "Starting GRACE…", progress: 0 });
          fetch(server + "/predict_grace", {
            method: "POST",
            headers: { "X-Signature": token },
            body: createFormData()
          })
            .then(r => { if (!r.ok) throw new Error(r.statusText) })
            .catch(err => setGraceProgress({ message: err.message, progress: 0 }));
        }
        if (domino && !dominoDone) {
          setDominoProgress({ message: "Starting DOMINO…", progress: 0 });
          fetch(server + "/predict_domino", {
            method: "POST",
            headers: { "X-Signature": token },
            body: createFormData()
          })
            .then(r => { if (!r.ok) throw new Error(r.statusText) })
            .catch(err => setDominoProgress({ message: err.message, progress: 0 }));
        }
        if (dominopp && !dominoppDone) {
          setDppProgress({ message: "Starting DOMINO++…", progress: 0 });
          fetch(server + "/predict_dpp", {
            method: "POST",
            headers: { "X-Signature": token },
            body: createFormData()
          })
            .then(r => { if (!r.ok) throw new Error(r.statusText) })
            .catch(err => setDppProgress({ message: err.message, progress: 0 }));
        }
      });

      const makeHandler = (
        setFn: typeof setGraceProgress | typeof setDominoProgress | typeof setDppProgress,
        fetchOut: () => Promise<void>
      ) => (upd: { message: string; progress: number }) => {
        setFn({ message: upd.message, progress: upd.progress });
        if (upd.progress === 100) {
          fetchOut().finally(() => {
            finished += 1;
            if (finished === total) cleanup();
          });
        }
      };

      sock.on("progress_grace",  makeHandler(setGraceProgress,  fetchGraceOutput));
      sock.on("progress_domino", makeHandler(setDominoProgress, fetchDominoOutput));
      sock.on("progress_dpp",    makeHandler(setDppProgress,    fetchDppOutput));

      if (!sock.connected) sock.connect();
    })().catch(err => console.error("❌ Socket setup error:", err));

    return cleanup;
  }, [token, fileBlob, grace, domino, dominopp]);

  // Helpers
  const createFormData = () => {
    const fd = new FormData();
    if (fileBlob) {
      fd.append("file", fileBlob, isGz ? "uploaded_image.nii.gz" : "uploaded_image.nii");
    }
    return fd;
  };

  const fetchGraceOutput = async () => {
    setGraceDone(true);
    console.log("Fetching GRACE output…");
    const res = await fetch(server + "/goutput", {
      method: "GET",
      headers: { "X-Signature": token },
    });
    if (!res.ok) {
      setGraceProgress({ message: res.statusText, progress: 0 });
      return;
    }
    const blob = await res.blob();
    const img = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "GraceInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setgInferenceResults(img);
    console.log("✅ GRACE output loaded");
  };

  const fetchDominoOutput = async () => {
    setDominoDone(true);
    console.log("Fetching DOMINO output…");
    const res = await fetch(server + "/doutput", {
      method: "GET",
      headers: { "X-Signature": token },
    });
    if (!res.ok) {
      setDominoProgress({ message: res.statusText, progress: 0 });
      return;
    }
    const blob = await res.blob();
    const img = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "DominoInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setdInferenceResults(img);
    console.log("✅ DOMINO output loaded");
  };

  const fetchDppOutput = async () => {
    setDominoppDone(true);
    console.log("Fetching DOMINO++ output…");
    const res = await fetch(server + "/dppoutput", {
      method: "GET",
      headers: { "X-Signature": token },
    });
    if (!res.ok) {
      setDppProgress({ message: res.statusText, progress: 0 });
      return;
    }
    const blob = await res.blob();
    const img = await NVImage.loadFromFile({
      file: new File([await blob.arrayBuffer()], "DominoPPInference.nii.gz"),
      colormap: "jet",
      opacity: 1,
    });
    setdppInferenceResults(img);
    console.log("✅ DOMINO++ output loaded");
  };

  // Render
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white">
      {loading ? (
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-lime-800"></div>
      ) : (
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
      )}
    </div>
  );
};

export default Results;
