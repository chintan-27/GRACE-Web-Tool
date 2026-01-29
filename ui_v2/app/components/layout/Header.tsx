"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Moon, Sun, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

// Theme store using useSyncExternalStore pattern
const themeStore = {
  getSnapshot: (): "dark" | "light" => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },
  getServerSnapshot: (): "dark" | "light" => "dark",
  subscribe: (callback: () => void) => {
    // Listen for storage changes and custom theme change events
    const handleStorage = () => callback();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("theme-change", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("theme-change", handleStorage);
    };
  },
  setTheme: (theme: "dark" | "light") => {
    localStorage.setItem("theme", theme);
    window.dispatchEvent(new Event("theme-change"));
  },
};

export default function Header() {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot
  );
  const [mounted, setMounted] = useState(false);

  // Track mount state for hydration safety - this is an intentional pattern
  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply theme class when theme changes
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    const newTheme = theme === "dark" ? "light" : "dark";
    themeStore.setTheme(newTheme);
  }, [theme]);

  const headerContent = (
    <>
      {/* Logo and Title */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-hover text-white shadow-md">
          <Brain className="h-6 w-6" />
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Whole Head Segmentator
          </span>
          <span className="text-xs text-foreground-muted">
            Advanced MRI Segmentation Suite
          </span>
        </div>
      </div>

      {/* Theme Toggle */}
      {mounted ? (
        <button
          onClick={toggleTheme}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-lg",
            "border border-border bg-surface text-foreground-secondary",
            "transition-all duration-200 hover:bg-surface-elevated hover:text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          )}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      ) : (
        <div className="h-9 w-9" />
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        {headerContent}
      </div>
    </header>
  );
}
