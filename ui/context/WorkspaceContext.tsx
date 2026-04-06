"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceUser {
  token: string;
  email: string;
  retention_days: number;
  expires_at: number; // epoch ms
}

interface WorkspaceContextType {
  user: WorkspaceUser | null;
  isLoggedIn: boolean;
  login: (token: string, email: string, retention_days: number) => void;
  logout: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextType>({
  user: null,
  isLoggedIn: false,
  login: () => {},
  logout: () => {},
});

const STORAGE_KEY = "grace_workspace_jwt";
// JWT default is 8 hours (480 min); store expiry locally
const JWT_LIFETIME_MS = 8 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WorkspaceUser | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored: WorkspaceUser = JSON.parse(raw);
      if (stored.expires_at > Date.now()) {
        setUser(stored);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback((token: string, email: string, retention_days: number) => {
    const user: WorkspaceUser = {
      token,
      email,
      retention_days,
      expires_at: Date.now() + JWT_LIFETIME_MS,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ user, isLoggedIn: !!user, login, logout }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
