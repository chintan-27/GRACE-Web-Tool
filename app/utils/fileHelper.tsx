import { Tensor } from 'onnxruntime-web';
import { NVImage } from "@niivue/niivue";

async function fileToTensor(file: File): Promise<Tensor> {
    try {
        const nvImage = await NVImage.loadFromFile({ file });
        const originalWidth = nvImage.dims?.[1] ?? 0;
        const originalHeight = nvImage.dims?.[2] ?? 0;
        const originalDepth = nvImage.dims?.[3] ?? 0;
        const newWidth = 64;
        const newHeight = 64;
        const newDepth = 64;

        const inputData = nvImage.toUint8Array();

        return new Promise((resolve, reject) => {
            import("../webassembly/resize_nifti").then((Module) => {
                // Ensure the WebAssembly module is loaded before using it
                if (Module.resize_nifti) {
                    const outputData = new Uint8Array(newWidth * newHeight * newDepth);

                    // Call the WebAssembly function to resize the NIfTI image
                    Module.resize_nifti(inputData, originalWidth, originalHeight, originalDepth, outputData, newWidth, newHeight, newDepth);

                    // Convert Uint8Array to Float32Array
                    const float32Data = new Float32Array(outputData.length);
                    for (let i = 0; i < outputData.length; i++) {
                        float32Data[i] = outputData[i] / 255.0; // Normalize to [0, 1]
                    }

                    const dims = [1, newDepth, newHeight, newWidth]; // Shape of the tensor: [batch, depth, height, width]
                    const inputTensor = new Tensor("float32", float32Data, dims);
                    resolve(inputTensor);
                } else {
                    reject(new Error("WebAssembly module not loaded correctly"));
                }
            }).catch((error) => {
                console.error("Failed to load WebAssembly module:", error);
                reject(error);
            });
        });
    } catch (error) {
        console.error("Error in fileToTensor:", error);
        throw error;
    }
}

export { fileToTensor };