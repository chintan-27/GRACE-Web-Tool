"use client";

import Link from "next/link";
import React, { useState } from "react";
import FileInput from "./components/fileUpload";

type Space = "native" | "freesurfer";

export default function Home() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space>("native");

  const [grace, setGrace] = useState(false);
  const [domino, setDomino] = useState(false);
  const [dominopp, setDominopp] = useState(false);

  const handleFileChange = (file: File) => {
    const url = URL.createObjectURL(file);
    setFileUrl(url);
  };

  const isAnyModelChecked = grace || domino || dominopp;
  const hasFile = !!fileUrl;
  const canSubmit = hasFile && isAnyModelChecked;

  return (
    <div className="flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl">
        <div className="grid gap-8 md:grid-cols-[minmax(0,2.1fr),minmax(0,1.3fr)] items-start">
          {/* LEFT: main card */}
          <section className="rounded-3xl border border-neutral-800 bg-neutral-900/80 p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.75)] backdrop-blur">
            <div className="space-y-2 mb-6">
              <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
                Whole-Head MRI Segmentator
              </h2>
              <p className="text-sm text-neutral-400">
                Upload a T1-weighted MRI volume, choose a processing space, and
                run GRACE / DOMINO models to obtain whole-head segmentations.
              </p>
            </div>

            {/* Space selection */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                Processing space
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedSpace("native")}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                    selectedSpace === "native"
                      ? "border-amber-500 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
                      : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  <div className="font-medium text-neutral-50">
                    Native space
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    Segment directly in each subject&apos;s native anatomical
                    space.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSpace("freesurfer")}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                    selectedSpace === "freesurfer"
                      ? "border-amber-500 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]"
                      : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  <div className="font-medium text-neutral-50">
                    FreeSurfer space
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    Use volumes aligned to a FreeSurfer-derived space.
                  </div>
                </button>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                Both spaces will support GRACE, DOMINO, and DOMINO++ models.
              </p>
            </div>

            {/* File upload */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                Upload NIfTI volume
              </p>
              <FileInput onFileChange={handleFileChange} />
              {!hasFile && (
                <p className="mt-2 text-xs text-amber-300">
                  A de-identified T1-weighted .nii or .nii.gz file is required.
                </p>
              )}
            </div>

            {/* Models */}
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                Models to run in{" "}
                {selectedSpace === "native" ? "native" : "FreeSurfer"} space
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <label
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-pointer transition-colors ${
                    grace
                      ? "border-amber-500 bg-amber-500/15 text-amber-100"
                      : "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={grace}
                    onChange={() => setGrace((prev) => !prev)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="font-medium">GRACE</span>
                </label>

                <label
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-pointer transition-colors ${
                    domino
                      ? "border-amber-500 bg-amber-500/15 text-amber-100"
                      : "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:bg-neutral-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={domino}
                    onChange={() => setDomino((prev) => !prev)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="font-medium">DOMINO</span>
                </label>

                <label
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 cursor-not-allowed ${
                    dominopp
                      ? "border-amber-500 bg-amber-500/15 text-amber-100"
                      : "border-neutral-800 text-neutral-500 bg-neutral-950"
                  }`}
                  title="Model not available yet"
                >
                  <input
                    type="checkbox"
                    disabled
                    checked={dominopp}
                    onChange={() => setDominopp((prev) => !prev)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="font-medium">DOMINO++</span>
                  <span className="text-[10px] uppercase tracking-wide text-neutral-500 ml-1">
                    Coming soon
                  </span>
                </label>
              </div>
              {!isAnyModelChecked && (
                <p className="mt-2 text-xs text-amber-300">
                  Select at least one model to run.
                </p>
              )}
            </div>

            {/* CTA + local disclaimer */}
            <div className="flex items-center justify-between gap-4">
              <div className="text-[11px] text-neutral-400 space-y-1 max-w-xs">
                <p>
                  Uploaded volumes are sent to the backend to compute
                  segmentations. They are not intended for direct clinical
                  decision-making.
                </p>
                <p>
                  Do not upload data with direct identifiers or data that
                  violates your data use or ethics agreements.
                </p>
              </div>

              <Link
                href={{
                  pathname: "/trial",
                  query: {
                    file: fileUrl,
                    grace,
                    domino,
                    dominopp,
                    space: selectedSpace, // forwarded for future use; backend calls unchanged
                  },
                }}
                className={`font-semibold py-2.5 px-6 rounded-full text-sm shadow-md shadow-black/60 transition ${
                  canSubmit
                    ? "bg-amber-500 hover:bg-amber-400 text-neutral-950"
                    : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                }`}
                aria-disabled={!canSubmit}
                onClick={(e) => {
                  if (!canSubmit) {
                    e.preventDefault();
                  }
                }}
              >
                Run segmentation
              </Link>
            </div>
          </section>

          {/* RIGHT: explainer / copy */}
          <aside className="space-y-4 text-sm text-neutral-400">
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300 mb-2">
                Workflow
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                <li>Choose the processing space: Native or FreeSurfer.</li>
                <li>Upload a de-identified T1-weighted MRI NIfTI volume.</li>
                <li>Select one or more segmentation models (GRACE / DOMINO).</li>
                <li>
                  View predictions in the viewer and export labeled volumes from
                  the results page.
                </li>
              </ol>
            </div>

            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/70 p-4 text-xs">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-300 mb-2">
                Data & privacy
              </h3>
              <p className="mb-1">
                This tool is intended for research and development only. It
                should be used with properly de-identified data and within the
                scope of institutional approvals.
              </p>
              <p>
                Actual backend storage,
                logging, and retention policies will be listed here soon so that users understand how
                their data is handled.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
