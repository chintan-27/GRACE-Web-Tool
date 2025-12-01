import React, { useState } from "react";

interface FileInputProps {
  onFileChange: (file: File) => void;
}

const FileInput: React.FC<FileInputProps> = ({ onFileChange }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isNifti = lowerName.endsWith(".nii") || lowerName.endsWith(".nii.gz");

    if (!isNifti) {
      setError("Please upload a NIfTI file (.nii or .nii.gz).");
      setSelectedFile(null);
      return;
    }

    // Optional basic size check (~1GB)
    const maxBytes = 1_000_000_000;
    if (file.size > maxBytes) {
      setError("File is too large (max ~1 GB).");
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
    onFileChange(file);
  };

  return (
    <div className="w-full">
      <label
        htmlFor="nii-dropzone"
        className="flex flex-col items-center justify-center w-full h-64 border border-dashed border-neutral-700 rounded-2xl cursor-pointer bg-neutral-900/70 hover:bg-neutral-900 transition-colors shadow-inner shadow-black/30"
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4">
          <svg
            className="w-10 h-10 mb-4 text-neutral-400"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 20 16"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
            />
          </svg>
          <p className="mb-2 text-sm text-neutral-200">
            <span className="font-semibold">Click to upload</span> or drag and
            drop
          </p>
          <p className="text-xs text-neutral-400">
            De-identified NIfTI (.nii / .nii.gz) only
          </p>
          {selectedFile && !error && (
            <p className="mt-3 text-xs text-amber-200">
              Selected file: {selectedFile.name}
            </p>
          )}
          {error && (
            <p className="mt-3 text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
        </div>
        <input
          id="nii-dropzone"
          type="file"
          className="hidden"
          accept=".nii,.nii.gz,application/gzip"
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
};

export default FileInput;
