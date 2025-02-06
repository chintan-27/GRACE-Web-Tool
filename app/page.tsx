"use client";
import Link from "next/link";
import FileInput from "./components/fileUpload";
import React, { useState } from 'react';

export default function Home() {
	const [fileUrl, setFileUrl] = useState<string | null>(null);

	const handleFileChange = (file: File) => {
		// Handle the file upload logic here, e.g., send it to an API route
		console.log('File selected:', file);
		setFileUrl(URL.createObjectURL(file)); // Set the file URL state
	};

	return (
		<div className="flex flex-col items-center justify-center h-screen">
			<h1 className="text-2xl font-bold text-serif p-10">GRACE Inference Web App</h1>
			<div className="w-1/2">
				<FileInput onFileChange={handleFileChange} />
			</div>
			<Link href={{
				pathname: '/results',
				query: { file: fileUrl } // Use the fileUrl state here
			}} className="bg-lime-800 hover:bg-lime-950 duration-200 text-white font-bold py-2 px-4 rounded mt-10">
				Submit</Link>
		</div>
	);
};

