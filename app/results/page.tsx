"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import NiiVue from "../components/niivue"; // Adjust the path as needed
import { NVImage } from "@niivue/niivue";
import { infer } from "../utils/modelHelper"; // Corrected casing
import fileToTensor from "../utils/fileHelper"; // Corrected casing
import pako from "pako";

const Results = () => {
  const searchParams = useSearchParams();
  const fileUrl = searchParams.get("file") || "";
  const [image, setImage] = useState<NVImage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [infLoading, setInfLoading] = useState<boolean>(false);
  const [inferred, setInferred] = useState<boolean>(false);
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
          // Decompress the .nii.gz file
          const decompressedData = pako.inflate(uint8Array);
          file = new File([decompressedData], "uploaded_image.nii");
        } else {
          // Use the blob directly for .nii files
          file = new File([blob], "uploaded_image.nii");
        }

        const nvImage = await NVImage.loadFromFile({ file, colormap: 'gray' });
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

  const convertUint8ArrayToNVImage = (predictions: Uint8Array, dimsRAS: number[]): NVImage => {
    const [t, z, y, x] = dimsRAS;
    const dimensions = [x, y, z];
    const pixDims = [
      image?.getImageMetadata().dx ?? 1,
      image?.getImageMetadata().dy ?? 1,
      image?.getImageMetadata().dz ?? 1,
      image?.getImageMetadata().dt ?? 1
    ];

    // Create NIfTI array
    const niftiArray = NVImage.createNiftiArray(dimensions, pixDims, undefined, 2, predictions); // Data type 2 for Uint8

    // Convert the NIfTI array to base64
    const base64Data = Buffer.from(niftiArray).toString('base64');

    // Load NVImage from base64 data
    const nvImage = NVImage.loadFromBase64({
      base64: base64Data,
      name: 'InferenceResult.nii.gz',
      colormap: 'nih',
      opacity: 1,
    });

    return nvImage;
  };

  // Copy spatial attributes to ensure correct overlay
  const setSpatialAttributes = (outputImage: NVImage, inputImage: NVImage) => {
    outputImage.frac2mm = inputImage.frac2mm;
    outputImage.matRAS = inputImage.matRAS;
    outputImage.pixDims = inputImage.pixDims;
    outputImage.img2RASstart = inputImage.img2RASstart;
    outputImage.img2RASstep = inputImage.img2RASstep;
    // Copy other relevant attributes if necessary
  };

  const handleInference = async () => {
    if (!image) return; // Ensure image is loaded before inference
    setInfLoading(true);

    try {
      // Prepare the input tensor from the NVImage
      const inputTensor = await fileToTensor(image);

      // Run inference
      const [predictions, timeTaken] = await infer(inputTensor);
      console.log(`Inference completed in ${timeTaken.toFixed(2)} ms`);
      const dimsRAS = image.dimsRAS || []; // Ensure dimsRAS is defined
      const inferenceNVImage = convertUint8ArrayToNVImage(predictions, dimsRAS);
      setSpatialAttributes(inferenceNVImage, image);
      setInferenceResults(inferenceNVImage);
      setInferred(true);
    } catch (Error){
      console.error("Inference error:", Error);
    } finally {
      setInfLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center w-screen h-screen">
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
                inferred={inferred}
                inferredImage={inferenceResults}
              />
            )}
          </div>
          <div className="flex justify-center">
            <button
              className="mt-4 bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded"
              onClick={handleInference}
              disabled={infLoading}
            >
              {infLoading ? "Processing..." : "Inference Using GRACE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Results;
