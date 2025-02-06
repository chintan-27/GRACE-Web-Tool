import * as ort from "onnxruntime-web";

/**
 * Processes the model's output to get class predictions.
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

		predictions[idx] = maxClass;
	}

	return predictions;
};

/**
 * Runs sliding window inference over an entire image.
 */
export const infer = async (
	inputTensors: ort.Tensor[],
	positions: [number, number, number][],
	cropDims: [number, number, number],
	inputDims: [number, number, number],
	onUpdateProgressiveResults?: (progressivePredictions: Uint8Array) => void
): Promise<[Uint8Array, Uint8Array]> => {
	try {
		// const executionProviders = ort.env.wasm.hasWebGPU ? ["webgpu"] : ["wasm"];
		const session = await ort.InferenceSession.create("grace.onnx", {
			executionProviders: ["wasm"],
			graphOptimizationLevel: "all",
		});

		const [depth, height, width] = inputDims;
		const fullPredictions = new Uint8Array(depth * height * width);

		for (let i = 0; i < inputTensors.length; i++) {
			const inputTensor = inputTensors[i];
			const [startZ, startY, startX] = positions[i];

			const outputData = await session.run({ [session.inputNames[0]]: inputTensor });
			const outputArray = outputData[session.outputNames[0]].data as Float32Array;
			const outputDims = outputData[session.outputNames[0]].dims;

			// const predictions = new Uint8Array(outputDims.reduce((a, b) => a * b, 1)).map(() => Math.floor(Math.random() * 256));
			const predictions = processModelOutput(outputArray, outputDims);

			for (let dz = 0; dz < cropDims[0]; dz++) {
				const inputZ = startZ + dz;
				for (let dy = 0; dy < cropDims[1]; dy++) {
					const inputY = startY + dy;
					const baseInputIndex = inputZ * height * width + inputY * width + startX;
					const baseOutputIndex = dz * cropDims[1] * cropDims[2] + dy * cropDims[2];
					const sliceLength = Math.min(cropDims[2], width - startX);

					fullPredictions.set(
						predictions.subarray(baseOutputIndex, baseOutputIndex + sliceLength),
						baseInputIndex
					);
				}
			}

			// Call the update callback after processing this window
			if (onUpdateProgressiveResults) {
				onUpdateProgressiveResults(new Uint8Array(fullPredictions));
			}
		}

		return [fullPredictions, fullPredictions]; // Return final predictions
	} catch (error) {
		console.error("Model inference failed:", error);
		throw error;
	}
};

export default infer;
