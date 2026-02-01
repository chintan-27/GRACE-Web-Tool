"use client";

import { JobProvider } from "../context/JobContext";
import Header from "./components/layout/Header";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <JobProvider>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border bg-surface">
          <div className="container mx-auto px-4 py-4 text-xs text-foreground-muted space-y-1">
            <p>
              <strong>Disclaimer:</strong> This interface is intended for research and
              prototyping only and does not provide medical advice,
              diagnosis, or treatment.
            </p>
            <p>
              Upload only de-identified MRI data and ensure that your use
              complies with all applicable ethics, privacy, and data
              governance requirements.
            </p>
          </div>
        </footer>
      </div>
    </JobProvider>
  );
}
