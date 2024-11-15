// filehelper.tsx

import { NVImage } from "@niivue/niivue";
import { Tensor } from "onnxruntime-web";

/**
 * Converts an NVImage to an ONNX Runtime Tensor suitable for model inference.
 * @param nvImage The NVImage instance containing the image data.
 * @returns A promise that resolves to an ONNX Runtime Tensor.
 */

const normalizeToRange = (inputData: Float32Array) => {
    const a_min = 0;
    const a_max = 255;
    const b_min = 0;
    const b_max = 1;
  
    const normalizedData = new Float32Array(inputData.length);
  
    for (let i = 0; i < inputData.length; i++) {
      // Scale value from [0, 255] to [0, 1]
      let scaledValue = ((inputData[i] - a_min) / (a_max - a_min)) * (b_max - b_min) + b_min;
  
      // Clip the value to the range [0, 1]
      scaledValue = Math.min(Math.max(scaledValue, b_min), b_max);

  
      normalizedData[i] = scaledValue;

    }
  
    return normalizedData;
  };
  

export async function fileToTensor(nvImage: NVImage): Promise<Tensor> {
  // Extract image data from NVImage
  const inputData = nvImage.img; // Image data as Float32Array or Uint8Array
  if (!inputData) {
    throw new Error("Input data is undefined");
  }

  // Normalize the data according to model requirements
  // For example, normalize to [0, 1] by dividing by the maximum value
  let maxVal = 0;
  for (let i = 0; i < inputData.length; i++) {
    if (inputData[i] > maxVal) {
      maxVal = inputData[i];
    }
  }

  if (maxVal === 0) {
    throw new Error("Maximum value in input data is zero, cannot normalize");
  }

  const float32Data = new Float32Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    float32Data[i] = inputData[i];
  }

  const scaledData = normalizeToRange(float32Data);

  // Get dimensions from NVImage
  const dimsRAS = nvImage.dimsRAS; // [t, z, y, x]
  if (!dimsRAS || dimsRAS.length < 4) {
    throw new Error("Invalid image dimensions");
  }

  // Prepare tensor dimensions
  // Model expects input shape: [N, C, D, H, W]
  // We use dimsRAS to get [t, z, y, x] and map to [D, H, W]
  const [t, z, y, x] = dimsRAS;

  // Handle cases where time dimension 't' is undefined or zero
  const depth = z || 1;
  const height = y || 1;
  const width = x || 1;

  const dims = [1, 1, depth, height, width]; // [N, C, D, H, W]

  // Create the input tensor
  const inputTensor = new Tensor("float32", scaledData, dims);

  return inputTensor;
}

export default fileToTensor;
