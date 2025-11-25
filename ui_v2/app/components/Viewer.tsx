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

  useEffect(() => {
    if (!canvasRef.current) return;

    nv.current = new Niivue({ isRadiologicalConvention: false });
    nv.current.attachToCanvas(canvasRef.current);

    return () => {
      try {
        nv.current?.gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!nv.current) return;

    (async () => {
      const blob = await getResult(sessionId, active);
      const buffer = await blob.arrayBuffer();

      nv.current!.loadVolumes([
        {
          url: "",
          name: active,
          buffer,
        },
      ]);
    })();
  }, [active]);

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
