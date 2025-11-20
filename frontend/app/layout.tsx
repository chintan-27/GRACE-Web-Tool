import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Suspense } from "react";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Whole-Head MRI Segmentator",
  description:
    "Client for GRACE/DOMINO segmentation models. Research use only; not for clinical use.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Suspense>
          <div className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col">
            <header className="border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
              <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
                <div>
                  <h1 className="text-sm font-semibold tracking-wide text-amber-300">
                    Whole-Head MRI Segmentator
                  </h1>
                  <p className="text-xs text-neutral-400">
                    GRACE · DOMINO · DOMINO++
                  </p>
                </div>
                <span className="rounded-full border border-amber-500/60 bg-amber-950/40 px-3 py-1 text-[10px] font-medium text-amber-100 uppercase tracking-wide">
                  Research tool – Not for clinical use
                </span>
              </div>
            </header>

            <main className="flex-1 bg-gradient-to-br from-neutral-950 via-stone-950 to-neutral-900">
              {children}
            </main>

            <footer className="border-t border-neutral-800 bg-neutral-950/95">
              <div className="mx-auto max-w-5xl px-4 py-3 text-[11px] text-neutral-400 space-y-1">
                <p>
                  Disclaimer: This interface is intended for research and
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
        </Suspense>
      </body>
    </html>
  );
}
