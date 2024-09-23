import { useRef, useEffect } from "react";
import { Niivue, NVMesh } from "@niivue/niivue";

const NiiVue = ({ imageUrl }: { imageUrl: string }) => {

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const volumeList = [
      {
        url: imageUrl,
      },
    ];
    const nv = new Niivue();
    if (canvas.current) {
        nv.attachToCanvas(canvas.current);
        nv.loadVolumes(volumeList);
        const gl = canvas.current.getContext("webgl2");
        if (gl) {
            NVMesh.loadFromUrl({url: imageUrl, gl: gl, name: "image"}).then((m) => {
                nv.addMesh(m);
            });
        }
    }
  }, [imageUrl]);

  return <canvas ref={canvas} height={480} width={640} />;
};

export default NiiVue;