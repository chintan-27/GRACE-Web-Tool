"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import NiiVue from "../components/niivue";
import { NVImage } from "@niivue/niivue";
import pako from "pako";

const Results = () => {
  const searchParams = useSearchParams();
  const fileUrl = searchParams.get("file") || "";
  const [image, setImage] = useState<NVImage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [infLoading, setInfLoading] = useState<boolean>(false);
  const [inferenceResults, setInferenceResults] = useState<NVImage | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      setLoading(true);
      try {
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        let file: File;
        const isGzipped = uint8Array[0] === 0x1f && uint8Array[1] === 0x8b;

        if (isGzipped) {
          const decompressedData = pako.inflate(uint8Array);
          file = new File([decompressedData], "uploaded_image.nii");
        } else {
          file = new File([blob], "uploaded_image.nii");
        }

        const nvImage = await NVImage.loadFromFile({ file, colormap: "gray" });
        setImage(nvImage);
      } catch (error) {
        console.error("Error loading image:", error);
      } finally {
        setLoading(false);
      }
    };

    if (fileUrl) {
      loadImage();
    }
  }, [fileUrl]);

  const handleInference = async () => {
    if (!image) return;
    setInfLoading(true);

    try {
      // Prepare the file to send to the API
      const formData = new FormData();
      const fileBlob = await fetch(fileUrl).then((res) => res.blob());
      formData.append("file", fileBlob, "uploaded_image.nii.gz");

      const response = await fetch("http://localhost:5500/predict", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch inference results from the API");
      }

      const inferredBlob = await response.blob();

      const inferredImage = await NVImage.loadFromFile({
        file: new File([await inferredBlob.arrayBuffer()], "InferenceResult.nii.gz"),
        colormap:'jet',
        opacity: 1,
      });

      setInferenceResults(inferredImage);
    } catch (error) {
      console.error("Inference error:", error);
    } finally {
      setInfLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen">
      {loading ? (
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-lime-800"></div>
        </div>
      ) : (
        <div>
          <div className="p-4 bg-white shadow-md m-10 w-50">
            {image && (
              <NiiVue
                image={image}
                inferredImage={inferenceResults}
              />
            )}
          </div>
          <div className="flex justify-center mt-4">
            <button
              className="bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded"
              onClick={handleInference}
              disabled={infLoading}
            >
              {infLoading ? "Processing..." : "Inference Using API"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Results;
