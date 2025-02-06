"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import NiiVue from "../components/niivue";
import { NVImage } from "@niivue/niivue";
import pako from "pako";

const Results = () => {
	const searchParams = useSearchParams();
	const fileUrl = searchParams.get("file") || "";
	const [loading, setLoading] = useState<boolean>(true);
	const [image, setImage] = useState<NVImage | null>(null);
	const [spatialSize, setSpatialSize] = useState("64,64,64");
	const [selectedModel, setSelectedModel] = useState("GRACE");
	const [infLoading, setInfLoading] = useState<boolean>(false);
	const [inferenceResults, setInferenceResults] = useState<NVImage | null>(null);
	const [progress, setProgress] = useState<{ message: string; progress: number }>({
		message: "",
		progress: 0,
	});

	const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const model = event.target.value;
		setSelectedModel(model);

		// Update spatial size based on selected model
		if (model === "GRACE") {
			setSpatialSize("64,64,64");
		} else if (model === "DOMINO") {
			setSpatialSize("128,128,128");
		} else if (model === "DOMINOPP") {
			setSpatialSize("64,64,64");
		}
	};

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
		setProgress({ message: "Starting inference...", progress: 0 });

		try {
			// Prepare the file to send to the API
			const formData = new FormData();
			const fileBlob = await fetch(fileUrl).then((res) => res.blob());
			formData.append("file", fileBlob, "uploaded_image.nii.gz");

			// Add additional parameters
			formData.append("spatial_size", spatialSize); // Use the updated spatial size
			formData.append("num_classes", "12"); // Example value
			formData.append("model_path", `models/${selectedModel}.pth`); // Example value
			formData.append("dataparallel", "false"); // Example value
			formData.append("num_gpu", "1"); // Example value
			formData.append("model", selectedModel); // Use the selected model


			const response = await fetch("http://localhost:5500/predict", {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				throw new Error("Failed to fetch inference results from the API");
			}

			// Create an EventSource to listen for progress updates
			const eventSource = new EventSource("http://localhost:5500/events");

			eventSource.onmessage = (event) => {
				const data = JSON.parse(event.data);
				setProgress({ message: data.message, progress: data.progress });
				if (data.message === "Processing completed successfully!") {
					fetchOutput();
				}

			};

			eventSource.onerror = (error) => {
				console.error("EventSource failed:", error);
				eventSource.close();
				setInfLoading(false);
			};



		} catch (error) {
			console.error("Inference error:", error);
		}

		async function fetchOutput() {

			const outputResponse = await fetch("http://localhost:5500/output")
			const inferredBlob = await outputResponse.blob();
			const inferredImage = await NVImage.loadFromFile({
				file: new File([await inferredBlob.arrayBuffer()], "InferenceResult.nii.gz"),
				colormap: 'jet',
				opacity: 1,
			});
			setInfLoading(true);
			setInferenceResults(inferredImage);
		}
	};

	return (
		<div>

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
						<div className="mb-4">
							<label htmlFor="model-select" className="mr-2">Select Model:</label>
							<select
								id="model-select"
								value={selectedModel}
								onChange={handleModelChange}
								className="border rounded p-2"
							>
								<option value="GRACE">Grace</option>
								<option value="DOMINO">Domino</option>
								<option value="DOMINO++">Domino++</option>
							</select>
						</div>
						{infLoading ?
							<div className="flex justify-center mt-4">
								<div className="w-1/2 block bg-gray-200 rounded-full dark:bg-gray-700">
									<div className="bg-blue-600 text-xs font-medium text-blue-100 text-center p-0.5 leading-none rounded-full" style={{ width: progress.progress.toString() + "%" }}>{progress.progress.toString() + "%"}</div>
								</div>
							</div>
							: <span></span>}
						<br />
						<div className="flex justify-center mt-4">
							<button
								className="bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded"
								onClick={handleInference}
								disabled={infLoading}
							>
								{infLoading ? progress.message : "Inference Using API"}
							</button>



						</div>
					</div>
				)}

			</div>

		</div>
	);
};

export default Results;
