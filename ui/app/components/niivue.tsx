/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useRef, useEffect, useState } from "react";
import { Niivue, NVImage } from "@niivue/niivue";

interface NiiVueProps {
	image: NVImage;
	inferredImages: {
		grace?: NVImage | null;
		domino?: NVImage | null;
		dominopp?: NVImage | null;
	};
	selectedModels: {
		grace: boolean;
		domino: boolean;
		dominopp: boolean;
	};
	progressMap?: {
		grace?: { progress: number; message: string };
		domino?: { progress: number; message: string };
		dominopp?: { progress: number; message: string };
	};
}

const NiiVueComponent = ({ image, inferredImages, selectedModels, progressMap }: NiiVueProps) => {
	const canvasRefs = {
		grace: useRef<HTMLCanvasElement>(null),
		domino: useRef<HTMLCanvasElement>(null),
		dominopp: useRef<HTMLCanvasElement>(null),
	};

	const nvRefs = {
		grace: useRef<Niivue | null>(null),
		domino: useRef<Niivue | null>(null),
		dominopp: useRef<Niivue | null>(null),
	};

	const modelOrder = ["grace", "domino", "dominopp"] as const;
	const activeModels = modelOrder.filter((model) => selectedModels[model]);

	const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");

	const getWidthClass = (count: number) => {
		if (count === 3) return "w-1/3";
		if (count === 2) return "w-1/2";
		return "w-full";
	};

	const getCanvasSize = (count: number) => {
		if (count === 3) return { width: 512, height: 1024 };
		if (count === 2) return { width: 120, height: 360 };
		return { width: 720, height: 720 };
	};

	// Initialize Niivue instances
	useEffect(() => {
		modelOrder.forEach((key) => {
			if (selectedModels[key] && canvasRefs[key].current && !nvRefs[key].current) {
				const nv = new Niivue({
					show3Dcrosshair: true,
					isRadiologicalConvention: true,
					backColor: [0, 0, 0, 1],
				});
				nv.attachToCanvas(canvasRefs[key].current!);
				nvRefs[key].current = nv;
			}
		});
	}, [selectedModels]);

	// Add volumes + set view mode
	useEffect(() => {
		modelOrder.forEach((key) => {
			if (selectedModels[key] && nvRefs[key].current) {
				const nv = nvRefs[key].current!;
				nv.volumes = [];
				nv.updateGLVolume();

				nv.addVolume(image);
				nv.setOpacity(0, 1.0);

				if (inferredImages[key]) {
					nv.addVolume(inferredImages[key]!);
					nv.setOpacity(1, 0.0);
					nv.setOpacity(1, 1.0);
				}

				const sliceType =
					viewMode === "3d" ? nv.sliceTypeRender : nv.sliceTypeMultiplanar;

				nv.setSliceType(sliceType);
				nv.drawScene();
			}
		});
	}, [image, inferredImages, selectedModels, viewMode]);

	// Synchronize views
	useEffect(() => {
		const activeInstances = modelOrder
			.filter((key) => selectedModels[key] && nvRefs[key].current)
			.map((key) => nvRefs[key].current!) as Niivue[];

		activeInstances.forEach((nv, i) => {
			const others = activeInstances.filter((_, j) => j !== i);
			nv.broadcastTo(others, { "2d": true, "3d": true });
		});
	}, [selectedModels]);

	// Toggle 2D/3D
	const toggleGlobalView = () => {
		setViewMode((prev) => (prev === "2d" ? "3d" : "2d"));
	};

	// Handle download from Niivue instance
	const handleDownload = async (model: string) => {
		const nv = nvRefs[model as keyof typeof nvRefs].current;
		if (!nv) {
			console.error(`❌ Niivue instance for ${model} not found.`);
			return;
		}
	
		const filename = `uploaded_image_pred_${model.toUpperCase()}.nii.gz`;
	
		try {
			const result = await nv.saveImage({
				filename,
				volumeByIndex: 1, // <- we want to save the inference volume
				isSaveDrawing: false,
			});
	
			if (result instanceof Uint8Array) {
				const blob = new Blob([result], { type: "application/gzip" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = filename;
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(url);
				console.log(`✅ Downloaded: ${filename}`);
			} else {
				console.warn("⚠️ saveImage returned non-binary data:", result);
			}
		} catch (err) {
			console.error(`❌ Failed to save image for ${model}:`, err);
		}
	};
	
	return (
		<div className="w-full bg-black">
			<div className="flex justify-center mb-4">
				<button
					onClick={toggleGlobalView}
					className="px-4 py-2 text-sm bg-gray-800 text-white rounded-sm hover:bg-gray-700"
				>
					Switch to {viewMode === "2d" ? "3D" : "2D"} View
				</button>
			</div>
			<div
				className={`flex flex-row ${
					activeModels.length === 1 ? "justify-center" : "justify-start"
				} items-start space-x-4 w-full h-full`}
			>
				{activeModels.map((modelKey) => {
					const { width, height } = getCanvasSize(activeModels.length);
					const progress = progressMap?.[modelKey]?.progress || 0;
					return (
						<div
							key={modelKey}
							className={`${getWidthClass(
								activeModels.length
							)} flex flex-col items-center`}
						>
							<canvas ref={canvasRefs[modelKey]} width={width} height={height} />
							<div className="text-center mt-2 font-semibold">
								{modelKey.toUpperCase()}
							</div>

							{/* {progress < 100 && (
								<div className="w-full px-4 mt-2">
									<div className="text-sm text-center text-white mb-1">
										{progressMap?.[modelKey]?.message}
									</div>
									<div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
										<div
											className="h-full bg-blue-500"
											style={{ width: `${progress}%` }}
										/>
									</div>
								</div>
							)} */}

							{progress === 100 && (
								<button
								onClick={() => {
									handleDownload(modelKey);
								}}
								className="mt-2 px-3 py-1 bg-lime-600 text-white text-sm rounded-sm hover:bg-lime-700"
							  >
								Download
							  </button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default NiiVueComponent;
