"use client";
import NiiVue from "./components/niivue";
// import image from "../public/images/image.nii.gz"


export default function Home() {
  return (
    <div className="h-screen w-screen">
      <NiiVue imageUrl={"/images/image.nii.gz"} />
    </div>
  );
}
