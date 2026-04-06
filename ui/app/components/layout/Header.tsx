"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Moon, Sun, Brain, LogIn, LogOut, User } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/context/WorkspaceContext";

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
  const { user, isLoggedIn, logout } = useWorkspace();
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
        <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-hover shadow-glow">
          <Brain className="h-6 w-6 text-accent-foreground" />
          <span className="absolute -right-1 -top-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-[0.2em] text-foreground font-mono">
              CROWN
            </span>
            <span className="rounded border border-accent/40 bg-accent-muted px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-accent font-mono">
              v2
            </span>
            <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-foreground-muted font-mono">
              AI
            </span>
          </div>
          <p className="text-[10px] font-mono text-foreground-muted leading-none">
            <span className="font-bold text-accent">C</span>omprehensive{" "}
            <span className="font-bold text-accent">R</span>econstruction{" "}
            <span className="font-bold text-accent">O</span>f{" "}
            <span className="font-bold text-accent">W</span>hole-head{" "}
            <span className="font-bold text-accent">N</span>euromodulation
          </p>
        </div>
      </div>

      {/* Right side: workspace + theme toggle */}
      <div className="flex items-center gap-2">
        {/* Workspace user pill or sign-in link */}
        {mounted && (
          isLoggedIn && user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/workspace"
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-muted",
                  "px-3 py-1.5 text-xs font-medium text-accent",
                  "transition-colors hover:bg-accent/20"
                )}
              >
                <User className="h-3 w-3" />
                <span className="max-w-[140px] truncate">{user.email}</span>
              </Link>
              <button
                onClick={logout}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  "border border-border bg-surface text-foreground-secondary",
                  "transition-all duration-200 hover:bg-surface-elevated hover:text-foreground"
                )}
                aria-label="Sign out of workspace"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/workspace"
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-border bg-surface",
                "px-3 py-1.5 text-xs font-medium text-foreground-secondary",
                "transition-colors hover:bg-surface-elevated hover:text-foreground"
              )}
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign in</span>
            </Link>
          )
        )}

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
      </div>
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
