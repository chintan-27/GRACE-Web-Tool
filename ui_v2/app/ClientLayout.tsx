"use client";

import { JobProvider } from "../context/JobContext";
import Header from "./components/layout/Header";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <JobProvider>
      <Header />
      {children}
    </JobProvider>
  );
}
