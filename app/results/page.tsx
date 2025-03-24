"use client";


import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NVImage } from "@niivue/niivue";
import pako from "pako";
import NiiVueComponent from "../components/niivue";
import socket from "./socket";

const Results = () => {
	const searchParams = useSearchParams();
	const fileUrl = searchParams.get("file") || "";
	const [loading, setLoading] = useState<boolean>(true);
	const [image, setImage] = useState<NVImage | null>(null);
	const [spatialSize, setSpatialSize] = useState("64,64,64");
	const [selectedModel, setSelectedModel] = useState("GRACE");
	const [infLoading, setInfLoading] = useState<boolean>(false);
	const [ginferenceResults, setgInferenceResults] = useState<NVImage | null>(null);
	const [dinferenceResults, setdInferenceResults] = useState<NVImage | null>(null);
	const [dppinferenceResults, setdppInferenceResults] = useState<NVImage | null>(null);
	const [progress, setProgress] = useState<{ message: string; progress: number }>({
		message: "",
		progress: 0,
	});
	const [disabledButton, setDisabledButton] = useState<boolean>(true);

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

	useEffect(() => {
		socket.on("progress_update", (update) => {
			console.log(update);
			setProgress({ message: update.message, progress: update.progress });
			if (update.message === "Processing completed successfully!") {
				fetchOutput();
			}
		});
	
		socket.on("error", (update) => {
			const data = JSON.parse(update);
			console.log(data);
		});
	
		// Cleanup function to remove event listeners when component unmounts
		return () => {
			socket.off("progress_update");
			socket.off("error");
		};
	}, []); // Empty dependency array means this runs once on mount
	

	const handleInference = async () => {
		if (!image) return;
		setInfLoading(true);
		setProgress({ message: "Starting inference...", progress: 0 });

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

			if(!socket.connected) socket.connect();
			await fetch("http://localhost:5500/events", {
				mode: 'no-cors'  // Disable CORS checks
			});
			// Create an EventSource to listen for progress updates
			// const eventSource = new EventSource("http://localhost:5500/events");

			// eventSource.onmessage = (event) => {
			// 	const data = JSON.parse(event.data);
			// 	setProgress({ message: data.message, progress: data.progress });
			// 	if (data.message === "Processing completed successfully!") {
			// 		console.log("In here!! -- 2");
			// 		fetchOutput();
			// 	}

			// };

			// eventSource.onerror = (error) => {
			// 	console.error("EventSource failed:", error);
			// 	eventSource.close();
			// 	setInfLoading(false);
			// };
			


		} catch (error) {
			console.error("Inference error:", error);
		}

		
	};

	async function fetchOutput() {

		const goutputResponse = await fetch("http://localhost:5500/goutput")
		const ginferredBlob = await goutputResponse.blob();
		const ginferredImage = await NVImage.loadFromFile({
			file: new File([await ginferredBlob.arrayBuffer()], "GraceInferenceResult.nii.gz"),
			colormap: 'jet',
			opacity: 1,
		});

		const doutputResponse = await fetch("http://localhost:5500/doutput")
		const dinferredBlob = await doutputResponse.blob();
		const dinferredImage = await NVImage.loadFromFile({
			file: new File([await dinferredBlob.arrayBuffer()], "DominoInferenceResult.nii.gz"),
			colormap: 'jet',
			opacity: 1,
		});

		const dppoutputResponse = await fetch("http://localhost:5500/goutput")
		const dppinferredBlob = await dppoutputResponse.blob();
		const dppinferredImage = await NVImage.loadFromFile({
			file: new File([await dppinferredBlob.arrayBuffer()], "InferenceResult.nii.gz"),
			colormap: 'jet',
			opacity: 1,
		});
		setInfLoading(true);
		setgInferenceResults(ginferredImage);
		setdInferenceResults(dinferredImage);
		setdppInferenceResults(dppinferredImage);
		setDisabledButton(false);
	};

	return (
		<div>

			<div className="flex flex-col items-center justify-center w-screen">
				<div className="flex justify-between w-full">
					<div className="flex justify-center w-1/2 text-4xl font-bold">GRACE</div>
					<div className="flex justify-center w-1/2 text-4xl font-bold">DOMINO</div>
				</div>
				{loading ? (
					<div className="flex items-center justify-center">
						<div className="animate-spin rounded-full h-32 w-32 border-b-2 border-lime-800"></div>
					</div>
				) : (
					<div>
						<div className="p-2 bg-white">
							{image && (
								<NiiVueComponent
									image1={image}
									image2={image}
									inferredImage1={ginferenceResults}
									inferredImage2={dinferenceResults}
								/>
							)}

{infLoading ?
							<div className="flex justify-center mt-4">
								<div className="w-1/2 block bg-gray-200 rounded-full dark:bg-gray-700">
									<div className="bg-blue-600 text-xs font-medium text-blue-100 text-center p-0.5 leading-none rounded-full" style={{ width: progress.progress.toString() + "%" }}>{progress.progress.toString() + "%"}</div>
								</div>
							</div>
							: <span></span>}
							<br />
							<div className="flex flex-nowrap justify-center">
								{disabledButton ? 
								<button
									className="bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded"
									onClick={handleInference}
									disabled={infLoading}
								>
									{infLoading ? progress.message : "Inference Using API"}
								</button> 
								: <span></span>}
								</div>
							</div>

						{/* {
							!disabledButton ? 
							<div>	
								
								<div className="p-4 bg-white shadow-md m-10 w-50">
									{image && (
										<NiiVue
										image={image}
										inferredImage={dppinferenceResults}
										/>
									)}
								</div>
							</div>
							
							: <span></span>
						} */}
					</div>
				)}

			</div>

		</div>
	);
};

export default Results;
