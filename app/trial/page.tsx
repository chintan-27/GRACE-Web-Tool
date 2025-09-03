"use client";
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef } from 'react'
import { NVImage } from '@niivue/niivue';
import pako from 'pako';
import crypto from "crypto";
import { SignJWT } from "jose";
import NiiVueComponent from '../components/niivue';


const Trial = () => {
    const searchParams = useSearchParams();
    const fileUrl = searchParams.get("file") || "";
    const grace = searchParams.get("grace") === "true";
    const domino = searchParams.get("domino") === "true";
    const dominopp = searchParams.get("dominopp") === "true";

    // Image + loading state
    const [image, setImage] = useState<NVImage | null>(null);
    const [loading, setLoading] = useState(true);
    const [isGz, setIsGz] = useState(false);
    const [fileBlob, setFileBlob] = useState<Blob | null>(null);

    // Progress state
    const [graceProgress, setGraceProgress] = useState({ message: "Setting up the connection to the server", progress: 0 });
    const [dominoProgress, setDominoProgress] = useState({ message: "Setting up the connection to the server", progress: 0 });
    const [dppProgress, setDppProgress] = useState({ message: "", progress: 0 });

    // Inference results
    const [ginferenceResults, setgInferenceResults] = useState<NVImage | null>(null);
    const [dinferenceResults, setdInferenceResults] = useState<NVImage | null>(null);
    const [dppinferenceResults, setdppInferenceResults] = useState<NVImage | null>(null);

    const [messages, setMessages] = useState<string[]>([])
    const [status, setStatus] = useState('idle')
    const [token, setToken] = useState<string>("");

    const startedRef = useRef(false)
    const esRef = useRef<EventSource | null>(null);

    const server = process.env.server || "https://flask.thecka.tech";
    const secret1 = process.env.NEXT_PUBLIC_API_SECRET || "default_secret";
    const secret2 = process.env.NEXT_JWT_SECRET || "default_secret";

    useEffect(() => {
        (async () => {
            const ts = (Date.now() + 15 * 60 * 1000).toString();
            const signature = crypto.createHmac("sha256", secret1).update(ts).digest("hex");
            const key = new TextEncoder().encode(secret2);

            const jwt = await new SignJWT({ ts, signature })
                .setProtectedHeader({ alg: "HS256" })
                .setExpirationTime("15m")
                .sign(key);
            setToken(jwt);
        })().catch(err => console.error("JWT error:", err));
    }, [secret1, secret2]);

    useEffect(() => {
        if (startedRef.current) return

        if (!fileUrl) return;

        startedRef.current = true;
        setLoading(true);

        fetch(fileUrl)
            .then(res => res.blob())
            .then(async blob => {
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


    useEffect(() => {
        // don’t run until we have both token and fileBlob
        if (!token || !fileBlob) return;
        // only open it once
        if (esRef.current) return;

        setStatus("connecting");
        const es = new EventSource(`${server}/stream/${grace}/${domino}/${dominopp}/${token}`);
        esRef.current = es;

        es.onopen = () => {
            setStatus("connected");
        };

        es.onmessage = (e) => {
            // parse & log each event as soon as it arrives
            console.log(e)
	    try {
                const { model, message, progress } = JSON.parse(e.data);
		if(model == "grace"){
                	setGraceProgress({message: message, progress: progress});
                	if(progress === 100) {
                    		fetchGraceOutput();
                	}
		} else if (model == "domino"){
                	setDominoProgress({message: message, progress: progress});
                	if(progress === 100) {
                    		fetchDominoOutput();
			}
		}
            } catch (err) {
		console.log("in on message")
                console.error("SSE error:", err);
                if(grace) setGraceProgress({ message: e.data, progress: 0 });
                if(domino) setDominoProgress({ message: e.data, progress: 0 });
            }
            if (e.data.includes("All done")) {
                setStatus("done");
                es.close();
            }
        };

        es.onerror = (err) => {
	    console.log("In error")
            if (es.readyState !== EventSource.CLOSED) {
                console.error("SSE error:", err);
                setStatus("error");
            }
            es.close();
        };

        return () => {
            es.close();
        };
    }, [token, fileBlob]);

    useEffect(() => {
        if (status === 'connected') {
            if (grace) {
                setGraceProgress({ message: "Starting GRACE…", progress: 0 });
                fetch(server + "/predict/grace", {
                    method: "POST",
                    headers: { "X-Signature": token },
                    body: createFormData()
                })
                    .then(r => { if (!r.ok) throw new Error(r.statusText) })
                    .catch(err => setGraceProgress({ message: err.message, progress: 0 }));
            }
            if (domino) {
                setDominoProgress({ message: "Starting DOMINO…", progress: 0 });
                fetch(server + "/predict/domino", {
                    method: "POST",
                    headers: { "X-Signature": token },
                    body: createFormData()
                })
                    .then(r => { if (!r.ok) throw new Error(r.statusText) })
                    .catch(err => setDominoProgress({ message: err.message, progress: 0 }));
            }
            if (dominopp) {
                setDppProgress({ message: "Starting DOMINO++…", progress: 0 });
                fetch(server + "/predict_dpp", {
                    method: "POST",
                    headers: { "X-Signature": token },
                    body: createFormData()
                })
                    .then(r => { if (!r.ok) throw new Error(r.statusText) })
                    .catch(err => setDppProgress({ message: err.message, progress: 0 }));
            }

        }
    }, [status]);

    // Helpers
    const createFormData = () => {
        const fd = new FormData();
        if (fileBlob) {
            fd.append("file", fileBlob, fileBlob instanceof File ? fileBlob.name : "uploaded_image.nii");
        }
        return fd;
    };

    const fetchGraceOutput = async () => {
        console.log("Fetching GRACE output…");
        const res = await fetch(server + "/output/grace", {
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
        console.log("Fetching DOMINO output…");
        const res = await fetch(server + "/output/domino", {
            method: "GET",
            headers: { "X-Signature": token },
        });
        if (!res.ok) {
            setGraceProgress({ message: res.statusText, progress: 0 });
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
    // const startProcessing = async () => {
    //     setStatus('processing')
    //     const res = await fetch(`http://localhost:5500/process/${clientId}`, {
    //         method: 'POST',
    //     })
    //     const data = await res.json()
    //     console.log(data)
    // }

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
}
export default Trial;
