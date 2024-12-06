"use client";

import { useRef, useEffect } from "react";
import { Niivue, NVImage } from "@niivue/niivue";

interface NiiVueProps {
  image: NVImage;                 // The base image
  inferredImage: NVImage | null;  // The overlay image
}

const NiiVueComponent = ({ image, inferredImage }: NiiVueProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const niivueRef = useRef<Niivue | null>(null);

  // Initialize Niivue and attach to canvas
  useEffect(() => {
    if (canvasRef.current && !niivueRef.current) {
      const nv = new Niivue({
        show3Dcrosshair: true,
        isRadiologicalConvention: true,
        backColor: [0, 0, 0, 1],
      });
      nv.attachToCanvas(canvasRef.current);
      niivueRef.current = nv;
    }
  }, []);

  // Add volumes when images change
  useEffect(() => {
    const nv = niivueRef.current;
    if (nv) {
      // Clear existing volumes
      nv.volumes = [];
      nv.updateGLVolume();
  
      // Add the base image
      nv.addVolume(image);
      nv.setOpacity(0, 1.0);
  
      // Add the inferred image if available
      if (inferredImage) {
        nv.addVolume(inferredImage);
        const overlayIndex = nv.volumes.length - 1;
        nv.setOpacity(overlayIndex, 0.5); // Adjust opacity as needed
      }
  
      // Refresh the scene
      nv.updateGLVolume();
    }
  }, [image, inferredImage]);

  return <canvas ref={canvasRef} style={{ width: '800px', height: '600px' }} />;
};

export default NiiVueComponent;
