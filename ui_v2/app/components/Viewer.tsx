"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";
import { getResult } from "../../lib/api";
import { Niivue } from "@niivue/niivue";

interface Props {
  sessionId: string;
  models: string[];
}

export default function Viewer({ sessionId, models }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nv = useRef<Niivue | null>(null);
  const [active, setActive] = useState(models[0]);
  const [nvReady, setNvReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    // Wait for next frame to ensure canvas has valid dimensions
    const frameId = requestAnimationFrame(() => {
      if (cancelled || !canvas) return;

      try {
        const niivue = new Niivue({ isRadiologicalConvention: false });
        niivue.attachToCanvas(canvas);
        nv.current = niivue;
        setNvReady(true);
      } catch (err) {
        console.error("Failed to initialize Niivue:", err);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      setNvReady(false);
      try {
        nv.current?.gl?.getExtension("WEBGL_lose_context")?.loseContext();
        nv.current = null;
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!nvReady || !nv.current) return;

    (async () => {
      try {
        const blob = await getResult(sessionId, active);
        const buffer = await blob.arrayBuffer();

        if (nv.current) {
          await nv.current.loadFromArrayBuffer(buffer, `${active}.nii.gz`);
        }
      } catch (err) {
        console.error("Failed to load volume:", err);
      }
    })();
  }, [sessionId, active, nvReady]);

  return (
    <Card className="bg-white dark:bg-gray-900 dark:border-gray-700 p-4 space-y-4">
      <Tabs value={active} onValueChange={setActive}>
        <TabsList className="dark:bg-gray-800">
          {models.map((m) => (
            <TabsTrigger
              key={m}
              value={m}
              className="data-[state=active]:bg-gray-300 dark:data-[state=active]:bg-gray-700"
            >
              {m}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="border rounded bg-gray-200 dark:bg-black w-full h-[500px] sm:h-[600px]">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </Card>
  );
}
