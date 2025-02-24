"use client";

import { useRef, useEffect } from "react";
import { Niivue, NVImage } from "@niivue/niivue";

interface NiiVueProps {
	image1: NVImage;                 // First base image
	image2: NVImage;                 // Second base image 
	inferredImage1: NVImage | null;  // First overlay image
	inferredImage2: NVImage | null;  // Second overlay image
}

const NiiVueComponent = ({ image1, image2, inferredImage1, inferredImage2 }: NiiVueProps) => {
	const canvasRef1 = useRef<HTMLCanvasElement>(null);
	const canvasRef2 = useRef<HTMLCanvasElement>(null);
	const niivueRef1 = useRef<Niivue | null>(null);
	const niivueRef2 = useRef<Niivue | null>(null);

	// Initialize Niivue instances and attach to canvases
	useEffect(() => {
		if (canvasRef1.current && !niivueRef1.current) {
			const nv1 = new Niivue({
				show3Dcrosshair: true,
				isRadiologicalConvention: true,
				backColor: [0, 0, 0, 1],
			});
			nv1.attachToCanvas(canvasRef1.current);
			niivueRef1.current = nv1;
		}

		if (canvasRef2.current && !niivueRef2.current) {
			const nv2 = new Niivue({
				show3Dcrosshair: true,
				isRadiologicalConvention: true,
				backColor: [0, 0, 0, 1],
			});
			nv2.attachToCanvas(canvasRef2.current);
			niivueRef2.current = nv2;
		}
	}, []);

	// Add volumes when images change for first viewer
	useEffect(() => {
		const nv1 = niivueRef1.current;
		const nv2 = niivueRef2.current;

		if (nv1) {
			nv1.volumes = [];
			nv1.updateGLVolume();

			nv1.addVolume(image1);
			nv1.setOpacity(0, 1.0);

			if (inferredImage1) {
				nv1.addVolume(inferredImage1);
				const overlayIndex = nv1.volumes.length - 1;
				nv1.setOpacity(0, 0.0);
			}

			nv1.updateGLVolume();
		}

		if (nv2) {
			nv2.volumes = [];
			nv2.updateGLVolume();

			nv2.addVolume(image2);
			nv2.setOpacity(0, 1.0);

			if (inferredImage2) {
				nv2.addVolume(inferredImage2);
				const overlayIndex = nv2.volumes.length - 1;
				nv2.setOpacity(0, 0.0);
			}

			nv2.updateGLVolume();
		}

		if (nv1 && nv2) {
			nv1.broadcastTo([nv2], { "2d": true, "3d": true });
			nv2.broadcastTo([nv1], { "2d": true, "3d": true });
		}
	}, [image1, image2, inferredImage1, inferredImage2]);

	return (
		<div className="flex flex-row space-x-4">
			<div className="w-1/2">
				<canvas ref={canvasRef1} height={119} />
			</div>
			<div className="w-1/2">
				<canvas ref={canvasRef2} height={119}/>
			</div>
		</div>
	);
};

export default NiiVueComponent;
