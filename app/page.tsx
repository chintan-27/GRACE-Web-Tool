"use client";
import Link from "next/link";
import FileInput from "./components/fileUpload";
import React, { useState } from 'react';

export default function Home() {
	const [fileUrl, setFileUrl] = useState<string | null>(null);
	const [checkbox1, setCheckbox1] = useState(false);
	const [checkbox2, setCheckbox2] = useState(false);
	const [checkbox3, setCheckbox3] = useState(false);

	const handleFileChange = (file: File) => {
		// Handle the file upload logic here, e.g., send it to an API route
		setFileUrl(URL.createObjectURL(file)); // Set the file URL state
	};

	const isAnyCheckboxChecked = checkbox1 || checkbox2 || checkbox3;

	return (
		<div className="flex flex-col items-center justify-center h-screen">
			<h1 className="text-2xl font-bold text-serif p-10">WHOLE HEAD MRI SEGMENTATOR</h1>
			<div className="w-1/2">
				<FileInput onFileChange={handleFileChange} />
			</div>
			<div className="flex flex-row mt-4 space-x-4">
				
				<label className={`flex items-center ${checkbox1 ? 'text-lime-600' : 'text-gray-500'}`}>
					<input type="checkbox" checked={checkbox1} onChange={() => setCheckbox1(!checkbox1)} className="mr-2 h-5 w-5 text-lime-600 border-gray-300 rounded focus:ring-lime-500" />
					<span className="text-lg font-medium">GRACE</span>
				</label>
				<label className={`flex items-center ${checkbox2 ? 'text-lime-600' : 'text-gray-500'}`}>
					<input type="checkbox" checked={checkbox2} onChange={() => setCheckbox2(!checkbox2)} className="mr-2 h-5 w-5 text-lime-600 border-gray-300 rounded focus:ring-lime-500" />
					<span className="text-lg font-medium">DOMINO</span>
				</label>
				<label className="flex items-center text-gray-500">
					<input type="checkbox" disabled className="mr-2 h-5 w-5 text-gray-300 border-gray-300 rounded" />
					<span className="text-lg font-medium">DOMINO++ (Model not available yet)</span>
				</label>
			</div>
			<Link 
			href={{
				pathname: '/results',
				query: { file: fileUrl, grace: checkbox1, domino: checkbox2, dominopp: checkbox3 } // Pass the checkbox states here
			}} className={`font-bold py-2 px-4 rounded mt-10 ${!isAnyCheckboxChecked ? 'pointer-events-none bg-lime-950 text-gray' : 'bg-lime-700 hover:bg-lime-800 duration-200 text-white'}`}>
				Submit</Link>
		</div>
	);
};
