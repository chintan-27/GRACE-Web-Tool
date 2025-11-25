"use client";

import "./globals.css";
import { JobProvider } from "../context/JobContext";
import ThemeToggle from "./components/ThemeToggle";

export default function RootLayout({ children }: any) {
  return (
    <html lang="en">
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
        <ThemeToggle />
        <JobProvider>{children}</JobProvider>
      </body>
    </html>
  );
}
