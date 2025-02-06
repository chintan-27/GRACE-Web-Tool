import { NVImage } from "@niivue/niivue";
import { Tensor } from "onnxruntime-web";

/**
 * Normalizes the input data to a specified range.
 * @param inputData The input data as a Float32Array.
 * @returns A Float32Array with values normalized to [0, 1].
 */
const normalizeToRange = (inputData: Float32Array) => {
	const a_min = 0;
	const a_max = 255;
	const b_min = 0;
	const b_max = 1;

	const normalizedData = new Float32Array(inputData.length);

	for (let i = 0; i < inputData.length; i++) {
		let scaledValue =
			((inputData[i] - a_min) / (a_max - a_min)) * (b_max - b_min) + b_min;
		scaledValue = Math.min(Math.max(scaledValue, b_min), b_max);
		normalizedData[i] = scaledValue;
	}

	return normalizedData;
};

/**
 * Crops a 3D volume of data to the specified dimensions starting from a given position.
 */
const cropData = (
	inputData: Float32Array,
	inputDims: [number, number, number],
	start: [number, number, number],
	cropDims: [number, number, number]
): Float32Array => {
	const [depth, height, width] = inputDims;
	const [startZ, startY, startX] = start;
	const [cropDepth, cropHeight, cropWidth] = cropDims;

	const croppedData = new Float32Array(cropDepth * cropHeight * cropWidth);
	let outputIndex = 0;

	for (let z = 0; z < cropDepth; z++) {
		const inputZ = startZ + z;
		if (inputZ >= depth) continue;

		for (let y = 0; y < cropHeight; y++) {
			const inputY = startY + y;
			if (inputY >= height) continue;

			const inputIndex = inputZ * height * width + inputY * width + startX;
			const sliceLength = Math.min(cropWidth, width - startX);
			const inputSlice = inputData.subarray(inputIndex, inputIndex + sliceLength);

			croppedData.set(inputSlice, outputIndex);
			outputIndex += sliceLength;
		}
	}

	return croppedData;
};

/**
 * Generates sliding window positions for cropping a volume.
 */
const generateSlidingWindowPositions = (
	dims: [number, number, number],
	cropSize: number,
	stepSize: number
): [number, number, number][] => {
	const [depth, height, width] = dims;
	const positions: [number, number, number][] = [];

	for (let z = 0; z <= depth - cropSize; z += stepSize) {
		for (let y = 0; y <= height - cropSize; y += stepSize) {
			for (let x = 0; x <= width - cropSize; x += stepSize) {
				positions.push([z, y, x]);
			}
		}
	}
	return positions;
};

/**
 * Converts an NVImage to multiple ONNX Runtime Tensors for sliding window inference.
 */
export async function fileToTensor(nvImage: NVImage): Promise<{
	inputTensors: Tensor[];
	positions: [number, number, number][];
	cropDims: [number, number, number];
}> {
	const inputData = nvImage.img;
	if (!inputData) throw new Error("Input data is undefined");

	const float32Data =
		inputData instanceof Float32Array ? inputData : new Float32Array(inputData);
	const scaledData = normalizeToRange(float32Data);

	const dimsRAS = nvImage.dimsRAS;
	if (!dimsRAS || dimsRAS.length < 4) throw new Error("Invalid image dimensions");

	const [t, z, y, x] = dimsRAS;
	const inputDims: [number, number, number] = [z || 1, y || 1, x || 1];

	const cropSize = 64;
	const stepSize = 32;

	const positions = generateSlidingWindowPositions(inputDims, cropSize, stepSize);
	const cropDims: [number, number, number] = [cropSize, cropSize, cropSize];

	const inputTensors = positions.map((start) => {
		const croppedData = cropData(scaledData, inputDims, start, cropDims);
		const dims = [1, 1, cropSize, cropSize, cropSize];
		return new Tensor("float32", croppedData, dims);
	});

	return { inputTensors, positions, cropDims };
}

export default fileToTensor;
