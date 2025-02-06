"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import NiiVue from "../components/niivue";
import { NVImage } from "@niivue/niivue";
import { infer } from "../utils/modelHelper"; // Fixed casing
import fileToTensor from "../utils/fileHelper"; // Fixed casing
import pako from "pako";

const Results = () => {
	const searchParams = useSearchParams();
	const fileUrl = searchParams.get("file") || "";
	const [image, setImage] = useState<NVImage | null>(null);
	const [loading, setLoading] = useState<boolean>(true);
	const [infLoading, setInfLoading] = useState<boolean>(false);
	const [inferred, setInferred] = useState<boolean>(false);
	const [inferenceResults, setInferenceResults] = useState<NVImage | null>(null);
	const [progressivePredictions, setProgressivePredictions] = useState<Uint8Array | null>(null);

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

	const convertUint8ArrayToNVImage = (
		predictions: Uint8Array,
		dimsRAS: number[],
		image: NVImage
	): NVImage => {
		const [t, z, y, x] = dimsRAS;
		const dimensions = [x, y, z];

		const niftiArray = NVImage.createNiftiArray(
			dimensions,
			image.pixDims,
			undefined,
			2,
			predictions
		);

		const base64Data = Buffer.from(niftiArray).toString("base64");

		return NVImage.loadFromBase64({
			base64: base64Data,
			name: "InferenceResult.nii.gz",
			colormap: "nih",
			opacity: 1,
		});
	};

	const handleInference = async () => {
		if (!image) return;
		setInfLoading(true);

		try {
			const { inputTensors, positions, cropDims } = await fileToTensor(image);
			if (!image.dimsRAS || image.dimsRAS.length < 4) {
				throw new Error("Invalid image dimensions");
			}
			const inputDims: [number, number, number] = [
				image.dimsRAS[1],
				image.dimsRAS[2],
				image.dimsRAS[3],
			];

			const [progressivePreds, finalPredictions] = await infer(
				inputTensors,
				positions,
				cropDims,
				inputDims,
				(currentPredictions) => {
					// Update the progressive predictions
					if (image.dimsRAS) {
						const progressiveNVImage = convertUint8ArrayToNVImage(
							currentPredictions,
							image.dimsRAS,
							image
						);
						setInferenceResults(progressiveNVImage);
					}
				}
			);

			// Final result after full inference
			const finalNVImage = convertUint8ArrayToNVImage(
				finalPredictions,
				image.dimsRAS,
				image
			);

			setInferenceResults(finalNVImage);
			setProgressivePredictions(finalPredictions);
			setInferred(true);
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
							{infLoading ? "Processing..." : "Inference Using GRACE"}
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

export default Results;
