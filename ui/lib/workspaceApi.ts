"use client";

import { API_BASE } from "./api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MagicLinkResponse {
  status: string;
}

export interface VerifyTokenResponse {
  token: string;
  email: string;
  retention_days: number;
}

export interface WorkspaceMeResponse {
  id: number;
  email: string;
  created_at: string;
  last_login: string | null;
  retention_days: number;
}

export interface WorkspaceSessionsResponse {
  sessions: string[];
}

export interface DeleteAccountResponse {
  deleted: boolean;
  sessions_removed: number;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function requestMagicLink(email: string): Promise<MagicLinkResponse> {
  const res = await fetch(`${API_BASE}/workspace/request-magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Too many requests. Please wait before trying again.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to send sign-in link");
  }
  return res.json();
}

export async function verifyMagicToken(token: string): Promise<VerifyTokenResponse> {
  const res = await fetch(`${API_BASE}/workspace/verify/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Invalid or expired sign-in link");
  }
  return res.json();
}

export async function getWorkspaceMe(jwt: string): Promise<WorkspaceMeResponse> {
  const res = await fetch(`${API_BASE}/workspace/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error("Failed to fetch workspace profile");
  return res.json();
}

export async function getWorkspaceSessions(jwt: string): Promise<WorkspaceSessionsResponse> {
  const res = await fetch(`${API_BASE}/workspace/sessions`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function deleteWorkspaceAccount(jwt: string): Promise<DeleteAccountResponse> {
  const res = await fetch(`${API_BASE}/workspace/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to delete workspace");
  }
  return res.json();
}
