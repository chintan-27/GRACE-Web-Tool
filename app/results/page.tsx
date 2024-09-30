"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import NiiVue from "../components/niivue";
import { NVImage } from "@niivue/niivue";
import { infer } from "../utils/modelHelper"; // Import the infer function

const Results = () => {
    const searchParams = useSearchParams();
    const fileUrl = searchParams.get('file') || "";
    const [image, setImage] = useState<NVImage | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [infLoading, setInfLoading] = useState<boolean>(false);
    const [inferred, setInferred] = useState<boolean>(false);
    const [inferenceResults, setInferenceResults] = useState<NVImage | null>(null); // State to hold inference results as NVImage

    useEffect(() => {
        const loadImage = async () => {
            setLoading(true);
            const response = await fetch(fileUrl);
            const blob = await response.blob();
            const file = new File([blob], "uploaded_image.nii.gz");
            const nvImage = await NVImage.loadFromFile({ file });
            console.log(nvImage.getImageMetadata());
            // Set dimensions to 64, 64, 64
            nvImage.dims = [64, 64, 64];
            setImage(nvImage);
            setLoading(false);
        };


        if (fileUrl) {
            loadImage();
        }
    }, [fileUrl]);

    const convertFloat32ArrayToNifti = (float32Array: Float32Array, dims: number[]): NVImage => {
        // Create a Uint8Array from the Float32Array
        const scaledArray = float32Array.map(value => value * 255);
        const uint8Array = new Uint8Array(float32Array.length); // Create Uint8Array with the same length as Float32Array
        uint8Array.set(float32Array); // Set the values from Float32Array to Uint8Array
        console.log(image?.dims);
        console.log("Length of uint8Array:", uint8Array.length, "Length of Float32Array:", float32Array.length);
        // Ensure dims is set correctly based on the input or default to [64, 64, 64]
        dims = [64, 64, 64];

        // Create a NIfTI header
        const header = NVImage.createNiftiHeader(
            dims,
            [
                image?.getImageMetadata().dx ?? 1,
                image?.getImageMetadata().dy ?? 1,
                image?.getImageMetadata().dz ?? 1,
                image?.getImageMetadata().dt ?? 1
            ],
            undefined,
            2
        ); // 2 is the datatype code for uint8

        // Create the NIfTI data array
        const niftiArray = NVImage.createNiftiArray(dims,[
            image?.getImageMetadata().dx ?? 1,
            image?.getImageMetadata().dy ?? 1,
            image?.getImageMetadata().dz ?? 1,
            image?.getImageMetadata().dt ?? 1
        ], undefined, 2, uint8Array);

        // Create and return a new NVImage

        console.log(niftiArray)
        return NVImage.loadFromBase64({
            base64: Buffer.from(niftiArray).toString('base64'),
            name: "InferenceResult.nii",
            colormap: "ge_color"
        });
    };

    const handleInference = async () => {
        if (!image) return; // Ensure image is loaded before inference
        setInfLoading(true);
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        const file = new File([blob], "uploaded_image.nii.gz");
        const [results, time] = await infer(file);
        console.log(results); // Fixed to access length property correctly
        // Convert Float32Array to NVImage
        const inferenceNVImage = convertFloat32ArrayToNifti(results, image?.dims?.slice(1, 4) || []);
        console.log(image.getImageMetadata());
        console.log(inferenceNVImage.getImageMetadata());
        setInferenceResults(inferenceNVImage);
        setInferred(true);
        console.log('Inference time:', time); // Log inference time
        setInfLoading(false);
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
                    {image && <NiiVue image={image} inferred={inferred} inferredImage={inferenceResults}/>}
                    {/* {image && <NiiVue image={image} inferred={inferred}/>} */}
                </div>
                <div className="flex justify-center">
                    <button className="mt-4 bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded" onClick={handleInference}>
                        {infLoading ?  "Loading ..." : "Inference Using GRACE"}
                    </button>
                </div>
                </div>
            )}
        </div>
    );
}

export default Results;