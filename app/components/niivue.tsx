"use client";

import { useRef, useEffect } from "react";
import { Niivue, NVImage } from "@niivue/niivue";

const NiiVue = ({ image, inferred, inferredImage }: { image: NVImage, inferred:boolean, inferredImage: NVImage | null}) => {

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // const volumeList = [
    //   {
    //     url: imageUrl,
    //   },
    // ];
    const nv = new Niivue();
    if (canvas.current) {
        nv.attachToCanvas(canvas.current);
        // nv.loadVolumes(volumeList);
        nv.addVolume(image);
        if (inferred && inferredImage) {
            nv.addVolume(inferredImage);
        }
        const gl = canvas.current.getContext("webgl2");
        // if (gl) {
        //     NVMesh.loadFromFile({file: blob, gl: gl, name: "image"}).then((m) => {
        //         nv.addMesh(m);
        //     });
        // }
    }
  }, [image, inferred, inferredImage]);

  return <canvas ref={canvas} className="w-50"/>;
};

export default NiiVue;