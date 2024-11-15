// modelhelper.tsx

import * as ort from 'onnxruntime-web';

/**
 * Processes the model's output to get class predictions.
 * @param outputData The output data from the model as a Float32Array.
 * @param outputDims The dimensions of the output tensor.
 * @returns A Uint8Array containing the class predictions.
 */
const processModelOutput = (outputData: Float32Array, outputDims: readonly number[]): Uint8Array => {
  const [batchSize, numClasses, ...spatialDims] = outputDims;
  const spatialSize = spatialDims.reduce((a, b) => a * b, 1);
  const predictions = new Uint8Array(spatialSize);

  for (let idx = 0; idx < spatialSize; idx++) {
    let maxProb = outputData[idx];
    let maxClass = 0;

    for (let c = 1; c < numClasses; c++) {
      const prob = outputData[c * spatialSize + idx];
      if (prob > maxProb) {
        maxProb = prob;
        maxClass = c;
      }
    }

    predictions[idx] = maxClass * 1700;
  }

  return predictions;
};

/**
 * Runs the ONNX model inference.
 * @param inputTensor The input tensor to the model.
 * @returns A promise that resolves to a tuple containing the class predictions and inference time.
 */
export const infer = async (inputTensor: ort.Tensor): Promise<[Uint8Array, number]> => {
  try {
    // Load the ONNX model
    const session = await ort.InferenceSession.create('grace.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    const startTime = performance.now();

    // Get the model's input and output names
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    // Prepare the feeds (inputs to the model)
    const feeds: Record<string, ort.Tensor> = {};
    feeds[inputName] = inputTensor;

    // Run the model
    const outputData = await session.run(feeds);

    const endTime = performance.now();
    const timeTaken = endTime - startTime;

    // Get the output tensor
    const outputTensor = outputData[outputName];
    const outputArray = outputTensor.data as Float32Array;
    const outputDims = outputTensor.dims;
    
    // Process the output to get class predictions
    const predictions = processModelOutput(outputArray, outputDims);
    const classCounts: Record<number, number> = {};
    for (let i = 0; i < predictions.length; i++) {
      const classId = predictions[i];
      classCounts[classId] = (classCounts[classId] || 0) + 1;
    }
    console.log('Number of pixels for each class:', classCounts);

    return [predictions, timeTaken];
  } catch (error) {
    console.error('Model inference failed:', error);
    throw error;
  }
};

export default infer;
